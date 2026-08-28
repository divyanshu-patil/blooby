import { prisma } from '../config/prisma.js';

/**
 * Analytics derived from the timestamps the app already writes — no event pipeline.
 *
 * ponytail: every number here comes from created_at/updated_at on rows that exist
 * anyway, which answers the questions in the spec ("are users creating more projects
 * this week?") without a second write on every action. Add an events table only when a
 * question arrives that timestamps genuinely cannot answer.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Rows-per-day for a date range, as a dense series (gaps filled with zero, so a chart
 *  shows a flat stretch rather than silently skipping the day). */
function densify(rows: { day: Date; count: bigint }[], days: number) {
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date: d, count: byDay.get(d) ?? 0 };
  });
}

export const analyticsService = {
  /** The metric cards. One round-trip each, all in parallel. */
  async overview(days: number) {
    const since = daysAgo(days);
    const today = daysAgo(1);

    const [totalUsers, newUsers, activeUsers, totalProjects, projectsToday, communityPresets, communityExpressions, officialPublished, pendingReview] =
      await Promise.all([
        prisma.profile.count(),
        prisma.profile.count({ where: { createdAt: { gte: since } } }),
        prisma.profile.count({ where: { lastLoginAt: { gte: since } } }),
        prisma.project.count(),
        prisma.project.count({ where: { createdAt: { gte: today } } }),
        prisma.asset.count({ where: { kind: 'preset', source: 'community', status: 'published' } }),
        prisma.asset.count({ where: { kind: 'expression', source: 'community', status: 'published' } }),
        prisma.asset.count({ where: { source: 'official', status: 'published' } }),
        prisma.asset.count({ where: { status: 'pending_review' } }),
      ]);

    return { totalUsers, newUsers, activeUsers, totalProjects, projectsToday, communityPresets, communityExpressions, officialPublished, pendingReview };
  },

  /** Growth series for the primary chart, plus the previous window so the UI can say
   *  "up 18% this week" instead of just printing a number. */
  async growth(days: number) {
    const since = daysAgo(days);

    const [users, projects] = await Promise.all([
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        select date_trunc('day', created_at)::date as day, count(*)::bigint as count
        from public.profiles where created_at >= ${since}
        group by 1 order by 1`,
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        select date_trunc('day', created_at)::date as day, count(*)::bigint as count
        from public.projects where created_at >= ${since}
        group by 1 order by 1`,
    ]);

    const [prevUsers, prevProjects] = await Promise.all([
      prisma.profile.count({ where: { createdAt: { gte: daysAgo(days * 2), lt: since } } }),
      prisma.project.count({ where: { createdAt: { gte: daysAgo(days * 2), lt: since } } }),
    ]);

    const sum = (s: { count: number }[]) => s.reduce((a, b) => a + b.count, 0);
    const usersSeries = densify(users, days);
    const projectsSeries = densify(projects, days);

    /** Percent change vs the preceding window of equal length. Null when there is no
     *  prior activity to compare against — "+100%" from zero is noise, not insight. */
    const delta = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

    return {
      users: usersSeries,
      projects: projectsSeries,
      deltas: {
        users: delta(sum(usersSeries), prevUsers),
        projects: delta(sum(projectsSeries), prevProjects),
      },
    };
  },

  /** Secondary insights: what people actually use, and who is most active. */
  async insights(limit = 8) {
    const [topAssets, topCreators] = await Promise.all([
      prisma.asset.findMany({
        where: { status: 'published' },
        orderBy: { downloadCount: 'desc' },
        take: limit,
        select: { id: true, name: true, kind: true, source: true, downloadCount: true },
      }),
      prisma.$queryRaw<{ user_id: string; username: string | null; projects: bigint }[]>`
        select p.user_id, pr.username, count(*)::bigint as projects
        from public.projects p
        join public.profiles pr on pr.id = p.user_id
        group by p.user_id, pr.username
        order by projects desc
        limit ${limit}`,
    ]);

    return {
      topAssets,
      topCreators: topCreators.map((c) => ({ userId: c.user_id, username: c.username, projects: Number(c.projects) })),
    };
  },
};
