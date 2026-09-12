import { uid } from './id';
import { compOf } from './comp';
import { primitivePath, SHAPE_LABEL } from './path';
import { importSvg, parseSvg } from './svg';
import { restLength } from './limb';
import { screenToSurface } from './curvature';
import { setProp } from './props';
import { activeTrackFor, appearanceSpans, buildScene, evaluateRig, fromFrame, toFrame, WORLD, type LayerFrame } from './scene';
import { activeTimeline } from './types';
import { MORPH_MODES, type MorphMode } from './easing';
import type { ColorStop, EasingCurve, KeyValue, Project, Rig, RigNode, ShapeKind, Vec2 } from './types';

/**
 * Everything you can do TO a layer, as plain functions on a project.
 *
 * The store wraps each in one `commit()` so it is a single undo step; the copilot's
 * `applyCalls` runs inside its own `commit()` and calls the very same functions. That is
 * the point of this file: a layer operation written once, reachable from the panel, the
 * stage, the keyboard and the agent, with no second copy for any of them to drift from.
 */

/** A new shape's fill: warm and legible on both the dark stage and a light one. */
export const SHAPE_FILL: ColorStop = { r: 232, g: 106, b: 84, a: 1 };
/** The body's own bone colour, which limbs share so they read as part of it. */
const LIMB_FILL: ColorStop = { r: 242, g: 239, b: 233, a: 1 };

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// makers

export function makeShapeLayer(shape: ShapeKind, over: Partial<RigNode> = {}): RigNode {
  return {
    id: uid('shape'), name: SHAPE_LABEL[shape], kind: 'primitive', parentId: null,
    // a world layer up and to the right of the mascot: somewhere it can be seen and
    // grabbed, rather than on the sphere where the rim would start eating it
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 210, y: -170 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1 },
    size: { x: 96, y: 96 }, color: SHAPE_FILL, visible: true, zIndex: 0,
    primitive: { shape: 'pill' }, shapePath: primitivePath(shape), shape: { kind: shape },
    ...over,
  };
}

/**
 * A hand or a leg, rigged and ready: the points sit where a shoulder or a hip would on
 * the default body (radius 148), so a new limb looks attached the moment it exists.
 * `side` is -1 for the one on screen-left.
 */
export function makeLimb(type: 'arm' | 'leg', side: -1 | 1, parentId: string | null = 'body', over: Partial<RigNode> = {}): RigNode {
  const s = side;
  const arm = { a: { x: 118 * s, y: 30 }, b: { x: 196 * s, y: 96 } };
  const leg = { a: { x: 56 * s, y: 112 }, b: { x: 68 * s, y: 176 }, c: { x: 60 * s, y: 230 } };
  // a relaxed length — a touch longer than the points are apart — so a new limb rests with
  // a soft curve, and bringing the hand in shows the hose bowing straight away
  const limb: RigNode['limb'] = type === 'arm'
    ? { type, ...arm, hose: 1, thickness: 24, bend: s, roundness: 1, taper: 0.12, length: restLength(arm) }
    : { type, ...leg, hose: 1, thickness: 26, bend: s, roundness: 1, taper: 0.08, length: restLength(leg),
      foot: { angle: 0, length: 40, width: 24 } };
  return {
    id: uid(type), name: `${s < 0 ? 'Left' : 'Right'} ${type === 'arm' ? 'hand' : 'leg'}`, kind: 'limb', parentId,
    surface: { yaw: 0, pitch: 0, mapped: false },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 1, y: 1 }, color: LIMB_FILL, visible: true,
    // tucked behind the body, so the shoulder disappears into it rather than sitting on top
    zIndex: type === 'arm' ? -1 : -2,
    limb, ...over,
  };
}

/** SVG's own default paint — what an icon that says nothing about colour is drawn in. */
const SVG_BLACK: ColorStop = { r: 20, g: 19, b: 24, a: 1 };

/**
 * An SVG as a real layer, never a picture pasted on top.
 *
 * One path becomes a normal shape layer whose outline IS that path — editable anchors,
 * morphable, keyframeable like any other shape. Several become one vector layer that
 * keeps their arrangement and their own colours. The original markup is kept either way,
 * and anything that could not be carried over is returned as a warning to show, not
 * dropped in silence. Null when the text is not an SVG at all.
 */
export function makeSvgLayer(text: string, name?: string): { node: RigNode; warnings: string[] } | null {
  const raw = parseSvg(text);
  const imp = importSvg(text);
  if (!raw || !imp) return null;
  const warnings = [...imp.unsupported];
  const [, , vw, vh] = raw.viewBox.split(/[\s,]+/).map(Number);
  const w0 = imp.width || vw || 100, h0 = imp.height || vh || 100;
  // the longest side at 150px: big enough to grab, small enough to sit beside the mascot
  const k = 150 / Math.max(w0, h0, 1e-6);
  const size = { x: Math.round(w0 * k), y: Math.round(h0 * k) };
  const mean = Math.sqrt(size.x * size.y);
  // currentColor artwork is meant to be tinted: start it in something the dark stage shows
  const color = imp.fill ?? (imp.tinted ? LIMB_FILL : SVG_BLACK);
  const stroke = imp.stroke
    ? { enabled: true, color: imp.stroke.color ?? color, width: Math.round(imp.stroke.width * mean * 10) / 10, lineCap: 'round' as const, lineJoin: 'round' as const }
    : undefined;
  const base: RigNode = {
    id: uid('svg'), name: (name ?? '').trim().slice(0, 32) || 'SVG Layer', kind: 'svgLayer', parentId: null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 200, y: -160 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1 },
    size, color, visible: true, zIndex: 0,
    svg: { sourceMarkup: raw.markup, viewBox: raw.viewBox },
    ...(stroke ? { stroke } : {}),
  };
  if (!imp.paths.length) {
    warnings.push('nothing in it could be read as vector shapes — it is shown as the original picture, which the Lottie export cannot carry');
    return { node: base, warnings };
  }
  if (imp.paths.length === 1) {
    const only = imp.paths[0];
    return {
      warnings,
      node: {
        ...base, kind: 'primitive', primitive: { shape: 'pill' }, shapePath: only.d,
        color: only.fill ?? color,
        ...(only.fill === null ? { fill: { enabled: false } } : {}),
        ...(only.stroke ? { stroke: { enabled: true, color: only.stroke, width: Math.round((only.strokeWidth ?? 0.02) * mean * 10) / 10, lineCap: 'round', lineJoin: 'round' } } : {}),
      },
    };
  }
  return { node: { ...base, svg: { ...base.svg!, paths: imp.paths, ...(warnings.length ? { unsupported: warnings } : {}) } }, warnings };
}

/** A container: draws nothing, carries its children through its own move, turn and scale. */
export function makeGroup(parentId: string | null, over: Partial<RigNode> = {}): RigNode {
  return {
    id: uid('grp'), name: 'Group', kind: 'group', parentId,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    // zero size, so nothing mapped can ever be placed on a group's "sphere"
    size: { x: 0, y: 0 }, color: SHAPE_FILL, visible: true, zIndex: 0, ...over,
  };
}

// ---------------------------------------------------------------------------
// order: `zIndex` is the only draw order there is

/** Every layer, back to front — the order the stage paints and the exporter writes. */
export function layerOrder(rig: Rig): RigNode[] {
  // Array.prototype.sort is stable, so ties keep their insertion order
  return Object.values(rig.nodes).sort((a, b) => a.zIndex - b.zIndex);
}

export const topZ = (rig: Rig) => Math.max(0, ...Object.values(rig.nodes).map((n) => n.zIndex)) + 1;

/** Renumber 0..n-1 in the current order, so "one step forward" is always one layer. */
function denseZ(rig: Rig): void {
  layerOrder(rig).forEach((n, i) => { n.zIndex = i; });
}

export type ReorderTo = 'front' | 'back' | 'forward' | 'backward' | number;

/**
 * Move a layer in the one draw order. A number is its target position back-to-front.
 * Children are not dragged along: a layer's place in the order is its own, which is what
 * lets a hand go behind the body while the eyes stay in front of it.
 */
export function reorderLayer(p: Project, id: string, to: ReorderTo): void {
  const order = layerOrder(p.rig);
  const i = order.findIndex((n) => n.id === id);
  if (i < 0) return;
  const j = to === 'front' ? order.length - 1 : to === 'back' ? 0
    : to === 'forward' ? i + 1 : to === 'backward' ? i - 1 : Math.round(to);
  const [n] = order.splice(i, 1);
  order.splice(Math.max(0, Math.min(order.length, j)), 0, n);
  order.forEach((x, k) => { x.zIndex = k; });
}

// ---------------------------------------------------------------------------
// membership

const descendants = (rig: Rig, id: string): string[] => {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const n of Object.values(rig.nodes)) if (n.parentId === pid && !out.includes(n.id)) { out.push(n.id); walk(n.id); }
  };
  walk(id);
  return out;
};

/** Whether `id` sits anywhere under `ancestor`. */
export const isInside = (rig: Rig, id: string, ancestor: string) => descendants(rig, ancestor).includes(id);

/**
 * Delete a layer and everything under it, everywhere it is referenced: its tracks, its
 * effects and its appearance ranges on every timeline, an eye linked to it, and an
 * emitter pinned to it (which falls back to the body centre rather than to nothing).
 */
export function removeLayer(p: Project, id: string): Set<string> {
  if (id === p.rig.rootId || !p.rig.nodes[id]) return new Set();
  const doomed = new Set([id, ...descendants(p.rig, id)]);
  for (const d of doomed) delete p.rig.nodes[d];
  for (const n of Object.values(p.rig.nodes)) if (n.eye?.linkedToId && doomed.has(n.eye.linkedToId)) n.eye.linkedToId = null;
  for (const tl of p.timelines) {
    tl.tracks = tl.tracks.filter((t) => !doomed.has(t.nodeId));
    tl.modifiers = tl.modifiers.filter((m) => !doomed.has(m.nodeId));
    if (tl.appearances) tl.appearances = tl.appearances.filter((a) => !doomed.has(a.nodeId));
    for (const e of tl.emitters ?? []) {
      if (e.from.nodeId && doomed.has(e.from.nodeId)) delete e.from.nodeId;
      if (e.to.nodeId && doomed.has(e.to.nodeId)) delete e.to.nodeId;
    }
  }
  return doomed;
}

/**
 * A copy of a layer (and anything inside it), placed just above the original and nudged
 * off it so it can be seen. Its animation comes too — on every timeline, with its own
 * keyframe ids, so editing the copy never touches the original.
 */
export function duplicateLayer(p: Project, id: string): string | null {
  const src = p.rig.nodes[id];
  if (!src || id === p.rig.rootId) return null;
  const ids = [id, ...descendants(p.rig, id)];
  const map = new Map(ids.map((o) => [o, uid(p.rig.nodes[o].kind === 'limb' ? 'limb' : 'n')]));
  const names = new Set(Object.values(p.rig.nodes).map((n) => n.name));
  for (const o of ids) {
    const n = structuredClone(p.rig.nodes[o]);
    n.id = map.get(o)!;
    if (n.parentId && map.has(n.parentId)) n.parentId = map.get(n.parentId)!;
    if (n.eye?.linkedToId && map.has(n.eye.linkedToId)) n.eye.linkedToId = map.get(n.eye.linkedToId)!;
    n.zIndex += 0.5;
    if (o === id) {
      let name = `${src.name} copy`, k = 2;
      while (names.has(name)) name = `${src.name} copy ${k++}`;
      n.name = name;
      if (n.limb) for (const pt of [n.limb.a, n.limb.b, n.limb.c]) { if (pt) { pt.x += 16; pt.y += 16; } }
      else if (n.surface.mapped) n.surface.yaw += 10;
      else n.surface.flatOffset = { x: (n.surface.flatOffset?.x ?? 0) + 16, y: (n.surface.flatOffset?.y ?? 0) + 16 };
    }
    p.rig.nodes[n.id] = n;
  }
  denseZ(p.rig);
  for (const tl of p.timelines) {
    for (const t of tl.tracks.filter((x) => map.has(x.nodeId))) {
      tl.tracks.push({ ...t, id: uid('t'), nodeId: map.get(t.nodeId)!, keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k') })) });
    }
    for (const a of (tl.appearances ?? []).filter((x) => map.has(x.nodeId))) {
      tl.appearances!.push({ ...a, id: uid('ap'), nodeId: map.get(a.nodeId)! });
    }
  }
  return map.get(id)!;
}

// ---------------------------------------------------------------------------
// writing a value where it will actually show

/**
 * Put `v` on a property so it is what renders at `atMs`: into the keyframe track driving
 * it there, when there is one, or onto the layer's resting value when there is not.
 * Writing the base value under a live track would change nothing on screen.
 */
export function writeValue(p: Project, nodeId: string, path: string, v: KeyValue, atMs: number): void {
  const track = activeTrackFor(activeTimeline(p), nodeId, path, atMs);
  if (track) {
    const k = track.keyframes.find((x) => Math.abs(x.time - atMs) < 1);
    if (k) k.value = v;
    else {
      track.keyframes.push({ id: uid('k'), time: atMs, value: v, easingOut: { type: 'preset', name: 'easeInOut' } });
      track.keyframes.sort((a, b) => a.time - b.time);
    }
    return;
  }
  const node = p.rig.nodes[nodeId];
  if (node) setProp(node, path, v);
}

// ---------------------------------------------------------------------------
// attachment: which frame a layer lives in

export type AttachMode = 'world' | 'mascot';
export const attachmentOf = (node: RigNode): AttachMode => (node.parentId === null ? 'world' : 'mascot');

/**
 * Re-parent a layer WITHOUT it moving on screen.
 *
 * The layer's position, size and angle are read off the frame it is drawn in now, at
 * `atMs`, and re-expressed in the new parent's frame — the same frames `buildScene`
 * used, so the round trip is exact rather than a guess. Onto the body it lands on the
 * sphere (yaw/pitch) when it sits over the silhouette, and as a flat offset when it hangs
 * off the edge. Returns false for a move that would make a cycle.
 */
export function placeUnder(p: Project, id: string, parentId: string | null, atMs: number, onSurface = true): boolean {
  const rig = p.rig;
  const node = rig.nodes[id];
  if (!node || id === rig.rootId) return false;
  if (parentId !== null && (!rig.nodes[parentId] || parentId === id || isInside(rig, parentId, id))) return false;
  if (node.parentId === parentId) return true;

  const frames = new Map<string, LayerFrame>();
  const evaluated = evaluateRig(p, atMs);
  buildScene(evaluated, compOf(p), frames);
  const oldParent = frames.get(node.parentId ?? WORLD);
  const target = frames.get(parentId ?? WORLD);
  const mine = frames.get(id);
  const ev = evaluated.nodes[id];
  node.parentId = parentId;
  if (!oldParent || !target || !ev) return true;

  if (node.limb && ev.limb) {
    // a limb's points ARE its position: carry each one through the screen into the new frame
    for (const k of ['a', 'b', 'c'] as const) {
      const pt = ev.limb[k];
      if (!pt) continue;
      const local = fromFrame(target, toFrame(oldParent, pt));
      writeValue(p, id, `limb.${k}.x`, r2(local.x), atMs);
      writeValue(p, id, `limb.${k}.y`, r2(local.y), atMs);
    }
    return true;
  }
  if (!mine) return true;   // not drawn right now (hidden, behind the rim) — nothing to keep

  const screen: Vec2 = { x: mine.x, y: mine.y };
  let mapped = false;
  if (onSurface && parentId === rig.rootId && target.R > 0) {
    const r = (-target.rot * Math.PI) / 180;
    const dx = screen.x - target.x, dy = screen.y - target.y;
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (target.squash || 1);
    if (Math.hypot(lx, ly) < target.R * 0.96) {
      const s = screenToSurface(lx, ly, evaluated, target.R, target.head);
      node.surface.mapped = true;
      writeValue(p, id, 'surface.yaw', r2(s.x - (node.eye?.distanceFromCenter ?? 0)), atMs);
      writeValue(p, id, 'surface.pitch', r2(s.y), atMs);
      writeValue(p, id, 'flatOffset.x', 0, atMs);
      writeValue(p, id, 'flatOffset.y', 0, atMs);
      mapped = true;
    }
  }
  if (!mapped) {
    node.surface.mapped = false;
    const local = fromFrame(target, screen);
    writeValue(p, id, 'flatOffset.x', r2(local.x), atMs);
    writeValue(p, id, 'flatOffset.y', r2(local.y), atMs);
  }
  // keep its drawn size and angle: undo the scale and roll it is about to inherit
  const k = mine.parentCum / (target.cum || 1);
  if (Math.abs(k - 1) > 1e-6) {
    writeValue(p, id, 'transform.scale.x', r2(ev.transform.scale.x * k * 1000) / 1000, atMs);
    writeValue(p, id, 'transform.scale.y', r2(ev.transform.scale.y * k * 1000) / 1000, atMs);
  }
  const rot = ((mine.rot - target.rot + 540) % 360) - 180;
  writeValue(p, id, 'transform.rotation', r2(rot), atMs);
  return true;
}

/** World ↔ mascot, keeping the layer exactly where it is. `anchor` defaults to the body. */
export function setAttachment(p: Project, id: string, mode: AttachMode, anchorId: string | undefined, atMs: number): boolean {
  const parent = mode === 'world' ? null
    : anchorId && p.rig.nodes[anchorId] && anchorId !== id ? anchorId : p.rig.rootId;
  return placeUnder(p, id, parent, atMs);
}

/** Put several layers in one group, at their centre, none of them moving. */
export function groupLayers(p: Project, ids: string[], atMs: number): string | null {
  const members = ids.filter((id) => p.rig.nodes[id] && id !== p.rig.rootId);
  if (!members.length) return null;
  const parentId = p.rig.nodes[members[0]].parentId;
  const frames = new Map<string, LayerFrame>();
  buildScene(evaluateRig(p, atMs), compOf(p), frames);
  const at = members.map((id) => frames.get(id)).filter((f): f is LayerFrame => !!f);
  const parentFrame = frames.get(parentId ?? WORLD);
  const centre = at.length ? { x: at.reduce((s, f) => s + f.x, 0) / at.length, y: at.reduce((s, f) => s + f.y, 0) / at.length } : null;
  const local = parentFrame && centre ? fromFrame(parentFrame, centre) : { x: 0, y: 0 };
  const g = makeGroup(parentId, {
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: r2(local.x), y: r2(local.y) } },
    zIndex: Math.max(...members.map((id) => p.rig.nodes[id].zIndex)),
  });
  p.rig.nodes[g.id] = g;
  for (const id of members) placeUnder(p, id, g.id, atMs, false);
  denseZ(p.rig);
  return g.id;
}

/** The opposite: children move up to the group's parent where they stand, the group goes. */
export function ungroupLayer(p: Project, id: string, atMs: number): void {
  const g = p.rig.nodes[id];
  if (!g || g.kind !== 'group') return;
  for (const c of Object.values(p.rig.nodes).filter((n) => n.parentId === id)) placeUnder(p, c.id, g.parentId, atMs, false);
  removeLayer(p, id);
}

// ---------------------------------------------------------------------------
// shape morph

/**
 * How the shape keyframe at (or just before) `atMs` becomes the next one, and optionally
 * how long that takes — by moving the NEXT keyframe, since a morph's duration is simply
 * the gap between the two shapes. Returns false when there is no shape keyframe to set.
 */
export function setMorph(p: Project, nodeId: string, atMs: number, mode: MorphMode, durationMs?: number): boolean {
  const track = activeTrackFor(activeTimeline(p), nodeId, 'shape.path', atMs);
  if (!track?.keyframes.length) return false;
  const ks = track.keyframes;
  let i = ks.length - 1;
  while (i > 0 && ks[i].time > atMs + 1) i--;
  ks[i].easingOut = structuredClone(MORPH_MODES[mode].easing) as EasingCurve;
  const next = ks[i + 1];
  if (next && durationMs !== undefined && Number.isFinite(durationMs)) {
    const limit = ks[i + 2]?.time ?? Infinity;
    next.time = Math.round(Math.min(limit - 1, ks[i].time + Math.max(20, durationMs)));
  }
  return true;
}

// ---------------------------------------------------------------------------
// appearance

export interface AppearanceRange { startMs?: number; endMs?: number; fadeInMs?: number; fadeOutMs?: number }

/**
 * Set when a layer is on screen in the active timeline, in ABSOLUTE timeline ms.
 *
 * Edits the range the playhead is in (or the layer's first), converting into that
 * range's own scope — a range that came with a clip stays relative to the clip, so
 * moving the clip still moves the sticker with it. With none, a timeline-wide one is
 * made. `null` removes them all: the layer is simply always there again.
 */
export function setAppearance(p: Project, nodeId: string, range: AppearanceRange | null, atMs: number, entryId?: string): void {
  const tl = activeTimeline(p);
  if (range === null) {
    if (tl.appearances) tl.appearances = tl.appearances.filter((a) => a.nodeId !== nodeId || (entryId !== undefined && a.id !== entryId));
    return;
  }
  const spans = appearanceSpans(tl, nodeId);
  // the one being dragged, when the caller knows; else the one under the playhead
  const hit = spans.find((s) => s.entry.id === entryId) ?? spans.find((s) => atMs >= s.from && atMs <= s.to) ?? spans[0];
  let entry = hit?.entry;
  const origin = hit?.origin ?? 0;
  if (!entry) { entry = { id: uid('ap'), nodeId }; (tl.appearances ??= []).push(entry); }
  const rel = (v: number | undefined) => (v === undefined ? undefined : Math.max(0, Math.round(v - origin)));
  if ('startMs' in range) entry.startMs = rel(range.startMs);
  if ('endMs' in range) entry.endMs = rel(range.endMs);
  if (entry.startMs !== undefined && entry.endMs !== undefined && entry.endMs < entry.startMs + 20) entry.endMs = entry.startMs + 20;
  if ('fadeInMs' in range) entry.fadeInMs = range.fadeInMs === undefined ? undefined : Math.max(0, Math.round(range.fadeInMs));
  if ('fadeOutMs' in range) entry.fadeOutMs = range.fadeOutMs === undefined ? undefined : Math.max(0, Math.round(range.fadeOutMs));
}
