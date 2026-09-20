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
    <main className="auth">
      <div className="auth-inner">
        <div className="auth-brand"><BloobyMark size={28} /><span>blooby</span></div>
        <div className="auth-card">
          {!request && <p className="auth-msg" data-tone="bad">This link is missing its request. Start connecting again from your AI app.</p>}
          {error && <p className="auth-msg" data-tone="bad" role="alert">{error}</p>}
          {data && (
            <>
              <h1 className="auth-title">Connect {data.clientName}</h1>
              <p className="auth-sub">
                It will work in Blooby as you. Choose what it may do — you can disconnect it at any time from
                AI apps in Blooby.
              </p>

              <fieldset className="consent-group">
                <legend>{data.clientName} may</legend>
                {data.scopes.map((s) => (
                  <label key={s.scope} className="consent-row" data-on={chosen.includes(s.scope)}>
                    <input type="checkbox" checked={chosen.includes(s.scope)}
                      onChange={(e) => setScopes(e.target.checked ? [...chosen, s.scope] : chosen.filter((x) => x !== s.scope))} />
                    <span className="consent-text">{s.description}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="consent-group">
                <legend>How much control it has</legend>
                {(['full', 'suggest', 'read_only'] as McpMode[]).map((m) => (
                  <label key={m} className="consent-row" data-on={mode === m}>
                    <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                    <span className="consent-text">
                      <span className="consent-strong">{MODE_LABEL[m]}</span>
                      <span className="consent-sub">{data.modes[m]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <p className="consent-who">
                <Avatar name={user.name ?? user.email} url={user.avatarUrl} size={24} />
                <span>Signed in as {user.name ?? user.email}. Approving returns you to <strong>{data.redirectHost}</strong>.</span>
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
        <p className="auth-switch">Blooby never gives the app your password or your sign-in. It gets its own key, limited to what you allow above.</p>
      </div>
    </main>
  );
}
