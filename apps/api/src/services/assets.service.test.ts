import { beforeEach, expect, it, vi } from 'vitest';

// the repository is the only thing between this service and Postgres, so it is the seam
vi.mock('../repositories/assets.repository.js', () => ({
  assetsRepository: {
    findById: vi.fn(),
    list: vi.fn(),
    create: vi.fn((d: unknown) => d),
    update: vi.fn((id: string, d: unknown) => ({ id, ...(d as object) })),
    delete: vi.fn(),
    incrementDownloads: vi.fn(),
  },
}));

const { assetsRepository } = await import('../repositories/assets.repository.js');
const { assetsService } = await import('./assets.service.js');
const { HttpError } = await import('../utils/httpError.js');

const repo = assetsRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
const asset = (over: Record<string, unknown> = {}) =>
  ({ id: 'a1', ownerId: 'u1', source: 'user', status: 'draft', ...over });

beforeEach(() => { for (const fn of Object.values(repo)) fn.mockReset(); repo.update.mockImplementation((id: string, d: object) => ({ id, ...d })); });

const status = async (p: Promise<unknown>) => {
  try { await p; return 0; } catch (e) { return e instanceof HttpError ? e.status : -1; }
};

/* ---- visibility -------------------------------------------------------------- */

it('hides an unpublished item from everyone but its owner and an admin', async () => {
  repo.findById.mockResolvedValue(asset({ status: 'draft' }));
  expect(await status(assetsService.get('a1', 'someone-else', 'user'))).toBe(404);
  expect(await status(assetsService.get('a1', 'u1', 'user'))).toBe(0);
  expect(await status(assetsService.get('a1', null, 'admin'))).toBe(0);
});

it('reports a missing item and someone else’s item identically, so ids cannot be probed', async () => {
  repo.findById.mockResolvedValue(null);
  const missing = await status(assetsService.get('a1', 'u1', 'user'));
  repo.findById.mockResolvedValue(asset({ ownerId: 'other', status: 'draft' }));
  expect(await status(assetsService.get('a1', 'u1', 'user'))).toBe(missing);
});

it('never lets a browse listing leak another user’s drafts', () => {
  assetsService.browse({ source: 'user', limit: 10 } as never, 'u1');
  const where = repo.list.mock.calls[0][0] as { OR: unknown[] };
  expect(where.OR).toEqual([{ status: 'published' }, { ownerId: 'u1' }]);

  repo.list.mockClear();
  assetsService.browse({ source: 'user', limit: 10 } as never, null);
  expect((repo.list.mock.calls[0][0] as { OR: unknown[] }).OR).toEqual([{ status: 'published' }]);
});

/* ---- creation ---------------------------------------------------------------- */

/** `source` is derived from role, never taken from the request. */
it('refuses to publish official content for a non-admin', () => {
  expect(() => assetsService.create('u1', 'user', { name: 'x' } as never, true)).toThrow(HttpError);
});

it('starts a user’s own item as a private draft, and official content live', () => {
  assetsService.create('u1', 'user', { name: 'x', data: {} } as never);
  expect(repo.create.mock.calls[0][0]).toMatchObject({ source: 'user', status: 'draft', publishedAt: null });

  assetsService.create('admin1', 'admin', { name: 'x', data: {} } as never, true);
  expect(repo.create.mock.calls[1][0]).toMatchObject({ source: 'official', status: 'published' });
});

/* ---- moderation -------------------------------------------------------------- */

it('sends a published community item back for review when its data is swapped', async () => {
  repo.findById.mockResolvedValue(asset({ source: 'community', status: 'published' }));
  await assetsService.update('a1', 'u1', 'user', { data: { changed: true } } as never);
  expect(repo.update.mock.calls[0][1]).toMatchObject({ status: 'pending_review', publishedAt: null });
});

it('but a rename alone leaves it published', async () => {
  repo.findById.mockResolvedValue(asset({ source: 'community', status: 'published' }));
  await assetsService.update('a1', 'u1', 'user', { name: 'new name' } as never);
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('status');
});

it('and an admin edit does not demote it', async () => {
  repo.findById.mockResolvedValue(asset({ source: 'community', status: 'published' }));
  await assetsService.update('a1', 'admin1', 'admin', { data: { changed: true } } as never);
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('status');
});

it('submits to the community as pending, never straight to published', async () => {
  repo.findById.mockResolvedValue(asset());
  await assetsService.submitToCommunity('a1', 'u1', {} as never);
  expect(repo.update.mock.calls[0][1]).toMatchObject({
    source: 'community', status: 'pending_review', reviewNote: null, reviewedBy: null,
  });
});

it('refuses to resubmit something already queued or already live', async () => {
  repo.findById.mockResolvedValue(asset({ status: 'pending_review' }));
  expect(await status(assetsService.submitToCommunity('a1', 'u1', {} as never))).toBe(409);
  repo.findById.mockResolvedValue(asset({ source: 'community', status: 'published' }));
  expect(await status(assetsService.submitToCommunity('a1', 'u1', {} as never))).toBe(409);
});

it('records who moderated and when, for every action', async () => {
  const cases = [
    ['approve', 'published'], ['reject', 'rejected'],
    ['unpublish', 'draft'], ['archive', 'archived'],
  ] as const;
  for (const [action, expected] of cases) {
    repo.update.mockClear();
    repo.findById.mockResolvedValue(asset());
    await assetsService.moderate('a1', 'admin1', { action, reason: 'r' } as never);
    const patch = repo.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.status).toBe(expected);
    expect(patch.reviewedBy).toBe('admin1');
    expect(patch.reviewedAt).toBeInstanceOf(Date);
    // only an approval may carry a publish date
    expect(patch.publishedAt === null).toBe(action !== 'approve');
  }
});

it('lets an admin delete anything, but a user only their own', async () => {
  repo.findById.mockResolvedValue(asset({ ownerId: 'other' }));
  expect(await status(assetsService.remove('a1', 'u1', 'user'))).toBe(404);
  expect(await status(assetsService.remove('a1', 'u1', 'admin'))).toBe(0);
});
