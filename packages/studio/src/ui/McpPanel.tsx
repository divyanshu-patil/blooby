import { useEffect, useState } from 'react';
import { Panel } from './bits';
import { useMcpLive } from '../cloud/useMcpLive';
import { mcpApi, type McpMode, type McpOverview } from '../cloud/api';
import { ApiError } from '../cloud/client';
import { relativeTime } from '../kit';

/**
 * Connect an AI app (Claude, ChatGPT, Cursor, Claude Code…) to Blooby, and watch it work.
 *
 * Written for someone who has never heard of MCP: pick your app, follow its three steps,
 * approve on the Blooby page it opens. Everything an AI did shows up here as it happens,
 * and in "ask me first" mode its changes wait here for approval.
 */

type ClientId = 'claude' | 'chatgpt' | 'claudeCode' | 'cursor' | 'other';
const CLIENTS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' }, { id: 'claudeCode', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' }, { id: 'other', label: 'Other' },
];

function steps(id: ClientId, url: string): { text: string; code?: string }[] {
  switch (id) {
    case 'claude': return [
      { text: 'In Claude (web or desktop) open Settings → Connectors → Add custom connector.' },
      { text: 'Name it Blooby and paste this URL:', code: url },
      { text: 'Click Connect. A Blooby page opens — choose what Claude may do and approve. Then ask Claude to animate something.' },
    ];
    case 'chatgpt': return [
      { text: 'In ChatGPT open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.' },
      { text: 'Create a connector named Blooby with this URL and OAuth authentication:', code: url },
      { text: 'Approve on the Blooby page that opens, then pick Blooby in a chat\'s tools.' },
    ];
    case 'claudeCode': return [
      { text: 'In a terminal:', code: `claude mcp add --transport http blooby ${url}` },
      { text: 'In Claude Code run /mcp, choose blooby and Authenticate — approve on the Blooby page.' },
      { text: 'Want every capability as its own tool instead of the compact set? Use this URL:', code: `${url}?tools=full` },
    ];
    case 'cursor': return [
      { text: 'Add this to ~/.cursor/mcp.json (or the project\'s .cursor/mcp.json):', code: JSON.stringify({ mcpServers: { blooby: { url } } }, null, 2) },
      { text: 'Cursor shows "Needs login" next to blooby — click it and approve on the Blooby page.' },
    ];
    default: return [
      { text: 'Any MCP client that speaks Streamable HTTP with OAuth connects with just the URL:', code: url },
      { text: 'For scripts and clients without OAuth, create a personal token below and send it as a header:', code: 'Authorization: Bearer blb_pat_…' },
      { text: 'Clients that only speak stdio can bridge with mcp-remote:', code: `npx mcp-remote ${url} --header "Authorization: Bearer $BLOOBY_TOKEN"` },
    ];
  }
}

const MODE_LABEL: Record<McpMode, string> = { read_only: 'Look only', suggest: 'Ask me first', full: 'Full control' };

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function McpPanel({ projectId }: { projectId?: string | null }) {
  const [data, setData] = useState<McpOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    let live = true;
    mcpApi.overview().then(
      (d) => { if (live) { setData(d); setError(null); } },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) setSignedOut(true);
        else setError(e instanceof Error ? e.message : 'Could not reach the Blooby server.');
      },
    );
    return () => { live = false; };
  }, [nonce]);
  const { live, project, refresh } = useMcpLive(projectId, !signedOut && !error);
  if (signedOut) {
    return (
      <Panel title="AI apps">
        <p className="hint">Sign in to connect Claude, ChatGPT, Cursor and other AI apps to your projects. They use the same tools as this editor — and every change they make is undoable.</p>
      </Panel>
    );
  }
  return <Connected data={data} error={error} reload={reload} live={live} project={project} refresh={refresh} />;
}

function Connected({ data, error, reload, live, project, refresh }: {
  data: McpOverview | null; error: string | null; reload: () => void; refresh: () => Promise<unknown> | void;
} & Pick<ReturnType<typeof useMcpLive>, 'live' | 'project'>) {
  const [client, setClient] = useState<ClientId>('claude');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenMode, setTokenMode] = useState<McpMode>('full');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    try { await fn(); reload(); void refresh(); } catch (e) { setProblem(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(false); }
  };
  const url = data?.serverUrl ?? '';
  const pending = (live?.proposals ?? []).filter((p) => p.status === 'pending');
  const agents = project?.agents ?? [];

  return (
    <>
      <Panel title="AI apps">
        <p className="hint">
          Let Claude, ChatGPT, Cursor or any MCP app open, animate, render and export your projects — with the same
          {data ? ` ${data.capabilityCount}` : ''} tools this editor uses. You approve each app and what it may do.
        </p>

        {agents.length > 0 && (
          <p className="hint working" role="status">{agents.map((a) => a.client).join(', ')} {agents.length === 1 ? 'is' : 'are'} working on this project…</p>
        )}
        {project?.saveError && <p className="hint" style={{ color: 'var(--hot)' }}>The AI's last save failed: {project.saveError}</p>}

        {pending.length > 0 && (
          <div className="keypool" data-tour="mcp-approvals">
            <span className="prop-label">Waiting for your approval</span>
            {pending.map((p) => (
              <div key={p.id} className="keyrow" style={{ fontFamily: 'var(--ui)' }}>
                <span style={{ flex: 1 }}><strong>{p.client}</strong>: {p.summary}</span>
                <button className="btn sm" disabled={busy} onClick={() => void act(() => mcpApi.decideProposal(p.id, false))}>Reject</button>
                <button className="btn sm primary" disabled={busy} onClick={() => void act(() => mcpApi.decideProposal(p.id, true))}>Approve</button>
              </div>
            ))}
          </div>
        )}

        <span className="prop-label">Your Blooby MCP link</span>
        <div className="row" data-tour="mcp-link">
          <pre className="mcp-code mcp-link">{url || 'Loading…'}</pre>
          {url && <Copy text={url} label="Copy link" />}
        </div>
        <ol className="mcp-steps">
          <li><span className="hint">Paste it into your AI app as a connector — in Claude: Settings → Connectors → Add custom connector.</span></li>
          <li><span className="hint">The app opens a Blooby page. Approve it (you choose what it may do).</span></li>
          <li><span className="hint">That&rsquo;s it — ask it to animate, and watch the changes land here.</span></li>
        </ol>
        {error && <p className="hint" style={{ color: 'var(--hot)' }}>{error}</p>}
        {url.includes('localhost') && (
          <p className="hint">This server runs on localhost: Claude Code, Claude Desktop and Cursor on this computer can use it; Claude.ai and ChatGPT need it on a public https address (docs/mcp/client-setup.md).</p>
        )}

        <details className="mcp-more">
          <summary className="hint">More ways to connect (ChatGPT, Claude Code, Cursor, scripts)</summary>
          <div className="seg" data-tour="mcp-clients">
            {CLIENTS.map((c) => <button key={c.id} aria-pressed={client === c.id} onClick={() => setClient(c.id)}>{c.label}</button>)}
          </div>
          {url && (
            <ol className="mcp-steps">
              {steps(client, url).map((st, i) => (
                <li key={i}>
                  <span className="hint">{st.text}</span>
                  {st.code && (
                    <div className="row">
                      <pre className="mcp-code">{st.code}</pre>
                      <Copy text={st.code} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </details>
      </Panel>

      {project && project.activity.length > 0 && (
        <Panel title="What the AI did here">
          <div className="keypool">
            {project.activity.slice(0, 20).map((a, i) => (
              <div key={i} className="keyrow" title={a.error ?? a.capability}>
                <span className={`dot-status ${a.ok ? 'ok' : 'error'}`} />
                <span style={{ flex: 1, fontFamily: 'var(--ui)' }}>{a.summary || a.capability}</span>
                <span className="tag">{relativeTime(Date.parse(a.at))}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Connected apps">
        {data && !data.connections.length && <p className="hint">No apps connected yet.</p>}
        <div className="keypool">
          {data?.connections.map((c) => (
            <div key={c.grantId} className="keyrow" style={{ fontFamily: 'var(--ui)' }}>
              <span style={{ flex: 1 }}>{c.clientName}</span>
              <span className="tag" title={c.scopes.join(', ')}>{MODE_LABEL[c.mode]}</span>
              <span className="tag">{c.lastUsedAt ? relativeTime(Date.parse(c.lastUsedAt)) : 'unused'}</span>
              <button className="btn ghost sm" disabled={busy} onClick={() => void act(() => mcpApi.disconnect(c.grantId))}>Disconnect</button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Personal tokens">
        <p className="hint">For scripts and apps without a sign-in button. A token is shown once — store it like a password. Anyone holding it can act as you, within what you allow.</p>
        {newToken && (
          <div className="keypool" role="alert">
            <span className="prop-label">{newToken.name} — copy it now, it will not be shown again</span>
            <div className="row">
              <pre className="mcp-code">{newToken.token}</pre>
              <Copy text={newToken.token} />
            </div>
            <button className="btn ghost sm" onClick={() => setNewToken(null)}>I have stored it</button>
          </div>
        )}
        <div className="row">
          <input className="txt" placeholder="Token name, e.g. My laptop" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
        </div>
        <div className="row">
          <div className="seg">
            {(['read_only', 'suggest', 'full'] as McpMode[]).map((m) => (
              <button key={m} aria-pressed={tokenMode === m} title={data?.modes[m]} onClick={() => setTokenMode(m)}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn sm" disabled={busy || !tokenName.trim()} onClick={() => void act(async () => {
            const r = await mcpApi.createToken({ name: tokenName.trim(), mode: tokenMode });
            setNewToken({ name: r.meta.name, token: r.token });
            setTokenName('');
          })}>Create token</button>
        </div>
        {data && <p className="hint">{data.modes[tokenMode]}</p>}
        <div className="keypool">
          {data?.tokens.map((t) => (
            <div key={t.id} className="keyrow" style={{ fontFamily: 'var(--ui)' }}>
              <span style={{ flex: 1 }}>{t.name}</span>
              <span className="tag">{MODE_LABEL[t.mode]}</span>
              <span className="tag">{t.lastUsedAt ? relativeTime(Date.parse(t.lastUsedAt)) : 'unused'}</span>
              <button className="btn ghost sm" disabled={busy} title="New secret, same permissions; the old one stops working" onClick={() => void act(async () => {
                const r = await mcpApi.rotateToken(t.id);
                setNewToken({ name: r.meta.name, token: r.token });
              })}>Rotate</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => void act(() => mcpApi.revokeToken(t.id))}>Revoke</button>
            </div>
          ))}
        </div>
        {problem && <p className="hint" style={{ color: 'var(--hot)' }} role="alert">{problem}</p>}
      </Panel>

      {data && data.recent.length > 0 && (
        <Panel title="Recent AI activity">
          <div className="keypool">
            {data.recent.slice(0, 25).map((r) => (
              <div key={String(r.id)} className="keyrow">
                <span className={`dot-status ${r.ok ? 'ok' : 'error'}`} />
                <span style={{ flex: 1 }}>{r.operation}</span>
                {r.errorCode && <span className="tag">{r.errorCode}</span>}
                <span className="tag">{relativeTime(Date.parse(r.createdAt))}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
