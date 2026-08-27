import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(HttpError.notFound('No such endpoint'));
}

/**
 * The single place an error becomes a response. Known HttpErrors keep their message;
 * everything else is reported as a generic 500 so internal detail (constraint names, S3
 * keys, stack traces) never reaches a client — while still being logged in full here.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }

  console.error('[unhandled]', err);
  res.status(500).json({
    error: 'Something went wrong on our end.',
    code: 'internal_error',
    ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
