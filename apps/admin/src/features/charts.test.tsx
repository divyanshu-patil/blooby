import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart, Ranked, Shares } from './charts';

it('draws one bar per day, a legend for several series, and tolerates junk values', () => {
  render(<BarChart label="views" series={[{ date: 'a', v: 4, w: 'x' }, { date: 'b', v: 'x', w: 1 }] as never}
    bars={[{ key: 'v', name: 'views' }, { key: 'w', name: 'visitors', tone: 'muted' }] as never} />);
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', '4 views over 2 days');
  expect(screen.getByText('visitors')).toBeInTheDocument();
});

it('draws an empty chart, with no legend for a single series', () => {
  render(<BarChart label="views" series={[]} bars={[{ key: 'v' as never, name: 'views' }]} />);
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', '0 views over 0 days');
  expect(screen.queryByText('views', { selector: '[data-tone]' })).toBeNull();
});

it('ranks rows, or says there are none', () => {
  const { rerender } = render(<Ranked empty="none" rows={[{ key: 'a', name: 'A', value: 1 }]} />);
  expect(screen.getByText('A')).toBeInTheDocument();
  rerender(<Ranked empty="none" rows={[]} />);
  expect(screen.getByText('none')).toBeInTheDocument();
});

it('shows shares of a total, or says there is nothing', () => {
  const { rerender } = render(<Shares empty="none" rows={[{ key: 'a', name: 'A', value: 1 }, { key: 'b', name: 'B', value: 3 }]} />);
  expect(screen.getByText('3 · 75%')).toBeInTheDocument();
  rerender(<Shares empty="none" rows={[{ key: 'a', name: 'A', value: 0 }]} />);
  expect(screen.getByText('none')).toBeInTheDocument();
});
