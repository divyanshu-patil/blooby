import type { Project } from '@prisma/client';
import { projectsRepository } from '../repositories/projects.repository.js';
import { assetsRepository } from '../repositories/assets.repository.js';
import { HttpError } from '../utils/httpError.js';
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

export const projectsService = {
  /** public projects, each with its owner's public name (see usersService.publicNames) */
  async listPublic(opts: ListPublicProjectsDto) {
    const { items, nextCursor } = await projectsRepository.listPublic(opts);
    const names = await usersService.publicNames([...new Set(items.map((p) => p.userId))]);
    return { items: items.map((p) => ({ ...p, owner: names.get(p.userId)?.name ?? null })), nextCursor };
  },

  list: (userId: string, opts: ListProjectsDto) => projectsRepository.listByUser(userId, opts),

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

  async getData(projectId: string, userId: string | null) {
    const project = await readable(projectId, userId);
    const data = await storage.getProjectJson(project.s3Key);
    // not counted as a view: card thumbnails read this too — opening in the editor counts (touchOpened)
    return { project, data, canEdit: canWrite(project, userId), isOwner: project.userId === userId };
  },

  /**
   * Autosave. Overwrites the project's single object — one file per project, no history.
   *
   * `currentVersion` still increments and is still what makes concurrent saves safe: if
   * another tab saved first the compare-and-set matches nothing and the caller is told,
   * instead of silently winning. It just no longer names a key.
   */
  async save(projectId: string, userId: string, dto: SaveProjectDataDto) {
    const project = await writable(projectId, userId);

    if (dto.expectedVersion !== undefined && dto.expectedVersion !== project.currentVersion) {
      throw HttpError.conflict(
        'This project was saved somewhere else since you opened it. Reload to get the latest version.',
      );
    }

    const nextVersion = project.currentVersion + 1;
    // under the OWNER's key, whoever is editing: one object per project
    const stored = await storage.putProjectJson(project.userId, projectId, dto.project);

    const updated = await projectsRepository.bumpVersionIfCurrent(projectId, project.currentVersion, {
      currentVersion: nextVersion,
      s3Key: stored.key,
      s3Bucket: stored.bucket,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
    });

    if (updated === 0) {
      throw HttpError.conflict('This project was saved somewhere else a moment ago. Reload to get the latest version.');
    }

    return { version: nextVersion, sizeBytes: stored.sizeBytes, checksum: stored.checksum, savedAt: new Date().toISOString() };
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
