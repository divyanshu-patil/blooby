import { z } from 'zod';

/**
 * One page view, as the browser reports it.
 *
 * Everything is length-capped because this endpoint is open to anyone with the URL — it
 * has to be, or signed-out traffic would be invisible — so nothing a client sends may be
 * large enough to be worth sending. Nothing here identifies the visitor: who they are (if
 * they are signed in at all) comes from the token, and the visitor hash is computed on the
 * server from things the client cannot choose.
 */
export const pageViewDto = z.object({
  /** the ROUTE, not the url: '/projects/:id'. The server re-normalises anyway. */
  path: z.string().min(1).max(200),
  app: z.enum(['web', 'admin']).default('web'),
  /** the page they came from inside the app, for the navigation flow */
  fromPath: z.string().max(200).nullish(),
  /** document.referrer — only its host is kept */
  referrer: z.string().max(500).nullish(),
  device: z.enum(['desktop', 'mobile', 'tablet']).nullish(),
});
export type PageViewDto = z.infer<typeof pageViewDto>;
