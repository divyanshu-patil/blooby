import { uid } from './id';
import { compOf } from './comp';
import { mapPath, pathSampler, primitivePath, SHAPE_LABEL } from './path';
import { importSvg, parseSvg } from './svg';
import { restLength } from './limb';
import { screenToSurface } from './curvature';
import { getProp, setProp } from './props';
import { activeTrackFor, appearanceSpans, buildScene, evaluateRig, fromFrame, pinned, toFrame, WORLD, type LayerFrame } from './scene';
import { hoseInputOf } from './limb';
import { activeTimeline } from './types';
import { MORPH_MODES, type MorphMode } from './easing';
import { relayoutBlocks } from './timeline';
import { faceOf, instantiateTemplate, laneOfMascot, makeMascot, mascotOf, mascotsOf, nextMascotName, partOf, roleOf, type MascotKind } from './mascot';
import { curveToPath, type CurvePoint } from './curve';
import { TEXT_DEFAULTS } from './text';
import type { ColorStop, CurveType, EasingCurve, KeyValue, MascotTemplate, Project, Rig, RigNode, ShapeKind, TextStyle, Vec2 } from './types';

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
    // the part it plays, so a preset that waves 'armR' waves this arm on any mascot
    role: `${type}${s < 0 ? 'L' : 'R'}`,
    surface: { yaw: 0, pitch: 0, mapped: false },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 1, y: 1 }, color: LIMB_FILL, visible: true,
    // tucked behind the body, so the shoulder disappears into it rather than sitting on top
    zIndex: type === 'arm' ? -1 : -2,
    limb, ...over,
  };
}

/**
 * A pair of limbs for one mascot, sized to its body — only the sides it does not have yet
 * (by role, or by an older role-less limb on that side), or one more on the right when it
 * has both.
 */
export function makeLimbPair(rig: Rig, mascotId: string, type: 'arm' | 'leg'): RigNode[] {
  const body = rig.nodes[mascotId];
  const k = (body?.size.x ?? 148) / 148;
  const has = (s: -1 | 1) => !!partOf(rig, mascotId, `${type}${s < 0 ? 'L' : 'R'}`)
    || Object.values(rig.nodes).some((n) => n.limb?.type === type && Math.sign(n.limb.a.x) === s && isInside(rig, n.id, mascotId));
  const sides = ([-1, 1] as const).filter((s) => !has(s));
  return (sides.length ? sides : [1 as const]).map((s) => {
    const l = makeLimb(type, s, limbParent(rig, mascotId, type));
    if (l.limb && k !== 1) {
      for (const pt of [l.limb.a, l.limb.b, l.limb.c]) if (pt) { pt.x *= k; pt.y *= k; }
      l.limb.length *= k;
      l.limb.thickness *= k;
    }
    return l;
  });
}

/** Hands ride the face when the mascot has one (they gesture with it); legs stay on the body. */
export const limbParent = (rig: Rig, mascotId: string, type: 'arm' | 'leg'): string =>
  (type === 'arm' && faceOf(rig, mascotId)) || mascotId;

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

/** A text layer's fill: light, for the dark stage the editor opens on. */
export const TEXT_FILL: ColorStop = { r: 246, g: 244, b: 239, a: 1 };

/** What a text layer is called in the list: its own words, shortened. */
export const textName = (content: string) => content.replace(/\s+/g, ' ').trim().slice(0, 24) || 'Text';

/**
 * A real text layer — editable words, never a picture of them. Centred on its anchor by
 * default, so it grows evenly both ways as it is typed into.
 */
export function makeTextLayer(content = 'Type something', over: Partial<RigNode> = {}, style: Partial<TextStyle> = {}): RigNode {
  return {
    id: uid('text'), name: textName(content), kind: 'text', parentId: null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: -240 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 1, y: 1 }, color: TEXT_FILL, visible: true, zIndex: 0,
    text: {
      content, font: { ...TEXT_DEFAULTS.font }, size: TEXT_DEFAULTS.size, lineHeight: TEXT_DEFAULTS.lineHeight,
      letterSpacing: TEXT_DEFAULTS.letterSpacing, align: 'center', valign: 'middle', ...style,
    },
    ...over,
  };
}

/** "Curve 1", "Curve 2" — the first `base N` no layer is already called. */
export function nextName(rig: Rig, base: string): string {
  const taken = new Set(Object.values(rig.nodes).map((n) => n.name));
  for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * A drawn curve as a layer: an outline with a stroke and no fill.
 *
 * `pts` are in the frame the layer will live in (px from the world's centre, for a world
 * layer), handles as offsets. The outline is stored in the layer's own box like every other
 * shape — so it keyframes, morphs and exports as one — at a single uniform scale, the
 * larger of its two extents, so a nearly flat line is not stretched to fill a square.
 */
export function makeCurveLayer(pts: CurvePoint[], opts: {
  closed?: boolean; type?: CurveType; name?: string; parentId?: string | null; guide?: boolean; color?: ColorStop; width?: number;
} = {}): RigNode | null {
  const clean = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) return null;
  const xs = clean.map((p) => p.x), ys = clean.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const s = Math.max(24, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const into = (v: Vec2) => ({ x: v.x / s, y: v.y / s });
  const unit: CurvePoint[] = clean.map((p) => ({
    x: (p.x - cx) / s, y: (p.y - cy) / s,
    ...(p.hin ? { hin: into(p.hin) } : {}), ...(p.hout ? { hout: into(p.hout) } : {}),
  }));
  const type = opts.type ?? (clean.some((p) => p.hin || p.hout) ? 'bezier' : 'smooth');
  const d = curveToPath({ points: unit, closed: !!opts.closed && clean.length > 2 }, type);
  if (!d) return null;
  return {
    id: uid('curve'), name: opts.name ?? 'Curve', kind: 'primitive', parentId: opts.parentId ?? null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: r2(cx), y: r2(cy) } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1 },
    size: { x: r2(s), y: r2(s) }, color: SHAPE_FILL, visible: true, zIndex: 0,
    primitive: { shape: 'pill' }, shapePath: d, curve: { type },
    fill: { enabled: false },
    stroke: { enabled: true, color: opts.color ?? SHAPE_FILL, width: opts.width ?? 4, lineCap: 'round', lineJoin: 'round' },
    ...(opts.guide ? { guide: true } : {}),
  };
}

/**
 * A drawn curve made a rubber hose: the same id, place and ink, now a limb through its start,
 * its middle and its end. The hose keeps the curve's length, so dragging an end bows or
 * straightens it rather than stretching it, and it pins like any limb. One way — undo reverts.
 */
export function curveToHose(p: Project, id: string): boolean {
  const n = p.rig.nodes[id];
  if (!n?.curve || !n.shapePath) return false;
  const off = n.surface.flatOffset ?? { x: 0, y: 0 };
  const rad = (n.transform.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const sx = n.size.x * n.transform.scale.x, sy = n.size.y * n.transform.scale.y;
  // the outline in the parent's frame — the frame a limb's points are in
  const sampler = pathSampler(mapPath(n.shapePath, (u) => ({ x: off.x + u.x * sx * cos - u.y * sy * sin, y: off.y + u.x * sx * sin + u.y * sy * cos })));
  if (!sampler || sampler.length < 1) return false;
  const at = (k: number) => { const q = sampler.at(sampler.length * k); return { x: r2(q.x), y: r2(q.y) }; };
  const a = at(0), b = at(0.5), c = at(1);
  const side = Math.sign((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) || 1;
  const ink = n.stroke?.color ?? n.color;
  n.kind = 'limb';
  n.limb = { type: 'arm', a, b, c, hose: 1, thickness: Math.max(2, n.stroke?.width ?? 4), bend: side, roundness: 1, taper: 0, length: r2(sampler.length) };
  n.color = ink;
  n.transform = { scale: { x: 1, y: 1 }, rotation: 0 };
  n.size = { x: 1, y: 1 };
  n.surface = { ...n.surface, flatOffset: undefined };
  delete n.curve; delete n.shapePath; delete n.primitive; delete n.shape; delete n.stroke; delete n.fill; delete n.trim;
  return true;
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
 * Move a layer in the one draw order. A number is its target position back-to-front,
 * counted among the layers it is not carrying.
 *
 * Children are not dragged along: a layer's place in the order is its own, which is what
 * lets a hand go behind the body while the eyes stay in front of it. A MASCOT is the
 * exception — it is a group of layers, and moves as one, its parts keeping their places
 * relative to each other, so sending the second mascot to the back does not leave its
 * eyes floating in front of the first.
 */
export function reorderLayer(p: Project, id: string, to: ReorderTo): void {
  const node = p.rig.nodes[id];
  if (!node) return;
  const order = layerOrder(p.rig);
  const carried = new Set(node.kind === 'body' ? [id, ...descendants(p.rig, id)] : [id]);
  const chunk = order.filter((n) => carried.has(n.id));
  const rest = order.filter((n) => !carried.has(n.id));
  // where the chunk sits now, counted in the layers it is not carrying
  const first = order.findIndex((n) => carried.has(n.id));
  const i = order.slice(0, first).filter((n) => !carried.has(n.id)).length;
  const j = to === 'front' ? rest.length : to === 'back' ? 0
    : to === 'forward' ? i + 1 : to === 'backward' ? i - 1 : Math.round(to);
  rest.splice(Math.max(0, Math.min(rest.length, j)), 0, ...chunk);
  rest.forEach((x, k) => { x.zIndex = k; });
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

/** A mascot's own part — an eye, a limb, anything playing a role — rather than something hung on it. */
const isOwnPart = (n: RigNode) => n.kind === 'eye' || n.kind === 'limb' || roleOf(n) !== undefined;

/**
 * Delete a layer and everything under it, everywhere it is referenced: its tracks, its
 * effects and its appearance ranges on every timeline, an eye linked to it, and an
 * emitter pinned to it (which falls back to the body centre rather than to nothing).
 *
 * A mascot takes its own parts and its lane of clips with it, but not what was hung on
 * it: a hat, a caption, a mascot following it all stay where they are, in the world. And
 * a text that followed a deleted path goes back to a straight line.
 */
export function removeLayer(p: Project, id: string, atMs = 0): Set<string> {
  const node = p.rig.nodes[id];
  if (id === p.rig.rootId || !node) return new Set();
  if (node.kind === 'body') {
    for (const c of Object.values(p.rig.nodes)) if (c.parentId === id && !isOwnPart(c)) placeUnder(p, c.id, null, atMs);
    for (const tl of p.timelines) {
      const gone = new Set(tl.blocks.filter((b) => b.mascotId === id).map((b) => b.id));
      if (!gone.size) continue;
      tl.tracks = tl.tracks.filter((t) => !t.blockId || !gone.has(t.blockId));
      relayoutBlocks(tl, tl.blocks.filter((b) => !gone.has(b.id)));
    }
  }
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
  for (const n of Object.values(p.rig.nodes)) {
    if (n.text?.path?.nodeId && doomed.has(n.text.path.nodeId)) n.text.path = { ...n.text.path, mode: 'straight', nodeId: undefined };
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
  if (!src) return null;
  const mascot = src.kind === 'body';
  const lane = laneOfMascot(p.rig, id);
  const ids = [id, ...descendants(p.rig, id)];
  const map = new Map(ids.map((o) => [o, uid(p.rig.nodes[o].kind === 'limb' ? 'limb' : mascot && o === id ? 'm' : 'n')]));
  const names = new Set(Object.values(p.rig.nodes).map((n) => n.name));
  const mascotName = mascot ? nextMascotName(p.rig) : '';
  for (const o of ids) {
    const orig = p.rig.nodes[o];
    const n = structuredClone(orig);
    n.id = map.get(o)!;
    // the copy's parts still play their parts, so presets land on them too
    const role = roleOf(orig);
    if (role) n.role = role;
    if (n.parentId && map.has(n.parentId)) n.parentId = map.get(n.parentId)!;
    if (n.eye?.linkedToId && map.has(n.eye.linkedToId)) n.eye.linkedToId = map.get(n.eye.linkedToId)!;
    n.zIndex += 0.5;
    if (o === id) {
      let name = `${src.name} copy`, k = 2;
      while (names.has(name)) name = `${src.name} copy ${k++}`;
      n.name = mascot ? mascotName : name;
      // a mascot steps well clear of itself; anything else is nudged just off the original
      const step = mascot ? 230 : 16;
      if (n.limb) for (const pt of [n.limb.a, n.limb.b, n.limb.c]) { if (pt) { pt.x += 16; pt.y += 16; } }
      else if (n.surface.mapped) n.surface.yaw += 10;
      else n.surface.flatOffset = { x: (n.surface.flatOffset?.x ?? 0) + step, y: (n.surface.flatOffset?.y ?? 0) + (mascot ? 0 : step) };
    }
    p.rig.nodes[n.id] = n;
  }
  denseZ(p.rig);
  const copies = new Set(map.values());
  for (const tl of p.timelines) {
    for (const t of tl.tracks.filter((x) => map.has(x.nodeId))) {
      tl.tracks.push({ ...t, id: uid('t'), nodeId: map.get(t.nodeId)!, keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k') })) });
    }
    for (const a of (tl.appearances ?? []).filter((x) => map.has(x.nodeId))) {
      tl.appearances!.push({ ...a, id: uid('ap'), nodeId: map.get(a.nodeId)! });
    }
    if (!mascot) continue;
    // A copied mascot gets its own lane: every clip of the original's, same timing, so it
    // plays the same animation — and can then be given different clips of its own.
    const bmap = new Map(tl.blocks.filter((b) => (b.mascotId ?? '') === lane).map((b) => [b.id, uid('b')]));
    for (const b of tl.blocks.filter((x) => bmap.has(x.id))) tl.blocks.push({ ...b, id: bmap.get(b.id)!, mascotId: map.get(id)! });
    for (const t of tl.tracks) if (copies.has(t.nodeId) && t.blockId && bmap.has(t.blockId)) t.blockId = bmap.get(t.blockId);
    for (const m of tl.modifiers.filter((x) => map.has(x.nodeId))) {
      tl.modifiers.push({ ...m, id: uid('m'), nodeId: map.get(m.nodeId)!, ...(m.blockId && bmap.has(m.blockId) ? { blockId: bmap.get(m.blockId) } : {}) });
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
  const track = activeTrackFor(activeTimeline(p), nodeId, path, atMs, p.rig);
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
  if (!node) return false;
  // a mascot — the first one included — follows another mascot or stands in the world; it
  // is never a sticker on a shape. And nothing may end up inside itself: A → B → A is refused.
  const toMascot = parentId !== null && rig.nodes[parentId]?.kind === 'body';
  if ((node.kind === 'body' || id === rig.rootId) && parentId !== null && !toMascot) return false;
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
  // onto any mascot's sphere — but a mascot following another stays flat beside it
  if (onSurface && toMascot && node.kind !== 'body' && target.R > 0) {
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
// mascots: a body and its parts, instanced from core/mascot.ts

/**
 * A new mascot on top of everything, standing where it can be seen: in the widest gap
 * between the mascots already there, kept inside the canvas. Returns its body id.
 */
export function addMascot(p: Project, kind: MascotKind | MascotTemplate, opts: { name?: string; x?: number; y?: number; id?: string } = {}): string {
  const reach = Math.max(0, compOf(p).width / 2 - 100);
  const taken = mascotsOf(p.rig).filter((m) => m.parentId === null).map((m) => m.surface.flatOffset?.x ?? 0);
  // the spot furthest from every mascot already standing — the right edge first on a tie
  let x = opts.x ?? 0;
  if (opts.x === undefined && taken.length) {
    let best = -1;
    for (let c = reach; c >= -reach; c -= 10) {
      const gap = Math.min(...taken.map((t) => Math.abs(t - c)));
      if (gap > best + 1e-9) { best = gap; x = c; }
    }
  }
  const name = opts.name?.trim() || nextMascotName(p.rig);
  const nodes = typeof kind === 'string'
    ? makeMascot(kind, { name, x, y: opts.y ?? 0, id: opts.id })
    : instantiateTemplate(kind.nodes, { name, x, y: opts.y ?? 0 });
  if (!nodes.length) return '';
  const z = topZ(p.rig);
  // its limbs tuck behind its own body, the rest sit on it — all above every other mascot
  const limbs = nodes.filter((x2) => x2.kind === 'limb').length;
  nodes.forEach((node) => {
    node.zIndex = z + limbs + (node.kind === 'limb' ? node.zIndex : node.kind === 'body' ? 0 : 1);
    p.rig.nodes[node.id] = node;
  });
  denseZ(p.rig);
  return nodes[0].id;
}

/** A mascot kept for reuse — its body and its own parts, not what is hung on it. */
export function saveMascotTemplate(p: Project, bodyId: string, name?: string): string | null {
  const body = p.rig.nodes[bodyId];
  if (body?.kind !== 'body') return null;
  const parts = descendants(p.rig, bodyId).map((i) => p.rig.nodes[i]).filter(isOwnPart);
  const nodes = [body, ...parts].map((n) => {
    const c = structuredClone(n);
    const role = roleOf(n);
    if (role) c.role = role;
    return c;
  });
  const t: MascotTemplate = { id: uid('mt'), name: name?.trim() || body.name, nodes };
  (p.mascotTemplates ??= []).push(t);
  return t.id;
}

// ---------------------------------------------------------------------------
// shape morph

/**
 * How the shape keyframe at (or just before) `atMs` becomes the next one, and optionally
 * how long that takes — by moving the NEXT keyframe, since a morph's duration is simply
 * the gap between the two shapes. Returns false when there is no shape keyframe to set.
 */
export function setMorph(p: Project, nodeId: string, atMs: number, mode: MorphMode, durationMs?: number): boolean {
  const track = activeTrackFor(activeTimeline(p), nodeId, 'shape.path', atMs, p.rig);
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

// ---------------------------------------------------------------------------
// ownership: which state a new layer belongs to

/**
 * A layer made while a state is open belongs to that state.
 *
 * Nodes live on the rig, which every timeline shares — so a hand drawn in "Happy" used to
 * be on screen in "Idle" too: nothing said it was Happy's. Now it is `ranged` (absent from
 * any timeline with no range for it) with one whole-timeline range on the active one. It is
 * still one node, so a state transition can blend through it, just never visibly in a state
 * that does not own it. Unticking "only in its ranges" shares it with every state again.
 */
export function ownLayer(p: Project, id: string): void {
  const n = p.rig.nodes[id];
  if (!n) return;
  n.ranged = true;
  const tl = activeTimeline(p);
  if (!(tl.appearances ?? []).some((a) => a.nodeId === id)) (tl.appearances ??= []).push({ id: uid('ap'), nodeId: id });
}

// ---------------------------------------------------------------------------
// faces

/**
 * Move layers under a new parent without anything moving on screen — mapped ones (the eyes)
 * included, which stay on the sphere: the face hands down the head's radius, so only the
 * difference in origin is left to take up, as a flat nudge in the new frame.
 */
function adopt(p: Project, ids: string[], parentId: string, atMs: number): void {
  const frames = () => { const f = new Map<string, LayerFrame>(); buildScene(evaluateRig(p, atMs), compOf(p), f); return f; };
  const before = frames();
  const mapped = ids.filter((id) => p.rig.nodes[id]?.surface.mapped);
  for (const id of ids) if (!mapped.includes(id)) placeUnder(p, id, parentId, atMs, false);
  for (const id of mapped) p.rig.nodes[id].parentId = parentId;
  if (!mapped.length) return;
  const after = frames();
  const f = after.get(parentId);
  for (const id of mapped) {
    const a = before.get(id), b = after.get(id), node = p.rig.nodes[id];
    if (!a || !b || !f) continue;
    const r = (-f.rot * Math.PI) / 180, dx = a.x - b.x, dy = a.y - b.y;
    const fo = node.surface.flatOffset ?? { x: 0, y: 0 };
    writeValue(p, id, 'flatOffset.x', r2(fo.x + (dx * Math.cos(r) - dy * Math.sin(r)) / (f.kx || 1)), atMs);
    writeValue(p, id, 'flatOffset.y', r2(fo.y + (dx * Math.sin(r) + dy * Math.cos(r)) / (f.ky || 1)), atMs);
  }
}

/**
 * Make a layer its mascot's face, or (`on` false) an ordinary layer again.
 *
 * Any shape or group can be the face. It goes onto the mascot if it is not on one already
 * (the first, when it is in the world), takes over the eyes and hands from the old face —
 * whose group is dropped when that leaves it empty — and nothing moves on screen. Taking the
 * role away gives the eyes and hands back to the body.
 */
export function setFaceRole(p: Project, id: string, on: boolean, atMs: number): boolean {
  const node = p.rig.nodes[id];
  if (!node || node.kind === 'body' || node.kind === 'eye' || node.kind === 'limb' || node.kind === 'text') return false;
  const mascot = mascotOf(p.rig, id) ?? p.rig.nodes[p.rig.rootId];
  if (!mascot) return false;
  const current = faceOf(p.rig, mascot.id);
  const kidsOf = (pid: string) => Object.values(p.rig.nodes).filter((n) => n.parentId === pid && (n.kind === 'eye' || n.kind === 'limb' || roleOf(n))).map((n) => n.id);
  if (!on) {
    if (current !== id) return false;
    adopt(p, kidsOf(id), mascot.id, atMs);
    delete node.role;
    return true;
  }
  if (current === id) return true;
  if (node.parentId !== mascot.id) placeUnder(p, id, mascot.id, atMs, false);
  node.role = 'face';
  const moving = current ? kidsOf(current) : kidsOf(mascot.id).filter((k) => p.rig.nodes[k].kind === 'eye');
  adopt(p, moving.filter((k) => k !== id), id, atMs);
  if (current) {
    const old = p.rig.nodes[current];
    if (Object.values(p.rig.nodes).some((n) => n.parentId === current)) delete old.role;
    else removeLayer(p, current, atMs);
  }
  return true;
}

// ---------------------------------------------------------------------------
// pinned feet

/**
 * Plant a limb's end where it is now (`on`), or lift it (`on` false). See `pinLimbPoint`.
 */
export function pinLimb(p: Project, id: string, on: boolean, atMs: number): boolean {
  const l = p.rig.nodes[id]?.limb;
  if (!l) return false;
  return pinLimbPoint(p, id, l.c ? 'c' : 'b', on, atMs);
}

/**
 * Pin one point of a limb — a hip, a knee, a foot — where it is now in the WORLD (`on`), or
 * lift it (`on` false).
 *
 * Pinned, the body can move, turn, squash or scale and that point stays; the limb stretches
 * to reach it when it has to. Unpinning writes the pinned pose back into the limb's own points
 * at the playhead, so nothing jumps — it simply follows the body again from where it stands.
 * The end point is `limb.pin` (it carries the points between with it); any other is `limb.pins`.
 */
export function pinLimbPoint(p: Project, id: string, key: 'a' | 'b' | 'c', on: boolean, atMs: number): boolean {
  const node = p.rig.nodes[id];
  if (!node?.limb || (key === 'c' && !node.limb.c)) return false;
  const frames = new Map<string, LayerFrame>();
  const ev = evaluateRig(p, atMs);
  buildScene(ev, compOf(p), frames);
  const world = frames.get(WORLD), parent = frames.get(node.parentId ?? WORLD), l = ev.nodes[id]?.limb;
  if (!world || !parent || !l) return false;
  const keys = (l.c ? ['a', 'b', 'c'] : ['a', 'b']) as ('a' | 'b' | 'c')[];
  const isEnd = key === keys[keys.length - 1];
  const pts = pinned(hoseInputOf(l, (v) => toFrame(parent, v), 1), l, world).points;
  const i = keys.indexOf(key);
  if (on) {
    const w = fromFrame(world, pts[i]);
    const at = { x: r2(w.x), y: r2(w.y) };
    if (isEnd) node.limb.pin = at;
    else node.limb.pins = { ...node.limb.pins, [key]: at };
    return true;
  }
  const had = isEnd ? node.limb.pin : node.limb.pins?.[key];
  if (!had) return true;
  // write the whole pinned pose back, so the points this pin was carrying do not jump either
  keys.forEach((k, n) => {
    if (n === 0 && !node.limb!.pins?.a) return;
    const local = fromFrame(parent, pts[n]);
    writeValue(p, id, `limb.${k}.x`, r2(local.x), atMs);
    writeValue(p, id, `limb.${k}.y`, r2(local.y), atMs);
  });
  if (isEnd) delete node.limb.pin;
  else { delete node.limb.pins![key]; if (!Object.keys(node.limb.pins!).length) delete node.limb.pins; }
  return true;
}

// ---------------------------------------------------------------------------
// scale → base size

/**
 * Bake a mascot's current scale into its real size, so scale reads 1 again and nothing on
 * screen moves.
 *
 * Everything under the body was sized and placed THROUGH that scale, so it all has to take
 * the scale into its own numbers: offsets and limb points in the body's (or the face's)
 * frame per axis, since those frames stretch per axis; sizes, limb thickness and length, and
 * text size by the uniform part, since a child's own size scales uniformly. Keyframes on any
 * of those properties are scaled the same way on every timeline, and the body's own scale
 * keyframes are divided by what was baked, so an animated scale keeps its motion.
 */
export function applyScaleAsBase(p: Project, bodyId: string, atMs: number): boolean {
  const body = p.rig.nodes[bodyId];
  if (body?.kind !== 'body') return false;
  const ev = evaluateRig(p, atMs).nodes[bodyId];
  const sx = ev?.transform.scale.x ?? 1, sy = ev?.transform.scale.y ?? 1;
  if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return false;
  if (sx <= 0 || sy <= 0) return false;
  const k = Math.sqrt(sx * sy);
  const round = (v: number) => Math.round(v * 1000) / 1000;

  // which factor a property takes on a node — undefined when it is not a length at all
  const perAxisFrame = (n: RigNode) => {
    const parent = n.parentId ? p.rig.nodes[n.parentId] : undefined;
    return parent?.id === bodyId || (parent?.role === 'face' && parent.kind === 'group' && parent.parentId === bodyId);
  };
  const factor = (n: RigNode, path: string): number | undefined => {
    if (n.id === bodyId) {
      if (path === 'size.x' || path === 'anchor.x') return sx;
      if (path === 'size.y' || path === 'anchor.y') return sy;
      return undefined;
    }
    const axis = perAxisFrame(n);
    if (path === 'flatOffset.x' || /^limb\.[abc]\.x$/.test(path)) return axis ? sx : k;
    if (path === 'flatOffset.y' || /^limb\.[abc]\.y$/.test(path)) return axis ? sy : k;
    if (['size.x', 'size.y', 'anchor.x', 'anchor.y', 'limb.length', 'limb.thickness', 'limb.foot.length', 'limb.foot.width', 'text.size'].includes(path)) return k;
    return undefined;
  };
  const paths = ['size.x', 'size.y', 'anchor.x', 'anchor.y', 'flatOffset.x', 'flatOffset.y', 'limb.a.x', 'limb.a.y', 'limb.b.x', 'limb.b.y',
    'limb.c.x', 'limb.c.y', 'limb.length', 'limb.thickness', 'limb.foot.length', 'limb.foot.width', 'text.size'];

  const nodes = [bodyId, ...descendants(p.rig, bodyId)].map((id) => p.rig.nodes[id]);
  const frameBefore = (() => { const f = new Map<string, LayerFrame>(); buildScene(evaluateRig(p, atMs), compOf(p), f); return f; })();
  if (body.size.y === 0) body.size.y = body.size.x;
  for (const n of nodes) {
    for (const path of paths) {
      const f = factor(n, path);
      if (f === undefined) continue;
      // a mapped layer's offset is a nudge in the frame, and a flat one's is its position:
      // both ride the frame's stretch, so both take it
      const v = getProp(n, path);
      if (typeof v === 'number' && (path !== 'flatOffset.x' && path !== 'flatOffset.y' || n.surface.flatOffset)) setProp(n, path, round(v * f));
      for (const tl of p.timelines) {
        for (const t of tl.tracks) {
          if (t.nodeId !== n.id || t.property !== path) continue;
          for (const kf of t.keyframes) if (typeof kf.value === 'number') kf.value = round(kf.value * f);
        }
      }
    }
  }
  // the scale itself: what was baked comes out of the base and out of every scale key
  body.transform.scale = { x: round(body.transform.scale.x / sx), y: round(body.transform.scale.y / sy) };
  for (const tl of p.timelines) {
    for (const t of tl.tracks) {
      if (t.nodeId !== bodyId || (t.property !== 'transform.scale.x' && t.property !== 'transform.scale.y')) continue;
      const d = t.property === 'transform.scale.x' ? sx : sy;
      for (const kf of t.keyframes) if (typeof kf.value === 'number') kf.value = round(kf.value / d);
    }
  }
  // Scaling about an anchor moves the centre, and at scale 1 that move is gone: put the body
  // back where it was drawn, in the frame it stands in, keyframes and all.
  const after = new Map<string, LayerFrame>();
  buildScene(evaluateRig(p, atMs), compOf(p), after);
  const was = frameBefore.get(bodyId), now = after.get(bodyId), parent = after.get(body.parentId ?? WORLD);
  if (was && now && parent) {
    const r = (-parent.rot * Math.PI) / 180, dx = was.x - now.x, dy = was.y - now.y;
    const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / (parent.kx || 1), ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (parent.ky || 1);
    const fo = body.surface.flatOffset ?? { x: 0, y: 0 };
    body.surface.flatOffset = { x: round(fo.x + lx), y: round(fo.y + ly) };
    for (const tl of p.timelines) {
      for (const t of tl.tracks) {
        if (t.nodeId !== bodyId || (t.property !== 'flatOffset.x' && t.property !== 'flatOffset.y')) continue;
        const d = t.property === 'flatOffset.x' ? lx : ly;
        for (const kf of t.keyframes) if (typeof kf.value === 'number') kf.value = round(kf.value + d);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// roles

/** Every part a layer can play, and what it is called. '' is an ordinary layer. */
export const ROLE_LABEL: Record<string, string> = {
  '': 'Normal', body: 'Mascot body', face: 'Face', eyeL: 'Left eye', eyeR: 'Right eye',
  armL: 'Left hand', armR: 'Right hand', legL: 'Left leg', legR: 'Right leg',
};

/** The roles that make sense for this layer — what the Layers panel's role menu offers. */
export function rolesFor(n: RigNode): string[] {
  if (n.kind === 'body') return ['body'];
  if (n.kind === 'limb') return ['', 'armL', 'armR', 'legL', 'legR'];
  if (n.kind === 'text') return [''];
  const out = ['', 'eyeL', 'eyeR'];
  if (n.kind === 'primitive' || n.kind === 'group' || n.kind === 'svgLayer') out.splice(1, 0, 'face');
  if (n.kind === 'primitive' && n.parentId === null) out.push('body');
  return out;
}

/**
 * Give a layer a part to play — or none.
 *
 * A role is what presets and the copilot find a part by, so it is unique within a mascot:
 * taking one moves it off whichever layer had it. Face goes through `setFaceRole` (the eyes
 * and hands move onto it). A limb that becomes a leg gains a knee and a foot and moves onto
 * the body; one that becomes a hand loses them and moves onto the face — keeping its shoulder
 * or hip where it is. A shape in the world can become a mascot body of its own.
 */
export function setRole(p: Project, id: string, role: string, atMs: number): boolean {
  const n = p.rig.nodes[id];
  if (!n || !rolesFor(n).includes(role)) return false;
  const current = n.role ?? '';
  if (current === role) return true;
  if (current === 'face') setFaceRole(p, id, false, atMs);
  if (role === 'face') return setFaceRole(p, id, true, atMs);
  if (role === 'body') {
    // a world shape becomes a mascot: its drawn box is the body's diameter
    n.kind = 'body';
    n.role = 'body';
    n.size = { x: r2(n.size.x / 2), y: r2(n.size.y / 2) };
    delete n.primitive;
    return true;
  }
  const mascot = mascotOf(p.rig, id) ?? p.rig.nodes[p.rig.rootId];
  if (role && mascot) {
    for (const other of Object.values(p.rig.nodes)) {
      if (other.id !== id && other.role === role && mascotOf(p.rig, other.id)?.id === mascot.id) delete other.role;
    }
  }
  if (!role) { delete n.role; return true; }
  n.role = role;
  if (n.limb) {
    const type = role.startsWith('leg') ? 'leg' : 'arm';
    if (n.limb.type !== type) {
      const l = n.limb;
      if (type === 'leg' && l.c) {
        // an arm with an elbow already has three points: they become hip, knee and ankle
        n.limb = { ...l, type, foot: l.foot ?? { angle: 0, length: 40, width: 24 } };
      } else if (type === 'leg') {
        const end = l.b;
        n.limb = { ...l, type, c: end, b: { x: r2((l.a.x + end.x) / 2), y: r2((l.a.y + end.y) / 2) }, foot: l.foot ?? { angle: 0, length: 40, width: 24 } };
      } else {
        const { c, foot, ...rest } = l;
        void foot;
        n.limb = { ...rest, type, b: c ?? l.b };
      }
    }
    if (mascot) placeUnder(p, id, limbParent(p.rig, mascot.id, type), atMs);
  }
  return true;
}

/**
 * Move a layer into another (a group, the face, a shape, a mascot) or out to the world, with
 * nothing moving on screen. A mapped layer — an eye — stays on the sphere when its new parent
 * carries one; everything else goes through `placeUnder`, which re-expresses limb points,
 * offsets, scale and roll in the new frame. False for a move that would make a cycle.
 */
export function moveInto(p: Project, id: string, parentId: string | null, atMs: number): boolean {
  const node = p.rig.nodes[id];
  if (!node || node.parentId === parentId) return !!node;
  if (parentId !== null && (!p.rig.nodes[parentId] || parentId === id || isInside(p.rig, parentId, id))) return false;
  const target = parentId ? p.rig.nodes[parentId] : null;
  const sphere = target && (target.kind === 'body' || (target.kind === 'group' && target.role === 'face'));
  if (node.surface.mapped && sphere) { adopt(p, [id], parentId!, atMs); return true; }
  return placeUnder(p, id, parentId, atMs, target?.kind === 'body');
}

/**
 * Whether a layer is left out of the active state entirely — owned by another state (ranged,
 * with no range here). Such a layer still exists and is listed; this is what the Layers panel
 * asks to offer bringing it back.
 */
export const absentHere = (p: Project, id: string): boolean => {
  const n = p.rig.nodes[id];
  return !!n?.ranged && !(activeTimeline(p).appearances ?? []).some((a) => a.nodeId === id);
};

/**
 * Bring a layer into the active state (`here`), or make it part of every state (`everywhere`):
 * no longer ranged, and the whole-state ranges it was owned through are dropped — a range with
 * its own times or on a clip is animation, and stays.
 */
export function showLayerIn(p: Project, id: string, where: 'here' | 'everywhere'): void {
  const n = p.rig.nodes[id];
  if (!n) return;
  if (where === 'here') { ownLayer(p, id); return; }
  n.ranged = false;
  for (const tl of p.timelines) {
    if (tl.appearances) tl.appearances = tl.appearances.filter((a) => a.nodeId !== id || !!a.blockId || a.startMs !== undefined || a.endMs !== undefined);
  }
}
