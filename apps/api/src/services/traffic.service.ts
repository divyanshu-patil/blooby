import { prisma } from '../config/prisma.js';

/**
 * What the traffic and MCP tabs of the admin panel show.
 *
 * Raw SQL rather than Prisma's groupBy throughout: every one of these is a GROUP BY with a
 * COUNT DISTINCT or a percentile, which the query builder cannot express, and each is one
 * round trip instead of one per bucket. They run concurrently — the round trip is the cost,
 * not the query.
 *
 * `bigint` comes back from every count and JSON.stringify throws on it, so everything
 * crossing the boundary is mapped to Number here rather than relying on the app's replacer.
 */

const n = (v: bigint | number | null) => Number(v ?? 0);

/** A dense per-day series: a day with no traffic is a zero, not a gap the chart skips. */
function densify<T extends { day: Date }>(rows: T[], days: number, pick: (r: T) => Record<string, number>, zero: Record<string, number>) {
  const by = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), pick(r)]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, ...zero, ...by.get(date) };
  });
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

export const trafficService = {
  /**
   * Page analytics: the shape Vercel's Web Analytics answers — views and visitors over
   * time, which pages, where people came from, and where they go next.
   */
  async pages(days: number, app: string) {
    const from = since(days);
    const prev = since(days * 2);

    const [series, top, referrers, devices, flows, totals, before] = await Promise.all([
      prisma.$queryRaw<{ day: Date; views: bigint; visitors: bigint }[]>`
        select date_trunc('day', at)::date as day, count(*)::bigint as views,
               count(distinct visitor)::bigint as visitors
        from public.page_views where at >= ${from} and app = ${app}
        group by 1 order by 1`,

      prisma.$queryRaw<{ path: string; views: bigint; visitors: bigint; signed_in: bigint }[]>`
        select path, count(*)::bigint as views, count(distinct visitor)::bigint as visitors,
               count(*) filter (where user_id is not null)::bigint as signed_in
        from public.page_views where at >= ${from} and app = ${app}
        group by path order by views desc limit 20`,

      prisma.$queryRaw<{ referrer: string | null; views: bigint; visitors: bigint }[]>`
        select referrer, count(*)::bigint as views, count(distinct visitor)::bigint as visitors
        from public.page_views
        where at >= ${from} and app = ${app} and referrer is not null
        group by referrer order by views desc limit 12`,

      prisma.$queryRaw<{ device: string | null; views: bigint }[]>`
        select device, count(*)::bigint as views
        from public.page_views where at >= ${from} and app = ${app}
        group by device order by views desc`,

      // how people actually move: the page they were on, and the one they opened next
      prisma.$queryRaw<{ from_path: string; path: string; views: bigint }[]>`
        select from_path, path, count(*)::bigint as views
        from public.page_views
        where at >= ${from} and app = ${app} and from_path is not null and from_path <> path
        group by 1, 2 order by views desc limit 15`,

      prisma.$queryRaw<{ views: bigint; visitors: bigint; signed_in: bigint; entries: bigint }[]>`
        select count(*)::bigint as views, count(distinct visitor)::bigint as visitors,
               count(distinct user_id)::bigint as signed_in,
               count(*) filter (where from_path is null)::bigint as entries
        from public.page_views where at >= ${from} and app = ${app}`,

      // the window before this one, so a number can be "up 18%" instead of just a number
      prisma.$queryRaw<{ views: bigint; visitors: bigint }[]>`
        select count(*)::bigint as views, count(distinct visitor)::bigint as visitors
        from public.page_views where at >= ${prev} and at < ${from} and app = ${app}`,
    ]);

    const now = totals[0] ?? { views: 0n, visitors: 0n, signed_in: 0n, entries: 0n };
    const was = before[0] ?? { views: 0n, visitors: 0n };
    /** Percent change against the preceding window. Null from zero: "+100%" from nothing
     *  is noise, not insight. */
    const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

    return {
      days,
      app,
      totals: {
        views: n(now.views),
        visitors: n(now.visitors),
        signedInVisitors: n(now.signed_in),
        /** views that began a session — no page inside the app before them */
        entries: n(now.entries),
        viewsPerVisitor: n(now.visitors) ? Number((n(now.views) / n(now.visitors)).toFixed(1)) : 0,
      },
      deltas: { views: delta(n(now.views), n(was.views)), visitors: delta(n(now.visitors), n(was.visitors)) },
      series: densify(series, days, (r) => ({ views: n(r.views), visitors: n(r.visitors) }), { views: 0, visitors: 0 }),
      topPages: top.map((r) => ({ path: r.path, views: n(r.views), visitors: n(r.visitors), signedIn: n(r.signed_in) })),
      referrers: referrers.map((r) => ({ source: r.referrer ?? 'direct', views: n(r.views), visitors: n(r.visitors) })),
      devices: devices.map((r) => ({ device: r.device ?? 'unknown', views: n(r.views) })),
      flows: flows.map((r) => ({ from: r.from_path, to: r.path, views: n(r.views) })),
    };
  },

  /**
   * MCP usage: who connected an AI app, which apps, and what they are doing with it.
   *
   * Every number comes from mcp_audit and mcp_tokens, which are written already — the
   * audit row is one per capability call, with names and ids and never an argument.
   */
  async mcp(days: number) {
    const from = since(days);
    const prev = since(days * 2);

    const [totals, before, series, clients, capabilitiesUsed, errors, connections, recent] = await Promise.all([
      prisma.$queryRaw<{ calls: bigint; people: bigint; failed: bigint; p50: number | null; p95: number | null; projects: bigint }[]>`
        select count(*)::bigint as calls, count(distinct user_id)::bigint as people,
               count(*) filter (where not ok)::bigint as failed,
               percentile_cont(0.5) within group (order by duration_ms)::float as p50,
               percentile_cont(0.95) within group (order by duration_ms)::float as p95,
               count(distinct project_id)::bigint as projects
        from public.mcp_audit where created_at >= ${from}`,

      prisma.$queryRaw<{ calls: bigint; people: bigint }[]>`
        select count(*)::bigint as calls, count(distinct user_id)::bigint as people
        from public.mcp_audit where created_at >= ${prev} and created_at < ${from}`,

      prisma.$queryRaw<{ day: Date; calls: bigint; people: bigint; failed: bigint }[]>`
        select date_trunc('day', created_at)::date as day, count(*)::bigint as calls,
               count(distinct user_id)::bigint as people,
               count(*) filter (where not ok)::bigint as failed
        from public.mcp_audit where created_at >= ${from}
        group by 1 order by 1`,

      /**
       * Grouped by the app's NAME, not its client_id.
       *
       * Clients register themselves (RFC 7591), so one AI app registering twice — a
       * reinstall, a second workspace — has two client_ids and would otherwise appear as
       * two rows both called "Claude". The question this answers is "which apps", and two
       * installations of Claude are one app. A personal access token has no registration
       * at all and is its own bucket.
       */
      prisma.$queryRaw<{ name: string; installs: bigint; calls: bigint; people: bigint; failed: bigint; last_at: Date }[]>`
        select coalesce(c.client_name, a.client_id, 'Personal access token') as name,
               count(distinct a.client_id)::bigint as installs,
               count(*)::bigint as calls,
               count(distinct a.user_id)::bigint as people,
               count(*) filter (where not a.ok)::bigint as failed,
               max(a.created_at) as last_at
        from public.mcp_audit a
        left join public.mcp_clients c on c.client_id = a.client_id
        where a.created_at >= ${from}
        group by 1 order by calls desc limit 20`,

      prisma.$queryRaw<{ operation: string; calls: bigint; people: bigint; failed: bigint; avg_ms: number | null }[]>`
        select operation, count(*)::bigint as calls, count(distinct user_id)::bigint as people,
               count(*) filter (where not ok)::bigint as failed, avg(duration_ms)::float as avg_ms
        from public.mcp_audit where created_at >= ${from}
        group by operation order by calls desc limit 20`,

      prisma.$queryRaw<{ error_code: string; calls: bigint }[]>`
        select error_code, count(*)::bigint as calls
        from public.mcp_audit
        where created_at >= ${from} and not ok and error_code is not null
        group by 1 order by calls desc limit 12`,

      // what is connected RIGHT NOW, which is a different question from what has been used
      prisma.$queryRaw<{ kind: string; people: bigint; credentials: bigint }[]>`
        select kind, count(distinct user_id)::bigint as people, count(*)::bigint as credentials
        from public.mcp_tokens
        where kind in ('pat', 'access', 'refresh') and revoked_at is null
          and (expires_at is null or expires_at > now())
        group by kind`,

      prisma.$queryRaw<{ operation: string; ok: boolean; error_code: string | null; duration_ms: number | null; client_name: string | null; created_at: Date }[]>`
        select a.operation, a.ok, a.error_code, a.duration_ms, c.client_name, a.created_at
        from public.mcp_audit a
        left join public.mcp_clients c on c.client_id = a.client_id
        order by a.created_at desc limit 30`,
    ]);

    const now = totals[0];
    const was = before[0];
    const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
    const live = new Map(connections.map((c) => [c.kind, c]));

    return {
      days,
      totals: {
        calls: n(now?.calls ?? 0),
        people: n(now?.people ?? 0),
        projects: n(now?.projects ?? 0),
        failed: n(now?.failed ?? 0),
        errorRate: n(now?.calls ?? 0) ? Number(((n(now!.failed) / n(now!.calls)) * 100).toFixed(1)) : 0,
        p50Ms: Math.round(now?.p50 ?? 0),
        p95Ms: Math.round(now?.p95 ?? 0),
        /** people with a live credential, however long ago they last used it */
        connectedPeople: n(live.get('access')?.people ?? 0) + n(live.get('pat')?.people ?? 0),
        oauthGrants: n(live.get('access')?.credentials ?? 0),
        personalTokens: n(live.get('pat')?.credentials ?? 0),
      },
      deltas: { calls: delta(n(now?.calls ?? 0), n(was?.calls ?? 0)), people: delta(n(now?.people ?? 0), n(was?.people ?? 0)) },
      series: densify(series, days, (r) => ({ calls: n(r.calls), people: n(r.people), failed: n(r.failed) }), { calls: 0, people: 0, failed: 0 }),
      clients: clients.map((r) => ({
        name: r.name, installs: n(r.installs),
        calls: n(r.calls), people: n(r.people), failed: n(r.failed), lastUsedAt: r.last_at,
      })),
      capabilities: capabilitiesUsed.map((r) => ({
        capability: r.operation, calls: n(r.calls), people: n(r.people), failed: n(r.failed), avgMs: Math.round(r.avg_ms ?? 0),
      })),
      errors: errors.map((r) => ({ code: r.error_code, calls: n(r.calls) })),
      recent: recent.map((r) => ({
        capability: r.operation, ok: r.ok, error: r.error_code, durationMs: r.duration_ms,
        client: r.client_name ?? 'Personal access token', at: r.created_at,
      })),
    };
  },
};
