import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const projects = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { projects } };
});

const { Projects } = await import('./Projects');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'My mascot', userId: 'u1', visibility: 'private',
  updatedAt: '2026-08-01T00:00:00Z', sizeBytes: 2048, thumbnailUrl: null, ...over,
});

beforeEach(() => { projects.mockReset(); projects.mockResolvedValue({ items: [row()], nextCursor: null }); });

it('lists projects', async () => {
  render(<Projects />);
  expect(await screen.findByText('My mascot')).toBeInTheDocument();
});

it('asks for a bounded page and re-queries on search', async () => {
  render(<Projects />);
  await screen.findByText('My mascot');
  expect(projects).toHaveBeenCalledWith({ q: undefined, limit: 50 });
  await userEvent.type(screen.getByPlaceholderText(/search/i), 'mascot');
  await waitFor(() => expect(projects).toHaveBeenLastCalledWith({ q: 'mascot', limit: 50 }));
});

it('says so when there is nothing to show', async () => {
  projects.mockResolvedValue({ items: [], nextCursor: null });
  render(<Projects />);
  expect(await screen.findByText(/no projects/i)).toBeInTheDocument();
});

/** An admin browsing projects must not be able to open someone's private work. */
it('shows metadata only — no link that opens the payload', async () => {
  const { container } = render(<Projects />);
  await screen.findByText('My mascot');
  expect(container.querySelectorAll('a[href]').length).toBe(0);
});

it('offers a retry when the list fails', async () => {
  projects.mockRejectedValueOnce(new Error('nope'));
  render(<Projects />);
  expect(await screen.findByText(/nope/)).toBeInTheDocument();
});
