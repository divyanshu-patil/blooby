import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
