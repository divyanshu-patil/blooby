import { useState } from 'react';
import {
  CopyButton, MCP_CLIENTS, MODE_LABEL, PageHeader, relativeTime, useMcpConsole, type McpMode,
} from '@blooby/studio';

/**
 * AI apps — the page where someone hands Claude, ChatGPT or Cursor the keys to their projects.
 *
 * One thing to copy, three steps to follow, and then the honest state of it: who is connected,
 * what they did, and how to take it back. The link is the hero because the link IS the setup.
 */

const STEPS = [
  { title: 'Copy the link', body: 'It points at your Blooby account. It holds no password — the app gets its own key when you approve it.' },
  { title: 'Paste it into your AI app', body: 'In Claude: Settings → Connectors → Add custom connector. Other apps are listed below.' },
  { title: 'Approve, then ask for animation', body: '“Make Blooby jump in and wave.” It works in your projects, and you can undo anything it does.' },
];

export function AiClients() {
  const c = useMcpConsole();
  const [tokenName, setTokenName] = useState('');
  const [tokenMode, setTokenMode] = useState<McpMode>('full');

  if (c.signedOut) {
    return (
      <>
        <PageHeader title="AI apps" />
        <div className="page-body"><p className="ai-lede">Sign in to connect an AI app to your projects.</p></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="AI apps" subtitle="Let Claude, ChatGPT or Cursor animate in your projects." />

      <div className="page-body ai-page">
        <section className="ai-connect">
          <div className="ai-connect-main">
            <h2 className="ai-h">Your MCP link</h2>
            <div className="ai-link">
              <input readOnly value={c.url} aria-label="Your MCP link" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={c.url} label="Copy link" className="btn primary lg" />
            </div>
            <p className="ai-lede">
              An AI app that has this link can open your projects, animate, render frames and export Lottie —
              using the same tools as the editor. You approve each app, and choose what it may do.
            </p>
            {c.error && <p className="ai-bad" role="alert">{c.error}</p>}
            {c.url.includes('localhost') && (
              <p className="ai-note">
                This Blooby runs on localhost, so apps on this computer (Claude Code, Claude Desktop, Cursor) can
                reach it. Claude.ai and ChatGPT connect from their own servers and need a public address.
              </p>
            )}
          </div>
          <ol className="ai-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="ai-step-n" aria-hidden>{i + 1}</span>
                <span className="ai-step-title">{s.title}</span>
                <span className="ai-step-body">{s.body}</span>
              </li>
            ))}
          </ol>
        </section>

        {c.pending.length > 0 && (
          <section className="ai-section ai-waiting">
            <h2 className="ai-h">Waiting for you</h2>
            <ul className="ai-rows">
              {c.pending.map((p) => (
                <li key={p.id}>
                  <span className="ai-row-main">
                    <span className="ai-row-name">{p.client}</span>
                    <span className="ai-row-sub">wants to {p.summary.toLowerCase()}</span>
                  </span>
                  <button className="btn" disabled={c.busy} onClick={() => void c.decide(p.id, false)}>Reject</button>
                  <button className="btn primary" disabled={c.busy} onClick={() => void c.decide(p.id, true)}>Approve</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="ai-section">
          <h2 className="ai-h">Connected apps</h2>
          {!c.data?.connections.length ? (
            <p className="ai-empty">No app is connected yet. Paste the link above into Claude, ChatGPT or Cursor.</p>
          ) : (
            <ul className="ai-rows">
              {c.data.connections.map((a) => (
                <li key={a.grantId}>
                  <span className="ai-row-main">
                    <span className="ai-row-name">{a.clientName}</span>
                    <span className="ai-row-sub">{MODE_LABEL[a.mode]} · connected {relativeTime(Date.parse(a.connectedAt))} · {a.lastUsedAt ? `last used ${relativeTime(Date.parse(a.lastUsedAt))}` : 'not used yet'}</span>
                  </span>
                  <button className="btn" disabled={c.busy} onClick={() => void c.disconnect(a.grantId)}>Disconnect</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ai-section">
          <h2 className="ai-h">Where to paste the link</h2>
          <ul className="ai-apps">
            {MCP_CLIENTS.map((client) => (
              <li key={client.id}>
                <span className="ai-app-name">{client.label}</span>
                <span className="ai-app-where">{client.where}</span>
                {client.code(c.url) !== c.url && (
                  <span className="ai-app-code">
                    <code>{client.code(c.url)}</code>
                    <CopyButton text={client.code(c.url)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="ai-note">
            Your AI app asks the first time it uses each tool — choose “always allow” there to stop the prompts.
            Blooby only asks you when a connection is set to “Ask me first”.
          </p>
        </section>

        <section className="ai-section">
          <h2 className="ai-h">Personal tokens</h2>
          <p className="ai-lede">For scripts and apps that cannot sign in. A token is shown once — store it like a password.</p>

          {c.secret && (
            <div className="ai-secret" role="alert">
              <span className="ai-row-name">{c.secret.name}</span>
              <span className="ai-app-code"><code>{c.secret.token}</code><CopyButton text={c.secret.token} /></span>
              <span className="ai-row-sub">Copy it now. Blooby keeps only a hash and cannot show it again.</span>
              <button className="btn" onClick={() => c.setSecret(null)}>I have stored it</button>
            </div>
          )}

          <div className="ai-new-token">
            <input placeholder="What is it for? e.g. My laptop" aria-label="Token name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
            <select aria-label="How much it may do" value={tokenMode} onChange={(e) => setTokenMode(e.target.value as McpMode)}>
              {(['full', 'suggest', 'read_only'] as McpMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
            <button className="btn primary" disabled={c.busy || !tokenName.trim()}
              onClick={() => void c.createToken(tokenName.trim(), tokenMode).then(() => setTokenName(''))}>Create token</button>
          </div>
          {c.data && <p className="ai-note">{c.data.modes[tokenMode]}</p>}

          {!!c.data?.tokens.length && (
            <ul className="ai-rows">
              {c.data.tokens.map((t) => (
                <li key={t.id}>
                  <span className="ai-row-main">
                    <span className="ai-row-name">{t.name}</span>
                    <span className="ai-row-sub">{MODE_LABEL[t.mode]} · {t.lastUsedAt ? `last used ${relativeTime(Date.parse(t.lastUsedAt))}` : 'not used yet'}</span>
                  </span>
                  <button className="btn" disabled={c.busy} title="New secret, same permissions — the old one stops working" onClick={() => void c.rotateToken(t.id)}>Rotate</button>
                  <button className="btn" disabled={c.busy} onClick={() => void c.revokeToken(t.id)}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
          {c.problem && <p className="ai-bad" role="alert">{c.problem}</p>}
        </section>

        {!!c.data?.recent.length && (
          <section className="ai-section">
            <h2 className="ai-h">Recent activity</h2>
            <ol className="ai-feed">
              {c.data.recent.slice(0, 20).map((r) => (
                <li key={String(r.id)} data-ok={r.ok}>
                  <span className="ai-feed-op">{r.operation.replace(/_/g, ' ')}</span>
                  {r.errorCode && <span className="ai-feed-err">{r.errorCode.toLowerCase().replace(/_/g, ' ')}</span>}
                  <time>{relativeTime(Date.parse(r.createdAt))}</time>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}
