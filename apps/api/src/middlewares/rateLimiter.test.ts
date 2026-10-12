import { expect, it, vi } from 'vitest';

const call = vi.fn(() => Promise.resolve(1));
vi.mock('../config/redis.js', () => ({ redis: { call } }));
// the store loads Lua scripts at construction; here both loads fail, like Redis down at boot
vi.mock('rate-limit-redis', () => ({
  RedisStore: class {
    constructor(public opts: { prefix: string; sendCommand: (...a: string[]) => unknown }) {}
    loadIncrementScript() { return Promise.reject(new Error('down')); }
    increment() { return Promise.resolve({ totalHits: 1, resetTime: new Date() }); }
    decrement() { /* store interface */ }
    resetKey() { /* store interface */ }
    loadGetScript() { return Promise.reject(new Error('down')); }
  },
}));

const { store, caller } = await import('./rateLimiter.js');

it('keys a bearer token by hash and an address by ip, including a missing one', () => {
  const t = caller({ headers: { authorization: 'Bearer abc' } } as never);
  expect(t).toMatch(/^t:/);
  expect(t).not.toContain('abc');
  expect(caller({ headers: {}, ip: '1.2.3.4' } as never)).toBe('ip:1.2.3.4');
  expect(caller({ headers: {} } as never)).toMatch(/^ip:/);
});

it('builds a redis-backed store that survives a failed script load and forwards commands', async () => {
  const s = store('x') as unknown as { opts: { prefix: string; sendCommand: (...a: string[]) => unknown }; loadIncrementScript: () => Promise<string>; loadGetScript: () => Promise<string> };
  expect(s.opts.prefix).toBe('rl:x:');
  expect(await s.loadIncrementScript()).toMatch(/^0+$/);
  expect(await s.loadGetScript()).toMatch(/^0+$/);
  await s.opts.sendCommand('PING');
  expect(call).toHaveBeenCalledWith('PING');
});
