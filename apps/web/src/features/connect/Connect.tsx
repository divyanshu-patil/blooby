import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Avatar, BloobyMark, mcpApi, useAsync, type McpMode, type SessionUser } from '@blooby/studio';
import { AuthScreen } from '../auth/AuthScreen';

/** Survives the Google sign-in round trip, which returns to the site root. */
export const PENDING_CONNECT = 'blooby.connect';

/**
 * The page an AI app sends you to when you add Blooby to it (OAuth's authorize step).
 * Sign in if needed, see which app is asking and for what, choose how much it may do,
 * approve — and you are back in the app, connected.
 */
export function Connect({ user }: { user: SessionUser | null }) {
  const [params] = useSearchParams();
  const request = params.get('request') ?? '';

  useEffect(() => {
    if (!request) return;
    try { if (user) sessionStorage.removeItem(PENDING_CONNECT); else sessionStorage.setItem(PENDING_CONNECT, request); } catch { /* private mode: the email sign-in still returns here */ }
  }, [request, user]);

  if (!user) return <AuthScreen />;
  return <Consent request={request} user={user} />;
}

const MODE_LABEL: Record<McpMode, string> = { full: 'Full control', suggest: 'Ask me first', read_only: 'Look only' };

function Consent({ request, user }: { request: string; user: SessionUser }) {
  const { data, error } = useAsync(() => mcpApi.consent(request), [request]);
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<McpMode>('full');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const chosen = scopes ?? data?.scopes.map((s) => s.scope) ?? [];

  const decide = async (approve: boolean) => {
    setBusy(true); setFailed(null);
    try {
      const { redirectTo } = await mcpApi.decide(request, { approve, scopes: chosen, mode });
      window.location.assign(redirectTo);
    } catch (e) { setFailed(e instanceof Error ? e.message : 'That did not work.'); setBusy(false); }
  };

  return (
    <main className="auth connect">
      <div className="auth-inner">
        <div className="auth-brand"><BloobyMark size={28} /><span>blooby</span></div>
        <div className="auth-card">
          {!request && <p className="auth-msg" data-tone="bad">This link is missing its request. Start connecting again from your AI app.</p>}
          {error && <p className="auth-msg" data-tone="bad" role="alert">{error}</p>}
          {data && (
            <>
              <h1 className="auth-title">Connect {data.clientName}</h1>
              <p className="auth-sub">It will work in Blooby as you. Disconnect it any time from AI apps.</p>

              <fieldset className="consent-group">
                <legend>{data.clientName} may</legend>
                <div className="consent-scopes">
                  {data.scopes.map((s) => (
                    <label key={s.scope} className="consent-scope">
                      <input type="checkbox" checked={chosen.includes(s.scope)}
                        onChange={(e) => setScopes(e.target.checked ? [...chosen, s.scope] : chosen.filter((x) => x !== s.scope))} />
                      <span>{s.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="consent-group">
                <legend>How much control</legend>
                <div className="consent-modes">
                  {(['full', 'suggest', 'read_only'] as McpMode[]).map((m) => (
                    <label key={m} className="consent-mode" data-on={mode === m}>
                      <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                      <span>{MODE_LABEL[m]}</span>
                    </label>
                  ))}
                </div>
                <p className="consent-sub">{data.modes[mode]}</p>
              </fieldset>

              <p className="consent-who">
                <Avatar name={user.name ?? user.email} url={user.avatarUrl} size={20} />
                <span>{user.name ?? user.email} · returns to <strong>{data.redirectHost}</strong></span>
              </p>

              <div className="consent-actions">
                <button className="consent-deny" disabled={busy} onClick={() => void decide(false)}>Deny</button>
                <button className="auth-submit" disabled={busy || !chosen.length} onClick={() => void decide(true)}>
                  {busy ? 'Connecting…' : `Allow ${data.clientName}`}
                </button>
              </div>
              {failed && <p className="auth-msg" data-tone="bad" role="alert">{failed}</p>}
            </>
          )}
          {!data && !error && request && <p className="auth-sub">Loading…</p>}
        </div>
        <p className="auth-switch">{data?.clientName ?? 'The app'} never gets your password — only its own key, limited to what you allow.</p>
      </div>
    </main>
  );
}
