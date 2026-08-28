import { useEffect, useMemo, useRef, useState } from 'react';
import { COMP, defaultProject, presetPreviewProject } from '../core/defaults';
import { buildScene, evaluateRig, sceneAt } from '../core/scene';
import { splitKey } from '../core/store';
import { CAMERA_ID } from '../core/types';
import { writeProp } from '../core/props';
import { MascotThumb } from '../ui/Mascot';
import type { Expression, Preset, Rig } from '../core/types';

/**
 * Plays a submitted asset the way a viewer will eventually see it.
 *
 * Moderation on a still thumbnail is guesswork: the whole point of reviewing an
 * animation is its motion, and a single frame hides timing, easing, and anything
 * unpleasant that only happens mid-way through. Both kinds render on the default rig,
 * which is also what a person adding it to a fresh project would get.
 */
export function AssetPreview({ kind, data, loop = true, className }: {
  kind: 'preset' | 'expression';
  data: unknown;
  loop?: boolean;
  className?: string;
}) {
  const base = useMemo(() => defaultProject(), []);
  const preset = kind === 'preset' ? (data as Preset | null) : null;
  const span = Math.max(200, preset?.durationMs || 1000);

  const [t, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (kind !== 'preset' || !loop) return;
    const started = performance.now();
    const tick = () => {
      setT((performance.now() - started) % span);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [kind, loop, span, data]);

  const scene = useMemo(() => {
    try {
      if (kind === 'preset') {
        if (!preset?.tracks?.length) return null;
        return sceneAt(presetPreviewProject(base, preset as Preset), t, COMP);
      }

      // An expression is a pose, not a motion: apply its snapshot straight onto the
      // rig rather than routing it through a timeline that would only hold one frame.
      const snapshot = (data as Expression | null)?.snapshot;
      if (!snapshot || typeof snapshot !== 'object') return null;
      const rig: Rig = evaluateRig(base, 0);
      for (const [key, value] of Object.entries(snapshot)) {
        const [nodeId, property] = splitKey(key);
        if (nodeId === CAMERA_ID || !rig.nodes[nodeId]) continue;
        writeProp(rig, nodeId, property, value);
      }
      return buildScene(rig, COMP);
    } catch {
      return null;
    }
  }, [kind, preset, data, base, t]);

  if (!scene) {
    return <p className="empty-note">This {kind} can’t be previewed — its data looks malformed.</p>;
  }
  return <MascotThumb className={className} scene={scene} view={COMP} />;
}
