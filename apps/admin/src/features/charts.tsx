import type { ReactNode } from 'react';

/**
 * The panel's charts, drawn as plain elements.
 *
 * Still no chart library. Everything here is a max, a scale and a map — and a dependency
 * would bring its own colours, which this design does not have (DESIGN.md: monochrome,
 * colour only for destructive states). A second series is drawn at a lighter weight INSIDE
 * the first rather than beside it, so the pair reads as "of these views, this many people"
 * without needing a legend to decode.
 */

export interface Series { date: string }

export function BarChart<T extends Series>({ series, bars, label }: {
  series: T[];
  /** outermost first — each is drawn over the one before, so pass the larger number first */
  bars: { key: keyof T & string; name: string; tone?: 'ink' | 'muted' | 'hot' }[];
  label: string;
}) {
  const main = bars[0].key;
  const max = Math.max(1, ...series.map((d) => Number(d[main]) || 0));
  const total = series.reduce((a, b) => a + (Number(b[main]) || 0), 0);

  return (
    <div>
      <div className="chart-total">
        <span className="chart-num">{total.toLocaleString()}</span> {label} in this period
        {bars.length > 1 && <span className="chart-legend">{bars.map((b) => <span key={b.key} data-tone={b.tone ?? 'ink'}>{b.name}</span>)}</span>}
      </div>
      <div className="chart" role="img" aria-label={`${total} ${label} over ${series.length} days`}>
        {series.map((d) => (
          <div key={d.date} className="chart-bar" title={`${d.date}\n${bars.map((b) => `${Number(d[b.key]) || 0} ${b.name}`).join('\n')}`}>
            <div className="chart-stack">
              {bars.map((b) => (
                <div key={b.key} className="chart-fill" data-tone={b.tone ?? 'ink'}
                  style={{ height: `${((Number(d[b.key]) || 0) / max) * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="chart-axis">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/** A leaderboard: a name, optional tags, and the number it is ranked by. */
export function Ranked({ rows, empty }: {
  rows: { key: string; name: ReactNode; tags?: ReactNode; value: ReactNode; note?: string }[];
  empty: string;
}) {
  if (!rows.length) return <p className="state-note" style={{ padding: '10px 0' }}>{empty}</p>;
  return (
    <ol className="ranked">
      {rows.map((r) => (
        <li key={r.key} title={r.note}>
          <span className="ranked-name">{r.name}</span>
          {r.tags}
          <span className="ranked-num">{r.value}</span>
        </li>
      ))}
    </ol>
  );
}

/** A number and its share of a total, as a bar behind the row. Used for the small
 *  breakdowns (devices, error codes) where the proportion is the whole point. */
export function Shares({ rows, empty }: { rows: { key: string; name: string; value: number }[]; empty: string }) {
  const total = rows.reduce((a, b) => a + b.value, 0);
  if (!total) return <p className="state-note" style={{ padding: '10px 0' }}>{empty}</p>;
  return (
    <ul className="plain-list">
      {rows.map((r) => (
        <li key={r.key} className="share-row">
          <span className="share-fill" style={{ width: `${(r.value / total) * 100}%` }} aria-hidden />
          <span className="ranked-name">{r.name}</span>
          <span className="ranked-num">{r.value.toLocaleString()} · {Math.round((r.value / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}
