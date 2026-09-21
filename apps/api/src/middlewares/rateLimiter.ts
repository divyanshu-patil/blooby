import { createHash } from 'node:crypto';
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';

/**
 * Where the counts live.
 *
 * In memory, a limit of 60 saves a minute is 60 PER INSTANCE: scale to three and it is
 * silently 180, which is not what the number says. Shared, it means what it says however
 * many instances are running, and a restart no longer resets everyone's budget.
 *
 * Without Redis this returns undefined and express-rate-limit uses its own memory store,
 * which is the behaviour this server has always had.
 *
 * `passOnStoreError` is the other half: if Redis is unreachable the request is ALLOWED
 * through rather than 500ing. A rate limiter is there to protect against abuse, and
 * failing every request because the thing that counts them is down is a worse outage than
 * the one it would prevent.
 */
function store(prefix: string): Store | undefined {
  const client = redis;
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => client.call(...(args as [string, ...string[]])) as Promise<never>,
  });
}

/**
 * Who a request counts against.
 *
 * Not the IP address. These limiters run before any route has authenticated anyone, and an
 * address is the wrong unit anyway: behind a load balancer every user shares one, and an
 * office or a phone network puts hundreds of people on a handful. So a request that carries
 * a credential is counted against THAT credential — the token identifies the caller even
 * though this layer has not verified it, and a forged one only limits itself. It is hashed,
 * so no token is ever a key in the limiter's memory.
 *
 * Anonymous requests fall back to the address, through `ipKeyGenerator` so that an IPv6
 * client cannot walk its own /64 for a fresh bucket each time. That address is only as
 * truthful as TRUST_PROXY — see config/envSchema.ts.
 */
export function caller(req: Request): string {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) return `t:${createHash('sha256').update(auth.slice(7)).digest('base64url').slice(0, 24)}`;
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/** Broad ceiling per caller — abuse protection, not per-route tuning. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  store: store('general'),
  passOnStoreError: true,
  keyGenerator: caller,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again shortly.', code: 'rate_limited' },
});

/**
 * Saves are the expensive path: each one writes a full project to S3. Autosave is
 * debounced client-side, but a client with a bug (or none at all) must not be able to
 * hammer the bucket, so the ceiling is enforced here too — per person, so one busy
 * editor cannot spend everybody else's saves.
 */
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  store: store('write'),
  passOnStoreError: true,
  keyGenerator: caller,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many saves in a short period. Your work is safe — retry shortly.', code: 'rate_limited' },
});
