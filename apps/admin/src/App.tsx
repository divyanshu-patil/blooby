import { useEffect, useState } from 'react';
import { Editor, useEditor, type Project } from '@blooby/studio';
import { listAnimations, listUsers, publishPreset, supabase, type AdminUser, type AnimationRow } from './api';
import type { Session } from '@supabase/supabase-js';

type Tab = 'users' | 'animations' | 'publisher';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <main className="admin-gate"><p>Loading…</p></main>;
  if (!session) return <SignIn />;
  return <Shell email={session.user.email ?? ''} />;
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="admin-gate">
      <h1>blooby admin</h1>
      <p>Sign in with the Google account that owns an admin profile.</p>
      <button className="btn" onClick={async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        });
        if (error) setError(error.message);
      }}>Sign in with Google</button>
      {error && <p className="warn">{error}</p>}
    </main>
  );
}

function Shell({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>('users');
  const [user, setUser] = useState<AdminUser | null>(null);

  return (
    <div className="admin">
      <header className="admin-bar">
        <strong>blooby admin</strong>
        <nav className="seg">
          <button aria-pressed={tab === 'users'} onClick={() => setTab('users')}>Users</button>
          <button aria-pressed={tab === 'animations'} onClick={() => setTab('animations')} disabled={!user}>
            {user ? `${user.email ?? user.id.slice(0, 8)}’s animations` : 'Animations'}
          </button>
          <button aria-pressed={tab === 'publisher'} onClick={() => setTab('publisher')}>Preset publisher</button>
        </nav>
        <span className="spacer" />
        <span className="admin-who">{email}</span>
        <button className="btn sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      {tab === 'users' && <Users onOpen={(u) => { setUser(u); setTab('animations'); }} />}
      {tab === 'animations' && user && <Animations user={user} />}
      {tab === 'publisher' && <Publisher />}
    </div>
  );
}

/** Small async-data helper — three views need exactly this and nothing more. */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function Users({ onOpen }: { onOpen: (u: AdminUser) => void }) {
  const { data, error, loading } = useAsync(listUsers, []);
  if (loading) return <p className="admin-body">Loading users…</p>;
  if (error) return <p className="admin-body warn">{error}</p>;
  return (
    <div className="admin-body">
      <table className="admin-table">
        <thead><tr><th>User</th><th>Signed up</th><th>Last seen</th><th>Animations</th><th>Admin</th></tr></thead>
        <tbody>
          {data!.map((u) => (
            <tr key={u.id} onClick={() => onOpen(u)} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(u); }}>
              <td>{u.name ?? u.email ?? u.id}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : '—'}</td>
              <td>{u.animationCount}</td>
              <td>{u.isAdmin ? 'yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Animations({ user }: { user: AdminUser }) {
  const { data, error, loading } = useAsync(() => listAnimations(user.id), [user.id]);
  const loadProject = useEditor((s) => s.loadProject);
  if (loading) return <p className="admin-body">Loading animations…</p>;
  if (error) return <p className="admin-body warn">{error}</p>;
  if (!data!.length) return <p className="admin-body">No saved animations.</p>;
  return (
    <div className="admin-body">
      <div className="chips">
        {data!.map((a: AnimationRow) => (
          <button key={a.id} className="chip" title={`Open ${a.name} in the editor`}
            onClick={() => loadProject(a.projectJson as Project)}>
            {a.thumbnailUrl && <img src={a.thumbnailUrl} alt="" />}
            <span className="chip-label">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The publisher IS the editor — same component apps/web renders — with a second save
 *  destination wired to POST /api/admin/presets instead of a local file. */
function Publisher() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="admin-editor">
      {status && <p className="admin-status">{status}</p>}
      <Editor saveLabel="Publish preset" onSave={async (project: Project) => {
        const name = prompt('Publish as preset named:', project.name);
        if (!name?.trim()) return;
        const tl = project.timelines.find((t) => t.id === project.activeTimelineId) ?? project.timelines[0];
        setStatus(`Publishing “${name}”…`);
        try {
          await publishPreset({
            name: name.trim(),
            category: 'published',
            source: 'custom',
            published: true,
            presetJson: {
              id: `pub-${crypto.randomUUID()}`,
              name: name.trim(),
              source: 'custom',
              durationMs: tl.timelineDurationMs,
              tracks: tl.tracks,
            },
          });
          setStatus(`Published “${name}”.`);
        } catch (e) {
          setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }} />
    </div>
  );
}
