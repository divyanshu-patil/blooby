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

it('shows each person by their name with their avatar, email underneath', async () => {
  users.mockResolvedValue({ items: [row({ name: 'Ann Lee', avatarUrl: 'https://img/ann' })], nextCursor: null });
  const { container } = render(<Users />);
  expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
  expect(screen.getByText('ann@example.com')).toBeInTheDocument();
  expect(container.querySelector('img.avatar')?.getAttribute('src')).toBe('https://img/ann');
});

/** The API pages by cursor; Previous walks back through the cursors already seen. */
it('pages forward by cursor and back again', async () => {
  users.mockResolvedValueOnce({ items: [row()], nextCursor: 'c1' });
  render(<Users />);
  await screen.findByText('ann@example.com');
  users.mockResolvedValue({ items: [row({ id: 'b', email: 'b@x.c' })], nextCursor: null });
  await userEvent.click(screen.getByRole('button', { name: /next/i }));
  expect(await screen.findByText('b@x.c')).toBeInTheDocument();
  expect(users).toHaveBeenLastCalledWith({ q: undefined, limit: 50, cursor: 'c1' });
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /previous/i }));
  await waitFor(() => expect(users).toHaveBeenLastCalledWith({ q: undefined, limit: 50 }));
});

it('falls back through username, email and id for the name, and omits an email that is the name', async () => {
  users.mockResolvedValue({ items: [
    row({ id: 'a', name: null, username: 'annie', email: null }),
    row({ id: 'bbbbbbbbbbbb', name: null, username: null, email: null }),
    row({ id: 'c', name: 'solo@x.c', email: 'solo@x.c' }),
  ], nextCursor: null });
  render(<Users />);
  expect(await screen.findByText('annie')).toBeInTheDocument();
  expect(screen.getByText('bbbbbbbb')).toBeInTheDocument();
  expect(screen.getAllByText('solo@x.c')).toHaveLength(1);
});

it('opens detail with Enter only, titled by whatever name exists', async () => {
  users.mockResolvedValue({ items: [row({ email: null, username: null })], nextCursor: null });
  user.mockResolvedValue({ ...row({ email: null, username: null }), publishedAssets: 1, pendingAssets: 0, recentProjects: [{ id: 'p', name: 'Blob', updatedAt: '2026-08-01T00:00:00Z' }] });
  render(<Users />);
  const tr = (await screen.findAllByRole('row'))[1];
  tr.focus();
  await userEvent.keyboard('a');
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.keyboard('{Enter}');
  expect(await screen.findByText('Blob')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'User' })).toBeInTheDocument();
});

it('offers to revoke an admin, names a non-Error refusal, and shows a detail that fails to load', async () => {
  users.mockResolvedValue({ items: [row({ role: 'admin' })], nextCursor: null });
  user.mockRejectedValue(new Error('detail down'));
  setRole.mockRejectedValue('x');
  render(<Users />);
  await userEvent.click(await screen.findByText('ann@example.com'));
  expect(await screen.findByText('detail down')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Revoke admin' }));
  expect(await screen.findByText('Could not change the role.')).toBeInTheDocument();
  expect(setRole).toHaveBeenCalledWith(row().id, 'user');
});

it('closes the detail dialog without changing anything', async () => {
  render(<Users />);
  await userEvent.click(await screen.findByText('ann@example.com'));
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(setRole).not.toHaveBeenCalled();
});
