import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../repositories/splashscreens.repository.js', () => ({
  splashscreensRepository: {
    findPublished: vi.fn(), listAll: vi.fn(), findById: vi.fn(),
    create: vi.fn((d: unknown) => d), update: vi.fn(), publish: vi.fn(), delete: vi.fn(),
  },
}));

const { splashscreensRepository } = await import('../repositories/splashscreens.repository.js');
const { splashscreenService } = await import('./splashscreen.service.js');
const { HttpError } = await import('../utils/httpError.js');

const repo = splashscreensRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => { for (const fn of Object.values(repo)) fn.mockReset(); repo.create.mockImplementation((d: unknown) => d); });

const status = async (p: Promise<unknown>) => {
  try { await p; return 0; } catch (e) { return e instanceof HttpError ? e.status : -1; }
};

/** Null is a perfectly normal answer — the app simply shows no splash. */
it('treats "nothing published" as a normal answer, not an error', async () => {
  repo.findPublished.mockResolvedValue(null);
  expect(await splashscreenService.active()).toBeNull();
});

it('404s an id that does not exist', async () => {
  repo.findById.mockResolvedValue(null);
  expect(await status(splashscreenService.get('s1'))).toBe(404);
  expect(await status(splashscreenService.update('s1', {} as never))).toBe(404);
  expect(await status(splashscreenService.publish('s1'))).toBe(404);
  expect(await status(splashscreenService.remove('s1'))).toBe(404);
});

it('stamps the admin who created it', async () => {
  await splashscreenService.create('admin1', { name: 'n', data: {} } as never);
  expect(repo.create.mock.calls[0][0]).toMatchObject({ createdBy: 'admin1' });
});

it('leaves the stored payload alone when an update does not carry one', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'draft' });
  await splashscreenService.update('s1', { name: 'renamed' } as never);
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('data');
});

it('refuses to unpublish something that was never live', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'draft' });
  expect(await status(splashscreenService.unpublish('s1'))).toBe(409);
});

it('archives rather than deletes when unpublishing, so the history survives', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'published' });
  await splashscreenService.unpublish('s1');
  expect(repo.update).toHaveBeenCalledWith('s1', { status: 'archived' });
  expect(repo.delete).not.toHaveBeenCalled();
});

/** Deleting the live one would leave the app with no splash and no warning. */
it('refuses to delete the live splashscreen', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'published' });
  expect(await status(splashscreenService.remove('s1'))).toBe(409);
  expect(repo.delete).not.toHaveBeenCalled();
});

it('deletes one that is not live', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'archived' });
  expect(await status(splashscreenService.remove('s1'))).toBe(0);
  expect(repo.delete).toHaveBeenCalledWith('s1');
});

/**
 * Publishing is two writes that must not be seen apart. The service delegates to the
 * repository's transaction rather than doing the archive-then-promote itself.
 */
it('publishes through the repository transaction, not as two service calls', async () => {
  repo.findById.mockResolvedValue({ id: 's1', status: 'draft' });
  await splashscreenService.publish('s1');
  expect(repo.publish).toHaveBeenCalledWith('s1');
  expect(repo.update).not.toHaveBeenCalled();
});
