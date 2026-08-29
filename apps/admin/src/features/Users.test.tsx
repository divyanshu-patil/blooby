import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const users = vi.fn();
const user = vi.fn();
const setRole = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { users, user, setRole } };
});

const { Users } = await import('./Users');

const row = (over: Record<string, unknown> = {}) => ({
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  email: 'ann@example.com', username: null, role: 'user',
  createdAt: '2026-01-01T00:00:00Z', lastSignInAt: '2026-08-01T00:00:00Z',
  projectCount: 3, ...over,
});

beforeEach(() => {
  users.mockReset(); user.mockReset(); setRole.mockReset();
  users.mockResolvedValue({ items: [row()], nextCursor: null });
  user.mockResolvedValue({ ...row(), publishedAssets: 1, pendingAssets: 0, recentProjects: [] });
});

it('lists accounts once they load', async () => {
  render(<Users />);
  expect(await screen.findByText('ann@example.com')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

it('shows a skeleton first rather than an empty table', () => {
  users.mockReturnValue(new Promise(() => {}));
  const { container } = render(<Users />);
  expect(container.querySelector('.skeleton')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('offers a retry when the request fails, and retries on click', async () => {
  users.mockRejectedValueOnce(new Error('network down'));
  render(<Users />);
  expect(await screen.findByText(/network down/)).toBeInTheDocument();
  users.mockResolvedValue({ items: [row()], nextCursor: null });
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('ann@example.com')).toBeInTheDocument();
});

it('distinguishes "nobody yet" from "nothing matches your search"', async () => {
  users.mockResolvedValue({ items: [], nextCursor: null });
  render(<Users />);
  expect(await screen.findByText(/Nobody has signed up yet/)).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText(/search/i), 'zzz');
  expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
});

/** Cursor pagination, never "load every user into the browser". */
it('asks for a bounded page, and re-queries when the search changes', async () => {
  render(<Users />);
  await screen.findByText('ann@example.com');
  expect(users).toHaveBeenCalledWith({ q: undefined, limit: 50 });

  await userEvent.type(screen.getByPlaceholderText(/search/i), 'ann');
  await waitFor(() => expect(users).toHaveBeenLastCalledWith({ q: 'ann', limit: 50 }));
});

it('marks an admin as one, and an ordinary user as not', async () => {
  users.mockResolvedValue({ items: [row({ role: 'admin' }), row({ id: 'b', email: 'b@x.c' })], nextCursor: null });
  render(<Users />);
  const rows = await screen.findAllByRole('row');
  expect(within(rows[1]).getByText('Admin')).toBeInTheDocument();
  expect(within(rows[2]).getByText('User')).toBeInTheDocument();
});

it('opens a user’s detail from the row, by click or by keyboard', async () => {
  render(<Users />);
  await userEvent.click(await screen.findByText('ann@example.com'));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(user).toHaveBeenCalledWith(row().id);
});

it('grants and revokes admin access, then reloads the list', async () => {
  users.mockResolvedValue({ items: [row()], nextCursor: null });
  setRole.mockResolvedValue({});
  render(<Users />);
  await userEvent.click(await screen.findByText('ann@example.com'));

  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /admin/i }));
  await waitFor(() => expect(setRole).toHaveBeenCalledWith(row().id, 'admin'));
  // the dialog closes and the listing is refetched, so the new role is visible
  await waitFor(() => expect(users).toHaveBeenCalledTimes(2));
});

it('keeps the dialog open and explains itself when the change is refused', async () => {
  setRole.mockRejectedValue(new Error('You cannot remove your own administrator access'));
  render(<Users />);
  await userEvent.click(await screen.findByText('ann@example.com'));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /admin/i }));
  expect(await screen.findByText(/cannot remove your own/i)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('shows a dash rather than "Invalid Date" for an account that never signed in', async () => {
  users.mockResolvedValue({ items: [row({ lastSignInAt: null })], nextCursor: null });
  render(<Users />);
  expect(await screen.findByText('—')).toBeInTheDocument();
});
