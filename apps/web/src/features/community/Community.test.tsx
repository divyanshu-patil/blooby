import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';

const browse = vi.fn();
const mine = vi.fn();
const markUsed = vi.fn();
const projects = vi.fn();
const insights = vi.fn();
const dup = vi.fn();
const navigated = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, assetsApi: { browse, mine, markUsed }, projectsApi: { duplicate: (...a: unknown[]) => dup(...a), projectData: () => Promise.resolve(null) }, communityApi: { projects, insights } };
});

const { Community } = await import('./Community');
const { useEditor } = await import('@blooby/studio');
vi.mock('react-router', async () => ({ ...(await vi.importActual<Record<string, unknown>>('react-router')), useNavigate: () => navigated }));

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'a1', name: 'Wave', kind: 'preset', source: 'community', status: 'published',
  description: null, tags: [], downloads: 3, createdAt: '2026-08-01T00:00:00Z',
  data: { id: 'lib-wave', name: 'Wave', source: 'community', durationMs: 800, tracks: [] },
  ...over,
});

beforeEach(() => {
  for (const fn of [browse, mine, markUsed, projects, insights, dup, navigated]) fn.mockReset();
  dup.mockResolvedValue({ id: 'copy1' });
  projects.mockResolvedValue({ items: [], nextCursor: null });
  insights.mockResolvedValue({ topAssets: [], topCreators: [] });
  browse.mockResolvedValue({ items: [asset()], nextCursor: null });
  mine.mockResolvedValue({ items: [], nextCursor: null });
  markUsed.mockResolvedValue(undefined);
});

it('browses published work by default', async () => {
  render(<Community />, { wrapper: MemoryRouter });
  expect(await screen.findByText('Wave')).toBeInTheDocument();
  expect(browse).toHaveBeenCalled();
  expect(mine).not.toHaveBeenCalled();
});

it('switches to your own library, which is a different query', async () => {
  render(<Community />, { wrapper: MemoryRouter });
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'My library' }));
  await waitFor(() => expect(mine).toHaveBeenCalled());
});

it('filters by kind', async () => {
  render(<Community />, { wrapper: MemoryRouter });
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'Expressions' }));
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'expression' })));
});

it('searches as you type', async () => {
  render(<Community />, { wrapper: MemoryRouter });
  await screen.findByText('Wave');
  await userEvent.type(screen.getByPlaceholderText(/search/i), 'wave');
  await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'wave' })));
});

it('says the library is empty rather than showing a blank grid', async () => {
  browse.mockResolvedValue({ items: [], nextCursor: null });
  render(<Community />, { wrapper: MemoryRouter });
  expect(await screen.findByText(/nothing|no /i)).toBeInTheDocument();
});

/**
 * Adding pulls the asset into the open project's own preset list, so a community item
 * behaves identically to a built-in one the moment it lands.
 */
it('adds an asset into the open project, once', async () => {
  const before = useEditor.getState().project.presets.length;
  render(<Community />, { wrapper: MemoryRouter });
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
  render(<Community />, { wrapper: MemoryRouter });
  const card = (await screen.findByText('Wave')).closest('.card') ?? document.body;
  await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText(/add to project/i));
  await waitFor(() => expect(markUsed).toHaveBeenCalledWith('a1'));
  expect(useEditor.getState().project.presets.some((p) => p.id === 'lib-wave')).toBe(true);
});

it('offers a retry when the library will not load', async () => {
  browse.mockRejectedValueOnce(new Error('offline'));
  render(<Community />, { wrapper: MemoryRouter });
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
});

it('lists public projects in the community, trending first, with who made them', async () => {
  projects.mockResolvedValue({ items: [{ id: 'p9', name: 'Dancing blob', owner: 'ana', viewCount: 12, duplicateCount: 2, access: 'view', visibility: 'public', updatedAt: '2026-09-01T00:00:00Z' }], nextCursor: null });
  render(<Community />, { wrapper: MemoryRouter });
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'Projects' }));
  expect(await screen.findByText('Dancing blob')).toBeInTheDocument();
  expect(screen.getByText(/by ana · 12 views · 2 copies/)).toBeInTheDocument();
  expect(projects).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'trending' }));
});

it('shows the community insights in the open', async () => {
  insights.mockResolvedValue({
    topAssets: [{ id: 'a2', name: 'Big wave', kind: 'preset', source: 'community', downloadCount: 1, owner: 'Bo Diaz' }],
    topCreators: [{ name: 'Ana Real', avatarUrl: null, projects: 3, views: 1, copies: 2 }, { name: null, avatarUrl: null, projects: 1, views: 0, copies: 0 }],
  });
  render(<Community />, { wrapper: MemoryRouter });
  const board = await screen.findByRole('region', { name: 'Community leaderboard' });
  const creators = within(board).getAllByRole('listitem');
  expect(creators[0]).toHaveTextContent('Ana Real');
  expect(creators[0]).toHaveTextContent('3 projects');
  // singular where it is one, and a person with no name is not called "Someone"
  expect(creators[0]).toHaveTextContent('1 view · 2 copies');
  expect(creators[1]).toHaveTextContent('Unnamed creator');
  expect(within(board).getByText('1 use')).toBeInTheDocument();
  expect(within(board).getByText('Preset · Bo Diaz')).toBeInTheDocument();
});

const proj = (over: Record<string, unknown> = {}) => ({ id: 'p9', name: 'Dancing blob', visibility: 'public', updatedAt: '2026-09-01T00:00:00Z', ...over });
const toProjects = async () => {
  render(<Community />, { wrapper: MemoryRouter });
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'Popular' }));
  await userEvent.click(screen.getByRole('button', { name: 'Projects' }));
};

it('falls back to trending for a project list when a library-only sort was picked', async () => {
  projects.mockResolvedValue({ items: [proj({ access: 'edit' })], nextCursor: null });
  await toProjects();
  expect(await screen.findByText(/open to edit/)).toBeInTheDocument();
  expect(projects).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'trending' }));
});

it('says when there are no public projects', async () => {
  await toProjects();
  expect(await screen.findByText(/no public projects yet/i)).toBeInTheDocument();
});

it('opens and duplicates a public project', async () => {
  projects.mockResolvedValue({ items: [proj()], nextCursor: null });
  await toProjects();
  const card = (await screen.findByText('Dancing blob')).closest('.card') as HTMLElement;
  await userEvent.click(card);
  expect(navigated).toHaveBeenCalledWith('/projects/p9');
  await userEvent.click(within(card).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText('Open'));
  expect(navigated).toHaveBeenCalledTimes(2);
  await userEvent.click(within(card).getByRole('button', { name: /⋯|more|menu/i }));
  await userEvent.click(await screen.findByText('Duplicate to my projects'));
  await waitFor(() => expect(navigated).toHaveBeenLastCalledWith('/projects/copy1'));
});

it('opens an asset to preview it, and adds or closes from there', async () => {
  browse.mockResolvedValue({ items: [asset({ description: 'Hi', tags: ['fun'] })], nextCursor: null });
  render(<Community />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByText('Wave'));
  expect(await screen.findByText('fun')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByText('fun')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Wave'));
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByText('Wave'));
  await userEvent.click(await screen.findByRole('button', { name: 'Add to project' }));
  await waitFor(() => expect(markUsed).toHaveBeenCalledWith('a1'));
});

it('covers a leaderboard with a zero leader, an expression, an owner-less row and a fourth place', async () => {
  const a = (i: number, over = {}) => ({ id: `x${i}`, name: `A${i}`, kind: 'expression', source: 'community', downloadCount: 0, owner: null, ...over });
  insights.mockResolvedValue({ topAssets: [a(1), a(2), a(3), a(4)], topCreators: [] });
  render(<Community />, { wrapper: MemoryRouter });
  expect((await screen.findAllByText('Expression')).length).toBe(4);
});

it('previews an asset that has no description', async () => {
  render(<Community />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByText('Wave'));
  expect(await screen.findByRole('button', { name: 'Close' })).toBeInTheDocument();
});
