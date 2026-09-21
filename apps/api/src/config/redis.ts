import Redis from 'ioredis';
import { env } from './env.js';

/**
 * Redis, when there is one.
 *
 * OPTIONAL, deliberately and permanently. Every use of it in this server has a
 * single-process equivalent that is already correct — the rate limiter falls back to its
 * in-memory store, the caches fall back to a TTL — so `pnpm dev:api` with nothing else
 * running behaves exactly as it always did. What Redis adds is only the part a single
 * process cannot do for itself: making those things agree across more than one instance.
 *
 * Locally: `docker compose up -d redis` and REDIS_URL=redis://localhost:6380 (see docker-compose.yml on the port).
 * On Render: add a Key Value (Redis) instance and use its INTERNAL url, which is
 * `redis://…` on the private network and needs no TLS. The external url is `rediss://`,
 * which ioredis handles from the scheme alone.
 *
 * A Redis that goes away must never take the API with it. Every command has a one-second
 * timeout and every caller treats a failure as a miss — the worst outcome of Redis being
 * down is the latency and the per-instance limits this server had before it existed.
 */
function open(role: string): Redis | null {
  if (!env.REDIS_URL) return null;
  const client = new Redis(env.REDIS_URL, {
    // A command that cannot reach Redis must not leave a user waiting: one second, then it
    // fails and the caller treats it as a miss.
    //
    // The offline queue stays ON (the default). Turning it off rejects instantly, which
    // sounds like the same thing and is not: the connection is not up for the first few
    // milliseconds of the process, so every command in that window fails — including the
    // rate limiter's, on the very first requests after a deploy. The timeout already
    // bounds the wait; the queue only covers the gap while a connection comes back.
    commandTimeout: 1_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    connectionName: `blooby-${role}`,
  });
  // ioredis emits 'error' on every failed reconnect; unhandled, that is a crashed process
  client.on('error', (e: Error) => console.warn(`[redis:${role}] ${e.message}`));
  return client;
}

/** Commands. Null when no REDIS_URL is set. */
export const redis = open('main');

/**
 * A SECOND connection, for subscriptions.
 *
 * A connection in subscriber mode accepts nothing but (un)subscribe, so sharing one with
 * the command client above would break the first ordinary GET after the first subscribe.
 */
export const redisSub = open('sub');

export const hasRedis = () => redis !== null;

/**
 * Is there a Redis, and does it answer? One PING, bounded by the client's own 1s
 * `commandTimeout`. `off` is not a failure — running without Redis is supported.
 *
 * This exists because there was no way to tell a working Key Value instance from a
 * misconfigured one without shell access to the host: the boot log says `· redis` as
 * soon as REDIS_URL is non-empty, whether or not anything is listening at the other end.
 */
export async function redisStatus(): Promise<'off' | 'up' | 'down'> {
  if (!redis) return 'off';
  try {
    return (await redis.ping()) === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}
