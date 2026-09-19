import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const consent = vi.fn();
const decide = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, mcpApi: { consent, decide } };
});

const { Connect } = await import('./Connect');
const user = { id: 'u1', email: 'ann@example.com', role: 'user' as const, name: 'Ann', avatarUrl: null };
const assign = vi.fn();

beforeEach(() => {
  consent.mockReset(); decide.mockReset(); assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  consent.mockResolvedValue({
    requestId: 'r1', clientName: 'Claude', redirectHost: 'claude.ai',
    scopes: [{ scope: 'project:read', description: 'See your projects' }, { scope: 'project:write', description: 'Change your projects' }],
    modes: { read_only: 'Look only', suggest: 'Ask first', full: 'Full control' },
  });
  decide.mockResolvedValue({ redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' });
});

const at = (url: string, el: React.ReactNode) => render(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);

it('names the app asking and what it wants, in plain words', async () => {
  at('/connect?request=r1', <Connect user={user} />);
  expect(await screen.findByRole('heading', { name: 'Connect Claude' })).toBeInTheDocument();
  expect(screen.getByLabelText('See your projects')).toBeChecked();
  expect(screen.getByText(/claude\.ai/)).toBeInTheDocument();
});

it('approving sends the chosen permissions and mode, then returns to the app', async () => {
  at('/connect?request=r1', <Connect user={user} />);
  await userEvent.click(await screen.findByLabelText('Change your projects'));
  await userEvent.click(screen.getByLabelText(/Ask me first/));
  await userEvent.click(screen.getByRole('button', { name: 'Allow Claude' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith('r1', { approve: true, scopes: ['project:read'], mode: 'suggest' }));
  expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
});

it('denying still goes back to the app, which is told no', async () => {
  decide.mockResolvedValue({ redirectTo: 'https://claude.ai/cb?error=access_denied' });
  at('/connect?request=r1', <Connect user={user} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith('r1', expect.objectContaining({ approve: false })));
  expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied');
});

it('an expired request says so instead of a blank card', async () => {
  consent.mockRejectedValue(new Error('This connection request has expired. Start again from your AI app.'));
  at('/connect?request=r1', <Connect user={user} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/expired/);
});

it('signed out, it asks you to sign in first and remembers the request', async () => {
  at('/connect?request=r9', <Connect user={null} />);
  expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  expect(sessionStorage.getItem('blooby.connect')).toBe('r9');
});
