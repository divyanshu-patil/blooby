import { useState } from 'react';
import {
  ChipBar, Dialog, EmptyState, ErrorState, LoadingGrid, PageHeader, ProjectCard, SearchBar,
  projectsApi, useAsync, type ProjectRow,
} from '@blooby/studio';

type Sort = 'recent' | 'created' | 'name';

const SORTS = [
  { id: 'recent' as const, label: 'Recently edited' },
  { id: 'created' as const, label: 'Newest' },
  { id: 'name' as const, label: 'Name' },
];

/**
 * The screen someone lands on after signing in. Recent work first, one obvious way to
 * start something new, and everything destructive tucked into each card's ⋯ menu so the
 * grid stays scannable (spec §32).
 */
export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);

  const { data, error, loading, reload } = useAsync(
    () => projectsApi.list({ q: q || undefined, sort, limit: 48 }),
    [q, sort],
  );

  const act = async (fn: () => Promise<unknown>) => { await fn(); reload(); };

  return (
    <>
      <PageHeader title="Projects" subtitle="Your animations, saved to the cloud.">
        <SearchBar value={q} onChange={setQ} placeholder="Search projects" />
        <button className="btn primary" onClick={() => setCreating(true)}>New project</button>
      </PageHeader>

      <div className="page-body">
        <div style={{ marginBottom: 15 }}>
          <ChipBar options={SORTS} value={sort} onChange={setSort} />
        </div>

        {loading && <LoadingGrid />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (data.items.length === 0 ? (
          q
            ? <EmptyState title="No matches" note={`Nothing here matches “${q}”.`} />
            : <EmptyState
                title="No projects yet"
                note="Create your first project and start animating."
                action={<button className="btn primary" onClick={() => setCreating(true)}>Create project</button>}
              />
        ) : (
          <div className="card-grid">
            {data.items.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)}
                menu={[
                  { label: 'Rename', onSelect: () => setRenaming(p) },
                  { label: 'Duplicate', onSelect: () => void act(() => projectsApi.duplicate(p.id)) },
                  {
                    label: p.visibility === 'public' ? 'Make private' : 'Make public',
                    onSelect: () => void act(() => projectsApi.update(p.id, { visibility: p.visibility === 'public' ? 'private' : 'public' })),
                  },
                  { label: 'Delete', danger: true, onSelect: () => setDeleting(p) },
                ]} />
            ))}
          </div>
        ))}
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); onOpen(p.id); }} />}

      {renaming && (
        <RenameDialog project={renaming} onClose={() => setRenaming(null)}
          onDone={() => { setRenaming(null); reload(); }} />
      )}

      {deleting && (
        <Dialog title={`Delete “${deleting.name}”?`}
          note="This removes the project and every saved version of it. It can’t be undone."
          onClose={() => setDeleting(null)}
          actions={<>
            <button className="btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn danger" onClick={() => { const id = deleting.id; setDeleting(null); void act(() => projectsApi.remove(id)); }}>
              Delete project
            </button>
          </>} />
      )}
    </>
  );
}

/** Name it, pick a starting point, and land straight in the editor (spec §11). */
function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectRow) => void }) {
  const [name, setName] = useState('Untitled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      onCreated(await projectsApi.create({ name: name.trim() || 'Untitled' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="New project" note="Start from the default mascot — you can change everything from there."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </>}>
      <div className="field-row">
        <label htmlFor="pname">Project name</label>
        <input id="pname" value={name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
      </div>
      {error && <p style={{ color: 'var(--hot)', fontSize: 12.5, margin: 0 }}>{error}</p>}
    </Dialog>
  );
}

function RenameDialog({ project, onClose, onDone }: { project: ProjectRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await projectsApi.update(project.id, { name: name.trim() }); onDone(); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title="Rename project" onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>Save name</button>
      </>}>
      <div className="field-row">
        <label htmlFor="rname">Project name</label>
        <input id="rname" value={name} autoFocus onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void save(); }} />
      </div>
    </Dialog>
  );
}
