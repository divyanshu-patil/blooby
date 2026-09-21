import { Router } from 'express';
import { env } from '../config/env.js';
import { validate } from '../middlewares/validateDto.js';
import { uuidParam } from '../dtos/common.js';
import { projectsService } from '../services/projects.service.js';
import * as storage from '../services/storage.service.js';
import { OG_HEIGHT, OG_WIDTH, ogService, readable } from '../services/og.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * What a link to Blooby looks like when somebody pastes it somewhere.
 *
 * Two endpoints, and the reason there are two is that a crawler does not run JavaScript.
 * The app is a single-page build: everything under /projects/… is the same index.html, so
 * an unfurler asking for a shared project gets the site's generic tags and a card that
 * says nothing about the thing being shared. `/og/projects/:id` is that page, rendered
 * here, with the project's own title, description and image — and apps/web/vercel.json
 * sends KNOWN CRAWLERS to it while every human still gets the app.
 *
 * Nothing here is authenticated, and nothing here may leak. A private project renders the
 * generic card with generic words: an unfurl is performed by whatever service the link was
 * pasted into, which is to say by a stranger's server, on a URL that is by definition
 * being shared with people who were never granted anything.
 */
export const ogRoutes = Router();

const id = validate(uuidParam('id'), 'params');

/** A card is deterministic for a given saved version, and an unfurler will ask for it
 *  again and again; a day of CDN caching costs one render per project per deploy. */
const CACHE = 'public, max-age=86400, stale-while-revalidate=604800';

/** The public row and its document, or null for anything not publicly shareable. */
async function publicProject(projectId: string) {
  const row = await projectsService.get(projectId, null).catch(() => null);
  if (!row || row.visibility !== 'public') return null;
  const data = await storage.getProjectJson(row.s3Key).catch(() => null);
  return { row, project: readable(data) };
}

ogRoutes.get('/projects/:id.png', validate(uuidParam('id'), 'params'), asyncHandler(async (req, res) => {
  const found = await publicProject(req.params.id!);
  // a document that will not draw falls back rather than 500ing: this URL is fetched by
  // somebody else's unfurler, and a broken image is a worse answer than a plain card
  let image: Buffer | null = null;
  if (found?.project) {
    try { image = ogService.project(found.project, found.row.name, 'Made with blooby'); }
    catch (e) { console.warn(`[og] ${req.params.id} did not render: ${e instanceof Error ? e.message : String(e)}`); }
  }
  res.type('image/png').set('Cache-Control', CACHE).send(image ?? ogService.generic());
}));

/** The site's own card, for the landing page and anything without a project behind it. */
ogRoutes.get('/card.png', (_req, res) => {
  res.type('image/png').set('Cache-Control', CACHE).send(ogService.generic());
});

const escape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page a crawler gets for a shared project.
 *
 * It is a real page with a real redirect, not a trick: a person who reaches it (a crawler
 * that follows links, someone who pasted the wrong URL) lands in the app where they meant
 * to be. The meta tags are the point; the body is a courtesy.
 */
ogRoutes.get('/projects/:id', id, asyncHandler(async (req, res) => {
  const projectId = req.params.id!;
  const found = await publicProject(projectId);
  const url = `${env.appUrl}/projects/${projectId}`;
  const title = found ? `${found.row.name} — blooby` : 'blooby — mascot studio';
  const description = found
    ? `An animated mascot made with blooby. Open it to watch it play, remix it, or export it as Lottie, GIF or MP4.`
    : 'Design a circle-and-pill mascot, animate it on a timeline, and export Lottie, GIF and MP4.';
  const image = found ? `${env.publicApiUrl}/og/projects/${projectId}.png` : `${env.publicApiUrl}/og/card.png`;

  res.type('html').set('Cache-Control', CACHE).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="blooby">
<meta property="og:url" content="${escape(url)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${escape(image)}">
<meta property="og:image:width" content="${OG_WIDTH}">
<meta property="og:image:height" content="${OG_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(image)}">
<meta http-equiv="refresh" content="0; url=${escape(url)}">
</head>
<body><p>Opening <a href="${escape(url)}">${escape(title)}</a>…</p></body>
</html>`);
}));
