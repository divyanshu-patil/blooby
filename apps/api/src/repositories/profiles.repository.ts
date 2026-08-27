import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { page } from './projects.repository.js';

export const profilesRepository = {
  findById: (id: string) => prisma.profile.findUnique({ where: { id } }),

  async list(where: Prisma.ProfileWhereInput, opts: { limit: number; cursor?: string }) {
    const rows = await prisma.profile.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return page(rows, opts.limit);
  },

  setRole: (id: string, role: UserRole) => prisma.profile.update({ where: { id }, data: { role } }),

  touchLogin: (id: string) => prisma.profile.update({ where: { id }, data: { lastLoginAt: new Date() } }),

  count: (where?: Prisma.ProfileWhereInput) => prisma.profile.count({ where }),
};
