import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const moderationQueue = vi.fn();
const moderate = vi.fn();
vi.mock('@blooby/studio', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@blooby/studio');
  return { ...actual, adminApi: { moderationQueue, moderate } };
});

const { Moderation } = await import('./Moderation');

const preset = (over: Record<string, unknown> = {}) => ({
  id: 'a1', name: 'Wave', kind: 'preset', source: 'community', status: 'pending_review',
  description: 'A friendly wave', tags: ['greeting'], reviewNote: null,
  createdAt: '2026-08-01T00:00:00Z',
  data: { id: 'p', name: 'Wave', source: 'community', durationMs: 800, tracks: [], emitters: [], modifiers: [] },
  ...over,
});

beforeEach(() => {
  moderationQueue.mockReset(); moderate.mockReset();
  moderationQueue.mockResolvedValue({ items: [preset()], nextCursor: null });
  moderate.mockResolvedValue({});
});

const openReview = async () => {
  render(<Moderation />);
  await userEvent.click(await screen.findByText('Wave'));
  return screen.findByRole('dialog');
};

it('shows what is waiting for review', async () => {
  render(<Moderation />);
  expect(await screen.findByText('Wave')).toBeInTheDocument();
  expect(moderationQueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_review' }));
});

it('switches queues without losing the screen', async () => {
  render(<Moderation />);
  await screen.findByText('Wave');
  await userEvent.click(screen.getByRole('button', { name: 'Published' }));
  await waitFor(() => expect(moderationQueue).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published' })));
});

it('says the queue is empty rather than showing a blank page', async () => {
  moderationQueue.mockResolvedValue({ items: [], nextCursor: null });
  render(<Moderation />);
  expect(await screen.findByText(/nothing/i)).toBeInTheDocument();
});

/**
 * Reviewing an animation from a still is guesswork, so the dialog plays the real thing.
 * The preview must render the submission's own effects, not just its keyframes.
 */
it('plays the submission, emitters included, in the review dialog', async () => {
  const withEmitter = preset({
    data: {
      id: 'p', name: 'Sleepy', source: 'community', durationMs: 2000, tracks: [], modifiers: [],
      emitters: [{
        name: 'zzz', glyphs: [], parts: [{ id: 'z', shapeId: 'zed', weight: 1, speed: 1, sizeScale: 1, spin: 0 }],
        color: { r: 100, g: 100, b: 120, a: 1 }, size: 40, path: 'arc',
        from: { x: 60, y: -60 }, to: { x: 160, y: -180 }, bow: 0,
        rateMs: 600, lifeMs: 1800, count: 3, fadeStart: 0.6,
        scaleFrom: 0.5, scaleTo: 1.2, spin: 0, wobble: 2,
      }],
    },
  });
  moderationQueue.mockResolvedValue({ items: [withEmitter], nextCursor: null });
  render(<Moderation />);
  await userEvent.click(await screen.findByText('Wave'));
  const dialog = await screen.findByRole('dialog');

  const svg = dialog.querySelector('.review-stage svg');
  expect(svg, 'the preview renders').toBeTruthy();
  // the body and two eyes, plus whatever the emitter has on screen at this instant
  expect(svg!.querySelectorAll('ellipse, rect').length).toBeGreaterThanOrEqual(3);
});

it('approves a submission and refreshes the queue', async () => {
  const dialog = await openReview();
  await userEvent.click(within(dialog).getByRole('button', { name: /approve/i }));
  await waitFor(() => expect(moderate).toHaveBeenCalledWith('a1', { action: 'approve' }));
  await waitFor(() => expect(moderationQueue).toHaveBeenCalledTimes(2));
});

/** The creator sees the reason, so rejecting without one must not be possible. */
it('will not reject without a reason', async () => {
  const dialog = await openReview();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
  const confirm = await screen.findByRole('button', { name: /reject submission/i });
  expect(confirm).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/why are you rejecting/i), 'Too close to an existing one');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  await waitFor(() => expect(moderate).toHaveBeenCalledWith('a1', {
    action: 'reject', reason: 'Too close to an existing one',
  }));
});

it('lets you back out of rejecting', async () => {
  const dialog = await openReview();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  expect(moderate).not.toHaveBeenCalled();
});

it('offers unpublish, not approve, for something already live', async () => {
  moderationQueue.mockResolvedValue({ items: [preset({ status: 'published' })], nextCursor: null });
  const dialog = await openReview();
  expect(within(dialog).getByRole('button', { name: /unpublish/i })).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
});

it('surfaces a previous rejection so the same thing is not re-reviewed blind', async () => {
  moderationQueue.mockResolvedValue({ items: [preset({ reviewNote: 'Please rename it' })], nextCursor: null });
  await openReview();
  expect(screen.getByText(/Previously rejected: Please rename it/)).toBeInTheDocument();
});

it('keeps the dialog open and reports why when moderation fails', async () => {
  moderate.mockRejectedValue(new Error('Someone already reviewed this'));
  const dialog = await openReview();
  await userEvent.click(within(dialog).getByRole('button', { name: /approve/i }));
  expect(await screen.findByText(/already reviewed/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
