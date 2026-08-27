import { useState } from 'react';
import { auth } from '@blooby/studio';

type Mode = 'signin' | 'signup' | 'forgot';

/**
 * One screen, three modes. Deliberately small: an email, a password, and Google — the
 * spec's own instruction not to greet someone with a registration form. Everything else
 * about a person (username, avatar) is filled in from OAuth or edited later.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: '0 0 16px' }}>
          <span className="brand-dot" />
          <span className="brand-word">blooby</span>
        </div>

        <h1 className="auth-title">
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create an account' : 'Reset your password'}
        </h1>
        <p className="auth-sub">
          {mode === 'forgot'
            ? 'We’ll email you a link to set a new one.'
            : 'Animate a mascot, save it to the cloud, and share what you build.'}
        </p>

        <button className="btn google" onClick={() => void auth.signInWithGoogle()} disabled={busy}>
          Continue with Google
        </button>

        <div className="auth-or"><span>or</span></div>

        <form onSubmit={submit}>
          <div className="field-row">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          {mode !== 'forgot' && (
            <div className="field-row">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}

          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        {error && <p className="auth-msg" data-tone="bad">{error}</p>}
        {note && <p className="auth-msg">{note}</p>}

        <div className="auth-switch">
          {mode === 'signin' && <>
            <button onClick={() => setMode('signup')}>Create an account</button>
            <button onClick={() => setMode('forgot')}>Forgot password?</button>
          </>}
          {mode !== 'signin' && <button onClick={() => setMode('signin')}>Back to sign in</button>}
        </div>
      </div>
    </main>
  );
}
