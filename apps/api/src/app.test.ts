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
  // `redis: 'off'` is the healthy answer with no REDIS_URL — the endpoint reports the
  // dependency so a misconfigured Key Value instance is visible without host access
  expect(await res.json()).toEqual({ ok: true, env: 'test', redis: 'off' });
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

/**
 * Rate limits are per caller, not per address.
 *
 * Keyed on the address, everyone behind one NAT — or, once a load balancer is in front,
 * every user of the deployment — shares a single bucket, and one busy editor locks out
 * everybody else.
 */
const remaining = (res: Response) => Number(/remaining=(\d+)/.exec(res.headers.get('ratelimit') ?? '')?.[1] ?? NaN);
const hit = (headers: Record<string, string> = {}) => fetch(`${base}/health`, { headers });

it('counts each signed-in caller separately, from the same address', async () => {
  const ann = await hit({ Authorization: 'Bearer ann-token' }).then(remaining);
  const bob = await hit({ Authorization: 'Bearer bob-token' }).then(remaining);
  const annAgain = await hit({ Authorization: 'Bearer ann-token' }).then(remaining);
  expect(bob).toBe(ann);            // Bob's first request starts his own budget
  expect(annAgain).toBe(ann - 1);   // Ann's second spends only hers
});

it('never puts a token in the limiter key', async () => {
  const res = await hit({ Authorization: 'Bearer super-secret-token' });
  expect(res.headers.get('ratelimit')).not.toContain('super-secret-token');
});

/** With no proxy trusted, a forged X-Forwarded-For must not buy a fresh bucket. */
it('ignores a forged forwarding header when no proxy is trusted', async () => {
  const first = await hit({ 'X-Forwarded-For': '9.9.9.9' }).then(remaining);
  const second = await hit({ 'X-Forwarded-For': '8.8.8.8' }).then(remaining);
  expect(second).toBe(first - 1);
});

/** The MCP endpoint answers AI agents under its own per-token limit, not this one. */
it('does not spend the app budget on MCP traffic', async () => {
  const before = await hit().then(remaining);
  await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const after = await hit().then(remaining);
  expect(after).toBe(before - 1);   // only the two /health calls counted
});

/** The editor polls this while an AI works; it must not be able to exhaust the budget. */
it('leaves room for the editor polling for AI activity', async () => {
  const pollsPerMinute = 30;        // useMcpLive: every 2s while an agent is active
  const budget = Number(/limit=(\d+)/.exec((await hit()).headers.get('ratelimit') ?? '')?.[1]);
  expect(budget).toBeGreaterThan(pollsPerMinute * 4);
});
