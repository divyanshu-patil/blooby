import { useState } from 'react';
import { BloobyMark, auth } from '@blooby/studio';

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

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
    <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.5 2.7-3.8 2.7-6.6Z" />
    <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
    <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
  </svg>
);
