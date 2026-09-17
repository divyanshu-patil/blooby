import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../repositories/profiles.repository.js', () => ({ profilesRepository: { setLastSeenRelease: vi.fn(), findById: vi.fn() } }));
vi.mock('../services/users.service.js', () => ({ usersService: {} }));

const { profilesRepository } = await import('../repositories/profiles.repository.js');
const { authController, compareVersions } = await import('./auth.controller.js');
const repo = profilesRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;

const call = async (lastSeenRelease: string | null, version: string) => {
  const json = vi.fn();
  await authController.seenRelease({ user: { id: 'u1', email: null, role: 'user', lastSeenRelease }, body: { version } } as never, { json } as never);
  return json.mock.calls[0][0];
};

beforeEach(() => { repo.setLastSeenRelease.mockReset(); repo.setLastSeenRelease.mockImplementation((_id: string, v: string) => Promise.resolve({ lastSeenRelease: v })); });

it('records the newest release seen', async () => {
  expect(await call('2026.09.01', '2026.09.17')).toEqual({ lastSeenRelease: '2026.09.17' });
  expect(await call(null, '2026.09.17')).toEqual({ lastSeenRelease: '2026.09.17' });
});

/** An old tab closing the panel must not make newer releases show again. */
it('never moves backwards', async () => {
  expect(await call('2026.10.01', '2026.09.17')).toEqual({ lastSeenRelease: '2026.10.01' });
  expect(repo.setLastSeenRelease).not.toHaveBeenCalled();
});

it('orders versions part by part, a same-day second release after the first', () => {
  expect(compareVersions('2026.09.17.2', '2026.09.17')).toBeGreaterThan(0);
  expect(compareVersions('2026.10.01', '2026.09.30')).toBeGreaterThan(0);
});
