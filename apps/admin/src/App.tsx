import { useState } from 'react';
import { EmptyState, Shell, auth, useSession, type NavGroup } from '@blooby/studio';
import { Overview } from './features/Overview';
import { Users } from './features/Users';
import { Projects } from './features/Projects';
import { Moderation } from './features/Moderation';
import { OfficialEditor } from './features/OfficialEditor';
import { Splashscreens } from './features/Splashscreens';

type View = 'overview' | 'users' | 'projects' | 'moderation' | 'official' | 'splash';

const NAV: NavGroup[] = [
  { items: [{ id: 'overview', label: 'Dashboard', glyph: '▤' }] },
  { title: 'People', items: [
    { id: 'users', label: 'Users', glyph: '◍' },
    { id: 'projects', label: 'Projects', glyph: '◳' },
  ] },
  { title: 'Content', items: [
    { id: 'moderation', label: 'Community', glyph: '◈' },
    { id: 'official', label: 'Official', glyph: '✦' },
    { id: 'splash', label: 'Splashscreen', glyph: '◐' },
  ] },
];

export function App() {
  const { user, ready, isAdmin } = useSession();
  const [view, setView] = useState<View>('overview');

  if (!ready) return <main className="auth"><p className="state-note">Loading…</p></main>;

  if (!user) {
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="brand" style={{ padding: '0 0 16px' }}>
            <span className="brand-dot" />
            <span className="brand-word">blooby admin</span>
          </div>
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">This area is restricted to administrators.</p>
          <button className="btn google" onClick={() => void auth.signInWithGoogle()}>Continue with Google</button>
        </div>
      </main>
    );
  }

  // The API rejects every /api/admin/* call from a non-admin regardless of what renders
  // here — this only avoids showing a panel whose every request would 403.
  if (!isAdmin) {
    return (
      <main className="auth">
        <EmptyState
          title="You don’t have access"
          note="This area is restricted to administrators. If that seems wrong, ask an existing admin to grant you access."
          action={<button className="btn" onClick={() => void auth.signOut()}>Sign out</button>}
        />
      </main>
    );
  }

  return (
    <Shell nav={NAV} active={view} onNavigate={(id) => setView(id as View)}
      footer={
        <div className="who">
          <span className="who-name">{user.email ?? 'Admin'}</span>
          <button className="btn ghost sm" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      }>
      {view === 'overview' && <Overview onGoTo={(v) => setView(v === 'moderation' ? 'moderation' : 'overview')} />}
      {view === 'users' && <Users />}
      {view === 'projects' && <Projects />}
      {view === 'moderation' && <Moderation />}
      {view === 'official' && <OfficialEditor />}
      {view === 'splash' && <Splashscreens />}
    </Shell>
  );
}
