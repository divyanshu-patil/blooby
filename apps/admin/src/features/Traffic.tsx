import { useState } from 'react';
import { ChipBar, ErrorState, PageHeader, StatCard, adminApi, useAsync } from '@blooby/studio';
import { BarChart, Ranked, Shares } from './charts';

const RANGES = [
  { id: '7' as const, label: '7 days' },
  { id: '30' as const, label: '30 days' },
  { id: '90' as const, label: '90 days' },
];

const APPS = [
  { id: 'web' as const, label: 'App' },
  { id: 'admin' as const, label: 'Admin' },
];

/**
 * Where people go.
 *
 * Every other number in this panel is derived from timestamps on rows that exist anyway;
 * this tab is the one fed by an event table, because nothing writes a row when somebody
 * opens the community tab. It is cookieless — a "visitor" is a salted hash that rotates
 * daily, so it counts people within a day and cannot follow anyone across days, which is
 * why there is no consent banner anywhere in the app.
 */
export function Traffic() {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [app, setApp] = useState<'web' | 'admin'>('web');
  const { data, error, loading, reload } = useAsync(() => adminApi.traffic(Number(range), app), [range, app]);

  return (
    <>
      <PageHeader title="Traffic" subtitle="Which pages people open, and how they move between them.">
        <ChipBar options={APPS} value={app} onChange={setApp} />
        <ChipBar options={RANGES} value={range} onChange={setRange} />
      </PageHeader>

      <div className="page-body">
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && <div className="metrics">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>}

        {data && !loading && (
          <>
            <div className="metrics">
              <StatCard label={`Page views · ${range}d`} value={data.totals.views} delta={data.deltas.views} />
              <StatCard label={`Visitors · ${range}d`} value={data.totals.visitors} delta={data.deltas.visitors} />
              <StatCard label="Signed in" value={data.totals.signedInVisitors} />
              <StatCard label="Pages per visitor" value={data.totals.viewsPerVisitor} />
              <StatCard label="Sessions started" value={data.totals.entries} />
            </div>

            {data.totals.views === 0 && (
              <p className="state-note" style={{ padding: '10px 0' }}>
                Nothing recorded in this window yet. Views are reported by the app as people navigate,
                and buffered for a few seconds before they are written.
              </p>
            )}

            <section className="panel-block">
              <h2 className="block-title">Views and visitors</h2>
              <BarChart series={data.series} label="page views"
                bars={[{ key: 'views', name: 'views' }, { key: 'visitors', name: 'visitors', tone: 'muted' }]} />
            </section>

            <div className="two-col">
              <section className="panel-block">
                <h2 className="block-title">Top pages</h2>
                <Ranked empty="No pages yet."
                  rows={data.topPages.map((p) => ({
                    key: p.path,
                    name: <code>{p.path}</code>,
                    tags: <span className="tag">{p.visitors} {p.visitors === 1 ? 'visitor' : 'visitors'}</span>,
                    value: p.views.toLocaleString(),
                    note: `${p.views} views from ${p.visitors} visitors · ${p.signedIn} while signed in`,
                  }))} />
              </section>

              <section className="panel-block">
                <h2 className="block-title">Where they came from</h2>
                <Ranked empty="Everyone arrived directly."
                  rows={data.referrers.map((r) => ({ key: r.source, name: r.source, value: r.views.toLocaleString() }))} />
              </section>
            </div>

            <div className="two-col">
              {/* the pair of pages, not just the list of them: this is the actual journey */}
              <section className="panel-block">
                <h2 className="block-title">Where they go next</h2>
                <Ranked empty="Not enough navigation recorded yet."
                  rows={data.flows.map((f) => ({
                    key: `${f.from}>${f.to}`,
                    name: <><code>{f.from}</code> <span className="flow-arrow">→</span> <code>{f.to}</code></>,
                    value: f.views.toLocaleString(),
                  }))} />
              </section>

              <section className="panel-block">
                <h2 className="block-title">Devices</h2>
                <Shares empty="No views yet."
                  rows={data.devices.map((d) => ({ key: d.device, name: d.device, value: d.views }))} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
