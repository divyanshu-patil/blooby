import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const browse = vi.fn();
const mine = vi.fn();
const markUsed = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, assetsApi: { browse, mine, markUsed } };
});

const { Community } = await import('./Community');
const { useEditor } = await import('@blooby/studio');

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'a1', name: 'Wave', kind: 'preset', source: 'community', status: 'published',
  description: null, tags: [], downloads: 3, createdAt: '2026-08-01T00:00:00Z',
  data: { id: 'lib-wave', name: 'Wave', source: 'community', durationMs: 800, tracks: [] },
  ...over,
});

beforeEach(() => {
  for (const fn of [browse, mine, markUsed]) fn.mockReset();
  browse.mockResolvedValue({ items: [asset()], nextCursor: null });
  mine.mockResolvedValue({ items: [], nextCursor: null });
  markUsed.mockResolvedValue(undefined);
});

it('browses published work by default', async () => {
  render(<Community />);
  expect(await screen.findByText('Wave')).toBeInTheDocument();
  expect(browse).toHaveBeenCalled();
  expect(mine).not.toHaveBeenCalled();
});

it('switches to your own library, which is a different query', async () => {
  render(<Community />);
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'My library' }));
  await waitFor(() => expect(mine).toHaveBeenCalled());
});

it('filters by kind', async () => {
  render(<Community />);
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'Expressions' }));
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'expression' })));
});

it('searches as you type', async () => {
  render(<Community />);
  await screen.findByText('Wave');
  await userEvent.type(screen.getByPlaceholderText(/search/i), 'wave');
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'wave' })));
});

it('says the library is empty rather than showing a blank grid', async () => {
  browse.mockResolvedValue({ items: [], nextCursor: null });
  render(<Community />);
  expect(await screen.findByText(/nothing|no /i)).toBeInTheDocument();
});

/**
 * Adding pulls the asset into the open project's own preset list, so a community item
 * behaves identically to a built-in one the moment it lands.
 */
it('adds an asset into the open project, once', async () => {
  const before = useEditor.getState().project.presets.length;
  render(<Community />);
  const card = (await screen.findByText('Wave')).closest('.card') ?? document.body;
  await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText(/add to project/i));

  await waitFor(() => expect(useEditor.getState().project.presets.length).toBe(before + 1));
  expect(useEditor.getState().project.presets.some((p) => p.id === 'lib-wave')).toBe(true);

  // adding the same one again must not duplicate it
  await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText(/add to project/i));
  await waitFor(() => expect(useEditor.getState().project.presets.filter((p) => p.id === 'lib-wave')).toHaveLength(1));
});

/** The count that answers "which presets do people really use". */
it('records the add, and does not let that failing block the add itself', async () => {
  markUsed.mockRejectedValue(new Error('offline'));
  render(<Community />);
  const card = (await screen.findByText('Wave')).closest('.card') ?? document.body;
  await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText(/add to project/i));
  await waitFor(() => expect(markUsed).toHaveBeenCalledWith('a1'));
  expect(useEditor.getState().project.presets.some((p) => p.id === 'lib-wave')).toBe(true);
});

it('offers a retry when the library will not load', async () => {
  browse.mockRejectedValueOnce(new Error('offline'));
  render(<Community />);
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
});
