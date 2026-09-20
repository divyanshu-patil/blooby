import { randomUUID } from 'node:crypto';
import { CapabilityError, EditorSession, catalogFromRows, type OpResult, type Preset, type Expression, type Project } from '@blooby/studio/engine';
import { prisma } from '../../config/prisma.js';
import { projectsRepository } from '../../repositories/projects.repository.js';
import { projectsService } from '../projects.service.js';
import { HttpError } from '../../utils/httpError.js';

/**
 * The projects AI clients have open, one live EditorSession per (person, project).
 *
 * Shared by every MCP connection of that person, so Claude and Cursor working on the same
 * project see the same document. The cloud copy stays the single source of truth:
 *   - AI edits autosave to it (debounced), exactly as the editor's own autosave does,
 *     with the same compare-and-set on `currentVersion`;
 *   - before every call the stored version is checked; a newer save from the editor is
 *     loaded when the AI has nothing unsaved, and is a REVISION_CONFLICT when it has.
 * The editor polls `live()` for the other direction.
 *
 * ponytail: in-process maps — one API instance. Several instances need these (and the MCP
 * transport sessions) pinned per user, or moved to Redis.
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
  activity: Activity[]; agents: Map<string, number>;
  saveTimer?: ReturnType<typeof setTimeout>;
  lastSaveError?: string;
  lastUsed: number;
}

const AUTOSAVE_MS = 2500;
const IDLE_MS = 30 * 60 * 1000;
const open = new Map<string, OpenProject>();
/**
 * The project each person has open, by user rather than by MCP session.
 *
 * Some clients (ChatGPT connectors among them) do not keep the Mcp-Session-Id between calls,
 * so every tool call arrives on a fresh connection. Remembering the open project per PERSON
 * is what makes `project_open` stick for them — and it is what someone means anyway: the
 * project they opened, not the project one socket opened.
 */
const lastOpened = new Map<string, string>();
export const rememberOpen = (userId: string, projectId: string) => lastOpened.set(userId, projectId);
export const forgetOpen = (userId: string, projectId?: string) => {
  if (!projectId || lastOpened.get(userId) === projectId) lastOpened.delete(userId);
};
export const openProjectOf = (userId: string) => lastOpened.get(userId) ?? null;
const opening = new Map<string, Promise<OpenProject>>();
const proposals = new Map<string, Proposal>();
const key = (userId: string, projectId: string) => `${userId}:${projectId}`;

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
        const o: OpenProject = { userId, projectId, name: project.name, canEdit, session, baseVersion: project.currentVersion, activity: [], agents: new Map(), lastUsed: Date.now() };
        open.set(k, o);
        return o;
      })().finally(() => opening.delete(k)));
    }
    return opening.get(k)!;
  },

  get: (userId: string, projectId: string) => open.get(key(userId, projectId)),

  /**
   * Bring the session up to date with the stored project before a call. Returns a warning
   * when it reloaded; throws REVISION_CONFLICT when both sides changed.
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
    return `The project changed in the editor (version ${row.currentVersion}); you are now working on that version.`;
  },

  async reload(o: OpenProject) {
    clearTimeout(o.saveTimer);
    const { project, data, canEdit } = await projectsService.getData(o.projectId, o.userId);
    await o.session.replace({ ...(data as Project), name: project.name }, await libraryFor(o.userId));
    Object.assign(o, { baseVersion: project.currentVersion, name: project.name, canEdit, lastSaveError: undefined });
  },

  /** Write the session to the cloud copy. `force` skips the version check — overwriting the other side. */
  async save(o: OpenProject, force = false) {
    clearTimeout(o.saveTimer);
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
  },

  /** After an edit: save soon, the way the editor's autosave does. */
  scheduleSave(o: OpenProject) {
    if (!o.canEdit) return;
    clearTimeout(o.saveTimer);
    o.saveTimer = setTimeout(() => { void workspace.save(o).catch(() => { /* surfaced through lastSaveError and the next call */ }); }, AUTOSAVE_MS);
    o.saveTimer.unref?.();
  },

  record(o: OpenProject, a: Activity) {
    o.activity.unshift(a);
    if (o.activity.length > 100) o.activity.pop();
    o.agents.set(a.client, Date.now());
    o.lastUsed = Date.now();
  },

  close(userId: string, projectId: string) {
    forgetOpen(userId, projectId);
    const o = open.get(key(userId, projectId));
    if (!o) return;
    if (o.session.dirty && o.canEdit) void workspace.save(o).catch(() => {});
    open.delete(key(userId, projectId));
  },

  /** What the editor shows in its MCP tab and uses to pick up AI edits. */
  live(userId: string, projectId?: string) {
    const now = Date.now();
    const mine = [...open.values()].filter((o) => o.userId === userId && (!projectId || o.projectId === projectId));
    return {
      projects: mine.map((o) => ({
        projectId: o.projectId, name: o.name, version: o.baseVersion, unsaved: o.session.dirty, saveError: o.lastSaveError ?? null,
        agents: [...o.agents].filter(([, at]) => now - at < 15_000).map(([client, at]) => ({ client, lastActiveAt: new Date(at).toISOString() })),
        activity: o.activity.slice(0, 30),
      })),
      proposals: [...proposals.values()].filter((p) => p.userId === userId && (!projectId || p.projectId === projectId) && (p.status === 'pending' || now - Date.parse(p.decidedAt ?? p.createdAt) < 60_000)),
    };
  },

  // --- suggest mode: a change the person approves in the editor before it happens ---------

  propose(p: Omit<Proposal, 'id' | 'status' | 'createdAt'>): Proposal {
    const proposal: Proposal = { ...p, id: `prop_${randomUUID().slice(0, 8)}`, status: 'pending', createdAt: new Date().toISOString() };
    proposals.set(proposal.id, proposal);
    return proposal;
  },

  proposal(userId: string, id: string) {
    const p = proposals.get(id);
    return p && p.userId === userId ? p : undefined;
  },

  async decide(userId: string, id: string, approve: boolean) {
    const p = workspace.proposal(userId, id);
    if (!p) throw HttpError.notFound('No such proposal');
    if (p.status !== 'pending') throw HttpError.conflict(`This change was already ${p.status}.`);
    p.decidedAt = new Date().toISOString();
    if (!approve) { p.status = 'rejected'; return p; }
    const o = await workspace.open(userId, p.projectId);
    try {
      await workspace.sync(o);
      p.result = await o.session.invoke(p.capability, p.args);
      p.status = 'applied';
      workspace.record(o, { at: p.decidedAt, client: p.client, capability: p.capability, summary: `${p.result.summary} (approved)`, ok: true });
      workspace.scheduleSave(o);
    } catch (e) {
      p.status = 'failed';
      p.error = e instanceof CapabilityError ? e.toJSON() : String(e);
    }
    return p;
  },
};

// sessions nobody has touched for a while are saved and dropped
setInterval(() => {
  for (const o of open.values()) if (Date.now() - o.lastUsed > IDLE_MS) workspace.close(o.userId, o.projectId);
  for (const [id, p] of proposals) if (Date.now() - Date.parse(p.createdAt) > 24 * 3600_000) proposals.delete(id);
}, 60_000).unref();
