import { compOf } from '../core/comp';
import { sceneAt, type SceneItem } from '../core/scene';
import { animationIds } from '../core/stateMachine';
import type { Project, Timeline } from '../core/types';

/**
 * Every pose laid end to end in ONE composition, with real frames for the morph between
 * them.
 *
 * dotLottie's `Tweened` transition interpolates the PLAYHEAD inside the currently loaded
 * composition — there is no cross-composition morph anywhere in the runtime. So two
 * states naming two different animations can only hard-swap, and the `duration`/`easing`
 * they declare have nothing to act on. Both states have to name the same animation and
 * differ only by `segment`, and the frames between those segments have to be a real
 * interpolation the playhead can scrub through:
 *
 *     [ watching 0..A ][ morph A..B ][ observe B..C ]
 *
 * Two things make this nearly free here. Every timeline animates the SAME rig, and
 * `bakeLottie` already takes the union of layers across everything it samples and writes
 * opacity 0 for any frame a layer is missing from — so the six orbit layers that only
 * exist in one pose are carried through the whole strip and faded, rather than dropped
 * and re-added (which would break the scrub).
 *
 * The morph frames are sampled LINEARLY on purpose. The transition's own easing shapes
 * the scrub, so easing the content too would double it; and a straight line is exactly
 * what `reduce()` in lottie.ts throws away, which collapses the whole morph range back
 * down to its two endpoint keyframes in the output.
 */

/**
 * One pose's place in the strip.
 *
 * `marker` is the operative half. A PlaybackState's `segment` field is parsed by
 * `opt_str_field` in dotlottie-rs — it is a MARKER NAME, not a frame pair — and applied
 * with `set_marker()`. A numeric `[start, end]` is silently read as absent, which leaves
 * playback unconstrained and the whole strip plays. `range` is carried only so the
 * markers and the human-readable sidecar can be written from the same source.
 */
export interface Segment {
  marker: string;
  range: [number, number];
}

export interface Strip {
  /** the whole strip's length, for bakeLottie's `to` */
  totalMs: number;
  /** timeline id → the marker naming that state's frames */
  segments: Map<string, Segment>;
  /** what bakeLottie should draw at a given ms along the strip */
  sampleAt: (ms: number) => SceneItem[];
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * A pose part-way between two scenes.
 *
 * Identity fields (shape, path, text) are taken from the OUTGOING item rather than
 * crossfaded: a layer that changes its outline mid-morph would have to interpolate
 * vertices, and taking `a`'s outline means any such change lands on the segment boundary
 * — where a change is expected anyway — instead of popping in the middle of the blend.
 */
function blendItem(a: SceneItem, b: SceneItem, u: number): SceneItem {
  return {
    ...a,
    cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u),
    w: lerp(a.w, b.w, u), h: lerp(a.h, b.h, u), r: lerp(a.r, b.r, u),
    rotation: lerp(a.rotation, b.rotation, u),
    color: {
      r: lerp(a.color.r, b.color.r, u), g: lerp(a.color.g, b.color.g, u),
      b: lerp(a.color.b, b.color.b, u), a: lerp(a.color.a, b.color.a, u),
    },
    ...(a.alpha !== undefined || b.alpha !== undefined ? { alpha: lerp(a.alpha ?? a.color.a, b.alpha ?? b.color.a, u) } : {}),
    ...(a.stroke || b.stroke ? { stroke: blendStroke(a.stroke, b.stroke, u) } : {}),
  };
}

/** A stroke fades in or out across a morph rather than popping at its edge. */
function blendStroke(a: SceneItem['stroke'], b: SceneItem['stroke'], u: number): NonNullable<SceneItem['stroke']> {
  const from = a ?? { ...b!, color: { ...b!.color, a: 0 } };
  const to = b ?? { ...a!, color: { ...a!.color, a: 0 } };
  return {
    ...from, width: lerp(from.width, to.width, u),
    color: { r: lerp(from.color.r, to.color.r, u), g: lerp(from.color.g, to.color.g, u), b: lerp(from.color.b, to.color.b, u), a: lerp(from.color.a, to.color.a, u) },
  };
}

/** A layer only one side has fades rather than vanishing — this is what carries the
 *  orbit particles out of a pose that has them into one that does not. */
const faded = (it: SceneItem, alpha: number): SceneItem =>
  ({ ...it, color: { ...it.color, a: it.color.a * alpha }, ...(it.alpha !== undefined ? { alpha: it.alpha * alpha } : {}) });

function blendScene(a: SceneItem[], b: SceneItem[], u: number): SceneItem[] {
  const bById = new Map(b.map((it) => [it.id, it]));
  const out = a.map((it) => {
    const other = bById.get(it.id);
    bById.delete(it.id);
    return other ? blendItem(it, other, u) : faded(it, 1 - u);
  });
  for (const it of bById.values()) out.push(faded(it, u));
  return out;
}

/**
 * Lay `timelines` out as one strip. Only baked timelines belong here — an imported
 * animation is someone else's composition, written out byte for byte, and cannot be
 * merged into ours.
 */
export function layoutStrip(project: Project, timelines: Timeline[], markerOf: (tl: Timeline) => string): Strip {
  const fps = project.fps;
  const frames = (ms: number) => Math.max(1, Math.round((ms / 1000) * fps));
  const poseAt = (tl: Timeline, ms: number) =>
    sceneAt({ ...project, activeTimelineId: tl.id }, ms, compOf(project));

  const segments = new Map<string, Segment>();
  const morphs: { start: number; len: number; from: Timeline; to: Timeline }[] = [];

  let cursor = 0;
  timelines.forEach((tl, i) => {
    const len = frames(tl.timelineDurationMs);
    segments.set(tl.id, { marker: markerOf(tl), range: [cursor, cursor + len] });
    cursor += len;
    const next = timelines[i + 1];
    if (!next) return;
    // the morph is sized to the blend the NEXT state declares, so a state authored with a
    // 300ms enter gets 300ms of real frames to be scrubbed through at 30fps
    const len2 = frames(next.transitionMs ?? 300);
    morphs.push({ start: cursor, len: len2, from: tl, to: next });
    cursor += len2;
  });

  const sampleAt = (ms: number): SceneItem[] => {
    const f = Math.round((ms / 1000) * fps);
    for (const m of morphs) {
      if (f > m.start && f < m.start + m.len) {
        const u = (f - m.start) / m.len;
        return blendScene(poseAt(m.from, m.from.timelineDurationMs), poseAt(m.to, 0), u);
      }
    }
    for (const tl of timelines) {
      const [s, e] = segments.get(tl.id)!.range;
      if (f <= e) return poseAt(tl, ((Math.max(f, s) - s) / fps) * 1000);
    }
    const last = timelines[timelines.length - 1];
    return poseAt(last, last.timelineDurationMs);
  };

  return { totalMs: (cursor / fps) * 1000, segments, sampleAt };
}

/**
 * Which animation each state actually plays, and where in it.
 *
 * The single source of truth for the split, so the `.lottie`, the state machine and the
 * `blooby.machine.json` sidecar cannot drift into disagreeing about it — the sidecar
 * claiming a per-state animation while the machine names one strip is exactly the kind of
 * mismatch nobody notices until playback is silently wrong.
 */
export function dotLottieLayout(project: Project) {
  const perTimeline = animationIds(project);
  const baked = project.timelines.filter(
    (tl) => !(tl.animationId && project.importedAnimations?.[tl.animationId]),
  );
  /**
   * A fixed name, not one derived from the project.
   *
   * The last export silently renamed the machine when the project was renamed, and
   * nothing catches that: `stateMachineLoad` returns a bool the native binding discards,
   * so a machine that never loaded raises no error — the initial animation just autoplays
   * and looks roughly right. The app never names this composition (it names the machine
   * and the inputs), so there is nothing to gain from making it track the project title.
   */
  let stripId = 'mascot';
  for (let n = 2; [...perTimeline.values()].includes(stripId) && baked.length < project.timelines.length; n++) {
    stripId = `mascot-${n}`;
  }
  if (!baked.length) stripId = '';
  const strip = baked.length ? layoutStrip(project, baked, (tl) => perTimeline.get(tl.id)!) : undefined;

  const animationOf = new Map(perTimeline);
  for (const tl of baked) animationOf.set(tl.id, stripId);

  return { baked, stripId, strip, animationOf, perTimeline };
}
