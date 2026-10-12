import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';

const getData = vi.fn();
const markOpened = vi.fn();
const update = vi.fn();
const duplicate = vi.fn();
const saveNow = vi.fn();
const setBaseVersion = vi.fn();
let autosave: Record<string, unknown>;
const adoptRemote = vi.fn();
let aiLive: { version: number; unsaved: boolean; agents: { client: string }[] } | null = null;

vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    Editor: ({ actions, cloudBar }: { actions?: React.ReactNode; cloudBar?: React.ReactNode }) => <div data-testid="editor">{actions}{cloudBar}</div>,
    projectsApi: { getData, markOpened, update, duplicate },
    useAutosave: () => autosave,
    useMcpLive: () => ({ project: aiLive, live: null, refresh: () => {} }),
  };
});

const { CloudEditor } = await import('./CloudEditor');
const { defaultProject: buildDefault, useEditor } = await import('@blooby/studio');

/** Building one costs ~90ms — every builtin preset — and nothing here mutates it. Built
 *  once for the file, the same way cloud/Thumb.tsx does it for a grid of cards. */
let blank: ReturnType<typeof buildDefault> | null = null;
const defaultProject = () => (blank ??= buildDefault());

beforeEach(() => {
  for (const fn of [getData, markOpened, saveNow, setBaseVersion, update, duplicate]) fn.mockReset();
  duplicate.mockResolvedValue({ id: 'copy' });
  getData.mockResolvedValue({ project: { currentVersion: 3, name: 'My mascot' }, data: defaultProject() });
  markOpened.mockResolvedValue(undefined);
  adoptRemote.mockReset();
  aiLive = null;
  autosave = { state: 'idle', savedAt: Date.now(), conflict: null, saveNow, setBaseVersion, adoptRemote, version: () => 3 };
});

/** An AI app saved a newer version through MCP and nothing is unsaved here: take it in place. */
it('picks up an AI app\'s newer save, and says an AI is editing', async () => {
  aiLive = { version: 5, unsaved: false, agents: [{ client: 'Claude' }] };
  getData.mockResolvedValueOnce({ project: { currentVersion: 3, name: 'My mascot' }, data: defaultProject() })
    .mockResolvedValue({ project: { currentVersion: 5, name: 'My mascot' }, data: defaultProject() });
  render(<MemoryRouter><CloudEditor projectId="p1" onExit={() => {}} /></MemoryRouter>);
  expect(await screen.findByText('Claude editing…')).toBeInTheDocument();
  await waitFor(() => expect(adoptRemote).toHaveBeenCalledWith(5));
});

it('never takes an AI version over unsaved edits here', async () => {
  aiLive = { version: 5, unsaved: false, agents: [] };
  autosave = { ...autosave, state: 'dirty' };
  render(<MemoryRouter><CloudEditor projectId="p1" onExit={() => {}} /></MemoryRouter>);
  await screen.findByTestId('editor');
  await new Promise((r) => setTimeout(r, 30));
  expect(adoptRemote).not.toHaveBeenCalled();
});

it('says what it is opening rather than showing a blank screen', () => {
  getData.mockReturnValue(new Promise(() => {}));
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  expect(screen.getByText(/opening/i)).toBeInTheDocument();
});

it('loads the project and hands the editor its version', async () => {
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  expect(await screen.findByTestId('editor')).toBeInTheDocument();
  expect(setBaseVersion).toHaveBeenCalledWith(3, 'My mascot');
});

/** "Recently opened" only means something if opening records itself. */
it('records that the project was opened', async () => {
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  await screen.findByTestId('editor');
  expect(markOpened).toHaveBeenCalledWith('p1');
});

it('still opens when recording the visit fails', async () => {
  markOpened.mockRejectedValue(new Error('offline'));
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  expect(await screen.findByTestId('editor')).toBeInTheDocument();
});

it('offers a way out when the project will not open', async () => {
  getData.mockRejectedValue(new Error('That project does not exist'));
  const onExit = vi.fn();
  render(<CloudEditor projectId="p1" onExit={onExit} />, { wrapper: MemoryRouter });
  expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /try again|back/i }));
  expect(onExit).toHaveBeenCalled();
});

/**
 * Two tabs editing one project is the case autosave has to get right: the second save is
 * refused, and the person must be told rather than silently losing the newer work.
 */
it('surfaces a save conflict instead of overwriting', async () => {
  autosave = { state: 'error', savedAt: null, conflict: { serverVersion: 5 }, saveNow, setBaseVersion, adoptRemote, version: () => 3 };
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  await screen.findByTestId('editor');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

it('does not re-fetch when nothing about the project changed', async () => {
  const { rerender } = render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  await screen.findByTestId('editor');
  rerender(<CloudEditor projectId="p1" onExit={() => {}} />);
  expect(getData).toHaveBeenCalledTimes(1);
});

it('loads the other project when the id changes', async () => {
  const { rerender } = render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  await screen.findByTestId('editor');
  rerender(<CloudEditor projectId="p2" onExit={() => {}} />);
  await waitFor(() => expect(getData).toHaveBeenCalledWith('p2'));
});

it('opens someone else’s view-only project without saving, and offers a copy', async () => {
  getData.mockResolvedValue({ project: { currentVersion: 1, name: 'Theirs', visibility: 'public', access: 'view' }, data: defaultProject(), canEdit: false, isOwner: false });
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  expect(await screen.findByText('View only')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save now/i })).toBeNull();
  expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
  // not the owner's: no sharing controls
  expect(screen.queryByLabelText('Who can see it')).toBeNull();
});

it('gives the owner visibility, and access once public', async () => {
  getData.mockResolvedValue({ project: { currentVersion: 1, name: 'Mine', visibility: 'public', access: 'edit' }, data: defaultProject(), canEdit: true, isOwner: true });
  render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });
  expect(await screen.findByLabelText('Who can see it')).toHaveValue('public');
  expect(screen.getByLabelText('What others can do')).toHaveValue('edit');
});

const owned = (over: Record<string, unknown> = {}) =>
  getData.mockResolvedValue({ project: { currentVersion: 1, name: 'Mine', visibility: 'public', access: 'view', ...over }, data: defaultProject(), canEdit: true, isOwner: true });
const mount = () => render(<CloudEditor projectId="p1" onExit={() => {}} />, { wrapper: MemoryRouter });

it('changes who can see and edit it, and shrugs off a refused change', async () => {
  owned();
  update.mockImplementation((_id: string, body: object) => Promise.resolve({ currentVersion: 1, name: 'Mine', visibility: 'public', access: 'view', ...body }));
  mount();
  await userEvent.selectOptions(await screen.findByLabelText('What others can do'), 'edit');
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { access: 'edit' }));
  await userEvent.selectOptions(screen.getByLabelText('Who can see it'), 'private');
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { visibility: 'private' }));
  update.mockRejectedValue(new Error('no'));
  await userEvent.selectOptions(await screen.findByLabelText('Who can see it'), 'public');
  await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
});

it('defaults a public project with no access setting to view', async () => {
  owned({ access: undefined });
  mount();
  expect(await screen.findByLabelText('What others can do')).toHaveValue('view');
});

it('duplicates from the share menu and from the view-only button', async () => {
  owned();
  const { unmount } = mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Duplicate into my projects' }));
  await waitFor(() => expect(duplicate).toHaveBeenCalledWith('p1'));
  unmount();
  getData.mockResolvedValue({ project: { currentVersion: 1, name: 'T' }, data: defaultProject(), canEdit: false, isOwner: false });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
  await waitFor(() => expect(duplicate).toHaveBeenCalledTimes(2));
});

it('retries a failed save, saves on demand, and opens the AI rail from the live badge', async () => {
  aiLive = { version: 3, unsaved: false, agents: [{ client: 'Claude' }] };
  autosave = { ...autosave, state: 'error' };
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await userEvent.click(screen.getByRole('button', { name: /save now/i }));
  expect(saveNow).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByText('Claude editing…'));
  expect(useEditor.getState().railTab).toBe('mcp');
});

it('closes the share menu on a click elsewhere', async () => {
  owned();
  mount();
  const summary = await screen.findByText('Shared');
  const details = summary.closest('details') as HTMLDetailsElement;
  await userEvent.click(summary);
  expect(details.open).toBe(true);
  await userEvent.click(screen.getByTestId('editor'));
  expect(details.open).toBe(false);
});

it('leaves, or reloads, from the conflict dialog', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  autosave = { ...autosave, state: 'error', conflict: { serverVersion: 5 } };
  const onExit = vi.fn();
  render(<CloudEditor projectId="p1" onExit={onExit} />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Reload project' }));
  expect(reload).toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  expect(onExit).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('ignores a load that finishes after leaving, and names a non-Error failure', async () => {
  let resolve!: (v: unknown) => void;
  getData.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  mount().unmount();
  resolve({ project: { currentVersion: 1, name: 'x' }, data: defaultProject() });
  let reject!: (v: unknown) => void;
  getData.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
  mount().unmount();
  reject('x');
  getData.mockRejectedValueOnce('odd');
  mount();
  expect(await screen.findByText('Could not open this project.')).toBeInTheDocument();
});

it('drops an AI refresh that was superseded or is not newer', async () => {
  aiLive = { version: 5, unsaved: false, agents: [] };
  getData.mockResolvedValueOnce({ project: { currentVersion: 3, name: 'M' }, data: defaultProject() });
  let resolve!: (v: unknown) => void;
  getData.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const { unmount } = mount();
  await screen.findByTestId('editor');
  unmount();
  resolve({ project: { currentVersion: 9, name: 'M' }, data: defaultProject() });
  getData.mockResolvedValueOnce({ project: { currentVersion: 3, name: 'M' }, data: defaultProject() })
    .mockResolvedValue({ project: { currentVersion: 3, name: 'M' }, data: defaultProject() });
  mount();
  await screen.findByTestId('editor');
  await new Promise((r) => setTimeout(r, 30));
  expect(adoptRemote).not.toHaveBeenCalled();
});

it('survives an AI refresh that fails, and one whose own version has gone', async () => {
  aiLive = { version: 5, unsaved: false, agents: [] };
  getData.mockResolvedValueOnce({ project: { currentVersion: 3, name: 'M' }, data: defaultProject() }).mockRejectedValueOnce(new Error('x'));
  const first = mount();
  await screen.findByTestId('editor');
  await waitFor(() => expect(getData).toHaveBeenCalledTimes(2));
  first.unmount();
  getData.mockReset();
  let ver: number | null = 3;
  autosave = { ...autosave, version: () => ver };
  let resolve!: (v: unknown) => void;
  getData.mockResolvedValueOnce({ project: { currentVersion: 3, name: 'M' }, data: defaultProject() })
    .mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  mount();
  await waitFor(() => expect(getData).toHaveBeenCalledTimes(2));
  ver = null;
  resolve({ project: { currentVersion: 9, name: 'M' }, data: defaultProject() });
  await waitFor(() => expect(adoptRemote).toHaveBeenCalledWith(9));
});
