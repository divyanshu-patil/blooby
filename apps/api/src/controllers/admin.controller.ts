import type { Request, Response } from 'express';
import { analyticsService } from '../services/analytics.service.js';
import { usersService } from '../services/users.service.js';
import { assetsService } from '../services/assets.service.js';
import { prisma } from '../config/prisma.js';
import type { AnalyticsRangeDto, ListUsersDto, UpdateUserRoleDto } from '../dtos/admin/index.js';
import type { ListAssetsDto, ModerateAssetDto } from '../dtos/assets/index.js';

export const adminController = {
  async analytics(req: Request, res: Response) {
    const { days } = req.query as unknown as AnalyticsRangeDto;
    const [overview, growth, insights] = await Promise.all([
      analyticsService.overview(days),
      analyticsService.growth(days),
      analyticsService.insights(),
    ]);
    res.json({ overview, growth, insights, days });
  },

  listUsers: (req: Request, res: Response) =>
    usersService.list(req.query as unknown as ListUsersDto).then((r) => res.json(r)),

  getUser: (req: Request, res: Response) => usersService.detail(req.params.id!).then((u) => res.json(u)),

  setUserRole: (req: Request, res: Response) =>
    usersService
      .setRole(req.params.id!, (req.body as UpdateUserRoleDto).role, req.user!.id)
      .then((u) => res.json(u)),

  /** Project METADATA only — never the stored JSON. Admin analytics must not quietly
   *  open private user work (spec §15). */
  async listProjects(req: Request, res: Response) {
    const { limit, cursor, q, userId } = req.query as unknown as { limit: number; cursor?: string; q?: string; userId?: string };
    const rows = await prisma.project.findMany({
      where: { ...(userId ? { userId } : {}), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true, userId: true, thumbnailUrl: true, visibility: true, sizeBytes: true, currentVersion: true, createdAt: true, updatedAt: true },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
  },

  moderationQueue: (req: Request, res: Response) => {
    const dto = req.query as unknown as ListAssetsDto & { status: string };
    return prisma.asset
      .findMany({
        where: { status: dto.status as never },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: dto.limit + 1,
        ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      })
      .then((rows) => {
        const hasMore = rows.length > dto.limit;
        const items = hasMore ? rows.slice(0, dto.limit) : rows;
        res.json({ items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
      });
  },

  moderate: (req: Request, res: Response) =>
    assetsService.moderate(req.params.id!, req.user!.id, req.body as ModerateAssetDto).then((a) => res.json(a)),
};
