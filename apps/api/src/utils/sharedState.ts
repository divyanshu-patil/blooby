import type Redis from 'ioredis';
import { redis } from '../config/redis.js';

/**
 * Small JSON state every instance must agree on — the MCP's open project per person, its
 * proposals, live activity, jobs and runs. Redis when there is one; this process's memory
 * when there isn't, which is exactly right for one instance (Render, `pnpm dev`).
 *
 * Unlike utils/invalidate.ts this IS shared state: on Vercel two calls from the same agent
 * land on different instances, and the second must see what the first wrote.
 *
 * Every write lands in memory too, and a read Redis fails is answered from it: an outage
 * degrades to per-instance state, never to an error — the same rule as config/redis.ts.
 * Values are JSON; every key has a TTL, refreshed on write.
 */
const PREFIX = 'blooby:state:';
const local = new Map<string, { exp: number; value: string | Map<string, string> }>();

function mem(key: string) {
  const e = local.get(key);
  if (e && e.exp <= Date.now()) { local.delete(key); return undefined; }
  return e;
}
const memHash = (key: string) => { const v = mem(key)?.value; return v instanceof Map ? v : undefined; };
const parse = <T>(s: string | null | undefined): T | undefined => (s == null ? undefined : JSON.parse(s) as T);

async function remote<T>(op: (r: Redis) => Promise<T>, fallback: () => T): Promise<T> {
  if (!redis) return fallback();
  try { return await op(redis); } catch { return fallback(); }
}

export const sharedState = {
  async get<T>(key: string): Promise<T | undefined> {
    return parse<T>(await remote((r) => r.get(PREFIX + key), () => { const v = mem(key)?.value; return typeof v === 'string' ? v : null; }));
  },
  async set(key: string, value: unknown, ttlSec: number) {
    const s = JSON.stringify(value);
    local.set(key, { exp: Date.now() + ttlSec * 1000, value: s });
    await remote((r) => r.set(PREFIX + key, s, 'EX', ttlSec), () => 'OK');
  },
  async del(key: string) {
    local.delete(key);
    await remote((r) => r.del(PREFIX + key), () => 0);
  },

  /** One field of a hash — a person's proposals, jobs, open projects — read without the rest. */
  async hget<T>(key: string, field: string): Promise<T | undefined> {
    return parse<T>(await remote((r) => r.hget(PREFIX + key, field), () => memHash(key)?.get(field) ?? null));
  },
  async hset(key: string, field: string, value: unknown, ttlSec: number) {
    const s = JSON.stringify(value);
    const h = memHash(key) ?? new Map<string, string>();
    h.set(field, s);
    local.set(key, { exp: Date.now() + ttlSec * 1000, value: h });
    await remote((r) => r.multi().hset(PREFIX + key, field, s).expire(PREFIX + key, ttlSec).exec(), () => null);
  },
  async hdel(key: string, field: string) {
    memHash(key)?.delete(field);
    await remote((r) => r.hdel(PREFIX + key, field), () => 0);
  },
  async hvals<T>(key: string): Promise<T[]> {
    return (await remote((r) => r.hvals(PREFIX + key), () => [...(memHash(key)?.values() ?? [])])).map((s) => JSON.parse(s) as T);
  },
};

// expired keys nobody reads again would otherwise stay in memory for the life of the process
setInterval(() => { for (const k of local.keys()) mem(k); }, 60_000).unref();
