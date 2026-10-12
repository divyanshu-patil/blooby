import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const useSession = vi.fn();
const signOut = vi.fn();
const h = vi.hoisted(() => ({ signInWithGoogle: vi.fn(), authError: null as string | null, admin: {} as Record<string, () => Promise<unknown>> }));
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    useSession,
    auth: { signOut, signInWithGoogle: h.signInWithGoogle },
    consumeAuthError: () => h.authError,
    startTour: vi.fn(),
    startTourWhenReady: vi.fn(),
    adminApi: new Proxy({}, { get: (_, k: string) => () => h.admin[k]?.() ?? new Promise(() => {}) }),
  };
});

const { App } = await import('./App');
const { startTour } = await import('@blooby/studio');

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => { useSession.mockReset(); signOut.mockReset(); h.signInWithGoogle.mockReset(); h.authError = null; h.admin = {}; });

it('waits rather than flashing the sign-in screen before the session resolves', () => {
  useSession.mockReturnValue({ user: null, ready: false, isAdmin: false });
  at('/dashboard');
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
  expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
});

it('sends a signed-out visitor to sign in', () => {
  useSession.mockReturnValue({ user: null, ready: true, isAdmin: false });
  at('/dashboard');
  expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
});

/**
 * Presentation only — every /api/admin/* call is checked against profiles.role on the
 * server — but a signed-in non-admin should be told plainly, not shown a blank panel.
 */
it('tells a signed-in non-admin they do not have access, and offers a way out', async () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true, isAdmin: false });
  at('/dashboard');
  expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
  expect(signOut).toHaveBeenCalled();
});

it('does not render any admin screen for a non-admin', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true, isAdmin: false });
  at('/users');
  expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument();
});

it('lets an admin in, with the navigation and their identity', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'admin@blooby.dev' }, ready: true, isAdmin: true });
  at('/users');
  expect(screen.getByText('admin@blooby.dev')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
});

it('offers a way back from a URL that does not exist', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true, isAdmin: true });
  at('/nowhere');
  expect(screen.getByText(/doesn’t exist/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
});

it('redirects the bare root to the dashboard rather than showing nothing', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true, isAdmin: true });
  at('/');
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
});

it('sends an already-signed-in admin away from the login page', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true, isAdmin: true });
  at('/login');
  expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
});

const admin = { id: 'u1', email: 'admin@blooby.dev', isAdmin: true };

it('navigates, replays the tour, signs out, and names an admin with no name or email', async () => {
  useSession.mockReturnValue({ user: { id: 'u1' }, ready: true, isAdmin: true });
  at('/dashboard');
  expect(screen.getByText('Admin')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /replay the tour/i }));
  expect(startTour).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
  expect(signOut).toHaveBeenCalled();
  await userEvent.click(screen.getByText('Users'));
  expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
});

it('opens the editor route, and goes back to the dashboard from not-found', async () => {
  useSession.mockReturnValue({ user: admin, ready: true, isAdmin: true });
  const { unmount } = at('/editor');
  expect(screen.getByRole('button', { name: /publish as official/i })).toBeInTheDocument();
  unmount();
  at('/nowhere');
  await userEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
});

it('signs in with Google, and says why it could not', async () => {
  useSession.mockReturnValue({ user: null, ready: true, isAdmin: false });
  h.authError = 'Turned away';
  h.signInWithGoogle.mockResolvedValueOnce({ error: { message: 'Refused' } }).mockRejectedValueOnce('x').mockResolvedValueOnce({ error: null });
  at('/dashboard');
  expect(screen.getByText('Turned away')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  expect(await screen.findByText('Refused')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  expect(await screen.findByText(/could not reach google/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  expect(await screen.findByText(/taking you to google/i)).toBeInTheDocument();
});

it('follows the dashboard callout and the editor navigation', async () => {
  useSession.mockReturnValue({ user: admin, ready: true, isAdmin: true });
  h.admin.analytics = () => Promise.resolve({
    overview: { totalUsers: 1, newUsers: 1, activeUsers: 1, totalProjects: 1, projectsToday: 1, communityPresets: 1, communityExpressions: 1, officialPublished: 1, pendingReview: 2 },
    growth: { deltas: { users: 0, projects: 0 }, users: [], projects: [] }, insights: { topAssets: [], topCreators: [] },
  });
  const { unmount } = at('/dashboard');
  await userEvent.click(await screen.findByRole('button', { name: /waiting for review/i }));
  expect(await screen.findByRole('heading', { name: 'Community' })).toBeInTheDocument();
  unmount();
  at('/editor');
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  await userEvent.click(screen.getByText('Users'));
  expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
});
