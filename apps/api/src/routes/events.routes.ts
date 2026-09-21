import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalAuth } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { caller } from '../middlewares/rateLimiter.js';
import { pageViewsService } from '../services/pageViews.service.js';
import { env } from '../config/env.js';
import { pageViewDto, type PageViewDto } from '../dtos/events/index.js';

/**
 * Where the browser says "someone opened this page".
 *
 * Open to signed-out callers on purpose: a traffic counter that only counts signed-in
 * people is not a traffic counter. `optionalAuth` attaches the person when there is one,
 * so the panel can separate "visits" from "visits by our users".
 *
 * It answers 204 and writes nothing synchronously — the view is buffered and flushed in a
 * batch (see services/pageViews.service.ts). Nothing the visitor is waiting for touches
 * the database.
 */
export const eventsRoutes = Router();

/**
 * Its own limit, tighter than the app's.
 *
 * This is the one endpoint anybody can call without an account, and its whole job is to
 * insert rows, so it is the obvious thing to point a script at. 120 a minute is far more
 * than a person clicking around can produce and far less than a flood.
 */
const viewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: caller,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  passOnStoreError: true,
  message: { error: 'Too many events.', code: 'rate_limited' },
});

const selfHost = (() => { try { return new URL(env.appUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();

eventsRoutes.post('/view', viewLimiter, optionalAuth, validate(pageViewDto), (req, res) => {
  pageViewsService.record(req, req.body as PageViewDto, selfHost);
  res.status(204).end();
});
