import express, { Router } from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Wiring only: auth passes, bodies are not validated (the DTOs have their own tests), and
// every controller answers 200 — so a request reaching it proves the route is mounted
// where it should be and calls the handler it names.
const ok = (_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true });
const controller = () => new Proxy({}, { get: () => ok });
vi.mock('../middlewares/authenticate.js', () => {
  const pass = (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'u1', role: 'admin' }; next(); };
  return { authenticate: pass, optionalAuth: pass };
});
vi.mock('../middlewares/validateDto.js', () => ({ validate: () => (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock('../controllers/admin.controller.js', () => ({ adminController: controller() }));
vi.mock('../controllers/assets.controller.js', () => ({ assetsController: controller() }));
vi.mock('../controllers/copilot.controller.js', () => ({ copilotController: controller() }));
vi.mock('../controllers/projects.controller.js', () => ({ projectsController: controller() }));
vi.mock('../controllers/splashscreens.controller.js', () => ({ splashscreensController: controller() }));
vi.mock('../controllers/auth.controller.js', () => ({ authController: controller() }));
vi.mock('./mcp.routes.js', () => ({ mcpManageRoutes: Router().get('/ping', (_q, r) => { r.json({ ok: true }); }) }));
vi.mock('../services/analytics.service.js', () => ({ analyticsService: { insights: () => Promise.resolve({ i: 1 }) } }));
const record = vi.fn();
vi.mock('../services/pageViews.service.js', () => ({ pageViewsService: { record } }));

const { routes } = await import('./index.js');
const { splashscreensRoutes } = await import('./splashscreens.routes.js');

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  app.use('/api/splashscreen', splashscreensRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise((r) => server.close(() => r(undefined))));

const id = '3f1c2b8e-1111-4222-8333-444455556666';
const table: [string, string][] = [
  ['GET', '/auth/session'], ['GET', '/auth/profile'], ['POST', '/auth/login-event'], ['PUT', '/auth/whats-new'],
  ['GET', '/projects'], ['POST', '/projects'], ['GET', `/projects/${id}`], ['PATCH', `/projects/${id}`], ['DELETE', `/projects/${id}`],
  ['POST', `/projects/${id}/duplicate`], ['POST', `/projects/${id}/opened`], ['GET', `/projects/${id}/data`], ['PUT', `/projects/${id}/data`],
  ['GET', '/assets'], ['GET', '/assets/mine'], ['POST', '/assets'], ['GET', `/assets/${id}`], ['PATCH', `/assets/${id}`], ['DELETE', `/assets/${id}`],
  ['POST', `/assets/${id}/publish`], ['POST', `/assets/${id}/use`],
  ['GET', '/community'], ['GET', '/community/presets'], ['GET', '/community/expressions'], ['GET', '/community/official'],
  ['GET', '/community/projects'], ['GET', '/community/insights'], ['GET', `/community/${id}`],
  ['GET', '/splashscreen/active'],
  ['GET', '/admin/analytics'], ['GET', '/admin/traffic'], ['GET', '/admin/mcp'], ['GET', '/admin/users'], ['GET', `/admin/users/${id}`],
  ['PATCH', `/admin/users/${id}/role`], ['GET', '/admin/projects'], ['GET', '/admin/community'], ['PATCH', `/admin/community/${id}`],
  ['POST', '/admin/assets'], ['GET', '/admin/splashscreens'], ['POST', '/admin/splashscreens'], ['GET', `/admin/splashscreens/${id}`],
  ['PATCH', `/admin/splashscreens/${id}`], ['POST', `/admin/splashscreens/${id}/publish`], ['POST', `/admin/splashscreens/${id}/unpublish`],
  ['DELETE', `/admin/splashscreens/${id}`], ['GET', '/admin/copilot'], ['PATCH', '/admin/copilot'], ['POST', '/admin/copilot/keys'],
  ['DELETE', `/admin/copilot/keys/${id}`],
  ['GET', '/copilot/config'], ['POST', '/copilot/chat'],
  ['GET', '/mcp/ping'],
];

it.each(table)('%s %s is routed to its handler', async (method, path) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
  expect(res.status).toBe(200);
});

it('records a page view and answers 204', async () => {
  const res = await fetch(`${base}/events/view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(204);
  expect(record).toHaveBeenCalled();
});
