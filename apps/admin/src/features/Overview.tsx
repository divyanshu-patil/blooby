import { useState } from 'react';
import { ChipBar, ErrorState, PageHeader, StatCard, adminApi, useAsync } from '@blooby/studio';
import { BarChart, Ranked } from './charts';

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
              <BarChart series={data.growth.projects} bars={[{ key: 'count', name: 'projects' }]} label="projects" />
            </section>

            <div className="two-col">
              <section className="panel-block">
                <h2 className="block-title">New users</h2>
                <BarChart series={data.growth.users} bars={[{ key: 'count', name: 'users' }]} label="users" />
              </section>

              <section className="panel-block">
                <h2 className="block-title">Most used assets</h2>
                <Ranked empty="Nothing has been used yet."
                  rows={data.insights.topAssets.map((a) => ({
                    key: a.id, name: a.name, tags: <span className="tag">{a.source}</span>, value: a.downloadCount,
                  }))} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
