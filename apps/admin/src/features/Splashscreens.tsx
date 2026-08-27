import { useState } from 'react';
import {
  ChipBar, Dialog, EmptyState, ErrorState, PageHeader, activeTimeline, adminApi,
  assetsApi, defaultProject, relativeTime, useAsync, useEditor,
  type AssetRow, type Preset, type Project, type SplashscreenRow,
} from '@blooby/studio';
import { SplashPreview } from './SplashPreview';

/**
 * Exactly one splashscreen is live at a time; publishing a new one archives the old.
 * Enforced by a partial unique index in Postgres, so the UI can state it as a fact.
 */
export function Splashscreens() {
  const [editing, setEditing] = useState<SplashscreenRow | 'new' | null>(null);
  const { data, error, loading, reload } = useAsync(() => adminApi.splashscreens(), []);

  const act = async (fn: () => Promise<unknown>) => { await fn(); reload(); };
  const live = data?.find((s) => s.status === 'published');

  return (
    <>
      <PageHeader title="Splashscreen" subtitle="The animation everyone sees when the app opens.">
        <button className="btn primary" onClick={() => setEditing('new')}>New splashscreen</button>
      </PageHeader>

      <div className="page-body">
        {loading && <div className="skeleton" style={{ height: 220 }} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (
          <>
            <p className="state-note" style={{ textAlign: 'left', maxWidth: 620, marginBottom: 24 }}>
              {live
                ? <>“{live.name}” is live right now. Publishing another replaces it — no redeploy needed.</>
                : <>Nothing is live. Visitors go straight into the app.</>}
            </p>

            {data.length === 0 ? (
              <EmptyState title="No splashscreens yet"
                note="Build one from a preset or from whatever is open in the editor, preview it, then publish."
                action={<button className="btn primary" onClick={() => setEditing('new')}>New splashscreen</button>} />
            ) : (
              <div className="card-grid">
                {data.map((s) => (
                  <div key={s.id} className="card" role="button" tabIndex={0}
                    onClick={() => setEditing(s)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditing(s); }}>
                    <div className="card-thumb" style={{ background: s.background }}>
                      <SplashPreview data={s.data} background={s.background} durationMs={s.durationMs}
                        fadeMs={s.fadeMs} playKey={0} />
                    </div>
                    <div className="card-body">
                      <div className="card-name">{s.name}</div>
                      <div className="card-meta" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

      {editing && (
        <SplashEditor
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          onAct={act}
        />
      )}
    </>
  );
}

type Source = 'editor' | 'library' | 'blank';

const SOURCES = [
  { id: 'editor' as const, label: 'From the editor' },
  { id: 'library' as const, label: 'From a preset' },
  { id: 'blank' as const, label: 'Default mascot' },
];

/**
 * Build or adjust a splashscreen.
 *
 * A splashscreen IS a mascot animation, so the animation itself is configurable here
 * rather than being whatever happened to be open: take the editor's current project,
 * pick any published preset, or start from the default mascot. Whichever you choose is
 * played back live at the real duration and fade, so the preview is the deliverable.
 */
function SplashEditor({ existing, onClose, onSaved, onAct }: {
  existing: SplashscreenRow | null;
  onClose: () => void;
  onSaved: () => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const editorProject = useEditor((s) => s.project);

  const [source, setSource] = useState<Source>(existing ? 'editor' : 'editor');
  const [data, setData] = useState<unknown>(existing?.data ?? editorProject);
  const [name, setName] = useState(existing?.name ?? editorProject.name ?? 'Splashscreen');
  const [background, setBackground] = useState(existing?.background ?? '#0a0a0a');
  const [durationMs, setDuration] = useState(existing?.durationMs ?? clampDuration(activeTimeline(editorProject).timelineDurationMs));
  const [fadeMs, setFade] = useState(existing?.fadeMs ?? 400);
  const [playKey, setPlayKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useAsync(
    () => (source === 'library' ? assetsApi.browse({ kind: 'preset', limit: 48 }) : Promise.resolve(null)),
    [source],
  );

  const pickSource = (next: Source) => {
    setSource(next);
    if (next === 'editor') { setData(editorProject); setDuration(clampDuration(activeTimeline(editorProject).timelineDurationMs)); }
    if (next === 'blank') { const p = defaultProject(); setData(p); setDuration(clampDuration(activeTimeline(p).timelineDurationMs)); }
    setPlayKey((k) => k + 1);
  };

  /** A preset carries tracks, not a whole project, so it is mounted on the default rig —
   *  the same construction the editor's own preset chips use to draw themselves. */
  const pickPreset = (asset: AssetRow) => {
    const preset = asset.data as Preset;
    const base = defaultProject();
    const tl = activeTimeline(base);
    const project: Project = {
      ...base,
      name: asset.name,
      timelines: [{ ...tl, tracks: preset.tracks ?? [], blocks: [], modifiers: [], timelineDurationMs: preset.durationMs || tl.timelineDurationMs }],
      activeTimelineId: tl.id,
    };
    setData(project);
    setDuration(clampDuration(preset.durationMs || tl.timelineDurationMs));
    setPlayKey((k) => k + 1);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (existing) await adminApi.updateSplash(existing.id, { name: name.trim(), data, background, durationMs, fadeMs });
      else await adminApi.createSplash({ name: name.trim(), data, background, durationMs, fadeMs });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save it.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={existing ? `Edit “${existing.name}”` : 'New splashscreen'}
      note="Choose the animation, tune the timing, and watch it play exactly as visitors will."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        {existing && existing.status === 'published' && (
          <button className="btn" disabled={busy} onClick={() => { onClose(); void onAct(() => adminApi.unpublishSplash(existing.id)); }}>
            Unpublish
          </button>
        )}
        {existing && existing.status !== 'published' && (
          <>
            <button className="btn danger ghost" disabled={busy}
              onClick={() => { onClose(); void onAct(() => adminApi.removeSplash(existing.id)); }}>Delete</button>
            <button className="btn" disabled={busy}
              onClick={() => { onClose(); void onAct(() => adminApi.publishSplash(existing.id)); }}>Publish</button>
          </>
        )}
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save as draft'}
        </button>
      </>}>

      <SplashPreview data={data} background={background} durationMs={durationMs} fadeMs={fadeMs} playKey={playKey} />
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setPlayKey((k) => k + 1)}>Replay preview</button>

      <div className="field-row" style={{ marginTop: 16 }}>
        <label>Animation</label>
        <ChipBar options={SOURCES} value={source} onChange={pickSource} />
      </div>

      {source === 'library' && (
        <div className="splash-picker">
          {presets.loading && <p className="state-note">Loading presets…</p>}
          {presets.error && <p style={{ color: 'var(--hot)', fontSize: 14 }}>{presets.error}</p>}
          {presets.data?.items.length === 0 && <p className="state-note">No published presets yet.</p>}
          {presets.data?.items.map((a) => (
            <button key={a.id} className="splash-pick" onClick={() => pickPreset(a)}>{a.name}</button>
          ))}
        </div>
      )}

      <div className="field-row">
        <label htmlFor="spname">Name</label>
        <input id="spname" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field-row">
          <label htmlFor="spbg">Background</label>
          <input id="spbg" type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="spdur">Play (ms)</label>
          <input id="spdur" type="number" min={200} max={15000} step={100} value={durationMs}
            onChange={(e) => { setDuration(Number(e.target.value)); setPlayKey((k) => k + 1); }} />
        </div>
        <div className="field-row">
          <label htmlFor="spfade">Fade (ms)</label>
          <input id="spfade" type="number" min={0} max={5000} step={50} value={fadeMs}
            onChange={(e) => setFade(Number(e.target.value))} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--hot)', fontSize: 14 }}>{error}</p>}
    </Dialog>
  );
}

/** The column has a CHECK constraint; clamping here means a long timeline produces a
 *  sensible splash rather than a 400 from the API. */
const clampDuration = (ms: number) => Math.min(15000, Math.max(200, Math.round(ms) || 2000));
