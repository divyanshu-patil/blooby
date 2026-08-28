import { useCallback, useEffect, useState } from 'react';

/** Load-once-with-retry, the shape every list screen needs. Returns a `reload` so an
 *  ErrorState's "Try again" and a post-mutation refresh use the same path. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fn().then(
      (d) => { if (live) { setData(d); setLoading(false); } },
      (e: unknown) => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload, setData };
}
