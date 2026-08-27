import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from '../utils/httpError.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validate one part of the request against a schema and REPLACE it with the parsed
 * result, so downstream code sees coerced, stripped, fully typed data — never the raw
 * input. Unknown keys are dropped by Zod's default object behaviour, which is what stops
 * a client from smuggling `role: "admin"` into an update payload.
 */
export const validate =
  <T>(schema: ZodType<T>, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        HttpError.badRequest(
          'Some of the submitted values are not valid.',
          result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        ),
      );
    }
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
