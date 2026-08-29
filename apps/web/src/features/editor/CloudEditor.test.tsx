import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getData = vi.fn();
const markOpened = vi.fn();
const saveNow = vi.fn();
const setBaseVersion = vi.fn();
let autosave: Record<string, unknown>;

vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    Editor: ({ actions }: { actions?: React.ReactNode }) => <div data-testid="editor">{actions}</div>,
    projectsApi: { getData, markOpened },
    useAutosave: () => autosave,
  };
});

const { CloudEditor } = await import('./CloudEditor');
const { defaultProject } = await import('@blooby/studio');

beforeEach(() => {
  for (const fn of [getData, markOpened, saveNow, setBaseVersion]) fn.mockReset();
  getData.mockResolvedValue({ project: { currentVersion: 3, name: 'My mascot' }, data: defaultProject() });
  markOpened.mockResolvedValue(undefined);
  autosave = { state: 'idle', savedAt: Date.now(), conflict: null, saveNow, setBaseVersion };
});

it('says what it is opening rather than showing a blank screen', () => {
  getData.mockReturnValue(new Promise(() => {}));
  render(<CloudEditor projectId="p1" onExit={() => {}} />);
  expect(screen.getByText(/opening/i)).toBeInTheDocument();
});

it('loads the project and hands the editor its version', async () => {
  render(<CloudEditor projectId="p1" onExit={() => {}} />);
  expect(await screen.findByTestId('editor')).toBeInTheDocument();
  expect(setBaseVersion).toHaveBeenCalledWith(3, 'My mascot');
});

/** "Recently opened" only means something if opening records itself. */
it('records that the project was opened', async () => {
  render(<CloudEditor projectId="p1" onExit={() => {}} />);
  await screen.findByTestId('editor');
  expect(markOpened).toHaveBeenCalledWith('p1');
});

it('still opens when recording the visit fails', async () => {
  markOpened.mockRejectedValue(new Error('offline'));
  render(<CloudEditor projectId="p1" onExit={() => {}} />);
  expect(await screen.findByTestId('editor')).toBeInTheDocument();
});

it('offers a way out when the project will not open', async () => {
  getData.mockRejectedValue(new Error('That project does not exist'));
  const onExit = vi.fn();
  render(<CloudEditor projectId="p1" onExit={onExit} />);
  expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /try again|back/i }));
  expect(onExit).toHaveBeenCalled();
});

/**
 * Two tabs editing one project is the case autosave has to get right: the second save is
 * refused, and the person must be told rather than silently losing the newer work.
 */
it('surfaces a save conflict instead of overwriting', async () => {
  autosave = { state: 'error', savedAt: null, conflict: { serverVersion: 5 }, saveNow, setBaseVersion };
  render(<CloudEditor projectId="p1" onExit={() => {}} />);
  await screen.findByTestId('editor');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

it('does not re-fetch when nothing about the project changed', async () => {
  const { rerender } = render(<CloudEditor projectId="p1" onExit={() => {}} />);
  await screen.findByTestId('editor');
  rerender(<CloudEditor projectId="p1" onExit={() => {}} />);
  expect(getData).toHaveBeenCalledTimes(1);
});

it('loads the other project when the id changes', async () => {
  const { rerender } = render(<CloudEditor projectId="p1" onExit={() => {}} />);
  await screen.findByTestId('editor');
  rerender(<CloudEditor projectId="p2" onExit={() => {}} />);
  await waitFor(() => expect(getData).toHaveBeenCalledWith('p2'));
});
