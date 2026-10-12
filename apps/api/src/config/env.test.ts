import { afterEach, expect, it, vi } from 'vitest';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.resetModules(); vi.doUnmock('dotenv'); vi.doUnmock('ioredis'); });
const load = async (over: Record<string, string> = {}) => { Object.assign(process.env, over); vi.resetModules(); return import('./env.js'); };

it('reads TRUST_PROXY as off, a hop count, or the list as written', async () => {
  expect((await load({ TRUST_PROXY: 'off' })).env.trustProxy).toBe(false);
  expect((await load({ TRUST_PROXY: '2' })).env.trustProxy).toBe(2);
  expect((await load({ TRUST_PROXY: 'loopback' })).env.trustProxy).toBe('loopback');
});

it('refuses to start on an invalid environment, naming the key', async () => {
  await expect(load({ SUPABASE_URL: 'nope' })).rejects.toThrow(/SUPABASE_URL/);
  delete process.env.SUPABASE_URL;
  await expect(load()).rejects.toThrow(/Invalid environment/);
});

it('names the root when an issue has no path', async () => {
  vi.doMock('./envSchema.js', () => ({ envSchema: { safeParse: () => ({ success: false, error: { issues: [{ path: [], message: 'm' }] } }) } }));
  await expect(load()).rejects.toThrow(/\(root\): m/);
  vi.doUnmock('./envSchema.js');
});

it('loads .env outside tests', async () => {
  const config = vi.fn();
  vi.doMock('dotenv', () => ({ config }));
  await load({ NODE_ENV: 'development' });
  expect(config).toHaveBeenCalled();
});

/* ---- redis ------------------------------------------------------------------- */

const options: { retryStrategy: (n: number) => number }[] = [];
const fakeRedis = (ping: () => Promise<string>) => {
  const handlers: Record<string, (e?: unknown) => void> = {};
  const inst = { on: (n: string, f: (e?: unknown) => void) => { handlers[n] = f; }, ping };
  vi.doMock('ioredis', () => ({ default: vi.fn(function (_url: string, opts: unknown) { options.push(opts as never); return inst; }) }));
  return handlers;
};

it('has no redis without a url, and reports it off', async () => {
  const r = await load({ REDIS_URL: '' });
  const m = await import('./redis.js');
  expect(m.hasRedis()).toBe(false);
  expect(await m.redisStatus()).toBe('off');
  expect(r.env.REDIS_URL).toBe('');
});

it('reports up, down on a wrong answer, and down on a throw', async () => {
  fakeRedis(() => Promise.resolve('PONG'));
  await load({ REDIS_URL: 'redis://x:1' });
  const m = await import('./redis.js');
  expect(await m.redisStatus()).toBe('up');
  vi.resetModules();
  fakeRedis(() => Promise.resolve('NOPE'));
  await load({ REDIS_URL: 'redis://x:1' });
  expect(await (await import('./redis.js')).redisStatus()).toBe('down');
  vi.resetModules();
  fakeRedis(() => Promise.reject(new Error('x')));
  await load({ REDIS_URL: 'redis://x:1' });
  expect(await (await import('./redis.js')).redisStatus()).toBe('down');
});

it('backs off reconnects up to five seconds', async () => {
  fakeRedis(() => Promise.resolve('PONG'));
  await load({ REDIS_URL: 'redis://x:1' });
  await import('./redis.js');
  const { retryStrategy } = options.at(-1)!;
  expect([retryStrategy(1), retryStrategy(100)]).toEqual([200, 5000]);
});

it('warns once per outage and says when it is back', async () => {
  const h = fakeRedis(() => Promise.resolve('PONG'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await load({ REDIS_URL: 'redis://x:1' });
  await import('./redis.js');
  h.ready(); // up before any outage: silent
  h.error({ message: 'boom' } as never);
  h.error({ message: 'again' } as never); // same outage: silent
  expect(warn).toHaveBeenCalledTimes(1);
  h.ready();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('back'));
  h.error({ code: 'ECONNREFUSED' } as never);
  h.ready();
  h.error({} as never);
  expect(warn.mock.calls.map((c) => c[0]).join('|')).toMatch(/boom.*ECONNREFUSED.*connection failed/);
});
