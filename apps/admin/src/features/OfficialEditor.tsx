import { useState } from 'react';
import { Dialog, Editor, PageHeader, adminApi, useEditor, activeTimeline, type Project } from '@blooby/studio';

/**
 * Official content is authored in the SAME editor users have — the admin capability is
 * "publish as official", not a second animation tool (spec §25/§36). The only difference
 * from a user's publish flow is which endpoint the save button calls.
 */
export function OfficialEditor() {
  const project = useEditor((s) => s.project);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Editor" subtitle="Author official presets and expressions, or compose a splashscreen.">
        {status && <span className="savestate">{status}</span>}
        <button className="btn primary" onClick={() => setPublishing(true)}>Publish as official</button>
      </PageHeader>

      <div className="admin-editor-body">
        <Editor />
      </div>

      {publishing && (
        <PublishDialog project={project}
          onClose={() => setPublishing(false)}
          onDone={(name) => { setPublishing(false); setStatus(`Published “${name}”.`); }} />
      )}
    </>
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
      {error && <p style={{ color: 'var(--hot)', fontSize: 12.5 }}>{error}</p>}
    </Dialog>
  );
}
