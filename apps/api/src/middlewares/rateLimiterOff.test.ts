import { expect, it, vi } from 'vitest';

vi.mock('../config/redis.js', () => ({ redis: null }));
const { store } = await import('./rateLimiter.js');

it('uses the in-memory store when there is no redis', () => {
  expect(store('x')).toBeUndefined();
});
