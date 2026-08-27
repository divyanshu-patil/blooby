import { applyEasing } from './easing';
import { lerpColor } from './color';
import { noise1d } from './noise';
import { bodyTurnScale, projectToScreen, silhouetteScale } from './curvature';
import { getCameraProp, getProp, PROP_RANGE, readProp, setCameraProp, setProp, writeProp } from './props';
import { activeTimeline } from './types';
import { activeTransitionAt, blockAt, blockStarts } from './timeline';
import type { ColorStop, EasingCurve, KeyValue, Modifier, Project, Rig, RigNode, Timeline, Track, Vec2 } from './types';

const isColor = (v: KeyValue): v is ColorStop => typeof v === 'object' && 'r' in v;
const isVec = (v: KeyValue): v is Vec2 => typeof v === 'object' && 'x' in v;

export function lerpValue(a: KeyValue, b: KeyValue, t: number): KeyValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
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
    let originMs = 0;
    if (m.blockId) {
      const w = blockWindow(tl, m.blockId);
      if (!w || timeMs < w[0] || timeMs > w[1]) continue;
      originMs = w[0];
    }
    applyModifier(rig, m, (timeMs - originMs) / 1000);
  }
  return rig;
}

const ANIMATABLE_PROPS = Object.keys(PROP_RANGE).filter((p) => !p.startsWith('camera.'));
const CAMERA_PROPS = Object.keys(PROP_RANGE).filter((p) => p.startsWith('camera.'));

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
  if (root.visible) {
    out.push({
      id: root.id, name: root.name, shape: 'ellipse', cx, cy, w: rx * limb * 2, h: ry * limb * 2,
      r: Math.min(rx, ry) * limb, rotation: roll, color: root.color, depth: -2, zIndex: root.zIndex,
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

      const w = node.size.x * node.transform.scale.x * p.sx * cum;
      const h = eyeHeight(node) * node.transform.scale.y * p.sy * cum;
      const rot = pr + node.transform.rotation;

      const color = p.alpha < 1 ? { ...node.color, a: node.color.a * p.alpha } : node.color;
      if (node.kind === 'svgLayer' && node.svg) {
        out.push({ id: node.id, name: node.name, shape: 'pill', cx: ax, cy: ay, w, h, r: 0, rotation: rot, color, depth: p.depth, zIndex: node.zIndex, svg: node.svg });
      } else if (node.kind !== 'group') {
        const shape = node.primitive?.shape === 'circle' ? 'ellipse' : 'pill';
        out.push({ id: node.id, name: node.name, shape, cx: ax, cy: ay, w, h, r: Math.min(w, h) / 2, rotation: rot, color, depth: p.depth, zIndex: node.zIndex });
      }
      walk(node, ax, ay, rot, Math.max(w, h) / 2, { x: 0, y: 0 }, cum * scaleOf(node));
    }
  };

  walk(root, cx, cy, roll, rx, head, scaleOf(root));
  out.sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
  return out;
}

export const sceneAt = (project: Project, t: number, view: Viewport) =>
  buildScene(evaluateRig(project, t), view);

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
