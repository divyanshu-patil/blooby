import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import {
  EmptyState, Shell, Splashscreen, auth, startTour, startTourWhenReady, useSession,
  type DriveStep, type NavGroup, type SessionUser,
} from '@blooby/studio';
import { AuthScreen } from './features/auth/AuthScreen';
import { Dashboard } from './features/projects/Dashboard';
import { Community } from './features/community/Community';
import { CloudEditor } from './features/editor/CloudEditor';

const NAV: NavGroup[] = [
  { items: [
    { id: '/projects', label: 'Projects', glyph: '◳' },
    { id: '/library', label: 'Library', glyph: '◈' },
  ] },
];

/** Explains what each area is FOR, not what it is called — a tour that reads the labels
 *  back to someone teaches them nothing. */
const WEB_TOUR: DriveStep[] = [
  { popover: { title: 'Welcome to blooby', description: 'A quick tour of where things live. You can skip it — press Escape or click outside at any point.' } },
  { element: '[data-tour="new-project"]', popover: { title: 'Start a project', description: 'Every project is a mascot plus its timeline. It saves to the cloud as you work, so you can pick it up on another machine.' } },
  { element: '[data-tour="/projects"]', popover: { title: 'Your projects', description: 'Everything you have made, most recently edited first. Rename, duplicate, make public or delete from the ⋯ menu on each card.' } },
  { element: '[data-tour="/library"]', popover: { title: 'The library', description: 'Ready-made presets and expressions — built-in, official, and published by other people. Add one to drop its animation straight into your project.' } },
  { element: '[data-tour="search"]', popover: { title: 'Find things fast', description: 'Search filters projects by name as you type.' } },
];

export function App() {
  const { user, ready } = useSession();
  const [splashDone, setSplashDone] = useState(false);

  // The splash sits above everything and removes itself; the app renders underneath the
  // whole time, so a splash that never loads costs nothing but a frame.
  const splash = !splashDone ? <Splashscreen onDone={() => setSplashDone(true)} /> : null;

  if (!ready) {
    return <>{splash}<main className="auth"><p className="state-note">Loading…</p></main></>;
  }

  return (
    <>
      {splash}
      <Routes>
        {/* signing in when you already have a session should not strand you on a form,
            and an email sign-in returns to whatever deep link sent you here */}
        <Route path="/login" element={user ? <BackToWhereYouWere /> : <AuthScreen />} />

        <Route element={<RequireAuth user={user} />}>
          {/* the editor is full-bleed: it deliberately sits outside the shell layout */}
          <Route path="/projects/:projectId" element={<EditorRoute />} />

          <Route element={<AppShell user={user!} tourReady={splashDone} />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsRoute />} />
            <Route path="/library" element={<Community />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound signedIn={!!user} />} />
      </Routes>
    </>
  );
}

/**
 * Route guard. The API rejects unauthenticated calls regardless of what renders, so this
 * is about not showing someone a dashboard whose every request would 401 — and about
 * bringing them back where they were once they sign in.
 */
function BackToWhereYouWere() {
  const { state } = useLocation() as { state: { from?: string } | null };
  return <Navigate to={state?.from ?? '/projects'} replace />;
}

function RequireAuth({ user }: { user: SessionUser | null }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function AppShell({ user, tourReady }: { user: SessionUser; tourReady: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (tourReady && pathname === '/projects') startTourWhenReady('web', WEB_TOUR);
  }, [tourReady, pathname]);

  return (
    <Shell
      nav={NAV}
      // the URL is the source of truth for which section is active, so a deep link,
      // a refresh and the back button all highlight the right thing
      active={NAV[0].items.find((i) => pathname.startsWith(i.id))?.id ?? '/projects'}
      onNavigate={(id) => navigate(id)}
      footer={
        <div className="who">
          <span className="who-name">{user.email ?? 'Signed in'}</span>
          <button className="btn ghost sm" title="Replay the tour"
            onClick={() => startTour('web', WEB_TOUR, { force: true })}>?</button>
          <button className="btn ghost sm" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      }
    >
      <Outlet />
    </Shell>
  );
}

function ProjectsRoute() {
  const navigate = useNavigate();
  return <Dashboard onOpen={(id) => navigate(`/projects/${id}`)} />;
}

function EditorRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  if (!projectId) return <Navigate to="/projects" replace />;
  return <CloudEditor projectId={projectId} onExit={() => navigate('/projects')} />;
}

function NotFound({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  return (
    <main className="auth">
      <EmptyState
        title="That page doesn’t exist"
        note="The link may be out of date, or the project may have been deleted."
        action={
          <button className="btn primary" onClick={() => navigate(signedIn ? '/projects' : '/login')}>
            {signedIn ? 'Back to projects' : 'Sign in'}
          </button>
        }
      />
    </main>
  );
}
