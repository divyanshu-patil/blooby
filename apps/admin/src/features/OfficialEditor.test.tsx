import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';

const createOfficial = vi.fn();
const createSplash = vi.fn();

// The editor itself is covered by the studio package's own suite; here it is a stand-in,
// so these tests are about the admin's publish flow rather than the animation engine.
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    Editor: ({ actions }: { actions?: React.ReactNode }) => <div data-testid="editor">{actions}</div>,
    adminApi: { createOfficial, createSplash },
    startTourWhenReady: vi.fn(),
  };
});

const { OfficialEditor } = await import('./OfficialEditor');
const { useEditor } = await import('@blooby/studio');

const mount = () => render(<OfficialEditor nav={[]} active="/editor" onNavigate={() => {}} />);

beforeEach(() => {
  createOfficial.mockReset(); createSplash.mockReset();
  createOfficial.mockResolvedValue({ id: 'a1' });
  createSplash.mockResolvedValue({ id: 's1' });
});

it('mounts the same editor users get, with admin actions alongside it', () => {
  mount();
  expect(screen.getByTestId('editor')).toBeInTheDocument();
});

it('publishes what is open as official content', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^publish$/i }));
  await waitFor(() => expect(createOfficial).toHaveBeenCalled());
  const body = createOfficial.mock.calls[0][0] as { kind: string; data: unknown };
  expect(body.kind).toBe('preset');
  expect(body.data, 'the animation itself must be sent, not just its name').toBeTruthy();
});

it('will not publish something with no name', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  const name = await screen.findByDisplayValue(/official preset|untitled/i);
  await userEvent.clear(name);
  expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled();
});

it('says why a publish failed instead of closing silently', async () => {
  createOfficial.mockRejectedValue(new Error('An official preset with that name exists'));
  mount();
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  await userEvent.click(await screen.findByRole('button', { name: /^publish$/i }));
  expect(await screen.findByText(/already exists|with that name exists/i)).toBeInTheDocument();
});

it('can save the open animation as a splashscreen instead', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: /splashscreen/i }));
  await screen.findByRole('dialog');
  await userEvent.click(screen.getByRole('button', { name: /^save/i }));
  await waitFor(() => expect(createSplash).toHaveBeenCalled());
});

it('slides the navigation over, in titled and untitled groups, and closes it on a choice or the scrim', async () => {
  const onNavigate = vi.fn();
  const nav = [
    { title: 'Manage', items: [{ id: '/a', label: 'Alpha', glyph: 'A', icon: 'grid4' as never }] },
    { items: [{ id: '/b', label: 'Beta', glyph: 'B' }] },
  ];
  render(<OfficialEditor nav={nav} active="/a" onNavigate={onNavigate} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(screen.getByText('Manage')).toBeInTheDocument();
  await userEvent.click(screen.getByText('Beta'));
  expect(onNavigate).toHaveBeenCalledWith('/b');
  expect(screen.queryByRole('navigation')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  await userEvent.click(document.querySelector('.slide-scrim') as HTMLElement);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('publishes with a type and description, tells you it worked, and can be cancelled', async () => {
  useEditor.setState({ project: { ...useEditor.getState().project, name: '' } });
  mount();
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  expect(await screen.findByDisplayValue('Official preset')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  await userEvent.selectOptions(await screen.findByLabelText('Type'), 'expression');
  fireEvent.change(document.getElementById('odesc') as HTMLElement, { target: { value: ' Nice ' } });
  await userEvent.click(screen.getByRole('button', { name: /^publish$/i }));
  await waitFor(() => expect(createOfficial).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expression', description: 'Nice' })));
  expect(await screen.findByRole('status')).toHaveTextContent(/Published/);
});

it('names a publish refusal that is not an Error', async () => {
  createOfficial.mockRejectedValue('x');
  mount();
  await userEvent.click(screen.getByRole('button', { name: /publish as official/i }));
  await userEvent.click(await screen.findByRole('button', { name: /^publish$/i }));
  expect(await screen.findByText('Could not publish.')).toBeInTheDocument();
});

it('saves a splashscreen draft with tuned settings, says so, and reports refusals', async () => {
  useEditor.setState({ project: { ...useEditor.getState().project, name: '' } });
  createSplash.mockRejectedValueOnce(new Error('Too long')).mockRejectedValueOnce('x');
  mount();
  await userEvent.click(screen.getByRole('button', { name: /set as splashscreen/i }));
  expect(await screen.findByDisplayValue('Splashscreen')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: /set as splashscreen/i }));
  fireEvent.change(document.getElementById('spname') as HTMLElement, { target: { value: 'Named' } });
  fireEvent.change(document.getElementById('spbg') as HTMLElement, { target: { value: '#ff0000' } });
  fireEvent.change(document.getElementById('spdur') as HTMLElement, { target: { value: '1000' } });
  fireEvent.change(document.getElementById('spfade') as HTMLElement, { target: { value: '100' } });
  await userEvent.click(screen.getByRole('button', { name: /^save as draft$/i }));
  expect(await screen.findByText('Too long')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^save as draft$/i }));
  expect(await screen.findByText('Could not save it.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^save as draft$/i }));
  expect(await screen.findByRole('status')).toHaveTextContent(/splashscreen draft/);
  expect(createSplash).toHaveBeenLastCalledWith(expect.objectContaining({ background: '#ff0000', durationMs: 1000, fadeMs: 100 }));
});
