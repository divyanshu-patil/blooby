import type { Project } from '@prisma/client';
import { projectsRepository } from '../repositories/projects.repository.js';
import { assetsRepository } from '../repositories/assets.repository.js';
import { HttpError } from '../utils/httpError.js';
import { ttlCache } from '../utils/ttlCache.js';
import { usersService } from './users.service.js';
import * as storage from './storage.service.js';
import type { CreateProjectDto, ListProjectsDto, ListPublicProjectsDto, SaveProjectDataDto, UpdateProjectDto } from '../dtos/projects/index.js';

/**
 * Ownership is checked in exactly one place. Every operation on a single project routes
 * through here, so "user changes the id in the URL" is answered once rather than in each
 * controller — and a new endpoint cannot forget the check.
 */
async function ownedBy(projectId: string, userId: string): Promise<Project> {
  const project = await projectsRepository.findById(projectId);
  if (!project) throw HttpError.notFound('That project does not exist');
  // 404 rather than 403: a stranger should not be able to probe which ids are real
  if (project.userId !== userId) throw HttpError.notFound('That project does not exist');
  return project;
}

/** Readable by the owner, or by anyone if the project is public. */
async function readable(projectId: string, userId: string | null): Promise<Project> {
  const project = await projectsRepository.findById(projectId);
  if (!project) throw HttpError.notFound('That project does not exist');
  if (project.visibility === 'public' || project.userId === userId) return project;
  throw HttpError.notFound('That project does not exist');
}

/** Anyone who may save to it: the owner, or any signed-in user while it is public with edit access. */
const canWrite = (project: Project, userId: string | null) =>
  !!userId && (project.userId === userId || (project.visibility === 'public' && project.access === 'edit'));

async function writable(projectId: string, userId: string): Promise<Project> {
  const project = await readable(projectId, userId);
  // readable-but-not-writable is a 403: they can already see it exists
  if (!canWrite(project, userId)) throw HttpError.forbidden('This project is view-only. Duplicate it to make your own copy.');
  return project;
}

/**
 * How long a listed project's `dataUrl` stays valid.
 *
 * A card renders its picture from the project's own JSON, so a page of forty cards used to
 * mean forty requests to this server, each authenticating, reading the row and then
 * streaming a median 320KB out of S3 — and browsers only run six at a time. Minting the
 * read URL here costs local crypto and nothing else, so the cards fetch S3 directly, in
 * parallel, with no round trip to Postgres at all. An hour outlives any tab that is still
 * scrolling the list it came with.
 */
const DATA_URL_TTL_S = 3600;

/**
 * projectId → the id of the person who owns it.
 *
 * The one fact about a project that CANNOT go stale: a project never changes hands. There
 * is no transfer, no share that reassigns it, nothing in the schema that would rewrite
 * `user_id`. So unlike visibility or access — which the owner may flip at any moment, and
 * which are therefore always read live — this can be answered from memory without any
 * window in which the answer is wrong.
 *
 * What it buys is the second round trip out of an autosave. See `save`.
 *
 * A DELETED project is the only thing a stale entry can misreport, and it is caught
 * downstream: the compare-and-set matches no row, the entry is dropped and the real answer
 * read from the database before anything is reported to the caller.
 */
const OWNER_TTL_MS = 10 * 60_000;
const ownerOf = ttlCache<string | null>(OWNER_TTL_MS, async (id) => (await projectsRepository.findById(id))?.userId ?? null);

/** A row plus the link its JSON can be fetched from. Used wherever a card is drawn. */
async function withDataUrl<P extends { s3Key: string }>(rows: P[]) {
  return Promise.all(rows.map(async (p) => ({ ...p, dataUrl: await storage.presignedReadUrl(p.s3Key, DATA_URL_TTL_S) })));
}

export const projectsService = {
  /** Drop the remembered owner of a project. Called when one is deleted; exported so a
   *  test, or anything that removes a row outside this service, can do the same. */
  forgetOwner: (projectId: string) => ownerOf.forget(projectId),

  /** public projects, each with its owner's public name (see usersService.publicNames) */
  async listPublic(opts: ListPublicProjectsDto) {
    const { items, nextCursor } = await projectsRepository.listPublic(opts);
    const names = await usersService.publicNames([...new Set(items.map((p) => p.userId))]);
    const withUrls = await withDataUrl(items);
    // the key itself is nobody's business; the signed link it produced is what travels
    return { items: withUrls.map(({ s3Key: _k, ...p }) => ({ ...p, owner: names.get(p.userId)?.name ?? null })), nextCursor };
  },

  async list(userId: string, opts: ListProjectsDto) {
    const { items, nextCursor } = await projectsRepository.listByUser(userId, opts);
    return { items: await withDataUrl(items), nextCursor };
  },

  async get(projectId: string, userId: string | null) {
    return readable(projectId, userId);
  },

  /**
   * Create metadata first so the row owns the id, then write the JSON to S3 under a key
   * derived from it. If the upload fails the row is removed again — a project the user
   * can see but never open is worse than no project.
   */
  async create(userId: string, dto: CreateProjectDto) {
    const seed = dto.templateAssetId
      ? await (async () => {
          const asset = await assetsRepository.findById(dto.templateAssetId!);
          if (!asset || asset.status !== 'published') throw HttpError.badRequest('That template is not available');
          return asset.data as Record<string, unknown>;
        })()
      : (dto.project ?? {});

    const created = await projectsRepository.create({
      userId,
      name: dto.name,
      s3Key: '',
      s3Bucket: '',
      currentVersion: 1,
    });

    try {
      const stored = await storage.putProjectJson(userId, created.id, seed);
      return await projectsRepository.update(created.id, {
        s3Key: stored.key,
        s3Bucket: stored.bucket,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
      });
    } catch (e) {
      await projectsRepository.delete(created.id).catch(() => {});
      throw e;
    }
  },

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    await ownedBy(projectId, userId);
    return projectsRepository.update(projectId, dto);
  },

  async remove(projectId: string, userId: string) {
    await ownedBy(projectId, userId);   // 404/403 before anything is destroyed
    await projectsRepository.delete(projectId);
    ownerOf.forget(projectId);
    // after the row, so a storage hiccup never leaves an undeletable project behind.
    // Listed by prefix rather than by version count, so anything left over from when
    // every save had its own key goes too.
    await storage.deleteProjectObjects(userId, projectId);
  },

  /** Anything you can read, you can copy — your own, or anyone's public project. */
  async duplicate(projectId: string, userId: string, name?: string) {
    const source = await readable(projectId, userId);
    const data = await storage.getProjectJson(source.s3Key);
    const copy = await projectsService.create(userId, { name: name ?? `${source.name} copy`, project: data as Record<string, unknown> });
    if (source.userId !== userId) await projectsRepository.countDuplicate(projectId).catch(() => {});
    return copy;
  },

  /** The document itself, read into this process. For the server's own use (the MCP
   *  workspace, scripts) — a browser is given a link instead, see `getDataUrl`. */
  async getData(projectId: string, userId: string | null) {
    const project = await readable(projectId, userId);
    const data = await storage.getProjectJson(project.s3Key);
    // not counted as a view: card thumbnails read this too — opening in the editor counts (touchOpened)
    return { project, data, canEdit: canWrite(project, userId), isOwner: project.userId === userId };
  },

  /**
   * What the browser gets: the row, and a link to fetch the JSON straight from S3.
   *
   * The payload never touches this server. Opening a 2.6MB project used to buffer the
   * whole thing here and send it on over the user's connection a second time, after the
   * round trip to S3 had already been paid inside the request.
   */
  async getDataUrl(projectId: string, userId: string | null) {
    const project = await readable(projectId, userId);
    return {
      project,
      dataUrl: await storage.presignedReadUrl(project.s3Key, DATA_URL_TTL_S),
      canEdit: canWrite(project, userId),
      isOwner: project.userId === userId,
    };
  },

  /**
   * Autosave. Overwrites the project's single object — one file per project, no history.
   *
   * `currentVersion` still increments and is still what makes concurrent saves safe: if
   * another tab saved first the compare-and-set matches nothing and the caller is told,
   * instead of silently winning. It just no longer names a key.
   */
  async save(projectId: string, userId: string, dto: SaveProjectDataDto) {
    const owner = await ownerOf(projectId);
    if (!owner) { ownerOf.forget(projectId); throw HttpError.notFound('That project does not exist'); }

    // The owner, replacing a version they name: authorized by the one immutable fact, so
    // the compare-and-set below is the ONLY trip to the database this save makes. That is
    // the whole autosave path — it used to read the row first and pay ~580ms for it.
    if (owner === userId && dto.expectedVersion !== undefined) {
      return writeAndBump(projectId, owner, dto.expectedVersion, dto);
    }

    // Everyone else reads live. Whether a project is public, and whether public means
    // editable, is the owner's to change at any moment and must never be answered from a
    // cache. So is the current version, when the caller did not say which one they have.
    const project = await writable(projectId, userId);

    if (dto.expectedVersion !== undefined && dto.expectedVersion !== project.currentVersion) {
      throw HttpError.conflict(
        'This project was saved somewhere else since you opened it. Reload to get the latest version.',
      );
    }

    // under the OWNER's key, whoever is editing: one object per project
    return writeAndBump(projectId, project.userId, project.currentVersion, dto);
  },

  /**
   * Opened in the editor. Your own project records when (the dashboard's "recent"); anyone
   * else's public one counts a view, which is what trending ranks by. A failed count never
   * fails the open.
   */
  async touchOpened(projectId: string, userId: string) {
    const project = await readable(projectId, userId);
    if (project.userId === userId) return projectsRepository.update(projectId, { lastOpenedAt: new Date() });
    await projectsRepository.countView(projectId).catch(() => {});
    return project;
  },
};

/**
 * Write the object, then claim the version — in that order, always.
 *
 * S3 PutObject is atomic, so a failed upload leaves the previous object whole and the row
 * still pointing at it: the caller sees an error, retries with the same expectedVersion
 * and succeeds. Bumping first would mean a failed upload left the database claiming a
 * version that storage does not have, and the retry would then be told it has a conflict
 * with work that was never written.
 */
async function writeAndBump(projectId: string, ownerId: string, expected: number, dto: SaveProjectDataDto) {
  const stored = await storage.putProjectJson(ownerId, projectId, dto.project);
  const nextVersion = expected + 1;

  const updated = await projectsRepository.bumpVersionIfCurrent(projectId, expected, {
    currentVersion: nextVersion,
    s3Key: stored.key,
    s3Bucket: stored.bucket,
    sizeBytes: stored.sizeBytes,
    checksum: stored.checksum,
    ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
  });

  if (updated === 0) {
    // matched nothing: either someone else saved first, or the project is gone. Worth a
    // read to say which — this path is already an error, and being told to reload a
    // project that no longer exists is worse than the extra round trip.
    ownerOf.forget(projectId);
    if (!(await projectsRepository.findById(projectId))) throw HttpError.notFound('That project does not exist');
    throw HttpError.conflict('This project was saved somewhere else a moment ago. Reload to get the latest version.');
  }

  return { version: nextVersion, sizeBytes: stored.sizeBytes, checksum: stored.checksum, savedAt: new Date().toISOString() };
}
