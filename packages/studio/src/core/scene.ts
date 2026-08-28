import { applyEasing } from './easing';
import { lerpColor } from './color';
import { morphPath } from './path';
import { shapeResolver } from './emitters';
import { noise1d } from './noise';
import { bodyTurnScale, projectToScreen, silhouetteScale } from './curvature';
import { CAMERA_PROPS, getCameraProp, getProp, NUMERIC_PROPS, readProp, setCameraProp, setProp, writeProp } from './props';
import { activeTimeline } from './types';
import { activeTransitionAt, blockAt, blockStarts } from './timeline';
import type { Anchor, ColorStop, EasingCurve, KeyValue, Modifier, ModifierAxis, Project, Rig, RigNode, Timeline, Track, Vec2 } from './types';

const isColor = (v: KeyValue): v is ColorStop => typeof v === 'object' && 'r' in v;
const isVec = (v: KeyValue): v is Vec2 => typeof v === 'object' && 'x' in v;

export function lerpValue(a: KeyValue, b: KeyValue, t: number): KeyValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  // two path strings: a real morph, not a switch at the halfway mark
  if (typeof a === 'string' && typeof b === 'string') return morphPath(a, b, t);
  if (isColor(a) && isColor(b)) return lerpColor(a, b, t);
  if (isVec(a) && isVec(b)) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return a;
}

/** Shortest-path angular lerp, for morphs across the ±180 seam. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return a + d * t;
}

/** Value of a track at time t. Interpolation uses the *earlier* keyframe's easingOut. */
export function sampleTrack(track: Track, t: number): KeyValue | undefined {
  const ks = track.keyframes;
  if (ks.length === 0) return undefined;
  if (ks.length === 1 || t <= ks[0].time) return ks[0].value;
  const last = ks[ks.length - 1];
  if (t >= last.time) return last.value;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].time <= t) i++;
  const a = ks[i], b = ks[i + 1];
  const span = b.time - a.time;
  const raw = span <= 0 ? 1 : (t - a.time) / span;
  const e = applyEasing(a.easingOut, raw);
  if (track.property.endsWith('rotation') && typeof a.value === 'number' && typeof b.value === 'number')
    return lerpAngle(a.value, b.value as number, e);
  return lerpValue(a.value, b.value, e);
}

/** [start, end] of a block on its own timeline, or null if the id doesn't resolve. */
function blockWindow(tl: Timeline, blockId: string): [number, number] | null {
  const idx = tl.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return null;
  const starts = blockStarts(tl);
  return [starts[idx], starts[idx] + tl.blocks[idx].durationMs];
}

/**
 * The one track actually driving `nodeId`/`property` at time `t` — never just "whichever
 * track happens to sit first (or last) in the array". A timeline can hold several tracks
 * for the same node+property, one per block (each block's preset contributes its own).
 *
 * A clip is a sealed instance: when `t` falls inside a block's own span, *only* that
 * block's own track for this property is eligible — never a different block's track
 * (which used to win by array order — "edits do nothing"), and never a global/blockless
 * track either, just because this clip doesn't happen to animate the property itself
 * (which used to read as "a stray keyframe from somewhere else leaking into a brand-new
 * clip that should just show its own rest pose"). A global track is only ever the
 * fallback outside every block — past the last one, or a timeline with no blocks at all.
 */
export function activeTrackFor(tl: Timeline, nodeId: string, property: string, t: number): Track | undefined {
  const inside = blockAt(tl, t);
  let fallback: Track | undefined;
  for (const track of tl.tracks) {
    if (track.nodeId !== nodeId || track.property !== property) continue;
    if (inside) { if (track.blockId === inside.id) return track; continue; }
    if (!track.blockId) fallback ??= track;
  }
  return fallback;
}

const PENDULUM_AXIS: Record<ModifierAxis, string> = {
  rotation: 'transform.rotation',
  x: 'flatOffset.x',
  y: 'flatOffset.y',
  yaw: 'surface.yaw',
  pitch: 'surface.pitch',
};

function applyModifier(rig: Rig, m: Modifier, tSec: number) {
  const gain = (m.amount / 100) * m.amplitude;
  if (gain === 0) return;

  const node = rig.nodes[m.nodeId];
  if (!node) return;

  // stretch pulses one node's own scale.x/y — buildScene's own cascading scale (see
  // `scaleOf`/`cum` there) carries that pulse down to every one of its children for free,
  // so "the whole rig" is just what happens when the target is the root.
  if (m.kind === 'stretch') {
    const s = 1 + (gain / 100) * Math.sin(2 * Math.PI * m.frequency * tSec + (m.phase ?? 0));
    node.transform.scale = { x: node.transform.scale.x * s, y: node.transform.scale.y * s };
    return;
  }

  const isRoot = node.id === rig.rootId || !node.surface.mapped;
  const bump = (path: string, d: number) => {
    const cur = getProp(node, path);
    if (typeof cur === 'number') setProp(node, path, cur + d);
  };

  // A pendulum is a sine on ONE chosen axis. Rotation is the one that actually reads as a
  // pendulum — a hanging weight swings, it does not slide — but the axis is a dial because
  // the same motion on flatOffset.x is what a slow sway wants.
  if (m.kind === 'pendulum') {
    const s = Math.sin(2 * Math.PI * m.frequency * tSec + (m.phase ?? 0)) * gain;
    bump(PENDULUM_AXIS[m.axis ?? 'rotation'], s);
    return;
  }
  if (m.kind === 'shake') {
    const seed = m.seed ?? 0;
    const p = tSec * m.frequency;
    if (isRoot) {
      bump('flatOffset.x', noise1d(p, seed) * gain);
      bump('flatOffset.y', noise1d(p + 31.7, seed) * gain);
    } else {
      bump('surface.yaw', noise1d(p, seed) * gain);
      bump('surface.pitch', noise1d(p + 31.7, seed) * gain);
    }
    bump('transform.rotation', noise1d(p + 77.3, seed) * gain * 0.5);
  } else {
    const s = Math.sin(2 * Math.PI * m.frequency * tSec + (m.phase ?? 0)) * gain;
    if (isRoot) bump('flatOffset.y', s);
    else bump('surface.pitch', s);
  }
}

/**
 * When a timeline loops, the pose at `durationMs` eases back to the pose actually rendered
 * at t=0, so the last frame and the first frame match and playback (and export) wrap with
 * no seam. Unconditional — a track that already happens to end on its start value still
 * gets its own closing keyframe, so "first frame == last frame" holds by construction, not
 * by coincidence. The close always eases with easeOut (a settle, not whatever curve the
 * second-to-last segment used) so the return to rest reads distinctly.
 *
 * The subtlety is clip sealing (see `activeTrackFor`): one (nodeId, property) pair can own
 * several tracks, one per block, and only the one whose block contains `t` is ever
 * rendered. So closing each track back to *its own* t=0 value is wrong — it matches a
 * value the viewer never sees. Instead resolve the *global* winner at t=0, then hang the
 * closing keyframe only on the track that actually wins at the tail. A property animated
 * in an earlier block but with no track at all in the closing block has nothing to hang it
 * on, so a minimal one is synthesized for that block, anchored on the rig's base pose.
 *
 * A pure derivation — never mutates stored keyframes — shared by playback and export so
 * they can't drift apart, same as everything else in this file.
 */
export function resolveTracks(project: Project): Track[] {
  const tl = activeTimeline(project);
  const { tracks, loop, timelineDurationMs: durationMs } = tl;
  if (!loop) return tracks;

  const keyOf = (nodeId: string, property: string) => `${nodeId} ${property}`;

  // What the viewer actually sees at t=0, per property — the pose the tail must return to.
  const seen = new Set<string>();
  const startValue = new Map<string, { nodeId: string; property: string; value: KeyValue }>();
  for (const t of tracks) {
    const key = keyOf(t.nodeId, t.property);
    if (seen.has(key)) continue;
    seen.add(key);
    const winner = activeTrackFor(tl, t.nodeId, t.property, 0);
    const value = winner && sampleTrack(winner, 0);
    if (value !== undefined) startValue.set(key, { nodeId: t.nodeId, property: t.property, value });
  }

  const closed = new Set<string>();
  const resolved: Track[] = tracks.map((track) => {
    const ks = track.keyframes;
    if (ks.length < 2) return track;
    const last = ks[ks.length - 1];
    if (last.time >= durationMs - 1) return track;
    // only the track actually reachable at the tail gets the close — the others are sealed
    // inside earlier clips and never rendered there.
    if (activeTrackFor(tl, track.nodeId, track.property, durationMs)?.id !== track.id) return track;
    const key = keyOf(track.nodeId, track.property);
    const entry = startValue.get(key);
    if (!entry) return track;
    closed.add(key);
    return { ...track, keyframes: [...ks, { id: `${last.id}~loop`, time: durationMs, value: entry.value, easingOut: { type: 'preset' as const, name: 'easeOut' as const } }] };
  });

  // Properties animated earlier but untouched by the closing clip: nothing to hang the
  // close on, so synthesize the smallest track that gets them home.
  // ponytail: assumes the closing block plays at speed 1 and doesn't loop, so
  // blockSampleTime is the identity across it; retime these two keys if that stops holding.
  const endBlock = blockAt(tl, durationMs);
  if (endBlock) {
    const endStart = blockStarts(tl)[tl.blocks.indexOf(endBlock)];
    for (const [key, entry] of startValue) {
      if (closed.has(key)) continue;
      if (activeTrackFor(tl, entry.nodeId, entry.property, durationMs)) continue;
      const base = readProp(project.rig, entry.nodeId, entry.property);
      if (base === undefined || endStart >= durationMs - 1) continue;
      resolved.push({
        id: `loop~${key}`,
        nodeId: entry.nodeId,
        property: entry.property,
        blockId: endBlock.id,
        keyframes: [
          { id: `loop~${key}~a`, time: endStart, value: base, easingOut: { type: 'linear' as const } },
          { id: `loop~${key}~b~loop`, time: durationMs, value: entry.value, easingOut: { type: 'preset' as const, name: 'easeOut' as const } },
        ],
      });
    }
  }
  return resolved;
}

/** Where a block-owned track should actually be sampled at absolute time `t` — shifted by
 * the block's own playback speed, and wrapped every one "natural length" of its source
 * preset if it loops (relayoutBlocks skips rescaling a looping block's keyframes on
 * resize precisely so this natural length stays meaningful to wrap at). A block-less
 * (global) track ignores this entirely and samples `t` directly. Exported so valueAt
 * (what the inspector shows) can't drift from what evaluateRig actually renders. */
export function blockSampleTime(project: Project, tl: Timeline, blockId: string, t: number): number {
  const idx = tl.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return t;
  const block = tl.blocks[idx];
  const start = blockStarts(tl)[idx];
  let rel = (t - start) * (block.speed ?? 1);
  if (block.loop) {
    const span = project.presets.find((p) => p.id === block.presetId)?.durationMs || block.durationMs;
    if (span > 0) rel = ((rel % span) + span) % span;
  }
  return start + rel;
}

/** evaluateRig without transition blending — what "the incoming clip's own animation" or
 * "the outgoing clip's frozen pose" each independently resolve to at a given instant. */
function evaluateRigRaw(project: Project, timeMs: number): Rig {
  const rig: Rig = structuredClone(project.rig);
  const tl = activeTimeline(project);
  const resolved = resolveTracks(project);
  const resolvedTl = { ...tl, tracks: resolved };
  const seen = new Set<string>();
  for (const track of resolved) {
    const key = `${track.nodeId} ${track.property}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const winner = activeTrackFor(resolvedTl, track.nodeId, track.property, timeMs);
    const sampleT = winner?.blockId ? blockSampleTime(project, tl, winner.blockId, timeMs) : timeMs;
    const v = winner && sampleTrack(winner, sampleT);
    if (v !== undefined) writeProp(rig, track.nodeId, track.property, v);
  }
  // linked eyes mirror their source, after keyframes so a track on the source drives both
  for (const node of Object.values(rig.nodes)) {
    const src = node.eye?.linkedToId ? rig.nodes[node.eye.linkedToId] : null;
    if (!src?.eye || !node.eye) continue;
    node.transform = { ...src.transform, scale: { ...src.transform.scale } };
    node.size = { ...src.size };
    node.color = { ...src.color };
    node.surface = { ...src.surface, yaw: src.surface.yaw };
    node.eye = { ...node.eye, openness: src.eye.openness, distanceFromCenter: -src.eye.distanceFromCenter };
  }
  for (const m of tl.modifiers) {
    // clip-local effects only run inside their own clip's time range — same window
    // check block-scoped tracks already use, so a Shake added to just "Blink" can't leak
    // into neighboring clips. The effect's own phase runs from the clip's start, too, so
    // dragging the clip elsewhere on the timeline can't change how it looks internally.
    const local = scopeTime(tl, m, timeMs);
    if (local === null) continue;
    applyModifier(rig, m, local / 1000);
  }
  return rig;
}

/**
 * How far into an effect's own run `timeMs` is, or null when it is not running.
 *
 * Scope is the clip when `blockId` is set and the whole timeline otherwise; `startMs`/
 * `endMs` narrow it further, measured from the start of that scope. The returned time
 * counts from `startMs`, not from the scope, so an effect with a range begins at rest
 * rather than picking up mid-swing — and because everything here is relative, dragging a
 * clip elsewhere on the strip cannot change how the effect inside it looks.
 */
export function scopeTime(tl: Timeline, e: { blockId?: string; startMs?: number; endMs?: number }, timeMs: number): number | null {
  let originMs = 0;
  if (e.blockId) {
    const w = blockWindow(tl, e.blockId);
    if (!w || timeMs < w[0] || timeMs > w[1]) return null;
    originMs = w[0];
  }
  const local = timeMs - originMs;
  if (e.startMs !== undefined && local < e.startMs) return null;
  if (e.endMs !== undefined && local > e.endMs) return null;
  return local - (e.startMs ?? 0);
}

/** [start, end] of an effect's scope on the timeline — what its range handles slide in. */
export function scopeSpan(tl: Timeline, blockId: string | undefined): [number, number] {
  const w = blockId ? blockWindow(tl, blockId) : null;
  return w ? [0, w[1] - w[0]] : [0, tl.timelineDurationMs];
}

// numeric only: color is keyframeable in the editor but there is nothing to interpolate
// it into here, and a baked export has no slot for it
const ANIMATABLE_PROPS = NUMERIC_PROPS.filter((p) => !CAMERA_PROPS.includes(p));

/** Lerp (lerpAngle for rotation-ish paths, matching sampleTrack's own convention) every
 * animatable property of `to` toward `from`, in place on `to`. */
function blendRigInto(to: Rig, from: Rig, amount: number): void {
  const isAngle = (p: string) => p.endsWith('rotation') || p.includes('yaw') || p.includes('pitch');
  for (const node of Object.values(to.nodes)) {
    const other = from.nodes[node.id];
    if (!other) continue;
    for (const path of ANIMATABLE_PROPS) {
      const a = getProp(other, path), b = getProp(node, path);
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      setProp(node, path, isAngle(path) ? lerpAngle(a, b, amount) : a + (b - a) * amount);
    }
    if (other.color && node.color) node.color = lerpColor(other.color, node.color, amount);
    // a transition across a shape change morphs too, rather than popping at the seam
    if (other.shapePath && node.shapePath && other.shapePath !== node.shapePath) {
      node.shapePath = morphPath(other.shapePath, node.shapePath, amount);
    }
  }
  for (const path of CAMERA_PROPS) {
    const a = getCameraProp(from, path), b = getCameraProp(to, path);
    setCameraProp(to, path, a + (b - a) * amount);
  }
}

/**
 * Rig with the active timeline's tracks sampled at t, every modifier layered on top, and
 * — if `t` falls inside a transition's window — blended from the outgoing clip's actually-
 * evaluated pose at the seam toward the incoming clip's own (still-progressing) animation.
 * Both clips' source keyframes stay untouched; the blend is purely a runtime read, same
 * principle as everything else evaluated here.
 */
export function evaluateRig(project: Project, timeMs: number): Rig {
  const tl = activeTimeline(project);
  const active = activeTransitionAt(tl, timeMs);
  const rig = evaluateRigRaw(project, timeMs);
  if (!active) return rig;
  // boundaryMs is the *incoming* clip's own start (blockAt's window check is exclusive on
  // the upper end, so the outgoing clip's own span ends just short of it) — evaluating
  // "outgoing" at that exact instant would silently read the incoming clip's context
  // instead (both clips resolve to the same block there), capturing the same pose on both
  // sides of the blend and producing no visible morph at all. Step fractionally back so
  // this reads as the outgoing clip's own last instant, not the incoming clip's first.
  const outgoing = evaluateRigRaw(project, active.boundaryMs - 1e-3);
  const progress = applyEasing(active.transition.easing, (timeMs - active.boundaryMs) / active.transition.durationMs);
  // amount=progress: blendRigInto(to, from, amount) resolves toward `from` at amount=0
  // and `to` at amount=1 — at the seam (progress 0) that must read as 100% outgoing,
  // sliding to 100% incoming (`rig`, already evaluated live above) as progress reaches 1.
  blendRigInto(rig, outgoing, progress);
  return rig;
}

/**
 * Preview-only: blends a captured outgoing rig toward the live evaluation of `project` at
 * `timeMs`, by `progress` (0 = entirely `fromRig`, 1 = entirely live) eased by `easing`.
 * This is the same runtime-blend principle as evaluateRig's clip transitions, one level up
 * — a *state* (timeline) switch, driven by the state machine's setState/enableState rather
 * than a fixed position on one timeline, so it can't be expressed as a pure function of
 * (project, time) the way a clip transition can. Never used for export/baking.
 */
export function evaluateWithTransition(project: Project, timeMs: number, fromRig: Rig, progress: number, easing: EasingCurve): Rig {
  const live = evaluateRig(project, timeMs);
  blendRigInto(live, fromRig, applyEasing(easing, Math.min(1, Math.max(0, progress))));
  return live;
}

/** Everything the renderer and the exporter need. Absolute, flattened, no nesting. */
export interface SceneItem {
  id: string;
  name: string;
  /** ellipse for the body (squash stays round), pill for features (rx = min/2) */
  shape: 'ellipse' | 'pill';
  /** rounded rect covers circle (r = w/2 = h/2) and pill alike — never a sharp corner */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** corner radius, always min(w,h)/2 for the shapes this rig makes */
  r: number;
  rotation: number;
  color: ColorStop;
  depth: number;
  zIndex: number;
  svg?: { sourceMarkup: string; viewBox: string };
  /** a glyph rather than a shape — what an emitter puts on screen. `h` is the font size. */
  text?: string;
  /** an outline in a -0.5..0.5 box, drawn scaled into the w/h box instead of the primitive */
  path?: string;
}

export interface Viewport { width: number; height: number }

function childrenOf(rig: Rig, id: string): RigNode[] {
  return Object.values(rig.nodes).filter((n) => n.parentId === id);
}

function eyeHeight(n: RigNode): number {
  return n.size.y * (n.transform.length ?? 1) * (n.eye ? n.eye.openness : 1);
}

/**
 * Flattens the rig to absolute screen shapes. Body roll rotates the whole assembly,
 * body squash carries features with it, mapped children ride the sphere.
 */
export function buildScene(rig: Rig, view: Viewport): SceneItem[] {
  const root = rig.nodes[rig.rootId];
  if (!root) return [];
  const out: SceneItem[] = [];

  const turn = bodyTurnScale(root.surface.yaw, root.surface.pitch);
  const rx = root.size.x * root.transform.scale.x * turn.sx;
  const ry = (root.size.y || root.size.x) * root.transform.scale.y * turn.sy;
  const off = root.surface.flatOffset ?? { x: 0, y: 0 };
  const cx = view.width / 2 + rig.camera.offset.x + off.x;
  const cy = view.height / 2 + rig.camera.offset.y + off.y;
  const roll = root.transform.rotation;
  const rad = (roll * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const head = { x: root.surface.yaw, y: root.surface.pitch };
  const squash = rx === 0 ? 1 : ry / rx;

  // rx is the *sphere* radius that features are placed on; the drawn outline is its
  // silhouette, which perspective pushes outward. Keep them separate or features escape.
  const limb = silhouetteScale(rig.camera.fov, rig.camera.distance);
  const rootSeen = root.presence ?? 1;
  if (root.visible && rootSeen > 0.002) {
    out.push({
      id: root.id, name: root.name, shape: 'ellipse', cx, cy,
      w: rx * limb * 2 * rootSeen, h: ry * limb * 2 * rootSeen,
      r: Math.min(rx, ry) * limb * rootSeen, rotation: roll,
      color: rootSeen < 1 ? { ...root.color, a: root.color.a * rootSeen } : root.color,
      depth: -2, zIndex: root.zIndex,
      ...(root.shapePath ? { path: root.shapePath } : {}),
    });
  }

  // a node's own transform.scale used to only ever size *itself* — a parent's scale never
  // reached its children (buildScene's own w/h always came from `node.size` alone), so
  // scaling the body up or down left every eye exactly the same size. `cum` threads the
  // accumulated ancestor scale (geometric mean of x/y, so a non-uniform squash on one
  // node doesn't warp a child's own aspect ratio) down the recursion — each node's actual
  // drawn size is its own size × its own scale × everything above it, same principle the
  // stretch modifier now relies on to affect "a node and all its children" from one dial.
  const scaleOf = (n: RigNode) => Math.sqrt(Math.max(1e-6, n.transform.scale.x * n.transform.scale.y));

  const walk = (parent: RigNode, px: number, py: number, pr: number, R: number, headAngles: Vec2, cum: number) => {
    for (const node of childrenOf(rig, parent.id)) {
      if (!node.visible) continue;
      const p = projectToScreen(node, rig, R, headAngles);
      if (!p.visible) continue;

      // ride the body's squash, then its roll
      const lx = p.x;
      const ly = p.y * (parent.id === rig.rootId ? squash : 1);
      const ax = px + lx * cos - ly * sin;
      const ay = py + lx * sin + ly * cos;

      // presence fades AND shrinks: a feature keyframed out shrinks away rather than
      // blinking off, which is what makes it usable as a transition into the next clip
      const seen = node.presence ?? 1;
      if (seen <= 0.002) { walk(node, px, py, pr, R, { x: 0, y: 0 }, cum); continue; }

      const w = node.size.x * node.transform.scale.x * p.sx * cum * seen;
      const h = eyeHeight(node) * node.transform.scale.y * p.sy * cum * seen;
      const rot = pr + node.transform.rotation;

      const a = p.alpha * seen;
      const color = a < 1 ? { ...node.color, a: node.color.a * a } : node.color;
      if (node.kind === 'svgLayer' && node.svg) {
        out.push({ id: node.id, name: node.name, shape: 'pill', cx: ax, cy: ay, w, h, r: 0, rotation: rot, color, depth: p.depth, zIndex: node.zIndex, svg: node.svg });
      } else if (node.kind !== 'group') {
        const shape = node.primitive?.shape === 'circle' ? 'ellipse' : 'pill';
        out.push({
          id: node.id, name: node.name, shape, cx: ax, cy: ay, w, h, r: Math.min(w, h) / 2,
          rotation: rot, color, depth: p.depth, zIndex: node.zIndex,
          ...(node.shapePath ? { path: node.shapePath } : {}),
        });
      }
      walk(node, ax, ay, rot, Math.max(w, h) / 2, { x: 0, y: 0 }, cum * scaleOf(node));
    }
  };

  walk(root, cx, cy, roll, rx, head, scaleOf(root));
  out.sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
  return out;
}

/**
 * Everything an emitter has on screen at `timeMs`.
 *
 * Particles are not simulated — there is no state to carry between frames, because there
 * is no frame loop to carry it through. `sceneAt(t)` has to be answerable for any t in any
 * order (the timeline scrubs, the exporter jumps, a thumbnail asks for one instant), so
 * each particle is a pure function of its slot index and the time. Slot i is simply
 * `i * rateMs` behind the emitter's clock, wrapping every `slots * rateMs`.
 *
 * `base` is the already-built rig scene: anchors read positions straight out of it rather
 * than re-projecting, so a tear parented to an eye lands exactly where that eye was drawn,
 * through every squash, roll and perspective divide that put it there.
 */
/**
 * The mapping between an emitter's rig-unit offsets and the screen, both ways.
 *
 * Exported because the stage draws the trajectory handles and has to land them exactly
 * where the particles come out — two implementations of this would drift the moment the
 * body scales, and the handle would sit next to the stream rather than on it.
 */
export function emitterFrame(rig: Rig, base: SceneItem[], view: Viewport) {
  const root = rig.nodes[rig.rootId];
  const body = base.find((i) => i.id === rig.rootId);
  // rig units -> screen: the body's drawn radius against its authored radius, so an
  // emitter keeps its proportions when the mascot scales or the viewport changes
  const unit = root && body && root.size.x > 0 ? (body.w / 2) / root.size.x : 1;
  const centre = {
    x: body?.cx ?? view.width / 2 + rig.camera.offset.x,
    y: body?.cy ?? view.height / 2 + rig.camera.offset.y,
  };
  const itemOf = (a: Anchor) => (a.nodeId ? base.find((i) => i.id === a.nodeId) : undefined);
  const originOf = (a: Anchor) => {
    const on = itemOf(a);
    return { x: on?.cx ?? centre.x, y: on?.cy ?? centre.y };
  };
  // a relative anchor measures in half-widths of the layer it is pinned to, so the point
  // rides that layer as it scales, squashes and blinks
  const scaleOf = (a: Anchor) => {
    const on = itemOf(a);
    return a.rel && on ? { x: Math.max(1e-6, on.w / 2), y: Math.max(1e-6, on.h / 2) } : { x: unit, y: unit };
  };
  return {
    unit,
    /** where this endpoint actually is on screen */
    anchor: (a: Anchor) => {
      const o = originOf(a), s = scaleOf(a);
      return { x: o.x + a.x * s.x, y: o.y + a.y * s.y };
    },
    /** the inverse: what offset would put this endpoint at that screen point */
    toOffset: (a: Anchor, screen: Vec2) => {
      const o = originOf(a), s = scaleOf(a);
      return { x: (screen.x - o.x) / s.x, y: (screen.y - o.y) / s.y };
    },
  };
}

export function emitterItems(
  tl: Timeline, rig: Rig, base: SceneItem[], timeMs: number, view: Viewport,
  /** turns a shape id into markup. Injected so core/scene need not know the library. */
  resolveShape?: (shapeId?: string, svgAssetId?: string) => { sourceMarkup: string; viewBox: string } | undefined,
): SceneItem[] {
  const emitters = tl.emitters ?? [];
  if (!emitters.length) return [];

  const { anchor, unit } = emitterFrame(rig, base, view);
  const out: SceneItem[] = [];
  for (const e of emitters) {
    const t = scopeTime(tl, e, timeMs);
    if (t === null) continue;

    const life = Math.max(1, e.lifeMs);
    const rate = Math.max(1, e.rateMs);
    // an orbit uses every slot it was given: they are positions on a ring, not spawns
    const slots = e.path === 'orbit'
      ? Math.max(1, Math.round(e.count))
      : Math.max(1, Math.min(e.count, Math.ceil(life / rate)));
    const cycle = slots * rate;
    const from = anchor(e.from), to = anchor(e.to);
    const seed = e.seed ?? 0;

    // one revolution per lifeMs, so "lives" reads as "how long a lap takes" on an orbit
    const orbitPhase = (t / life) % 1;

    const parts = e.parts?.length ? e.parts : null;

    for (let i = 0; i < slots; i++) {
      const pt = parts ? parts[i % parts.length] : null;

      // Per-particle speed. A stream where everything travels at one rate reads as a
      // conveyor belt; jitter spreads it across a range, deterministically by slot so
      // scrubbing back gives the same picture.
      const jitter = e.speedJitter ?? 0;
      const vary = jitter ? 1 + noise1d(i * 3.1 + 11, seed) * jitter : 1;
      const rateOf = Math.max(0.05, (pt?.speed ?? 1) * vary);

      // an orbit never dies and never respawns — it goes round. Everything else is born,
      // travels and fades.
      const age = e.path === 'orbit'
        ? ((t * rateOf + (i / slots) * life) % life)
        : ((t * rateOf - i * rate) % cycle + cycle) % cycle;
      if (age >= life) continue;                       // this slot is between spawns
      // easing shapes the journey itself: an ease-out drop falls fast and settles, where
      // linear travel is the same speed the whole way down
      const u = e.easing ? applyEasing(e.easing, age / life) : age / life;

      let x: number, y: number;
      if (e.path === 'orbit') {
        // radius defaults to the from->to distance, so dragging the end handle sizes the
        // ellipse — one gesture, whichever path is selected
        const rx = (e.radiusX ?? Math.hypot(to.x - from.x, to.y - from.y) / unit) * unit;
        const ry = (e.radiusY ?? e.radiusX ?? Math.hypot(to.x - from.x, to.y - from.y) / unit) * unit;
        // Spaced by INDEX around the ring, not by age. Age-staggering clumped them: with
        // `count` below life/rate the birth cycle is shorter than a life, so several sat
        // almost on top of each other. An orbit divides its track evenly, always.
        const a = 2 * Math.PI * (orbitPhase + i / slots);
        x = from.x + Math.cos(a) * rx;
        y = from.y + Math.sin(a) * ry;
      } else if (e.path === 'fall') {
        // horizontal at a constant rate, vertical accelerating — gravity, cheaply
        x = from.x + (to.x - from.x) * u + (i / slots - 0.5) * 2 * e.bow * unit;
        y = from.y + (to.y - from.y) * u * u;
      } else {
        x = from.x + (to.x - from.x) * u;
        y = from.y + (to.y - from.y) * u;
        // a quadratic bump perpendicular to travel: 0 at both ends, widest in the middle
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = e.bow * unit * 4 * u * (1 - u);
        x += (-dy / len) * bow;
        y += (dx / len) * bow;
      }

      if (e.wobble) {
        const w = e.wobble * unit;
        const phase = u * e.wobbleFrequency * (life / 1000) + i * 7.3;
        x += noise1d(phase, seed) * w;
        y += noise1d(phase + 31.7, seed) * w;
      }

      // fade in quickly so nothing pops into existence, then out from fadeStart
      const fadeIn = Math.min(1, u / 0.12);
      const tail = Math.max(1e-3, 1 - e.fadeStart);
      const fadeOut = u <= e.fadeStart ? 1 : Math.max(0, 1 - (u - e.fadeStart) / tail);
      const alpha = e.color.a * fadeIn * fadeOut;
      if (alpha <= 0.002) continue;

      const size = e.size * (e.scaleFrom + (e.scaleTo - e.scaleFrom) * u) * (pt?.sizeScale ?? 1) * unit;
      const tint = pt?.color ?? e.color;

      // what this particle IS: a library/project shape, or a character. `resolveShape` is
      // passed in rather than looked up here, so core/scene stays free of the library.
      const art = pt?.shapeId || pt?.svgAssetId ? resolveShape?.(pt.shapeId, pt.svgAssetId) : (e.svg ?? undefined);

      out.push({
        id: `${e.id}#${i}`, name: e.name, shape: 'pill',
        cx: x, cy: y, w: size, h: size, r: size / 2,
        rotation: (e.spin + (pt?.spin ?? 0)) * u,
        color: { ...tint, a: (tint.a ?? 1) * (alpha / Math.max(1e-6, e.color.a)) },
        depth: 3, zIndex: 900,
        ...(art ? { svg: art } : { text: pt?.glyph ?? e.glyphs[i % Math.max(1, e.glyphs.length)] ?? '' }),
      });
    }
  }
  return out;
}

/**
 * The rig plus whatever its emitters have on screen, in draw order.
 *
 * The editor's stage needs the evaluated rig for its own handles, so it cannot go through
 * `sceneAt` — but it must not therefore draw a different picture than the exporter does.
 * Both call this.
 */
/**
 * Takes the whole project rather than a timeline: it needs the imported SVGs to resolve a
 * particle's artwork, and a call site that had to remember to pass a resolver separately
 * would eventually forget and render every particle blank.
 */
export function composeScene(project: Project, rig: Rig, timeMs: number, view: Viewport): SceneItem[] {
  const base = buildScene(rig, view);
  const extra = emitterItems(activeTimeline(project), rig, base, timeMs, view, shapeResolver(project.svgAssets));
  if (!extra.length) return base;
  return [...base, ...extra].sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
}

export const sceneAt = (project: Project, t: number, view: Viewport): SceneItem[] =>
  composeScene(project, evaluateRig(project, t), t, view);

/** Current value of a property, tracks included — what the inspector shows. Mirrors
 * evaluateRig's own per-track sampling (block speed/loop included) so the inspector can
 * never show a value the preview doesn't actually render. */
export function valueAt(project: Project, nodeId: string, path: string, t: number): KeyValue | undefined {
  const tl = activeTimeline(project);
  const track = activeTrackFor(tl, nodeId, path, t);
  const sampleT = track?.blockId ? blockSampleTime(project, tl, track.blockId, t) : t;
  const sampled = track && sampleTrack(track, sampleT);
  return sampled !== undefined ? sampled : readProp(project.rig, nodeId, path);
}
