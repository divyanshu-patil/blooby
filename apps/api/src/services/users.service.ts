import type { UserRole } from '@prisma/client';
import type { User } from '@supabase/supabase-js';
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
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const PER_PAGE = 1000;

/** A profile plus its auth identity. The chosen username and uploaded avatar win over the provider's. */
const joined = <P extends { username: string | null; avatarUrl: string | null }>(
  p: P, i?: { email: string | null; name: string | null; avatarUrl: string | null; lastSignInAt: string | null },
) => ({ ...p, email: i?.email ?? null, lastSignInAt: i?.lastSignInAt ?? null, name: p.username ?? i?.name ?? null, avatarUrl: p.avatarUrl ?? i?.avatarUrl ?? null });

/** Auth accounts for `wanted`, paging the Admin API until all are found or it runs out. */
async function accounts(wanted: Set<string>) {
  const found: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw HttpError.upstream(`Could not load accounts: ${error.message}`);
    found.push(...data.users.filter((u) => wanted.has(u.id)));
    if (found.length >= wanted.size || data.users.length < PER_PAGE) return found;
  }
}

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
        ...joined(p, identities.get(p.id)),
        projectCount: projectCount.get(p.id) ?? 0,
      }))
      // search is applied after the join because the term matches email, which only the
      // Admin API knows about
      .filter((u) => !dto.q || `${u.email ?? ''} ${u.name ?? ''}`.toLowerCase().includes(dto.q.toLowerCase()));

    return { items: users, nextCursor };
  },

  /**
   * Batched identity lookup. The Admin API only lists, so it is paged until every wanted
   * account is found — a single fixed page silently dropped everyone past the 200th signup.
   */
  async identitiesFor(ids: string[]) {
    const out = new Map<string, { email: string | null; name: string | null; avatarUrl: string | null; lastSignInAt: string | null }>();
    if (!ids.length) return out;
    const wanted = new Set(ids);
    for (const u of await accounts(wanted)) {
      const m = (u.user_metadata ?? {}) as Record<string, unknown>;
      out.set(u.id, {
        email: u.email ?? null,
        name: str(m.full_name) ?? str(m.name),
        avatarUrl: str(m.avatar_url) ?? str(m.picture),
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    return out;
  },

  /**
   * What the public may know about people: a name and an avatar, never an email. The name is
   * the username they chose, else the name their sign-in provider gave. Missing accounts are
   * simply absent from the map.
   */
  async publicNames(ids: string[]) {
    const out = new Map<string, { name: string | null; avatarUrl: string | null }>();
    if (!ids.length) return out;
    const [profiles, identities] = await Promise.all([
      prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatarUrl: true } }),
      // a leaderboard without provider names still renders with usernames — never fail the page on it
      usersService.identitiesFor(ids).catch(() => new Map<string, { name: string | null; avatarUrl: string | null }>()),
    ]);
    for (const p of profiles) {
      const i = identities.get(p.id);
      out.set(p.id, { name: p.username ?? i?.name ?? null, avatarUrl: p.avatarUrl ?? i?.avatarUrl ?? null });
    }
    return out;
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

    return { ...joined(profile, identity.get(userId)), projectCount, publishedAssets: published, pendingAssets: pending, recentProjects };
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
