import { useState } from 'react';
import {
  EmptyState, ErrorState, PageHeader, adminApi, relativeTime, useAsync,
} from '@blooby/studio';

/**
 * The copilot's key pool, and the switch that decides whose keys get used.
 *
 * A key is write-only from here: it is posted once and comes back as a hint. There is no
 * read path on the server that selects `secret`, so no amount of poking at this screen
 * can recover a key that was pasted into it — including for the admin who pasted it.
 */
export function Copilot() {
  const { data, error, loading, reload } = useAsync(() => adminApi.copilot(), []);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try { await fn(); reload(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  };

  const add = () => run(async () => {
    await adminApi.addCopilotKey(key.trim(), label.trim());
    setKey('');
    setLabel('');
  });

  return (
    <>
      <PageHeader title="Copilot" subtitle="Ollama Cloud keys, and who is allowed to use their own." />

      <div className="page-body">
        {loading && <div className="skeleton" style={{ height: 240 }} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {problem && <p className="setting-alert">{problem}</p>}

        {data && !loading && (
          <>
            <section className="setting-card">
              <div className="setting-row">
                <div style={{ flex: 1 }}>
                  <strong>Let users bring their own keys</strong>
                  <p className="hint">
                    {data.allowUserKeys
                      ? 'On — the editor shows a key field, and a user who adds keys has their own used instead of this pool.'
                      : 'Off — the key field is hidden and every request uses the keys below. Keys sent by a client anyway are ignored by the server, not just hidden.'}
                  </p>
                </div>
                <button className="btn" disabled={busy} aria-pressed={data.allowUserKeys}
                  onClick={() => run(() => adminApi.setCopilotSettings(!data.allowUserKeys))}>
                  {data.allowUserKeys ? 'On' : 'Off'}
                </button>
              </div>
            </section>

            {!data.keys.length && !data.allowUserKeys && (
              <p className="setting-alert">
                User keys are off and this server has none — the copilot cannot reach Ollama Cloud for anyone.
                Add a key below, or turn user keys back on.
              </p>
            )}

            <section className="setting-card">
              <strong>Server keys</strong>
              <p className="hint">
                Tried in order: healthy first, then rate-limited, then failed, and within each group whichever
                rested longest. A request sweeps the whole pool twice before giving up, so one dead key costs
                nothing. Add as many as you like.
              </p>

              <div className="setting-row">
                <input className="txt" type="password" placeholder="Paste an Ollama Cloud API key"
                  value={key} onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) add(); }} />
                <input className="txt" style={{ maxWidth: 180 }} placeholder="Label (optional)"
                  value={label} onChange={(e) => setLabel(e.target.value)} />
                <button className="btn primary" disabled={busy || key.trim().length < 8} onClick={add}>Add key</button>
              </div>
              <p className="hint">Once added, a key can never be read back — only replaced.</p>

              {data.keys.length === 0 ? (
                <EmptyState title="No server keys" note="Users must supply their own until you add one." />
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Key</th><th>Label</th><th>Status</th><th>Last used</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.keys.map((k) => (
                      <tr key={k.id}>
                        <td><code>{k.hint}</code></td>
                        <td>{k.label || <span className="dim">—</span>}</td>
                        <td>
                          <span className={`dot-status ${k.status === 'rate-limited' ? 'rate' : k.status}`} />
                          {k.note ? `${k.status} · ${k.note}` : k.status}
                        </td>
                        <td>{k.lastUsedAt ? relativeTime(Date.parse(k.lastUsedAt)) : <span className="dim">never</span>}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn ghost sm" disabled={busy}
                            onClick={() => run(() => adminApi.removeCopilotKey(k.id))}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
