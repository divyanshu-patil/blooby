import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/**
 * Data access for projects. Deliberately thin: it knows how to read and write rows and
 * nothing about S3, ownership rules or versioning — those are the service's job.
 */
export const projectsRepository = {
  findById: (id: string) => prisma.project.findUnique({ where: { id } }),

  /** Cursor-paginated. Keyset beats OFFSET, which rescans everything it skips. */
  async listByUser(userId: string, opts: { limit: number; cursor?: string; q?: string; sort: 'recent' | 'created' | 'name' }) {
    const orderBy: Prisma.ProjectOrderByWithRelationInput =
      opts.sort === 'name' ? { name: 'asc' } : opts.sort === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' };

    const rows = await prisma.project.findMany({
      where: {
        userId,
        ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
      },
      orderBy: [orderBy, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return page(rows, opts.limit);
  },

  create: (data: Prisma.ProjectUncheckedCreateInput) => prisma.project.create({ data }),

  update: (id: string, data: Prisma.ProjectUncheckedUpdateInput) =>
    prisma.project.update({ where: { id }, data }),

  /**
   * Bump the version only if it still matches what the caller last saw. Returns 0 when
   * someone else saved first — that is how a lost update is detected rather than
   * silently overwriting another tab's work.
   */
  async bumpVersionIfCurrent(id: string, expected: number, data: Prisma.ProjectUncheckedUpdateInput) {
    const { count } = await prisma.project.updateMany({
      where: { id, currentVersion: expected },
      data,
    });
    return count;
  },

  delete: (id: string) => prisma.project.delete({ where: { id } }),

  countByUser: (userId: string) => prisma.project.count({ where: { userId } }),
};

/** Shared cursor-page shaping: fetch limit+1, use the extra row as the has-more probe. */
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
