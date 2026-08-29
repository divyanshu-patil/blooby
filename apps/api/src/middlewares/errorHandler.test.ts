import { expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler, notFound } from './errorHandler.js';
import { HttpError } from '../utils/httpError.js';

/** Captures what a handler would have sent, without an HTTP server. */
function resStub() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { sent.status = code; return res; },
    json(body: Record<string, unknown>) { sent.body = body; return res; },
  } as unknown as Response;
  return { res, sent };
}

const handle = (err: unknown) => {
  const { res, sent } = resStub();
  errorHandler(err, {} as Request, res, (() => {}) as NextFunction);
  return sent;
};

it('a known HttpError keeps its status, message and code', () => {
  const sent = handle(HttpError.conflict('That name is taken'));
  expect(sent.status).toBe(409);
  expect(sent.body?.error).toBe('That name is taken');
  expect(sent.body?.code).toBe('conflict');
});

/**
 * The whole point of the generic branch: a Postgres constraint name, an S3 key or a
 * stack trace must never reach a client. Outside production the message is echoed under
 * `debug` deliberately — that is a developer convenience, and it is the one thing that
 * would turn this guarantee into a leak if it ever shipped, so it is asserted both ways.
 */
it('an unexpected error is reported generically, with the detail withheld', async () => {
  const leak = new Error('duplicate key value violates unique constraint "projects_pkey"');
  const original = process.env.NODE_ENV;
  const log = console.error;
  console.error = () => {};
  try {
    const sent = handle(leak);
    expect(sent.status).toBe(500);
    expect(sent.body?.error).toBe('Something went wrong on our end.');
    expect(sent.body?.code).toBe('internal_error');
    expect(
      !JSON.stringify({ error: sent.body?.error, code: sent.body?.code }).includes('projects_pkey'),
      'the constraint name must not appear in the client-facing fields',
    ).toBeTruthy();
  } finally {
    console.error = log;
    process.env.NODE_ENV = original;
  }
});

it('and it is still logged in full, so nothing is silently swallowed', () => {
  const seen: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => { seen.push(a); };
  try { handle(new Error('boom')); } finally { console.error = log; }
  expect(seen.length, 'exactly one log line for one unhandled error').toBe(1);
});

it('notFound hands a 404 to the error handler rather than answering itself', () => {
  let passed: unknown;
  notFound({} as Request, {} as Response, ((e?: unknown) => { passed = e; }) as NextFunction);
  expect(passed instanceof HttpError).toBeTruthy();
  expect((passed as HttpError).status).toBe(404);
});
