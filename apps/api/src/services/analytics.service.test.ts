import { beforeEach, expect, it, vi } from 'vitest';

const count = vi.fn();
const queryRaw = vi.fn();
const assetFindMany = vi.fn();
vi.mock('../config/prisma.js', () => ({
  prisma: { profile: { count }, project: { count }, asset: { count, findMany: assetFindMany }, $queryRaw: queryRaw },
}));
vi.mock('./users.service.js', () => ({
  usersService: { publicNames: vi.fn(async () => new Map([['u1', { name: 'Ada', avatarUrl: 'a.png' }]])) },
}));

const { analyticsService } = await import('./analytics.service.js');

beforeEach(() => { count.mockReset(); queryRaw.mockReset(); assetFindMany.mockReset(); });

it('counts every metric card', async () => {
  count.mockResolvedValue(3);
  expect(await analyticsService.overview(7)).toMatchObject({ totalUsers: 3, pendingReview: 3 });
  expect(count).toHaveBeenCalledTimes(9);
});

it('densifies a series, and gives a delta only when there is a prior window', async () => {
  const today = new Date().toISOString().slice(0, 10);
  queryRaw.mockResolvedValue([{ day: new Date(today), count: 4n }]);
  count.mockResolvedValue(2);
  const g = await analyticsService.growth(3);
  expect(g.users).toHaveLength(3);
  expect(g.users.at(-1)).toEqual({ date: today, count: 4 });
  expect(g.users[0]!.count).toBe(0);
  expect(g.deltas).toEqual({ users: 100, projects: 100 });
  count.mockResolvedValue(0);
  expect((await analyticsService.growth(3)).deltas).toEqual({ users: null, projects: null });
});

it('admin insights hide owners; the public leaderboard names people and never ids', async () => {
  assetFindMany.mockResolvedValue([
    { id: 'a1', name: 'A', kind: 'preset', source: 'community', downloadCount: 2, ownerId: 'u1' },
    { id: 'a2', name: 'B', kind: 'preset', source: 'official', downloadCount: 1, ownerId: null },
    { id: 'a3', name: 'C', kind: 'preset', source: 'community', downloadCount: 0, ownerId: 'ghost' },
  ]);
  queryRaw.mockResolvedValue([{ user_id: 'u1', username: 'ada', projects: 2n, views: 5n, copies: 1n }, { user_id: 'ghost', username: null, projects: 1n, views: 0n, copies: 0n }]);
  const admin = await analyticsService.insights();
  expect(admin.topCreators[0]).toEqual({ userId: 'u1', username: 'ada', projects: 2 });
  expect(admin.topAssets[0]).not.toHaveProperty('ownerId');

  const pub = await analyticsService.insights(10, true) as { topAssets: { owner: string | null }[]; topCreators: { name: string | null; avatarUrl: string | null }[] };
  expect(pub.topAssets.map((a) => a.owner)).toEqual(['Ada', 'Official', null]);
  expect(pub.topCreators).toMatchObject([{ name: 'Ada', avatarUrl: 'a.png', views: 5 }, { name: null, avatarUrl: null }]);
});
