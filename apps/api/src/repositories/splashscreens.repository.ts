import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export const splashscreensRepository = {
  findById: (id: string) => prisma.splashscreen.findUnique({ where: { id } }),

  findPublished: () => prisma.splashscreen.findFirst({ where: { status: 'published' } }),

  listAll: () => prisma.splashscreen.findMany({ orderBy: { updatedAt: 'desc' } }),

  create: (data: Prisma.SplashscreenUncheckedCreateInput) => prisma.splashscreen.create({ data }),
  update: (id: string, data: Prisma.SplashscreenUncheckedUpdateInput) =>
    prisma.splashscreen.update({ where: { id }, data }),
  delete: (id: string) => prisma.splashscreen.delete({ where: { id } }),

  /**
   * Publishing is two writes that must not be seen apart: archive whatever is live, then
   * promote this one. A partial unique index enforces "at most one published" in
   * Postgres, so without the transaction the second write would simply fail.
   */
  publish: (id: string) =>
    prisma.$transaction(async (tx) => {
      await tx.splashscreen.updateMany({ where: { status: 'published' }, data: { status: 'archived' } });
      return tx.splashscreen.update({
        where: { id },
        data: { status: 'published', publishedAt: new Date() },
      });
    }),
};
