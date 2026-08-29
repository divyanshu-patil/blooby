import { expect, it } from 'vitest';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { validate } from './validateDto.js';
import { HttpError } from '../utils/httpError.js';

/** A request stub with only the parts this middleware touches. */
const reqOf = (part: 'body' | 'query' | 'params', value: unknown) =>
  ({ [part]: value }) as unknown as Request;

/** Runs the middleware and returns whatever it handed to next(). */
const run = (mw: ReturnType<typeof validate>, req: Request) => {
  let passed: unknown = 'not-called';
  const next: NextFunction = (e?: unknown) => { passed = e; };
  mw(req, {} as Response, next);
  return passed;
};

const Dto = z.object({ name: z.string().min(1), count: z.coerce.number().int() });

it('valid input passes through, and the raw value is replaced by the parsed one', () => {
  const req = reqOf('body', { name: 'ok', count: '7' });
  expect(run(validate(Dto), req)).toBeUndefined();
  expect(req.body).toEqual({ name: 'ok', count: 7 });
});

/**
 * The reason this middleware exists. Zod strips unknown keys, so a client cannot smuggle
 * a field the handler was never meant to accept — `role: "admin"` being the one that
 * matters. Asserted rather than trusted, because it is a silent default.
 */
it('drops unknown keys, so a payload cannot smuggle a field', () => {
  const req = reqOf('body', { name: 'ok', count: 1, role: 'admin', isAdmin: true });
  expect(run(validate(Dto), req)).toBeUndefined();
  expect(Object.keys(req.body as object).sort()).toEqual(['count', 'name']);
});

it('rejects invalid input with a 400 that names every bad field', () => {
  const err = run(validate(Dto), reqOf('body', { name: '', count: 'abc' }));
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(400);
  const fields = ((err as HttpError).details as { field: string }[]).map((d) => d.field).sort();
  expect(fields).toEqual(['count', 'name']);
});

it('rejects an absent body rather than treating it as empty', () => {
  const err = run(validate(Dto), reqOf('body', undefined));
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(400);
});

it('validates query and params, not just the body', () => {
  const q = reqOf('query', { name: 'a', count: '2' });
  expect(run(validate(Dto, 'query'), q)).toBeUndefined();
  expect(q.query).toEqual({ name: 'a', count: 2 });

  const p = reqOf('params', { name: 'a', count: 'no' });
  expect(run(validate(Dto, 'params'), p)).toBeInstanceOf(HttpError);
});
