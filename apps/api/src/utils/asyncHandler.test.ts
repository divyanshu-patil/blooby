import { expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { HttpError } from './httpError.js';

const call = async (fn: Parameters<typeof asyncHandler>[0]) => {
  let passed: unknown = 'not-called';
  asyncHandler(fn)({} as Request, {} as Response, ((e?: unknown) => { passed = e; }) as NextFunction);
  await new Promise((r) => setImmediate(r));
  return passed;
};

/**
 * Express 4 does not catch a rejection from an async handler: it becomes an unhandled
 * rejection and the request hangs until it times out. This wrapper is what makes
 * `throw HttpError.notFound()` inside a controller reach the error handler at all.
 */
it('a thrown HttpError reaches next() instead of hanging the request', async () => {
  const passed = await call(async () => { throw HttpError.notFound('gone'); });
  expect(passed instanceof HttpError).toBeTruthy();
  expect((passed as HttpError).status).toBe(404);
});

it('a rejected promise is forwarded too, whatever it rejected with', async () => {
  expect(await call(() => Promise.reject(new Error('boom'))) instanceof Error).toBe(true);
  expect(await call(() => Promise.reject('a string'))).toBe('a string');
});

it('a handler that resolves does not call next', async () => {
  expect(await call(async () => 'done')).toBe('not-called');
});
