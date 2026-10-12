import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mcpUsage = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { mcpUsage } };
});

const { Mcp } = await import('./Mcp');

const usage = (over: Record<string, unknown> = {}, totals: Record<string, unknown> = {}) => ({
  totals: { connectedPeople: 2, people: 1, calls: 10, projects: 3, oauthGrants: 1, personalTokens: 1, errorRate: 5, p50Ms: 20, p95Ms: 90, ...totals },
  deltas: { people: 0.1, calls: 0.2 },
  series: [{ date: '2026-09-01', calls: 3, failed: 1 }],
  clients: [
    { name: 'Claude', people: 1, calls: 5, failed: 0, installs: 1, lastUsedAt: '2026-09-01T00:00:00Z' },
    { name: 'Cursor', people: 2, calls: 5, failed: 1, installs: 2, lastUsedAt: '2026-09-01T00:00:00Z' },
  ],
  capabilities: [{ capability: 'add_layer', calls: 4, failed: 0, people: 1, avgMs: 10 }, { capability: 'render', calls: 6, failed: 2, people: 2, avgMs: 30 }],
  errors: [{ code: 'NOT_FOUND', calls: 2 }],
  recent: [
    { at: '2026-09-01T00:00:00Z', capability: 'add_layer', ok: true, error: null, client: 'Claude', durationMs: 12 },
    { at: '2026-09-01T00:00:01Z', capability: 'render', ok: false, error: 'BOOM', client: 'Cursor', durationMs: null },
    { at: '2026-09-01T00:00:02Z', capability: 'render', ok: false, error: null, client: 'Cursor', durationMs: 5 },
  ],
  ...over,
});

beforeEach(() => { mcpUsage.mockReset(); mcpUsage.mockResolvedValue(usage()); });

it('shows usage, and refetches when the range changes', async () => {
  render(<Mcp />);
  expect(await screen.findByText('Which apps')).toBeInTheDocument();
  expect(mcpUsage).toHaveBeenCalledWith(30);
  expect(screen.getByText('BOOM')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '7 days' }));
  await waitFor(() => expect(mcpUsage).toHaveBeenLastCalledWith(7));
});

it('flags connected people who made no calls, singular and plural', async () => {
  mcpUsage.mockResolvedValue(usage({}, { connectedPeople: 1, people: 0 }));
  const { unmount } = render(<Mcp />);
  expect(await screen.findByText(/1 person has/)).toBeInTheDocument();
  unmount();
  mcpUsage.mockResolvedValue(usage({}, { connectedPeople: 3, people: 0 }));
  render(<Mcp />);
  expect(await screen.findByText(/3 people have/)).toBeInTheDocument();
});

it('uses singular forms and empty states', async () => {
  mcpUsage.mockResolvedValue(usage({
    clients: [{ name: 'Solo', people: 1, calls: 1, failed: 0, installs: 1, lastUsedAt: '2026-09-01T00:00:00Z' }],
    capabilities: [], errors: [], recent: [],
  }));
  render(<Mcp />);
  expect(await screen.findByText('Solo')).toBeInTheDocument();
  expect(screen.getByText('Nothing called yet.')).toBeInTheDocument();
});

it('offers a retry when the numbers cannot load', async () => {
  mcpUsage.mockRejectedValueOnce(new Error('down'));
  render(<Mcp />);
  expect(await screen.findByText(/down/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('Which apps')).toBeInTheDocument();
});
