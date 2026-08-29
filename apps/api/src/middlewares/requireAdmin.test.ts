import { expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireAdmin } from './requireAdmin.js';
import { HttpError } from '../utils/httpError.js';

const run = (user: unknown) => {
  let passed: unknown = 'not-called';
  requireAdmin({ user } as unknown as Request, {} as Response,
    ((e?: unknown) => { passed = e; }) as NextFunction);
  return passed;
};

/**
 * Hiding admin UI in the frontend is presentation, not protection — a user typing /admin
 * by hand reaches the same API, and this is what actually stops them.
 */
it('lets an admin through', () => {
  expect(run({ id: 'u1', role: 'admin' })).toBeUndefined();
});

it('refuses a signed-in non-admin with 403, not 401', () => {
  const e = run({ id: 'u1', role: 'user' });
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).status).toBe(403);
});

it('refuses an anonymous caller with 401', () => {
  expect((run(undefined) as HttpError).status).toBe(401);
});

it('is not fooled by a truthy role that is not exactly "admin"', () => {
  for (const role of ['Admin', 'ADMIN', 'administrator', 'superuser', '']) {
    expect((run({ id: 'u1', role }) as HttpError).status).toBe(403);
  }
});
