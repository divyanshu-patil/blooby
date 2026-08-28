import { useState } from 'react';
import {
  Dialog, EmptyState, ErrorState, PageHeader, SearchBar, adminApi, relativeTime, useAsync,
  type AdminUser,
} from '@blooby/studio';

/** Paginated by cursor — never "load every user into the browser" (spec §14). */
export function Users() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AdminUser | null>(null);
  const { data, error, loading, reload } = useAsync(() => adminApi.users({ q: q || undefined, limit: 50 }), [q]);

  return (
    <>
      <PageHeader title="Users" subtitle="Accounts, activity and roles.">
        <SearchBar value={q} onChange={setQ} placeholder="Search by email or name" />
      </PageHeader>

      <div className="page-body">
        {loading && <div className="skeleton" style={{ height: 260 }} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (data.items.length === 0 ? (
          <EmptyState title="No users" note={q ? `Nothing matches “${q}”.` : 'Nobody has signed up yet.'} />
        ) : (
          <table className="table">
            <thead>
              <tr><th>User</th><th>Joined</th><th>Last seen</th><th>Projects</th><th>Role</th></tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} tabIndex={0} onClick={() => setOpen(u)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(u); }}>
                  <td>{u.username ?? u.email ?? u.id.slice(0, 8)}</td>
                  <td className="num">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="num">{u.lastSignInAt ? relativeTime(Date.parse(u.lastSignInAt)) : '—'}</td>
                  <td className="num">{u.projectCount}</td>
                  <td>{u.role === 'admin' ? <span className="tag" data-tone="live">Admin</span> : 'User'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      {open && <UserDetail user={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function UserDetail({ user, onClose, onChanged }: { user: AdminUser; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading } = useAsync(() => adminApi.user(user.id), [user.id]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const flip = async () => {
    setBusy(true); setFailed(null);
    try { await adminApi.setRole(user.id, user.role === 'admin' ? 'user' : 'admin'); onChanged(); }
    catch (e) { setFailed(e instanceof Error ? e.message : 'Could not change the role.'); setBusy(false); }
  };

  return (
    <Dialog title={user.username ?? user.email ?? 'User'} onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => void flip()} disabled={busy}>
          {user.role === 'admin' ? 'Revoke admin' : 'Make admin'}
        </button>
      </>}>
      {loading && <div className="skeleton" style={{ height: 120 }} />}
      {error && <p style={{ color: 'var(--hot)', fontSize: 12.5 }}>{error}</p>}

      {data && (
        <>
          <div className="metrics" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="stat-label">Projects</div><div className="stat-value">{data.projectCount}</div></div>
            <div className="stat"><div className="stat-label">Published</div><div className="stat-value">{data.publishedAssets}</div></div>
            <div className="stat"><div className="stat-label">In review</div><div className="stat-value">{data.pendingAssets}</div></div>
          </div>

          <h3 className="block-title">Recent projects</h3>
          {/* metadata only: an admin browsing accounts must not silently open private
              work, so names and timestamps are all this shows (spec §15) */}
          {data.recentProjects.length === 0
            ? <p className="state-note">No projects yet.</p>
            : (
              <ul className="plain-list">
                {data.recentProjects.map((p) => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <span className="ranked-num">{relativeTime(Date.parse(p.updatedAt))}</span>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
      {failed && <p style={{ color: 'var(--hot)', fontSize: 12.5, marginTop: 10 }}>{failed}</p>}
    </Dialog>
  );
}
