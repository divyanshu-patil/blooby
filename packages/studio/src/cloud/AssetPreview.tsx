import { useMemo } from 'react';
import { COMP, defaultProject, presetPreviewProject } from '../core/defaults';
import { buildScene, evaluateRig, sceneAt } from '../core/scene';
import { usePresetScene } from '../ui/PresetPreview';
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

  // the editor's own preview, not a second implementation of it: same loop, same
  // presetPreviewProject, so a preset's emitters and modifiers reach the review queue
  // exactly as they reach the person who submitted it
  const { scene: presetScene, box: presetBox } = usePresetScene(base, loop ? preset : null);

  const poseScene = useMemo(() => {
    if (kind === 'preset') return null;
    try {
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
  }, [kind, data, base]);

  // a still frame when the caller asked for no motion — the same scene, sampled once
  const stillScene = useMemo(() => {
    if (kind !== 'preset' || loop || !preset) return null;
    try { return sceneAt(presetPreviewProject(base, preset), 0, COMP); } catch { return null; }
  }, [kind, loop, preset, base]);

  const scene = kind === 'preset' ? (presetScene ?? stillScene) : poseScene;
  // pinned for a playing preset; a still or a pose has nothing to reframe against
  const box = kind === 'preset' && presetScene ? presetBox : null;

  if (!scene) {
    return <p className="empty-note">This {kind} can’t be previewed — its data looks malformed.</p>;
  }
  return <MascotThumb className={className} scene={scene} view={COMP} box={box} />;
}
