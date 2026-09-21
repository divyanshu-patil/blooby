import { useEffect, useState } from 'react';
import { BloobyMark, GoogleMark, auth, consumeAuthError } from '@blooby/studio';

type Mode = 'signin' | 'signup' | 'forgot';

const COPY: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin: { title: 'Sign in', sub: 'Pick up where you left off.', cta: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Animate a mascot, save it to the cloud, share what you build.', cta: 'Create account' },
  forgot: { title: 'Reset your password', sub: 'We’ll email you a link to set a new one.', cta: 'Send reset link' },
};

/**
 * One screen, three modes. Deliberately small — an email, a password, and Google. Asking
 * for a name or a username here would be a form standing between someone and the product
 * for data we can fill in from OAuth or collect later.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // A failed OAuth round-trip is captured at module load, before the route guard
  // redirects here and drops the query string that explained it.
  useEffect(() => { const e = consumeAuthError(); if (e) setError(e); }, []);

  const go = (next: Mode) => { setMode(next); setError(null); setNote(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNote(null);
    try {
      if (mode === 'forgot') {
        const { error } = await auth.resetPassword(email);
        if (error) throw new Error(error.message);
        setNote('Check your email for a reset link.');
      } else if (mode === 'signup') {
        const { error } = await auth.signUp(email, password);
        if (error) throw new Error(error.message);
        setNote('Check your email to confirm your account.');
      } else {
        const { error } = await auth.signInWithPassword(email, password);
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];

  return (
    <main className="auth">
      <div className="auth-inner">
        <div className="auth-brand">
          <BloobyMark size={28} />
          <span>blooby</span>
        </div>

        <div className="auth-card">
          <h1 className="auth-title">{copy.title}</h1>
          <p className="auth-sub">{copy.sub}</p>

          <button className="auth-oauth" onClick={() => void auth.signInWithGoogle()} disabled={busy}>
            <GoogleMark />
            Continue with Google
          </button>

          <div className="auth-or"><span>or</span></div>

          <form onSubmit={submit}>
            <div className="field-row">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            {mode !== 'forgot' && (
              <div className="field-row">
                <div className="label-row">
                  <label htmlFor="password">Password</label>
                  {mode === 'signin' && (
                    <button type="button" className="link-sm" onClick={() => go('forgot')}>Forgot?</button>
                  )}
                </div>
                <input id="password" type="password" required minLength={8} placeholder="At least 8 characters"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Working…' : copy.cta}
            </button>
          </form>

          {/* errors say what happened and what to do; they never apologise or go vague */}
          {error && <p className="auth-msg" data-tone="bad" role="alert">{error}</p>}
          {note && <p className="auth-msg" role="status">{note}</p>}
        </div>

        <p className="auth-switch">
          {mode === 'signin' && <>New here? <button onClick={() => go('signup')}>Create an account</button></>}
          {mode === 'signup' && <>Already have an account? <button onClick={() => go('signin')}>Sign in</button></>}
          {mode === 'forgot' && <button onClick={() => go('signin')}>Back to sign in</button>}
        </p>
      </div>
    </main>
  );
}
