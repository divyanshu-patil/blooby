import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// the panel lives inside the studio package and imports its API client directly
const api = { overview: vi.fn(), live: vi.fn(), createToken: vi.fn(), revokeToken: vi.fn(), rotateToken: vi.fn(), disconnect: vi.fn(), decideProposal: vi.fn() };
vi.mock('../../../../../packages/studio/src/cloud/api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mcpApi: api }));

const { AiClients } = await import('./AiClients');

const overview = {
  serverUrl: 'https://api.blooby.app/mcp', capabilityVersion: '1.0.0', capabilityCount: 240,
  scopes: {}, modes: { read_only: 'Look only', suggest: 'Ask first', full: 'Full control' },
  tokens: [{ id: 't1', name: 'Laptop', scopes: [], mode: 'full', expiresAt: null, lastUsedAt: null, createdAt: '2026-09-01T00:00:00Z' }],
  connections: [{ grantId: 'g1', clientId: 'c1', clientName: 'Claude', scopes: [], mode: 'suggest', connectedAt: '2026-09-01T00:00:00Z', lastUsedAt: null }],
  recent: [],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.overview.mockResolvedValue(overview);
  api.live.mockResolvedValue({ projects: [], proposals: [] });
  api.createToken.mockResolvedValue({ token: 'blb_pat_SECRET', meta: { name: 'CI' } });
  api.disconnect.mockResolvedValue(undefined);
});

it('leads with the MCP link to copy into Claude, and how approving works', async () => {
  render(<AiClients />);
  expect((await screen.findAllByText('https://api.blooby.app/mcp'))[0]).toHaveClass('mcp-link');
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  expect(screen.getByText(/opens a Blooby page\. Approve it/)).toBeInTheDocument();
});

it('keeps per-app setup one fold away', async () => {
  render(<AiClients />);
  await screen.findAllByText('https://api.blooby.app/mcp');
  await userEvent.click(screen.getByRole('button', { name: 'Claude Code' }));
  expect(screen.getByText('claude mcp add --transport http blooby https://api.blooby.app/mcp')).toBeInTheDocument();
});

it('lists connected apps with their mode, and disconnects one', async () => {
  render(<AiClients />);
  const row = (await screen.findByText('Claude', { selector: 'span' })).closest('.keyrow') as HTMLElement;
  expect(within(row).getByText('Ask me first')).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('g1'));
});

it('shows a new token once, with its secret', async () => {
  render(<AiClients />);
  await userEvent.type(await screen.findByPlaceholderText(/Token name/), 'CI');
  await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
  expect(await screen.findByText('blb_pat_SECRET')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'I have stored it' }));
  expect(screen.queryByText('blb_pat_SECRET')).not.toBeInTheDocument();
});

it('offers approval for a change waiting on you', async () => {
  api.live.mockResolvedValue({ projects: [], proposals: [{ id: 'p1', projectId: 'x', client: 'Claude', capability: 'add_layer', summary: 'Add a heart', status: 'pending', preview: null, createdAt: '2026-09-01T00:00:00Z' }] });
  api.decideProposal.mockResolvedValue({});
  render(<AiClients />);
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(api.decideProposal).toHaveBeenCalledWith('p1', true));
});
