import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const analytics = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { analytics } };
});

const { Overview } = await import('./Overview');

const data = (pendingReview = 0) => ({
  overview: {
    totalUsers: 12, newUsers: 4, activeUsers: 7, totalProjects: 30, projectsToday: 2,
    communityPresets: 5, communityExpressions: 1, officialPublished: 3, pendingReview,
  },
  growth: { deltas: { users: 0.2, projects: -0.1 }, users: [], projects: [] },
  insights: { topAssets: [], topCreators: [] },
});

beforeEach(() => { analytics.mockReset(); analytics.mockResolvedValue(data()); });

it('shows the headline counts', async () => {
  render(<Overview onGoTo={() => {}} />);
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(screen.getByText('30')).toBeInTheDocument();
});

/** A queue nobody looks at is the failure mode; the dashboard has to point at it. */
it('links straight to the review queue when something is waiting', async () => {
  analytics.mockResolvedValue(data(3));
  const onGoTo = vi.fn();
  render(<Overview onGoTo={onGoTo} />);
  await userEvent.click(await screen.findByRole('button', { name: /waiting for review/i }));
  expect(onGoTo).toHaveBeenCalledWith('/community');
});

it('says "submission" for one and "submissions" for several', async () => {
  analytics.mockResolvedValue(data(1));
  render(<Overview onGoTo={() => {}} />);
  const callout = await screen.findByRole('button', { name: /waiting for review/i });
  expect(callout.textContent).toMatch(/1 submission waiting/);
});

it('shows no callout at all when the queue is empty', async () => {
  render(<Overview onGoTo={() => {}} />);
  await screen.findByText('12');
  expect(screen.queryByText(/waiting for review/i)).not.toBeInTheDocument();
});

it('refetches when the date range changes', async () => {
  render(<Overview onGoTo={() => {}} />);
  await screen.findByText('12');
  expect(analytics).toHaveBeenCalledWith(30);
  await userEvent.click(screen.getByRole('button', { name: '7 days' }));
  await waitFor(() => expect(analytics).toHaveBeenLastCalledWith(7));
});

it('offers a retry when analytics fail', async () => {
  analytics.mockRejectedValueOnce(new Error('upstream down'));
  render(<Overview onGoTo={() => {}} />);
  expect(await screen.findByText(/upstream down/)).toBeInTheDocument();
  analytics.mockResolvedValue(data());
  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('12')).toBeInTheDocument();
});
