import { useState } from 'react';
import { ChipBar, ErrorState, PageHeader, StatCard, adminApi, relativeTime, useAsync } from '@blooby/studio';
import { BarChart, Ranked, Shares } from './charts';

const RANGES = [
  { id: '7' as const, label: '7 days' },
  { id: '30' as const, label: '30 days' },
  { id: '90' as const, label: '90 days' },
];

/**
 * AI apps, from the outside.
 *
 * Every number here already existed: mcp_audit gets a row per capability call — names, ids
 * and a duration, never an argument or any project content — and mcp_tokens knows what is
 * currently connected. Nothing new is written for this tab.
 *
 * The two questions it answers are different and both matter. "Connected" counts people
 * holding a live credential, whether or not they have used it; the rest of the page counts
 * what was actually done in the window. A big gap between them means people connected an
 * app and never came back, which is the thing worth knowing.
 */
export function Mcp() {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const { data, error, loading, reload } = useAsync(() => adminApi.mcpUsage(Number(range)), [range]);

  return (
    <>
      <PageHeader title="MCP" subtitle="Claude, ChatGPT and Cursor working on people’s projects.">
        <ChipBar options={RANGES} value={range} onChange={setRange} />
      </PageHeader>

      <div className="page-body">
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && <div className="metrics">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>}

        {data && !loading && (
          <>
            <div className="metrics">
              <StatCard label="People connected" value={data.totals.connectedPeople} />
              <StatCard label={`People using it · ${range}d`} value={data.totals.people} delta={data.deltas.people} />
              <StatCard label={`Calls · ${range}d`} value={data.totals.calls} delta={data.deltas.calls} />
              <StatCard label="Projects touched" value={data.totals.projects} />
              <StatCard label="OAuth connections" value={data.totals.oauthGrants} />
              <StatCard label="Personal tokens" value={data.totals.personalTokens} />
              <StatCard label="Error rate" value={`${data.totals.errorRate}%`} />
              <StatCard label="Median · p95" value={`${data.totals.p50Ms}ms · ${data.totals.p95Ms}ms`} />
            </div>

            {/* connected but never used is the number to act on: an onboarding problem, not a load one */}
            {data.totals.connectedPeople > 0 && data.totals.people === 0 && (
              <p className="setting-alert" role="status">
                {data.totals.connectedPeople} {data.totals.connectedPeople === 1 ? 'person has' : 'people have'} an AI app
                connected but made no calls in this window.
              </p>
            )}

            <section className="panel-block">
              <h2 className="block-title">Calls</h2>
              <BarChart series={data.series} label="capability calls"
                bars={[{ key: 'calls', name: 'calls' }, { key: 'failed', name: 'failed', tone: 'hot' }]} />
            </section>

            <div className="two-col">
              <section className="panel-block">
                <h2 className="block-title">Which apps</h2>
                <Ranked empty="No AI app has called anything yet."
                  rows={data.clients.map((c) => ({
                    key: c.name,
                    name: c.name,
                    tags: <span className="tag">{c.people} {c.people === 1 ? 'person' : 'people'}</span>,
                    value: c.calls.toLocaleString(),
                    note: `${c.calls} calls, ${c.failed} failed · ${c.installs} ${c.installs === 1 ? 'installation' : 'installations'} · last ${relativeTime(Date.parse(c.lastUsedAt))}`,
                  }))} />
              </section>

              <section className="panel-block">
                <h2 className="block-title">What they use it for</h2>
                <Ranked empty="Nothing called yet."
                  rows={data.capabilities.map((c) => ({
                    key: c.capability,
                    name: <code>{c.capability}</code>,
                    tags: c.failed > 0 ? <span className="tag">{c.failed} failed</span> : null,
                    value: c.calls.toLocaleString(),
                    note: `${c.calls} calls from ${c.people} people · ${c.avgMs}ms average`,
                  }))} />
              </section>
            </div>

            <div className="two-col">
              <section className="panel-block">
                <h2 className="block-title">Why calls fail</h2>
                <Shares empty="Nothing has failed. "
                  rows={data.errors.map((e) => ({ key: e.code, name: e.code, value: e.calls }))} />
              </section>

              <section className="panel-block">
                <h2 className="block-title">Latest calls</h2>
                <Ranked empty="Nothing yet."
                  rows={data.recent.map((r, i) => ({
                    key: `${r.at}-${i}`,
                    name: <><code>{r.capability}</code> {!r.ok && <span className="tag">{r.error ?? 'failed'}</span>}</>,
                    tags: <span className="tag">{r.client}</span>,
                    value: relativeTime(Date.parse(r.at)),
                    note: r.durationMs === null ? undefined : `${r.durationMs}ms`,
                  }))} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
