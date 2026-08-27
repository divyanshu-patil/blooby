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
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }

    let live = true;
    const resolve = async (s: Session | null) => {
      setSession(s);
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
      void resolve(s);
      // record the sign-in so "active users" in analytics means something
      if (event === 'SIGNED_IN') void api.post('/api/auth/login-event').catch(() => {});
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
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
