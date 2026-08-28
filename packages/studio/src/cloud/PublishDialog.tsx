import { useState } from 'react';
import { Dialog } from '../kit';
import { assetsApi } from './api';
import type { Expression, Preset } from '../core/types';

type Item = { kind: 'preset'; value: Preset } | { kind: 'expression'; value: Expression };

/**
 * Publish one of your own presets or captured poses to the community.
 *
 * Two calls, deliberately: create the asset, then submit it for review. The service
 * decides the status — a client cannot post `status: 'published'` and skip moderation,
 * which is why the submit step exists at all rather than a single create-as-published.
 */
export function PublishDialog({ item, onClose, onDone }: {
  item: Item; onClose: () => void; onDone: (name: string) => void;
}) {
  const [name, setName] = useState(item.value.name);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      const created = await assetsApi.create({
        kind: item.kind,
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
        data: item.value as unknown as Record<string, unknown>,
      });
      await assetsApi.submitToCommunity(created.id, {
        description: description.trim() || `${item.kind === 'preset' ? 'A preset' : 'A pose'} shared by its author.`,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
      });
      onDone(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Publish this ${item.kind}`}
      note="It goes to the community queue for review. Once approved it appears in everyone's library — you can keep using it here in the meantime."
      onClose={onClose}
      actions={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void publish()}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </>}>
      <div className="field-row">
        <label htmlFor="pub-name">Name</label>
        <input id="pub-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field-row">
        <label htmlFor="pub-desc">Description</label>
        <textarea id="pub-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this for, and when would someone reach for it?" />
      </div>
      <div className="field-row">
        <label htmlFor="pub-tags">Tags</label>
        <input id="pub-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="idle, subtle, loop" />
      </div>
      {error && <p style={{ color: 'var(--hot)', fontSize: 14 }}>{error}</p>}
    </Dialog>
  );
}
