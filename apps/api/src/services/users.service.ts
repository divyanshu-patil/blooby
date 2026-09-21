import type { UserRole } from '@prisma/client';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/prisma.js';
import { profilesRepository } from '../repositories/profiles.repository.js';
import { HttpError } from '../utils/httpError.js';
import { shared } from '../utils/invalidate.js';
import type { ListUsersDto } from '../dtos/admin/index.js';

/**
 * auth.users lives in Supabase's own schema and is not reachable with the publishable
 * key even under RLS, so identity (email, avatar, last sign-in) comes from the Admin API
 * while everything app-owned comes from Prisma. This service is the only place the two
 * are stitched together.
 */
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const PER_PAGE = 1000;

export interface Identity { email: string | null; name: string | null; avatarUrl: string | null; lastSignInAt: string | null }

/**
 * How long an auth identity is reused.
 *
 * The Admin API only LISTS, so resolving even one unknown id pages through accounts — a
 * network round trip to Supabase, on a page that already paid for its own queries. A
 * community browse or an admin project list asks for a dozen names at a time and asks
 * again on every page, scroll and sort, so without this the same listing was fetched over
 * and over. What it can be stale by is a display name or an avatar someone changed at
 * their identity provider, for at most a minute.
 */
const IDENTITY_TTL_MS = 60_000;
/** id → what the Admin API said, or null for "listed and not there". Misses are cached
 *  too: an id with no auth account would otherwise re-page the whole directory forever. */
const directory = new Map<string, { at: number; identity: Identity | null }>();
const stale = (id: string) => (directory.get(id)?.at ?? 0) < Date.now() - IDENTITY_TTL_MS;
const evictIdentity = shared('identity', (id: string) => { directory.delete(id); });

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

/** One paged Admin API listing, mapped to what this app shows of a person. */
async function fetchIdentities(ids: string[]) {
  const out = new Map<string, Identity>();
  for (const u of await accounts(new Set(ids))) {
    const m = (u.user_metadata ?? {}) as Record<string, unknown>;
    out.set(u.id, {
      email: u.email ?? null,
      name: str(m.full_name) ?? str(m.name),
      avatarUrl: str(m.avatar_url) ?? str(m.picture),
      lastSignInAt: u.last_sign_in_at ?? null,
    });
  }
  return out;
}

export const usersService = {
  async list(dto: ListUsersDto) {
    const { items, nextCursor } = await profilesRepository.list(
      dto.role ? { role: dto.role } : {},
      { limit: dto.limit, cursor: dto.cursor },
    );

    // concurrently: two independent round trips, and one of them leaves this network
    const [identities, counts] = await Promise.all([
      usersService.identitiesFor(items.map((p) => p.id)),
      prisma.project.groupBy({
        by: ['userId'],
        where: { userId: { in: items.map((p) => p.id) } },
        _count: { _all: true },
      }),
    ]);
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
   * Batched identity lookup, cached per account (see IDENTITY_TTL_MS). Only the ids that
   * are not already known are fetched, in ONE paged listing — so a repeat view of the same
   * community page or user list costs nothing, and a page that is mostly familiar faces
   * pays only for the new ones.
   */
  async identitiesFor(ids: string[]) {
    const out = new Map<string, Identity>();
    if (!ids.length) return out;

    const unknown = [...new Set(ids)].filter(stale);
    // one listing for the whole batch, which is what the Admin API is good at
    if (unknown.length) {
      const found = await fetchIdentities(unknown);
      const at = Date.now();
      for (const id of unknown) directory.set(id, { at, identity: found.get(id) ?? null });
    }
    for (const id of new Set(ids)) {
      const hit = directory.get(id)?.identity;
      if (hit) out.set(id, hit);
    }
    return out;
  },

  /** Forget a cached identity so the next read re-asks the provider. No id: forget all. */
  forgetIdentity: (id?: string) => { if (id) evictIdentity(id); else directory.clear(); },

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
