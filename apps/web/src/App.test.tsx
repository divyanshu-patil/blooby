import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const useSession = vi.fn();
const h = vi.hoisted(() => ({ api: {} as Record<string, (...a: unknown[]) => Promise<unknown>>, seenRelease: vi.fn(() => Promise.resolve()), saves: [] as ((v: string) => void)[] }));
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
    projectsApi: new Proxy({}, { get: (_, k: string) => (...a: unknown[]) => h.api[k]?.(...a) ?? new Promise(() => {}) }),
    authApi: { seenRelease: h.seenRelease },
    configureWhatsNew: (c: { save: (v: string) => void }) => { h.saves.push(c.save); (actual.configureWhatsNew as (c: unknown) => void)(c); },
    assetsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  };
});

const { App } = await import('./App');
const { startTour } = await import('@blooby/studio');

const at = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => { h.api = {}; h.saves.length = 0; useSession.mockReset(); signOut.mockReset(); sessionStorage.clear(); });

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

const ann = { id: 'u1', email: 'ann@example.com' };

it('navigates between sections and replays the tour', async () => {
  useSession.mockReturnValue({ user: { ...ann, name: 'Ann' }, ready: true });
  at('/projects');
  expect(screen.getByText('Ann')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /replay the tour/i }));
  expect(startTour).toHaveBeenCalled();
  await userEvent.click(screen.getByText('Library'));
  expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
});

it('names a person with neither a name nor an email', () => {
  useSession.mockReturnValue({ user: { id: 'u1' }, ready: true });
  at('/projects');
  expect(screen.getByText('Signed in')).toBeInTheDocument();
});

it('opens the editor route and goes back to projects from the not-found page', async () => {
  useSession.mockReturnValue({ user: ann, ready: true });
  const { unmount } = at('/projects/p1');
  expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
  unmount();
  at('/nowhere');
  await userEvent.click(screen.getByRole('button', { name: /back to projects/i }));
  expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
});

it('offers sign in from the not-found page when signed out', async () => {
  useSession.mockReturnValue({ user: null, ready: true });
  at('/nowhere');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
});

it('resumes a pending AI-app connection after sign-in', () => {
  sessionStorage.setItem('blooby.connect', 'req1');
  useSession.mockReturnValue({ user: ann, ready: true });
  at('/projects');
  expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
});

it('saves what the person has seen on their profile', () => {
  useSession.mockReturnValue({ user: ann, ready: true });
  at('/projects');
  h.saves[0]('2026.01.01');
  expect(h.seenRelease).toHaveBeenCalledWith('2026.01.01');
});

it('opens a project from the dashboard and leaves the editor on error', async () => {
  useSession.mockReturnValue({ user: ann, ready: true });
  h.api.list = () => Promise.resolve({ items: [{ id: 'p9', name: 'Nine', visibility: 'private', thumbnailUrl: null, updatedAt: '2026-08-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z' }], nextCursor: null });
  h.api.getData = () => Promise.reject(new Error('gone'));
  at('/projects');
  await userEvent.click(await screen.findByText('Nine'));
  await userEvent.click(await screen.findByRole('button', { name: /try again|back/i }));
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
});
