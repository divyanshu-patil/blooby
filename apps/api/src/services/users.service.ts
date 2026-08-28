import type { UserRole } from '@prisma/client';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/prisma.js';
import { profilesRepository } from '../repositories/profiles.repository.js';
import { HttpError } from '../utils/httpError.js';
import type { ListUsersDto } from '../dtos/admin/index.js';

/**
 * auth.users lives in Supabase's own schema and is not reachable with the publishable
 * key even under RLS, so identity (email, avatar, last sign-in) comes from the Admin API
 * while everything app-owned comes from Prisma. This service is the only place the two
 * are stitched together.
 */
export const usersService = {
  async list(dto: ListUsersDto) {
    const { items, nextCursor } = await profilesRepository.list(
      dto.role ? { role: dto.role } : {},
      { limit: dto.limit, cursor: dto.cursor },
    );

    const identities = await usersService.identitiesFor(items.map((p) => p.id));
    const counts = await prisma.project.groupBy({
      by: ['userId'],
      where: { userId: { in: items.map((p) => p.id) } },
      _count: { _all: true },
    });
    const projectCount = new Map(counts.map((c) => [c.userId, c._count._all]));

    const users = items
      .map((p) => ({
        ...p,
        ...identities.get(p.id),
        projectCount: projectCount.get(p.id) ?? 0,
      }))
      // search is applied after the join because the term matches email, which only the
      // Admin API knows about
      .filter((u) => !dto.q || `${u.email ?? ''} ${u.username ?? ''}`.toLowerCase().includes(dto.q.toLowerCase()));

    return { items: users, nextCursor };
  },

  /** Batched identity lookup. One Admin API page covers a listing page comfortably. */
  async identitiesFor(ids: string[]) {
    if (!ids.length) return new Map<string, { email: string | null; avatarUrl: string | null; lastSignInAt: string | null }>();
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw HttpError.upstream(`Could not load accounts: ${error.message}`);

    const wanted = new Set(ids);
    return new Map(
      data.users
        .filter((u) => wanted.has(u.id))
        .map((u) => [
          u.id,
          {
            email: u.email ?? null,
            avatarUrl: (u.user_metadata?.avatar_url as string | undefined) ?? null,
            lastSignInAt: u.last_sign_in_at ?? null,
          },
        ]),
    );
  },

  async detail(userId: string) {
    const profile = await profilesRepository.findById(userId);
    if (!profile) throw HttpError.notFound('No such user');

    const [identity, projectCount, published, pending, recentProjects] = await Promise.all([
      usersService.identitiesFor([userId]),
      prisma.project.count({ where: { userId } }),
      prisma.asset.count({ where: { ownerId: userId, status: 'published' } }),
      prisma.asset.count({ where: { ownerId: userId, status: 'pending_review' } }),
      // metadata only — an admin browsing users does not silently open private work
      prisma.project.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, name: true, thumbnailUrl: true, updatedAt: true, visibility: true },
      }),
    ]);

    return { ...profile, ...identity.get(userId), projectCount, publishedAssets: published, pendingAssets: pending, recentProjects };
  },

  async setRole(userId: string, role: UserRole, actingAdminId: string) {
    // an admin demoting themselves can lock the last admin out of the panel
    if (userId === actingAdminId && role !== 'admin') {
      throw HttpError.badRequest('You cannot remove your own administrator access');
    }
    const profile = await profilesRepository.findById(userId);
    if (!profile) throw HttpError.notFound('No such user');
    return profilesRepository.setRole(userId, role);
  },

  touchLogin: (userId: string) => profilesRepository.touchLogin(userId),
};
