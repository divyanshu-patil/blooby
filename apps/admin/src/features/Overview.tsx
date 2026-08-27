import { useState } from 'react';
import { ChipBar, ErrorState, PageHeader, StatCard, adminApi, useAsync } from '@blooby/studio';

const RANGES = [
  { id: '7' as const, label: '7 days' },
  { id: '30' as const, label: '30 days' },
  { id: '90' as const, label: '90 days' },
];

/**
 * Metrics, then one growth chart, then the secondary insights (spec §33). Every number
 * here answers a question someone would actually ask; there is no chart for decoration.
 */
export function Overview({ onGoTo }: { onGoTo: (view: string) => void }) {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const { data, error, loading, reload } = useAsync(() => adminApi.analytics(Number(range)), [range]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="How blooby is being used.">
        <ChipBar options={RANGES} value={range} onChange={setRange} />
      </PageHeader>

      <div className="page-body">
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && <div className="metrics">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>}

        {data && !loading && (
          <>
            <div className="metrics">
              <StatCard label="Total users" value={data.overview.totalUsers} />
              <StatCard label={`New users · ${range}d`} value={data.overview.newUsers} delta={data.growth.deltas.users} />
              <StatCard label={`Active users · ${range}d`} value={data.overview.activeUsers} />
              <StatCard label="Total projects" value={data.overview.totalProjects} delta={data.growth.deltas.projects} />
              <StatCard label="Projects today" value={data.overview.projectsToday} />
              <StatCard label="Community presets" value={data.overview.communityPresets} />
              <StatCard label="Community expressions" value={data.overview.communityExpressions} />
              <StatCard label="Official published" value={data.overview.officialPublished} />
            </div>

            {/* the one thing an admin should act on immediately, if it is non-zero */}
            {data.overview.pendingReview > 0 && (
              <button className="callout" onClick={() => onGoTo('/community')}>
                <strong>{data.overview.pendingReview}</strong> submission{data.overview.pendingReview === 1 ? '' : 's'} waiting for review
                <span className="callout-go">Review now →</span>
              </button>
            )}

            <section className="panel-block">
              <h2 className="block-title">Projects created</h2>
              <Sparkline series={data.growth.projects} label="projects" />
            </section>

            <div className="two-col">
              <section className="panel-block">
                <h2 className="block-title">New users</h2>
                <Sparkline series={data.growth.users} label="users" />
              </section>

              <section className="panel-block">
                <h2 className="block-title">Most used assets</h2>
                {data.insights.topAssets.length === 0
                  ? <p className="state-note" style={{ padding: '10px 0' }}>Nothing has been used yet.</p>
                  : (
                    <ol className="ranked">
                      {data.insights.topAssets.map((a) => (
                        <li key={a.id}>
                          <span className="ranked-name">{a.name}</span>
                          <span className="tag">{a.source}</span>
                          <span className="ranked-num">{a.downloadCount}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * A bar chart drawn as plain SVG. No chart library for one series — the whole thing is
 * a max, a scale and a map.
 */
function Sparkline({ series, label }: { series: { date: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      <div className="chart-total">
        <span className="chart-num">{total.toLocaleString()}</span> {label} in this period
      </div>
      <div className="chart" role="img" aria-label={`${total} ${label} over ${series.length} days`}>
        {series.map((d) => (
          <div key={d.date} className="chart-bar" title={`${d.date}: ${d.count}`}>
            <div className="chart-fill" style={{ height: `${(d.count / max) * 100}%` }} />
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
