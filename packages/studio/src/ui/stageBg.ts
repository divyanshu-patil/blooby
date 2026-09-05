import { useSyncExternalStore } from 'react';

/**
 * The stage backdrop, shared by the preview and every exporter so what you see is what
 * gets baked. Lives in localStorage rather than the project: it is a per-browser view
 * preference, not part of the document. 'transparent' means no backdrop at all.
 */

const KEY = 'blooby.stageBg';
export const DEFAULT_BG = '#17161b';

const listeners = new Set<() => void>();
let cache: string | null = null;

const read = (): string => {
  if (cache === null) {
    try { cache = localStorage.getItem(KEY) || DEFAULT_BG; } catch { cache = DEFAULT_BG; }
  }
  return cache;
};

export function setStageBg(v: string) {
  cache = v;
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** [colour, setter]; `colour` is 'transparent' or a hex string. */
export function useStageBg(): [string, (v: string) => void] {
  return [useSyncExternalStore(subscribe, read, () => DEFAULT_BG), setStageBg];
}
