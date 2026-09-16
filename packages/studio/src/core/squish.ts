import { writeKeyframe } from './store';
import { activeTimeline, type EasingCurve, type Project } from './types';

/**
 * Squish presets: reusable squash-and-stretch ACTIONS, not animations.
 *
 * Kept apart from the preset library on purpose — a preset is a clip on the strip; one of
 * these is a handful of ordinary `squish.x` / `squish.y` keyframes written onto a layer at
 * the playhead, right over whatever the clip is doing. Nothing opaque is left behind: once
 * applied they are keyframes like any other, to drag, retime and re-ease.
 *
 * Keys are [ms from the playhead, squish.x, squish.y, easing out of that key].
 */
type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'overshoot' | 'elastic';
export interface SquishPreset { id: string; name: string; blurb: string; keys: [number, number, number, Ease][] }

export const SQUISH_PRESETS: SquishPreset[] = [
  { id: 'soft', name: 'Soft Squash', blurb: 'A gentle breath of weight', keys: [
    [0, 1, 1, 'easeInOut'], [180, 1.07, 0.93, 'easeInOut'], [420, 1, 1, 'easeOut']] },
  { id: 'heavy', name: 'Heavy Squash', blurb: 'Something heavy just sat on it', keys: [
    [0, 1, 1, 'easeIn'], [120, 1.22, 0.78, 'easeOut'], [360, 0.95, 1.05, 'easeInOut'], [560, 1, 1, 'easeOut']] },
  { id: 'stretch', name: 'Vertical Stretch', blurb: 'Reaching up, then back', keys: [
    [0, 1, 1, 'easeInOut'], [220, 0.88, 1.14, 'easeInOut'], [480, 1, 1, 'easeOut']] },
  { id: 'landing', name: 'Landing Squash', blurb: 'Hits the ground and recovers', keys: [
    [0, 1, 1, 'easeIn'], [100, 1.18, 0.82, 'easeOut'], [250, 0.93, 1.08, 'easeInOut'], [450, 1, 1, 'easeOut']] },
  { id: 'bounce', name: 'Bounce Squash', blurb: 'Squash, stretch, squash, settle', keys: [
    [0, 1, 1, 'easeIn'], [110, 1.14, 0.86, 'easeOut'], [280, 0.9, 1.12, 'easeInOut'], [440, 1.06, 0.94, 'easeInOut'], [620, 1, 1, 'easeOut']] },
  { id: 'pop', name: 'Quick Pop', blurb: 'A tiny excited pop', keys: [
    [0, 1, 1, 'easeOut'], [90, 0.92, 1.1, 'overshoot'], [240, 1, 1, 'easeOut']] },
  { id: 'anticipation', name: 'Anticipation Squash', blurb: 'Winds down before a jump', keys: [
    [0, 1, 1, 'easeInOut'], [260, 1.12, 0.88, 'easeIn'], [360, 0.9, 1.12, 'easeOut'], [600, 1, 1, 'easeOut']] },
];

const EASE: Record<Ease, EasingCurve> = {
  linear: { type: 'linear' },
  easeIn: { type: 'preset', name: 'easeIn' },
  easeOut: { type: 'preset', name: 'easeOut' },
  easeInOut: { type: 'preset', name: 'easeInOut' },
  overshoot: { type: 'bezier', p1: { x: 0.34, y: 1.56 }, p2: { x: 0.64, y: 1 } },
  elastic: { type: 'preset', name: 'elastic' },
};

export const squishPreset = (ref: string): SquishPreset | undefined => {
  const r = ref.trim().toLowerCase();
  return SQUISH_PRESETS.find((s) => s.id === r || s.name.toLowerCase() === r);
};

/**
 * Write a squish preset onto `nodeId` starting at `atMs`.
 *
 * Only squish keys INSIDE the preset's own window are cleared first — two squashes laid over
 * each other read as jitter, not as either one — and everything else on the timeline, squish
 * keys outside the window included, is left exactly as it was. False for an unknown preset.
 */
export function applySquish(p: Project, nodeId: string, presetId: string, atMs: number): boolean {
  const preset = squishPreset(presetId);
  if (!preset || !p.rig.nodes[nodeId]) return false;
  const t0 = Math.max(0, Math.round(atMs));
  const end = t0 + preset.keys[preset.keys.length - 1][0];
  for (const t of activeTimeline(p).tracks) {
    if (t.nodeId !== nodeId || (t.property !== 'squish.x' && t.property !== 'squish.y')) continue;
    t.keyframes = t.keyframes.filter((k) => k.time < t0 - 0.5 || k.time > end + 0.5);
  }
  for (const [dt, x, y, e] of preset.keys) {
    writeKeyframe(p, nodeId, 'squish.x', t0 + dt, x, EASE[e]);
    writeKeyframe(p, nodeId, 'squish.y', t0 + dt, y, EASE[e]);
  }
  return true;
}
