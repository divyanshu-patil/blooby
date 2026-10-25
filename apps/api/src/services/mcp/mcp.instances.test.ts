import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * The MCP server as a serverless host runs it: TWO instances of the API — two copies of every
 * module, each with its own memory, its own cached sessions, its own editor store — sharing
 * nothing but the database, storage and Redis. One agent's calls alternate between them, the
 * way Vercel routes them. Everything an agent relies on between calls must survive that.
 */

const db = {
  projects: new Map<string, Record<string, any>>(),
  objects: new Map<string, string>(),
  tokens: new Map<string, Record<string, any>>(),
  assets: new Map<string, Record<string, any>>(),
};
const now = () => new Date();

// one Redis both instances talk to: the commands sharedState and the limiters use
const kv = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const redis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: string) => { kv.set(k, v); return 'OK'; },
  del: async (k: string) => Number(kv.delete(k)),
  hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
  hdel: async (k: string, f: string) => Number(hashes.get(k)?.delete(f) ?? 0),
  hvals: async (k: string) => [...(hashes.get(k)?.values() ?? [])],
  multi: () => {
    const ops: (() => void)[] = [];
    const m = {
      hset: (k: string, f: string, v: string) => { ops.push(() => { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k)!.set(f, v); }); return m; },
      expire: () => m,
      exec: async () => ops.map((o) => o()),
    };
    return m;
  },
  publish: async () => 0,
  // the rate limiters' scripts: refused, and passOnStoreError lets the request through
  call: async () => { throw new Error('no scripts in this fake'); },
};
vi.mock('../../config/redis.js', () => ({ redis, redisSub: null, hasRedis: () => true, redisStatus: async () => 'up' }));

vi.mock('../../config/prisma.js', () => ({ prisma: { asset: { findMany: async () => [] } } }));
vi.mock('../../repositories/projects.repository.js', () => ({
  page: <T>(rows: T[], limit: number) => ({ items: rows.slice(0, limit), nextCursor: null }),
  projectsRepository: {
    findById: async (id: string) => (db.projects.has(id) ? { ...db.projects.get(id) } : null),
    listByUser: async (userId: string, o: { limit: number }) => ({ items: [...db.projects.values()].filter((p) => p.userId === userId).slice(0, o.limit), nextCursor: null }),
    create: async (data: Record<string, any>) => {
      const row = { id: randomUUID(), currentVersion: 1, visibility: 'private', access: 'view', thumbnailUrl: null, createdAt: now(), updatedAt: now(), ...data };
      db.projects.set(row.id, row);
      return row;
    },
    update: async (id: string, data: Record<string, any>) => Object.assign(db.projects.get(id)!, data, { updatedAt: now() }),
    bumpVersionIfCurrent: async (id: string, expected: number, data: Record<string, any>) => {
      const p = db.projects.get(id);
      if (!p || p.currentVersion !== expected) return 0;
      Object.assign(p, data);
      return 1;
    },
    countView: async () => {},
  },
}));
vi.mock('../storage.service.js', () => ({
  putProjectJson: async (userId: string, projectId: string, project: unknown) => {
    const key = `users/${userId}/projects/${projectId}/project.json`;
    db.objects.set(key, JSON.stringify(project));
    return { key, bucket: 'test', sizeBytes: 1, checksum: 'x' };
  },
  getProjectJson: async (key: string) => JSON.parse(db.objects.get(key) ?? '{}'),
  putExport: async (_u: string, jobId: string, filename: string, bytes: Buffer) => {
    const url = `https://s3.test/${jobId}/${filename}`;
    db.objects.set(url, bytes.toString('utf8'));
    return { key: url, url };
  },
  presignedReadUrl: async (key: string) => `https://s3.test/${key}`,
}));
vi.mock('../../repositories/mcp.repository.js', () => ({
  mcpRepository: {
    tokenByHash: async (h: string) => [...db.tokens.values()].find((t) => t.tokenHash === h) ?? null,
    createToken: async (d: Record<string, any>) => {
      const t = { id: randomUUID(), name: '', scopes: [], mode: 'full', createdAt: now(), revokedAt: null, lastUsedAt: null, expiresAt: null, grantId: null, clientId: null, ...d };
      db.tokens.set(t.id, t);
      return t;
    },
    updateToken: async (id: string, d: Record<string, any>) => Object.assign(db.tokens.get(id)!, d),
    audit: async () => {},
  },
}));
vi.mock('../../middlewares/authenticate.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const id = /^Bearer user:(.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!id) return next(Object.assign(new Error('Sign in'), { status: 401 }));
    req.user = { id, email: null, role: 'user' };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// storage, as a download link reaches it
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u);
  if (!url.startsWith('https://s3.test/')) return realFetch(u, init);
  return db.objects.has(url) ? new Response(db.objects.get(url)) : new Response('', { status: 404 });
}) as typeof fetch;

/** A whole copy of the API: fresh module instances, so nothing is shared but the fakes above. */
async function instance() {
  vi.resetModules();
  const { createApp } = await import('../../app.js');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, tokens: (await import('./auth.service.js')).tokensService };
}

const ANN = 'a1000000-0000-4000-8000-000000000001';
let a: Awaited<ReturnType<typeof instance>>;
let b: Awaited<ReturnType<typeof instance>>;
const servers: Server[] = [];
beforeAll(async () => {
  a = await instance();
  b = await instance();
  servers.push(a.server, b.server);
}, 60_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
});

/** One JSON-RPC tools/call, as a stateless client sends it — to whichever instance it lands on. */
async function call(on: { base: string }, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await realFetch(`${on.base}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const msg = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice(6));
  const content = msg.result.content as { type: string; text?: string; resource?: { text?: string } }[];
  return { body: JSON.parse(content.find((x) => x.type === 'text')!.text!), resource: content.find((x) => x.type === 'resource')?.resource };
}

it('an agent whose calls alternate between two instances works as if there were one', async () => {
  const { token } = await a.tokens.createPat(ANN, { name: 'serverless' });

  // A opens it; B is asked to edit "the open project" — and knows which one, and has the document
  const created = await call(a, token, 'project_create', { name: 'Two instances' });
  const pid = created.body.result.projectId as string;
  const added = await call(b, token, 'add_layer', { type: 'shape', shape: 'star', name: 'from B' });
  expect(added.body.ok, JSON.stringify(added.body)).toBe(true);
  expect(added.body.warnings ?? []).toEqual([]);

  // A sees B's edit, silently: a save by the AI itself, through another instance, is not news
  const state = await call(a, token, 'editor_get_state', { level: 'standard' });
  expect(state.body.result.layers.some((l: { name: string }) => l.name === 'from B')).toBe(true);
  expect(state.body.warnings ?? []).toEqual([]);
  await call(a, token, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 12 });
  const back = await call(b, token, 'inspector_get', { nodeId: 'body' });
  expect(JSON.stringify(back.body.result)).toContain('12');

  // an export made on B is answered on A — its file fetched back from storage
  const exported = await call(b, token, 'export_start', { format: 'svg', atMs: 0 });
  const jobId = exported.body.result.jobId as string;
  expect((await call(a, token, 'job_get', { jobId })).body.result.status).toBe('done');
  expect((await call(a, token, 'job_result', { jobId })).resource?.text).toContain('<svg');
  expect((await call(a, token, 'job_list')).body.result.map((j: { jobId: string }) => j.jobId)).toContain(jobId);

  // the run is one record across both
  const run = await call(b, token, 'run_get');
  expect(run.body.result.operations.map((o: { capability: string }) => o.capability)).toEqual(expect.arrayContaining(['project_create', 'add_layer', 'editor_get_state', 'export_start', 'job_get']));
  expect(run.body.result.projects).toEqual([pid]);

  // the editor polls whichever instance it reaches, and sees the AI at work on the other
  const live = await realFetch(`${b.base}/api/mcp/live?projectId=${pid}`, { headers: { Authorization: `Bearer user:${ANN}` } }).then((r) => r.json()) as { projects: { version: number; unsaved: boolean; agents: unknown[]; activity: { capability: string }[] }[] };
  expect(live.projects[0]!.agents.length).toBe(1);
  expect(live.projects[0]!.unsaved).toBe(false);
  expect(live.projects[0]!.version).toBe(db.projects.get(pid)!.currentVersion);
  expect(live.projects[0]!.activity.map((x) => x.capability)).toContain('set_property');

  // closing on B closes it for A too
  await call(b, token, 'project_close');
  expect((await call(a, token, 'project_current')).body.result.projectId).toBeNull();
}, 60_000);

it('"ask me first": proposed on one instance, approved in the editor through the other', async () => {
  const { token } = await a.tokens.createPat(ANN, { name: 'careful', mode: 'suggest' });
  const full = (await a.tokens.createPat(ANN, { name: 'setup' })).token;
  const pid = (await call(a, full, 'project_create', { name: 'Ask first' })).body.result.projectId as string;

  const asked = await call(a, token, 'add_layer', { type: 'shape', shape: 'heart', name: 'love' });
  const proposalId = asked.body.result.proposalId as string;
  const person = { Authorization: `Bearer user:${ANN}`, 'content-type': 'application/json' };
  const live = await realFetch(`${b.base}/api/mcp/live?projectId=${pid}`, { headers: person }).then((r) => r.json()) as { proposals: { id: string }[] };
  expect(live.proposals.map((p) => p.id)).toContain(proposalId);
  const decided = await realFetch(`${b.base}/api/mcp/proposals/${proposalId}`, { method: 'POST', headers: person, body: JSON.stringify({ approve: true }) }).then((r) => r.json()) as { status: string };
  expect(decided.status).toBe('applied');

  expect((await call(a, token, 'proposal_get', { proposalId })).body.result.status).toBe('applied');
  const state = await call(a, token, 'editor_get_state', { level: 'standard' });
  expect(state.body.result.layers.some((l: { name: string }) => l.name === 'love')).toBe(true);
}, 60_000);
