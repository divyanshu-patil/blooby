import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../repositories/projects.repository.js', () => ({
  projectsRepository: {
    findById: vi.fn(), listByUser: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  },
}));
vi.mock('../repositories/assets.repository.js', () => ({ assetsRepository: { findById: vi.fn() } }));
vi.mock('./storage.service.js', () => ({
  putProjectJson: vi.fn(), getProjectJson: vi.fn(), deleteProjectJson: vi.fn(),
}));

const { projectsRepository } = await import('../repositories/projects.repository.js');
const { assetsRepository } = await import('../repositories/assets.repository.js');
const storage = await import('./storage.service.js');
const { projectsService } = await import('./projects.service.js');
const { HttpError } = await import('../utils/httpError.js');

const repo = projectsRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
const assets = assetsRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
const store = storage as unknown as Record<string, ReturnType<typeof vi.fn>>;

const project = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', userId: 'u1', visibility: 'private', ...over });

beforeEach(() => {
  for (const m of [repo, assets, store]) for (const fn of Object.values(m)) fn.mockReset();
});

const status = async (p: Promise<unknown>) => {
  try { await p; return 0; } catch (e) { return e instanceof HttpError ? e.status : -1; }
};

/**
 * 404 rather than 403 on someone else's project: a stranger should not be able to learn
 * which ids are real by the shape of the refusal.
 */
it('answers a stranger’s project and a missing one identically', async () => {
  repo.findById.mockResolvedValue(null);
  const missing = await status(projectsService.get('p1', 'u1'));
  repo.findById.mockResolvedValue(project({ userId: 'someone-else' }));
  expect(await status(projectsService.get('p1', 'u1'))).toBe(missing);
  expect(missing).toBe(404);
});

it('lets anyone read a public project, and the owner read their own', async () => {
  repo.findById.mockResolvedValue(project({ visibility: 'public', userId: 'other' }));
  expect(await status(projectsService.get('p1', null))).toBe(0);
  repo.findById.mockResolvedValue(project());
  expect(await status(projectsService.get('p1', 'u1'))).toBe(0);
});

/** A project row the user can see but never open is worse than no project. */
it('removes the row again when the upload that follows it fails', async () => {
  repo.create.mockResolvedValue(project());
  store.putProjectJson.mockRejectedValue(new Error('s3 down'));
  repo.delete.mockResolvedValue(undefined);

  await expect(projectsService.create('u1', { name: 'n' } as never)).rejects.toThrow('s3 down');
  expect(repo.delete).toHaveBeenCalledWith('p1');
});

it('records where the payload landed once it is stored', async () => {
  repo.create.mockResolvedValue(project());
  store.putProjectJson.mockResolvedValue({ key: 'k', bucket: 'b', sizeBytes: 10, checksum: 'c' });
  repo.update.mockResolvedValue(project());
  await projectsService.create('u1', { name: 'n' } as never);
  expect(repo.update).toHaveBeenCalledWith('p1', {
    s3Key: 'k', s3Bucket: 'b', sizeBytes: 10, checksum: 'c',
  });
});

it('refuses to seed from a template that is not published', async () => {
  assets.findById.mockResolvedValue({ id: 'a1', status: 'draft', data: {} });
  expect(await status(projectsService.create('u1', { name: 'n', templateAssetId: 'a1' } as never))).toBe(400);
  assets.findById.mockResolvedValue(null);
  expect(await status(projectsService.create('u1', { name: 'n', templateAssetId: 'a1' } as never))).toBe(400);
  expect(repo.create).not.toHaveBeenCalled();
});

it('seeds a new project from a published template’s data', async () => {
  assets.findById.mockResolvedValue({ id: 'a1', status: 'published', data: { from: 'template' } });
  repo.create.mockResolvedValue(project());
  store.putProjectJson.mockResolvedValue({ key: 'k', bucket: 'b', sizeBytes: 1, checksum: 'c' });
  repo.update.mockResolvedValue(project());
  await projectsService.create('u1', { name: 'n', templateAssetId: 'a1' } as never);
  expect(store.putProjectJson.mock.calls[0][2]).toEqual({ from: 'template' });
});
