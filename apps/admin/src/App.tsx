import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import {
  BloobyMark, EmptyState, Shell, auth, startTour, startTourWhenReady, useSession,
  type DriveStep, type NavGroup, type SessionUser,
} from '@blooby/studio';
import { Overview } from './features/Overview';
import { Users } from './features/Users';
import { Projects } from './features/Projects';
import { Moderation } from './features/Moderation';
import { OfficialEditor } from './features/OfficialEditor';
import { Splashscreens } from './features/Splashscreens';
import { Copilot } from './features/Copilot';

const NAV: NavGroup[] = [
  { items: [{ id: '/dashboard', label: 'Dashboard', glyph: '▤' }] },
  { title: 'People', items: [
    { id: '/users', label: 'Users', glyph: '◍' },
    { id: '/projects', label: 'Projects', glyph: '◳' },
  ] },
  { title: 'Content', items: [
    { id: '/community', label: 'Community', glyph: '◈' },
    { id: '/editor', label: 'Official', glyph: '✦' },
    { id: '/splashscreens', label: 'Splashscreen', glyph: '◐' },
  ] },
  { title: 'System', items: [
    { id: '/copilot', label: 'Copilot', glyph: '◇' },
  ] },
];

const ADMIN_TOUR: DriveStep[] = [
  { popover: { title: 'The admin panel', description: 'A short tour of what you can do here. Skip it with Escape at any time.' } },
  { element: '[data-tour="/dashboard"]', popover: { title: 'Dashboard', description: 'Usage at a glance, with a growth chart and the assets people actually use. When something is waiting for review, a banner appears here linking straight to it.' } },
  { element: '[data-tour="/users"]', popover: { title: 'Users', description: 'Every account, with project counts and last activity. Open one to see their stats and grant or revoke admin access.' } },
  { element: '[data-tour="/community"]', popover: { title: 'Community review', description: 'Submissions from users. Approve to publish, or reject with a reason the creator sees. Nothing is deleted — statuses keep the history.' } },
  { element: '[data-tour="/editor"]', popover: { title: 'Editor', description: 'The same editor users have. Build an animation, then publish it as official content or save it as a splashscreen.' } },
  { element: '[data-tour="/splashscreens"]', popover: { title: 'Splashscreen', description: 'Publish the animation everyone sees when the app opens. Only one is live at a time, and swapping it needs no redeploy.' } },
  { element: '[data-tour="/copilot"]', popover: { title: 'Copilot', description: 'Ollama Cloud keys for the AI copilot, rotated across on failure, and the switch for whether users may use their own instead. Keys live here rather than in an environment variable, so rotating one is not a redeploy.' } },
];

export function App() {
  const { user, ready, isAdmin } = useSession();

  if (!ready) return <main className="auth"><p className="state-note">Loading…</p></main>;

  return (
    <Routes>
      <Route path="/login" element={user ? <BackToWhereYouWere /> : <SignIn />} />

      <Route element={<RequireAdmin user={user} isAdmin={isAdmin} />}>
        {/* the editor takes the whole window: the preview is the point of that screen,
            so it opts out of the fixed sidebar and slides navigation over instead */}
        <Route path="/editor" element={<EditorRoute />} />

        <Route element={<AdminShell user={user!} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/users" element={<Users />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/community" element={<Moderation />} />
          <Route path="/splashscreens" element={<Splashscreens />} />
          <Route path="/copilot" element={<Copilot />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/**
 * Two gates in one place. Signed out goes to the sign-in screen; signed in but not an
 * admin gets told so plainly rather than a blank panel.
 *
 * This is presentation only — every /api/admin/* call is checked against profiles.role on
 * the server, so typing a URL here reaches an API that refuses it regardless.
 */
function BackToWhereYouWere() {
  const { state } = useLocation() as { state: { from?: string } | null };
  return <Navigate to={state?.from ?? '/dashboard'} replace />;
}

function RequireAdmin({ user, isAdmin }: { user: SessionUser | null; isAdmin: boolean }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
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
  return <Outlet />;
}

function AdminShell({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = NAV.flatMap((g) => g.items);

  useEffect(() => { startTourWhenReady('admin', ADMIN_TOUR); }, []);

  return (
    <Shell
      nav={NAV}
      brand="blooby admin"
      active={items.find((i) => pathname.startsWith(i.id))?.id ?? '/dashboard'}
      onNavigate={(id) => navigate(id)}
      footer={
        <div className="who">
          <span className="who-name">{user.email ?? 'Admin'}</span>
          <button className="btn ghost sm" title="Replay the tour"
            onClick={() => startTour('admin', ADMIN_TOUR, { force: true })}>?</button>
          <button className="btn ghost sm" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      }
    >
      <Outlet />
    </Shell>
  );
}

function DashboardRoute() {
  const navigate = useNavigate();
  return <Overview onGoTo={(view) => navigate(view)} />;
}

function EditorRoute() {
  const navigate = useNavigate();
  return <OfficialEditor nav={NAV} active="/editor" onNavigate={(id) => navigate(id)} />;
}

function SignIn() {
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

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="auth">
      <EmptyState title="That page doesn’t exist" note="Check the link, or head back to the dashboard."
        action={<button className="btn primary" onClick={() => navigate('/dashboard')}>Back to dashboard</button>} />
    </main>
  );
}
