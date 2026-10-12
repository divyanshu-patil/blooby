import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * The MCP server end to end, the way a real AI client meets it: an HTTP server on a port,
 * the official SDK client, OAuth 2.1 with dynamic registration and PKCE, then an agent's
 * workflow through tools only — never the internals. Postgres and S3 are in-memory fakes
 * at the repository boundary; everything above them is the real code.
 */

// --- in-memory storage ---------------------------------------------------------------------
const db = {
  projects: new Map<string, Record<string, any>>(),
  objects: new Map<string, string>(),
  tokens: new Map<string, Record<string, any>>(),
  clients: new Map<string, Record<string, any>>(),
  assets: new Map<string, Record<string, any>>(),
  audit: [] as Record<string, any>[],
};
const now = () => new Date();

vi.mock('../../config/prisma.js', () => ({
  prisma: {
    asset: {
      findMany: async ({ where }: { where: { OR: [unknown, { ownerId: string }] } }) =>
        [...db.assets.values()].filter((a) => a.status === 'published' || a.ownerId === where.OR[1].ownerId),
    },
  },
}));

vi.mock('../../repositories/projects.repository.js', () => ({
  page: <T extends { id: string }>(rows: T[], limit: number) => ({ items: rows.slice(0, limit), nextCursor: null }),
  projectsRepository: {
    findById: async (id: string) => db.projects.get(id) ?? null,
    listByUser: async (userId: string, o: { q?: string; limit: number }) => ({
      items: [...db.projects.values()].filter((p) => p.userId === userId && (!o.q || p.name.toLowerCase().includes(o.q.toLowerCase()))).slice(0, o.limit),
      nextCursor: null,
    }),
    create: async (data: Record<string, any>) => {
      const row = { id: randomUUID(), currentVersion: 1, visibility: 'private', access: 'view', thumbnailUrl: null, createdAt: now(), updatedAt: now(), ...data };
      db.projects.set(row.id, row);
      return row;
    },
    update: async (id: string, data: Record<string, any>) => Object.assign(db.projects.get(id)!, data, { updatedAt: now() }),
    delete: async (id: string) => { db.projects.delete(id); },
    bumpVersionIfCurrent: async (id: string, expected: number, data: Record<string, any>) => {
      const p = db.projects.get(id);
      if (!p || p.currentVersion !== expected) return 0;
      Object.assign(p, data);
      return 1;
    },
    countDuplicate: async () => {}, countView: async () => {},
  },
}));

vi.mock('../storage.service.js', () => ({
  putProjectJson: async (userId: string, projectId: string, project: unknown) => {
    const key = `users/${userId}/projects/${projectId}/project.json`;
    db.objects.set(key, JSON.stringify(project));
    return { key, bucket: 'test', sizeBytes: 1, checksum: 'x' };
  },
  getProjectJson: async (key: string) => JSON.parse(db.objects.get(key) ?? '{}'),
  deleteProjectObjects: async () => {},
  putExport: vi.fn(async (userId: string, jobId: string, filename: string) => ({ key: `${userId}/${jobId}/${filename}`, url: `https://s3.test/${jobId}/${filename}` })),
  presignedReadUrl: async (key: string) => `https://s3.test/${key}`,
}));

vi.mock('../../repositories/assets.repository.js', () => ({
  assetsRepository: {
    findById: async (id: string) => db.assets.get(id) ?? null,
    create: async (data: Record<string, any>) => { const a = { id: randomUUID(), version: 1, createdAt: now(), ...data }; db.assets.set(a.id, a); return a; },
    update: async (id: string, data: Record<string, any>) => {
      const a = db.assets.get(id)!;
      const { version, ...rest } = data;
      return Object.assign(a, rest, version ? { version: a.version + 1 } : {});
    },
    delete: async (id: string) => { db.assets.delete(id); },
  },
}));

vi.mock('../../repositories/mcp.repository.js', () => {
  const live = (t: Record<string, any>) => !t.revokedAt;
  return {
    mcpRepository: {
      client: async (id: string) => db.clients.get(id) ?? null,
      createClient: async (d: Record<string, any>) => { const c = { createdAt: now(), lastUsedAt: null, metadata: {}, ...d }; db.clients.set(d.clientId, c); return c; },
      touchClient: async () => {},
      clientsByIds: async (ids: string[]) => ids.flatMap((i) => (db.clients.has(i) ? [db.clients.get(i)!] : [])),
      tokenByHash: async (h: string) => [...db.tokens.values()].find((t) => t.tokenHash === h) ?? null,
      tokenById: async (id: string) => db.tokens.get(id) ?? null,
      createToken: async (d: Record<string, any>) => {
        const t = { id: randomUUID(), name: '', scopes: [], mode: 'full', createdAt: now(), revokedAt: null, lastUsedAt: null, expiresAt: null, grantId: null, clientId: null, ...d };
        db.tokens.set(t.id, t);
        return t;
      },
      updateToken: async (id: string, d: Record<string, any>) => Object.assign(db.tokens.get(id)!, d),
      spend: async (id: string) => { const t = db.tokens.get(id); if (!t || !live(t)) return 0; t.revokedAt = now(); return 1; },
      revokeGrant: async (g: string) => { for (const t of db.tokens.values()) if (t.grantId === g && live(t)) t.revokedAt = now(); },
      revokeGrantOf: async (g: string, u: string) => { let n = 0; for (const t of db.tokens.values()) if (t.grantId === g && t.userId === u && live(t)) { t.revokedAt = now(); n++; } return n; },
      liveCredentials: async (u: string) => [...db.tokens.values()].filter((t) => t.userId === u && ['pat', 'access', 'refresh'].includes(t.kind) && live(t)),
      audit: async (d: Record<string, any>) => { db.audit.push(d); },
      recentAudit: async (u: string) => db.audit.filter((a) => a.userId === u).slice(-40).reverse(),
    },
  };
});

// the person's own session (Supabase JWT in real life): "Bearer user:<id>"
vi.mock('../../middlewares/authenticate.js', () => {
  const who = (req: any) => /^Bearer user:(.+)$/.exec(req.headers.authorization ?? '')?.[1];
  return {
    authenticate: (req: any, _res: any, next: any) => {
      const id = who(req);
      if (!id) return next(Object.assign(new Error('Sign in'), { status: 401 }));
      req.user = { id, email: null, role: 'user' };
      next();
    },
    optionalAuth: (req: any, _res: any, next: any) => { const id = who(req); if (id) req.user = { id, email: null, role: 'user' }; next(); },
  };
});

// the modules sweep stale state on setInterval(...).unref(); keep the callbacks so a test can
// run a sweep on demand instead of waiting a minute for it
const sweeps: (() => void)[] = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((f: () => void, ms?: number) => { sweeps.push(f); return realSetInterval(f, ms); }) as typeof setInterval;
const { createApp } = await import('../../app.js');
globalThis.setInterval = realSetInterval;
const { tokensService } = await import('./auth.service.js');
const { projectsService } = await import('../projects.service.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => { server.closeAllConnections(); server.close(() => r(undefined)); }));

const ANN = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
// a third person, so this file's earlier tests leave them nothing open
const CARL = 'c0000000-0000-4000-8000-000000000003';

type ToolResult = { content: { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri: string; mimeType: string; text?: string } }[]; isError?: boolean };
async function connect(token: string, query = '') {
  const c = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp${query}`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}
async function call(c: InstanceType<typeof Client>, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as ToolResult;
  const body = JSON.parse(r.content.find((x) => x.type === 'text')!.text!);
  return { r, body, image: r.content.find((x) => x.type === 'image'), resource: r.content.find((x) => x.type === 'resource')?.resource };
}

/** The OAuth dance a connector does: register, authorize (PKCE), consent as the person, token. */
async function oauth(userId: string, o: { scopes?: string[]; mode?: string; approve?: boolean } = {}) {
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await fetch(`${base}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  }).then((r) => r.json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: (o.scopes ?? ['project:read', 'project:write', 'preset:read', 'preset:write', 'render:read', 'export:write']).join(' ') });
  const auth = await fetch(`${base}/authorize?${q}`, { redirect: 'manual' });
  const consentUrl = new URL(auth.headers.get('location')!);
  const requestId = consentUrl.searchParams.get('request')!;
  const person = { Authorization: `Bearer user:${userId}`, 'content-type': 'application/json' };
  const described = await fetch(`${base}/api/mcp/consent/${requestId}`, { headers: person }).then((r) => r.json()) as { clientName: string };
  const decided = await fetch(`${base}/api/mcp/consent/${requestId}`, { method: 'POST', headers: person, body: JSON.stringify({ approve: o.approve ?? true, mode: o.mode ?? 'full' }) }).then((r) => r.json()) as { redirectTo: string };
  const back = new URL(decided.redirectTo);
  if (!back.searchParams.get('code')) return { consentUrl, described, back, token: null as null | { access_token: string; refresh_token: string }, clientId: reg.client_id };
  const token = await fetch(`${base}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect }),
  }).then((r) => r.json()) as { access_token: string; refresh_token: string };
  return { consentUrl, described, back, token, clientId: reg.client_id };
}

it('refuses an unauthenticated client, and says where to authorize', async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(401);
  expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
  const meta = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json()) as { registration_endpoint: string; code_challenge_methods_supported: string[]; scopes_supported: string[] };
  expect(meta.registration_endpoint).toBeTruthy();
  expect(meta.code_challenge_methods_supported).toContain('S256');
  expect(meta.scopes_supported).toContain('render:read');
});

it('lets a person decline, and the client gets access_denied', async () => {
  const r = await oauth(ANN, { approve: false });
  expect(r.back.searchParams.get('error')).toBe('access_denied');
  expect(r.back.searchParams.get('state')).toBe('st8');
});

it('runs a whole agent workflow through MCP alone', async () => {
  // 1. authenticate: OAuth, the way Claude.ai / ChatGPT connect
  const { consentUrl, described, back, token } = await oauth(ANN);
  expect(consentUrl.pathname).toBe('/connect');
  expect(described.clientName).toBe('Claude');
  expect(back.searchParams.get('state')).toBe('st8');
  expect(token!.access_token).toMatch(/^blb_at_/);
  expect([...db.tokens.values()].some((t) => JSON.stringify(t).includes(token!.access_token))).toBe(false);   // hashes only

  const c = await connect(token!.access_token);
  const tools = (await c.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(['project_create', 'add_keyframe', 'render_frame', 'invoke', 'export_start', 'preset_save']));
  expect(c.getInstructions()).toContain('guide_get');
  // the ceilings are told at connect, not discovered by being refused
  expect(c.getInstructions()).toMatch(/300 renders|300 calls/);
  expect(c.getInstructions()).toContain('batch_execute');

  // 2. create a project
  const created = await call(c, 'project_create', { name: 'Happy entrance' });
  expect(created.body.ok).toBe(true);
  const projectId = created.body.result.projectId as string;
  /**
   * GIF and MP4 are encoded in the person's browser, and an AI client cannot show them the
   * animation moving at all. The link is the one thing it can hand over that does.
   */
  expect(created.body.result.url).toContain(`/projects/${projectId}`);
  expect((await call(c, 'project_current', {})).body.result.url).toContain(projectId);
  expect((await call(c, 'project_list', {})).body.result.projects[0].url).toContain('/projects/');
  expect((await call(c, 'export_formats', {})).body.result.notSupportedHere).toMatch(/url|editor/i);

  // 3. composition
  expect((await call(c, 'set_composition', { width: 1080, height: 1080 })).body.ok).toBe(true);
  // 4. a second mascot, 5. layers
  expect((await call(c, 'add_mascot', { name: 'Pip' })).body.created.some((e: { type: string }) => e.type === 'layer')).toBe(true);
  await call(c, 'add_layer', { type: 'shape', shape: 'star', name: 'spark', x: 200, y: -200 });
  await call(c, 'add_text', { content: 'HELLO', y: 300 });

  // 6-8. animation, keyframes, easing — in a transaction
  await call(c, 'transaction_begin', { label: 'jump' });
  const jump = await call(c, 'batch_execute', { calls: [
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 300, value: 0 } },
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 600, value: -140, easing: 'easeOut' } },
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 900, value: 0, easing: 'easeIn' } },
    { capability: 'apply_squish_preset', args: { nodeId: 'body', preset: 'Landing Squash', atMs: 900 } },
  ] });
  expect(jump.body.ok, JSON.stringify(jump.body)).toBe(true);
  await call(c, 'transaction_commit');
  const tl = await call(c, 'timeline_get', { nodeId: 'body', property: 'flatOffset.y' });
  const track = tl.body.result.tracks[0];
  expect(track.keyframes.map((k: { atMs: number }) => k.atMs)).toEqual(expect.arrayContaining([300, 600, 900]));
  const eased = await call(c, 'invoke', { capability: 'editor_set_easing', args: { trackId: track.id, kfId: track.keyframes[0].id, easing: { type: 'preset', name: 'easeInOut' } } });
  expect(eased.body.ok).toBe(true);

  // 9. playhead, 10. render the current frame: a real PNG
  await call(c, 'playhead_set', { atMs: 600 });
  const frame = await call(c, 'render_frame', { quality: 'preview' });
  expect(frame.image?.mimeType).toBe('image/png');
  expect(Buffer.from(frame.image!.data!, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(frame.body.result.atMs).toBe(600);

  // 11. inspect: the body is up at the top of the jump
  const ev = await call(c, 'evaluate', { times: [300, 600], nodeIds: ['body'] });
  expect(ev.body.result.frames['600ms'].body[1]).toBeLessThan(ev.body.result.frames['300ms'].body[1]);

  // 12. modify, 13. render again (a contact sheet this time)
  expect((await call(c, 'move_keyframe', { nodeId: 'body', property: 'flatOffset.y', fromMs: 600, toMs: 650 })).body.ok).toBe(true);
  const sheet = await call(c, 'render_sequence', { fromMs: 0, toMs: 1200, frames: 6 });
  expect(sheet.image?.mimeType).toBe('image/png');
  const review = await call(c, 'critique', { request: 'Blooby jumps' });
  expect(Array.isArray(review.body.result.notes)).toBe(true);

  // 14. save — and the cloud copy really holds the animation
  const saved = await call(c, 'project_save');
  expect(saved.body.ok).toBe(true);
  const stored = JSON.parse(db.objects.get(db.projects.get(projectId)!.s3Key)!);
  expect(JSON.stringify(stored)).toContain('flatOffset.y');

  // 15-17. save as a preset, read it back, change it
  const preset = await call(c, 'preset_save', { name: 'Happy Entrance', description: 'Jumps in and lands' });
  const assetId = preset.body.result.assetId as string;
  expect(db.assets.get(assetId)?.ownerId).toBe(ANN);
  const read = await call(c, 'preset_get', { preset: assetId });
  expect(read.body.result.tracks.length).toBeGreaterThan(0);
  expect((await call(c, 'preset_update', { assetId, description: 'Jumps in, lands, settles' })).body.ok).toBe(true);
  const builtin = await call(c, 'preset_search', { query: 'wave hand' });
  expect(builtin.body.result.length).toBeGreaterThan(0);

  // 18. apply it in another project
  await call(c, 'project_create', { name: 'Second' });
  const applied = await call(c, 'preset_apply', { preset: 'Happy Entrance' });
  expect(applied.body.ok, JSON.stringify(applied.body)).toBe(true);
  expect(applied.body.result.result === undefined || applied.body.result.created.length > 0).toBe(true);

  // 19. export: the Lottie arrives inline, with a download link for the person
  await call(c, 'project_open', { projectId });
  const exported = await call(c, 'export_start', { format: 'lottie' });
  expect(exported.body.result.status).toBe('done');
  expect(exported.body.result.file.downloadUrl).toContain('https://s3.test/');
  const lottie = JSON.parse(exported.resource!.text!);
  expect(lottie.layers.length).toBeGreaterThan(0);
  const dot = await call(c, 'export_start', { format: 'dotlottie' });
  expect(dot.body.result.file.filename).toMatch(/\.lottie$/);

  // 20. the final state, and the run's record of it
  const state = await call(c, 'editor_get_state', { level: 'standard' });
  expect(state.body.result.composition.width).toBe(1080);
  expect(state.body.result.layers.some((l: { name: string }) => l.name === 'spark')).toBe(true);
  const run = await call(c, 'run_get');
  expect(run.body.result.operations.length).toBeGreaterThan(20);
  expect(db.audit.some((a) => a.operation === 'render_frame' && a.userId === ANN)).toBe(true);
  expect(JSON.stringify(db.audit)).not.toContain('HELLO');   // no arguments or content in the audit

  // resources and prompts
  const guide = await c.readResource({ uri: 'blooby://guide/craft' });
  expect(JSON.stringify(guide)).toContain('SHAPE OF A CLIP');
  const prompts = (await c.listPrompts()).prompts.map((p) => p.name);
  expect(prompts).toContain('create_animation');
  const p = await c.getPrompt({ name: 'create_animation', arguments: { request: 'wave hello' } });
  expect(JSON.stringify(p.messages)).toContain('preset_search');

  // human edits in the editor meanwhile: the AI sees them, and a clash is a conflict, not an overwrite
  await call(c, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 8 });
  const row = db.projects.get(projectId)!;
  await projectsService.save(projectId, ANN, { project: { ...stored, name: 'edited in the editor' }, expectedVersion: row.currentVersion });
  const clash = await call(c, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 9 });
  expect(clash.r.isError).toBe(true);
  expect(clash.body.error.code).toBe('REVISION_CONFLICT');
  expect((await call(c, 'project_reload')).body.ok).toBe(true);
  const after = await call(c, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 9 });
  expect(after.body.ok).toBe(true);
  await c.close();
}, 60_000);

it('never lets one person reach another person\'s project', async () => {
  const mine = await projectsService.create(ANN, { name: 'Private work', project: {} });
  const { token } = await tokensService.createPat(BOB, { name: 'bob' });
  const c = await connect(token);
  const opened = await call(c, 'project_open', { projectId: mine.id });
  expect(opened.body.error.code).toBe('NOT_FOUND');
  const listed = await call(c, 'project_list');
  expect(JSON.stringify(listed.body)).not.toContain('Private work');
  await c.close();
});

it('a session cannot be taken over with someone else\'s token', async () => {
  const ann = await tokensService.createPat(ANN, { name: 'a' });
  const bob = await tokensService.createPat(BOB, { name: 'b' });
  const c = await connect(ann.token);
  const sid = (c as unknown as { _transport: { sessionId: string } })._transport.sessionId;
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${bob.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  });
  expect(res.status).toBe(404);
  await c.close();
});

it('a read-only connection sees no mutating tools and cannot change anything', async () => {
  const { token } = await tokensService.createPat(ANN, { name: 'look', mode: 'read_only' });
  const c = await connect(token);
  const tools = (await c.listTools()).tools;
  expect(tools.some((t) => t.name === 'add_keyframe')).toBe(false);
  expect(tools.every((t) => t.annotations?.readOnlyHint !== false || t.name === 'invoke')).toBe(true);
  const refused = await call(c, 'invoke', { capability: 'project_create', args: { name: 'x' } });
  expect(refused.body.error.code).toBe('READ_ONLY_CONNECTION');
  await c.close();
});

it('scopes limit what a connection may do', async () => {
  const { token } = await tokensService.createPat(ANN, { name: 'no renders', scopes: ['project:read', 'project:write'] });
  const c = await connect(token, '?tools=full');
  const names = (await c.listTools()).tools.map((t) => t.name);
  expect(names).not.toContain('render_frame');
  expect(names.length).toBeGreaterThan(150);    // the full profile lists every capability allowed
  await call(c, 'project_create', { name: 'scoped' });
  const refused = await call(c, 'render_frame');
  expect(refused.body.error.code).toBe('FORBIDDEN_SCOPE');
  await c.close();
});

it('a revoked token stops working at once', async () => {
  const { token, meta } = await tokensService.createPat(ANN, { name: 'short-lived' });
  const c = await connect(token);
  await tokensService.revokePat(ANN, meta.id);
  await expect(c.listTools()).rejects.toThrow();
});

it('in "ask me first" mode a change waits for the person, then applies', async () => {
  const { token } = await tokensService.createPat(ANN, { name: 'careful', mode: 'suggest' });
  const c = await connect(token);
  const made = await call(c, 'project_create', { name: 'Careful' });
  const pid = made.body.result.projectId as string;
  const asked = await call(c, 'add_layer', { type: 'shape', shape: 'heart', name: 'love' });
  expect(asked.body.result.status).toBe('pending_approval');
  const live = await fetch(`${base}/api/mcp/live?projectId=${pid}`, { headers: { Authorization: `Bearer user:${ANN}` } }).then((r) => r.json()) as { proposals: { id: string }[] };
  const id = live.proposals[0].id;
  const pending = await call(c, 'editor_get_state', {});
  expect(pending.body.result?.layers?.some((l: { name: string }) => l.name === 'love'), JSON.stringify(pending.body).slice(0, 400)).toBe(false);
  const decided = await fetch(`${base}/api/mcp/proposals/${id}`, { method: 'POST', headers: { Authorization: `Bearer user:${ANN}`, 'content-type': 'application/json' }, body: JSON.stringify({ approve: true }) }).then((r) => r.json()) as { status: string };
  expect(decided.status).toBe('applied');
  expect((await call(c, 'proposal_get', { proposalId: id })).body.result.status).toBe('applied');
  expect((await call(c, 'editor_get_state', {})).body.result.layers.some((l: { name: string }) => l.name === 'love')).toBe(true);
  await c.close();
});

it('refresh tokens rotate, and a reused one kills the connection', async () => {
  const { token, clientId } = await oauth(ANN);
  const refresh = (rt: string) => fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: clientId }) });
  const first = await refresh(token!.refresh_token).then((r) => r.json()) as { access_token: string; refresh_token: string };
  expect(first.access_token).toMatch(/^blb_at_/);
  const replay = await refresh(token!.refresh_token);
  expect(replay.status).toBe(400);
  // the replay revoked the whole grant, including the fresh access token
  const c = new Client({ name: 'x', version: '1' });
  await expect(c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${first.access_token}` } } }))).rejects.toThrow();
});

it('personal tokens are shown once and listed without their secret', async () => {
  const { token } = await tokensService.createPat(ANN, { name: 'listed' });
  const overview = await fetch(`${base}/api/mcp/overview`, { headers: { Authorization: `Bearer user:${ANN}` } }).then((r) => r.json()) as { tokens: { name: string }[]; serverUrl: string };
  expect(overview.tokens.some((t) => t.name === 'listed')).toBe(true);
  expect(JSON.stringify(overview)).not.toContain(token);
  expect(overview.serverUrl).toMatch(/\/mcp$/);
});

it('covers the rest of the project, preset, job and account capabilities', async () => {
  const { token } = await tokensService.createPat(ANN, { name: 'rest' });
  const c = await connect(token);
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(c, name, args);
    expect(r.body.ok, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(true);
    return r.body;
  };
  expect((await ok('account_whoami')).result.mode).toBe('full');
  await ok('run_start', { goal: 'tidy up' });
  const made = await ok('project_create', { name: 'Scratch' });
  expect((await ok('project_current')).result.projectId).toBe(made.result.projectId);
  await ok('project_rename', { name: 'Scratch 2' });
  expect(db.projects.get(made.result.projectId)!.name).toBe('Scratch 2');
  const dup = await ok('project_duplicate', { name: 'Scratch copy' });
  expect(dup.result.projectId).not.toBe(made.result.projectId);
  await ok('project_close');
  expect((await call(c, 'project_delete', { projectId: made.result.projectId, confirm: false })).body.error.code).toBe('CONFIRMATION_REQUIRED');
  await ok('project_delete', { projectId: made.result.projectId, confirm: true });
  expect(db.projects.has(made.result.projectId)).toBe(false);

  const builtins = await ok('preset_list', { source: 'builtin', limit: 5 });
  expect(builtins.result.total).toBeGreaterThan(20);
  const imported = await ok('preset_import', { name: 'Imported', preset: { durationMs: 500, tracks: [{ nodeId: 'body', property: 'opacity', keyframes: [{ time: 0, value: 1 }, { time: 500, value: 0.5 }] }] } });
  const copied = await ok('preset_duplicate', { preset: builtins.result.presets[0].id, name: 'My copy' });
  await ok('preset_publish', { assetId: copied.result.assetId, description: 'A copy' });
  expect(db.assets.get(copied.result.assetId)?.status).toBe('pending_review');
  await ok('preset_delete', { assetId: imported.result.assetId, confirm: true });
  expect(db.assets.has(imported.result.assetId)).toBe(false);

  await ok('project_open', { projectId: dup.result.projectId });
  expect(Object.keys((await ok('export_formats')).result)).toContain('dotlottie');
  const started = await ok('export_start', { format: 'svg', wait: false });
  const jobId = started.result.jobId as string;
  await ok('job_get', { jobId });
  expect((await ok('job_list')).result.some((j: { jobId: string }) => j.jobId === jobId)).toBe(true);
  await new Promise((r) => setTimeout(r, 200));
  const result = await call(c, 'job_result', { jobId });
  expect(result.resource?.mimeType).toBe('image/svg+xml');
  await ok('job_cancel', { jobId });
  await c.close();
}, 30_000);

/**
 * Some connectors do not keep the Mcp-Session-Id, so every call arrives on a fresh connection.
 * The project someone opened must survive that — losing it made an agent believe the project
 * was gone and create duplicates.
 */
it('keeps the open project across connections, and answers discovery before one is open', async () => {
  const { token } = await tokensService.createPat(CARL, { name: 'stateless' });

  const first = await connect(token);
  // before anything is open: discovery and the guides still answer
  const caps = await call(first, 'capabilities_search', { query: 'keyframe' });
  expect(caps.body.ok, JSON.stringify(caps.body).slice(0, 200)).toBe(true);
  expect((await call(first, 'guide_get', { topic: 'craft' })).body.ok).toBe(true);
  // …and an edit says exactly how to get a project, naming real ones
  const none = await call(first, 'add_keyframe', { nodeId: 'body', property: 'opacity', atMs: 0, value: 1 });
  expect(none.body.error.code).toBe('NO_PROJECT');
  expect(none.body.error.suggestion).toContain('project_');

  const made = await call(first, 'project_create', { name: 'Surfing on a Pencil' });
  const projectId = made.body.result.projectId as string;
  await first.close();

  // a different connection, as if the client forgot its session
  const second = await connect(token);
  const state = await call(second, 'editor_get_state', {});
  expect(state.body.ok, JSON.stringify(state.body).slice(0, 200)).toBe(true);
  expect((await call(second, 'project_current')).body.result.projectId).toBe(projectId);
  const edit = await call(second, 'add_layer', { type: 'shape', shape: 'star', name: 'board' });
  expect(edit.body.ok, JSON.stringify(edit.body).slice(0, 200)).toBe(true);
  await second.close();

  // and creating the same project twice says so instead of quietly making a duplicate
  const third = await connect(token);
  const twin = await call(third, 'project_create', { name: 'Surfing on a Pencil' });
  expect(twin.body.warnings?.[0]).toContain('already had a project');
  await call(third, 'project_close');
  const closed = await connect(token);
  expect((await call(closed, 'project_current')).body.result.projectId).toBe(null);
  await third.close();
  await closed.close();
}, 30_000);

it('a flood from one token is refused before it reaches the database', async () => {
  const { mcpRepository } = await import('../../repositories/mcp.repository.js');
  const lookups = vi.spyOn(mcpRepository, 'tokenByHash');
  const hit = () => fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer blb_flood', 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status);
  const statuses = [];
  for (let i = 0; i < 610; i++) statuses.push(await hit());
  expect(statuses.filter((s) => s === 429)).toHaveLength(10);
  expect(lookups).toHaveBeenCalledTimes(600);
  // a different token is untouched by it
  const other = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer blb_other', 'content-type': 'application/json' }, body: '{}' });
  expect(other.status).toBe(401);
  lookups.mockRestore();
});

/* ================================================================================================
 * Coverage of the edges: the OAuth provider and token rules, the management routes, prompts and
 * resources, and the refusals an agent meets. Each case names the thing it proves.
 * ============================================================================================== */

const DAN = 'd0000000-0000-4000-8000-000000000004';
const EVE = 'e0000000-0000-4000-8000-000000000005';
const FAY = 'f0000000-0000-4000-8000-000000000006';
const GUS = '90000000-0000-4000-8000-000000000007';
const person = (id: string) => ({ Authorization: `Bearer user:${id}`, 'content-type': 'application/json' });
const api = (id: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/mcp${path}`, { method, headers: person(id), body: body === undefined ? undefined : JSON.stringify(body) });

it('token rules: names, expiry, rotation, revocation and who may touch what', async () => {
  const { mcpRepository } = await import('../../repositories/mcp.repository.js');
  const { tokensService, normaliseScopes, ALL_SCOPES } = await import('./auth.service.js');
  // scopes as a string, as junk, and as nothing at all
  expect(normaliseScopes('project:read  render:read')).toEqual(['project:read', 'render:read']);
  expect(normaliseScopes(42)).toEqual(ALL_SCOPES);
  expect(normaliseScopes(['nope'])).toEqual(ALL_SCOPES);

  const blank = await tokensService.createPat(DAN, { name: '   ' });
  expect(blank.meta.name).toBe('Personal token');
  expect(blank.meta.expiresAt).toBeNull();
  const timed = await tokensService.createPat(DAN, { name: 'timed', expiresInDays: 9999 });
  expect(timed.meta.expiresAt!.getTime() - Date.now()).toBeLessThan(366 * 86400_000);

  // rotation keeps the name and the remaining lifetime, and kills the old secret
  const rotated = await tokensService.rotatePat(DAN, timed.meta.id);
  expect(rotated.meta.name).toBe('timed');
  expect(rotated.meta.expiresAt).not.toBeNull();
  expect(rotated.token).not.toBe(timed.token);
  const plain = await tokensService.rotatePat(DAN, blank.meta.id);
  expect(plain.meta.expiresAt).toBeNull();

  const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number }) => e.status ?? -1);
  expect(await status(tokensService.rotatePat(DAN, 'missing'))).toBe(404);
  expect(await status(tokensService.rotatePat(EVE, rotated.meta.id))).toBe(404);          // someone else's
  expect(await status(tokensService.rotatePat(DAN, timed.meta.id))).toBe(404);            // already revoked by the rotation
  await oauth(DAN);
  const grant = [...db.tokens.values()].find((t) => t.kind === 'access')!;
  expect(await status(tokensService.rotatePat(grant.userId, grant.id))).toBe(404);        // not a PAT
  expect(await status(tokensService.revokePat(DAN, 'missing'))).toBe(404);
  expect(await status(tokensService.revokePat(EVE, rotated.meta.id))).toBe(404);
  expect(await status(tokensService.revokePat(grant.userId, grant.id))).toBe(404);
  expect(await status(tokensService.revokeConnection(EVE, 'no-such-grant'))).toBe(404);

  // a connection listing: last-use is the newest of its credentials, and an unknown client has a default name
  const grantId = randomUUID();
  const older = new Date(Date.now() - 10_000), newer = new Date(Date.now() - 1000);
  for (const [kind, lastUsedAt] of [['access', older], ['refresh', newer], ['access', null]] as const)
    await mcpRepository.createToken({ kind, tokenHash: randomUUID(), userId: FAY, clientId: 'ghost-client', grantId, scopes: ['project:read'], mode: 'full', lastUsedAt } as never);
  db.tokens.forEach((t) => { if (t.grantId === grantId && t.kind === 'refresh') t.createdAt = new Date(Date.now() - 60_000); });
  const listed = await tokensService.list(FAY);
  expect(listed.connections).toHaveLength(1);
  expect(listed.connections[0]).toMatchObject({ clientName: 'AI client', lastUsedAt: newer });
});

it('the management routes: create, rotate, revoke, disconnect, capabilities and live state', async () => {
  const created = await api(DAN, 'POST', '/tokens', { name: 'route token' });
  expect(created.status).toBe(201);
  const { meta, token } = await created.json() as { meta: { id: string }; token: string };
  expect(token).toMatch(/^blb_pat_/);
  const rotated = await api(DAN, 'POST', `/tokens/${meta.id}/rotate`);
  expect(rotated.status).toBe(200);
  const next = await rotated.json() as { meta: { id: string } };
  expect((await api(DAN, 'DELETE', `/tokens/${next.meta.id}`)).status).toBe(204);

  const { token: oauthToken } = await oauth(DAN);
  expect(oauthToken).not.toBeNull();
  const overview = await api(DAN, 'GET', '/overview').then((r) => r.json()) as { connections: { grantId: string }[] };
  expect((await api(DAN, 'DELETE', `/connections/${overview.connections[0]!.grantId}`)).status).toBe(204);

  const caps = await api(DAN, 'GET', '/capabilities').then((r) => r.json()) as { capabilities: unknown[] };
  expect(caps.capabilities.length).toBeGreaterThan(100);
  expect((await api(DAN, 'GET', '/live')).status).toBe(200);
  expect((await api(DAN, 'GET', '/live?projectId=nothing')).status).toBe(200);
});

it('consent: expired or answered requests, narrowed scopes and a missing state', async () => {
  const { consentService, oauthProvider } = await import('./auth.service.js');
  const { mcpRepository } = await import('../../repositories/mcp.repository.js');
  const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number }) => e.status ?? -1);
  expect(await status(consentService.describe('missing'))).toBe(404);
  expect(await status(consentService.decide('missing', DAN, { approve: true }))).toBe(404);

  const client = await oauthProvider.clientsStore.registerClient!({ redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'none', client_secret: 's3cret' } as never) as { client_id: string };
  const redirects: string[] = [];
  const authorize = async (scopes?: string[]) => {
    await oauthProvider.authorize({ client_id: client.client_id } as never, { redirectUri: 'https://app.example/cb', codeChallenge: 'c', scopes } as never, { redirect: (u: string) => redirects.push(u) } as never);
    return new URL(redirects.at(-1)!).searchParams.get('request')!;
  };
  const stored = await oauthProvider.clientsStore.getClient(client.client_id) as { client_name: string; client_secret: string };
  expect(stored).toMatchObject({ client_name: 'AI client', client_secret: 's3cret' });
  expect(await oauthProvider.clientsStore.getClient('nope')).toBeUndefined();

  const id = await authorize(['project:read']);
  expect((await consentService.describe(id)).clientName).toBe('AI client');
  // asking for scopes the request never had narrows to nothing, which falls back to what was asked
  const approved = await consentService.decide(id, DAN, { approve: true, scopes: ['render:read'], mode: 'suggest' });
  const back = new URL(approved.redirectTo);
  expect(back.searchParams.has('state')).toBe(false);
  expect(await status(consentService.decide(id, DAN, { approve: true }))).toBe(404);   // spent once, so no longer live
  const code = back.searchParams.get('code')!;
  const row = [...db.tokens.values()].filter((t) => t.kind === 'code').at(-1)!;
  expect(row.scopes).toEqual(['project:read']);

  // the code: a stranger's client, a wrong redirect, then use, then replay
  const stranger = { client_id: 'someone-else' } as never;
  await expect(oauthProvider.challengeForAuthorizationCode(stranger, code)).rejects.toThrow(/Invalid or expired/);
  await expect(oauthProvider.exchangeAuthorizationCode(stranger, code, undefined, undefined)).rejects.toThrow(/Invalid or expired/);
  const me = { client_id: client.client_id } as never;
  expect(await oauthProvider.challengeForAuthorizationCode(me, code)).toBe('c');
  await expect(oauthProvider.exchangeAuthorizationCode(me, code, undefined, 'https://evil.example/cb')).rejects.toThrow(/redirect_uri/);
  const tokens = await oauthProvider.exchangeAuthorizationCode(me, code, undefined, 'https://app.example/cb');
  expect(tokens.refresh_token).toBeTruthy();
  await expect(oauthProvider.exchangeAuthorizationCode(me, code, undefined, undefined)).rejects.toThrow(/Invalid or expired|already used/);

  // a code that is live but already spent by someone else a moment earlier: the whole grant dies
  const id2 = await authorize();
  const code2 = new URL((await consentService.decide(id2, DAN, { approve: true })).redirectTo).searchParams.get('code')!;
  const spend = vi.spyOn(mcpRepository, 'spend').mockResolvedValueOnce(0);
  await expect(oauthProvider.exchangeAuthorizationCode(me, code2, undefined, undefined)).rejects.toThrow(/already used/);
  spend.mockRestore();

  // refresh: wrong kind, narrowed scopes, expired, reuse
  await expect(oauthProvider.exchangeRefreshToken(me, 'not-a-token', undefined)).rejects.toThrow(/Invalid refresh/);
  await expect(oauthProvider.exchangeRefreshToken(stranger, tokens.refresh_token!, undefined)).rejects.toThrow(/Invalid refresh/);
  const narrowed = await oauthProvider.exchangeRefreshToken(me, tokens.refresh_token!, ['project:read', 'render:read']);
  expect(narrowed.scope).toBe('project:read');
  const refreshRow = [...db.tokens.values()].find((t) => t.kind === 'refresh' && t.clientId === client.client_id && !t.revokedAt)!;
  refreshRow.expiresAt = new Date(Date.now() - 1000);
  const expiredSecret = (await oauthProvider.exchangeRefreshToken(me, narrowed.refresh_token!, undefined).catch((e: Error) => e.message));
  expect(expiredSecret).toMatch(/already used|revoked/);

  // revocation: unknown tokens and other clients' tokens are ignored; an own token revokes the grant
  await oauthProvider.revokeToken!(me, { token: 'unknown' } as never);
  const fresh = await oauthProvider.exchangeAuthorizationCode(me, new URL((await consentService.decide(await authorize(), DAN, { approve: true })).redirectTo).searchParams.get('code')!, undefined, undefined);
  await oauthProvider.revokeToken!(stranger, { token: fresh.access_token } as never);
  expect(await oauthProvider.verifyAccessToken(fresh.access_token)).toMatchObject({ clientId: client.client_id });
  await oauthProvider.revokeToken!(me, { token: fresh.access_token } as never);
  await expect(oauthProvider.verifyAccessToken(fresh.access_token)).rejects.toThrow();
});

it('verifies tokens: stale last-used is refreshed, an expiring PAT reports its expiry, a bad one is refused', async () => {
  const { tokensService, oauthProvider } = await import('./auth.service.js');
  const { token, meta } = await tokensService.createPat(DAN, { name: 'expiring', expiresInDays: 5 });
  const info = await oauthProvider.verifyAccessToken(token);
  expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
  expect(db.tokens.get(meta.id)!.lastUsedAt).not.toBeNull();
  const forever = await tokensService.createPat(DAN, { name: 'forever' });
  expect((await oauthProvider.verifyAccessToken(forever.token)).expiresAt).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
  db.tokens.get(meta.id)!.lastUsedAt = new Date(Date.now() - 3600_000);
  await tokensService.revokePat(DAN, forever.meta.id);   // clears the principal cache
  await oauthProvider.verifyAccessToken(token);
  expect(Date.now() - db.tokens.get(meta.id)!.lastUsedAt.getTime()).toBeLessThan(5000);
  // a PAT without a name still has one to show
  const unnamed = await tokensService.createPat(DAN, { name: 'x' });
  db.tokens.get(unnamed.meta.id)!.name = '';
  expect((await tokensService.verify(unnamed.token)).clientName).toBe('Personal token');
  await expect(tokensService.verify('blb_pat_nonsense')).rejects.toThrow(/Invalid, expired/);
});

it('prompts: every one builds, with and without its arguments, and an unknown one is refused', async () => {
  const { token } = await tokensService.createPat(DAN, { name: 'prompts' });
  const c = await connect(token);
  const prompts = (await c.listPrompts()).prompts;
  expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['create_preset', 'debug_animation', 'optimize_animation', 'inspect_project', 'explain_current_animation', 'prepare_for_export', 'blooby_workflow']));
  const give: Record<string, Record<string, string>[]> = {
    create_animation: [{ request: 'wave', project: 'Demo' }, { request: 'wave' }],
    create_preset: [{ description: 'spin', name: 'Spinner' }, { description: 'spin' }],
    debug_animation: [{ problem: 'it pops' }],
    optimize_animation: [{ focus: 'easing' }, {}],
    inspect_project: [{ project: 'Demo' }, {}],
    explain_current_animation: [{}],
    prepare_for_export: [{ format: 'dotlottie' }, {}],
    blooby_workflow: [{}],
  };
  for (const p of prompts) for (const args of give[p.name] ?? [{}]) {
    const r = await c.getPrompt({ name: p.name, arguments: args });
    expect(JSON.stringify(r.messages), p.name).toContain('text');
  }
  // no arguments object at all
  expect((await c.getPrompt({ name: 'blooby_workflow' })).messages).toHaveLength(1);
  await expect(c.getPrompt({ name: 'nope' })).rejects.toThrow(/No prompt/);
  await c.close();
});

it('resources: the whole catalogue reads, scopes are enforced, and unknown ones are refused', async () => {
  const { token } = await tokensService.createPat(DAN, { name: 'resources' });
  const c = await connect(token);
  const text = async (uri: string) => (await c.readResource({ uri })).contents[0] as { text?: string; blob?: string; mimeType?: string };

  expect((await c.listResources()).resources.length).toBeGreaterThan(5);
  expect((await c.listResourceTemplates()).resourceTemplates).toHaveLength(3);
  expect((await text('blooby://capabilities')).text).toContain('capabilityVersion');
  expect((await text('blooby://schema/project')).mimeType).toBe('text/typescript');
  expect((await text('blooby://projects')).text).toBe('[]');
  await expect(c.readResource({ uri: 'blooby://guide/nonsense' })).rejects.toThrow(/No resource/);
  await expect(c.readResource({ uri: 'blooby://nothing' })).rejects.toThrow(/No resource/);
  // nothing is open yet, so the project resources say how to open one
  await expect(c.readResource({ uri: 'blooby://project/current' })).rejects.toThrow(/No project is open/);

  const made = await call(c, 'project_create', { name: 'Resource demo' });
  const pid = made.body.result.projectId as string;
  expect(JSON.parse((await text('blooby://projects')).text!)[0].id).toBe(pid);
  expect((await text('blooby://project/current')).text).toContain('Resource demo');
  expect((await text('blooby://project/current/timeline')).text).toBeTruthy();
  // the whole document is bigger than a reply may be, and says so rather than ending mid-value
  expect((await text('blooby://project/current/document')).text).toContain('cut at 80,000 characters');
  expect((await text('blooby://layers/body')).text).toContain('body');
  expect(JSON.parse((await text('blooby://presets')).text!).total).toBeGreaterThan(20);
  const builtinId = (await call(c, 'preset_list', { limit: 1 })).body.result.presets[0].id as string;
  expect((await text(`blooby://presets/${builtinId}`)).text).toBeTruthy();   // builtin: through preset_get

  // a library preset reads from the library; the project's own is found by name too
  const saved = await call(c, 'invoke', { capability: 'preset_import', args: { name: 'Lib', preset: { durationMs: 100, tracks: [] } } });
  const assetId = saved.body.result.assetId as string;
  expect((await text(`blooby://presets/${assetId}`)).text).toBeTruthy();

  // exports: text inline, binary as a blob, a stranger's or missing job refused
  const svg = await call(c, 'export_start', { format: 'svg' });
  const svgJob = svg.body.result.jobId as string;
  expect((await text(`blooby://exports/${svgJob}/x.svg`)).text).toContain('<svg');
  const lottie = await call(c, 'export_start', { format: 'lottie' });
  expect((await text(`blooby://exports/${lottie.body.result.jobId}/x.json`)).text).toContain('"layers"');
  const pngJob = await call(c, 'export_start', { format: 'png' });
  expect((await text(`blooby://exports/${pngJob.body.result.jobId}/x.png`)).blob).toBeTruthy();
  await expect(c.readResource({ uri: 'blooby://exports/job_missing/x.svg' })).rejects.toThrow(/No such export/);
  const other = await connect((await tokensService.createPat(EVE, { name: 'eve' })).token);
  await expect(other.readResource({ uri: `blooby://exports/${svgJob}/x.svg` })).rejects.toThrow(/No such export/);
  await other.close();

  // scopes: each family of resource names the scope it needs
  const narrow = await connect((await tokensService.createPat(DAN, { name: 'narrow', scopes: ['render:read'] })).token);
  for (const uri of ['blooby://projects', 'blooby://project/current', 'blooby://layers/body', 'blooby://presets', 'blooby://presets/anything'])
    await expect(narrow.readResource({ uri }), uri).rejects.toThrow(/needs/);
  await narrow.close();

  // subscribing: a change to the open project is announced, and unsubscribing stops it
  const updates: string[] = [];
  const { ResourceUpdatedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
  c.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => { updates.push(n.params.uri); });
  await c.subscribeResource({ uri: 'blooby://project/current' });
  await c.subscribeResource({ uri: 'blooby://projects' });
  await call(c, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 3 });
  await new Promise((r) => setTimeout(r, 100));
  expect(updates).toContain('blooby://project/current');
  expect(updates).not.toContain('blooby://projects');
  await c.unsubscribeResource({ uri: 'blooby://project/current' });
  await c.close();
}, 60_000);

/* ---- the call pipeline, driven in-process ----------------------------------------------------- */

async function pipeline() {
  const { callTool } = await import('./server.js');
  const host = await import('./host.js');
  const { ALL_SCOPES } = await import('./auth.service.js');
  const { registerCapabilities } = await import('@blooby/studio/engine');
  const stub = (id: string, handler: (c: unknown, a: Record<string, unknown>) => Promise<unknown>) => {
    registerCapabilities([{ id, title: id, description: id, category: 'agent', kind: 'server', mutates: false, scope: 'project:read', reversible: false, requires: [], inputSchema: { type: 'object' }, since: '1.0.0' } as never]);
    host.HOST_HANDLERS.set(id, handler as never);
  };
  const conn = (userId: string, over: Record<string, unknown> = {}) => ({
    principal: { userId, clientId: 'pat:unit', clientName: 'unit', tokenId: randomUUID(), scopes: ALL_SCOPES, mode: 'full', ...over },
    projectId: null as string | null, run: host.newRun(), subscriptions: new Set<string>(),
  });
  const run = async (c: ReturnType<typeof conn>, name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(c as never, name, args);
    return { r, body: JSON.parse((r.content.find((x) => x.type === 'text') as { text: string }).text) };
  };
  return { callTool, host, conn, run, stub };
}

it('throttles a flood with advice, warns as the budget runs down, and keeps the run log bounded', async () => {
  const { conn, run } = await pipeline();
  const c = conn(FAY);
  const warned: string[] = [];
  let refused = 0;
  for (let i = 0; i < 1005; i++) {
    const { body } = await run(c, 'account_whoami');
    if (body.warnings) warned.push(body.warnings[0]);
    if (body.error?.code === 'RATE_LIMITED') { refused++; expect(body.error.suggestion).toContain('batch_execute'); }
  }
  expect(refused).toBeGreaterThan(600);
  expect(warned.some((w) => /used this minute/.test(w))).toBe(true);
  expect(c.run.ops).toHaveLength(1000);
});

it('refuses a thirteenth call at once, survives a handler that throws anything, and cuts and encodes replies', async () => {
  const { conn, run, stub } = await pipeline();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  stub('zz_block', async () => { await gate; return { summary: 'done' }; });
  stub('zz_json', async () => ({ summary: 'j', data: { big: 10n, set: new Set([1, 2]) } }));
  stub('zz_throw', async () => { throw new Error('plain failure'); });
  stub('zz_throw_str', async () => { throw 'a string'; });   // eslint-disable-line no-throw-literal

  const c = conn(EVE);
  const first = Array.from({ length: 12 }, () => run(c, 'zz_block'));
  await new Promise((r) => setTimeout(r, 20));
  sweeps.forEach((f) => f());                      // a sweep mid-flight keeps the counters that are still running
  const busy = await run(c, 'zz_block');
  expect(busy.body.error).toMatchObject({ code: 'BUSY', retryAfterMs: 500 });
  release();
  expect((await Promise.all(first)).every((x) => x.body.ok)).toBe(true);

  expect((await run(c, 'zz_json')).body.result).toEqual({ big: 10, set: [1, 2] });
  expect((await run(c, 'zz_throw')).body.error).toMatchObject({ code: 'INTERNAL', message: 'plain failure' });
  expect((await run(c, 'zz_throw_str')).body.error).toMatchObject({ code: 'INTERNAL', message: 'a string' });
  expect((await run(c, 'no_such_thing')).body.error.code).toBe('UNKNOWN_CAPABILITY');
  expect((await run(c, 'invoke', {})).body.error.code).toBe('UNKNOWN_CAPABILITY');
  expect((await run(c, 'invoke', { capability: 'account_whoami' })).body.ok).toBe(true);

  // a result past the ceiling is cut and says how to ask for less
  stub('zz_huge', async () => ({ summary: 'h', data: 'x'.repeat(90_000) }));
  const { callTool } = await pipeline();
  const huge = await callTool(c as never, 'zz_huge', {});
  expect((huge.content.find((x) => x.type === 'text') as { text: string }).text).toContain('cut at 80,000 characters');
});

it('"ask me first" refuses deletion outright, and logs structured lines outside tests', async () => {
  const { conn, run } = await pipeline();
  const c = conn(EVE, { mode: 'suggest' });
  expect((await run(c, 'project_delete', { projectId: 'x', confirm: true })).body.error.code).toBe('NOT_IN_SUGGEST_MODE');
  expect((await run(c, 'preset_delete', { assetId: 'x', confirm: true })).body.error.code).toBe('NOT_IN_SUGGEST_MODE');

  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { await run(conn(EVE), 'account_whoami'); await run(conn(EVE), 'no_such_thing'); } finally { process.env.NODE_ENV = was; }
  expect(info.mock.calls.map((x) => String(x[0])).join('\n')).toMatch(/"mcp":"account_whoami","ok":true[\s\S]*"error":"UNKNOWN_CAPABILITY"/);
  info.mockRestore();
});

it('tells the agent when the editor moved the project underneath it, and when it was deleted', async () => {
  const { token } = await tokensService.createPat(GUS, { name: 'drift' });
  const c = await connect(token);
  const made = await call(c, 'project_create', { name: 'Drifting' });
  const pid = made.body.result.projectId as string;
  await call(c, 'project_save');
  // saved from the editor while the session is clean: the AI picks the new version up and says so
  const row = db.projects.get(pid)!;
  const stored = JSON.parse(db.objects.get(row.s3Key)!);
  await projectsService.save(pid, GUS, { project: { ...stored, name: 'Drifted' }, expectedVersion: row.currentVersion });
  const seen = await call(c, 'editor_get_state', {});
  expect(seen.body.warnings?.[0]).toContain('changed in the editor');
  const again = await call(c, 'project_current');
  expect(again.body.result.storedVersion).toBe(db.projects.get(pid)!.currentVersion);
  // deleted from elsewhere: a clear refusal, not a crash
  db.projects.delete(pid);
  expect((await call(c, 'editor_get_state', {})).body.error.code).toBe('PROJECT_GONE');
  await c.close();
});

/* ---- the server-side capabilities: every refusal and every option ---------------------------- */

const IDA = '1d000000-0000-4000-8000-000000000008';
const ZED = '2e000000-0000-4000-8000-000000000009';

it('projects: opening by name, the refusals, duplicating, closing and deleting', async () => {
  const { token } = await tokensService.createPat(IDA, { name: 'projects' });
  const c = await connect(token);
  const bad = async (name: string, args: Record<string, unknown>, code: string) => {
    const r = await call(c, name, args);
    expect(r.body.error?.code, `${name}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(code);
    return r.body;
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(c, name, args);
    expect(r.body.ok, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(true);
    return r.body;
  };

  // nothing is open and there is nothing to suggest
  const none = await bad('editor_get_state', {}, 'NO_PROJECT');
  expect(none.error.suggestion).toBe('project_create { name } starts one.');
  expect((await ok('project_current')).result.projectId).toBeNull();
  await bad('project_reload', {}, 'NO_PROJECT');
  await bad('project_duplicate', {}, 'NO_PROJECT');
  await bad('project_open', {}, 'MISSING_ARGUMENT');
  await bad('project_open', { name: 'nothing by this name' }, 'NOT_FOUND');
  await bad('preset_get', {}, 'NOT_FOUND');

  const a = await ok('project_create', { name: 'Alpha' });
  await ok('project_create', { name: 'Alphabet' });
  await ok('project_close');
  // with projects but none open, the refusal names the newest
  expect((await bad('editor_get_state', {}, 'NO_PROJECT')).error.suggestion).toContain('project_open { projectId:');
  // exact name wins over a longer one that merely contains it
  expect((await ok('project_open', { name: 'alpha' })).result.projectId).toBe(a.result.projectId);
  expect((await ok('project_open', { name: 'Alph' })).result.name).toBeTruthy();   // falls back to the first match
  await ok('project_list', { q: 'Alpha', limit: 5 });

  // duplicating saves unsaved work first, and a copy can be deleted
  await ok('add_layer', { type: 'shape', shape: 'star', name: 'dirty' });
  const dup = await ok('project_duplicate', { projectId: a.result.projectId, name: 'Alpha 2' });
  expect(dup.result.name).toBe('Alpha 2');
  // closing while dirty saves; a save that fails on close is swallowed
  await ok('add_layer', { type: 'shape', shape: 'heart', name: 'dirty 2' });
  const failing = vi.spyOn(projectsService, 'save').mockRejectedValueOnce(new Error('s3 is away'));
  await ok('project_close');
  failing.mockRestore();
  await ok('project_open', { projectId: dup.result.projectId });
  // deleting the open project clears it; deleting another leaves the open one alone
  await ok('project_delete', { projectId: a.result.projectId, confirm: true });
  expect((await ok('project_current')).result.projectId).toBe(dup.result.projectId);
  await ok('project_delete', { projectId: dup.result.projectId, confirm: true });
  expect((await ok('project_current')).result.projectId).toBeNull();
  await c.close();
}, 60_000);

it('HTTP failures become the right capability errors', async () => {
  const { HttpError } = await import('../../utils/httpError.js');
  const { CapabilityError } = await import('@blooby/studio/engine');
  const { token } = await tokensService.createPat(IDA, { name: 'errors' });
  const c = await connect(token);
  await call(c, 'project_create', { name: 'Errors' });
  const spy = vi.spyOn(projectsService, 'update');
  const code = async (e: unknown) => {
    spy.mockRejectedValueOnce(e);
    const r = await call(c, 'project_rename', { name: 'x' });
    return r.body.error?.code;
  };
  expect(await code(HttpError.forbidden())).toBe('FORBIDDEN');
  expect(await code(HttpError.conflict('c'))).toBe('REVISION_CONFLICT');
  expect(await code(HttpError.payloadTooLarge('p'))).toBe('TOO_LARGE');
  expect(await code(HttpError.upstream('u'))).toBe('REQUEST_FAILED');
  expect(await code(new CapabilityError('CUSTOM', 'already one of ours'))).toBe('CUSTOM');
  expect(await code(new Error('boom'))).toBe('INTERNAL');
  spy.mockRestore();
  await c.close();
});

it('a view-only project can be read and rendered but not saved, and the workspace says so', async () => {
  const pub = await projectsService.create(ZED, { name: 'Look only', project: {} });
  await projectsService.update(pub.id, ZED, { visibility: 'public', access: 'view' });
  const { token } = await tokensService.createPat(IDA, { name: 'viewer' });
  const c = await connect(token);
  const opened = await call(c, 'project_open', { projectId: pub.id });
  expect(opened.body.result.canEdit).toBe(false);
  expect((await call(c, 'project_save')).body.error.code).toBe('READ_ONLY_PROJECT');
  const { workspace } = await import('./workspace.js');
  const o = workspace.get(IDA, pub.id)!;
  workspace.scheduleSave(o);               // no autosave is armed for a project you cannot save
  expect(o.saveTimer).toBeUndefined();
  expect((await call(c, 'project_close')).body.ok).toBe(true);
  await c.close();
});

it('workspace: concurrent opens share one load, saves report conflicts and failures, names follow the session', async () => {
  const { workspace } = await import('./workspace.js');
  const { HttpError } = await import('../../utils/httpError.js');
  const mine = await projectsService.create(IDA, { name: 'Workspace', project: {} });
  const [one, two] = await Promise.all([workspace.open(IDA, mine.id), workspace.open(IDA, mine.id)]);
  expect(two).toBe(one);
  expect((await workspace.open(IDA, mine.id))).toBe(one);

  // a rename made inside the session reaches the row on save, a plain save does not rewrite it
  await one.session.rename('Renamed in session');
  await workspace.save(one);
  expect(db.projects.get(mine.id)!.name).toBe('Renamed in session');
  await workspace.save(one, true);

  // saved elsewhere since: a conflict the agent can act on; any other failure is kept for the next call
  const baseline = one.baseVersion;
  one.baseVersion = baseline - 1;
  await expect(workspace.save(one)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(one.lastSaveError).toBe('conflict');
  one.baseVersion = baseline;
  const save = vi.spyOn(projectsService, 'save');
  save.mockRejectedValueOnce(new Error('bucket down'));
  await expect(workspace.save(one)).rejects.toThrow('bucket down');
  expect(one.lastSaveError).toBe('bucket down');
  save.mockRejectedValueOnce('odd');
  await expect(workspace.save(one)).rejects.toBe('odd');
  expect(one.lastSaveError).toBe('odd');
  save.mockRestore();
  void HttpError;

  // activity is capped, and presence is only for the last few seconds
  for (let i = 0; i < 120; i++) workspace.record(one, { at: new Date().toISOString(), client: 'unit', capability: 'x', summary: 's', ok: true });
  expect(one.activity).toHaveLength(100);
  const live = workspace.live(IDA, mine.id);
  expect(live.projects[0]!.agents).toHaveLength(1);
  expect(workspace.live(IDA, 'other-project').projects).toHaveLength(0);

  // closing something that is not open is a no-op; closing a dirty one saves it
  workspace.close(IDA, 'never-opened');
  await one.session.invoke('add_layer', { type: 'shape', shape: 'star', name: 'late' });
  workspace.close(IDA, mine.id);
  await new Promise((r) => setTimeout(r, 50));
  expect(workspace.get(IDA, mine.id)).toBeUndefined();
});

it('proposals: only the owner sees them, each is decided once, and a failing change is recorded as failed', async () => {
  const { workspace } = await import('./workspace.js');
  const mine = await projectsService.create(IDA, { name: 'Proposals', project: {} });
  const o = await workspace.open(IDA, mine.id);
  const mk = (capability: string, userId = IDA) => workspace.propose({ userId, projectId: mine.id, client: 'unit', capability, args: {}, summary: 's', preview: { created: [], deleted: [], changed: [] } });
  const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number }) => e.status ?? -1);

  const rejected = mk('add_layer');
  expect((await workspace.decide(IDA, rejected.id, false)).status).toBe('rejected');
  expect(await status(workspace.decide(IDA, rejected.id, true))).toBe(409);
  expect(await status(workspace.decide(IDA, 'prop_missing', true))).toBe(404);
  const theirs = mk('add_layer', ZED);
  expect(workspace.proposal(IDA, theirs.id)).toBeUndefined();
  expect(await status(workspace.decide(IDA, theirs.id, true))).toBe(404);

  const failedCap = mk('not_a_capability');
  expect((await workspace.decide(IDA, failedCap.id, true)).status).toBe('failed');
  expect(typeof failedCap.error).toBe('object');
  const failedPlain = mk('add_layer');
  const inv = vi.spyOn(o.session, 'invoke').mockRejectedValueOnce(new Error('session broke'));
  expect((await workspace.decide(IDA, failedPlain.id, true)).status).toBe('failed');
  expect(failedPlain.error).toContain('session broke');
  inv.mockRestore();

  // pending ones and recently decided ones are shown, for this person and project only
  const pending = mk('add_layer');
  const shown = workspace.live(IDA, mine.id).proposals.map((p) => p.id);
  expect(shown).toContain(pending.id);
  expect(shown).not.toContain(theirs.id);
  expect(workspace.live(IDA).proposals.length).toBeGreaterThan(0);
  workspace.close(IDA, mine.id);
});

it('presets: where they come from, how they are placed, saved, edited, published and deleted', async () => {
  const { token } = await tokensService.createPat(IDA, { name: 'presets' });
  const c = await connect(token);
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(c, name, args);
    expect(r.body.ok, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(true);
    return r.body;
  };
  const bad = async (name: string, args: Record<string, unknown>, code: string) => {
    const r = await call(c, name, args);
    expect(r.body.error?.code, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(code);
  };
  // before a project is open, only the library and built-ins are searched
  expect((await ok('preset_list', { source: 'builtin', offset: 2, limit: 3 })).result.presets).toHaveLength(3);
  await bad('preset_get', { preset: 'definitely not a preset' }, 'NOT_FOUND');
  await bad('preset_save', { name: 'x' }, 'NO_PROJECT');

  await ok('project_create', { name: 'Presets' });
  await bad('preset_save', { name: 'Empty' }, 'NOTHING_TO_SAVE');
  const list = (await ok('preset_list', { source: 'project', limit: 100 })).result;
  expect(list.total).toBeGreaterThan(0);
  const first = list.presets[0] as { id: string; name: string };
  expect((await ok('preset_get', { preset: first.name.toUpperCase(), full: true })).result.source).toBe('project');

  // placing: on a named mascot, at an index, with a request id; and from the library, not yet in the project
  await ok('add_mascot', { name: 'Pip' });
  await ok('preset_apply', { preset: first.id, mascot: 'Pip', index: 0, requestId: 'req-1' });
  await ok('preset_apply', { preset: first.id });
  await bad('preset_apply', { preset: first.id, mascot: 'Nobody' }, 'NOT_FOUND');
  const imported = (await ok('preset_import', { name: 'Library one', preset: { durationMs: 400, tracks: [{ nodeId: 'body', property: 'opacity', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 0.5 }] }] } })).result.assetId as string;
  await ok('preset_apply', { preset: imported });
  expect((await ok('preset_search', { query: 'Library one' })).result.some((p: { name: string }) => p.name === 'Library one')).toBe(true);

  // saving: the whole timeline (with tags and a category), one named preset, an unknown one
  await ok('add_keyframe', { nodeId: 'body', property: 'opacity', atMs: 0, value: 1 });
  await ok('add_keyframe', { nodeId: 'body', property: 'opacity', atMs: 500, value: 0.4 });
  const whole = await ok('preset_save', { name: 'Whole timeline', tags: ['a', 'b'], category: 'test', description: 'd' });
  expect(db.assets.get(whole.result.assetId)!.tags).toEqual(['a', 'b']);
  const named = await ok('preset_save', { name: 'From a preset', preset: first.name });
  expect(named.result.assetId).toBeTruthy();
  await bad('preset_save', { name: 'x', preset: 'not in this project' }, 'NOT_FOUND');

  // editing: nothing given, an unknown source preset, from a preset, plain fields
  await bad('preset_update', { assetId: whole.result.assetId }, 'MISSING_ARGUMENT');
  await bad('preset_update', { assetId: whole.result.assetId, from: 'not in this project' }, 'NOT_FOUND');
  await ok('preset_update', { assetId: whole.result.assetId, from: first.name, tags: ['c'], category: 'x' });
  await ok('preset_update', { assetId: whole.result.assetId, name: 'Renamed' });
  await bad('preset_update', { assetId: 'missing', name: 'x' }, 'NOT_FOUND');

  // importing, duplicating, publishing, deleting
  await bad('preset_import', { name: 'x', preset: { durationMs: 1 } }, 'INVALID_ARGUMENT');
  await ok('preset_duplicate', { preset: whole.result.assetId, name: 'Dup' });
  await ok('preset_publish', { assetId: whole.result.assetId, description: 'share it', category: 'c', tags: ['t'] });
  await bad('preset_publish', { assetId: 'missing', description: 'x' }, 'NOT_FOUND');
  await bad('preset_delete', { assetId: named.result.assetId, confirm: false }, 'CONFIRMATION_REQUIRED');
  await ok('preset_delete', { assetId: named.result.assetId, confirm: true });
  await bad('preset_delete', { assetId: 'missing', confirm: true }, 'NOT_FOUND');
  await c.close();
}, 60_000);

it('rendering and exporting: every option, every format, and the job lifecycle', async () => {
  const { token } = await tokensService.createPat(IDA, { name: 'renders' });
  const c = await connect(token);
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(c, name, args);
    expect(r.body.ok, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(true);
    return r;
  };
  const bad = async (name: string, args: Record<string, unknown>, code: string) => {
    const r = await call(c, name, args);
    expect(r.body.error?.code, `${name}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(code);
    return r.body;
  };
  await ok('project_create', { name: 'Renders' });

  // frames: defaults, the playhead, a viewport, quality tiers and a background
  expect((await ok('render_frame')).body.result.atMs).toBe(0);
  await ok('render_frame', { atMs: 100, quality: 'final', background: '#112233' });
  await ok('render_frame', { quality: 'medium', viewport: true });
  await ok('render_sequence', { times: [0, 100, 200, 300, 400, 500], columns: 2, quality: 'medium' });
  await ok('render_sequence', { frames: 3, fromMs: 0, toMs: 600, quality: 'final' });
  expect((await ok('render_sequence', {})).body.result.times.length).toBe(8);

  // exports: each format, trimming, and an unknown one that fails inside the job
  await ok('export_start', { format: 'lottie', fromMs: 0, toMs: 400, background: '#ffffff' });
  await ok('export_start', { format: 'runtime' });
  const png = await ok('export_start', { format: 'png', atMs: 200 });
  expect(png.resource?.mimeType).toBe('image/png');
  const svg = await ok('export_start', { format: 'svg', atMs: 50 });
  expect(svg.body.result.file.filename).toMatch(/-50ms\.svg$/);
  const broken = await ok('export_start', { format: 'gif' });
  expect(broken.body.result.status).toBe('failed');
  expect(broken.body.warnings[0]).toContain('Unknown format');

  // jobs: running → cancelled before it lands, a failed one, a finished one, and a stranger's
  const slow = await ok('export_start', { format: 'dotlottie', wait: false });
  const slowId = slow.body.result.jobId as string;
  expect((await ok('job_cancel', { jobId: slowId })).body.result.status).toBe('cancelled');
  await new Promise((r) => setTimeout(r, 300));
  expect((await ok('job_get', { jobId: slowId })).body.result.status).toBe('cancelled');
  expect((await bad('job_result', { jobId: slowId }, 'JOB_NOT_DONE')).error.suggestion).toBe('');
  const failedId = broken.body.result.jobId as string;
  expect((await bad('job_result', { jobId: failedId }, 'JOB_NOT_DONE')).error.suggestion).toContain('Unknown format');
  const doneId = svg.body.result.jobId as string;
  expect((await ok('job_cancel', { jobId: doneId })).body.result.status).toBe('done');
  expect((await ok('job_result', { jobId: doneId })).resource?.mimeType).toBe('image/svg+xml');
  expect((await ok('job_list')).body.result.length).toBeGreaterThan(5);
  const running = await ok('export_start', { format: 'runtime', wait: false });
  expect((await bad('job_result', { jobId: running.body.result.jobId }, 'JOB_NOT_DONE')).error.suggestion).toBe('job_get until done.');
  await bad('job_get', { jobId: 'job_missing' }, 'NOT_FOUND');
  const stranger = await connect((await tokensService.createPat(ZED, { name: 'stranger' })).token);
  expect((await call(stranger, 'job_get', { jobId: doneId })).body.error.code).toBe('NOT_FOUND');
  await stranger.close();

  // a failed upload link must not lose the file
  const { putExport } = await import('../storage.service.js');
  void putExport;
  // the run and proposal records
  expect((await ok('run_get')).body.result.operations.length).toBeGreaterThan(5);
  await bad('proposal_get', { proposalId: 'prop_missing' }, 'NOT_FOUND');
  await c.close();
}, 90_000);

it('the endpoint refuses a first request that is not an initialize, and a stream for a session that is not yours', async () => {
  const { token } = await tokensService.createPat(IDA, { name: 'endpoint' });
  const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const noSession = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(noSession.status).toBe(400);
  const unknownPost = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...auth, 'mcp-session-id': 'nope' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(unknownPost.status).toBe(404);
  expect((await fetch(`${base}/mcp`, { headers: auth })).status).toBe(404);                      // GET with no session id at all
  expect((await fetch(`${base}/mcp`, { method: 'DELETE', headers: { ...auth, 'mcp-session-id': 'nope' } })).status).toBe(404);
});

/**
 * Last on purpose: it advances the clock a day and sweeps, which closes every project another
 * case might still have open.
 */
it('sweeps: nothing fresh is dropped, and everything stale is', async () => {
  const { workspace } = await import('./workspace.js');
  const { token } = await tokensService.createPat(IDA, { name: 'sweep' });
  const c = await connect(token);                                   // a live MCP session
  await call(c, 'project_create', { name: 'Sweep me' });
  const pid = db.projects.get([...db.projects.keys()].at(-1)!)!.id as string;
  const exported = await call(c, 'export_start', { format: 'svg' });  // a job
  const jobId = exported.body.result.jobId as string;
  const prop = workspace.propose({ userId: IDA, projectId: pid, client: 'unit', capability: 'add_layer', args: {}, summary: 's', preview: { created: [], deleted: [], changed: [] } });

  sweeps.forEach((f) => f());                                       // fresh: all of it survives
  expect(workspace.get(IDA, pid)).toBeDefined();
  expect(workspace.proposal(IDA, prop.id)).toBeDefined();
  expect((await call(c, 'job_get', { jobId })).body.ok).toBe(true);

  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 25 * 3600_000);
  try {
    sweeps.forEach((f) => f());                                     // a day on: all of it goes
    expect(workspace.get(IDA, pid)).toBeUndefined();
    expect(workspace.proposal(IDA, prop.id)).toBeUndefined();
  } finally { vi.useRealTimers(); }
  await c.close().catch(() => {});            // its session was swept with everything else
  const again = await connect(token);
  expect((await call(again, 'job_get', { jobId })).body.error.code).toBe('NOT_FOUND');
  await again.close();
});


it('survives the small failures around a call: audit and notification writes, a missing arguments object', async () => {
  const { mcpRepository } = await import('../../repositories/mcp.repository.js');
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { token } = await tokensService.createPat(GUS, { name: 'small failures' });
  const c = await connect(token);
  // a call with no arguments at all
  const bare = JSON.parse(((await c.callTool({ name: 'account_whoami' })) as ToolResult).content[0]!.text!);
  expect(bare.ok).toBe(true);
  // the audit trail failing must not fail the call
  const audit = vi.spyOn(mcpRepository, 'audit').mockRejectedValue(new Error('audit down'));
  expect((await call(c, 'account_whoami')).body.ok).toBe(true);
  audit.mockRestore();
  // a notification that cannot be delivered is dropped
  await call(c, 'project_create', { name: 'Notify' });
  const send = vi.spyOn(Server.prototype, 'sendResourceUpdated').mockRejectedValue(new Error('closed'));
  await c.subscribeResource({ uri: 'blooby://project/current' });
  expect((await call(c, 'set_property', { nodeId: 'body', property: 'transform.rotation', value: 4 })).body.ok).toBe(true);
  await new Promise((r) => setTimeout(r, 50));
  expect(send).toHaveBeenCalled();
  send.mockRestore();
  await c.close();
});

it('a stale project says so on the first call after the editor saved, whichever call that is', async () => {
  const { token } = await tokensService.createPat(GUS, { name: 'stale' });
  const c = await connect(token);
  const made = await call(c, 'project_create', { name: 'Stale' });
  const pid = made.body.result.projectId as string;
  await call(c, 'project_save');
  const bump = async () => {
    const row = db.projects.get(pid)!;
    await projectsService.save(pid, GUS, { project: JSON.parse(db.objects.get(row.s3Key)!), expectedVersion: row.currentVersion });
  };
  await bump();
  expect((await call(c, 'project_current')).body.warnings?.[0]).toContain('changed in the editor');
  await bump();
  expect((await call(c, 'render_frame')).body.warnings?.[0]).toContain('changed in the editor');
  await c.close();
});

it('the small corners of the server capabilities', async () => {
  const { conn, run } = await pipeline();
  const { workspace } = await import('./workspace.js');
  const { Resvg } = await import('@resvg/resvg-js');
  const user = '3c000000-0000-4000-8000-00000000000a';
  const c = conn(user);

  // listing recent projects can fail without hiding the real refusal, and so can the duplicate check
  const list = vi.spyOn(projectsService, 'list').mockRejectedValueOnce(new Error('db'));
  expect((await run(c, 'editor_get_state')).body.error.code).toBe('NO_PROJECT');
  list.mockRejectedValueOnce(new Error('db'));
  expect((await run(c, 'project_create', { name: 'No twin check' })).body.ok).toBe(true);
  await run(c, 'project_close');
  list.mockRestore();

  // nothing open: a run record without a project, closing nothing, listing without a limit
  expect((await run(c, 'run_get')).body.result.checkpoints).toEqual([]);
  expect((await run(c, 'project_close')).body.ok).toBe(true);
  expect((await run(c, 'preset_list', { source: 'mine' })).body.result.presets).toBeDefined();
  // a connection that names a project the server no longer holds still lists presets
  c.projectId = 'not-open-any-more';
  expect((await run(c, 'preset_list', { offset: 1 })).body.ok).toBe(true);
  c.projectId = null;

  // a project with no name exports under a default one; a huge export is not inlined
  const made = await run(c, 'project_create', { name: 'Named' });
  const pid = made.body.result.projectId as string;
  const o = workspace.get(user, pid)!;
  await o.session.rename('');
  const unnamed = await run(c, 'export_start', { format: 'svg' });
  expect(unnamed.body.result.file.filename).toMatch(/^blooby-/);
  const frameSvg = vi.spyOn(o.session, 'frameSvg').mockResolvedValueOnce(`<svg xmlns="http://www.w3.org/2000/svg">${'x'.repeat(250_000)}</svg>`);
  const bigSvg = await callToolParts(c, 'export_start', { format: 'svg' });
  expect(bigSvg.resources).toHaveLength(0);
  frameSvg.mockRestore();
  const render = vi.spyOn(Resvg.prototype, 'render').mockReturnValueOnce({ asPng: () => Buffer.alloc(1_600_000) } as never);
  const bigPng = await callToolParts(c, 'export_start', { format: 'png' });
  expect(bigPng.resources).toHaveLength(0);
  render.mockRestore();
  // artwork with nothing readable in it is named in the export note, not drawn as a stand-in
  await run(c, 'add_svg', { markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="5">hi</text></svg>', name: 'unreadable' });
  const noted = await run(c, 'export_start', { format: 'lottie' });
  expect(noted.body.result.file.warnings.join()).toContain('skipped');
  // a storage hiccup costs the download link, not the file
  const { putExport } = await import('../storage.service.js');
  (putExport as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('s3'));
  const linkless = await run(c, 'export_start', { format: 'svg' });
  expect(linkless.body.result).toMatchObject({ status: 'done', file: { downloadUrl: null } });
  // a job that throws something that is not an Error is still reported
  const failing = vi.spyOn(o.session, 'frameSvg').mockRejectedValueOnce('not an error object');
  const failed = await run(c, 'export_start', { format: 'svg' });
  expect(failed.body.result.error).toBe('not an error object');
  failing.mockRestore();

  // proposals, as the agent reads them back: pending, and failed with a message
  const mk = (capability: string) => workspace.propose({ userId: user, projectId: pid, client: 'unit', capability, args: {}, summary: 's', preview: { created: [], deleted: [], changed: [] } });
  const pending = mk('add_layer');
  expect((await run(c, 'proposal_get', { proposalId: pending.id })).body.result).toMatchObject({ status: 'pending', result: null, error: null });
  const doomed = mk('not_a_capability');
  await workspace.decide(user, doomed.id, true);
  expect((await run(c, 'proposal_get', { proposalId: doomed.id })).body.result.error).toBeTruthy();

  // closing a dirty project whose save fails does not throw
  await o.session.invoke('add_layer', { type: 'shape', shape: 'star', name: 'unsaved' });
  const { projectsService: ps } = { projectsService };
  const save = vi.spyOn(ps, 'save').mockRejectedValue(new Error('nope'));
  workspace.close(user, pid);
  await new Promise((r) => setTimeout(r, 20));
  save.mockRestore();
});

async function callToolParts(c: unknown, name: string, args: Record<string, unknown>) {
  const { callTool } = await import('./server.js');
  const r = await callTool(c as never, name, args);
  return { resources: r.content.filter((x) => x.type === 'resource') };
}

it('smaller rules in projects, users and traffic that only show up with real-looking data', async () => {
  // a stranger saving against a stale version of a public, editable project is told to reload
  const pub = await projectsService.create(ZED, { name: 'Shared edit', project: {} });
  await projectsService.update(pub.id, ZED, { visibility: 'public', access: 'edit' });
  await expect(projectsService.save(pub.id, IDA, { project: {}, expectedVersion: 999 })).rejects.toMatchObject({ status: 409 });
  // bookkeeping failures never fail the request that triggered them
  const { projectsRepository } = await import('../../repositories/projects.repository.js');
  const countView = vi.spyOn(projectsRepository, 'countView').mockRejectedValue(new Error('x'));
  const countDuplicate = vi.spyOn(projectsRepository, 'countDuplicate').mockRejectedValue(new Error('x'));
  expect((await projectsService.touchOpened(pub.id, IDA)).id).toBe(pub.id);
  expect((await projectsService.duplicate(pub.id, IDA, 'Mine')).name).toBe('Mine');
  countView.mockRestore(); countDuplicate.mockRestore();
});

it('auth bookkeeping: last-used and client-touch writes may fail, a deleted client still has a consent page, a lost race is a conflict', async () => {
  const { mcpRepository } = await import('../../repositories/mcp.repository.js');
  const { tokensService, consentService, oauthProvider } = await import('./auth.service.js');
  const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number }) => e.status ?? -1);

  // a stale last-used write that fails is ignored
  const { token, meta } = await tokensService.createPat(IDA, { name: 'bookkeeping' });
  db.tokens.get(meta.id)!.lastUsedAt = new Date(Date.now() - 3600_000);
  const update = vi.spyOn(mcpRepository, 'updateToken').mockRejectedValueOnce(new Error('x'));
  expect((await tokensService.verify(token)).userId).toBe(IDA);
  update.mockRestore();
  // a recently used one is not rewritten
  await tokensService.revokePat(IDA, (await tokensService.createPat(IDA, { name: 'drop cache' })).meta.id);
  db.tokens.get(meta.id)!.lastUsedAt = new Date();
  const quiet = vi.spyOn(mcpRepository, 'updateToken');
  await tokensService.verify(token);
  expect(quiet).not.toHaveBeenCalled();
  quiet.mockRestore();

  // a request whose client is gone and whose scope the server does not know, parked with no params
  const parked = await mcpRepository.createToken({ kind: 'request', clientId: 'deleted-client', scopes: ['mystery:scope'], redirectUri: 'https://app.example/cb', codeChallenge: 'c', params: null, expiresAt: new Date(Date.now() + 60_000), tokenHash: randomUUID() } as never);
  const described = await consentService.describe(parked.id);
  expect(described.clientName).toBe('An AI client');
  expect(described.scopes).toEqual([{ scope: 'mystery:scope', description: 'mystery:scope' }]);
  const racing = vi.spyOn(mcpRepository, 'spend').mockResolvedValueOnce(0);
  expect(await status(consentService.decide(parked.id, IDA, { approve: true }))).toBe(409);
  racing.mockRestore();
  const answered = await consentService.decide(parked.id, IDA, { approve: false });
  expect(new URL(answered.redirectTo).searchParams.has('state')).toBe(false);

  // an expired refresh token with no grant behind it is refused without revoking anything
  const orphan = await mcpRepository.createToken({ kind: 'refresh', tokenHash: createHash('sha256').update('orphan-secret').digest('hex'), userId: IDA, clientId: (await oauthProvider.clientsStore.registerClient!({ redirect_uris: ['https://app.example/cb'] } as never) as { client_id: string }).client_id, grantId: null, scopes: ['project:read'], mode: 'full', expiresAt: new Date(Date.now() - 1000) } as never);
  await expect(oauthProvider.exchangeRefreshToken({ client_id: orphan.clientId } as never, 'orphan-secret', undefined)).rejects.toThrow(/already used or revoked/);

  // a refresh token that is live but loses the spend race revokes its grant; touching the client may fail
  const client = await oauthProvider.clientsStore.registerClient!({ redirect_uris: ['https://app.example/cb'], client_name: 'Racer' } as never) as { client_id: string };
  const me = { client_id: client.client_id } as never;
  const grantId = randomUUID();
  const refresh = await mcpRepository.createToken({ kind: 'refresh', tokenHash: createHash('sha256').update('rt-secret').digest('hex'), userId: IDA, clientId: client.client_id, grantId, scopes: ['project:read'], mode: 'full', expiresAt: new Date(Date.now() + 60_000) } as never);
  const lost = vi.spyOn(mcpRepository, 'spend').mockResolvedValueOnce(0);
  await expect(oauthProvider.exchangeRefreshToken(me, 'rt-secret', undefined)).rejects.toThrow(/already used or revoked/);
  lost.mockRestore();
  expect(db.tokens.get(refresh.id)!.revokedAt).not.toBeNull();
  const touch = vi.spyOn(mcpRepository, 'touchClient').mockRejectedValue(new Error('x'));
  const code = await mcpRepository.createToken({ kind: 'code', tokenHash: createHash('sha256').update('code-secret').digest('hex'), userId: IDA, clientId: client.client_id, grantId: randomUUID(), scopes: ['project:read'], mode: 'full', redirectUri: 'https://app.example/cb', codeChallenge: 'c', expiresAt: new Date(Date.now() + 60_000) } as never);
  expect((await oauthProvider.exchangeAuthorizationCode(me, 'code-secret', undefined, 'https://app.example/cb')).access_token).toBeTruthy();
  void code;
  touch.mockRestore();
});
