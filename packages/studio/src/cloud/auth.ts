import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../core/catalog';
import { api } from './client';
import type { SessionUser } from './types';

/**
 * Auth state for both apps.
 *
 * The Supabase session proves who you are; the ROLE comes from the server, which reads
 * it from the database. A client that decoded its own token to decide "am I an admin"
 * would be trusting a value the user can influence — and the API would reject it anyway.
 */
/**
 * The OAuth error, captured at module load.
 *
 * This has to happen before anything renders: the route guard redirects to /login with
 * `replace`, which drops the query string, so by the time the sign-in screen mounts the
 * explanation is already gone. Reading it at import time is the only point where it is
 * reliably still there.
 */
const capturedAuthError: string | null = (() => {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = q.get('error') ?? h.get('error');
  if (!code) return null;
  const detail = (q.get('error_description') ?? h.get('error_description'))?.replace(/\+/g, ' ');
  return detail || (code === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed (${code}).`);
})();

/** Read it once — a second call returns null, so it does not reappear on every render. */
let authErrorRead = false;
export function consumeAuthError(): string | null {
  if (authErrorRead) return null;
  authErrorRead = true;
  return capturedAuthError;
}

/**
 * Is the browser mid-OAuth-callback?
 *
 * Supabase hands the result back in the URL — `?code=` under PKCE (the default), or a
 * `#access_token=` fragment on the implicit flow — and supabase-js consumes it
 * asynchronously after the client is constructed. Until that finishes, getSession()
 * legitimately answers null.
 *
 * This matters because a route guard that redirects on that null REWRITES the URL and
 * destroys the code before it can be exchanged, so the sign-in can never complete. The
 * app has to wait rather than decide.
 */
function oauthCallbackInFlight(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);

  // An `error` param is a FINISHED failure, not work in progress — waiting on it would
  // just stall the app before showing the sign-in screen that explains what went wrong.
  if (params.has('error') || hash.includes('error=')) return false;

  return params.has('code') || hash.includes('access_token=');
}

/** Strip the callback params once consumed, so a refresh does not replay a spent code. */
function clearCallbackParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  ['code', 'error', 'error_description', 'state'].forEach((k) => url.searchParams.delete(k));
  const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
  window.history.replaceState({}, '', clean);
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }

    let live = true;
    // hold the whole app on "loading" until the exchange resolves — see above
    let pending = oauthCallbackInFlight();

    const resolve = async (s: Session | null, force = false) => {
      if (!live) return;
      setSession(s);

      // an initial null while a callback is still in flight is not "signed out", it is
      // "not known yet"; reporting ready here is what lets the guard eat the code
      if (!s && pending && !force) return;

      if (!s) { setUser(null); setReady(true); return; }
      try {
        const res = await api.get<{ user: SessionUser | null }>('/api/auth/session');
        if (live) setUser(res.user);
      } catch {
        if (live) setUser(null);
      } finally {
        if (live) setReady(true);
      }
    };

    void supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (s || event === 'SIGNED_OUT') { pending = false; }
      if (event === 'SIGNED_IN') {
        clearCallbackParams();
        // record the sign-in so "active users" in analytics means something
        void api.post('/api/auth/login-event').catch(() => {});
      }
      void resolve(s);
    });

    // A callback that never resolves — a denied consent screen, a spent code, a provider
    // that is not configured — must not leave the app spinning forever.
    const giveUp = pending
      ? setTimeout(() => { pending = false; clearCallbackParams(); void supabase!.auth.getSession().then(({ data }) => resolve(data.session, true)); }, 8000)
      : undefined;

    return () => { live = false; clearTimeout(giveUp); sub.subscription.unsubscribe(); };
  }, []);

  return { session, user, ready, isAdmin: user?.role === 'admin' };
}

export const auth = {
  signInWithGoogle: () =>
    supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }),
  signInWithPassword: (email: string, password: string) =>
    supabase!.auth.signInWithPassword({ email, password }),
  signUp: (email: string, password: string) =>
    supabase!.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }),
  resetPassword: (email: string) =>
    supabase!.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}#reset` }),
  updatePassword: (password: string) => supabase!.auth.updateUser({ password }),
  signOut: () => supabase!.auth.signOut(),
};
