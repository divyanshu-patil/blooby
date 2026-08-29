import { beforeEach, expect, it, vi } from 'vitest';
import type { HttpError as HttpErrorType } from '../utils/httpError.js';
import type { NextFunction, Request, Response } from 'express';

const findUnique = vi.fn();
const verifyImpl = vi.fn();

vi.mock('../config/prisma.js', () => ({ prisma: { profile: { findUnique } } }));
vi.mock('jwks-rsa', () => ({ JwksClient: class { getSigningKey() { /* unused */ } } }));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: (token: string, _key: unknown, _opts: unknown, cb: (e: unknown, d?: unknown) => void) => {
      try { cb(null, verifyImpl(token)); } catch (e) { cb(e); }
    },
  },
}));

const { authenticate, optionalAuth } = await import('./authenticate.js');
const { HttpError } = await import('../utils/httpError.js');

const req = (auth?: string) =>
  ({ headers: auth ? { authorization: auth } : {} }) as unknown as Request;

const run = async (fn: typeof authenticate, r: Request) => {
  let passed: unknown = 'not-called';
  await fn(r, {} as Response, ((e?: unknown) => { passed = e; }) as NextFunction);
  return passed;
};

beforeEach(() => { findUnique.mockReset(); verifyImpl.mockReset(); });

it('rejects a request with no bearer token', async () => {
  expect(await run(authenticate, req())).toBeInstanceOf(HttpError);
  expect((await run(authenticate, req()) as HttpErrorType).status).toBe(401);
});

it('ignores an Authorization header that is not a bearer token', async () => {
  for (const header of ['Basic abc', 'bearer lowercase', 'Bearer', 'token abc']) {
    expect((await run(authenticate, req(header)) as HttpErrorType).status, header).toBe(401);
  }
});

it('rejects a token that does not verify', async () => {
  verifyImpl.mockImplementation(() => { throw new Error('bad signature'); });
  expect((await run(authenticate, req('Bearer x')) as HttpErrorType).status).toBe(401);
  expect(findUnique, 'must not reach the database on a bad token').not.toHaveBeenCalled();
});

it('rejects a verified token with no subject', async () => {
  verifyImpl.mockReturnValue({ email: 'a@b.c' });
  expect((await run(authenticate, req('Bearer x')) as HttpErrorType).status).toBe(401);
});

it('rejects a valid token with no profile behind it', async () => {
  verifyImpl.mockReturnValue({ sub: 'u1' });
  findUnique.mockResolvedValue(null);
  expect((await run(authenticate, req('Bearer x')) as HttpErrorType).status).toBe(401);
});

/**
 * The role comes from the database, not from a JWT claim: app_metadata is only as
 * trustworthy as every code path that can write it, whereas public.profiles has no
 * insert/update policy for anon or authenticated at all.
 */
it('takes the role from the profile and ignores any role claimed in the token', async () => {
  verifyImpl.mockReturnValue({ sub: 'u1', email: 'a@b.c', role: 'admin', app_metadata: { role: 'admin' } });
  findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
  const r = req('Bearer x');
  expect(await run(authenticate, r)).toBeUndefined();
  expect(r.user).toEqual({ id: 'u1', email: 'a@b.c', role: 'user' });
});

it('looks the profile up by the token subject, not by anything the caller sent', async () => {
  verifyImpl.mockReturnValue({ sub: 'u-from-token' });
  findUnique.mockResolvedValue({ id: 'u-from-token', role: 'user' });
  await run(authenticate, req('Bearer x'));
  expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u-from-token' } });
});

it('carries a null email when the token has none', async () => {
  verifyImpl.mockReturnValue({ sub: 'u1' });
  findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
  const r = req('Bearer x');
  await run(authenticate, r);
  expect(r.user?.email).toBeNull();
});

/* ---- optionalAuth ------------------------------------------------------------- */

it('optionalAuth lets an anonymous caller straight through', async () => {
  const r = req();
  expect(await run(optionalAuth, r)).toBeUndefined();
  expect(r.user).toBeUndefined();
});

it('optionalAuth still rejects a token that is present but bad', async () => {
  verifyImpl.mockImplementation(() => { throw new Error('nope'); });
  expect((await run(optionalAuth, req('Bearer x')) as HttpErrorType).status).toBe(401);
});
