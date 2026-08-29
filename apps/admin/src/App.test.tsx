import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const useSession = vi.fn();
const signOut = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    useSession,
    auth: { signOut, signInWithGoogle: vi.fn() },
    startTour: vi.fn(),
    startTourWhenReady: vi.fn(),
    adminApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  };
});

const { App } = await import('./App');

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => { useSession.mockReset(); signOut.mockReset(); });

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
