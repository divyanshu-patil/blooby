import { randomUUID } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import {
  activeTimeline, bakeLottie, buildDotLottie, buildRuntimePack, builtinPresets, CapabilityError, compOf, defaultProject, EditorSession,
  presetData, presetTags, registerCapabilities, searchPresets, type Capability, type JsonSchema, type Preset, type Project,
} from '@blooby/studio/engine';
import { env } from '../../config/env.js';
import { assetsService } from '../assets.service.js';
import { projectsService } from '../projects.service.js';
import { putExport } from '../storage.service.js';
import { HttpError } from '../../utils/httpError.js';
import { forgetLibrary, libraryFor, openProjectOf, rememberOpen, workspace, type OpenProject } from './workspace.js';
import type { Principal } from './auth.service.js';

/**
 * The capabilities that need the server rather than an editor session: which project is
 * open, the cloud library, PNG rendering, export files, jobs and the agent run record.
 * They join the same registry as the editor's own (see packages/studio/src/engine/registry.ts),
 * so discovery, scopes and the MCP tool list treat them identically.
 */

export interface Run {
  runId: string; startedAt: string; goal: string | null; projects: Set<string>;
  ops: { at: string; capability: string; ok: boolean; summary: string; error?: string }[];
  created: number; changed: number; errors: number;
}

/** One MCP connection: who, which project is current, and its run so far. */
export interface Conn {
  principal: Principal;
  projectId: string | null;
  run: Run;
  subscriptions: Set<string>;
}

export interface HostResult {
  summary: string;
  data?: unknown;
  images?: { data: string; mimeType: string }[];
  resources?: { uri: string; mimeType: string; text?: string; blob?: string }[];
  warnings?: string[];
  /** operation fields (revision, created, changed…) shown beside `result`, not inside it */
  meta?: Record<string, unknown>;
}

export const newRun = (goal: string | null = null): Run => ({
  runId: `run_${randomUUID().slice(0, 8)}`, startedAt: new Date().toISOString(), goal, projects: new Set(), ops: [], created: 0, changed: 0, errors: 0,
});

/** Note which project this person is working on, for this connection and for the next one. */
export function setProject(conn: Conn, projectId: string) {
  conn.projectId = projectId;
  conn.run.projects.add(projectId);
  rememberOpen(conn.principal.userId, projectId);
}

/**
 * The project this person works on, opened and synced — or a refusal they can act on.
 *
 * Falls back to the project they last opened, because a client that does not keep its MCP
 * session (ChatGPT's connector, among others) arrives on a new connection every call, and
 * "the project I opened" must survive that.
 */
export async function current(conn: Conn): Promise<{ o: OpenProject; warning: string | null }> {
  const projectId = conn.projectId ?? openProjectOf(conn.principal.userId);
  if (!projectId) {
    const recent = await projectsService.list(conn.principal.userId, { limit: 5, sort: 'recent' })
      .then((p) => p.items.map((x) => ({ id: x.id, name: x.name }))).catch(() => []);
    throw new CapabilityError('NO_PROJECT', 'No project is open.', {
      recentProjects: recent,
      suggestion: recent.length
        ? `project_open { projectId: "${recent[0].id}" } opens “${recent[0].name}”, your most recent. project_create { name } starts a new one.`
        : 'project_create { name } starts one.',
    });
  }
  const o = await workspace.open(conn.principal.userId, projectId).catch(asCapabilityError);
  setProject(conn, projectId);
  return { o, warning: await workspace.sync(o) };
}

/**
 * A throwaway session for the capabilities that do not need a document — capability search,
 * the guides. Without it an agent could not look anything up before opening a project.
 */
let scratch: Promise<EditorSession> | null = null;
export const scratchSession = () => (scratch ??= EditorSession.open(defaultProject()));

function asCapabilityError(e: unknown): never {
  if (e instanceof CapabilityError) throw e;
  if (e instanceof HttpError) {
    const code = e.status === 404 ? 'NOT_FOUND' : e.status === 403 ? 'FORBIDDEN' : e.status === 409 ? 'REVISION_CONFLICT' : e.status === 413 ? 'TOO_LARGE' : 'REQUEST_FAILED';
    throw new CapabilityError(code, e.message);
  }
  throw e;
}

// ---------------------------------------------------------------------------
// rendering

const QUALITY = { preview: 360, medium: 720, final: 1440 } as const;
type Quality = keyof typeof QUALITY;

export function png(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(Math.min(2400, Math.max(64, width))) }, font: { loadSystemFonts: true }, background: 'rgba(0,0,0,0)' })
    .render().asPng();
}

// ---------------------------------------------------------------------------
// jobs

interface Job {
  id: string; userId: string; label: string; status: 'running' | 'done' | 'failed' | 'cancelled'; progress: number;
  startedAt: string; finishedAt?: string; error?: string; cancelled?: boolean;
  result?: { filename: string; mimeType: string; bytes: Buffer; url: string | null; warnings: string[]; info: Record<string, unknown> };
  done: Promise<void>;
}
const jobs = new Map<string, Job>();
setInterval(() => { for (const [id, j] of jobs) if (Date.now() - Date.parse(j.startedAt) > 30 * 60_000) jobs.delete(id); }, 60_000).unref();

function startJob(userId: string, label: string, work: (job: Job) => Promise<NonNullable<Job['result']>>): Job {
  const job = { id: `job_${randomUUID().slice(0, 8)}`, userId, label, status: 'running', progress: 0, startedAt: new Date().toISOString() } as Job;
  job.done = (async () => {
    try {
      const r = await work(job);
      if (job.cancelled) return;
      // the download link is a convenience: a storage hiccup must not lose the file itself
      r.url = await putExport(userId, job.id, r.filename, r.bytes, r.mimeType).then((x) => x.url).catch(() => null);
      Object.assign(job, { result: r, status: 'done', progress: 1 });
    } catch (e) {
      Object.assign(job, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally { job.finishedAt = new Date().toISOString(); }
  })();
  jobs.set(job.id, job);
  return job;
}

const jobOf = (conn: Conn, id: unknown) => {
  const j = jobs.get(String(id));
  if (!j || j.userId !== conn.principal.userId) throw new CapabilityError('NOT_FOUND', `No job "${id}".`, { suggestion: 'job_list shows your recent jobs.' });
  return j;
};
const jobView = (j: Job) => ({
  jobId: j.id, label: j.label, status: j.status, progress: j.progress, startedAt: j.startedAt, finishedAt: j.finishedAt ?? null, error: j.error ?? null,
  ...(j.result ? { file: { filename: j.result.filename, mimeType: j.result.mimeType, bytes: j.result.bytes.length, downloadUrl: j.result.url, warnings: j.result.warnings, ...j.result.info } } : {}),
});
function jobResources(j: Job): HostResult['resources'] {
  const r = j.result;
  if (!r) return [];
  const uri = `blooby://exports/${j.id}/${r.filename}`;
  const text = r.mimeType === 'application/json' || r.mimeType.startsWith('image/svg');
  if (text && r.bytes.length <= 200_000) return [{ uri, mimeType: r.mimeType, text: r.bytes.toString('utf8') }];
  if (!text && r.bytes.length <= 1_500_000) return [{ uri, mimeType: r.mimeType, blob: r.bytes.toString('base64') }];
  return [];
}
export const readExport = (userId: string, jobId: string) => {
  const j = jobs.get(jobId);
  return j && j.userId === userId ? j : undefined;
};

// ---------------------------------------------------------------------------
// presets, from every source

/** built once: making them costs ~90ms */
let builtins: Preset[] | null = null;
const builtinList = () => (builtins ??= builtinPresets());

async function everyPreset(conn: Conn): Promise<(Preset & { from: string })[]> {
  const lib = await libraryFor(conn.principal.userId);
  const project = conn.projectId ? workspace.get(conn.principal.userId, conn.projectId)?.session.project.presets ?? [] : [];
  const seen = new Set<string>();
  return [
    ...project.map((p) => ({ ...p, from: 'project' })),
    ...lib.presets.map((p) => ({ ...p, from: p.source === 'custom' ? 'mine' : p.source ?? 'library' })),
    ...builtinList().map((p) => ({ ...p, from: 'builtin' })),
  ].filter((p) => !seen.has(p.id) && seen.add(p.id));
}

async function findPresetAnywhere(conn: Conn, ref: unknown) {
  const s = String(ref ?? '').toLowerCase();
  const all = await everyPreset(conn);
  const p = all.find((x) => x.id.toLowerCase() === s) ?? all.find((x) => x.name.toLowerCase() === s);
  if (!p) throw new CapabilityError('NOT_FOUND', `No preset "${ref}".`, { suggestion: `preset_search { query: "${ref}" } finds presets by what they do.` });
  return p;
}

/**
 * Where a person opens this project.
 *
 * An AI client cannot show them the animation moving: it renders single frames, and GIF
 * and MP4 are encoded in the browser, not here. So every capability that names a project
 * hands back the link too — "here it is: <url>" is the one thing an assistant can say that
 * puts the running animation, the export menu and the timeline in front of them.
 */
export const editorUrl = (projectId: string) => `${env.appUrl}/projects/${projectId}`;

// ---------------------------------------------------------------------------
// the capabilities

type Handler = (conn: Conn, a: Record<string, unknown>) => Promise<HostResult>;
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' }, num = { type: 'number' }, bool = { type: 'boolean' };
const quality = { type: 'string', enum: Object.keys(QUALITY), description: 'preview 360px (cheap, for iterating), medium 720px, final 1440px' };

const HOST: (Omit<Capability, 'kind' | 'since' | 'requires' | 'reversible'> & { handler: Handler; requires?: Capability['requires']; destructive?: boolean })[] = [
  // --- projects ---------------------------------------------------------------------
  {
    id: 'project_list', title: 'List projects', category: 'project', mutates: false, scope: 'project:read',
    description: 'Your projects, newest first: id, name, visibility, last update, and the link to open each one in Blooby. q filters by name. Page with cursor.',
    inputSchema: obj({ q: str, limit: num, cursor: str }), examples: [{ q: 'intro' }],
    handler: async (conn, a) => {
      const page = await projectsService.list(conn.principal.userId, { limit: Math.min(50, Number(a.limit) || 20), cursor: a.cursor as string | undefined, q: a.q as string | undefined, sort: 'recent' });
      return { summary: `${page.items.length} project(s)`, data: { projects: page.items.map((p) => ({ id: p.id, name: p.name, visibility: p.visibility, updatedAt: p.updatedAt, open: p.id === conn.projectId, url: editorUrl(p.id) })), nextCursor: page.nextCursor } };
    },
  },
  {
    id: 'project_open', title: 'Open a project', category: 'project', mutates: false, scope: 'project:read',
    description: 'Opens a project for this connection — every editing capability then works on it. By id, or by name (exact first, then contains). Shared with the Blooby editor: your edits autosave, and the person sees them.',
    inputSchema: obj({ projectId: str, name: str }), examples: [{ name: 'Product intro' }],
    handler: async (conn, a) => {
      let id = typeof a.projectId === 'string' ? a.projectId : null;
      if (!id && typeof a.name === 'string') {
        const { items } = await projectsService.list(conn.principal.userId, { limit: 50, q: a.name, sort: 'recent' });
        const hit = items.find((p) => p.name.toLowerCase() === String(a.name).toLowerCase()) ?? items[0];
        if (!hit) throw new CapabilityError('NOT_FOUND', `No project named "${a.name}".`, { suggestion: 'project_list shows them; project_create makes one.' });
        id = hit.id;
      }
      if (!id) throw new CapabilityError('MISSING_ARGUMENT', 'Give projectId or name.', { field: 'projectId' });
      const o = await workspace.open(conn.principal.userId, id).catch(asCapabilityError);
      setProject(conn, id);
      const state = (await o.session.invoke('editor_get_state', { level: 'standard' })).result;
      return { summary: `Opened “${o.name}”`, data: { projectId: id, name: o.name, url: editorUrl(id), canEdit: o.canEdit, state, next: 'render_frame to see it; guide_get { topic: "workflow" } for how to work. `url` is where the person opens it — give it to them when they want to watch it play or export a GIF.' } };
    },
  },
  {
    id: 'project_create', title: 'Create a project', category: 'project', mutates: true, scope: 'project:write',
    description: 'A new cloud project with the default mascot, opened on this connection. It appears on the person\'s dashboard straight away, and `url` in the result is the link to give them.',
    inputSchema: obj({ name: str }, ['name']), examples: [{ name: 'Happy entrance' }],
    handler: async (conn, a) => {
      const twin = await projectsService.list(conn.principal.userId, { limit: 5, q: String(a.name), sort: 'recent' })
        .then((p) => p.items.find((x) => x.name.toLowerCase() === String(a.name).toLowerCase())).catch(() => undefined);
      const row = await projectsService.create(conn.principal.userId, { name: String(a.name).slice(0, 120), project: {} }).catch(asCapabilityError);
      const o = await workspace.open(conn.principal.userId, row.id);
      setProject(conn, row.id);
      workspace.scheduleSave(o);   // write the full default document, not the `{}` seed
      return {
        summary: `Created “${row.name}”`,
        data: { projectId: row.id, name: row.name, url: editorUrl(row.id), state: (await o.session.invoke('editor_get_state', { level: 'standard' })).result },
        warnings: twin ? [`You already had a project called “${twin.name}” (${twin.id}); this is a second one. project_delete removes either.`] : [],
      };
    },
  },
  {
    id: 'project_current', title: 'The open project', category: 'project', mutates: false, scope: 'project:read',
    description: 'Which project this connection has open, its stored version, and whether there are unsaved changes.',
    inputSchema: obj({}),
    handler: async (conn) => {
      if (!conn.projectId) return { summary: 'No project open', data: { projectId: null, next: 'project_open or project_create' } };
      const { o, warning } = await current(conn);
      return { summary: o.name, data: { projectId: o.projectId, name: o.name, url: editorUrl(o.projectId), canEdit: o.canEdit, storedVersion: o.baseVersion, ...o.session.status(), lastSaveError: o.lastSaveError ?? null }, warnings: warning ? [warning] : [] };
    },
  },
  {
    id: 'project_save', title: 'Save', category: 'project', mutates: true, scope: 'project:write',
    description: 'Saves to the cloud now (edits also autosave a few seconds after they stop). If the project was saved from the editor in between, this is a REVISION_CONFLICT; force: true overwrites it.',
    inputSchema: obj({ force: bool }),
    handler: async (conn, a) => {
      const { o } = await current(conn);
      const res = await workspace.save(o, a.force === true);
      return { summary: `Saved (version ${res.version})`, data: res };
    },
  },
  {
    id: 'project_reload', title: 'Reload from the cloud', category: 'project', mutates: true, scope: 'project:write',
    description: 'Throws away unsaved AI changes and loads the stored project — how to take the editor\'s version after a conflict.',
    inputSchema: obj({}),
    handler: async (conn) => {
      if (!conn.projectId) throw new CapabilityError('NO_PROJECT', 'No project is open.');
      const o = await workspace.open(conn.principal.userId, conn.projectId);
      await workspace.reload(o);
      return { summary: `Reloaded version ${o.baseVersion}`, data: { version: o.baseVersion } };
    },
  },
  {
    id: 'project_rename', title: 'Rename', category: 'project', mutates: true, scope: 'project:write',
    description: 'Renames the open project (owner only).',
    inputSchema: obj({ name: str }, ['name']),
    handler: async (conn, a) => {
      const { o } = await current(conn);
      await projectsService.update(o.projectId, conn.principal.userId, { name: String(a.name).slice(0, 120) }).catch(asCapabilityError);
      o.name = String(a.name);
      await o.session.rename(String(a.name));
      workspace.scheduleSave(o);
      return { summary: `Renamed to “${a.name}”` };
    },
  },
  {
    id: 'project_duplicate', title: 'Duplicate', category: 'project', mutates: true, scope: 'project:write',
    description: 'Copies a project (the open one, or projectId — any project you can see, including public ones) into your projects, and opens the copy. How to edit something view-only, or branch before a redesign.',
    inputSchema: obj({ projectId: str, name: str }),
    handler: async (conn, a) => {
      const source = (a.projectId as string | undefined) ?? conn.projectId;
      if (!source) throw new CapabilityError('NO_PROJECT', 'Open a project or give projectId.');
      const o = workspace.get(conn.principal.userId, source);
      if (o?.session.dirty && o.canEdit) await workspace.save(o);
      const copy = await projectsService.duplicate(source, conn.principal.userId, a.name as string | undefined).catch(asCapabilityError);
      await workspace.open(conn.principal.userId, copy.id);
      setProject(conn, copy.id);
      return { summary: `Duplicated as “${copy.name}” and opened it`, data: { projectId: copy.id, name: copy.name, url: editorUrl(copy.id) } };
    },
  },
  {
    id: 'project_close', title: 'Close', category: 'project', mutates: false, scope: 'project:read',
    description: 'Saves anything unsaved and closes the project on this connection.',
    inputSchema: obj({}),
    handler: async (conn) => {
      if (conn.projectId) {
        const o = workspace.get(conn.principal.userId, conn.projectId);
        if (o?.session.dirty && o.canEdit) await workspace.save(o).catch(() => undefined);
      }
      if (conn.projectId) workspace.close(conn.principal.userId, conn.projectId);
      conn.projectId = null;
      return { summary: 'Closed' };
    },
  },
  {
    id: 'project_delete', title: 'Delete a project', category: 'project', mutates: true, scope: 'project:write', destructive: true,
    description: 'Deletes one of your projects for good — it cannot be undone. Needs confirm: true. Only when the person clearly asked for it.',
    inputSchema: obj({ projectId: str, confirm: bool }, ['projectId', 'confirm']),
    handler: async (conn, a) => {
      if (a.confirm !== true) throw new CapabilityError('CONFIRMATION_REQUIRED', 'Deleting is permanent: pass confirm: true once the person has asked for it.', { field: 'confirm' });
      await projectsService.remove(String(a.projectId), conn.principal.userId).catch(asCapabilityError);
      workspace.close(conn.principal.userId, String(a.projectId));
      if (conn.projectId === a.projectId) conn.projectId = null;
      return { summary: 'Deleted' };
    },
  },

  // --- presets ------------------------------------------------------------------------
  {
    id: 'preset_search', title: 'Search presets', category: 'preset', mutates: false, scope: 'preset:read',
    description: 'Finds presets by what their keyframes actually DO — "jump", "squash", "wave", "blink", "particles", "curved text", "portal", "walk", "empty state"… — across the built-in library, the community, your own and the open project. Then preset_get to study one: that is how to match Blooby\'s quality.',
    inputSchema: obj({ query: str, limit: num }, ['query']), examples: [{ query: 'bouncy entrance' }],
    handler: async (conn, a) => {
      const all = await everyPreset(conn);
      const from = new Map(all.map((p) => [p.id, p.from]));
      const hits = searchPresets(all, String(a.query), Math.min(25, Number(a.limit) || 10)).map((h) => ({ ...h, source: from.get(h.id) }));
      return { summary: `${hits.length} preset(s)`, data: hits };
    },
  },
  {
    id: 'preset_list', title: 'List presets', category: 'preset', mutates: false, scope: 'preset:read',
    description: 'Every preset, filtered by source: builtin (Blooby\'s own), official, community, mine (your library), project (in the open project), or all. offset/limit page it.',
    inputSchema: obj({ source: { type: 'string', enum: ['all', 'builtin', 'official', 'community', 'mine', 'project'] }, offset: num, limit: num }),
    handler: async (conn, a) => {
      const all = (await everyPreset(conn)).filter((p) => !a.source || a.source === 'all' || p.from === a.source);
      const off = Math.max(0, Number(a.offset) || 0), lim = Math.min(100, Number(a.limit) || 50);
      return { summary: `${all.length} preset(s)`, data: { total: all.length, presets: all.slice(off, off + lim).map((p) => ({ id: p.id, name: p.name, tagline: p.tagline, source: p.from, durationMs: p.durationMs, tags: presetTags(p).slice(0, 12) })) } };
    },
  },
  {
    id: 'preset_get', title: 'Study a preset', category: 'preset', mutates: false, scope: 'preset:read',
    description: 'One preset\'s real data: its layers, every track with keyframes as [ms, value, easing], modifiers, emitters and ranges — learn timing, amplitude and easing from it. full: true returns the raw preset JSON exactly as stored (to copy, adapt or import).',
    inputSchema: obj({ preset: str, full: bool }, ['preset']), examples: [{ preset: 'Hop' }],
    handler: async (conn, a) => {
      const p = await findPresetAnywhere(conn, a.preset);
      const { from, ...raw } = p;
      return { summary: `Preset “${p.name}”`, data: a.full ? { source: from, preset: raw } : { source: from, ...presetData(p), tags: presetTags(p) } };
    },
  },
  {
    id: 'preset_apply', title: 'Apply a preset', category: 'preset', mutates: true, scope: 'project:write',
    description: 'Places any preset (built-in, library, community or the project\'s) as a clip on the open project\'s strip — appended, or at index — on a mascot\'s lane when mascot names one. It becomes part of the file.',
    inputSchema: obj({ preset: str, mascot: str, index: num, requestId: str }, ['preset']), examples: [{ preset: 'Wave', mascot: 'Mascot 2' }],
    handler: async (conn, a) => {
      const p = await findPresetAnywhere(conn, a.preset);
      const { o } = await current(conn);
      const project = o.session.project;
      const bodies = Object.values(project.rig.nodes).filter((n) => n.kind === 'body');
      const m = a.mascot === undefined ? undefined : bodies.find((b) => b.id === a.mascot || b.name.toLowerCase() === String(a.mascot).toLowerCase());
      if (a.mascot !== undefined && !m) throw new CapabilityError('NOT_FOUND', `No mascot "${a.mascot}".`, { suggestion: `Mascots: ${bodies.map((b) => b.name).join(', ')}` });
      // a library preset joins the session's catalog so the store's own addBlock can place it
      if (!project.presets.some((x) => x.id === p.id)) await o.session.extendCatalog([p]);
      const r = await o.session.invoke('editor_add_block', { presetId: p.id, ...(a.index !== undefined ? { index: a.index } : {}), ...(m ? { mascotId: m.id } : {}), ...(a.requestId ? { requestId: a.requestId } : {}) });
      return { summary: `Placed “${p.name}”`, data: r };
    },
  },
  {
    id: 'preset_save', title: 'Save a preset to the library', category: 'preset', mutates: true, scope: 'preset:write',
    description: 'Saves animation as a reusable preset in your Blooby library (private to you until you publish it). From one of the project\'s presets (preset: its name), or from the whole active timeline (omit preset) — every track becomes part of it.',
    inputSchema: obj({ name: str, preset: str, description: str, category: str, tags: { type: 'array', items: str } }, ['name']),
    examples: [{ name: 'Happy Entrance', description: 'Jumps in, squashes on landing, waves' }],
    handler: async (conn, a) => {
      const { o } = await current(conn);
      let data: Preset;
      if (a.preset) {
        const ref = String(a.preset).toLowerCase();
        const found = o.session.project.presets.find((p) => p.id === a.preset || p.name.toLowerCase() === ref);
        if (!found) throw new CapabilityError('NOT_FOUND', `The open project has no preset "${a.preset}".`, { suggestion: 'create_preset makes one; or omit preset to save the whole timeline.' });
        data = found;
      } else {
        const tl = activeTimeline(o.session.project);
        if (!tl.tracks.length) throw new CapabilityError('NOTHING_TO_SAVE', 'The timeline has no animation yet.');
        await o.session.invoke('editor_save_preset', { name: String(a.name), trackIds: tl.tracks.map((t) => t.id), durationMs: tl.timelineDurationMs });
        data = o.session.project.presets.at(-1)!;
      }
      const asset = await assetsService.create(conn.principal.userId, 'user', {
        kind: 'preset', name: String(a.name).slice(0, 120), description: a.description as string | undefined, category: a.category as string | undefined,
        tags: (Array.isArray(a.tags) ? a.tags.map(String) : []).slice(0, 10), schemaVersion: 1, data: { ...data, name: String(a.name) } as unknown as Record<string, unknown>,
      }).catch(asCapabilityError);
      forgetLibrary(conn.principal.userId);
      return { summary: `Saved “${asset.name}” to your library`, data: { assetId: asset.id, name: asset.name, status: asset.status, next: 'preset_publish submits it to the community.' } };
    },
  },
  {
    id: 'preset_update', title: 'Update a library preset', category: 'preset', mutates: true, scope: 'preset:write',
    description: 'Changes one of your library presets: name, description, category, tags, and/or its animation (from the open project\'s preset named by from).',
    inputSchema: obj({ assetId: str, name: str, description: str, category: str, tags: { type: 'array', items: str }, from: str }, ['assetId']),
    handler: async (conn, a) => {
      let data: Record<string, unknown> | undefined;
      if (a.from) {
        const { o } = await current(conn);
        const p = o.session.project.presets.find((x) => x.id === a.from || x.name.toLowerCase() === String(a.from).toLowerCase());
        if (!p) throw new CapabilityError('NOT_FOUND', `The open project has no preset "${a.from}".`);
        data = p as unknown as Record<string, unknown>;
      }
      const dto = Object.fromEntries(Object.entries({ name: a.name, description: a.description, category: a.category, tags: a.tags, data }).filter(([, v]) => v !== undefined));
      if (!Object.keys(dto).length) throw new CapabilityError('MISSING_ARGUMENT', 'Nothing to update.', { suggestion: 'Pass name, description, category, tags or from.' });
      const asset = await assetsService.update(String(a.assetId), conn.principal.userId, 'user', dto as never).catch(asCapabilityError);
      forgetLibrary(conn.principal.userId);
      return { summary: `Updated “${asset.name}”`, data: { assetId: asset.id, version: asset.version, status: asset.status } };
    },
  },
  {
    id: 'preset_duplicate', title: 'Duplicate a preset', category: 'preset', mutates: true, scope: 'preset:write',
    description: 'Copies any preset you can see (built-in, community, yours) into your library under a new name — the way to start from an existing one.',
    inputSchema: obj({ preset: str, name: str }, ['preset', 'name']),
    handler: async (conn, a) => {
      const { from: _f, ...p } = await findPresetAnywhere(conn, a.preset);
      const asset = await assetsService.create(conn.principal.userId, 'user', { kind: 'preset', name: String(a.name).slice(0, 120), tags: [], schemaVersion: 1, data: { ...p, id: undefined, name: String(a.name) } as unknown as Record<string, unknown> }).catch(asCapabilityError);
      forgetLibrary(conn.principal.userId);
      return { summary: `Copied to “${asset.name}”`, data: { assetId: asset.id } };
    },
  },
  {
    id: 'preset_import', title: 'Import a preset', category: 'preset', mutates: true, scope: 'preset:write',
    description: 'Adds a preset from its JSON (as preset_get { full: true } returns it) to your library.',
    inputSchema: obj({ name: str, preset: { type: 'object' } }, ['name', 'preset']),
    handler: async (conn, a) => {
      const p = a.preset as Record<string, unknown>;
      if (!Array.isArray(p.tracks)) throw new CapabilityError('INVALID_ARGUMENT', 'A preset needs a tracks array.', { field: 'preset.tracks' });
      const asset = await assetsService.create(conn.principal.userId, 'user', { kind: 'preset', name: String(a.name).slice(0, 120), tags: [], schemaVersion: 1, data: { ...p, name: String(a.name) } }).catch(asCapabilityError);
      forgetLibrary(conn.principal.userId);
      return { summary: `Imported “${asset.name}”`, data: { assetId: asset.id } };
    },
  },
  {
    id: 'preset_publish', title: 'Submit to the community', category: 'preset', mutates: true, scope: 'preset:write',
    description: 'Sends one of your library presets for community review (a moderator approves it before anyone sees it).',
    inputSchema: obj({ assetId: str, description: str, category: str, tags: { type: 'array', items: str } }, ['assetId', 'description']),
    handler: async (conn, a) => {
      const asset = await assetsService.submitToCommunity(String(a.assetId), conn.principal.userId, { description: String(a.description), category: a.category as string | undefined, tags: (Array.isArray(a.tags) ? a.tags.map(String) : []).slice(0, 10) }).catch(asCapabilityError);
      return { summary: 'Submitted for review', data: { assetId: asset.id, status: asset.status } };
    },
  },
  {
    id: 'preset_delete', title: 'Delete a library preset', category: 'preset', mutates: true, scope: 'preset:write', destructive: true,
    description: 'Removes one of your library presets. Needs confirm: true.',
    inputSchema: obj({ assetId: str, confirm: bool }, ['assetId', 'confirm']),
    handler: async (conn, a) => {
      if (a.confirm !== true) throw new CapabilityError('CONFIRMATION_REQUIRED', 'Pass confirm: true once the person has asked for it.');
      await assetsService.remove(String(a.assetId), conn.principal.userId, 'user').catch(asCapabilityError);
      forgetLibrary(conn.principal.userId);
      return { summary: 'Deleted' };
    },
  },

  // --- seeing it ----------------------------------------------------------------------
  {
    id: 'render_frame', title: 'Render a frame', category: 'render', mutates: false, scope: 'render:read',
    description: 'Renders the open project at atMs (default: the playhead) and returns the IMAGE — the same renderer as the editor\'s stage. Use it after every meaningful change: look, then fix. quality "preview" is cheap. viewport: true renders what viewport_set framed. background: a CSS colour (default transparent over white).',
    inputSchema: obj({ atMs: num, quality, background: str, viewport: bool }), examples: [{ atMs: 2400, quality: 'preview' }],
    handler: async (conn, a) => {
      const { o, warning } = await current(conn);
      const at = typeof a.atMs === 'number' ? a.atMs : await o.session.read((ed) => ed.playhead);
      const q = (a.quality as Quality) ?? 'preview';
      const svg = await o.session.frameSvg(at, { background: (a.background as string) ?? '#ffffff', viewport: a.viewport === true });
      const comp = compOf(o.session.project);
      const image = png(svg, QUALITY[q]);
      const state = await o.session.read((ed) => ({ selection: ed.selection, playheadMs: Math.round(ed.playhead), state: activeTimeline(ed.project).name }));
      return {
        summary: `Frame at ${(at / 1000).toFixed(2)}s`, images: [{ data: image.toString('base64'), mimeType: 'image/png' }],
        data: { atMs: at, width: QUALITY[q], composition: comp, projectId: o.projectId, revision: o.session.revision, viewport: a.viewport ? { ...o.session.viewport, window: o.session.window() } : null, ...state },
        warnings: warning ? [warning] : [],
      };
    },
  },
  {
    id: 'render_sequence', title: 'Render a contact sheet', category: 'render', mutates: false, scope: 'render:read',
    description: 'Several moments of the animation in ONE image, each labelled with its time — how to see motion (a jump\'s arc, a squash, a loop closing) in a single look. frames 2-16 evenly from fromMs to toMs (default the whole timeline), or exact times.',
    inputSchema: obj({ fromMs: num, toMs: num, frames: num, times: { type: 'array', items: num }, columns: num, quality }), examples: [{ fromMs: 0, toMs: 1200, frames: 8 }],
    handler: async (conn, a) => {
      const { o } = await current(conn);
      const dur = activeTimeline(o.session.project).timelineDurationMs;
      const times = Array.isArray(a.times) && a.times.length
        ? (a.times as number[]).slice(0, 16)
        : (() => {
          const from = Number(a.fromMs ?? 0), to = Number(a.toMs ?? dur), n = Math.min(16, Math.max(2, Number(a.frames) || 8));
          return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
        })();
      const cols = Math.min(times.length, Math.max(1, Number(a.columns) || 4));
      const svg = await o.session.contactSheet(times, { columns: cols });
      const perCell = { preview: 240, medium: 400, final: 720 }[(a.quality as Quality) ?? 'preview'];
      return { summary: `${times.length} frames`, images: [{ data: png(svg, perCell * cols).toString('base64'), mimeType: 'image/png' }], data: { times: times.map(Math.round), columns: cols, durationMs: dur } };
    },
  },

  // --- export -------------------------------------------------------------------------
  {
    id: 'export_formats', title: 'Export formats', category: 'export', mutates: false, scope: 'export:write',
    description: 'What export_start can produce here, and what only the editor can — GIF and MP4 render on the person\'s own device, so those are a link, not a file.',
    inputSchema: obj({}),
    handler: async () => ({
      summary: '5 formats', data: {
        lottie: 'Lottie JSON of the active state (fromMs/toMs to trim) — plays in any Lottie player',
        dotlottie: '.lottie with EVERY state and the state machine — the interactive mascot',
        runtime: 'React Native pack (zip): the .lottie, machine config, a generated Mascot.tsx and a README',
        png: 'one frame (atMs) as a PNG at 2× the composition',
        svg: 'one frame (atMs) as SVG',
        notSupportedHere: 'GIF and MP4 are encoded in the browser, not here. project_current gives the project\'s `url`: send the person there and the editor\'s Export menu makes them.',
      },
    }),
  },
  {
    id: 'export_start', title: 'Export', category: 'export', mutates: false, scope: 'export:write', async: true,
    description: 'Exports the open project as a job. With wait (default true) it returns the file when ready — inline, plus a one-hour download link to give the person. Otherwise it returns a jobId for job_get / job_result. Save first if you want the cloud copy to match.',
    inputSchema: obj({ format: { type: 'string', enum: ['lottie', 'dotlottie', 'runtime', 'png', 'svg'] }, fromMs: num, toMs: num, atMs: num, background: str, wait: bool }, ['format']),
    examples: [{ format: 'lottie' }, { format: 'dotlottie' }],
    handler: async (conn, a) => {
      const { o } = await current(conn);
      const project: Project = structuredClone(o.session.project);
      const at = typeof a.atMs === 'number' ? a.atMs : 0;
      const base = (project.name || 'blooby').replace(/[^\w-]+/g, '-').toLowerCase();
      const background = (a.background as string | undefined) ?? null;
      const svgAt = () => o.session.frameSvg(at, { background });
      const job = startJob(conn.principal.userId, `${a.format} of “${o.name}”`, async (j) => {
        switch (a.format) {
          case 'lottie': {
            const r = bakeLottie(project, { background, name: base, ...(typeof a.fromMs === 'number' ? { from: a.fromMs } : {}), ...(typeof a.toMs === 'number' ? { to: a.toMs } : {}) });
            j.progress = 0.9;
            return { filename: `${base}.json`, mimeType: 'application/json', bytes: Buffer.from(JSON.stringify(r.json)), url: null, warnings: [...r.warnings, ...r.skipped.map((s) => `skipped: ${s}`)], info: { frames: r.frames, keyframes: r.keyframeCount } };
          }
          case 'dotlottie': {
            const r = await buildDotLottie(project, { background });
            return { filename: `${base}.lottie`, mimeType: 'application/zip', bytes: Buffer.from(await r.blob.arrayBuffer()), url: null, warnings: [], info: { animations: r.animations, states: project.timelines.map((t) => t.name) } };
          }
          case 'runtime': {
            const r = await buildRuntimePack(project, { background });
            return { filename: `${base}-react-native.zip`, mimeType: 'application/zip', bytes: Buffer.from(await r.blob.arrayBuffer()), url: null, warnings: [], info: {} };
          }
          case 'png': {
            const comp = compOf(project);
            return { filename: `${base}-${Math.round(at)}ms.png`, mimeType: 'image/png', bytes: png(await svgAt(), comp.width * 2), url: null, warnings: [], info: { atMs: at } };
          }
          case 'svg': return { filename: `${base}-${Math.round(at)}ms.svg`, mimeType: 'image/svg+xml', bytes: Buffer.from(await svgAt()), url: null, warnings: [], info: { atMs: at } };
          default: throw new CapabilityError('INVALID_VALUE', `Unknown format "${a.format}".`);
        }
      });
      if (a.wait !== false) await Promise.race([job.done, new Promise((r) => setTimeout(r, 25_000))]);
      return {
        summary: job.status === 'done' ? `Exported ${job.result!.filename}` : `Export ${job.status}`,
        data: jobView(job), resources: job.status === 'done' ? jobResources(job) : [],
        ...(job.status === 'failed' ? { warnings: [job.error!] } : {}),
      };
    },
  },
  {
    id: 'job_get', title: 'Job status', category: 'job', mutates: false, scope: 'export:write',
    description: 'A job\'s status, progress, and when done its file (name, size, download link).',
    inputSchema: obj({ jobId: str }, ['jobId']),
    handler: async (conn, a) => { const j = jobOf(conn, a.jobId); return { summary: `${j.label}: ${j.status}`, data: jobView(j) }; },
  },
  {
    id: 'job_result', title: 'Job result', category: 'job', mutates: false, scope: 'export:write',
    description: 'A finished job\'s file, inline (as an embedded resource) with its download link.',
    inputSchema: obj({ jobId: str }, ['jobId']),
    handler: async (conn, a) => {
      const j = jobOf(conn, a.jobId);
      if (j.status !== 'done') throw new CapabilityError('JOB_NOT_DONE', `The job is ${j.status}.`, { suggestion: j.status === 'running' ? 'job_get until done.' : j.error ?? '' });
      return { summary: j.result!.filename, data: jobView(j), resources: jobResources(j) };
    },
  },
  {
    id: 'job_cancel', title: 'Cancel a job', category: 'job', mutates: false, scope: 'export:write',
    description: 'Cancels a running job.',
    inputSchema: obj({ jobId: str }, ['jobId']),
    handler: async (conn, a) => {
      const j = jobOf(conn, a.jobId);
      if (j.status === 'running') Object.assign(j, { cancelled: true, status: 'cancelled' });
      return { summary: `Job ${j.status}`, data: jobView(j) };
    },
  },
  {
    id: 'job_list', title: 'Recent jobs', category: 'job', mutates: false, scope: 'export:write',
    description: 'Your jobs from the last half hour.',
    inputSchema: obj({}),
    handler: async (conn) => ({ summary: 'Jobs', data: [...jobs.values()].filter((j) => j.userId === conn.principal.userId).map(jobView) }),
  },

  // --- the run, and who you are ---------------------------------------------------------
  {
    id: 'run_start', title: 'Start a run', category: 'agent', mutates: false, scope: 'project:read',
    description: 'Starts a new agent run with a goal — the record of what this piece of work did (run_get). A run starts on its own at connect; call this per task.',
    inputSchema: obj({ goal: str }, ['goal']),
    handler: async (conn, a) => { conn.run = newRun(String(a.goal)); return { summary: `Run ${conn.run.runId}`, data: { runId: conn.run.runId } }; },
  },
  {
    id: 'run_get', title: 'This run', category: 'agent', mutates: false, scope: 'project:read',
    description: 'What this run has done: every operation in order with ok/error, counts of entities created and changed, the projects touched and the checkpoints made.',
    inputSchema: obj({}),
    handler: async (conn) => {
      const o = conn.projectId ? workspace.get(conn.principal.userId, conn.projectId) : undefined;
      const r = conn.run;
      return { summary: `${r.ops.length} operation(s)`, data: { runId: r.runId, goal: r.goal, startedAt: r.startedAt, projects: [...r.projects], created: r.created, changed: r.changed, errors: r.errors, checkpoints: o ? [...o.session.checkpoints.keys()] : [], operations: r.ops.slice(-200) } };
    },
  },
  {
    id: 'proposal_get', title: 'A proposed change', category: 'agent', mutates: false, scope: 'project:read',
    description: 'In "ask me first" mode every change waits for the person to approve it in the editor. This says whether it was applied (with its result), rejected, or is still pending.',
    inputSchema: obj({ proposalId: str }, ['proposalId']),
    handler: async (conn, a) => {
      const p = workspace.proposal(conn.principal.userId, String(a.proposalId));
      if (!p) throw new CapabilityError('NOT_FOUND', `No proposal "${a.proposalId}".`);
      return { summary: p.status, data: { proposalId: p.id, status: p.status, capability: p.capability, summary: p.summary, result: p.result ?? null, error: p.error ?? null } };
    },
  },
  {
    id: 'account_whoami', title: 'Who am I', category: 'account', mutates: false, scope: 'project:read',
    description: 'The Blooby account this connection acts for, the scopes it was granted, its mode (read_only / suggest / full) and the capability version.',
    inputSchema: obj({}),
    handler: async (conn) => ({ summary: conn.principal.clientName, data: { userId: conn.principal.userId, client: conn.principal.clientName, scopes: conn.principal.scopes, mode: conn.principal.mode, projectId: conn.projectId, runId: conn.run.runId } }),
  },
];

export const HOST_HANDLERS = new Map(HOST.map((c) => [c.id, c.handler]));
export const DESTRUCTIVE = new Set(HOST.filter((c) => c.destructive).map((c) => c.id));

registerCapabilities(HOST.map(({ handler: _h, destructive: _d, requires, ...c }) => ({
  ...c, kind: 'server', since: '1.0.0', reversible: false, requires: requires ?? (c.id.startsWith('project_list') || c.id.startsWith('preset_') || c.id.startsWith('job_') ? [] : ['project']),
})));
