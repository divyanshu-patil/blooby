import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { deleteEntry, getActiveId, listEntries, putEntry, uidGallery, type GalleryEntry } from '../core/gallery';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { MascotThumb } from './Mascot';
import type { Project } from '../core/types';

/** Whichever timeline within an entry was last active — the sensible default to add. */
const defaultTimelineId = (e: GalleryEntry) => e.project.activeTimelineId;

/**
 * Every project you've built, as independent documents. "New clip" never touches the
 * one open now — it saves where you are (autosave already mirrors into the gallery),
 * creates a fresh entry, and switches to it. Opened via `openGallery()` from anywhere
 * (a plain window event, so the topbar button doesn't need to reach into this state).
 */
export function Gallery() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const loadProject = useEditor((s) => s.loadProject);
  const addClipFrom = useEditor((s) => s.addClipFrom);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pickedTimeline, setPickedTimeline] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => listEntries().then(setEntries).catch(() => setEntries([]));
  useEffect(() => { if (open) refresh(); }, [open]);
  // keep the button's own trigger reachable without prop-drilling through App.tsx's tabs
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('blooby:open-gallery', handler);
    return () => window.removeEventListener('blooby:open-gallery', handler);
  }, []);

  if (!open) return null;
  const activeId = getActiveId();

  const openEntry = async (e: GalleryEntry) => {
    loadProject(e.project, e.id);
    setOpen(false);
  };

  // §12/§13: a gallery animation becomes one clip in the *current* sequence, referencing
  // exactly one of its timelines — the item itself is only ever read here, never written.
  const addAsClip = (e: GalleryEntry) => {
    const timelineId = pickedTimeline[e.id] ?? defaultTimelineId(e);
    const timeline = e.project.timelines.find((t) => t.id === timelineId);
    if (!timeline) return;
    addClipFrom({
      label: `${e.name} · ${timeline.name}`,
      timeline,
      gallerySource: { galleryId: e.id, galleryName: e.name, timelineId: timeline.id, timelineName: timeline.name },
    });
    setOpen(false);
  };

  const newClip = async () => {
    const id = uidGallery();
    const fresh = defaultProject();
    await putEntry({ id, name: fresh.name, updatedAt: Date.now(), project: fresh });
    loadProject(fresh, id);
    setOpen(false);
  };

  const removeEntry = async (id: string) => {
    if (id === activeId) { alert("This is the mascot you're currently editing — switch to another one first."); return; }
    if (!confirm('Delete this saved mascot? This cannot be undone.')) return;
    await deleteEntry(id);
    refresh();
  };

  const exportEntry = (e: GalleryEntry) => {
    const blob = new Blob([JSON.stringify(e.project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${e.name.replace(/\s+/g, '-').toLowerCase()}.blooby.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const importFile = async (f: File) => {
    try {
      const proj = JSON.parse(await f.text()) as Project;
      const id = uidGallery();
      await putEntry({ id, name: proj.name || f.name.replace(/\.json$/i, ''), updatedAt: Date.now(), project: proj });
      refresh();
    } catch { alert('That file is not a blooby project.'); }
  };

  const rename = async (e: GalleryEntry) => {
    if (!draft.trim()) { setRenaming(null); return; }
    const next = { ...e, name: draft.trim(), updatedAt: Date.now() };
    await putEntry(next);
    if (e.id === activeId) useEditor.getState().commit((p) => { p.name = draft.trim(); }, 'projname');
    setRenaming(null);
    refresh();
  };

  return (
    <div className="gallery-overlay" onClick={() => setOpen(false)}>
      <div className="gallery" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-head">
          <h2>Gallery</h2>
          <input ref={file} type="file" accept=".json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          <button className="btn sm" onClick={() => file.current?.click()}>Import JSON</button>
          <button className="btn sm primary" onClick={newClip}>+ New clip</button>
          <button className="btn ghost sm icon" title="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="gallery-grid">
          {!entries.length && <p className="empty-note">Nothing saved yet — your current mascot will appear here shortly.</p>}
          {entries.map((e) => {
            const scene = sceneAt(e.project, 0, COMP);
            const isActive = e.id === activeId;
            return (
              <div key={e.id} className="gallery-card" data-active={isActive}>
                <button className="gallery-thumb" onClick={() => openEntry(e)} title={isActive ? 'Currently open' : `Open ${e.name}`}>
                  <MascotThumb scene={scene} view={COMP} />
                </button>
                {renaming === e.id ? (
                  <input className="txt" autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)}
                    onBlur={() => rename(e)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') rename(e); if (ev.key === 'Escape') setRenaming(null); }} />
                ) : (
                  <span className="gallery-name" onDoubleClick={() => { setRenaming(e.id); setDraft(e.name); }} title="Double-click to rename">
                    {e.name}{isActive && ' (current)'}
                  </span>
                )}
                {e.project.timelines.length > 1 && (
                  <select className="sel" value={pickedTimeline[e.id] ?? defaultTimelineId(e)}
                    title="Which timeline to add as a clip"
                    onChange={(ev) => setPickedTimeline((s) => ({ ...s, [e.id]: ev.target.value }))}>
                    {e.project.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <button className="btn sm" title="Insert this animation as one clip in the sequence you're currently editing"
                  onClick={() => addAsClip(e)}>
                  + Add as clip
                </button>
                <div className="row">
                  <button className="btn ghost sm" onClick={() => { setRenaming(e.id); setDraft(e.name); }}>Rename</button>
                  <button className="btn ghost sm" onClick={() => exportEntry(e)}>Export</button>
                  <span className="spacer" />
                  <button className="btn ghost sm icon" title="Delete" onClick={() => removeEntry(e.id)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const openGallery = () => window.dispatchEvent(new Event('blooby:open-gallery'));
