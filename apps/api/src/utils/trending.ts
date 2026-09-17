/**
 * Trending: engagement that is still arriving beats engagement that happened long ago.
 * The Hacker News shape — (engagement + 1) / (age in hours + 2)^1.5 — so a week-old item
 * needs about 30× the engagement of a day-old one to sit above it.
 *
 * ponytail: ranked in memory over a bounded candidate set (the caller fetches the most
 * recent / most used few hundred). Move the score into SQL with an index when the public
 * catalogue outgrows that window.
 */
export const TRENDING_POOL = 500;

export function trendingScore(engagement: number, at: Date, now = Date.now()): number {
  const hours = Math.max(0, (now - at.getTime()) / 3_600_000);
  return (Math.max(0, engagement) + 1) / Math.pow(hours + 2, 1.5);
}

export function rankTrending<T>(rows: T[], engagement: (r: T) => number, at: (r: T) => Date, limit: number, now = Date.now()): T[] {
  return rows
    .map((r) => ({ r, s: trendingScore(engagement(r), at(r), now) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}
