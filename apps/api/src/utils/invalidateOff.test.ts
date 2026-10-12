import { expect, it, vi } from 'vitest';

vi.mock('../config/redis.js', () => ({ redis: null, redisSub: null }));
const { shared, listenForInvalidations } = await import('./invalidate.js');

it('is just a local forget without redis', () => {
  const forget = vi.fn();
  shared('x', forget)('k');
  expect(forget).toHaveBeenCalledWith('k');
  expect(listenForInvalidations()).toBeUndefined();
});
