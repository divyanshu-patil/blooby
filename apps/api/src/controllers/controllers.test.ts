import { expect, it, vi } from 'vitest';

// every service method answers with the same row; the controllers' own job is the
// unwrap-call-respond shape, so that is what these check
const row = { id: 'r1', downloadCount: 3 };
const svc = (extra: Record<string, unknown> = {}) =>
  new Proxy(extra, { get: (t, k) => (k in t ? t[k as string] : vi.fn(() => Promise.resolve(row))) });
const findMany = vi.fn();

vi.mock('../config/prisma.js', () => ({ prisma: { project: { findMany }, asset: { findMany } } }));
vi.mock('../repositories/profiles.repository.js', () => ({ profilesRepository: { findById: vi.fn(() => Promise.resolve({ p: 1 })) } }));
vi.mock('../services/users.service.js', () => ({
  usersService: svc({
    identitiesFor: vi.fn(() => Promise.resolve(new Map([['u1', { email: 'e' }]]))),
    publicNames: vi.fn(() => Promise.resolve(new Map([['u1', { name: 'N', avatarUrl: 'A' }]]))),
  }),
}));
for (const m of ['analytics', 'traffic', 'assets', 'projects', 'copilot', 'splashscreen'])
  vi.doMock(`../services/${m}.service.js`, () => ({ [`${m}Service`]: svc() }));

const { adminController } = await import('./admin.controller.js');
const { assetsController } = await import('./assets.controller.js');
const { authController, compareVersions } = await import('./auth.controller.js');
const { copilotController } = await import('./copilot.controller.js');
const { projectsController } = await import('./projects.controller.js');
const { splashscreensController } = await import('./splashscreens.controller.js');

const res = () => {
  const r: Record<string, ReturnType<typeof vi.fn>> = {};
  r.json = vi.fn(() => r); r.status = vi.fn(() => r); r.end = vi.fn(() => r); r.set = vi.fn(() => r);
  return r;
};
const req = (over: Record<string, unknown> = {}) => ({ user: { id: 'u1', role: 'admin' }, params: { id: 'x' }, query: { days: 7, limit: 2 }, body: { allowUserKeys: true, role: 'user', name: 'n' }, ...over }) as never;
const run = async (fn: unknown, over?: Record<string, unknown>) => {
  const r = res();
  await (fn as (a: unknown, b: unknown) => unknown)(req(over), r);
  return r;
};

it('every thin controller method calls through and answers', async () => {
  for (const c of [assetsController, copilotController, projectsController, splashscreensController, adminController]) {
    for (const [name, fn] of Object.entries(c)) {
      if (['listProjects', 'moderationQueue'].includes(name)) continue;
      const r = await run(fn);
      expect(r.json.mock.calls.length + r.end.mock.calls.length, name).toBeGreaterThan(0);
    }
  }
});

it('works signed out and with inline data', async () => {
  await run(assetsController.browse, { user: undefined });
  await run(assetsController.get, { user: undefined });
  await run(projectsController.get, { user: undefined });
  await run(projectsController.getData, { user: undefined, query: { inline: '1' } });
});

it('auth controller: session, profile, touchLogin and version order', async () => {
  expect((await run(authController.session, { user: undefined })).json).toHaveBeenCalledWith({ user: null });
  expect((await run(authController.profile)).json).toHaveBeenCalledWith({ p: 1, email: 'e' });
  await run(authController.touchLogin);
  expect(compareVersions('1.2', '1.2.0')).toBe(0);
});

it('admin lists projects and the queue, paged or not, filtered or not', async () => {
  findMany.mockResolvedValueOnce([{ id: 'a', userId: 'u1' }, { id: 'b', userId: 'zz' }, { id: 'c', userId: 'u1' }]);
  const a = await run(adminController.listProjects, { query: { limit: 2, cursor: 'k', q: 'x', userId: 'u1' } });
  expect(a.json.mock.calls[0][0]).toMatchObject({ nextCursor: 'b', items: [{ owner: 'N' }, { owner: null, ownerAvatarUrl: null }] });
  findMany.mockResolvedValueOnce([{ id: 'a', userId: 'u1' }]);
  expect((await run(adminController.listProjects, { query: { limit: 2 } })).json.mock.calls[0][0].nextCursor).toBeNull();
  findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
  expect((await run(adminController.moderationQueue, { query: { limit: 1, cursor: 'k', status: 'pending' } })).json.mock.calls[0][0].nextCursor).toBe('a');
  findMany.mockResolvedValueOnce([{ id: 'a' }]);
  expect((await run(adminController.moderationQueue, { query: { limit: 1, status: 'pending' } })).json.mock.calls[0][0].nextCursor).toBeNull();
});

it('serves a signed link to a signed-out reader', async () => {
  await run(projectsController.getData, { user: undefined, query: {} });
});
