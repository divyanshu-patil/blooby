import type { NextFunction, Request, Response } from 'express';

/** One line per request, with the resolved user once authenticate has run. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on('finish', () => {
    const who = req.user ? `${req.user.role}:${req.user.id.slice(0, 8)}` : 'anon';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms ${who}`);
  });
  next();
}
