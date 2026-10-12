import { expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { defaultProject } from '@blooby/studio';
import { SplashPreview } from './SplashPreview';

const project = defaultProject();

it('plays, then fades out once its duration has passed', async () => {
  const { container } = render(<SplashPreview data={project} background="#000" durationMs={40} fadeMs={10} playKey={0} />);
  const box = () => container.querySelector('.splash-preview > div') as HTMLElement;
  expect(box().style.opacity).toBe('1');
  await waitFor(() => expect(box().style.opacity).toBe('0'));
});

it('keeps playing while there is time left, and replays on a new key', async () => {
  const { container, rerender } = render(<SplashPreview data={project} background="#000" durationMs={60_000} fadeMs={10} playKey={0} />);
  await new Promise((r) => setTimeout(r, 60));
  expect((container.querySelector('.splash-preview > div') as HTMLElement).style.opacity).toBe('1');
  rerender(<SplashPreview data={project} background="#000" durationMs={60_000} fadeMs={10} playKey={1} />);
});

it('says so when there is nothing to draw, or the data cannot be rendered', () => {
  const { rerender } = render(<SplashPreview data={null} background="#000" durationMs={100} fadeMs={10} playKey={0} />);
  expect(screen.getByText(/can’t be rendered/)).toBeInTheDocument();
  rerender(<SplashPreview data={{ timelines: 'broken' }} background="#000" durationMs={100} fadeMs={10} playKey={0} />);
  expect(screen.getByText(/can’t be rendered/)).toBeInTheDocument();
});
