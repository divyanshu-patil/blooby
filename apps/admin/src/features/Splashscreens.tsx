import { useState } from 'react';
import {
  Dialog, EmptyState, ErrorState, PageHeader, adminApi, relativeTime, useAsync, useEditor,
  AssetThumb, type Preset, type SplashscreenRow,
} from '@blooby/studio';

/**
 * Exactly one splashscreen is live at a time; publishing a new one archives the old.
 * Enforced in Postgres by a partial unique index, so the UI can state it as a fact.
 */
export function Splashscreens() {
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<SplashscreenRow | null>(null);
  const { data, error, loading, reload } = useAsync(() => adminApi.splashscreens(), []);

  const act = async (fn: () => Promise<unknown>) => { await fn(); reload(); };
  const live = data?.find((s) => s.status === 'published');

  return (
    <>
      <PageHeader title="Splashscreens" subtitle="The animation everyone sees when the app opens.">
        <button className="btn primary" onClick={() => setCreating(true)}>New splashscreen</button>
      </PageHeader>

      <div className="page-body">
        {loading && <div className="skeleton" style={{ height: 200 }} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (
          <>
            <p className="state-note" style={{ textAlign: 'left', maxWidth: 560, marginBottom: 16 }}>
              {live
                ? <>“{live.name}” is live right now. Publishing another replaces it — no redeploy needed.</>
                : <>Nothing is live. Visitors go straight into the app.</>}
            </p>

            {data.length === 0 ? (
              <EmptyState title="No splashscreens yet"
                note="Create one from a project you've exported, preview it, then publish."
                action={<button className="btn primary" onClick={() => setCreating(true)}>New splashscreen</button>} />
            ) : (
              <div className="card-grid">
                {data.map((s) => (
                  <div key={s.id} className="card" role="button" tabIndex={0}
                    onClick={() => setPreview(s)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setPreview(s); }}>
                    <div className="card-thumb" style={{ background: s.background }}>
                      <AssetThumb preset={s.data as Preset | null} />
                    </div>
                    <div className="card-body">
                      <div className="card-name">{s.name}</div>
                      <div className="card-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="tag" data-tone={s.status === 'published' ? 'live' : undefined}>
                          {s.status === 'published' ? 'Live' : s.status}
                        </span>
                        <span>{s.durationMs}ms · {relativeTime(Date.parse(s.updatedAt))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {creating && <CreateSplash onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}

      {preview && (
        <Dialog title={preview.name}
          note={preview.status === 'published' ? 'This is what everyone sees on open.' : 'Not currently live.'}
          onClose={() => setPreview(null)}
          actions={<>
            <button className="btn ghost" onClick={() => setPreview(null)}>Close</button>
            {preview.status === 'published'
              ? <button className="btn" onClick={() => { const id = preview.id; setPreview(null); void act(() => adminApi.unpublishSplash(id)); }}>Unpublish</button>
              : <>
                  <button className="btn danger ghost" onClick={() => { const id = preview.id; setPreview(null); void act(() => adminApi.removeSplash(id)); }}>Delete</button>
                  <button className="btn primary" onClick={() => { const id = preview.id; setPreview(null); void act(() => adminApi.publishSplash(id)); }}>Publish</button>
                </>}
          </>}>
          <div style={{ background: preview.background, borderRadius: 7, padding: 20, display: 'grid', placeItems: 'center', minHeight: 180 }}>
            <div style={{ width: 160 }}><AssetThumb preset={preview.data as Preset | null} /></div>
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            {preview.durationMs}ms play · {preview.fadeMs}ms fade
          </p>
        </Dialog>
      )}
    </>
  );
}

/** Built from whatever is currently open in the shared editor, so an admin composes a
 *  splash with the same tool users animate with — no separate editor (spec §36). */
function CreateSplash({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const project = useEditor((s) => s.project);
  const [name, setName] = useState('Splashscreen');
  const [background, setBackground] = useState('#0b0b0f');
  const [durationMs, setDuration] = useState(2000);
  const [fadeMs, setFade] = useState(400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await adminApi.createSplash({ name: name.trim(), data: project, background, durationMs, fadeMs });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create it.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="New splashscreen"
      note="Uses whatever is open in the Editor tab right now. Publish it when you're happy with the preview."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create as draft'}
        </button>
      </>}>
      <div className="field-row">
        <label htmlFor="sname">Name</label>
        <input id="sname" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div className="field-row">
          <label htmlFor="sbg">Background</label>
          <input id="sbg" type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="sdur">Play (ms)</label>
          <input id="sdur" type="number" min={200} max={15000} step={100} value={durationMs}
            onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div className="field-row">
          <label htmlFor="sfade">Fade (ms)</label>
          <input id="sfade" type="number" min={0} max={5000} step={50} value={fadeMs}
            onChange={(e) => setFade(Number(e.target.value))} />
        </div>
      </div>
      {error && <p style={{ color: 'var(--hot)', fontSize: 12.5 }}>{error}</p>}
    </Dialog>
  );
}
