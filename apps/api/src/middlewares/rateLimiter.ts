import rateLimit from 'express-rate-limit';

/** Broad ceiling on the whole API — abuse protection, not per-route tuning. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down and try again shortly.', code: 'rate_limited' },
});

/**
 * Saves are the expensive path: each one writes a full project to S3. Autosave is
 * debounced client-side, but a client with a bug (or none at all) must not be able to
 * hammer the bucket, so the ceiling is enforced here too.
 */
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many saves in a short period. Your work is safe — retry shortly.', code: 'rate_limited' },
});
