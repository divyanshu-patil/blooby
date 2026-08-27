import { useState } from 'react';
import { Shell, Splashscreen, auth, useSession, type NavGroup } from '@blooby/studio';
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
      <Shell
        nav={NAV}
        active={view}
        onNavigate={(id) => setView(id as View)}
        footer={
          <div className="who">
            <span className="who-name">{user.email ?? 'Signed in'}</span>
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
