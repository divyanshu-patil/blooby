import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const copilot = vi.fn();
const setCopilotSettings = vi.fn();
const addCopilotKey = vi.fn();
const removeCopilotKey = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { copilot, setCopilotSettings, addCopilotKey, removeCopilotKey } };
});

const { Copilot } = await import('./Copilot');

const key = (over: Record<string, unknown> = {}) => ({
  id: 'k1', hint: 'abcd…5678', label: 'primary', status: 'ok', note: null,
  lastUsedAt: '2026-08-01T00:00:00Z', ...over,
});

beforeEach(() => {
  for (const fn of [copilot, setCopilotSettings, addCopilotKey, removeCopilotKey]) fn.mockReset();
  copilot.mockResolvedValue({ allowUserKeys: true, keys: [key()] });
  setCopilotSettings.mockResolvedValue({});
  addCopilotKey.mockResolvedValue({});
  removeCopilotKey.mockResolvedValue(undefined);
});

/**
 * A key is write-only from this screen: it is posted once and comes back as a hint. No
 * amount of poking here can recover one — including for the admin who pasted it.
 */
it('shows only a hint, never a usable key', async () => {
  copilot.mockResolvedValue({ allowUserKeys: true, keys: [key({ hint: 'abcd…5678' })] });
  const { container } = render(<Copilot />);
  expect(await screen.findByText('abcd…5678')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/abcd1234efgh5678/);
});

it('masks the key field as it is typed', async () => {
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  expect(screen.getByPlaceholderText(/paste an ollama/i)).toHaveAttribute('type', 'password');
});

it('refuses to submit an obviously-truncated key', async () => {
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  const add = screen.getByRole('button', { name: /add key/i });
  expect(add).toBeDisabled();

  await userEvent.type(screen.getByPlaceholderText(/paste an ollama/i), 'short');
  expect(add).toBeDisabled();

  await userEvent.type(screen.getByPlaceholderText(/paste an ollama/i), 'enough-to-be-real');
  expect(add).toBeEnabled();
});

it('adds a key, clears the field, and reloads the pool', async () => {
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  const field = screen.getByPlaceholderText(/paste an ollama/i);
  await userEvent.type(field, 'sk-a-real-looking-key');
  await userEvent.type(screen.getByPlaceholderText(/label/i), 'spare');
  await userEvent.click(screen.getByRole('button', { name: /add key/i }));

  await waitFor(() => expect(addCopilotKey).toHaveBeenCalledWith('sk-a-real-looking-key', 'spare'));
  await waitFor(() => expect(field).toHaveValue(''));
  await waitFor(() => expect(copilot).toHaveBeenCalledTimes(2));
});

it('adds on Enter, so the obvious gesture works', async () => {
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  await userEvent.type(screen.getByPlaceholderText(/paste an ollama/i), 'sk-a-real-looking-key{Enter}');
  await waitFor(() => expect(addCopilotKey).toHaveBeenCalled());
});

it('removes a key and reloads', async () => {
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  await userEvent.click(screen.getByRole('button', { name: /remove/i }));
  await waitFor(() => expect(removeCopilotKey).toHaveBeenCalledWith('k1'));
  await waitFor(() => expect(copilot).toHaveBeenCalledTimes(2));
});

it('toggles whether users may bring their own keys', async () => {
  render(<Copilot />);
  const toggle = await screen.findByRole('button', { name: 'On' });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(toggle);
  await waitFor(() => expect(setCopilotSettings).toHaveBeenCalledWith(false));
});

/** The one configuration where the copilot cannot work for anybody. */
it('warns when user keys are off and the server has none', async () => {
  copilot.mockResolvedValue({ allowUserKeys: false, keys: [] });
  render(<Copilot />);
  expect(await screen.findByText(/cannot reach Ollama Cloud for anyone/i)).toBeInTheDocument();
});

it('does not warn when user keys are off but the pool has one', async () => {
  copilot.mockResolvedValue({ allowUserKeys: false, keys: [key()] });
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  expect(screen.queryByText(/cannot reach Ollama Cloud/i)).not.toBeInTheDocument();
});

it('shows a key’s health, and says "never" rather than a bogus date', async () => {
  copilot.mockResolvedValue({
    allowUserKeys: true,
    keys: [key({ status: 'rate-limited', note: '429', lastUsedAt: null })],
  });
  render(<Copilot />);
  expect(await screen.findByText(/rate-limited · 429/)).toBeInTheDocument();
  expect(screen.getByText('never')).toBeInTheDocument();
});

it('reports a failed change instead of pretending it worked', async () => {
  addCopilotKey.mockRejectedValue(new Error('Ollama rejected that key'));
  render(<Copilot />);
  await screen.findByText('abcd…5678');
  await userEvent.type(screen.getByPlaceholderText(/paste an ollama/i), 'sk-a-real-looking-key');
  await userEvent.click(screen.getByRole('button', { name: /add key/i }));
  expect(await screen.findByText(/Ollama rejected that key/)).toBeInTheDocument();
});
