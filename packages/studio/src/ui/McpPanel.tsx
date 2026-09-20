import { useState } from 'react';
import { Panel } from './bits';
import { Collapsible } from './Collapsible';
import { MCP_CLIENTS, MODE_LABEL, useMcpConsole } from '../cloud/useMcpConsole';
import { relativeTime } from '../kit';
import type { McpMode } from '../cloud/api';

/**
 * The MCP tab: connect an AI app to Blooby, then watch it work.
 *
 * The link is the whole setup, so it is the first and largest thing here; everything else —
 * which app wants it where, who is connected, tokens — folds away underneath. Written for
 * someone who has never heard of MCP.
 */

export function CopyButton({ text, label = 'Copy', className = 'btn sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className={className} disabled={!text} onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); });
    }}>{done ? 'Copied' : label}</button>
  );
}

export function McpPanel({ projectId }: { projectId?: string | null }) {
  const c = useMcpConsole(projectId);
  const [tokenName, setTokenName] = useState('');
  const [tokenMode, setTokenMode] = useState<McpMode>('full');

  if (c.signedOut) {
    return (
      <Panel title="AI apps">
        <p className="hint">Sign in to let Claude, ChatGPT or Cursor animate with you. They use the same tools as this editor, and every change they make is undoable.</p>
      </Panel>
    );
  }

  return (
    <>
      <Panel title="AI apps">
        {c.agents.length > 0
          ? <p className="mcp-status" data-live="true" role="status">{c.agents.map((a) => a.client).join(', ')} working on this project</p>
          : <p className="mcp-status">{c.data?.connections.length ? `${c.data.connections.length} app${c.data.connections.length === 1 ? '' : 's'} connected` : 'No app connected yet'}</p>}

        <label className="prop-label" htmlFor="mcp-link">Your MCP link</label>
        <div className="mcp-link-row" data-tour="mcp-link">
          <input id="mcp-link" className="txt mono" readOnly value={c.url} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={c.url} label="Copy" />
        </div>
        <p className="hint">Paste it into your AI app as a connector. It opens a Blooby page where you choose what it may do — approve, and it can start animating.</p>
        {c.error && <p className="hint mcp-bad">{c.error}</p>}
        {c.url.includes('localhost') && (
          <p className="hint">On localhost, apps on this computer (Claude Code, Claude Desktop, Cursor) can reach it. Claude.ai and ChatGPT need Blooby on a public address.</p>
        )}

        {c.pending.length > 0 && (
          <div className="mcp-approvals" data-tour="mcp-approvals">
            <span className="prop-label">Waiting for you</span>
            {c.pending.map((p) => (
              <div key={p.id} className="mcp-approval">
                <span className="mcp-approval-what"><strong>{p.client}</strong> wants to {p.summary.toLowerCase()}</span>
                <span className="row">
                  <button className="btn sm" disabled={c.busy} onClick={() => void c.decide(p.id, false)}>Reject</button>
                  <button className="btn sm primary" disabled={c.busy} onClick={() => void c.decide(p.id, true)}>Approve</button>
                </span>
              </div>
            ))}
          </div>
        )}

        <Collapsible title="Where to paste it" storageKey="mcp-clients" defaultOpen={false}>
          <ul className="mcp-clients" data-tour="mcp-clients">
            {MCP_CLIENTS.map((client) => (
              <li key={client.id}>
                <span className="mcp-client-name">{client.label}</span>
                <span className="hint">{client.where}</span>
                {client.code(c.url) !== c.url && (
                  <span className="mcp-link-row">
                    <code className="mcp-code">{client.code(c.url)}</code>
                    <CopyButton text={client.code(c.url)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">Your AI app asks before it uses a tool the first time — choose “always allow” there to stop the prompts. Blooby only asks when a connection is set to “Ask me first”.</p>
        </Collapsible>
      </Panel>

      {!!c.project?.activity.length && (
        <Panel title="Activity">
          <ol className="mcp-feed">
            {c.project.activity.slice(0, 20).map((a, i) => (
              <li key={i} data-ok={a.ok} title={a.error ?? a.capability}>
                <span className="mcp-feed-what">{a.summary || a.capability}</span>
                <time>{relativeTime(Date.parse(a.at))}</time>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Connected apps">
        {!c.data?.connections.length && <p className="hint">Nothing connected. Paste the link above into an AI app to start.</p>}
        <ul className="mcp-list">
          {c.data?.connections.map((a) => (
            <li key={a.grantId}>
              <span className="mcp-list-main">
                <span className="mcp-list-name">{a.clientName}</span>
                <span className="hint">{MODE_LABEL[a.mode]} · {a.lastUsedAt ? `used ${relativeTime(Date.parse(a.lastUsedAt))}` : 'not used yet'}</span>
              </span>
              <button className="btn sm" disabled={c.busy} onClick={() => void c.disconnect(a.grantId)}>Disconnect</button>
            </li>
          ))}
        </ul>
      </Panel>

      <Collapsible title="Personal tokens" storageKey="mcp-tokens" defaultOpen={false}>
        <p className="hint">For scripts and apps that cannot sign in. Shown once — store it like a password.</p>
        {c.secret && (
          <div className="mcp-secret" role="alert">
            <span className="prop-label">{c.secret.name} — copy it now</span>
            <span className="mcp-link-row">
              <code className="mcp-code">{c.secret.token}</code>
              <CopyButton text={c.secret.token} />
            </span>
            <button className="btn sm" onClick={() => c.setSecret(null)}>Done</button>
          </div>
        )}
        <div className="row">
          <input className="txt" placeholder="What is it for?" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
        </div>
        <div className="row">
          <div className="seg">
            {(['full', 'suggest', 'read_only'] as McpMode[]).map((m) => (
              <button key={m} aria-pressed={tokenMode === m} title={c.data?.modes[m]} onClick={() => setTokenMode(m)}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn sm" disabled={c.busy || !tokenName.trim()}
            onClick={() => void c.createToken(tokenName.trim(), tokenMode).then(() => setTokenName(''))}>Create token</button>
        </div>
        <ul className="mcp-list">
          {c.data?.tokens.map((t) => (
            <li key={t.id}>
              <span className="mcp-list-main">
                <span className="mcp-list-name">{t.name}</span>
                <span className="hint">{MODE_LABEL[t.mode]} · {t.lastUsedAt ? `used ${relativeTime(Date.parse(t.lastUsedAt))}` : 'not used yet'}</span>
              </span>
              <button className="btn ghost sm" disabled={c.busy} title="New secret, same permissions" onClick={() => void c.rotateToken(t.id)}>Rotate</button>
              <button className="btn ghost sm" disabled={c.busy} onClick={() => void c.revokeToken(t.id)}>Revoke</button>
            </li>
          ))}
        </ul>
        {c.problem && <p className="hint mcp-bad" role="alert">{c.problem}</p>}
      </Collapsible>
    </>
  );
}
