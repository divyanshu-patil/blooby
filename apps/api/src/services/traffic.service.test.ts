import { beforeEach, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();
vi.mock('../config/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }));
const { trafficService } = await import('./traffic.service.js');

beforeEach(() => queryRaw.mockReset());
const today = () => new Date(new Date().toISOString().slice(0, 10));
/** The queries run in the order they are written; each test queues one answer per query. */
const queue = (...answers: unknown[]) => answers.forEach((a) => queryRaw.mockResolvedValueOnce(a));

it('shapes page analytics, with deltas against the window before', async () => {
  queue(
    [{ day: today(), views: 10n, visitors: 4n }],
    [{ path: '/', views: 10n, visitors: 4n, signed_in: 2n }],
    [{ referrer: 'google.com', views: 3n, visitors: 2n }, { referrer: null, views: 1n, visitors: 1n }],
    [{ device: 'mobile', views: 5n }, { device: null, views: 1n }],
    [{ from_path: '/', path: '/a', views: 2n }],
    [{ views: 10n, visitors: 4n, signed_in: 1n, entries: 3n }],
    [{ views: 5n, visitors: 2n }],
  );
  const r = await trafficService.pages(2, 'web');
  expect(r.totals).toEqual({ views: 10, visitors: 4, signedInVisitors: 1, entries: 3, viewsPerVisitor: 2.5 });
  expect(r.deltas).toEqual({ views: 100, visitors: 100 });
  expect(r.series.at(-1)).toEqual({ date: today().toISOString().slice(0, 10), views: 10, visitors: 4 });
  expect(r.referrers.map((x) => x.source)).toEqual(['google.com', 'direct']);
  expect(r.devices.map((x) => x.device)).toEqual(['mobile', 'unknown']);
  expect(r.flows).toEqual([{ from: '/', to: '/a', views: 2 }]);
  expect(r.topPages[0]).toMatchObject({ signedIn: 2 });
});

it('answers an empty window with zeros and no delta', async () => {
  queue([], [], [], [], [], [], []);
  const r = await trafficService.pages(1, 'admin');
  expect(r.totals).toEqual({ views: 0, visitors: 0, signedInVisitors: 0, entries: 0, viewsPerVisitor: 0 });
  expect(r.deltas).toEqual({ views: null, visitors: null });
});

it('shapes MCP usage: totals, error rate, who is connected, and what happened recently', async () => {
  queue(
    [{ calls: 10n, people: 2n, failed: 1n, p50: 12.4, p95: 99.6, projects: 3n }],
    [{ calls: 5n, people: 1n }],
    [{ day: today(), calls: 10n, people: 2n, failed: 1n }],
    [{ name: 'Claude', installs: 2n, calls: 10n, people: 2n, failed: 1n, last_at: new Date(0) }],
    [{ operation: 'x', calls: 10n, people: 2n, failed: 1n, avg_ms: 5.5 }, { operation: 'y', calls: 1n, people: 1n, failed: 0n, avg_ms: null }],
    [{ error_code: 'bad', calls: 1n }],
    [{ kind: 'access', people: 2n, credentials: 3n }, { kind: 'pat', people: 1n, credentials: 1n }],
    [{ operation: 'x', ok: false, error_code: 'bad', duration_ms: 3, client_name: null, created_at: new Date(0) }, { operation: 'y', ok: true, error_code: null, duration_ms: null, client_name: 'Claude', created_at: new Date(0) }],
  );
  const r = await trafficService.mcp(2);
  expect(r.totals).toMatchObject({ calls: 10, errorRate: 10, p50Ms: 12, p95Ms: 100, connectedPeople: 3, oauthGrants: 3, personalTokens: 1 });
  expect(r.deltas).toEqual({ calls: 100, people: 100 });
  expect(r.capabilities.map((c) => c.avgMs)).toEqual([6, 0]);
  expect(r.recent.map((c) => c.client)).toEqual(['Personal access token', 'Claude']);
});

it('answers an MCP window with no calls and nothing connected', async () => {
  queue([], [], [], [], [], [], [], []);
  const r = await trafficService.mcp(1);
  expect(r.totals).toMatchObject({ calls: 0, errorRate: 0, connectedPeople: 0, p95Ms: 0 });
  expect(r.deltas).toEqual({ calls: null, people: null });
});

it('reads a null count as zero', async () => {
  queue([], [], [], [], [], [{ views: null, visitors: null, signed_in: null, entries: null }], [{ views: null, visitors: null }]);
  expect((await trafficService.pages(1, 'web')).totals.views).toBe(0);
});
