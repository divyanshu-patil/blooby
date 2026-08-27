import { useState } from 'react';
import {
  BloobyMark, Dialog, Editor, adminApi, useEditor, activeTimeline,
  type NavGroup, type Project,
} from '@blooby/studio';

/**
 * Official content is authored in the SAME editor users have — the admin capability is
 * "publish as official", not a second animation tool (spec §25/§36).
 *
 * This view goes full-bleed rather than sitting inside the shell's fixed sidebar: the
 * mascot preview is the thing being judged, and 236px of permanent navigation next to it
 * is 236px the preview does not get. Navigation slides over on demand instead.
 */
export function OfficialEditor({ nav, active, onNavigate }: {
  nav: NavGroup[]; active: string; onNavigate: (id: string) => void;
}) {
  const project = useEditor((s) => s.project);
  const [navOpen, setNavOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [splashing, setSplashing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="full-editor">
      <header className="full-bar">
        <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation">☰</button>
        <BloobyMark size={18} />
        <strong className="full-title">Editor</strong>
        <span className="spacer" />
        {status && <span className="savestate" role="status">{status}</span>}
        <button className="btn sm" onClick={() => setSplashing(true)}>Set as splashscreen</button>
        <button className="btn sm primary" onClick={() => setPublishing(true)}>Publish as official</button>
      </header>

      <div className="full-body"><Editor /></div>

      {navOpen && (
        <>
          <div className="slide-scrim" onClick={() => setNavOpen(false)} role="presentation" />
          <nav className="slide-nav" aria-label="Admin sections">
            <div className="brand" style={{ padding: '4px 6px 16px' }}>
              <BloobyMark /><span className="brand-word">blooby admin</span>
            </div>
            {nav.map((group, gi) => (
              <div key={group.title ?? gi}>
                {group.title && <div className="side-group-title">{group.title}</div>}
                {group.items.map((item) => (
                  <button key={item.id} className="side-item" aria-current={active === item.id}
                    onClick={() => { setNavOpen(false); onNavigate(item.id); }}>
                    <span className="side-glyph" aria-hidden>{item.glyph}</span>
                    <span className="side-label">{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </>
      )}

      {publishing && (
        <PublishDialog project={project} onClose={() => setPublishing(false)}
          onDone={(name) => { setPublishing(false); setStatus(`Published “${name}”.`); }} />
      )}

      {splashing && (
        <SplashDialog project={project} onClose={() => setSplashing(false)}
          onDone={(name) => { setSplashing(false); setStatus(`Saved “${name}” as a splashscreen draft.`); }} />
      )}
    </div>
  );
}

function PublishDialog({ project, onClose, onDone }: {
  project: Project; onClose: () => void; onDone: (name: string) => void;
}) {
  const [name, setName] = useState(project.name || 'Official preset');
  const [kind, setKind] = useState<'preset' | 'expression'>('preset');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setBusy(true); setError(null);
    const tl = activeTimeline(project);
    try {
      await adminApi.createOfficial({
        kind,
        name: name.trim(),
        description: description.trim() || undefined,
        category: 'official',
        data: {
          id: `official-${crypto.randomUUID()}`,
          name: name.trim(),
          source: 'custom',
          durationMs: tl.timelineDurationMs,
          tracks: tl.tracks,
        },
      });
      onDone(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Publish as official"
      note="Official content goes live immediately and appears to everyone under Official."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void publish()}>
          {busy ? 'Publishing…' : 'Publish'}
        </button>
      </>}>
      <div className="field-row">
        <label htmlFor="oname">Name</label>
        <input id="oname" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <label htmlFor="okind">Type</label>
        <select id="okind" value={kind} onChange={(e) => setKind(e.target.value as 'preset' | 'expression')}>
          <option value="preset">Preset</option>
          <option value="expression">Expression</option>
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="odesc">Description</label>
        <textarea id="odesc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this for, and when would someone reach for it?" />
      </div>
      {error && <p style={{ color: 'var(--hot)', fontSize: 14 }}>{error}</p>}
    </Dialog>
  );
}

/**
 * A splashscreen IS a mascot animation: you build it here, in the editor, then save the
 * whole project as the splash payload. This dialog is the handoff — it captures what is
 * currently on the timeline, so what you previewed is exactly what visitors will see.
 */
function SplashDialog({ project, onClose, onDone }: {
  project: Project; onClose: () => void; onDone: (name: string) => void;
}) {
  const tl = activeTimeline(project);
  const [name, setName] = useState(project.name || 'Splashscreen');
  const [background, setBackground] = useState('#0a0a0a');
  const [durationMs, setDuration] = useState(Math.min(15000, Math.max(200, Math.round(tl.timelineDurationMs))));
  const [fadeMs, setFade] = useState(400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await adminApi.createSplash({ name: name.trim(), data: project, background, durationMs, fadeMs });
      onDone(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save it.');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Save as splashscreen"
      note="Captures the animation currently on the timeline. It's saved as a draft — publish it from the Splashscreen section when you're happy with it."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
      </>}>
      <div className="field-row">
        <label htmlFor="spname">Name</label>
        <input id="spname" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field-row">
          <label htmlFor="spbg">Background</label>
          <input id="spbg" type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="spdur">Play (ms)</label>
          <input id="spdur" type="number" min={200} max={15000} step={100} value={durationMs}
            onChange={(e) => setDuration(Number(e.target.value))} />
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
