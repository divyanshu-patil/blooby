import { uid } from './id';
import { primitivePath } from './path';
import type { ColorStop, Rig, RigNode, Timeline } from './types';

/**
 * A mascot is a `body` node and the layers that ride it. There is one definition of what
 * a mascot is made of — `makeMascot` below — and every mascot in a project is an instance
 * of it: its own nodes, its own ids, its own tracks and its own lane of clips, drawn by the
 * same `buildScene` walk as every other. Nothing anywhere is written for "the second
 * mascot"; it is written for a body, and a project simply has several.
 *
 * `rig.rootId` is the FIRST mascot. It keeps the ids every older file and every preset
 * use ('body', 'eyeL', 'eyeR'), which is why a project from before this opens unchanged.
 */

export const BONE: ColorStop = { r: 242, g: 239, b: 233, a: 1 };
export const INK: ColorStop = { r: 20, g: 19, b: 24, a: 1 };

/** The parts a preset can name. A node's `role` says which one it is. */
export const MASCOT_PARTS = ['body', 'face', 'eyeL', 'eyeR', 'armL', 'armR', 'legL', 'legR'] as const;
const LEGACY = new Set<string>(MASCOT_PARTS);

/** Which part a node plays. The first mascot of an older file has no roles — its ids are. */
export const roleOf = (n: RigNode): string | undefined => n.role ?? (LEGACY.has(n.id) ? n.id : undefined);

export const isMascot = (n: RigNode | undefined): n is RigNode => n?.kind === 'body';

/** Every mascot, back to front. */
export const mascotsOf = (rig: Rig): RigNode[] =>
  Object.values(rig.nodes).filter((n) => n.kind === 'body').sort((a, b) => a.zIndex - b.zIndex);

/** The mascot a layer belongs to: itself when it is one, else the nearest body above it. */
export function mascotOf(rig: Rig, id: string | null | undefined): RigNode | undefined {
  const seen = new Set<string>();
  let n = id ? rig.nodes[id] : undefined;
  while (n && !seen.has(n.id)) {
    if (n.kind === 'body') return n;
    seen.add(n.id);
    n = n.parentId ? rig.nodes[n.parentId] : undefined;
  }
  return undefined;
}

/** A mascot's clip lane: '' for the first, its body id for any other. */
export const laneOfMascot = (rig: Rig, bodyId: string | undefined): string =>
  !bodyId || bodyId === rig.rootId ? '' : bodyId;

/**
 * The lane whose clips drive a layer.
 *
 * A layer inside a mascot plays in that mascot's lane. One outside every mascot — a world
 * sticker, a caption — plays in the lane of the clip that animates it, so the "Hi!" a
 * preset brings along follows the clip it came with, whichever mascot that is on.
 */
export function laneOf(rig: Rig | undefined, tl: Timeline, nodeId: string): string {
  const m = rig && mascotOf(rig, nodeId);
  if (m) return laneOfMascot(rig, m.id);
  for (const t of tl.tracks) {
    if (t.nodeId !== nodeId || !t.blockId) continue;
    const b = tl.blocks.find((x) => x.id === t.blockId);
    if (b) return b.mascotId ?? '';
  }
  return '';
}

/** One mascot's part of a role — its left eye, its right arm — or undefined. */
export function partOf(rig: Rig, mascotId: string, role: string): string | undefined {
  if (role === 'body') return rig.nodes[mascotId]?.kind === 'body' ? mascotId : undefined;
  for (const n of Object.values(rig.nodes)) {
    if (roleOf(n) === role && n.kind !== 'body' && mascotOf(rig, n.id)?.id === mascotId) return n.id;
  }
  return undefined;
}

/**
 * Where a preset's node id lands on a given mascot.
 *
 * On the first mascot an id that exists is used as it is — every preset ever written
 * animates it exactly as before. Otherwise the mascot's own part of that role answers (a
 * preset keyed to 'eyeL' moves this mascot's left eye), and a layer the preset brings along
 * gets an id of its own per mascot, so placing the preset again reuses that copy.
 */
export function retargetId(rig: Rig, mascotId: string | undefined, id: string, presetLayer = false): string {
  const primary = !mascotId || mascotId === rig.rootId;
  const target = primary ? rig.rootId : mascotId!;
  if (primary && rig.nodes[id]) return id;
  const part = LEGACY.has(id) ? partOf(rig, target, id) : undefined;
  if (part) return part;
  if (primary) return id;
  return presetLayer ? `${target}:${id}` : id;
}

/** What a mascot is called on screen. An older file's first mascot is named "Body"; beside
 *  others it reads as "Mascot 1", alone as "Mascot". Renaming it makes it its own. */
export function mascotLabel(rig: Rig, m: RigNode): string {
  if (m.id !== rig.rootId || m.name !== 'Body') return m.name;
  return mascotsOf(rig).length > 1 ? 'Mascot 1' : 'Mascot';
}

/** "Mascot 2", "Mascot 3" — the first number no mascot is already called. */
export function nextMascotName(rig: Rig): string {
  const names = new Set(mascotsOf(rig).map((m) => m.name));
  for (let i = mascotsOf(rig).length + 1; ; i++) if (!names.has(`Mascot ${i}`)) return `Mascot ${i}`;
}

/* ---- the one definition ------------------------------------------------------------ */

export function makeBody(): RigNode {
  return {
    id: 'body', name: 'Body', kind: 'body', parentId: null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 148, y: 148 },
    color: BONE, visible: true, zIndex: 0,
  };
}

/**
 * The face: a group on the body that the eyes (and hands) live in. It draws nothing; it is
 * a frame — move, roll, scale or turn it (its yaw/pitch is a look) and everything on it
 * follows, while the body does its own thing. See buildScene: a group on a sphere hands its
 * mapped children the head's radius and turn, so eyes still curve round the body.
 */
export function makeFace(id: string, parentId: string): RigNode {
  return {
    id, name: 'Face', kind: 'group', parentId, role: 'face',
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 0, y: 0 }, color: INK, visible: true, zIndex: 1,
  };
}

/** A mascot's face — the layer playing that role — or undefined when it has none. */
export const faceOf = (rig: Rig, mascotId: string): string | undefined => partOf(rig, mascotId, 'face');

/**
 * Give every body in `nodes` that has none a face, and move the eyes sitting straight on
 * it into the face. Idempotent. What the migration runs over old files and saved mascots.
 */
export function ensureFaces(nodes: Record<string, RigNode>, rootId?: string): void {
  for (const body of Object.values(nodes)) {
    if (body?.kind !== 'body') continue;
    const kids = Object.values(nodes).filter((n) => n?.parentId === body.id);
    if (kids.some((n) => n.role === 'face')) continue;
    const eyes = kids.filter((n) => n.kind === 'eye');
    if (!eyes.length) continue;
    const id = body.id === rootId && !nodes.face ? 'face' : `${body.id}.face`;
    if (nodes[id]) continue;
    nodes[id] = { ...makeFace(id, body.id), zIndex: Math.min(...eyes.map((e) => e.zIndex ?? 0)) };
    for (const e of eyes) e.parentId = id;
  }
}

export function makeEye(id: string, distance: number): RigNode {
  return {
    id, name: distance < 0 ? 'Left eye' : 'Right eye', kind: 'eye', parentId: 'face',
    surface: { yaw: 0, pitch: -4, mapped: true },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1.55 },
    size: { x: 38, y: 38 },
    color: INK, visible: true, zIndex: 1,
    eye: { linkedToId: null, openness: 1, distanceFromCenter: distance },
  };
}

export type MascotKind = 'default' | 'cute' | 'blob' | 'octopus';

/**
 * The looks "+ Mascot" offers. Each is the same rig — a body and two eyes — with different
 * numbers: that is the whole difference between a cute one and an octopus, and it is why a
 * preset written for one plays on all of them.
 */
export const MASCOT_KINDS: Record<MascotKind, {
  label: string; blurb: string; color: ColorStop; shape?: 'pebble' | 'blob' | 'octopus';
  size: { x: number; y: number }; eye: { size: number; length: number; distance: number; pitch: number };
}> = {
  default: { label: 'Default', blurb: 'The round one', color: BONE, size: { x: 148, y: 148 },
    eye: { size: 38, length: 1.55, distance: 21, pitch: -4 } },
  cute: { label: 'Cute', blurb: 'Softer, with big round eyes', color: { r: 255, g: 204, b: 214, a: 1 }, shape: 'pebble',
    size: { x: 150, y: 140 }, eye: { size: 44, length: 1.1, distance: 25, pitch: 2 } },
  blob: { label: 'Blob', blurb: 'Wobbly and lopsided', color: { r: 178, g: 232, b: 205, a: 1 }, shape: 'blob',
    size: { x: 150, y: 150 }, eye: { size: 34, length: 1.4, distance: 19, pitch: -6 } },
  octopus: { label: 'Octopus', blurb: 'A dome over four tentacles', color: { r: 206, g: 190, b: 250, a: 1 }, shape: 'octopus',
    size: { x: 156, y: 156 }, eye: { size: 34, length: 1.35, distance: 20, pitch: -14 } },
};

/**
 * A new mascot's nodes, body first. `id` is the body's; its parts are `<id>.eyeL` and so on
 * and carry their roles, which is all a preset needs to find them.
 */
export function makeMascot(kind: MascotKind, opts: { name: string; id?: string; x?: number; y?: number }): RigNode[] {
  const k = MASCOT_KINDS[kind];
  const id = opts.id ?? uid('m');
  const body: RigNode = {
    ...makeBody(), id, name: opts.name, role: 'body', color: k.color, size: { ...k.size },
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: opts.x ?? 0, y: opts.y ?? 0 } },
    ...(k.shape ? { shapePath: primitivePath(k.shape), shape: { kind: k.shape } } : {}),
  };
  const eye = (side: -1 | 1): RigNode => {
    const e = makeEye(`${id}.eye${side < 0 ? 'L' : 'R'}`, side * k.eye.distance);
    return {
      ...e, parentId: `${id}.face`, role: side < 0 ? 'eyeL' : 'eyeR',
      surface: { ...e.surface, pitch: k.eye.pitch },
      size: { x: k.eye.size, y: k.eye.size },
      transform: { ...e.transform, length: k.eye.length },
    };
  };
  return [body, makeFace(`${id}.face`, id), eye(-1), eye(1)];
}

/** A saved mascot as a fresh instance: the same nodes under new ids, wired to each other. */
export function instantiateTemplate(nodes: RigNode[], opts: { name: string; x?: number; y?: number }): RigNode[] {
  const body = nodes.find((n) => n.kind === 'body');
  if (!body) return [];
  const map = new Map(nodes.map((n) => [n.id, n.id === body.id ? uid('m') : '']));
  const bodyId = map.get(body.id)!;
  for (const n of nodes) if (n.id !== body.id) map.set(n.id, `${bodyId}.${n.role ?? uid('p')}`);
  return nodes.map((src) => {
    const n = structuredClone(src);
    n.id = map.get(src.id)!;
    if (n.parentId && map.has(n.parentId)) n.parentId = map.get(n.parentId)!;
    if (n.eye?.linkedToId) n.eye.linkedToId = map.get(n.eye.linkedToId) ?? null;
    if (src.id === body.id) {
      n.name = opts.name; n.parentId = null; n.role = 'body';
      n.surface = { ...n.surface, flatOffset: { x: opts.x ?? 0, y: opts.y ?? 0 } };
    }
    return n;
  });
}

/** `rig` down to its first mascot — the body and its parts (face, eyes, role limbs), nothing added. What a new timeline starts with. */
export function baseRig(rig: Rig): Rig {
  const nodes: Record<string, RigNode> = {};
  const root = rig.nodes[rig.rootId];
  if (root?.kind === 'body') {
    const keep = (n: RigNode) => {
      nodes[n.id] = structuredClone(n);
      for (const c of Object.values(rig.nodes)) if (c.parentId === n.id && (c.kind === 'eye' || roleOf(c))) keep(c);
    };
    keep(root);
  }
  return { ...structuredClone(rig), nodes, rootId: root?.kind === 'body' ? root.id : '' };
}
