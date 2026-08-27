import { useEffect, useState } from 'react';
import { BloobyMark, EmptyState, Shell, auth, startTour, startTourWhenReady, useSession, type DriveStep, type NavGroup } from '@blooby/studio';
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

const ADMIN_TOUR: DriveStep[] = [
  { popover: { title: 'The admin panel', description: 'A short tour of what you can do here. Skip it with Escape at any time.' } },
  { element: '[data-tour="overview"]', popover: { title: 'Dashboard', description: 'Usage at a glance, with a growth chart and the assets people actually use. When something is waiting for review, a banner appears here linking straight to it.' } },
  { element: '[data-tour="users"]', popover: { title: 'Users', description: 'Every account, with project counts and last activity. Open one to see their stats and grant or revoke admin access.' } },
  { element: '[data-tour="moderation"]', popover: { title: 'Community review', description: 'Submissions from users. Approve to publish, or reject with a reason the creator sees. Nothing is deleted — statuses keep the history.' } },
  { element: '[data-tour="official"]', popover: { title: 'Editor', description: 'The same editor users have. Build an animation, then publish it as official content or save it as a splashscreen.' } },
  { element: '[data-tour="splash"]', popover: { title: 'Splashscreen', description: 'Publish the animation everyone sees when the app opens. Only one is live at a time, and swapping it needs no redeploy.' } },
];

export function App() {
  const { user, ready, isAdmin } = useSession();
  const [view, setView] = useState<View>('overview');
  useEffect(() => { if (isAdmin) startTourWhenReady('admin', ADMIN_TOUR); }, [isAdmin]);

  if (!ready) return <main className="auth"><p className="state-note">Loading…</p></main>;

  if (!user) {
    return (
      <main className="auth">
        <div className="auth-inner">
          <div className="auth-brand"><BloobyMark size={28} /><span>blooby admin</span></div>
          <div className="auth-card">
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-sub">This area is restricted to administrators.</p>
            <button className="auth-oauth" onClick={() => void auth.signInWithGoogle()}>Continue with Google</button>
          </div>
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

  // The editor needs the whole window for a usable preview, so it opts out of the
  // fixed shell and brings its own slide-over navigation instead.
  if (view === 'official') {
    return <OfficialEditor nav={NAV} active={view} onNavigate={(id) => setView(id as View)} />;
  }

  return (
    <Shell nav={NAV} active={view} brand="blooby admin" onNavigate={(id) => setView(id as View)}
      footer={
        <div className="who">
          <span className="who-name">{user.email ?? 'Admin'}</span>
          <button className="btn ghost sm" title="Replay the tour"
            onClick={() => startTour('admin', ADMIN_TOUR, { force: true })}>?</button>
          <button className="btn ghost sm" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      }>
      {view === 'overview' && <Overview onGoTo={(v) => setView(v === 'moderation' ? 'moderation' : 'overview')} />}
      {view === 'users' && <Users />}
      {view === 'projects' && <Projects />}
      {view === 'moderation' && <Moderation />}
      {view === 'splash' && <Splashscreens />}
    </Shell>
  );
}
