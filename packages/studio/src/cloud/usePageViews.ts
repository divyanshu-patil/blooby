import { useEffect, useRef } from 'react';
import { api } from './client';

/**
 * Tell the server which page this is — once per navigation, for both apps.
 *
 * Cookieless: nothing is stored on the device and nothing identifying is sent. The server
 * makes its own visitor hash from the address and user agent with a salt that rotates
 * daily (see services/pageViews.service.ts), so two people on one day are two and the same
 * person on two days is not linkable. That is why there is no consent banner to build.
 *
 * The PATH is a route, not a URL: '/projects/:id', never a real id. A real id would make
 * every project its own line in "top pages" and would put private ids in an analytics
 * table for nothing. The caller passes the pattern; anything with a uuid in it is
 * rewritten here as a backstop, and the server does it again.
 */

/** '/projects/6f4a…-…' → '/projects/:id' */
export function routeOf(pathname: string): string {
  const clean = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return clean.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id');
}

const device = (): 'desktop' | 'mobile' | 'tablet' => {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  return /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
};

/**
 * Report each page as it opens.
 *
 * `pathname` is whatever the router reports; the effect fires on change. The previous
 * route travels with it, which is what turns a list of pages into how people move between
 * them — and it is why this is one hook rather than a call at each screen.
 *
 * A failed report is swallowed on purpose. A page that will not render because its
 * analytics call was refused is a worse page than one nobody counted.
 */
export function usePageViews(pathname: string, app: 'web' | 'admin' = 'web') {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const path = routeOf(pathname);
    // StrictMode mounts effects twice in development; without this every view is doubled
    if (previous.current === path) return;
    const from = previous.current;
    previous.current = path;

    void api.post('/api/events/view', {
      path,
      app,
      fromPath: from,
      referrer: typeof document === 'undefined' ? null : document.referrer || null,
      device: device(),
    }).catch(() => {});
  }, [pathname, app]);
}
