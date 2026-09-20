import { beforeEach, expect, it, vi } from 'vitest';

const listUsers = vi.fn();
vi.mock('../config/supabase.js', () => ({ supabaseAdmin: { auth: { admin: { listUsers } } } }));
vi.mock('../config/prisma.js', () => ({
  prisma: {
    project: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    asset: { count: vi.fn() },
    profile: { findMany: vi.fn() },
  },
}));
vi.mock('../repositories/profiles.repository.js', () => ({
  profilesRepository: { list: vi.fn(), findById: vi.fn(), setRole: vi.fn(), touchLogin: vi.fn() },
}));

const { profilesRepository } = await import('../repositories/profiles.repository.js');
const { prisma } = await import('../config/prisma.js');
const { usersService } = await import('./users.service.js');
const { HttpError } = await import('../utils/httpError.js');

const profiles = profilesRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
const db = prisma as unknown as { project: Record<string, ReturnType<typeof vi.fn>>; asset: Record<string, ReturnType<typeof vi.fn>>; profile: Record<string, ReturnType<typeof vi.fn>> };

beforeEach(() => {
  listUsers.mockReset();
  for (const fn of Object.values(profiles)) fn.mockReset();
  for (const m of [db.project, db.asset, db.profile]) for (const fn of Object.values(m)) fn.mockReset();
  listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  db.project.groupBy.mockResolvedValue([]);
});

const status = async (p: Promise<unknown>) => {
  try { await p; return 0; } catch (e) { return e instanceof HttpError ? e.status : -1; }
};

/** An admin demoting themselves can lock the last admin out of the panel. */
it('refuses to let an admin remove their own access', async () => {
  expect(await status(usersService.setRole('a1', 'user', 'a1'))).toBe(400);
  expect(profiles.setRole).not.toHaveBeenCalled();
});

it('but lets them demote someone else, and re-promote themselves', async () => {
  profiles.findById.mockResolvedValue({ id: 'u2' });
  expect(await status(usersService.setRole('u2', 'user', 'a1'))).toBe(0);
  expect(await status(usersService.setRole('a1', 'admin', 'a1'))).toBe(0);
});

it('refuses a role change for a user that does not exist', async () => {
  profiles.findById.mockResolvedValue(null);
  expect(await status(usersService.setRole('ghost', 'admin', 'a1'))).toBe(404);
});

it('reports an identity-provider failure as an upstream error, not a 500', async () => {
  listUsers.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
  expect(await status(usersService.identitiesFor(['u1']))).toBe(502);
});

it('does not call the identity provider at all for an empty page', async () => {
  expect((await usersService.identitiesFor([])).size).toBe(0);
  expect(listUsers).not.toHaveBeenCalled();
});

it('keeps only the accounts it asked about', async () => {
  listUsers.mockResolvedValue({
    data: { users: [
      { id: 'u1', email: 'a@b.c', user_metadata: { avatar_url: 'pic' }, last_sign_in_at: 't' },
      { id: 'other', email: 'x@y.z' },
    ] },
    error: null,
  });
  const map = await usersService.identitiesFor(['u1']);
  expect([...map.keys()]).toEqual(['u1']);
  expect(map.get('u1')).toEqual({ email: 'a@b.c', name: null, avatarUrl: 'pic', lastSignInAt: 't' });
});

it('fills missing identity fields with null rather than undefined', async () => {
  listUsers.mockResolvedValue({ data: { users: [{ id: 'u1' }] }, error: null });
  expect(await usersService.identitiesFor(['u1']).then((m) => m.get('u1')))
    .toEqual({ email: null, name: null, avatarUrl: null, lastSignInAt: null });
});

/** Search matches email, which only the Admin API knows, so it is applied after the join. */
it('searches across the joined email as well as the profile username', async () => {
  profiles.list.mockResolvedValue({ items: [{ id: 'u1', username: 'zed', avatarUrl: null }, { id: 'u2', username: 'ann', avatarUrl: null }], nextCursor: null });
  listUsers.mockResolvedValue({
    data: { users: [{ id: 'u1', email: 'zed@example.com' }, { id: 'u2', email: 'ann@other.com' }] },
    error: null,
  });
  const byEmail = await usersService.list({ q: 'other.com', limit: 10 } as never);
  expect(byEmail.items.map((u) => u.id)).toEqual(['u2']);

  const byName = await usersService.list({ q: 'ZED', limit: 10 } as never);
  expect(byName.items.map((u) => u.id)).toEqual(['u1']);
});

it('counts a user with no projects as zero rather than leaving it undefined', async () => {
  profiles.list.mockResolvedValue({ items: [{ id: 'u1' }], nextCursor: null });
  db.project.groupBy.mockResolvedValue([]);
  const { items } = await usersService.list({ limit: 10 } as never);
  expect(items[0].projectCount).toBe(0);
});

/** An admin browsing users must not silently open private work. */
it('returns only project metadata in a user detail, never the payload', async () => {
  profiles.findById.mockResolvedValue({ id: 'u1', role: 'user' });
  db.project.count.mockResolvedValue(2);
  db.asset.count.mockResolvedValue(0);
  db.project.findMany.mockResolvedValue([]);
  await usersService.detail('u1');
  const select = db.project.findMany.mock.calls[0][0].select as Record<string, boolean>;
  expect(Object.keys(select).sort()).toEqual(['id', 'name', 'thumbnailUrl', 'updatedAt', 'visibility']);
  expect(select).not.toHaveProperty('s3Key');
});

it('404s a detail for a user that does not exist', async () => {
  profiles.findById.mockResolvedValue(null);
  expect(await status(usersService.detail('ghost'))).toBe(404);
});

/** The leaderboard names people without ever handing out an email. */
it('names people by username, else their provider name — never by email', async () => {
  db.profile.findMany.mockResolvedValue([
    { id: 'u1', username: 'ana', avatarUrl: null },
    { id: 'u2', username: null, avatarUrl: null },
    { id: 'u3', username: null, avatarUrl: null },
  ]);
  listUsers.mockResolvedValue({ data: { users: [
    { id: 'u1', email: 'a@x.io', user_metadata: { full_name: 'Ana Real' } },
    { id: 'u2', email: 'b@x.io', user_metadata: { full_name: 'Bo Diaz', avatar_url: 'https://img/b' } },
    { id: 'u3', email: 'c@x.io', user_metadata: {} },
  ] }, error: null });
  const names = await usersService.publicNames(['u1', 'u2', 'u3']);
  expect(names.get('u1')).toEqual({ name: 'ana', avatarUrl: null });
  expect(names.get('u2')).toEqual({ name: 'Bo Diaz', avatarUrl: 'https://img/b' });
  expect(names.get('u3')).toEqual({ name: null, avatarUrl: null });
  expect(JSON.stringify([...names.values()])).not.toContain('@');
});

/** listUsers pages; one fixed page of 200 used to drop every later signup from the admin list. */
it('pages the identity provider until it finds every account it asked about', async () => {
  const filler = Array.from({ length: 1000 }, (_, i) => ({ id: `f${i}` }));
  listUsers
    .mockResolvedValueOnce({ data: { users: filler }, error: null })
    .mockResolvedValueOnce({ data: { users: [{ id: 'late', email: 'l@x.io', user_metadata: { picture: 'p' } }] }, error: null });
  const map = await usersService.identitiesFor(['late']);
  expect(listUsers).toHaveBeenCalledTimes(2);
  expect(map.get('late')?.avatarUrl).toBe('p');
});

it('prefers the chosen username and uploaded avatar over the provider’s', async () => {
  profiles.list.mockResolvedValue({ items: [{ id: 'u1', username: null, avatarUrl: null }, { id: 'u2', username: 'bo', avatarUrl: 'mine' }], nextCursor: null });
  listUsers.mockResolvedValue({ data: { users: [
    { id: 'u1', user_metadata: { full_name: 'Ana Real', avatar_url: 'g1' } },
    { id: 'u2', user_metadata: { full_name: 'Bo Diaz', avatar_url: 'g2' } },
  ] }, error: null });
  const { items } = await usersService.list({ limit: 10 } as never);
  expect(items.map((u) => [u.name, u.avatarUrl])).toEqual([['Ana Real', 'g1'], ['bo', 'mine']]);
});
