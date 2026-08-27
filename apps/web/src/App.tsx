import { useEffect, useState } from 'react';
import { Shell, Splashscreen, auth, startTour, startTourWhenReady, useSession, type DriveStep, type NavGroup } from '@blooby/studio';
import { AuthScreen } from './features/auth/AuthScreen';
import { Dashboard } from './features/projects/Dashboard';
import { Community } from './features/community/Community';
import { CloudEditor } from './features/editor/CloudEditor';

type View = 'projects' | 'library';

const NAV: NavGroup[] = [
  { items: [
    { id: 'projects', label: 'Projects', glyph: '◳' },
    { id: 'library', label: 'Library', glyph: '◈' },
  ] },
];

/** Explains what each area is FOR, not what it is called — a tour that only reads the
 *  labels back to someone teaches them nothing. */
const WEB_TOUR: DriveStep[] = [
  { popover: { title: 'Welcome to blooby', description: 'A quick tour of where things live. You can skip it — press Escape or click outside at any point.' } },
  { element: '[data-tour="new-project"]', popover: { title: 'Start a project', description: 'Every project is a mascot plus its timeline. It saves to the cloud as you work, so you can pick it up on another machine.' } },
  { element: '[data-tour="projects"]', popover: { title: 'Your projects', description: 'Everything you have made, most recently edited first. Rename, duplicate, make public or delete from the ⋯ menu on each card.' } },
  { element: '[data-tour="library"]', popover: { title: 'The library', description: 'Ready-made presets and expressions — built-in, official, and published by other people. Add one to drop its animation straight into your project.' } },
  { element: '[data-tour="search"]', popover: { title: 'Find things fast', description: 'Search filters projects by name as you type.' } },
];

export function App() {
  const { user, ready } = useSession();
  const [splashDone, setSplashDone] = useState(false);
  const [view, setView] = useState<View>('projects');
  const [openProject, setOpenProject] = useState<string | null>(null);

  // The splash sits above everything and removes itself; the app renders underneath the
  // whole time, so a splash that never loads costs nothing but a frame.
  const splash = !splashDone ? <Splashscreen onDone={() => setSplashDone(true)} /> : null;

  if (!ready) return <>{splash}<main className="auth"><p className="state-note">Loading…</p></main></>;
  if (!user) return <>{splash}<AuthScreen /></>;

  if (openProject) {
    return <>{splash}<CloudEditor projectId={openProject} onExit={() => setOpenProject(null)} /></>;
  }

  return (
    <>
      {splash}
      <TourOnce ready={splashDone && view === 'projects'} />
      <Shell
        nav={NAV}
        active={view}
        onNavigate={(id) => setView(id as View)}
        footer={
          <div className="who">
            <span className="who-name">{user.email ?? 'Signed in'}</span>
            <button className="btn ghost sm" title="Replay the tour"
              onClick={() => startTour('web', WEB_TOUR, { force: true })}>?</button>
            <button className="btn ghost sm" onClick={() => void auth.signOut()}>Sign out</button>
          </div>
        }
      >
        {view === 'projects' && <Dashboard onOpen={setOpenProject} />}
        {view === 'library' && <Community />}
      </Shell>
    </>
  );
}

/** Fires the first-run tour once the dashboard has actually painted, and never again
 *  after it is finished or skipped. */
function TourOnce({ ready }: { ready: boolean }) {
  useEffect(() => { if (ready) startTourWhenReady('web', WEB_TOUR); }, [ready]);
  return null;
}
