/**
 * A per-process read-through cache with a TTL.
 *
 * It exists because of a number: one round trip to the Supabase pooler from this
 * deployment measures ~580ms. Anything read on the way IN to a request — the caller's
 * profile, an account directory — costs that on every single call, and no amount of
 * query tuning helps, because the query is not what is slow; the wire is.
 *
 * It caches the PROMISE, not the value, which is the part that matters most. A dashboard
 * opening forty cards at once used to fire forty identical lookups; they now share one
 * in-flight request, so the first save of a burst pays the round trip and the rest pay
 * nothing. A rejection is evicted immediately — a failed load must never be remembered.
 *
 * Deliberately not Redis. This is one process per deployment; a second instance simply
 * keeps its own copy, and every entry here is either re-derivable or invalidated by the
 * write that changed it (`forget`). Reach for a shared cache when there is a value that
 * MUST be consistent across instances — none of these are.
 */
export function ttlCache<V>(ttlMs: number, load: (key: string) => Promise<V>) {
  const entries = new Map<string, { at: number; value: Promise<V> }>();

  const get = (key: string): Promise<V> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;

    const value = load(key).catch((e: unknown) => {
      entries.delete(key);
      throw e;
    });
    entries.set(key, { at: Date.now(), value });

    // swept on write rather than on a timer, so an idle process holds no interval open
    if (entries.size > 2_000) {
      const now = Date.now();
      for (const [k, v] of entries) if (now - v.at >= ttlMs) entries.delete(k);
    }
    return value;
  };

  /** Called by whatever wrote the underlying row, so a change is visible immediately. */
  get.forget = (key: string) => { entries.delete(key); };
  get.clear = () => { entries.clear(); };
  get.size = () => entries.size;
  return get;
}
