import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const splashscreens = vi.fn();
const publishSplash = vi.fn();
const unpublishSplash = vi.fn();
const removeSplash = vi.fn();
const createSplash = vi.fn();
const updateSplash = vi.fn();
const browse = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    assetsApi: { browse },
    adminApi: { splashscreens, publishSplash, unpublishSplash, removeSplash, createSplash, updateSplash },
  };
});

const { Splashscreens } = await import('./Splashscreens');
const { useEditor } = await import('@blooby/studio');

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Launch', status: 'draft', background: '#17161b',
  durationMs: 2000, fadeMs: 300, updatedAt: '2026-08-01T00:00:00Z',
  data: { rig: null, timelines: [] }, ...over,
});

beforeEach(() => {
  for (const fn of [splashscreens, publishSplash, unpublishSplash, removeSplash, createSplash, updateSplash, browse]) fn.mockReset();
  browse.mockResolvedValue({ items: [], nextCursor: null });
  splashscreens.mockResolvedValue([row()]);
  for (const fn of [publishSplash, unpublishSplash, createSplash, updateSplash]) fn.mockResolvedValue({});
  removeSplash.mockResolvedValue(undefined);
});

it('lists what exists', async () => {
  render(<Splashscreens />);
  expect(await screen.findByText('Launch')).toBeInTheDocument();
});

it('invites you to make one when there are none', async () => {
  splashscreens.mockResolvedValue([]);
  render(<Splashscreens />);
  expect(await screen.findByText(/No splashscreens yet/i)).toBeInTheDocument();
});

/** Exactly one is live at a time — the live one has to be obvious at a glance. */
it('marks the live one, and only that one', async () => {
  splashscreens.mockResolvedValue([row({ id: 's1', status: 'published' }), row({ id: 's2', name: 'Old', status: 'archived' })]);
  render(<Splashscreens />);
  expect(await screen.findByText('Live')).toBeInTheDocument();
  expect(screen.getAllByText('Live')).toHaveLength(1);
  expect(screen.getByText('archived')).toBeInTheDocument();
});

it('offers unpublish for the live one and delete for the rest', async () => {
  splashscreens.mockResolvedValue([row({ status: 'published' })]);
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  expect(await screen.findByRole('button', { name: /unpublish/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
});

it('deletes a draft, then reloads', async () => {
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  const del = await screen.findByRole('button', { name: /delete/i });
  await userEvent.click(del);
  await waitFor(() => expect(removeSplash).toHaveBeenCalledWith('s1'));
  await waitFor(() => expect(splashscreens).toHaveBeenCalledTimes(2));
});

it('reports a refused change rather than closing as if it worked', async () => {
  splashscreens.mockResolvedValue([row({ status: 'published' })]);
  unpublishSplash.mockRejectedValue(new Error('Unpublish this splashscreen before deleting it'));
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  await userEvent.click(await screen.findByRole('button', { name: /unpublish/i }));
  expect(await screen.findByText(/Unpublish this splashscreen/)).toBeInTheDocument();
});

it('offers a retry when the list fails to load', async () => {
  splashscreens.mockRejectedValueOnce(new Error('offline'));
  render(<Splashscreens />);
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
  splashscreens.mockResolvedValue([row()]);
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('Launch')).toBeInTheDocument();
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const fire = async (label: string, value: string) => {
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(field(label), { target: { value } });
};

it('creates a draft from the header button, tuning every setting', async () => {
  render(<Splashscreens />);
  await screen.findByText('Launch');
  await userEvent.click(screen.getByRole('button', { name: 'New splashscreen' }));
  await userEvent.clear(field('Name'));
  await userEvent.type(field('Name'), 'Fresh');
  await fire('Background', '#ff0000');
  await fire('Play (ms)', '1500');
  await fire('Fade (ms)', '250');
  await userEvent.click(screen.getByRole('button', { name: 'Replay preview' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  await waitFor(() => expect(createSplash).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fresh', background: '#ff0000', durationMs: 1500, fadeMs: 250 })));
  await waitFor(() => expect(splashscreens).toHaveBeenCalledTimes(2));
});

it('starts a new one from the empty state', async () => {
  splashscreens.mockResolvedValue([]);
  render(<Splashscreens />);
  await screen.findByText(/No splashscreens yet/);
  await userEvent.click(screen.getAllByRole('button', { name: 'New splashscreen' })[1]);
  expect(await screen.findByText('Choose the animation', { exact: false })).toBeInTheDocument();
});

it('names an unnamed editor project "Splashscreen" and reports a refused save either way', async () => {
  useEditor.setState({ project: { ...useEditor.getState().project, name: undefined as never } });
  createSplash.mockRejectedValueOnce(new Error('Too long')).mockRejectedValueOnce('x');
  render(<Splashscreens />);
  await screen.findByText('Launch');
  await userEvent.click(screen.getByRole('button', { name: 'New splashscreen' }));
  expect(field('Name').value).toBe('Splashscreen');
  await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  expect(await screen.findByText('Too long')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  expect(await screen.findByText('Could not save it.')).toBeInTheDocument();
});

it('picks the animation from the library, a preset, the default mascot or the editor', async () => {
  browse.mockResolvedValue({ items: [{ id: 'a1', name: 'Bare', data: { id: 'bare', name: 'Bare' } }], nextCursor: null });
  render(<Splashscreens />);
  await screen.findByText('Launch');
  await userEvent.click(screen.getByRole('button', { name: 'New splashscreen' }));
  await userEvent.click(screen.getByRole('button', { name: 'From a preset' }));
  const bare = await screen.findByTitle('Bare · Published');
  await userEvent.click(bare);
  const search = screen.getByPlaceholderText('Search presets…');
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(search, { target: { value: 'zzzzzz' } });
  expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  fireEvent.change(search, { target: { value: '' } });
  await userEvent.click(screen.getAllByTitle(/Built-in/)[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Default mascot' }));
  await userEvent.click(screen.getByRole('button', { name: 'From the editor' }));
  expect(field('Play (ms)').value).not.toBe('');
}, 180_000);

it('shows a library that failed to load', async () => {
  browse.mockRejectedValue(new Error('library down'));
  render(<Splashscreens />);
  await screen.findByText('Launch');
  await userEvent.click(screen.getByRole('button', { name: 'New splashscreen' }));
  await userEvent.click(screen.getByRole('button', { name: 'From a preset' }));
  expect(await screen.findByText('library down')).toBeInTheDocument();
}, 180_000);

it('edits, saves and publishes an existing draft; a refusal that is not an Error still shows', async () => {
  updateSplash.mockRejectedValueOnce('x');
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  await userEvent.type(field('Name'), '!');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Could not save it.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(updateSplash).toHaveBeenLastCalledWith('s1', expect.objectContaining({ name: 'Launch!' })));
  await userEvent.click(await screen.findByText('Launch'));
  await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(publishSplash).toHaveBeenCalledWith('s1'));
});

it('opens a card from the keyboard, and names a refusal that is not an Error', async () => {
  removeSplash.mockRejectedValue('x');
  render(<Splashscreens />);
  const card = (await screen.findByText('Launch')).closest('.card') as HTMLElement;
  card.focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: /delete/i }));
  expect(await screen.findByText('That did not work.')).toBeInTheDocument();
  card.focus();
  await userEvent.keyboard('a');
});
