import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejections from async handlers — an awaited throw becomes an
 * unhandled rejection and the request hangs until it times out. Wrapping every async
 * handler here is what makes `throw HttpError.notFound()` inside a controller actually
 * reach errorHandler.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
