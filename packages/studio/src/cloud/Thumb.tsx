import { useMemo } from 'react';
import { sceneAt } from '../core/scene';
import { COMP, defaultProject } from '../core/defaults';
import { MascotThumb } from '../ui/Mascot';
import { activeTimeline } from '../core/types';
import type { Preset, Project } from '../core/types';

/**
 * The signature of the whole shell: a card's picture is the mascot itself, rendered from
 * the project's own scene at its most characteristic frame — not a stored PNG.
 *
 * It costs one pure function call, it can never go stale against the animation it stands
 * for, and it means an empty S3 bucket still produces a browsable library.
 */
export function ProjectThumb({ project, at = 0 }: { project: Project | null; at?: number }) {
  const scene = useMemo(() => {
    if (!project) return null;
    try { return sceneAt(project, at, COMP); } catch { return null; }
  }, [project, at]);

  if (!scene) return <Placeholder />;
  return <MascotThumb scene={scene} view={COMP} />;
}

/** An asset holds only its tracks, so it is previewed on the default rig — the same way
 *  the editor's own preset chips already draw themselves. */
export function AssetThumb({ preset, at = 0 }: { preset: Preset | null; at?: number }) {
  const scene = useMemo(() => {
    if (!preset?.tracks) return null;
    try {
      const base = defaultProject();
      const tl = activeTimeline(base);
      const temp: Project = {
        ...base,
        timelines: [{ ...tl, tracks: preset.tracks, modifiers: [], blocks: [] }],
        activeTimelineId: tl.id,
      };
      return sceneAt(temp, at, COMP);
    } catch { return null; }
  }, [preset, at]);

  if (!scene) return <Placeholder />;
  return <MascotThumb scene={scene} view={COMP} />;
}

const Placeholder = () => (
  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>no preview</span>
);
