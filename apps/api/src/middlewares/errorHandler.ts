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

  /**
   * Express's own body parser throws before any route runs — malformed JSON, or a payload
   * over the limit — and tags the error with the status it means. Without this those came
   * back as "Something went wrong on our end.", so a client sending a bad body was told
   * the server had broken. The message is body-parser's own and says nothing internal.
   */
  if (isBodyParserError(err)) {
    return res.status(err.status).json({
      error: err.status === 413
        ? 'That payload is too large.'
        : 'The request body could not be read as JSON.',
      code: err.status === 413 ? 'payload_too_large' : 'bad_request',
    });
  }

  console.error('[unhandled]', err);
  res.status(500).json({
    error: 'Something went wrong on our end.',
    code: 'internal_error',
    ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}

/** A body-parser failure: it sets `type` and a 4xx `status` on the error it throws. */
function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' && e !== null
    && typeof (e as { type?: unknown }).type === 'string'
    && (e as { type: string }).type.startsWith('entity.')
    && typeof (e as { status?: unknown }).status === 'number'
    && (e as { status: number }).status >= 400 && (e as { status: number }).status < 500
  );
}
