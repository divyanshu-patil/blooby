import { redis, redisSub } from '../config/redis.js';

/**
 * Telling the OTHER instances to forget something.
 *
 * The caches in this server are in memory on purpose: a lookup that costs nothing is the
 * whole point, and routing it through Redis would trade a ~580ms round trip to Postgres
 * for a ~1ms one to Redis on every single request, forever. So the value stays local and
 * only the INVALIDATION is shared — when one instance writes a profile, every instance
 * drops its copy within the time it takes a message to cross Redis.
 *
 * With no Redis this is exactly what it was before: a local `forget`, and a TTL as the
 * upper bound on staleness. Nothing here is required for correctness of a single process.
 *
 * What this is NOT: a distributed cache, a lock, or a way to make two instances agree on
 * a value. It is one message saying "this key changed, stop trusting what you have".
 */
const CHANNEL = 'blooby:invalidate';

const handlers = new Map<string, (key: string) => void>();

/**
 * Wrap a cache's local `forget` so calling it also tells everyone else.
 *
 * `name` identifies the cache in the message and must be stable across a deploy — it is
 * the only thing that routes a message back to the right map.
 */
export function shared(name: string, forget: (key: string) => void) {
  handlers.set(name, forget);
  return (key: string) => {
    forget(key);
    // fire and forget: a failed publish means other instances keep their copy until its
    // TTL, which is the behaviour this server had before Redis and is never wrong, only
    // briefly stale. It must not fail the write that triggered it.
    void redis?.publish(CHANNEL, `${name}\u0000${key}`).catch(() => {});
  };
}

let listening = false;

/** Start listening. Called once at boot; a no-op without Redis, and safe to call twice. */
export function listenForInvalidations() {
  if (listening || !redisSub) return;
  listening = true;
  redisSub.subscribe(CHANNEL).catch((e: Error) => console.warn(`[invalidate] ${e.message}`));
  redisSub.on('message', (channel: string, message: string) => {
    if (channel !== CHANNEL) return;
    const at = message.indexOf('\u0000');
    if (at < 0) return;
    // the sender hears its own message and forgets a key it has already forgotten: harmless,
    // and cheaper than filtering by an instance id nobody else needs
    handlers.get(message.slice(0, at))?.(message.slice(at + 1));
  });
}
