import { expect, it, vi } from 'vitest';

// a Redis that is either up (a Map behind the four commands used) or down (every command rejects)
let up = true;
const kv = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const ttls = new Map<string, number>();
const when = <T>(v: () => T) => (up ? Promise.resolve(v()) : Promise.reject(new Error('down')));
const redis = {
  get: (k: string) => when(() => kv.get(k) ?? null),
  set: (k: string, v: string, _ex: string, ttl: number) => when(() => { kv.set(k, v); ttls.set(k, ttl); return 'OK'; }),
  del: (k: string) => when(() => Number(kv.delete(k))),
  hget: (k: string, f: string) => when(() => hashes.get(k)?.get(f) ?? null),
  hdel: (k: string, f: string) => when(() => Number(hashes.get(k)?.delete(f) ?? 0)),
  hvals: (k: string) => when(() => [...(hashes.get(k)?.values() ?? [])]),
  multi: () => {
    const ops: (() => void)[] = [];
    const m = {
      hset: (k: string, f: string, v: string) => { ops.push(() => { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k)!.set(f, v); }); return m; },
      expire: (k: string, ttl: number) => { ops.push(() => { ttls.set(k, ttl); }); return m; },
      exec: () => when(() => ops.map((o) => o())),
    };
    return m;
  },
};
vi.mock('../config/redis.js', () => ({ redis }));

const sweeps: (() => void)[] = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((f: () => void, ms?: number) => { sweeps.push(f); return realSetInterval(f, ms); }) as typeof setInterval;
const { sharedState } = await import('./sharedState.js');
globalThis.setInterval = realSetInterval;

it('with Redis up, values and hashes live there under one prefix, with their TTLs', async () => {
  await sharedState.set('a', { n: 1 }, 60);
  expect(kv.get('blooby:state:a')).toBe('{"n":1}');
  expect(ttls.get('blooby:state:a')).toBe(60);
  kv.set('blooby:state:a', '{"n":2}');                 // another instance wrote it: Redis is the truth
  expect(await sharedState.get('a')).toEqual({ n: 2 });
  expect(await sharedState.get('missing')).toBeUndefined();
  await sharedState.del('a');
  expect(kv.has('blooby:state:a')).toBe(false);

  await sharedState.hset('h', 'x', 1, 30);
  await sharedState.hset('h', 'y', 2, 30);
  expect(ttls.get('blooby:state:h')).toBe(30);
  expect(await sharedState.hget('h', 'x')).toBe(1);
  expect(await sharedState.hget('h', 'nope')).toBeUndefined();
  expect((await sharedState.hvals<number>('h')).sort()).toEqual([1, 2]);
  await sharedState.hdel('h', 'x');
  expect(await sharedState.hvals('h')).toEqual([2]);
  expect(await sharedState.hvals('no-hash')).toEqual([]);
});

it('with Redis down, this process answers from what it wrote itself — never an error', async () => {
  up = false;
  await sharedState.set('b', 'kept', 60);
  expect(await sharedState.get('b')).toBe('kept');
  await sharedState.hset('hb', 'f', { ok: true }, 60);
  expect(await sharedState.hget('hb', 'f')).toEqual({ ok: true });
  expect(await sharedState.hvals('hb')).toEqual([{ ok: true }]);
  // a hash key read as a value, and a value key read as a hash, are simply missing
  expect(await sharedState.get('hb')).toBeUndefined();
  expect(await sharedState.hget('b', 'f')).toBeUndefined();
  await sharedState.hdel('hb', 'f');
  expect(await sharedState.hvals('hb')).toEqual([]);
  await sharedState.del('b');
  expect(await sharedState.get('b')).toBeUndefined();
  up = true;
});

it('what this process holds expires by its TTL, read or not', async () => {
  up = false;
  await sharedState.set('short', 1, 1);
  await sharedState.set('swept', 1, 1);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 2000);
  try {
    expect(await sharedState.get('short')).toBeUndefined();
    sweeps.forEach((f) => f());
    expect(await sharedState.get('swept')).toBeUndefined();
  } finally { vi.useRealTimers(); up = true; }
});
