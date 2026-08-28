import { prisma } from '../config/prisma.js';

/** What an admin is allowed to see about a key. `secret` is deliberately absent. */
export const KEY_VIEW = {
  id: true, label: true, hint: true, status: true, note: true, lastUsedAt: true, createdAt: true,
} as const;

export const copilotRepository = {
  /** The singleton row. `upsert` rather than `findUnique` so a fresh database that has
   *  not run the seeding insert still answers instead of throwing. */
  settings: () => prisma.copilotSettings.upsert({ where: { id: true }, update: {}, create: { id: true } }),

  setAllowUserKeys: (allowUserKeys: boolean) =>
    prisma.copilotSettings.upsert({
      where: { id: true },
      update: { allowUserKeys, updatedAt: new Date() },
      create: { id: true, allowUserKeys },
    }),

  listForAdmin: () => prisma.copilotKey.findMany({ select: KEY_VIEW, orderBy: { createdAt: 'asc' } }),

  count: () => prisma.copilotKey.count(),

  /**
   * The rotation order: healthy keys first, then rate-limited, then failed, and within
   * each group the one used longest ago. Matches copilot_keys_rotation_idx, so this is an
   * index scan rather than a sort, and it means a key that cooled off gets another turn
   * instead of being retried immediately and rate-limited again.
   */
  pool: () => prisma.$queryRaw<{ id: string; secret: string }[]>`
    select id, secret from public.copilot_keys
    order by case status when 'ok' then 0 when 'rate-limited' then 1 else 2 end,
             last_used_at nulls first
  `,

  create: (data: { label: string; secret: string; hint: string; createdBy?: string }) =>
    prisma.copilotKey.create({ data, select: KEY_VIEW }),

  delete: (id: string) => prisma.copilotKey.delete({ where: { id } }),

  /** Called after every attempt, so the dashboard shows which key is actually working. */
  mark: (id: string, status: 'ok' | 'rate-limited' | 'error', note?: string) =>
    prisma.copilotKey.update({ where: { id }, data: { status, note: note ?? null, lastUsedAt: new Date() } }),
};
