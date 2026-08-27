import type { AssetKind, AssetSource, AssetStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { page } from './projects.repository.js';

export const assetsRepository = {
  findById: (id: string) => prisma.asset.findUnique({ where: { id } }),

  /** One query backs every browse surface — built-in, official, community, and mine.
   *  The caller varies the filter; the shape and paging never change. */
  async list(where: Prisma.AssetWhereInput, opts: { limit: number; cursor?: string; sort: 'newest' | 'popular' | 'name' }) {
    const orderBy: Prisma.AssetOrderByWithRelationInput =
      opts.sort === 'popular' ? { downloadCount: 'desc' } : opts.sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' };

    const rows = await prisma.asset.findMany({
      where,
      orderBy: [orderBy, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return page(rows, opts.limit);
  },

  create: (data: Prisma.AssetUncheckedCreateInput) => prisma.asset.create({ data }),
  update: (id: string, data: Prisma.AssetUncheckedUpdateInput) => prisma.asset.update({ where: { id }, data }),
  delete: (id: string) => prisma.asset.delete({ where: { id } }),

  incrementDownloads: (id: string) =>
    prisma.asset.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),

  countBy: (where: Prisma.AssetWhereInput) => prisma.asset.count({ where }),

  countByStatus: (status: AssetStatus) => prisma.asset.count({ where: { status } }),

  countPublished: (kind: AssetKind, source: AssetSource) =>
    prisma.asset.count({ where: { kind, source, status: 'published' } }),
};
