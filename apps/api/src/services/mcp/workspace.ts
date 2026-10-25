import { randomUUID } from 'node:crypto';
import { CapabilityError, EditorSession, catalogFromRows, type OpResult, type Preset, type Expression, type Project } from '@blooby/studio/engine';
import { prisma } from '../../config/prisma.js';
import { projectsRepository } from '../../repositories/projects.repository.js';
import { projectsService } from '../projects.service.js';
import { HttpError } from '../../utils/httpError.js';
import { sharedState } from '../../utils/sharedState.js';

/**
 * The projects AI clients have open, one live EditorSession per (person, project).
 *
 * Shared by every MCP connection of that person, so Claude and Cursor working on the same
 * project see the same document. The cloud copy is the single source of truth, and it is
 * kept CURRENT: every call that changes the document saves before it answers. That is what
 * lets any instance serve the next call — the session here is only a cache, rebuilt from the
 * cloud copy by `sync` when another instance (or the editor) saved since.
 *   - saves use the editor's compare-and-set on `currentVersion`;
 *   - before every call the stored version is checked; a newer save is loaded when this
 *     session has nothing unsaved, and is a REVISION_CONFLICT when it has.
 * What does NOT cross instances: undo history, checkpoints and an open transaction live in
 * the session, so a call served elsewhere starts them over (the document itself is intact).
 *
 * Who has which project open, the proposals and the live feed the editor polls are small,
 * and live in utils/sharedState (Redis, or this process without one).
 */

export interface Activity { at: string; client: string; capability: string; summary: string; ok: boolean; error?: string }
export interface Proposal {
  id: string; userId: string; projectId: string; client: string; capability: string; args: Record<string, unknown>;
  summary: string; preview: Pick<OpResult, 'created' | 'deleted' | 'changed'> | null;
  status: 'pending' | 'applied' | 'rejected' | 'failed'; result?: OpResult; error?: unknown; createdAt: string; decidedAt?: string;
}

export interface OpenProject {
  userId: string; projectId: string; name: string; canEdit: boolean;
  session: EditorSession; baseVersion: number;
  /** the save in flight: saves of one session run one after another, or the second's version check fails */
  saving?: Promise<unknown>;
  lastSaveError?: string;
  lastUsed: number;
}

/** What the editor's MCP tab shows for one open project, whichever instance served the call. */
interface LiveEntry {
  projectId: string; name: string; version: number; unsaved: boolean; saveError: string | null;
  agents: Record<string, number>; activity: Activity[]; lastUsed: number;
}

const IDLE_MS = 30 * 60 * 1000;
const DAY = 24 * 3600;
const open = new Map<string, OpenProject>();
const opening = new Map<string, Promise<OpenProject>>();
const key = (userId: string, projectId: string) => `${userId}:${projectId}`;
const keys = {
  open: (userId: string) => `mcp:open:${userId}`,
  live: (userId: string) => `mcp:live:${userId}`,
  proposals: (userId: string) => `mcp:proposals:${userId}`,
  /** the version the MCP itself last wrote — a newer stored version that IS this one is not news */
  saved: (projectId: string) => `mcp:saved:${projectId}`,
};

/**
 * The project each person has open, by user rather than by MCP connection.
 *
 * The transport is stateless (routes/mcp.routes.ts), so every call arrives on a fresh
 * connection — and some clients (ChatGPT connectors among them) never kept a session anyway.
 * Remembering the open project per PERSON is what makes `project_open` stick, and it is what
 * someone means anyway: the project they opened, not the project one socket opened.
 */
export const rememberOpen = (userId: string, projectId: string) => sharedState.set(keys.open(userId), projectId, 7 * DAY);
export const openProjectOf = async (userId: string) => (await sharedState.get<string>(keys.open(userId))) ?? null;
export async function forgetOpen(userId: string, projectId?: string) {
  if (!projectId || (await openProjectOf(userId)) === projectId) await sharedState.del(keys.open(userId));
}

/** The shared library as the editor's catalog: every published preset plus this person's own. */
const libraryCache = new Map<string, { at: number; value: { presets: Preset[]; expressions: Expression[] } }>();
export async function libraryFor(userId: string) {
  const hit = libraryCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const rows = await prisma.asset.findMany({
    where: { OR: [{ status: 'published', source: { not: 'builtin' } }, { ownerId: userId }] },
    select: { id: true, kind: true, source: true, name: true, data: true, publishedAt: true, downloadCount: true },
    orderBy: { createdAt: 'asc' }, take: 2000,
  });
  const value = catalogFromRows(rows.map((r) => ({
    id: r.id, kind: r.kind, source: r.source, name: r.name, data: r.data, published_at: r.publishedAt?.toISOString() ?? null, download_count: r.downloadCount,
  })));
  libraryCache.set(userId, { at: Date.now(), value });
  return value;
}
export const forgetLibrary = (userId: string) => libraryCache.delete(userId);

async function doSave(o: OpenProject, force: boolean) {
  if (!o.canEdit) throw new CapabilityError('READ_ONLY_PROJECT', 'This project is view-only for you.', { suggestion: 'project_duplicate makes your own copy you can edit and save.' });
  const revision = o.session.revision;
  try {
    const res = await projectsService.save(o.projectId, o.userId, { project: o.session.project as unknown as Record<string, unknown>, ...(force ? {} : { expectedVersion: o.baseVersion }) });
    const name = o.session.project.name?.trim();
    if (name && name !== o.name && (await projectsRepository.findById(o.projectId))?.userId === o.userId) {
      await projectsRepository.update(o.projectId, { name });
      o.name = name;
    }
    o.baseVersion = res.version;
    o.session.savedRevision = revision;
    o.lastSaveError = undefined;
    await sharedState.set(keys.saved(o.projectId), res.version, DAY);
    return res;
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      o.lastSaveError = 'conflict';
      throw new CapabilityError('REVISION_CONFLICT', 'The project was saved from somewhere else since you opened it.', {
        suggestion: 'project_reload takes the stored version; project_save { force: true } overwrites it with yours.',
      });
    }
    o.lastSaveError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

/** Drop this instance's cached session (saving first if anything is somehow unsaved). */
async function evict(o: OpenProject) {
  if (o.session.dirty && o.canEdit) await workspace.save(o).catch(() => {});
  open.delete(key(o.userId, o.projectId));
}

export const workspace = {
  /** Open (or return the already-open) session. Ownership and visibility come from projectsService. */
  async open(userId: string, projectId: string): Promise<OpenProject> {
    const k = key(userId, projectId);
    const existing = open.get(k);
    if (existing) { existing.lastUsed = Date.now(); return existing; }
    if (!opening.has(k)) {
      opening.set(k, (async () => {
        const { project, data, canEdit } = await projectsService.getData(projectId, userId);
        const session = await EditorSession.open({ ...(data as Project), name: project.name }, await libraryFor(userId));
        const o: OpenProject = { userId, projectId, name: project.name, canEdit, session, baseVersion: project.currentVersion, lastUsed: Date.now() };
        open.set(k, o);
        return o;
      })().finally(() => opening.delete(k)));
    }
    return opening.get(k)!;
  },

  get: (userId: string, projectId: string) => open.get(key(userId, projectId)),

  /**
   * Bring the session up to date with the stored project before a call. Returns a warning
   * when it reloaded someone else's save; throws REVISION_CONFLICT when both sides changed.
   */
  async sync(o: OpenProject): Promise<string | null> {
    const row = await projectsRepository.findById(o.projectId);
    if (!row) throw new CapabilityError('PROJECT_GONE', 'This project was deleted.', { suggestion: 'project_list, then project_open another.' });
    o.name = row.name;
    if (row.currentVersion <= o.baseVersion) return null;
    if (o.session.dirty) {
      throw new CapabilityError('REVISION_CONFLICT', 'The project was saved from somewhere else (probably the editor) while you had unsaved changes.', {
        yourBaseVersion: o.baseVersion, storedVersion: row.currentVersion,
        suggestion: 'project_reload takes their version and drops yours; project_save { force: true } keeps yours and overwrites theirs. checkpoint_diff shows what you changed.',
      });
    }
    await workspace.reload(o);
    // the AI's own save, written by another instance: the same document, nothing to tell
    if ((await sharedState.get<number>(keys.saved(o.projectId))) === row.currentVersion) return null;
    return `The project changed in the editor (version ${row.currentVersion}); you are now working on that version.`;
  },

  async reload(o: OpenProject) {
    const { project, data, canEdit } = await projectsService.getData(o.projectId, o.userId);
    await o.session.replace({ ...(data as Project), name: project.name }, await libraryFor(o.userId));
    Object.assign(o, { baseVersion: project.currentVersion, name: project.name, canEdit, lastSaveError: undefined });
  },

  /** Write the session to the cloud copy. `force` skips the version check — overwriting the other side. */
  save(o: OpenProject, force = false) {
    const run = (o.saving ?? Promise.resolve()).then(() => doSave(o, force));
    o.saving = run.catch(() => {});
    return run;
  },

  /**
   * After an edit: save it now, before the call answers — the next call may be served by
   * another instance, which only knows what is stored. A failure is the call's warning
   * (and `lastSaveError`), not its error: the edit itself happened. `always` saves a session
   * that does not count as dirty — a rename, or a new project's first full document.
   */
  async persist(o: OpenProject, always = false): Promise<string | null> {
    if (!o.canEdit || (!always && !o.session.dirty)) return null;
    try { await workspace.save(o); return null; } catch (e) {
      return `Not saved: ${e instanceof Error ? e.message : String(e)} project_save retries; project_reload takes the stored version.`;
    }
  },

  /** One call, for the editor's MCP tab: who is working, what they did, the version to adopt. */
  async record(o: OpenProject, a: Activity) {
    o.lastUsed = Date.now();
    const prev = await sharedState.hget<LiveEntry>(keys.live(o.userId), o.projectId);
    const entry: LiveEntry = {
      projectId: o.projectId, name: o.name, version: o.baseVersion, unsaved: o.session.dirty, saveError: o.lastSaveError ?? null,
      agents: { ...prev?.agents, [a.client]: Date.now() }, activity: [a, ...(prev?.activity ?? [])].slice(0, 30), lastUsed: Date.now(),
    };
    await sharedState.hset(keys.live(o.userId), o.projectId, entry, IDLE_MS / 1000);
  },

  /** The person closed it: forget it everywhere, not just in this instance's cache. */
  async close(userId: string, projectId: string) {
    await forgetOpen(userId, projectId);
    await sharedState.hdel(keys.live(userId), projectId);
    const o = open.get(key(userId, projectId));
    if (o) await evict(o);
  },

  /** What the editor shows in its MCP tab and uses to pick up AI edits. */
  async live(userId: string, projectId?: string) {
    const now = Date.now();
    const [entries, proposals] = await Promise.all([sharedState.hvals<LiveEntry>(keys.live(userId)), sharedState.hvals<Proposal>(keys.proposals(userId))]);
    return {
      projects: entries.filter((e) => now - e.lastUsed < IDLE_MS && (!projectId || e.projectId === projectId)).map((e) => ({
        projectId: e.projectId, name: e.name, version: e.version, unsaved: e.unsaved, saveError: e.saveError,
        agents: Object.entries(e.agents).filter(([, at]) => now - at < 15_000).map(([client, at]) => ({ client, lastActiveAt: new Date(at).toISOString() })),
        activity: e.activity,
      })),
      proposals: proposals.filter((p) => (!projectId || p.projectId === projectId) && (p.status === 'pending' || now - Date.parse(p.decidedAt ?? p.createdAt) < 60_000)),
    };
  },

  // --- suggest mode: a change the person approves in the editor before it happens ---------

  async propose(p: Omit<Proposal, 'id' | 'status' | 'createdAt'>): Promise<Proposal> {
    const proposal: Proposal = { ...p, id: `prop_${randomUUID().slice(0, 8)}`, status: 'pending', createdAt: new Date().toISOString() };
    await sharedState.hset(keys.proposals(p.userId), proposal.id, proposal, DAY);
    return proposal;
  },

  proposal: (userId: string, id: string) => sharedState.hget<Proposal>(keys.proposals(userId), id),

  async decide(userId: string, id: string, approve: boolean) {
    const p = await workspace.proposal(userId, id);
    if (!p) throw HttpError.notFound('No such proposal');
    if (p.status !== 'pending') throw HttpError.conflict(`This change was already ${p.status}.`);
    p.decidedAt = new Date().toISOString();
    if (!approve) p.status = 'rejected';
    else {
      const o = await workspace.open(userId, p.projectId);
      try {
        await workspace.sync(o);
        p.result = await o.session.invoke(p.capability, p.args);
        p.status = 'applied';
        await workspace.persist(o);
        await workspace.record(o, { at: p.decidedAt, client: p.client, capability: p.capability, summary: `${p.result.summary} (approved)`, ok: true });
      } catch (e) {
        p.status = 'failed';
        p.error = e instanceof CapabilityError ? e.toJSON() : String(e);
      }
    }
    await sharedState.hset(keys.proposals(userId), p.id, p, DAY);
    return p;
  },
};

// sessions this instance has not served for a while leave its cache — only its cache: the person
// may be working through another instance. Proposals and the live feed expire by their own TTLs.
setInterval(() => {
  for (const o of open.values()) if (Date.now() - o.lastUsed > IDLE_MS) void evict(o);
}, 60_000).unref();
