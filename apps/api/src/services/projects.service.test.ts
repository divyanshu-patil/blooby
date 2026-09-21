import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../repositories/projects.repository.js', () => ({
  projectsRepository: {
    findById: vi.fn(), listByUser: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    bumpVersionIfCurrent: vi.fn(), countView: vi.fn(), countDuplicate: vi.fn(),
  },
}));
vi.mock('../repositories/assets.repository.js', () => ({ assetsRepository: { findById: vi.fn() } }));
vi.mock('./storage.service.js', () => ({
  putProjectJson: vi.fn(), getProjectJson: vi.fn(), deleteProjectJson: vi.fn(),
  deleteProjectObjects: vi.fn(), presignedReadUrl: vi.fn(async (k: string) => `https://s3.test/${k}?sig`),
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
  store.presignedReadUrl.mockImplementation(async (k: string) => `https://s3.test/${k}?sig`);
  // a project's owner is remembered between saves; every case starts without one
  projectsService.forgetOwner('p1');
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

const saved = () => {
  store.putProjectJson.mockResolvedValue({ key: 'k', bucket: 'b', sizeBytes: 1, checksum: 'c' });
  repo.bumpVersionIfCurrent.mockResolvedValue(1);
};

/** Public + edit lets anyone signed in save; view-only, private and signed-out do not. */
it('lets a stranger save only to a public project with edit access', async () => {
  saved();
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'edit', currentVersion: 1 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {} }))).toBe(0);
  // under the owner's key, so the project stays one object
  expect(store.putProjectJson.mock.calls[0][0]).toBe('owner');

  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'view', currentVersion: 1 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {} }))).toBe(403);
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'private', access: 'edit', currentVersion: 1 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {} }))).toBe(404);
});

/**
 * A project never changes hands, so who owns it is the one thing about it that cannot go
 * stale. Answering an autosave from that instead of re-reading the row is what took the
 * second ~580ms round trip out of every save.
 */
it('an owner saving a version they name touches the database once', async () => {
  saved();
  repo.findById.mockResolvedValue(project({ userId: 'u1', currentVersion: 4 }));
  expect(await projectsService.save('p1', 'u1', { project: {}, expectedVersion: 4 } as never))
    .toMatchObject({ version: 5 });
  repo.findById.mockClear();

  const again = await projectsService.save('p1', 'u1', { project: {}, expectedVersion: 5 } as never);
  expect(again).toMatchObject({ version: 6 });
  expect(repo.findById, 'the row is not read again').not.toHaveBeenCalled();
  expect(repo.bumpVersionIfCurrent).toHaveBeenLastCalledWith('p1', 5, expect.objectContaining({ currentVersion: 6 }));
});

/** Public and access are the owner's to flip at any moment: never answered from memory. */
it('still reads the live row for anyone who is not the owner', async () => {
  saved();
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'edit', currentVersion: 1 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {}, expectedVersion: 1 } as never))).toBe(0);

  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'view', currentVersion: 1 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {}, expectedVersion: 1 } as never))).toBe(403);
});

/** The object is written FIRST: a failed upload must leave the row pointing at the copy
 *  that is still whole, so the retry works instead of being told it has a conflict. */
it('does not claim a version when the upload failed', async () => {
  repo.findById.mockResolvedValue(project({ userId: 'u1', currentVersion: 2 }));
  store.putProjectJson.mockRejectedValue(new Error('S3 is down'));
  await expect(projectsService.save('p1', 'u1', { project: {}, expectedVersion: 2 } as never)).rejects.toThrow('S3 is down');
  expect(repo.bumpVersionIfCurrent).not.toHaveBeenCalled();
});

/** Deletion is the one thing a remembered owner can misreport, and it is caught here. */
it('says a deleted project is gone, not that it has a conflict', async () => {
  saved();
  repo.findById.mockResolvedValue(project({ userId: 'u1', currentVersion: 1 }));
  await projectsService.save('p1', 'u1', { project: {}, expectedVersion: 1 } as never);

  repo.bumpVersionIfCurrent.mockResolvedValue(0);
  repo.findById.mockResolvedValue(null);
  expect(await status(projectsService.save('p1', 'u1', { project: {}, expectedVersion: 2 } as never))).toBe(404);

  repo.findById.mockResolvedValue(project({ userId: 'u1', currentVersion: 9 }));
  expect(await status(projectsService.save('p1', 'u1', { project: {}, expectedVersion: 2 } as never))).toBe(409);
});

/** A card draws itself from the project's own JSON. Handing out a link means the page
 *  fetches the bucket directly — no request to this server per card at all. */
it('puts a read link on every listed project, and never the key it came from', async () => {
  repo.listByUser.mockResolvedValue({ items: [project({ s3Key: 'users/u1/projects/p1.json' })], nextCursor: null });
  const mine = await projectsService.list('u1', { limit: 10, sort: 'recent' } as never);
  expect(mine.items[0].dataUrl).toBe('https://s3.test/users/u1/projects/p1.json?sig');

  repo.findById.mockResolvedValue(project({ userId: 'u1', s3Key: 'users/u1/projects/p1.json' }));
  const one = await projectsService.getDataUrl('p1', 'u1');
  expect(one.dataUrl).toContain('?sig');
  expect(one, 'the payload never travels through this server').not.toHaveProperty('data');
});

it('only the owner changes name, visibility or access', async () => {
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'edit' }));
  expect(await status(projectsService.update('p1', 'u1', { access: 'view' }))).toBe(404);
});

it('duplicates anyone’s public project and counts it, but not a private one', async () => {
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', name: 'Theirs', s3Key: 's' }));
  store.getProjectJson.mockResolvedValue({ a: 1 });
  repo.create.mockResolvedValue(project({ id: 'p2' }));
  store.putProjectJson.mockResolvedValue({ key: 'k', bucket: 'b', sizeBytes: 1, checksum: 'c' });
  repo.update.mockResolvedValue(project({ id: 'p2' }));
  repo.countDuplicate.mockResolvedValue(undefined);
  expect(await status(projectsService.duplicate('p1', 'u1'))).toBe(0);
  expect(repo.create.mock.calls[0][0]).toMatchObject({ userId: 'u1', name: 'Theirs copy' });
  expect(repo.countDuplicate).toHaveBeenCalledWith('p1');

  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'private' }));
  expect(await status(projectsService.duplicate('p1', 'u1'))).toBe(404);
});

it('tells the editor whether the opener may save', async () => {
  store.getProjectJson.mockResolvedValue({});
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public', access: 'view' }));
  expect(await projectsService.getData('p1', null)).toMatchObject({ canEdit: false, isOwner: false });
  repo.findById.mockResolvedValue(project({ userId: 'u1' }));
  expect(await projectsService.getData('p1', 'u1')).toMatchObject({ canEdit: true, isOwner: true });
  // reading the data is what a card thumbnail does too — never a view
  expect(repo.countView).not.toHaveBeenCalled();
});

it('opening someone else’s public project counts a view; your own records when', async () => {
  repo.countView.mockResolvedValue(undefined);
  repo.update.mockResolvedValue(project());
  repo.findById.mockResolvedValue(project({ userId: 'owner', visibility: 'public' }));
  await projectsService.touchOpened('p1', 'u1');
  expect(repo.countView).toHaveBeenCalledWith('p1');
  expect(repo.update).not.toHaveBeenCalled();
  repo.findById.mockResolvedValue(project({ userId: 'u1' }));
  await projectsService.touchOpened('p1', 'u1');
  expect(repo.update).toHaveBeenCalledWith('p1', expect.objectContaining({ lastOpenedAt: expect.any(Date) }));
  expect(repo.countView).toHaveBeenCalledTimes(1);
});
