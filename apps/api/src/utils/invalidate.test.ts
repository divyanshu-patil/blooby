import { expect, it, vi } from 'vitest';

const publish = vi.fn(() => Promise.reject(new Error('down')));
const on = vi.fn();
const subscribe = vi.fn(() => Promise.reject(new Error('down')));
vi.mock('../config/redis.js', () => ({ redis: { publish }, redisSub: { subscribe, on } }));

const { shared, listenForInvalidations } = await import('./invalidate.js');

it('forgets locally, publishes to the others, and survives a failed publish', async () => {
  const forget = vi.fn();
  shared('profiles', forget)('k1');
  expect(forget).toHaveBeenCalledWith('k1');
  expect(publish).toHaveBeenCalledWith('blooby:invalidate', 'profiles\u0000k1');
});

it('listens once, resubscribes on ready, and routes a message to the right cache', () => {
  const forget = vi.fn();
  shared('c', forget);
  listenForInvalidations();
  listenForInvalidations(); // second call is a no-op
  expect(subscribe).toHaveBeenCalledTimes(1);
  const handlers = Object.fromEntries(on.mock.calls.map(([n, f]) => [n, f]));
  handlers.ready();
  expect(subscribe).toHaveBeenCalledTimes(2);
  handlers.message('other', 'c\u0000k');   // wrong channel
  handlers.message('blooby:invalidate', 'no-separator');
  handlers.message('blooby:invalidate', 'unknown\u0000k'); // no such cache
  expect(forget).not.toHaveBeenCalled();
  handlers.message('blooby:invalidate', 'c\u0000k');
  expect(forget).toHaveBeenCalledWith('k');
});
