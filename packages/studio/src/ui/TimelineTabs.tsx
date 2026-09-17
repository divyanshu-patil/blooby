import { useState } from 'react';
import { useEditor } from '../core/store';

/**
 * Switches between a project's independent animation sequences. Each keeps its own layers and
 * motion — editing one never changes another — and each becomes its own state in the exported
 * `.lottie`. + makes a blank one; ⧉ copies a timeline, layers and all.
 */
export function TimelineTabs() {
  const project = useEditor((s) => s.project);
  const addTimeline = useEditor((s) => s.addTimeline);
  const renameTimeline = useEditor((s) => s.renameTimeline);
  const deleteTimeline = useEditor((s) => s.deleteTimeline);
  const duplicateTimeline = useEditor((s) => s.duplicateTimeline);
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
          <button className="tl-tab-x" title="Duplicate this timeline — its layers and animation"
            aria-label={`Duplicate ${tl.name}`}
            onClick={(e) => { e.stopPropagation(); duplicateTimeline(tl.id); }}>⧉</button>
          {project.timelines.length > 1 && (
            <button className="tl-tab-x" title="Delete this timeline"
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${tl.name}"?`)) deleteTimeline(tl.id); }}>✕</button>
          )}
        </div>
      ))}
      <button className="tl-tab-add" data-tour="timeline-add" title="A new, blank timeline (a new state for export). ⧉ on a tab copies one instead." onClick={() => addTimeline()}>+</button>
    </div>
  );
}
