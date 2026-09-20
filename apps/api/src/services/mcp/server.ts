import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema, ReadResourceRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema,
  type CallToolResult, type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  capabilities, capability, CapabilityError, CAPABILITY_VERSION, GUIDE_TOPICS, guide, MCP_WORKFLOW, PROJECT_TYPES_SOURCE, presetData, summaryOf,
  type Capability,
} from '@blooby/studio/engine';
import { mcpRepository } from '../../repositories/mcp.repository.js';
import { projectsService } from '../projects.service.js';
import { current, DESTRUCTIVE, HOST_HANDLERS, readExport, scratchSession, type Conn, type HostResult } from './host.js';
import { libraryFor, openProjectOf, workspace } from './workspace.js';
import { PROMPTS } from './prompts.js';

/**
 * One MCP server per connection, generated from the capability registry.
 *
 * Tools are the registry filtered by what this connection was granted (scopes, and its
 * mode: read_only hides every mutation). Two tool profiles, because clients differ:
 *   compact (default) — ~45 everyday tools plus `invoke`, which runs ANY capability by id.
 *                       Keeps the tool list small for ChatGPT, Cursor and context budgets.
 *   full (?tools=full) — every capability as its own tool (~240), for clients with tool search.
 * Either way nothing is out of reach: capabilities_search + invoke cover all of it.
 */

export type Profile = 'compact' | 'full';

const CORE = new Set([
  'project_list', 'project_open', 'project_create', 'project_save', 'project_current', 'editor_get_state', 'timeline_get', 'inspector_get',
  'layer_find', 'search', 'capabilities_search', 'capability_get', 'guide_get', 'preset_search', 'preset_get', 'preset_apply', 'preset_save',
  'render_frame', 'render_sequence', 'evaluate', 'critique', 'export_start', 'job_get', 'history_undo', 'history_redo', 'transaction_begin',
  'transaction_commit', 'transaction_rollback', 'checkpoint_create', 'checkpoint_restore', 'checkpoint_diff', 'batch_execute', 'playhead_set',
  'set_property', 'add_keyframe', 'remove_keyframe', 'move_keyframe', 'add_layer', 'add_text', 'add_emitter', 'add_modifier',
  'set_layer_effect', 'create_preset', 'add_preset_to_timeline', 'apply_squish_preset', 'set_pose', 'add_mascot', 'run_get',
]);

const INVOKE: Tool = {
  name: 'invoke',
  title: 'Run any capability',
  description: 'Runs ANY Blooby capability by its id with its arguments — including every one not listed as a tool of its own here '
    + '(store actions like editor_set_easing, editor_group_layers, editor_add_timeline; text, curve, state-machine and mascot tools…). '
    + 'capabilities_search finds them; capability_get shows one\'s arguments and usage. Same validation, scopes and undo as a direct call.',
  inputSchema: { type: 'object', properties: { capability: { type: 'string' }, args: { type: 'object' } }, required: ['capability'], additionalProperties: false },
  annotations: { title: 'Run any capability', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const INSTRUCTIONS = `Blooby is a motion-design editor for mascot animation that exports Lottie. You are operating it as the signed-in person.
Start with project_list / project_open (or project_create), then editor_get_state and render_frame to SEE the project.
Before animating, read guide_get { topic: "craft" } and study a similar preset (preset_search → preset_get): match its timing and easing.
Edits autosave to the person's cloud project and appear in their editor; every edit is undoable (history_undo).
Check your work visually with render_frame / render_sequence and with critique, then export_start for Lottie or dotLottie.

${MCP_WORKFLOW}`;

const allowed = (conn: Conn, c: Capability) => conn.principal.scopes.includes(c.scope) && !(c.mutates && conn.principal.mode === 'read_only');

function toTool(c: Capability): Tool {
  const effect = c.mutates ? `changes the project${c.reversible ? ' (undoable)' : ''}` : 'read-only';
  const example = c.examples?.[0] ? `\nExample: ${JSON.stringify(c.examples[0])}` : '';
  return {
    name: c.id, title: c.title,
    description: `${c.description}\n\n[${c.category} · ${c.scope} · ${effect}]${example}`,
    inputSchema: c.inputSchema as Tool['inputSchema'],
    annotations: {
      title: c.title, readOnlyHint: !c.mutates, idempotentHint: !c.mutates, openWorldHint: false,
      destructiveHint: DESTRUCTIVE.has(c.id) || /^(remove|delete)_|_(remove|delete)/.test(c.id),
    },
  };
}

export function toolsFor(conn: Conn, profile: Profile): Tool[] {
  const list = capabilities().filter((c) => allowed(conn, c) && (profile === 'full' || CORE.has(c.id))).map(toTool);
  return profile === 'full' ? list : [...list, INVOKE];
}

// ---------------------------------------------------------------------------
// limits: generous for editing, tighter for the expensive paths

const windows = new Map<string, number[]>();
const inFlight = new Map<string, number>();
// Generous on purpose: an agent building an animation makes hundreds of small edits, and being
// throttled mid-run is worse than the load. These are an abuse ceiling, not a budget.
const LIMITS: [RegExp, number][] = [[/^render_/, 300], [/^export_start$/, 120], [/.*/, 6000]];
function throttle(userId: string, id: string) {
  const [re, max] = LIMITS.find(([r]) => r.test(id))!;
  const k = `${userId}:${re.source}`;
  const now = Date.now();
  const w = (windows.get(k) ?? []).filter((t) => now - t < 60_000);
  if (w.length >= max) throw new CapabilityError('RATE_LIMITED', `Too many ${re.source === '.*' ? 'calls' : id} calls — at most ${max} a minute.`, { retryAfterMs: 60_000 - (now - w[0]), suggestion: 'Batch edits with batch_execute; render at quality "preview".' });
  w.push(now);
  windows.set(k, w);
}

// ---------------------------------------------------------------------------
// one call, start to finish

const json = (v: unknown) => {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x instanceof Set ? [...x] : x), 1);
  return s.length > 80_000 ? `${s.slice(0, 80_000)}\n… [cut at 80,000 characters — narrow the request]` : s;
};

function failure(e: unknown): CallToolResult {
  const err = e instanceof CapabilityError ? e.toJSON() : { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) };
  return { isError: true, content: [{ type: 'text', text: json({ ok: false, error: err }) }] };
}

export async function callTool(conn: Conn, name: string, rawArgs: Record<string, unknown>): Promise<CallToolResult> {
  const started = Date.now();
  const id = name === 'invoke' ? String(rawArgs.capability ?? '') : name;
  const args = (name === 'invoke' ? rawArgs.args : rawArgs) as Record<string, unknown> ?? {};
  const { userId } = conn.principal;
  let projectId = conn.projectId;
  try {
    const cap = capability(id);
    if (!cap) throw new CapabilityError('UNKNOWN_CAPABILITY', `No capability "${id}".`, { suggestion: 'capabilities_search { query } lists them.' });
    if (!conn.principal.scopes.includes(cap.scope)) {
      throw new CapabilityError('FORBIDDEN_SCOPE', `This connection was not granted ${cap.scope}, which ${id} needs.`, { suggestion: 'The person can reconnect this client in Blooby → MCP with that permission.' });
    }
    if (cap.mutates && conn.principal.mode === 'read_only') throw new CapabilityError('READ_ONLY_CONNECTION', 'This connection may look but not change anything.');
    throttle(userId, id);
    const n = inFlight.get(userId) ?? 0;
    if (n >= 12) throw new CapabilityError('BUSY', 'Twelve calls are already running for this account — wait for one to finish.', { retryAfterMs: 500 });
    inFlight.set(userId, n + 1);

    let out: HostResult;
    try {
      if (cap.mutates && conn.principal.mode === 'suggest' && cap.kind !== 'server') out = await propose(conn, id, args);
      else if (cap.mutates && conn.principal.mode === 'suggest' && DESTRUCTIVE.has(id)) throw new CapabilityError('NOT_IN_SUGGEST_MODE', 'Deleting is not available in "ask me first" mode.');
      else if (HOST_HANDLERS.has(id)) out = await HOST_HANDLERS.get(id)!(conn, args);
      else if (!cap.requires.includes('project') && !conn.projectId && !openProjectOf(userId)) {
        // discovery and the guides answer before anything is open
        const r = await (await scratchSession()).invoke(id, args);
        out = { summary: r.summary, data: r.result };
      } else {
        const { o, warning } = await current(conn);
        const before = o.session.revision;
        const r = await o.session.invoke(id, args);
        if (o.session.revision !== before) workspace.scheduleSave(o);
        conn.run.created += r.created.length;
        conn.run.changed += r.changed.length;
        const { summary, result, warnings, ok: _ok, ...meta } = r;
        out = { summary, data: result, meta, warnings: warning ? [warning, ...warnings] : warnings };
      }
    } finally { inFlight.set(userId, (inFlight.get(userId) ?? 1) - 1); }

    projectId = conn.projectId;
    record(conn, id, true, out.summary, Date.now() - started, projectId);
    const payload = { ok: true, summary: out.summary, ...out.meta, ...(out.data !== undefined ? { result: out.data } : {}), ...(out.warnings?.length ? { warnings: out.warnings } : {}) };
    return {
      content: [
        ...(out.images ?? []).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType })),
        { type: 'text' as const, text: json(payload) },
        ...(out.resources ?? []).map((r) => ({ type: 'resource' as const, resource: r as { uri: string; mimeType: string; text: string } })),
      ],
    };
  } catch (e) {
    const code = e instanceof CapabilityError ? e.code : 'INTERNAL';
    record(conn, id || name, false, '', Date.now() - started, projectId, code);
    conn.run.errors++;
    return failure(e);
  }
}

/** "Ask me first": dry-run it for a preview, park it, and let the person decide in the editor. */
async function propose(conn: Conn, id: string, args: Record<string, unknown>): Promise<HostResult> {
  const { o } = await current(conn);
  const preview = await o.session.invoke(id, { ...args, dryRun: true });
  const p = workspace.propose({
    userId: conn.principal.userId, projectId: o.projectId, client: conn.principal.clientName, capability: id, args,
    summary: preview.summary, preview: { created: preview.created, deleted: preview.deleted, changed: preview.changed },
  });
  return {
    summary: `Waiting for approval: ${preview.summary}`,
    data: { status: 'pending_approval', proposalId: p.id, preview: p.preview, next: 'The person approves or rejects it in the Blooby editor (MCP tab). Poll proposal_get { proposalId }.' },
  };
}

function record(conn: Conn, capability: string, ok: boolean, summary: string, ms: number, projectId: string | null, error?: string) {
  const at = new Date().toISOString();
  conn.run.ops.push({ at, capability, ok, summary, ...(error ? { error } : {}) });
  if (conn.run.ops.length > 1000) conn.run.ops.shift();
  const o = projectId ? workspace.get(conn.principal.userId, projectId) : undefined;
  if (o) workspace.record(o, { at, client: conn.principal.clientName, capability, summary, ok, ...(error ? { error } : {}) });
  // names and ids only: never arguments, tokens or project content
  void mcpRepository.audit({
    userId: conn.principal.userId, clientId: conn.principal.clientId.startsWith('pat:') ? null : conn.principal.clientId, tokenId: conn.principal.tokenId,
    operation: capability.slice(0, 80), projectId, ok, errorCode: error ?? null, runId: conn.run.runId, durationMs: ms,
  }).catch(() => {});
  if (process.env.NODE_ENV !== 'test') console.info(JSON.stringify({ mcp: capability, ok, ms, ...(error ? { error } : {}), user: conn.principal.userId.slice(0, 8), client: conn.principal.clientName }));
}

// ---------------------------------------------------------------------------
// resources: read-only context an agent (or its host app) can pull in without a tool call

const STATIC = [
  ...GUIDE_TOPICS.map((t) => ({ uri: `blooby://guide/${t}`, name: `Guide: ${t}`, mimeType: 'text/markdown', description: `How Blooby works: ${t}` })),
  { uri: 'blooby://capabilities', name: 'Capabilities', mimeType: 'application/json', description: 'Every capability: id, category, scope, one-line summary' },
  { uri: 'blooby://schema/project', name: 'Project data model', mimeType: 'text/typescript', description: 'core/types.ts — the whole document model, with the reasoning in its comments' },
  { uri: 'blooby://project/current', name: 'Current project state', mimeType: 'application/json', description: 'The open project: layers, states, clips, playhead, selection, viewport' },
  { uri: 'blooby://project/current/timeline', name: 'Current timeline', mimeType: 'application/json', description: 'Tracks and keyframes of the active state, with ids' },
  { uri: 'blooby://project/current/document', name: 'Current project document', mimeType: 'application/json', description: 'The complete project JSON' },
  { uri: 'blooby://projects', name: 'My projects', mimeType: 'application/json', description: 'Your projects' },
  { uri: 'blooby://presets', name: 'Presets', mimeType: 'application/json', description: 'Every preset you can use, with what it does' },
];
const TEMPLATES = [
  { uriTemplate: 'blooby://presets/{id}', name: 'A preset', mimeType: 'application/json', description: 'One preset\'s layers, tracks and keyframes' },
  { uriTemplate: 'blooby://layers/{id}', name: 'A layer', mimeType: 'application/json', description: 'One layer of the open project, as the inspector sees it' },
  { uriTemplate: 'blooby://exports/{jobId}/{filename}', name: 'An export', description: 'A file export_start produced' },
];

async function readResource(conn: Conn, uri: string) {
  const text = (v: unknown, mimeType = 'application/json') => ({ contents: [{ uri, mimeType, text: typeof v === 'string' ? v : json(v) }] });
  const need = (scope: Capability['scope']) => {
    if (!conn.principal.scopes.includes(scope)) throw new CapabilityError('FORBIDDEN_SCOPE', `Reading ${uri} needs ${scope}.`);
  };
  const g = /^blooby:\/\/guide\/(\w+)$/.exec(uri);
  if (g && guide(g[1])) return text(guide(g[1])!, 'text/markdown');
  if (uri === 'blooby://capabilities') return text({ capabilityVersion: CAPABILITY_VERSION, capabilities: capabilities().filter((c) => allowed(conn, c)).map(summaryOf) });
  if (uri === 'blooby://schema/project') return text(PROJECT_TYPES_SOURCE, 'text/typescript');
  if (uri === 'blooby://projects') {
    need('project:read');
    const { items } = await projectsService.list(conn.principal.userId, { limit: 100, sort: 'recent' });
    return text(items.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, visibility: p.visibility })));
  }
  if (uri.startsWith('blooby://project/current')) {
    need('project:read');
    const { o } = await current(conn);
    if (uri.endsWith('/document')) return text(o.session.project);
    const r = await o.session.invoke(uri.endsWith('/timeline') ? 'timeline_get' : 'editor_get_state', uri.endsWith('/timeline') ? {} : { level: 'standard' });
    return text(r.result);
  }
  const layer = /^blooby:\/\/layers\/(.+)$/.exec(uri);
  if (layer) { need('project:read'); const { o } = await current(conn); return text((await o.session.invoke('inspector_get', { nodeId: decodeURIComponent(layer[1]) })).result); }
  if (uri === 'blooby://presets') { need('preset:read'); return text((await HOST_HANDLERS.get('preset_list')!(conn, { limit: 100 })).data); }
  const preset = /^blooby:\/\/presets\/(.+)$/.exec(uri);
  if (preset) {
    need('preset:read');
    const lib = await libraryFor(conn.principal.userId);
    const found = lib.presets.find((p) => p.id === decodeURIComponent(preset[1]));
    if (found) return text(presetData(found));
    return text((await HOST_HANDLERS.get('preset_get')!(conn, { preset: decodeURIComponent(preset[1]) })).data);
  }
  const exp = /^blooby:\/\/exports\/([^/]+)/.exec(uri);
  if (exp) {
    const j = readExport(conn.principal.userId, exp[1]);
    if (!j?.result) throw new CapabilityError('NOT_FOUND', 'No such export (they last 30 minutes).');
    const isText = j.result.mimeType === 'application/json' || j.result.mimeType.startsWith('image/svg');
    return { contents: [isText ? { uri, mimeType: j.result.mimeType, text: j.result.bytes.toString('utf8') } : { uri, mimeType: j.result.mimeType, blob: j.result.bytes.toString('base64') }] };
  }
  throw new CapabilityError('NOT_FOUND', `No resource ${uri}.`);
}

// ---------------------------------------------------------------------------

export function createMcpServer(conn: Conn, profile: Profile): Server {
  const server = new Server(
    { name: 'blooby', title: 'Blooby Studio', version: CAPABILITY_VERSION },
    { capabilities: { tools: {}, resources: { subscribe: true }, prompts: {}, logging: {} }, instructions: INSTRUCTIONS },
  );

  // tell a subscribed client when the open project changes, whoever changed it
  let watching: { projectId: string; stop: () => void } | null = null;
  const watch = () => {
    if (watching?.projectId === conn.projectId) return;
    watching?.stop();
    watching = null;
    const o = conn.projectId ? workspace.get(conn.principal.userId, conn.projectId) : undefined;
    if (!o) return;
    const stop = o.session.on((e) => {
      if (e.type !== 'changed') return;
      for (const uri of conn.subscriptions) if (uri.startsWith('blooby://project/current')) void server.sendResourceUpdated({ uri }).catch(() => {});
    });
    watching = { projectId: o.projectId, stop: () => { stop(); } };
  };
  server.onclose = () => watching?.stop();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(conn, profile) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await callTool(conn, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    watch();
    return r;
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: STATIC }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: TEMPLATES }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => readResource(conn, req.params.uri));
  server.setRequestHandler(SubscribeRequestSchema, async (req) => { conn.subscriptions.add(req.params.uri); watch(); return {}; });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => { conn.subscriptions.delete(req.params.uri); return {}; });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS.map(({ build: _b, ...p }) => p) }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = PROMPTS.find((x) => x.name === req.params.name);
    if (!p) throw new CapabilityError('NOT_FOUND', `No prompt "${req.params.name}".`);
    return { description: p.description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.build(req.params.arguments ?? {}) } }] };
  });
  return server;
}
