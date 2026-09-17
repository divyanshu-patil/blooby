import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LATEST_RELEASE, RELEASES, WhatsNewButton, configureWhatsNew } from '@blooby/studio';

it('shows what is new since last time, and records it as seen when closed', async () => {
  const save = vi.fn();
  configureWhatsNew({ seen: '2000.01.01', save });
  render(<WhatsNewButton surface="dashboard" autoOpen={false} />);

  const button = screen.getByRole('button', { name: /what.s new/i });
  expect(within(button).getByLabelText('unseen')).toBeInTheDocument();
  await userEvent.click(button);

  const dialog = screen.getByRole('dialog', { name: /what.s new/i });
  for (const item of RELEASES[0].items) expect(within(dialog).getByText(item.title)).toBeInTheDocument();
  // a dashboard item can be toured from here; an editor one says where to go
  expect(within(dialog).getAllByRole('button', { name: 'Show me' }).length).toBe(RELEASES[0].items.filter((i) => i.surface === 'dashboard' && i.tour).length);
  expect(within(dialog).getAllByText('Open a project to see it.').length).toBeGreaterThan(0);

  await userEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith(LATEST_RELEASE));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(screen.getByRole('button', { name: /what.s new/i })).queryByLabelText('unseen')).toBeNull();
});
