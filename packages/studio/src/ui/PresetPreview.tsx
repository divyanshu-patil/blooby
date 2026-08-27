import { useEffect, useRef, useState } from 'react';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { activeTimeline } from '../core/types';
import { MascotThumb } from './Mascot';
import type { Preset, Project } from '../core/types';

/**
 * A preset, played at full size before you commit to it.
 *
 * The chip thumbnail is one characteristic frame, which is enough to recognise something
 * you already know but not enough to judge something you don't — timing and easing are
 * exactly what a still hides. This loops the real animation through the same sceneAt()
 * the stage uses, so what you preview is what lands on the timeline.
 */
export function PresetPreview({ project, preset, onAdd, onClose }: {
  project: Project;
  preset: Preset;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const span = Math.max(200, preset.durationMs || 1000);

  useEffect(() => {
    const started = performance.now();
    const tick = () => {
      // loop, so a short preset is judged over several passes rather than one glimpse
      setT(((performance.now() - started) % span));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [span, preset.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') onAdd();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, onAdd]);

  const scene = (() => {
    try {
      const tl = activeTimeline(project);
      const temp: Project = {
        ...project,
        timelines: [{ ...tl, tracks: preset.tracks, modifiers: [], blocks: [] }],
        activeTimelineId: tl.id,
      };
      return sceneAt(temp, t, COMP);
    } catch { return null; }
  })();

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="preview-card" role="dialog" aria-modal="true" aria-label={`Preview ${preset.name}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="preview-stage">
          {scene
            ? <MascotThumb scene={scene} view={COMP} />
            : <p className="empty-note">This preset can’t be previewed.</p>}
        </div>

        <div className="preview-meta">
          <div>
            <div className="preview-name">{preset.name}</div>
            <div className="preview-sub">
              {(span / 1000).toFixed(1)}s · {preset.source}
              {preset.uses !== undefined && preset.uses > 0 && <> · added {preset.uses} time{preset.uses === 1 ? '' : 's'}</>}
            </div>
          </div>
          <span className="spacer" />
          <button className="btn sm" onClick={onClose}>Close</button>
          <button className="btn sm primary" onClick={onAdd}>Add to project</button>
        </div>
      </div>
    </div>
  );
}
