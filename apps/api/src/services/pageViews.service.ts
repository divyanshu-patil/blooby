import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from '../config/prisma.js';

/**
 * Recording that someone opened a page.
 *
 * Two rules shape everything here.
 *
 * It must not cost the visitor anything. A row per view is a ~580ms round trip to the
 * pooler, and the whole point of the last few changes was to stop paying those; so views
 * go into a buffer and are written in one `createMany` every few seconds. A crash loses
 * at most one flush, which for a traffic counter is the right trade — nobody makes a
 * decision on the last two seconds of it.
 *
 * It must not identify anybody. There is no cookie and no device storage: `visitor` is
 * sha256(address + user agent + a salt that is regenerated every day). That is enough to
 * count two people on one day as two, and it is deliberately NOT enough to recognise the
 * same person tomorrow — the salt they were hashed with no longer exists. The address is
 * never written down. This is the same shape as Vercel's Web Analytics, and it is why
 * there is no consent banner to build.
 */

export interface ViewInput {
  path: string;
  app?: string;
  fromPath?: string | null;
  referrer?: string | null;
  device?: string | null;
}

/**
 * The salt, and the day it belongs to.
 *
 * Rotated lazily on read rather than on a timer: a process that served nothing overnight
 * should not be doing work, and the first view of a new day rotates it anyway.
 */
let salt = randomBytes(32);
let saltDay = today();
function today() { return new Date().toISOString().slice(0, 10); }

function visitorOf(req: Request): string {
  if (saltDay !== today()) { salt = randomBytes(32); saltDay = today(); }
  return createHash('sha256')
    .update(salt)
    .update(req.ip ?? '')
    .update(req.headers['user-agent'] ?? '')
    .digest('base64url')
    .slice(0, 22);
}

/** The referrer's HOST, or nothing. A full URL carries query strings we have no use for
 *  and no business keeping, and 'google.com' is the whole of what the answer needs. */
function referrerHost(raw: string | null | undefined, self: string): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host && host !== self ? host.slice(0, 120) : null;   // arriving from ourselves is navigation, not a referral
  } catch { return null; }
}

/**
 * The route, not the URL.
 *
 * A path with an id in it makes every project its own line in "top pages" — and puts ids
 * that are nobody's business into an analytics table. The client already sends the route
 * pattern; this is the backstop for anything that does not.
 */
export function normalisePath(raw: string): string {
  const path = raw.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '') || '/';
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .slice(0, 200);
}

type Buffered = {
  path: string; app: string; fromPath: string | null; referrer: string | null;
  userId: string | null; visitor: string; device: string | null; at: Date;
};

let buffer: Buffered[] = [];
let timer: NodeJS.Timeout | null = null;

const FLUSH_MS = 5_000;
/** A ceiling so a burst (or a broken client) cannot grow the buffer without bound — past
 *  this, views are dropped rather than the process. Analytics is not worth an OOM. */
const MAX_BUFFERED = 5_000;

export async function flushViews() {
  if (!buffer.length) return 0;
  const batch = buffer;
  buffer = [];
  try {
    await prisma.pageView.createMany({ data: batch });
    return batch.length;
  } catch (e) {
    // dropped, not retried: a retry queue for page views is a queue to maintain, and the
    // number it protects is a number nobody acts on to two decimal places
    console.warn(`[pageviews] dropped ${batch.length}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

export const pageViewsService = {
  /** Buffer one view. Returns immediately — nothing about this waits on the database. */
  record(req: Request, input: ViewInput, selfHost: string) {
    if (buffer.length >= MAX_BUFFERED) return;
    buffer.push({
      path: normalisePath(input.path),
      app: input.app === 'admin' ? 'admin' : 'web',
      fromPath: input.fromPath ? normalisePath(input.fromPath) : null,
      referrer: referrerHost(input.referrer, selfHost),
      userId: req.user?.id ?? null,
      visitor: visitorOf(req),
      device: input.device === 'mobile' || input.device === 'tablet' ? input.device : 'desktop',
      at: new Date(),
    });
    if (!timer) {
      timer = setTimeout(() => { timer = null; void flushViews(); }, FLUSH_MS);
      timer.unref();   // a pending flush must never hold a process open
    }
  },

  /** For a test, and for a clean shutdown. */
  flush: flushViews,
  buffered: () => buffer.length,
};
