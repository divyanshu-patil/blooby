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
  putExport: async (userId: string, jobId: string, filename: string) => ({ key: `${userId}/${jobId}/${filename}`, url: `https://s3.test/${jobId}/${filename}` }),
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

const { createApp } = await import('../../app.js');
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

  // 2. create a project
  const created = await call(c, 'project_create', { name: 'Happy entrance' });
  expect(created.body.ok).toBe(true);
  const projectId = created.body.result.projectId as string;

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
