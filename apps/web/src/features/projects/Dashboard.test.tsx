import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const duplicate = vi.fn();
const remove = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, projectsApi: { list, create, update, duplicate, remove } };
});

const { Dashboard } = await import('./Dashboard');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'My mascot', visibility: 'private', thumbnailUrl: null,
  updatedAt: '2026-08-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z', ...over,
});

beforeEach(() => {
  for (const fn of [list, create, update, duplicate, remove]) fn.mockReset();
  list.mockResolvedValue({ items: [row()], nextCursor: null });
  create.mockResolvedValue(row({ id: 'new' }));
  for (const fn of [update, duplicate]) fn.mockResolvedValue(row());
  remove.mockResolvedValue(undefined);
});

const openMenu = async () => {
  const card = (await screen.findByText('My mascot')).closest('.card') ?? document.body;
  await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /⋯|more|menu/i }));
};

it('lists your projects, most recently edited first by default', async () => {
  render(<Dashboard onOpen={() => {}} />);
  expect(await screen.findByText('My mascot')).toBeInTheDocument();
  expect(list).toHaveBeenCalledWith({ q: undefined, sort: 'recent', limit: 48 });
});

it('invites a first project rather than showing an empty grid', async () => {
  list.mockResolvedValue({ items: [], nextCursor: null });
  render(<Dashboard onOpen={() => {}} />);
  expect(await screen.findByText(/No projects yet/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument();
});

it('distinguishes an empty search from an empty account', async () => {
  list.mockResolvedValue({ items: [], nextCursor: null });
  render(<Dashboard onOpen={() => {}} />);
  await screen.findByText(/No projects yet/i);
  await userEvent.type(screen.getByPlaceholderText(/search/i), 'zzz');
  expect(await screen.findByText(/No matches/i)).toBeInTheDocument();
});

it('re-queries when the sort changes', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await screen.findByText('My mascot');
  await userEvent.click(screen.getByRole('button', { name: 'Name' }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ q: undefined, sort: 'name', limit: 48 }));
});

it('opens a project when its card is used', async () => {
  const onOpen = vi.fn();
  render(<Dashboard onOpen={onOpen} />);
  await userEvent.click(await screen.findByText('My mascot'));
  expect(onOpen).toHaveBeenCalledWith('p1');
});

it('creates a project and goes straight into it', async () => {
  const onOpen = vi.fn();
  render(<Dashboard onOpen={onOpen} />);
  await screen.findByText('My mascot');
  await userEvent.click(screen.getByRole('button', { name: /new project/i }));
  await userEvent.click(await screen.findByRole('button', { name: /create project/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Untitled' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new'));
});

it('falls back to "Untitled" rather than creating a nameless project', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await screen.findByText('My mascot');
  await userEvent.click(screen.getByRole('button', { name: /new project/i }));
  await userEvent.clear(screen.getByLabelText(/project name/i));
  await userEvent.click(screen.getByRole('button', { name: /create project/i }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Untitled' }));
});

/** Deleting removes every saved version — it must be confirmed, not one click away. */
it('asks before deleting, and does nothing if you cancel', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await openMenu();
  await userEvent.click(screen.getByText('Delete'));
  expect(await screen.findByText(/can’t be undone/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(remove).not.toHaveBeenCalled();
});

it('deletes once confirmed, then refreshes the grid', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await openMenu();
  await userEvent.click(screen.getByText('Delete'));
  await userEvent.click(await screen.findByRole('button', { name: /delete project/i }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('p1'));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});

it('duplicates and flips visibility from the card menu', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await openMenu();
  await userEvent.click(screen.getByText('Duplicate'));
  await waitFor(() => expect(duplicate).toHaveBeenCalledWith('p1'));

  await openMenu();
  await userEvent.click(screen.getByText('Make public'));
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { visibility: 'public' }));
});

/**
 * These run after the menu or dialog has closed, so a rejection had nowhere to appear —
 * it rejected into the void and left a card that looked deleted until the next reload.
 */
it('says so when a delete is refused, instead of failing silently', async () => {
  remove.mockRejectedValue(new Error('That project does not exist'));
  render(<Dashboard onOpen={() => {}} />);
  await openMenu();
  await userEvent.click(screen.getByText('Delete'));
  await userEvent.click(await screen.findByRole('button', { name: /delete project/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/does not exist/);
});

it('renames a project', async () => {
  render(<Dashboard onOpen={() => {}} />);
  await openMenu();
  await userEvent.click(screen.getByText('Rename'));
  const field = await screen.findByLabelText(/project name/i);
  await userEvent.clear(field);
  await userEvent.type(field, 'Renamed');
  await userEvent.click(screen.getByRole('button', { name: /save name/i }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { name: 'Renamed' }));
});
