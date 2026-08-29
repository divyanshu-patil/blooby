import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const splashscreens = vi.fn();
const publishSplash = vi.fn();
const unpublishSplash = vi.fn();
const removeSplash = vi.fn();
const createSplash = vi.fn();
const updateSplash = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return {
    ...actual,
    adminApi: { splashscreens, publishSplash, unpublishSplash, removeSplash, createSplash, updateSplash },
  };
});

const { Splashscreens } = await import('./Splashscreens');

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Launch', status: 'draft', background: '#17161b',
  durationMs: 2000, fadeMs: 300, updatedAt: '2026-08-01T00:00:00Z',
  data: { rig: null, timelines: [] }, ...over,
});

beforeEach(() => {
  for (const fn of [splashscreens, publishSplash, unpublishSplash, removeSplash, createSplash, updateSplash]) fn.mockReset();
  splashscreens.mockResolvedValue([row()]);
  for (const fn of [publishSplash, unpublishSplash, createSplash, updateSplash]) fn.mockResolvedValue({});
  removeSplash.mockResolvedValue(undefined);
});

it('lists what exists', async () => {
  render(<Splashscreens />);
  expect(await screen.findByText('Launch')).toBeInTheDocument();
});

it('invites you to make one when there are none', async () => {
  splashscreens.mockResolvedValue([]);
  render(<Splashscreens />);
  expect(await screen.findByText(/No splashscreens yet/i)).toBeInTheDocument();
});

/** Exactly one is live at a time — the live one has to be obvious at a glance. */
it('marks the live one, and only that one', async () => {
  splashscreens.mockResolvedValue([row({ id: 's1', status: 'published' }), row({ id: 's2', name: 'Old', status: 'archived' })]);
  render(<Splashscreens />);
  expect(await screen.findByText('Live')).toBeInTheDocument();
  expect(screen.getAllByText('Live')).toHaveLength(1);
  expect(screen.getByText('archived')).toBeInTheDocument();
});

it('offers unpublish for the live one and delete for the rest', async () => {
  splashscreens.mockResolvedValue([row({ status: 'published' })]);
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  expect(await screen.findByRole('button', { name: /unpublish/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
});

it('deletes a draft, then reloads', async () => {
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  const del = await screen.findByRole('button', { name: /delete/i });
  await userEvent.click(del);
  await waitFor(() => expect(removeSplash).toHaveBeenCalledWith('s1'));
  await waitFor(() => expect(splashscreens).toHaveBeenCalledTimes(2));
});

it('reports a refused change rather than closing as if it worked', async () => {
  splashscreens.mockResolvedValue([row({ status: 'published' })]);
  unpublishSplash.mockRejectedValue(new Error('Unpublish this splashscreen before deleting it'));
  render(<Splashscreens />);
  await userEvent.click(await screen.findByText('Launch'));
  await userEvent.click(await screen.findByRole('button', { name: /unpublish/i }));
  expect(await screen.findByText(/Unpublish this splashscreen/)).toBeInTheDocument();
});

it('offers a retry when the list fails to load', async () => {
  splashscreens.mockRejectedValueOnce(new Error('offline'));
  render(<Splashscreens />);
  expect(await screen.findByText(/offline/)).toBeInTheDocument();
  splashscreens.mockResolvedValue([row()]);
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('Launch')).toBeInTheDocument();
});
