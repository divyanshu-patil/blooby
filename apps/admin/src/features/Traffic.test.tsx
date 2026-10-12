import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const traffic = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { traffic } };
});

const { Traffic } = await import('./Traffic');

const data = (views = 10, visitors = 1) => ({
  totals: { views, visitors, signedInVisitors: 1, viewsPerVisitor: 2, entries: 3 },
  deltas: { views: 0.1, visitors: 0.1 },
  series: [{ date: '2026-09-01', views: 3, visitors: 2 }],
  topPages: [{ path: '/projects', views: 5, visitors, signedIn: 1 }],
  referrers: [{ source: 'google', views: 4 }],
  flows: [{ from: '/a', to: '/b', views: 2 }],
  devices: [{ device: 'desktop', views: 9 }],
});

beforeEach(() => { traffic.mockReset(); traffic.mockResolvedValue(data()); });

it('shows traffic and refetches by range and app', async () => {
  render(<Traffic />);
  expect(await screen.findByText('/projects')).toBeInTheDocument();
  expect(traffic).toHaveBeenCalledWith(30, 'web');
  await userEvent.click(screen.getByRole('button', { name: '7 days' }));
  await waitFor(() => expect(traffic).toHaveBeenLastCalledWith(7, 'web'));
  await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
  await waitFor(() => expect(traffic).toHaveBeenLastCalledWith(7, 'admin'));
});

it('says nothing was recorded, and uses the plural visitors', async () => {
  traffic.mockResolvedValue(data(0, 2));
  render(<Traffic />);
  expect(await screen.findByText(/Nothing recorded in this window/)).toBeInTheDocument();
  expect(screen.getByText('2 visitors')).toBeInTheDocument();
});

it('offers a retry when it cannot load', async () => {
  traffic.mockRejectedValueOnce(new Error('down'));
  render(<Traffic />);
  expect(await screen.findByText(/down/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('/projects')).toBeInTheDocument();
});
