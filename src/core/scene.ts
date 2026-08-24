import { applyEasing } from './easing';
import { lerpColor } from './color';
import { noise1d } from './noise';
import { bodyTurnScale, projectToScreen, silhouetteScale } from './curvature';
import { getProp, readProp, setProp, writeProp } from './props';
import type { ColorStop, KeyValue, Modifier, Project, Rig, RigNode, Track, Vec2 } from './types';

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

function applyModifier(rig: Rig, m: Modifier, tSec: number) {
  const gain = (m.amount / 100) * m.amplitude;
  if (gain === 0) return;

  // unlike shake/float, stretch is never about one node — it pulses the whole rig
  // (body and every mapped child) by a shared factor, so it walks all of them instead
  // of targeting m.nodeId.
  if (m.kind === 'stretch') {
    const s = 1 + (gain / 100) * Math.sin(2 * Math.PI * m.frequency * tSec + (m.phase ?? 0));
    for (const n of Object.values(rig.nodes)) n.transform.scale = { x: n.transform.scale.x * s, y: n.transform.scale.y * s };
    return;
  }

  const node = rig.nodes[m.nodeId];
  if (!node) return;
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

/** Rig with every track sampled at t and every modifier layered on top. */
/**
 * When a project loops, every track eases from wherever it ends back to its own t=0
 * value by the end of the timeline, so playback (and export) can wrap with no seam.
 * A pure derivation — never mutates stored keyframes — shared by playback and export so
 * they can't drift apart, same as everything else in this file.
 */
export function resolveTracks(tracks: Track[], loop: boolean, durationMs: number): Track[] {
  if (!loop) return tracks;
  return tracks.map((track) => {
    const ks = track.keyframes;
    if (ks.length < 2) return track;
    const last = ks[ks.length - 1];
    if (last.time >= durationMs - 1) return track;
    const start = sampleTrack(track, 0);
    if (start === undefined || JSON.stringify(start) === JSON.stringify(last.value)) return track;
    return { ...track, keyframes: [...ks, { id: `${last.id}~loop`, time: durationMs, value: start, easingOut: last.easingOut }] };
  });
}

export function evaluateRig(project: Project, timeMs: number): Rig {
  const rig: Rig = structuredClone(project.rig);
  const tracks = resolveTracks(project.tracks, project.loop, project.timelineDurationMs);
  for (const track of tracks) {
    const v = sampleTrack(track, timeMs);
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
  const tSec = timeMs / 1000;
  for (const m of project.modifiers) applyModifier(rig, m, tSec);
  return rig;
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

  const walk = (parent: RigNode, px: number, py: number, pr: number, R: number, headAngles: Vec2) => {
    for (const node of childrenOf(rig, parent.id)) {
      if (!node.visible) continue;
      const p = projectToScreen(node, rig, R, headAngles);
      if (!p.visible) continue;

      // ride the body's squash, then its roll
      const lx = p.x;
      const ly = p.y * (parent.id === rig.rootId ? squash : 1);
      const ax = px + lx * cos - ly * sin;
      const ay = py + lx * sin + ly * cos;

      const w = node.size.x * node.transform.scale.x * p.sx;
      const h = eyeHeight(node) * node.transform.scale.y * p.sy;
      const rot = pr + node.transform.rotation;

      const color = p.alpha < 1 ? { ...node.color, a: node.color.a * p.alpha } : node.color;
      if (node.kind === 'svgLayer' && node.svg) {
        out.push({ id: node.id, name: node.name, shape: 'pill', cx: ax, cy: ay, w, h, r: 0, rotation: rot, color, depth: p.depth, zIndex: node.zIndex, svg: node.svg });
      } else if (node.kind !== 'group') {
        const shape = node.primitive?.shape === 'circle' ? 'ellipse' : 'pill';
        out.push({ id: node.id, name: node.name, shape, cx: ax, cy: ay, w, h, r: Math.min(w, h) / 2, rotation: rot, color, depth: p.depth, zIndex: node.zIndex });
      }
      walk(node, ax, ay, rot, Math.max(w, h) / 2, { x: 0, y: 0 });
    }
  };

  walk(root, cx, cy, roll, rx, head);
  out.sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
  return out;
}

export const sceneAt = (project: Project, t: number, view: Viewport) =>
  buildScene(evaluateRig(project, t), view);

/** Current value of a property, tracks included — what the inspector shows. */
export function valueAt(project: Project, nodeId: string, path: string, t: number): KeyValue | undefined {
  const track = project.tracks.find((tr) => tr.nodeId === nodeId && tr.property === path);
  const sampled = track && sampleTrack(track, t);
  return sampled !== undefined ? sampled : readProp(project.rig, nodeId, path);
}
