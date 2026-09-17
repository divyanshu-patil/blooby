import { expect, it } from 'vitest';
import { rankTrending, trendingScore } from './trending.js';

const now = Date.parse('2026-09-17T12:00:00Z');
const ago = (h: number) => new Date(now - h * 3_600_000);

it('fresh engagement outranks the same engagement from last week', () => {
  expect(trendingScore(10, ago(1), now)).toBeGreaterThan(trendingScore(10, ago(24 * 7), now));
});

it('a lot of engagement can still outrank a fresher item with none', () => {
  expect(trendingScore(200, ago(24), now)).toBeGreaterThan(trendingScore(0, ago(1), now));
});

it('ranks and trims to the limit', () => {
  const rows = [{ id: 'old', n: 50, at: ago(24 * 30) }, { id: 'hot', n: 20, at: ago(3) }, { id: 'new', n: 0, at: ago(0.5) }];
  expect(rankTrending(rows, (r) => r.n, (r) => r.at, 2, now).map((r) => r.id)).toEqual(['hot', 'new']);
});
