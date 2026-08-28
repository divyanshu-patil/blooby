import { useState } from 'react';
import { useEditor } from '../core/store';

/**
 * Switches between a project's independent animation sequences — same rig, different
 * motion. Each one becomes its own state in the exported `.lottie`. Distinct from the
 * Gallery (separate projects, separate rigs) — this is *within* one project.
 */
export function TimelineTabs() {
  const project = useEditor((s) => s.project);
  const addTimeline = useEditor((s) => s.addTimeline);
  const renameTimeline = useEditor((s) => s.renameTimeline);
  const deleteTimeline = useEditor((s) => s.deleteTimeline);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (id: string) => {
    if (draft.trim()) renameTimeline(id, draft.trim());
    setEditing(null);
  };

  return (
    <div className="tl-tabs" data-tour="timeline-tabs">
      {project.timelines.map((tl) => (
        <div key={tl.id} className="tl-tab" aria-pressed={tl.id === project.activeTimelineId}
          onClick={() => tl.id !== project.activeTimelineId && setActiveTimeline(tl.id)}
          onDoubleClick={() => { setEditing(tl.id); setDraft(tl.name); }}>
          {editing === tl.id ? (
            <input className="tl-tab-input" autoFocus value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(tl.id)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(tl.id);
                if (e.key === 'Escape') setEditing(null);
              }} />
          ) : (
            <span title="Double-click to rename">{tl.name}</span>
          )}
          {project.timelines.length > 1 && (
            <button className="tl-tab-x" title="Delete this timeline"
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${tl.name}"?`)) deleteTimeline(tl.id); }}>✕</button>
          )}
        </div>
      ))}
      <button className="tl-tab-add" data-tour="timeline-add" title="Add a new timeline (a new state for export)" onClick={() => addTimeline()}>+</button>
    </div>
  );
}
