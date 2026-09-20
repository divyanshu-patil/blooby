import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// the page's data comes from the studio package's own API client, imported inside it
const api = { overview: vi.fn(), live: vi.fn(), createToken: vi.fn(), revokeToken: vi.fn(), rotateToken: vi.fn(), disconnect: vi.fn(), decideProposal: vi.fn() };
vi.mock('../../../../../packages/studio/src/cloud/api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mcpApi: api }));

const { AiClients } = await import('./AiClients');

/** the section under a heading — "Claude" appears both as a connected app and in the paste list */
const section = (heading: string) => (screen.getByRole('heading', { name: heading }).closest('section')) as HTMLElement;

const overview = {
  serverUrl: 'https://api.blooby.app/mcp', capabilityVersion: '1.0.0', capabilityCount: 245,
  scopes: {}, modes: { read_only: 'Look only', suggest: 'Ask first', full: 'It edits your projects directly' },
  tokens: [{ id: 't1', name: 'Laptop', scopes: [], mode: 'full', expiresAt: null, lastUsedAt: null, createdAt: '2026-09-01T00:00:00Z' }],
  connections: [{ grantId: 'g1', clientId: 'c1', clientName: 'Claude', scopes: [], mode: 'suggest', connectedAt: '2026-09-01T00:00:00Z', lastUsedAt: null }],
  recent: [{ id: 1, clientId: 'c1', operation: 'render_frame', projectId: null, ok: true, errorCode: null, durationMs: 40, createdAt: '2026-09-01T00:00:00Z' }],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.overview.mockResolvedValue(overview);
  api.live.mockResolvedValue({ projects: [], proposals: [] });
  api.createToken.mockResolvedValue({ token: 'blb_pat_SECRET', meta: { name: 'CI' } });
  api.disconnect.mockResolvedValue(undefined);
});

it('leads with the link to copy, and says what happens after pasting it', async () => {
  render(<AiClients />);
  expect(await screen.findByLabelText('Your MCP link')).toHaveValue('https://api.blooby.app/mcp');
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  expect(screen.getByText('Paste it into your AI app')).toBeInTheDocument();
  expect(screen.getByText(/Approve, then ask for animation/)).toBeInTheDocument();
});

it('gives each app the exact thing to paste', async () => {
  render(<AiClients />);
  await screen.findByLabelText('Your MCP link');
  const row = screen.getByText('Claude Code').closest('li') as HTMLElement;
  expect(within(row).getByText('claude mcp add --transport http blooby https://api.blooby.app/mcp')).toBeInTheDocument();
});

it('lists connected apps with what they may do, and disconnects one', async () => {
  render(<AiClients />);
  await screen.findByLabelText('Your MCP link');
  const row = within(section('Connected apps')).getByText('Claude').closest('li') as HTMLElement;
  expect(within(row).getByText(/Ask me first/)).toBeInTheDocument();
  await userEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('g1'));
});

it('shows a new token once, and only once', async () => {
  render(<AiClients />);
  await userEvent.type(await screen.findByLabelText('Token name'), 'CI');
  await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
  expect(await screen.findByText('blb_pat_SECRET')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'I have stored it' }));
  expect(screen.queryByText('blb_pat_SECRET')).not.toBeInTheDocument();
});

it('explains what a token mode means as you pick it', async () => {
  render(<AiClients />);
  await screen.findByLabelText('Token name');
  const tokens = section('Personal tokens');
  expect(within(tokens).getByText('It edits your projects directly')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('How much it may do'), 'read_only');
  expect(within(tokens).getByText('Look only', { selector: '.ai-note' })).toBeInTheDocument();
});

it('surfaces a change waiting for approval', async () => {
  api.live.mockResolvedValue({ projects: [], proposals: [{ id: 'p1', projectId: 'x', client: 'Claude', capability: 'add_layer', summary: 'Add a heart', status: 'pending', preview: null, createdAt: '2026-09-01T00:00:00Z' }] });
  api.decideProposal.mockResolvedValue({});
  render(<AiClients />);
  expect(await screen.findByText(/wants to add a heart/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(api.decideProposal).toHaveBeenCalledWith('p1', true));
});

it('says what to do when nothing is connected', async () => {
  api.overview.mockResolvedValue({ ...overview, connections: [], tokens: [] });
  render(<AiClients />);
  expect(await screen.findByText(/No app is connected yet/)).toBeInTheDocument();
});
