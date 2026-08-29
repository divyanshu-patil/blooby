import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// the routers reach Postgres through repositories; this test is about the app's own
// wiring — CORS, the JSON contract, the 404 path and the error envelope
vi.mock('./config/prisma.js', () => ({ prisma: {} }));

const { createApp } = await import('./app.js');

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(undefined))));

it('answers /health without any authentication', async () => {
  const res = await fetch(`${base}/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, env: 'test' });
});

it('turns an unmatched path into the same error envelope every route uses', async () => {
  const res = await fetch(`${base}/api/nothing-here`);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ code: 'not_found' });
});

it('does not advertise the framework', async () => {
  expect((await fetch(`${base}/health`)).headers.get('x-powered-by')).toBeNull();
});

/** Only the configured app origins may call this API from a browser. */
it('allows the configured origins and no others', async () => {
  const allowed = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:5173' } });
  expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

  const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  expect(evil.headers.get('access-control-allow-origin')).toBeNull();
});

it('rejects a body that is not JSON with a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json',
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
});

/**
 * Postgres bigint columns arrive as JS BigInt, which JSON.stringify throws on. The app
 * sets a replacer once so a route added later cannot forget it.
 */
it('serialises a bigint instead of throwing on it', () => {
  const replacer = createApp().get('json replacer') as (k: string, v: unknown) => unknown;
  expect(replacer('size', 42n)).toBe(42);
  expect(replacer('name', 'left alone')).toBe('left alone');
  expect(JSON.stringify({ size: 9007199254740993n }, replacer)).toBe('{"size":9007199254740992}');
});

it('says a payload is too large rather than blaming itself', async () => {
  const res = await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: 'x'.repeat(9 * 1024 * 1024) }),
  });
  expect(res.status).toBe(413);
  expect(await res.json()).toMatchObject({ code: 'payload_too_large' });
});
