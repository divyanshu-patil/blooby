import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ttlCache } from '../utils/ttlCache.js';
import { page } from './projects.repository.js';

/**
 * The profile behind `req.user`, cached.
 *
 * `authenticate` reads this on EVERY authenticated request to resolve the role, and one
 * round trip to the pooler is ~580ms from this deployment — it was the single largest
 * fixed cost in the API, paid by saves, lists and polls alike. The TTL is short and every
 * write below evicts the row, so a role change or a What's New tick is visible at once;
 * the only thing the window can hide is a profile row changed OUTSIDE this server (in the
 * Supabase console), which takes up to `PROFILE_TTL_MS` to be noticed.
 */
const PROFILE_TTL_MS = 30_000;
const cached = ttlCache(PROFILE_TTL_MS, (id: string) => prisma.profile.findUnique({ where: { id } }));

export const profilesRepository = {
  findById: (id: string) => prisma.profile.findUnique({ where: { id } }),

  /** findById, off the cache. For the hot path only — anything that then WRITES the row
   *  should read it uncached, so it is not deciding from a value up to 30s old. */
  findCached: (id: string) => cached(id),

  /** Called by every write here, and by anything else that changes a profile row. */
  forget: (id: string) => cached.forget(id),

  async list(where: Prisma.ProfileWhereInput, opts: { limit: number; cursor?: string }) {
    const rows = await prisma.profile.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return page(rows, opts.limit);
  },

  // evicted AFTER the write lands, not before: a read racing the update would otherwise
  // repopulate the cache with the old row and hold it for the whole TTL
  setRole: (id: string, role: UserRole) =>
    prisma.profile.update({ where: { id }, data: { role } }).finally(() => cached.forget(id)),

  setLastSeenRelease: (id: string, version: string) =>
    prisma.profile.update({ where: { id }, data: { lastSeenRelease: version } }).finally(() => cached.forget(id)),

  touchLogin: (id: string) =>
    prisma.profile.update({ where: { id }, data: { lastLoginAt: new Date() } }).finally(() => cached.forget(id)),

  count: (where?: Prisma.ProfileWhereInput) => prisma.profile.count({ where }),
};
