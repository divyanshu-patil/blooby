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
    // the splash covers the app until it finishes; in a test it should get out of the way
    Splashscreen: ({ onDone }: { onDone: () => void }) => { queueMicrotask(onDone); return null; },
    startTour: vi.fn(),
    startTourWhenReady: vi.fn(),
    projectsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
    assetsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  };
});

const { App } = await import('./App');

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => { useSession.mockReset(); signOut.mockReset(); });

it('waits for the session rather than flashing the sign-in form', () => {
  useSession.mockReturnValue({ user: null, ready: false });
  at('/projects');
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it('sends a signed-out visitor to sign in', () => {
  useSession.mockReturnValue({ user: null, ready: true });
  at('/projects');
  expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
});

/** A deep link should survive signing in, not dump you on the default screen. */
it('remembers where a signed-out visitor was headed', () => {
  useSession.mockReturnValue({ user: null, ready: true });
  at('/projects/abc123');
  expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
});

it('lets a signed-in person in, with their identity and a way out', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'ann@example.com' }, ready: true });
  at('/projects');
  expect(screen.getByText('ann@example.com')).toBeInTheDocument();
});

it('signs out', async () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'ann@example.com' }, ready: true });
  at('/projects');
  await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
  expect(signOut).toHaveBeenCalled();
});

it('redirects the bare root to projects', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true });
  at('/');
  expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
});

it('sends an already-signed-in person away from the login page', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true });
  at('/login');
  expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument();
});

it('offers a way back from a URL that does not exist', () => {
  useSession.mockReturnValue({ user: { id: 'u1', email: 'a@b.c' }, ready: true });
  at('/nowhere');
  expect(screen.getByText(/doesn’t exist|not found/i)).toBeInTheDocument();
});
