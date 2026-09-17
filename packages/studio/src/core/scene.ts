import { applyEasing } from './easing';
import { effectOf, hash01 } from './effects';
import { lerpColor } from './color';
import { lerpPath, mapPath, morphPath, pathBounds, pathSampler, primitivePath } from './path';
import { shapeResolver } from './emitters';
import { noise1d } from './noise';
import { bodyTurnScale, FLAT, projectToScreen, silhouetteScale, type Projected } from './curvature';
import { hoseInputOf, limbPoints as limbPointKeys, rubberHose, type HoseInput } from './limb';
import { CAMERA_PROPS, getCameraProp, getProp, isEffectProp, NUMERIC_PROPS, PROPS, readEffectProp, readProp, setCameraProp, setProp, STROKE_DEFAULT, writeEffectProp, writeProp } from './props';
import { arcSampler, glyphBounds, placeGlyphs, TEXT_DEFAULTS, type Glyph } from './text';
import { metricsFor, snapWeight } from './fonts';

/** The outlines a plain ellipse and a plain stadium offer text that follows them. */
const CIRCLE = primitivePath('circle');
const PILL = primitivePath('pill');
import { activeTimeline, CAMERA_ID } from './types';
import { activeTransitionAt, blockAt, blockStarts, lanesOf } from './timeline';
import { laneOf } from './mascot';
import type { Anchor, Appearance, BlendMode, ColorStop, LayerEffect, LimbRig, EasingCurve, Emitter, FontRef, KeyValue, LineCap, LineJoin, Modifier, ModifierAxis, Project, Rig, RigNode, TextStyle, Timeline, Track, Vec2, VectorPath } from './types';

const isColor = (v: KeyValue): v is ColorStop => typeof v === 'object' && 'r' in v;
const isVec = (v: KeyValue): v is Vec2 => typeof v === 'object' && 'x' in v;

export function lerpValue(a: KeyValue, b: KeyValue, t: number): KeyValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  // two path strings: a real morph, not a switch at the halfway mark — and between two
  // keyframes of one drawn curve, its own anchors interpolated where they stand
  if (typeof a === 'string' && typeof b === 'string') return lerpPath(a, b, t);
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
  // words and font names switch at the keyframe: there is nothing halfway between them
  if (PROPS[track.property]?.discrete) return a.value;
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
 *
 * "Every block" means every block of the layer's own LANE: the second mascot's clips seal
 * the second mascot, and leave the first one's keyframes alone. Pass the rig so a layer's
 * lane is known from the mascot it belongs to; without it, the lane of its own clips is used.
 *
 * A clip in ANOTHER lane may still drive a property its own lane's clip does not, while
 * that clip is running — which is how one preset animates several mascots at once: "Two
 * Friends" sits in the first mascot's lane and walks the second one in too. Its own lane
 * always wins, so the second mascot can blink on its own row while the preset moves it.
 * With a single lane there is no other lane, and this reads exactly as it always did.
 */
export function activeTrackFor(tl: Timeline, nodeId: string, property: string, t: number, rig?: Rig): Track | undefined {
  const inside = blockAt(tl, t, laneOf(rig, tl, nodeId));
  let fallback: Track | undefined;
  let borrowed: Track | undefined;
  for (const track of tl.tracks) {
    if (track.nodeId !== nodeId || track.property !== property) continue;
    if (track.blockId) {
      if (inside && track.blockId === inside.id) return track;
      if (!borrowed) {
        const w = blockWindow(tl, track.blockId);
        if (w && t >= w[0] && t < w[1] && !(inside && tl.blocks.find((b) => b.id === track.blockId)?.mascotId === inside.mascotId)) borrowed = track;
      }
    } else if (!inside) fallback ??= track;
  }
  return borrowed ?? fallback;
}

const frac = (v: number) => v - Math.floor(v);
const smoothstep = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

/**
 * A procedural walk, evaluated at any instant — no simulation, so scrubbing is exact.
 *
 * `gain` is the stride in px per step (its sign is the direction), `frequency` steps per
 * second. The body travels `stride` per step, turns a little toward where it is going, leans
 * into it and bobs smoothly: lowest at each contact, highest at passing. Each foot is PLANTED
 * for half a cycle — sliding back in the body's frame at exactly the speed the body moves
 * forward, so in the world it stays put — then swings forward, lifted, rolling heel to toe.
 * Knees are solved from the leg's own thigh and shin lengths and bend forward; feet point the
 * way it walks. Arms swing from the shoulder opposite their legs, and the face lags the bob.
 * A mascot without legs waddles: it rocks side to side on each step instead.
 * Everything reads the evaluated pose as rest, so a walk plays over whatever the clip keyed.
 */
function walkCycle(rig: Rig, body: RigNode, m: Modifier, tSec: number, stride: number) {
  // it speeds up from a standstill and slows into one: steps are the integral of a speed that
  // eases in over the first stretch and out over the last (when the walk has an end)
  const span = m.endMs !== undefined ? (m.endMs - (m.startMs ?? 0)) / 1000 : Infinity;
  const ramp = Math.min(0.4, span / 3);
  const speedAt = (s: number) => smoothstep(s / ramp) * (span === Infinity ? 1 : smoothstep((span - s) / ramp));
  let moved = 0;
  const n = 32, upto = Math.min(tSec, span);
  for (let i = 0; i < n; i++) moved += speedAt(((i + 0.5) / n) * upto) * (upto / n);
  const steps = Math.max(0, m.frequency) * moved;
  const dir = Math.sign(stride) || 1, len = Math.abs(stride);
  // finished (phase -1): only where it got to remains
  if (m.phase === -1) {
    const off = body.surface.flatOffset ?? { x: 0, y: 0 };
    body.surface.flatOffset = { x: off.x + stride * steps, y: off.y };
    return;
  }
  const going = speedAt(Math.min(tSec, span));
  const limbs = Object.values(rig.nodes).filter((x) => x.limb && mascotOfRig(rig, x.id)?.id === body.id);
  const legged = limbs.some((x) => x.limb!.type === 'leg');

  // smooth bob — no cusp at contact; a waddle bobs more, having no knees to soak it up
  const bob = -((1 - Math.cos(2 * Math.PI * steps)) / 2) * len * (legged ? 0.1 : 0.16);
  const off = body.surface.flatOffset ?? { x: 0, y: 0 };
  body.surface.flatOffset = { x: off.x + stride * steps, y: off.y + bob };
  // lean into the walk and — waddling — rock side to side per step
  // (no rock on legs: a changing roll would drag a planted foot across the ground)
  body.transform.rotation += dir * 3 * going + (legged ? 0 : Math.sin(Math.PI * steps) * 7 * going);
  // a little squash on every contact
  const ph = frac(steps), near = Math.min(ph, 1 - ph);
  const c = Math.exp(-((near / 0.09) ** 2));
  const sqx = 1 + 0.05 * c, sqy = 1 - 0.05 * c;
  body.squish = { x: (body.squish?.x ?? 1) * sqx, y: (body.squish?.y ?? 1) * sqy };

  for (const node of limbs) {
    const l = node.limb!;
    const right = node.role ? node.role.endsWith('R') : l.a.x > 0;
    if (l.type === 'leg') {
      const end = l.c ?? l.b;
      const s = frac(steps / 2 + (right ? 0.5 : 0));
      let x: number, lift = 0, toe = 0;
      if (s < 0.5) {
        // planted: slides back as the body goes on; the heel peels up just before it leaves
        x = end.x + dir * len * (0.5 - s * 2);
        toe = -26 * smoothstep((s - 0.38) / 0.12);
      } else {
        const u = (s - 0.5) * 2;
        x = end.x + dir * len * (-0.5 + smoothstep(u));
        lift = Math.sin(Math.PI * u) * len * 0.3;
        // toe down as it pushes off, toe up as it reaches for the heel strike
        toe = -26 * (1 - smoothstep(u / 0.35)) + 14 * Math.sin(Math.PI * smoothstep((u - 0.45) / 0.55));
      }
      // divided by the squash the body frame now carries, so a planted foot stays planted through it
      const foot = { x: x / sqx, y: (end.y - lift - bob) / sqy };
      if (l.c) {
        l.b = knee(l.a, foot, Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y), Math.hypot(l.c.x - l.b.x, l.c.y - l.b.y), dir);
        l.c = foot;
      } else l.b = foot;
      if (l.foot) l.foot = { ...l.foot, angle: footFacing(Math.sign(l.a.x) || 1, dir, toe) };
    } else {
      // from the shoulder, opposite the leg on its side; the elbow follows most of the way
      const swing = Math.sin(2 * Math.PI * (steps / 2 + (right ? 0 : 0.5))) * going;
      const turn = (p: Vec2, deg: number): Vec2 => {
        const r = (deg * Math.PI) / 180, dx = p.x - l.a.x, dy = p.y - l.a.y;
        return { x: l.a.x + dx * Math.cos(r) - dy * Math.sin(r), y: l.a.y + dx * Math.sin(r) + dy * Math.cos(r) };
      };
      // rotating toward the direction of travel means turning against the screen's y-down sense
      const deg = -dir * swing * 24;
      if (l.c) { l.b = turn(l.b, deg * 0.7); l.c = turn(l.c, deg); } else l.b = turn(l.b, deg);
    }
  }
  // the face looks where it is going and trails the bob. The face turns, not the body: a body's
  // turn narrows its frame, which would slide a planted foot
  const face = Object.values(rig.nodes).find((x) => x.parentId === body.id && x.role === 'face');
  if (face) {
    const fo = face.surface.flatOffset ?? { x: 0, y: 0 };
    face.surface.flatOffset = { x: fo.x, y: fo.y + ((1 - Math.cos(2 * Math.PI * (steps - 0.12))) / 2) * len * -0.035 };
    face.surface.yaw += dir * 14 * going;
  } else {
    for (const x of Object.values(rig.nodes)) if (x.parentId === body.id && x.surface.mapped) x.surface.yaw += dir * 14 * going;
  }
}

/** Two-bone IK: where the knee goes for a hip, a foot and the thigh/shin lengths, bent toward `dir`. */
function knee(hip: Vec2, foot: Vec2, thigh: number, shin: number, dir: number): Vec2 {
  const dx = foot.x - hip.x, dy = foot.y - hip.y;
  const d = Math.max(1e-6, Math.hypot(dx, dy));
  // out of reach: straight (the hose stretches to meet the foot, as a pin does)
  if (d >= thigh + shin - 1e-6 || thigh < 1 || shin < 1) return { x: hip.x + (dx / d) * Math.min(thigh, d * 0.5), y: hip.y + (dy / d) * Math.min(thigh, d * 0.5) };
  const along = (thigh * thigh - shin * shin + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  // the perpendicular that points in the walking direction — knees bend forward
  let px = -dy / d, py = dx / d;
  if (Math.sign(px) !== dir) { px = -px; py = -py; }
  return { x: hip.x + (dx / d) * along + px * h, y: hip.y + (dy / d) * along + py * h };
}

/**
 * The `foot.angle` that points a foot the way the mascot walks with its toe tipped `toe`°
 * (positive up). A foot is drawn pointing outward from its side (limb.ts), so the foot on the
 * trailing side is turned round.
 */
function footFacing(side: number, dir: number, toe: number): number {
  const r = (toe * Math.PI) / 180;
  const want = { x: dir * Math.cos(r), y: -Math.sin(r) };
  // limb.ts: dir = (cos(a)·side, sin(a)) with a = -angle·side (radians)
  const a = Math.atan2(want.y, want.x * side);
  return (-a * 180) / Math.PI / side;
}

/** the mascot a node belongs to, on an evaluated rig (mascot.ts works on the same shape) */
function mascotOfRig(rig: Rig, id: string): RigNode | undefined {
  let n: RigNode | undefined = rig.nodes[id];
  for (let i = 0; n && i < 64; i++) { if (n.kind === 'body') return n; n = n.parentId ? rig.nodes[n.parentId] : undefined; }
  return undefined;
}

/**
 * Follow-through: the layer hangs off its mascot on a damped spring.
 *
 * Every recent movement of the mascot (its keyframed position and roll, sampled back through
 * time) kicks the layer the other way, and each kick rings down as e^(-ζωτ)·cos(ωτ). Summed,
 * that is the spring's response to the whole motion — lag, overshoot, settle — as a pure
 * function of the time, so any frame is exact.
 */
function followThrough(rig: Rig, node: RigNode, m: Modifier, tSec: number, past: Past) {
  const host = mascotOfRig(rig, node.parentId ?? '') ?? (node.parentId ? rig.nodes[node.parentId] : undefined);
  if (!host) return;
  const w = 2 * Math.PI * Math.max(0.2, m.frequency), zeta = 0.22, h = 1 / (Math.max(0.2, m.frequency) * 12);
  // A true spring only lags while its host accelerates, by about a/ω² — a 40px hop moved a face
  // 2px, which read as nothing. Cartoon follow-through exaggerates: the lag is scaled back up by
  // the spring's stiffness, so a stiffer spring snaps back faster without swinging less.
  const gain = (m.amount / 100) * (m.amplitude / 100) * Math.max(1, Math.max(0.2, m.frequency) ** 2 * 1.2);
  let dx = 0, dy = 0, dr = 0;
  const at = (k: number, path: string) => past(host.id, path, tSec - k * h);
  for (let k = 1; k <= 36; k++) {
    const tau = (k - 0.5) * h;
    const ring = Math.exp(-zeta * w * tau) * Math.cos(w * tau);
    dx -= (at(k - 1, 'flatOffset.x') - at(k, 'flatOffset.x')) * ring;
    dy -= (at(k - 1, 'flatOffset.y') - at(k, 'flatOffset.y')) * ring;
    dr -= (at(k - 1, 'transform.rotation') - at(k, 'transform.rotation')) * ring;
  }
  // never flung off: the swing is capped
  const cap = (v: number, c: number) => Math.max(-c, Math.min(c, v));
  dx = cap(dx * gain, 90) / (gain || 1); dy = cap(dy * gain, 90) / (gain || 1); dr = cap(dr * gain, 40) / (gain || 1);
  if (node.limb) {
    const l = node.limb;
    const end = l.c ?? l.b;
    const moved = { x: end.x + dx * gain, y: end.y + dy * gain };
    if (l.c) l.c = moved; else l.b = moved;
    return;
  }
  const fo = node.surface.flatOffset ?? { x: 0, y: 0 };
  node.surface.flatOffset = { x: fo.x + dx * gain, y: fo.y + dy * gain };
  node.transform.rotation += dr * gain * 0.6;
}

/**
 * Jelly: the outline deforms from the layer's own vertical motion.
 *
 * Speed stretches it along the fall; a sudden stop (a landing) splats it — flatter and
 * wider, anchored at the bottom so it stays on the ground, widening most near the bottom —
 * and the splat rings down as a wobble. Width × height is kept, so it reads as the same
 * amount of jelly. Every anchor of the outline moves by its own height, so different parts
 * deform differently, rather than one scale on the whole.
 */
function jellyBody(node: RigNode, m: Modifier, tSec: number, past: Past) {
  const gain = (m.amount / 100) * (m.amplitude / 100);
  const dt = 1 / 60, y = (s: number) => past(node.id, 'flatOffset.y', s);
  const v = (y(tSec) - y(tSec - dt)) / dt;
  const f = Math.max(0.5, m.frequency), w = 2 * Math.PI * f, h = 1 / 60;
  let ring = 0;
  for (let k = 1; k <= 48; k++) {
    const t0 = tSec - k * h;
    const a = (y(t0) - 2 * y(t0 - h) + y(t0 - 2 * h)) / (h * h);
    // only a stop (deceleration against a fall) kicks the splat
    const kick = Math.max(0, -a) * h;
    ring += kick * Math.exp(-3.2 * k * h) * Math.cos(w * k * h);
  }
  const stretch = Math.min(0.4, (Math.abs(v) / 2500) * gain);
  const splat = Math.max(-0.35, Math.min(0.55, (ring / 900) * gain));
  const base = node.shapePath ?? CIRCLE;
  node.shapePath = mapPath(base, (q) => {
    // along the motion: taller and thinner
    let x = q.x / (1 + stretch), yy = q.y * (1 + stretch);
    // the splat: lower, wider, bottom kept on the ground, widest at the bottom
    const sy = 1 - splat, low = yy + 0.5;
    yy = 0.5 - (0.5 - yy) * sy;
    x = (x / Math.max(0.3, sy)) * (1 + 0.35 * splat * (low - 0.5));
    return { x, y: yy };
  });
}

/** The modifiers that move a layer bodily — what a motion-driven driver can feel. Never follow or jelly themselves. */
const MOVERS = new Set<Modifier['kind']>(['float', 'shake', 'pendulum', 'walk', 'bounce', 'orbit']);
const MOTION_PATHS = new Set(['flatOffset.x', 'flatOffset.y', 'transform.rotation']);

/**
 * How far `nodeId`'s moving modifiers have pushed `path` at `ms`: each one applied to a bare copy
 * of the node (zeroed offset and roll), so what comes back is exactly its displacement.
 */
function modifierMotion(rig: Rig, tl: Timeline, nodeId: string, path: string, ms: number): number {
  const src = rig.nodes[nodeId];
  if (!src || !MOTION_PATHS.has(path)) return 0;
  let d = 0;
  for (const m of tl.modifiers) {
    if (m.nodeId !== nodeId || !MOVERS.has(m.kind)) continue;
    const local = scopeTime(tl, m, ms);
    if (local === null) continue;
    const node: RigNode = {
      ...src, surface: { ...src.surface, flatOffset: { x: 0, y: 0 } },
      transform: { ...src.transform, rotation: 0, scale: { ...src.transform.scale } },
    };
    const ease = settleOf(tl, m, local);
    applyModifier({ ...rig, nodes: { [nodeId]: node } }, ease < 1 ? { ...m, amount: m.amount * ease } : m, local / 1000);
    const got = getProp(node, path);
    d += typeof got === 'number' ? got : 0;
  }
  return d;
}

const PENDULUM_AXIS: Record<ModifierAxis, string> = {
  rotation: 'transform.rotation',
  x: 'flatOffset.x',
  y: 'flatOffset.y',
  yaw: 'surface.yaw',
  pitch: 'surface.pitch',
};

/** a property's keyframed value at an absolute time in seconds — what velocity-driven drivers look back through */
type Past = (nodeId: string, path: string, tSec: number) => number;

function applyModifier(rig: Rig, m: Modifier, tSec: number, past?: Past, absSec = tSec) {
  const gain = (m.amount / 100) * m.amplitude;
  if (gain === 0) return;

  // the camera shakes, floats and sways like a layer does: through its pan
  if (m.nodeId === CAMERA_ID) {
    const p = tSec * m.frequency, seed = m.seed ?? 0;
    if (m.kind === 'shake') { rig.camera.offset.x += noise1d(p, seed) * gain; rig.camera.offset.y += noise1d(p + 31.7, seed) * gain; }
    else if (m.kind === 'float' || m.kind === 'pendulum') rig.camera.offset.y += Math.sin(2 * Math.PI * p + (m.phase ?? 0)) * gain;
    return;
  }

  const node = rig.nodes[m.nodeId];
  if (!node) return;
  if (m.kind === 'walk') { walkCycle(rig, node, m, tSec, gain); return; }
  if (m.kind === 'follow') { if (past) followThrough(rig, node, m, absSec, past); return; }
  if (m.kind === 'jelly') { if (past) jellyBody(node, m, absSec, past); return; }

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
  // a hop: a parabola up and back, the squash landing on contact and a little stretch on the way up
  if (m.kind === 'bounce') {
    const u = frac(m.frequency * tSec + (m.phase ?? 0) / (2 * Math.PI));
    const air = 4 * u * (1 - u);
    if (isRoot) bump('flatOffset.y', -air * gain); else bump('surface.pitch', -air * gain * 0.3);
    const land = Math.exp(-((Math.min(u, 1 - u) / 0.07) ** 2)) * (m.amount / 100);
    const rise = Math.sin(Math.PI * Math.min(1, u / 0.45)) * (u < 0.45 ? 1 : 0) * (m.amount / 100);
    const sx = 1 + 0.14 * land - 0.05 * rise, sy = 1 - 0.14 * land + 0.07 * rise;
    node.squish = { x: (node.squish?.x ?? 1) * sx, y: (node.squish?.y ?? 1) * sy };
    return;
  }
  // an inhale: taller, a touch narrower — squish, so an anchor at the feet keeps it standing
  if (m.kind === 'breathe') {
    const s = (1 - Math.cos(2 * Math.PI * m.frequency * tSec + (m.phase ?? 0))) / 2 * (gain / 100);
    node.squish = { x: (node.squish?.x ?? 1) * (1 - s * 0.4), y: (node.squish?.y ?? 1) * (1 + s) };
    return;
  }
  // round a small ellipse, tilting with it
  if (m.kind === 'orbit') {
    const a = 2 * Math.PI * m.frequency * tSec + (m.phase ?? 0);
    if (isRoot) { bump('flatOffset.x', Math.cos(a) * gain); bump('flatOffset.y', Math.sin(a) * gain * 0.55); }
    else { bump('surface.yaw', Math.cos(a) * gain * 0.4); bump('surface.pitch', Math.sin(a) * gain * 0.25); }
    bump('transform.rotation', -Math.sin(a) * gain * 0.12);
    return;
  }
  // lub-dub: two quick swells a beat, the second smaller, then a rest
  if (m.kind === 'heartbeat') {
    const u = frac(m.frequency * tSec + (m.phase ?? 0) / (2 * Math.PI));
    const pulse = (c: number, w: number) => Math.exp(-(((u - c) / w) ** 2));
    const s = 1 + (gain / 100) * (pulse(0.1, 0.045) + 0.65 * pulse(0.3, 0.05));
    node.transform.scale = { x: node.transform.scale.x * s, y: node.transform.scale.y * s };
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
  const rig = project.rig;

  // What the viewer actually sees at t=0, per property — the pose the tail must return to.
  const seen = new Set<string>();
  const startValue = new Map<string, { nodeId: string; property: string; value: KeyValue }>();
  for (const t of tracks) {
    const key = keyOf(t.nodeId, t.property);
    if (seen.has(key)) continue;
    seen.add(key);
    const winner = activeTrackFor(tl, t.nodeId, t.property, 0, rig);
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
    if (activeTrackFor(tl, track.nodeId, track.property, durationMs, rig)?.id !== track.id) return track;
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
  const starts = blockStarts(tl);
  for (const [key, entry] of startValue) {
    // the closing clip of THIS layer's lane — another mascot's last clip is not its tail
    const endBlock = blockAt(tl, durationMs, laneOf(rig, tl, entry.nodeId));
    if (!endBlock) continue;
    {
      const endStart = starts[tl.blocks.indexOf(endBlock)];
      if (closed.has(key)) continue;
      if (activeTrackFor(tl, entry.nodeId, entry.property, durationMs, rig)) continue;
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
/**
 * An effect with its animated properties applied at this instant.
 *
 * Emitters and modifiers are not in the rig, so the track loop in evaluateRigRaw cannot
 * write to them — but their keyframes are ordinary tracks keyed by the effect's own id,
 * so both the modifier pass and the emitter pass resolve them through here. A copy, never
 * the stored effect: the project is what the user is editing.
 */
export function effectAt<T extends { id: string }>(project: Project, tl: Timeline, fx: T, timeMs: number): T {
  let out: T | null = null;
  for (const track of tl.tracks) {
    if (track.nodeId !== fx.id || !isEffectProp(track.property)) continue;
    const sampleT = track.blockId ? blockSampleTime(project, tl, track.blockId, timeMs) : timeMs;
    const v = sampleTrack(track, sampleT);
    if (typeof v !== 'number') continue;
    out = out ?? { ...fx };
    writeEffectProp({ ...tl, emitters: [out as unknown as Emitter], modifiers: [out as unknown as Modifier] }, fx.id, track.property, v);
  }
  return out ?? fx;
}

function evaluateRigRaw(project: Project, timeMs: number): Rig {
  const rig: Rig = structuredClone(project.rig);
  rig.clockMs = timeMs;
  const tl = activeTimeline(project);
  const resolved = resolveTracks(project);
  const resolvedTl = { ...tl, tracks: resolved };
  // keyframed values back through time, for drivers that react to motion (follow, jelly, letters facing their way)
  const pastCache = new Map<string, number>();
  // a mascot floating, shaking, swaying or walking moves as surely as a keyframed one — follow-through and jelly react to both
  const movers = new Set(tl.modifiers.filter((m) => MOVERS.has(m.kind)).map((m) => m.nodeId));
  const past: Past = (nodeId, path, tSec) => {
    const ms = Math.max(0, Math.round(tSec * 1000));
    const key = `${nodeId}|${path}|${ms}`;
    let v = pastCache.get(key);
    if (v === undefined) {
      // through the tracks this evaluation already resolved, not valueAt: that would resolve the loop again per sample
      const tr = activeTrackFor(resolvedTl, nodeId, path, ms, project.rig);
      const got = tr ? sampleTrack(tr, tr.blockId ? blockSampleTime(project, tl, tr.blockId, ms) : ms) : readProp(project.rig, nodeId, path);
      v = (typeof got === 'number' ? got : 0) + (movers.has(nodeId) ? modifierMotion(project.rig, tl, nodeId, path, ms) : 0);
      pastCache.set(key, v);
    }
    return v;
  };
  const seen = new Set<string>();
  for (const track of resolved) {
    const key = `${track.nodeId} ${track.property}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const winner = activeTrackFor(resolvedTl, track.nodeId, track.property, timeMs, project.rig);
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
  // letters flying on their own offsets turn to face the way they are going
  for (const node of Object.values(rig.nodes)) {
    if (!node.text?.charOrient || !node.text.charOffsets) continue;
    for (const key of Object.keys(node.text.charOffsets)) {
      const i = +key;
      const px = (s: number) => past(node.id, `text.char.${i}.x`, s), py = (s: number) => past(node.id, `text.char.${i}.y`, s);
      const t0 = timeMs / 1000, dxv = px(t0) - px(t0 - 0.03), dyv = py(t0) - py(t0 - 0.03);
      const speed = Math.hypot(dxv, dyv) / 0.03;
      if (speed < 1) continue;
      const o = node.text.charOffsets[i];
      // the direction of travel, folded so a letter flying left is not upside down
      let ang = (Math.atan2(dyv, dxv) * 180) / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      o.rotation = (o.rotation ?? 0) + ang * Math.min(1, speed / 240);
    }
  }
  for (const m of tl.modifiers) {
    // clip-local effects only run inside their own clip's time range — same window
    // check block-scoped tracks already use, so a Shake added to just "Blink" can't leak
    // into neighboring clips. The effect's own phase runs from the clip's start, too, so
    // dragging the clip elsewhere on the timeline can't change how it looks internally.
    const local = scopeTime(tl, m, timeMs);
    if (local === null) {
      // a walk that has finished leaves the mascot where it walked to, for the rest of its scope
      if (m.kind === 'walk' && m.endMs !== undefined) {
        const open = scopeTime(tl, { ...m, endMs: undefined }, timeMs);
        const span = m.endMs - (m.startMs ?? 0);
        const held = m.holdUntilMs === undefined || open === null || open < m.holdUntilMs - (m.startMs ?? 0);
        if (open !== null && open > span && held) applyModifier(rig, { ...effectAt(project, tl, m, timeMs), phase: -1 }, span / 1000, past, timeMs / 1000);
      }
      continue;
    }
    const live = effectAt(project, tl, m, timeMs);
    const ease = settleOf(tl, m, local);
    applyModifier(rig, ease < 1 ? { ...live, amount: live.amount * ease } : live, local / 1000, past, timeMs / 1000);
  }
  // Appearance last, as a multiplier on the evaluated opacity: a range decides whether
  // the layer exists, and its keyframed opacity decides how it looks while it does.
  // Folding it into `opacity` rather than inventing a render-time flag means everything
  // downstream — the stage, the blends between states, the Lottie bake — already has it.
  if (tl.appearances?.length || Object.values(rig.nodes).some((n) => n.ranged)) {
    for (const node of Object.values(rig.nodes)) {
      const k = appearanceAt(tl, node, timeMs);
      if (k < 1) node.opacity = (node.opacity ?? 1) * k;
    }
  }
  return rig;
}

const smooth = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

/**
 * How present a layer is at `timeMs` by its appearance ranges alone, 0–1.
 *
 * A layer with no range on this timeline is simply there (or, if it is `ranged`, simply
 * not). Inside a range the fades ramp its edges; across several ranges the most present
 * one wins, so two overlapping clips of the same sticker never dim each other.
 */
export function appearanceAt(tl: Timeline, node: RigNode, timeMs: number): number {
  const mine = (tl.appearances ?? []).filter((a) => a.nodeId === node.id);
  if (!mine.length) return node.ranged ? 0 : 1;
  let best = 0;
  for (const a of mine) {
    const local = scopeTime(tl, a, timeMs);
    if (local === null) continue;
    const [s0, s1] = scopeSpan(tl, a.blockId);
    const span = Math.max(0, (a.endMs ?? s1 - s0) - (a.startMs ?? 0));
    const fin = a.fadeInMs ? smooth(local / a.fadeInMs) : 1;
    const fout = a.fadeOutMs ? smooth((span - local) / a.fadeOutMs) : 1;
    best = Math.max(best, Math.min(fin, fout));
    if (best >= 1) break;
  }
  return best;
}

/** Where each of a layer's ranges actually runs, in absolute timeline ms — what the
 *  timeline draws and drags. */
export function appearanceSpans(tl: Timeline, nodeId: string): { entry: Appearance; from: number; to: number; origin: number }[] {
  return (tl.appearances ?? []).filter((a) => a.nodeId === nodeId).map((a) => {
    const w = a.blockId ? blockWindow(tl, a.blockId) : null;
    const origin = w ? w[0] : 0;
    const limit = w ? w[1] - w[0] : tl.timelineDurationMs;
    return { entry: a, origin, from: origin + Math.max(0, a.startMs ?? 0), to: origin + Math.min(limit, a.endMs ?? limit) };
  });
}

/**
 * A shake, float, stretch or pendulum eases in where its range begins and out where it ends,
 * instead of switching on and off: the offset it adds glides to nothing, so the layer arrives
 * at whatever its keyframes say rather than snapping there. Only at real edges — a start or
 * end set on the effect, or its clip's — never at the timeline's own ends, where a loop meets
 * itself or a lone clip loops. Walk, follow and jelly carry their own motion in and out.
 */
const SETTLE_MS = 350;
function settleOf(tl: Timeline, m: Modifier, local: number): number {
  if (m.kind === 'walk' || m.kind === 'follow' || m.kind === 'jelly') return 1;
  // a clip alone on its timeline loops into itself, so its edges are not edges
  const clip = m.blockId && tl.blocks.length > 1 ? blockWindow(tl, m.blockId) : null;
  const scopeEnd = m.endMs ?? (clip ? clip[1] - clip[0] : undefined);
  const span = scopeEnd === undefined ? Infinity : scopeEnd - (m.startMs ?? 0);
  const fade = Math.min(SETTLE_MS, span / 3);
  const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
  const inn = m.startMs || clip ? smooth(local / fade) : 1;
  const out = span !== Infinity ? smooth((span - local) / fade) : 1;
  return inn * out;
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
export function scopeTime(
  tl: Timeline, e: { blockId?: string; startMs?: number; endMs?: number }, timeMs: number,
): number | null {
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
 * animatable property of `to` toward `from`, in place on `to`. `only` narrows it to some
 * layers — one mascot's lane at a seam — and `camera` says whether the view blends too. */
function blendRigInto(to: Rig, from: Rig, amount: number, only?: (id: string) => boolean, camera = true): void {
  const isAngle = (p: string) => p.endsWith('rotation') || p.includes('yaw') || p.includes('pitch');
  for (const node of Object.values(to.nodes)) {
    const other = from.nodes[node.id];
    if (!other || (only && !only(node.id))) continue;
    for (const path of ANIMATABLE_PROPS) {
      const a = getProp(other, path), b = getProp(node, path);
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      setProp(node, path, isAngle(path) ? lerpAngle(a, b, amount) : a + (b - a) * amount);
    }
    if (other.color && node.color) node.color = lerpColor(other.color, node.color, amount);
    if (other.stroke?.color || node.stroke?.color) {
      node.stroke = { ...node.stroke, color: lerpColor(other.stroke?.color ?? STROKE_DEFAULT, node.stroke?.color ?? STROKE_DEFAULT, amount) };
    }
    // a transition across a shape change morphs too, rather than popping at the seam
    if (other.shapePath && node.shapePath && other.shapePath !== node.shapePath) {
      node.shapePath = morphPath(other.shapePath, node.shapePath, amount);
    }
  }
  if (!camera) return;
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
  const rig = evaluateRigRaw(project, timeMs);
  // each mascot's lane has its own seams: the second mascot changing clip blends the
  // second mascot, and the first carries on untouched
  for (const lane of lanesOf(tl)) {
    const active = activeTransitionAt(tl, timeMs, lane);
    if (!active) continue;
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
    blendRigInto(rig, outgoing, progress, (id) => laneOf(project.rig, tl, id) === lane, lane === '');
  }
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
  /**
   * How present the LAYER is — presence, rim fade, opacity and appearance, before any
   * paint's own alpha. `color.a` already includes it for the fill; this is what a stroke
   * and an imported path's own colour are multiplied by. Absent on a particle, whose
   * `color.a` is the whole story.
   */
  alpha?: number;
  /** an outline around the fill, in screen px (it does not scale with the layer) */
  stroke?: { color: ColorStop; width: number; cap: LineCap; join: LineJoin };
  /** imported vector artwork: several paths in the unit box, each with its own paint or the layer's */
  paths?: VectorPath[];
  /** a generated limb; its outline is already placed, so rotation is always 0 */
  limb?: true;
  /** a text layer's glyphs, relative to cx/cy in the item's own frame (before `rotation`) */
  glyphs?: Glyph[];
  /** the face and px size the glyphs are drawn at — the layer's scale already in it */
  font?: FontRef & { size: number };
  /** drawn in the editor only, left out of every export */
  guide?: true;
  /** the visible stretch of the stroke along `path`, 0–1; start > end is the same span reversed */
  trim?: { start: number; end: number; offset?: number };
  /** the layer's drawn effects (glow, blur, shadow, rgb split, slices, scanlines) and the clock they move on */
  fx?: { list: LayerEffect[]; clock: number };
  blend?: BlendMode;
  gradient?: RigNode['gradient'];
  /** the stroke swells from thin ends, 0–1 */
  taper?: number;
  /** clipped to this outline, in screen px — or to everything outside it */
  clip?: { d: string; invert?: boolean };
  /** drawn inside this layer's goo composite, merged with the others in it */
  goo?: { id: string; radius: number };
  /** interim: which layer masks it, resolved to `clip` once every outline is placed */
  maskOf?: { nodeId: string; invert?: boolean };
}

/** Where a layer's outline is on screen — its box and its unit-box path — for text on it. */
interface Placement { cx: number; cy: number; w: number; h: number; rot: number; d: string }

/** A layer's outline as world coordinates, measured for text to follow. */
function worldSampler(pl: Placement) {
  const a = (pl.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return pathSampler(mapPath(pl.d, (u) => {
    const x = u.x * pl.w, y = u.y * pl.h;
    return { x: pl.cx + x * c - y * s, y: pl.cy + x * s + y * c };
  }));
}

/**
 * A text layer as a scene item: its glyphs laid out and placed.
 *
 * Built after every other layer, because a text can follow any of them — a curve, a shape,
 * a mascot's outline — and has to read that layer where it is on THIS frame, animated,
 * attached, wherever. The glyphs are stored relative to the item's centre, so a blend
 * between two poses moves the words as one.
 */
function textItem(node: RigNode, at: { x: number; y: number; rot: number; k: number; alpha: number },
  placed: Map<string, Placement>): SceneItem | null {
  const style = node.text!;
  const k = at.k;
  const font: FontRef = { ...style.font, weight: snapWeight(style.font.weight) };
  const path = style.path;
  const scaled: TextStyle = {
    ...style, size: style.size * k, letterSpacing: style.letterSpacing * k,
    width: style.width ? style.width * k : undefined,
    path: path && { ...path, offset: (path.offset ?? 0) * k, baseline: (path.baseline ?? 0) * k, radius: (path.radius ?? TEXT_DEFAULTS.arc.radius) * k },
  };
  const m = metricsFor(font, scaled.size);
  const base = {
    id: node.id, name: node.name, shape: 'pill' as const, r: 0, depth: 0, zIndex: node.zIndex,
    ...paintOf(node, at.alpha), font: { ...font, size: scaled.size },
    ...(node.guide ? { guide: true as const } : {}),
  };

  // on another layer's outline: placed in the world, where that outline is
  const target = path?.mode === 'path' && path.nodeId ? placed.get(path.nodeId) : undefined;
  const sampler = target ? worldSampler(target) : null;
  if (sampler) {
    const { glyphs } = placeGlyphs(scaled, m, sampler);
    const b = glyphBounds(glyphs, scaled.size) ?? { x0: at.x, y0: at.y, x1: at.x, y1: at.y };
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { ...base, cx, cy, w: b.x1 - b.x0, h: b.y1 - b.y0, rotation: 0, glyphs: glyphs.map((g) => ({ ...g, x: g.x - cx, y: g.y - cy })) };
  }

  // straight, or round an arc: laid out in the layer's own frame about its anchor
  const arc = path?.mode === 'arc'
    ? arcSampler(scaled.path!.radius!, path.start ?? TEXT_DEFAULTS.arc.start, path.end ?? TEXT_DEFAULTS.arc.end, !!path.reverse)
    : undefined;
  const { glyphs, lines } = placeGlyphs(arc ? scaled : { ...scaled, path: undefined }, m, arc);
  let box: { x0: number; y0: number; x1: number; y1: number } | null;
  if (arc) box = glyphBounds(glyphs, scaled.size);
  else {
    const lh = scaled.size * scaled.lineHeight;
    const w = scaled.width ?? Math.max(0, ...lines.map((l) => l.width));
    const h = Math.max(lh, lines.length * lh);
    const x0 = style.align === 'left' ? 0 : style.align === 'center' ? -w / 2 : -w;
    const y0 = style.valign === 'top' ? 0 : style.valign === 'middle' ? -h / 2 : -h;
    box = { x0, y0, x1: x0 + w, y1: y0 + h };
  }
  const b = box ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const lx = (b.x0 + b.x1) / 2, ly = (b.y0 + b.y1) / 2;
  const r = (at.rot * Math.PI) / 180;
  return {
    ...base,
    cx: at.x + lx * Math.cos(r) - ly * Math.sin(r), cy: at.y + lx * Math.sin(r) + ly * Math.cos(r),
    w: b.x1 - b.x0, h: b.y1 - b.y0, rotation: at.rot,
    glyphs: glyphs.map((g) => ({ ...g, x: g.x - lx, y: g.y - ly })),
  };
}

export interface Viewport { width: number; height: number }

/**
 * Where a layer's children live on screen: its origin, its accumulated roll, and how a
 * local offset scales into it. The body's frame squashes with it; a group's scales
 * uniformly; the world's is the composition centre at 1:1.
 *
 * Exported so everything that turns a screen point back into a layer's own numbers — the
 * stage's drags, re-parenting that keeps an object where it is — uses the frame the
 * renderer actually used, rather than a reconstruction that drifts the moment the body
 * squashes.
 */
export interface LayerFrame {
  x: number; y: number;
  /** degrees */
  rot: number;
  /** local offset → screen px, per axis */
  kx: number; ky: number;
  /** the uniform scale a child's own size is multiplied by */
  cum: number;
  /** the sphere radius a mapped child is placed on; 0 when there is no sphere here */
  R: number;
  head: Vec2;
  /** the body's ry/rx, applied to a mapped child's projected y */
  squash: number;
  /** the layer opacity children inherit */
  alpha: number;
  /** the frame this one's own size was scaled by — its parent's cum */
  parentCum: number;
  /** a mask every layer in this frame inherits */
  mask?: { nodeId: string; invert?: boolean };
  /** the goo composite shapes in this frame melt into */
  goo?: { id: string; radius: number };
  /** effects a layer hands to everything it holds — a glitch on a mascot tears its face too */
  fx?: LayerEffect[];
}

const roleOfFace = (n: RigNode) => n.role === 'face';

/**
 * A limb with pinned points: each pinned point sits at its WORLD pin wherever the body went.
 *
 * The end (foot or hand, `limb.pin`) drags the points between with it as one similarity
 * transform about the hip — so a bent knee stays bent in proportion. Any other point can be
 * pinned on its own (`limb.pins`) and is simply put there. While anything is pinned, the
 * limb's length stretches to reach — never below the length set in the inspector, which is
 * the minimum again as soon as the points come back within it.
 */
export function pinned(input: HoseInput, l: LimbRig, world: LayerFrame): HoseInput {
  const pts = input.points;
  const keys = limbPointKeys(l);
  const some = !!l.pin || keys.some((k) => l.pins?.[k]);
  if (!some || pts.length < 2) return input;
  let out = pts;
  if (l.pin) {
    const hip = pts[0], end = pts[pts.length - 1];
    const to = toFrame(world, l.pin);
    const ux = end.x - hip.x, uy = end.y - hip.y, vx = to.x - hip.x, vy = to.y - hip.y;
    const d = ux * ux + uy * uy;
    if (d < 1e-9) out = [...pts.slice(0, -1), to];
    else {
      // the complex number (v / u): rotation + uniform scale taking hip→end onto hip→pin
      const a = (vx * ux + vy * uy) / d, b = (vy * ux - vx * uy) / d;
      out = pts.map((q, i) => (i === 0 ? q : i === pts.length - 1 ? to : {
        x: hip.x + a * (q.x - hip.x) - b * (q.y - hip.y),
        y: hip.y + b * (q.x - hip.x) + a * (q.y - hip.y),
      }));
    }
  }
  out = out.map((q, i) => { const own = l.pins?.[keys[i]]; return own ? toFrame(world, own) : q; });
  let reach = 0;
  for (let i = 1; i < out.length; i++) reach += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
  return { ...input, points: out, length: Math.max(input.length, reach) };
}

/** Effects the renderer draws; flicker, jitter and echo are evaluated into the scene itself. */
const DRAWN_EFFECTS = new Set(['glow', 'blur', 'shadow', 'rgbSplit', 'slices', 'scanlines', 'outline', 'grain', 'hueShift']);
/** the ones a layer hands to its children: a glow or a shadow belongs to the one outline, a tear to the whole thing */
const INHERITED_EFFECTS = new Set(['rgbSplit', 'slices', 'scanlines', 'blur', 'grain', 'hueShift']);

/** The key `buildScene` files the world frame under — the parent of every WORLD layer. */
export const WORLD = '';

/** A local offset carried into a frame, and back out. */
export const toFrame = (f: LayerFrame, v: Vec2): Vec2 => {
  const r = (f.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const lx = v.x * f.kx, ly = v.y * f.ky;
  return { x: f.x + lx * c - ly * s, y: f.y + lx * s + ly * c };
};
export const fromFrame = (f: LayerFrame, p: Vec2): Vec2 => {
  const r = (-f.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - f.x, dy = p.y - f.y;
  return { x: (dx * c - dy * s) / (f.kx || 1), y: (dx * s + dy * c) / (f.ky || 1) };
};

/** A layer's children, in the order the rig holds them — the first mascot first at the top. */
function childrenOf(rig: Rig, id: string | null): RigNode[] {
  const kids = Object.values(rig.nodes).filter((n) => n.parentId === id);
  return id === null ? kids.sort((a, b) => Number(b.id === rig.rootId) - Number(a.id === rig.rootId)) : kids;
}

function eyeHeight(n: RigNode): number {
  return n.size.y * (n.transform.length ?? 1) * (n.eye ? n.eye.openness : 1);
}

// a node's own transform.scale used to only ever size *itself* — a parent's scale never
// reached its children (buildScene's own w/h always came from `node.size` alone), so
// scaling the body up or down left every eye exactly the same size. `cum` threads the
// accumulated ancestor scale (geometric mean of x/y, so a non-uniform squash on one
// node doesn't warp a child's own aspect ratio) down the recursion — each node's actual
// drawn size is its own size × its own scale × everything above it, same principle the
// stretch modifier now relies on to affect "a node and all its children" from one dial.
const scaleOf = (n: RigNode) => { const s = stretchOf(n); return Math.sqrt(Math.max(1e-6, s.x * s.y)); };

/** Squish is clamped where it is read, so no keyframe can turn a mascot inside out. */
const clampSquish = (v: number | undefined) => Math.min(1.8, Math.max(0.4, v ?? 1));
/** A layer's own scale with its squish on top — what every size and frame below uses. */
export const stretchOf = (n: RigNode): Vec2 => ({
  x: n.transform.scale.x * clampSquish(n.squish?.x),
  y: n.transform.scale.y * clampSquish(n.squish?.y),
});

/**
 * Where a layer's centre goes once it turns and scales about its anchor rather than its
 * centre. `at` is the centre with no anchor; `k` the px a local unit is in the parent;
 * `sx/sy` the layer's own scale. At rest (no extra roll, scale 1) this returns `at`
 * unchanged, so moving the anchor never moves the layer — only what it pivots about.
 */
function pivoted(node: RigNode, at: Vec2, parentRot: number, rot: number, k: number, sx: number, sy: number): Vec2 {
  const a = node.anchor;
  if (!a || (!a.x && !a.y)) return at;
  const r0 = (parentRot * Math.PI) / 180, r1 = (rot * Math.PI) / 180;
  const px = a.x * k, py = a.y * k;
  const qx = a.x * k * sx, qy = a.y * k * sy;
  return {
    x: at.x + (px * Math.cos(r0) - py * Math.sin(r0)) - (qx * Math.cos(r1) - qy * Math.sin(r1)),
    y: at.y + (px * Math.sin(r0) + py * Math.cos(r0)) - (qx * Math.sin(r1) + qy * Math.cos(r1)),
  };
}

/**
 * A layer's paint at a given presence: fill and stroke, independent, each with its own
 * opacity, both multiplied by how present the layer is.
 */
function paintOf(node: RigNode, a: number): Pick<SceneItem, 'color' | 'stroke' | 'alpha'> {
  const fillA = node.fill?.enabled === false ? 0 : Math.min(1, Math.max(0, node.fill?.opacity ?? 1));
  const k = fillA * a;
  // the same object when nothing dims it, as it always was
  const color = k < 1 ? { ...node.color, a: node.color.a * k } : node.color;
  const s = node.stroke;
  const width = s?.width ?? 2;
  const stroke = s?.enabled && width > 0
    ? {
      color: { ...(s.color ?? STROKE_DEFAULT), a: (s.color ?? STROKE_DEFAULT).a * Math.min(1, Math.max(0, s.opacity ?? 1)) * a },
      width, cap: s.lineCap ?? 'round', join: s.lineJoin ?? 'round',
    }
    : undefined;
  return { color, alpha: a, ...(stroke ? { stroke } : {}) };
}

/** An outline in screen px, as an item: its box, and the outline fitted into that box. */
function outlineItem(d: string): { cx: number; cy: number; w: number; h: number; path: string } | null {
  const b = pathBounds(d);
  if (!b) return null;
  const w = Math.max(b.x1 - b.x0, 0.01), h = Math.max(b.y1 - b.y0, 0.01);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { cx, cy, w, h, path: mapPath(d, (p) => ({ x: (p.x - cx) / w, y: (p.y - cy) / h })) };
}

/**
 * Flattens the rig to absolute screen shapes. Body roll rotates the whole assembly,
 * body squash carries features with it, mapped children ride the sphere, and a WORLD
 * layer (no parent) sits in composition coordinates. Pass `frames` to also get every
 * layer's frame, keyed by id (and the world's under WORLD).
 */
export function buildScene(rig: Rig, view: Viewport, frames?: Map<string, LayerFrame>): SceneItem[] {
  // a timeline can hold shapes and text with no mascot at all — only a truly empty one draws nothing
  if (!Object.keys(rig.nodes).length) return [];
  const out: SceneItem[] = [];
  // every outline's placement this frame, drawn or not — what text on a path reads
  const placed = new Map<string, Placement>();
  // text waits until everything it might follow has been placed
  const texts: { node: RigNode; at: { x: number; y: number; rot: number; k: number; alpha: number } }[] = [];

  // rx is the *sphere* radius that features are placed on; the drawn outline is its
  // silhouette, which perspective pushes outward. Keep them separate or features escape.
  const limb = silhouetteScale(rig.camera.fov, rig.camera.distance);
  // the camera: a pan (offset) and a zoom about the composition centre
  const zoom = rig.camera.zoom ?? 1;
  const clock = rig.clockMs ?? 0;
  const worldAt = (k: number): LayerFrame => ({
    x: view.width / 2 + rig.camera.offset.x * k, y: view.height / 2 + rig.camera.offset.y * k,
    rot: 0, kx: k, ky: k, cum: k, R: 0, head: { x: 0, y: 0 }, squash: 1, alpha: 1, parentCum: k,
  });
  const worldFrame = worldAt(zoom);
  frames?.set(WORLD, worldFrame);
  /**
   * 2.5D: a layer in the world at depth z sees the world through a perspective divide —
   * 1000/(1000+z) — so a far layer is smaller and pans and zooms less with the camera
   * (parallax), and a near one more. z = 0 is exactly the world frame.
   */
  const depthFrame = (z: number): LayerFrame => worldAt(zoom * (1000 / Math.max(50, 1000 + z)));
  /** a layer's flicker: some steps of its clock drop its opacity at random */
  const flickerOf = (node: RigNode) => {
    const fl = effectOf(node, 'flicker');
    if (!fl) return 1;
    const step = Math.floor((clock / 1000) * (fl.params.rate ?? 20));
    return hash01(step, fl.params.seed ?? 1) < (fl.params.amount ?? 0.6) ? 0.1 + 0.45 * hash01(step, fl.params.seed ?? 1, 7) : 1;
  };
  /** a layer's outline boiling: every anchor nudged by noise that changes `rate` times a second */
  const boil = (node: RigNode, d: string, w: number, h: number) => {
    const wv = effectOf(node, 'wave');
    if (wv && wv.params.amount > 0) {
      // a wave travelling along the outline: up/down with x, a little side to side with y
      const ph = (clock / 1000) * (wv.params.speed ?? 1), k = wv.params.waves ?? 2;
      const ax = wv.params.amount / Math.max(1, Math.abs(w)), ay = wv.params.amount / Math.max(1, Math.abs(h));
      d = mapPath(d, (q) => ({
        x: q.x + Math.sin(2 * Math.PI * (q.y * k + ph + 0.25)) * ax * 0.5,
        y: q.y + Math.sin(2 * Math.PI * (q.x * k + ph)) * ay,
      }));
    }
    const j = effectOf(node, 'jitter');
    if (!j || !(j.params.amount > 0)) return d;
    const step = Math.floor((clock / 1000) * (j.params.rate ?? 8)), seed = j.params.seed ?? 1;
    const ax = j.params.amount / Math.max(1, Math.abs(w)), ay = j.params.amount / Math.max(1, Math.abs(h));
    return mapPath(d, (q) => {
      const kx = Math.round(q.x * 997), ky = Math.round(q.y * 991);
      return { x: q.x + (hash01(step, seed, kx, ky) - 0.5) * 2 * ax, y: q.y + (hash01(step, seed + 1, ky, kx) - 0.5) * 2 * ay };
    });
  };
  /** the glitch-and-blur effects a layer passes to what it holds, merged over its parent's */
  const handedDown = (node: RigNode, f: LayerFrame): { fx?: LayerEffect[] } => {
    const own = (node.effects ?? []).filter((e) => e.enabled !== false && INHERITED_EFFECTS.has(e.kind));
    const list = [...own, ...(f.fx ?? []).filter((e) => !own.some((o) => o.kind === e.kind))];
    return list.length ? { fx: list } : {};
  };
  /** what the renderer draws for a layer beyond its paint: effects, blend, gradient, mask, goo */
  const drawn = (node: RigNode, f: LayerFrame): Partial<SceneItem> => {
    const own = (node.effects ?? []).filter((e) => e.enabled !== false && DRAWN_EFFECTS.has(e.kind));
    const list = [...own, ...(f.fx ?? []).filter((e) => !own.some((o) => o.kind === e.kind))];
    const mask = node.mask ?? f.mask;
    return {
      ...(list.length ? { fx: { list, clock } } : {}),
      ...(node.blend && node.blend !== 'normal' ? { blend: node.blend } : {}),
      ...(node.gradient ? { gradient: node.gradient } : {}),
      ...(mask ? { maskOf: mask } : {}),
      ...(f.goo && (node.kind === 'primitive' || node.kind === 'svgLayer') ? { goo: f.goo } : {}),
    };
  };

  /**
   * A mascot: its body drawn, and the frame everything on it lives in.
   *
   * Every mascot comes through here — the first and the tenth, one standing in the world
   * and one following another — placed by its offset in whatever frame holds it. That is
   * the whole of "several mascots": the same sphere, head turn and squash, instanced.
   */
  /** a body's drawing, waiting for its face group to say where it goes */
  const heads = new Map<string, SceneItem>();
  const mascot = (node: RigNode, f: LayerFrame): LayerFrame => {
    // a mascot's rotateY/rotateX spins the sphere itself: its features go round the back
    const yaw = node.surface.yaw + (node.depth?.rotateY ?? 0), pitch = node.surface.pitch + (node.depth?.rotateX ?? 0);
    const turn = bodyTurnScale(yaw, pitch);
    const k = f.cum;
    const st = stretchOf(node);
    const rx = node.size.x * st.x * turn.sx * k;
    const ry = (node.size.y || node.size.x) * st.y * turn.sy * k;
    const roll = f.rot + node.transform.rotation;
    const at = pivoted(node, toFrame(f, node.surface.flatOffset ?? { x: 0, y: 0 }), f.rot, roll, k, st.x * turn.sx, st.y * turn.sy);
    const seen = node.presence ?? 1;
    const alpha = f.alpha * Math.min(1, Math.max(0, node.opacity ?? 1)) * flickerOf(node);
    placed.set(node.id, { cx: at.x, cy: at.y, w: rx * limb * 2, h: ry * limb * 2, rot: roll, d: node.shapePath ?? CIRCLE });
    const gooFx = effectOf(node, 'goo');
    const goo = gooFx ? { id: node.id, radius: gooFx.params.radius ?? 12 } : f.goo;
    // The head belongs to the face: with a face GROUP on it, the body's drawing is placed where
    // the face is — moved, rolled and scaled with it — while the body's own frame (what legs
    // and anything else hung on the mascot ride) stays where the mascot stands.
    const face = Object.values(rig.nodes).find((n) => n.parentId === node.id && n.kind === 'group' && n.role === 'face' && n.visible);
    if (seen > 0.002 && alpha > 0.002) {
      (face ? (item: SceneItem) => heads.set(face.id, item) : (item: SceneItem) => out.push(item))({
        id: node.id, name: node.name, shape: 'ellipse', cx: at.x, cy: at.y,
        w: rx * limb * 2 * seen, h: ry * limb * 2 * seen,
        r: Math.min(rx, ry) * limb * seen, rotation: roll,
        ...paintOf(node, seen * alpha),
        depth: -2, zIndex: node.zIndex,
        ...(node.shapePath || effectOf(node, 'jitter') || effectOf(node, 'wave') ? { path: boil(node, node.shapePath ?? CIRCLE, rx * 2, ry * 2) } : {}),
        ...drawn(node, f),
        ...(goo ? { goo } : {}),
      });
    }
    const mine: LayerFrame = {
      x: at.x, y: at.y, rot: roll,
      // a local offset on the body stretches with it, so an attached hat stays put on the
      // head through a squash rather than sliding off it
      kx: st.x * turn.sx * k, ky: st.y * turn.sy * k,
      cum: k * scaleOf(node), R: rx, head: { x: yaw, y: pitch },
      squash: rx === 0 ? 1 : ry / rx, alpha, parentCum: k,
      ...(node.mask ?? f.mask ? { mask: node.mask ?? f.mask } : {}),
      ...(goo ? { goo } : {}),
      ...handedDown(node, f),
    };
    frames?.set(node.id, mine);
    return mine;
  };

  const walk = (parentId: string | null, pf: LayerFrame) => {
    for (const node of childrenOf(rig, parentId)) {
      // a layer in the world at a depth sees it through its own perspective divide
      const f = parentId === null && node.depth?.z ? depthFrame(node.depth.z) : pf;
      if (parentId === null && node.depth?.z) frames?.set(`${WORLD}@${node.id}`, f);
      const rad = (f.rot * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      if (node.kind === 'body') { if (node.visible) walk(node.id, mascot(node, f)); continue; }
      // a hidden layer is still placed — a curve nobody sees can carry text — but not drawn
      // a mapped layer rides the sphere; anything with no sphere under it is flat
      const p: Projected = node.surface.mapped && f.R > 0 ? projectToScreen(node, rig, f.R, f.head) : FLAT;
      if (!p.visible) continue;

      // ride the body's squash, then the parent's roll. The offset is the attachment
      // nudge on a mapped layer and the whole position on a flat one, in the parent's own
      // frame either way.
      const fo = node.surface.flatOffset;
      const lx = (p === FLAT ? 0 : p.x) + (fo ? fo.x * f.kx : 0);
      // a body's frame carries its squash; every other frame's is 1
      const ly = (p === FLAT ? 0 : p.y * f.squash) + (fo ? fo.y * f.ky : 0);
      const rot = f.rot + node.transform.rotation;
      // rotateY narrows it towards its edge, rotateX squashes it top to bottom — the cosine of the turn
      const turned = stretchOf(node);
      const st = { x: turned.x * Math.cos(((node.depth?.rotateY ?? 0) * Math.PI) / 180), y: turned.y * Math.cos(((node.depth?.rotateX ?? 0) * Math.PI) / 180) };
      const { x: ax, y: ay } = pivoted(node, { x: f.x + lx * cos - ly * sin, y: f.y + lx * sin + ly * cos }, f.rot, rot, f.cum, st.x * p.sx, st.y * p.sy);

      // presence fades AND shrinks: a feature keyframed out shrinks away rather than
      // blinking off, which is what makes it usable as a transition into the next clip.
      // Opacity fades only, and carries down to everything this layer holds.
      const seen = node.presence ?? 1;
      const alpha = f.alpha * Math.min(1, Math.max(0, node.opacity ?? 1)) * flickerOf(node);
      const w0 = Math.abs(node.size.x * st.x * p.sx * f.cum);
      const h0 = Math.abs(eyeHeight(node) * st.y * p.sy * f.cum);
      const w = w0 * seen;
      const h = h0 * seen;
      const a = p.alpha * seen * alpha;

      // its outline where it is — full size, drawn or not — for text that follows it
      const outline = node.kind === 'primitive' || node.kind === 'eye'
        ? node.shapePath ?? (node.primitive?.shape === 'circle' ? CIRCLE : PILL)
        : node.kind === 'svgLayer' ? node.svg?.paths?.[0]?.d : undefined;
      if (outline) placed.set(node.id, { cx: ax, cy: ay, w: w0, h: h0, rot, d: outline });
      if (!node.visible) continue;

      if (node.kind === 'text' && node.text) {
        // laid out once everything it might follow has been placed; its scale is uniform,
        // so a glyph is never squashed
        if (seen > 0.002 && a > 0.002) {
          texts.push({ node, at: { x: ax, y: ay, rot, alpha: a, k: f.cum * scaleOf(node) * Math.sqrt(Math.abs(p.sx * p.sy)) * seen } });
        }
      } else if (seen > 0.002 && a > 0.002) {
        const base = { id: node.id, name: node.name, depth: p.depth, zIndex: node.zIndex, ...paintOf(node, a), ...(node.guide ? { guide: true as const } : {}), ...drawn(node, f) };
        if (node.kind === 'limb' && node.limb) {
          // placed in the PARENT's frame: the points are where the shoulder, hand, knee
          // and ankle sit on the body, and they ride it through every move
          const hose = rubberHose(pinned(hoseInputOf(node.limb, (v) => toFrame(f, v), f.cum * seen), node.limb, worldFrame));
          const box = hose && outlineItem(hose.d);
          if (box) {
            placed.set(node.id, { cx: box.cx, cy: box.cy, w: box.w, h: box.h, rot: 0, d: box.path });
            out.push({ ...base, shape: 'pill', r: 0, rotation: 0, ...box, path: boil(node, box.path, box.w, box.h), limb: true });
          }
        } else if (node.kind === 'svgLayer' && node.svg?.paths?.length) {
          out.push({ ...base, shape: 'pill', cx: ax, cy: ay, w, h, r: 0, rotation: rot, paths: node.svg.paths });
        } else if (node.kind === 'svgLayer' && node.svg) {
          out.push({ ...base, shape: 'pill', cx: ax, cy: ay, w, h, r: 0, rotation: rot, svg: node.svg });
        } else if (node.kind !== 'group') {
          const shape = node.primitive?.shape === 'circle' ? 'ellipse' : 'pill';
          out.push({
            ...base, shape, cx: ax, cy: ay, w, h, r: Math.min(w, h) / 2, rotation: rot,
            ...(node.shapePath || effectOf(node, 'jitter') || effectOf(node, 'wave') ? { path: boil(node, node.shapePath ?? (shape === 'ellipse' ? CIRCLE : PILL), w, h) } : {}),
            ...(node.shapePath && node.trim && (node.trim.start > 0 || node.trim.end < 1 || node.trim.offset) ? { trim: { ...node.trim } } : {}),
            ...(node.stroke?.taper ? { taper: node.stroke.taper } : {}),
          });
        }
      }

      const cum = f.cum * scaleOf(node);
      // A group on a sphere — the face — is a frame for mapped features, not a sphere of its
      // own: it hands down the head's radius, turn and squash, adding its own offset, roll,
      // scale and a look (its yaw/pitch). Anything else is a flat frame, as it always was.
      const onSphere = (node.kind === 'group' || roleOfFace(node)) && f.R > 0;
      const head = heads.get(node.id);
      if (head) {
        const kx = st.x, ky = st.y, a = alpha / (f.alpha || 1);
        out.push({
          ...head, cx: ax, cy: ay, rotation: rot, w: head.w * kx, h: head.h * ky, r: head.r * Math.min(kx, ky),
          ...(a < 0.999 ? { color: { ...head.color, a: head.color.a * a }, alpha: (head.alpha ?? 1) * a } : {}),
        });
        const pl = placed.get(head.id);
        if (pl) placed.set(head.id, { ...pl, cx: ax, cy: ay, rot, w: pl.w * kx, h: pl.h * ky });
      }
      const gooFx = effectOf(node, 'goo');
      const inherit = {
        ...handedDown(node, f),
        ...(node.mask ?? f.mask ? { mask: node.mask ?? f.mask } : {}),
        ...(gooFx ? { goo: { id: node.id, radius: gooFx.params.radius ?? 12 } } : f.goo ? { goo: f.goo } : {}),
      };
      const cosY = Math.cos(((node.depth?.rotateY ?? 0) * Math.PI) / 180), cosX = Math.cos(((node.depth?.rotateX ?? 0) * Math.PI) / 180);
      const mine: LayerFrame = onSphere
        ? {
          x: ax, y: ay, rot, kx: f.kx * st.x, ky: f.ky * st.y, cum,
          R: f.R * scaleOf(node), head: { x: f.head.x + node.surface.yaw, y: f.head.y + node.surface.pitch },
          squash: f.squash, alpha, parentCum: f.cum, ...inherit,
        }
        : {
          // a flipped group mirrors what it holds: its children's offsets turn with it
          x: ax, y: ay, rot, kx: cum * cosY, ky: cum * cosX, cum,
          R: Math.max(Math.abs(w), Math.abs(h)) / 2, head: { x: 0, y: 0 }, squash: 1, alpha, parentCum: f.cum, ...inherit,
        };
      frames?.set(node.id, mine);
      walk(node.id, mine);
    }
  };

  walk(null, worldFrame);
  // curves, shapes and mascots are all where they are this frame; now the words
  for (const t of texts) {
    const item = textItem(t.node, t.at, placed);
    if (item) out.push(t.node.guide ? { ...item, guide: true } : item);
  }
  // every outline is placed now: a masked layer gets its mask's outline in screen px
  for (const item of out) {
    if (!item.maskOf) continue;
    const pl = placed.get(item.maskOf.nodeId);
    const { maskOf } = item;
    delete item.maskOf;
    if (!pl) continue;
    const r = (pl.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const d = mapPath(pl.d, (u) => { const x = u.x * pl.w, y = u.y * pl.h; return { x: pl.cx + x * c - y * s, y: pl.cy + x * s + y * c }; });
    item.clip = { d, ...(maskOf.invert ? { invert: true } : {}) };
  }
  out.sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
  return out;
}

/** Every layer's frame at this pose — the same numbers `buildScene` placed things with. */
export function sceneFrames(rig: Rig, view: Viewport): Map<string, LayerFrame> {
  const frames = new Map<string, LayerFrame>();
  buildScene(rig, view, frames);
  return frames;
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
  // emitter keeps its proportions when the mascot scales or the viewport changes. A mascot
  // scaled down to nothing (it burst into particles, it has not come through the portal yet)
  // is not a size to measure by: below a tenth of its scale, particles are measured as if it were whole.
  const radius = (item?: SceneItem) => (root && item && root.size.x > 0 ? (item.w / 2) / root.size.x : 1);
  let unit = radius(body);
  const s = root ? Math.abs(stretchOf(root).x) : 1;
  if (root && body && s < 0.1) {
    const whole = structuredClone(root);
    whole.transform.scale = { ...whole.transform.scale, x: 1, y: 1 };
    delete whole.squish;
    unit = radius(buildScene({ ...rig, nodes: { ...rig.nodes, [root.id]: whole } }, view).find((i) => i.id === rig.rootId));
  }
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

/**
 * Where an arc or fall particle is, `travel` (0–1, eased) along its path. `lane` is its
 * sideways share in -0.5..0.5 — a fall spreads its particles across 2 × bow; an arc bends
 * them all the same way. The ONE definition: the particles and the stage's trajectory
 * handles both call it, so the drawn path is the path.
 */
export function emitterPathAt(e: Pick<Emitter, 'path' | 'bow'>, from: Vec2, to: Vec2, unit: number, travel: number, lane = 0): Vec2 {
  if (e.path === 'fall') {
    // horizontal at a constant rate, vertical accelerating — gravity, cheaply
    return { x: from.x + (to.x - from.x) * travel + lane * 2 * e.bow * unit, y: from.y + (to.y - from.y) * travel * travel };
  }
  // a quadratic bump perpendicular to travel: 0 at both ends, widest in the middle
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = e.bow * unit * 4 * travel * (1 - travel);
  return { x: from.x + dx * travel + (-dy / len) * bow, y: from.y + dy * travel + (dx / len) * bow };
}

export function emitterItems(
  tl: Timeline, rig: Rig, base: SceneItem[], timeMs: number, view: Viewport,
  /** turns a shape id into markup. Injected so core/scene need not know the library. */
  resolveShape?: (shapeId?: string, svgAssetId?: string, glyph?: string) => { sourceMarkup: string; viewBox: string } | undefined,
): SceneItem[] {
  const emitters = tl.emitters ?? [];
  if (!emitters.length) return [];

  const { anchor, unit } = emitterFrame(rig, base, view);
  const out: SceneItem[] = [];
  const hiddenScene = new Map<string, SceneItem | undefined>();
  const targetOf = (id: string): SceneItem | undefined => {
    const drawn = base.find((b) => b.id === id);
    if (drawn) return drawn;
    if (!hiddenScene.has(id) && rig.nodes[id]) {
      // as it would be drawn: the same rig with that layer shown at full presence
      const shown: Rig = { ...rig, nodes: { ...rig.nodes, [id]: { ...rig.nodes[id], visible: true, presence: 1, opacity: 1 } } };
      hiddenScene.set(id, buildScene(shown, view).find((b) => b.id === id));
    }
    return hiddenScene.get(id);
  };
  for (const e of emitters) {
    const life = Math.max(1, e.lifeMs);
    const rate = Math.max(1, e.rateMs);
    const t = scopeTime(tl, e, timeMs);
    if (t === null) continue;

    const stopsAt = e.endMs !== undefined ? e.endMs - (e.startMs ?? 0) : Infinity;

    /**
     * How an emitter leaves, and why it happens INSIDE its range rather than after it.
     *
     * Trailing past the end was worse in both directions: a long-lived particle kept
     * going most of the way to the next clip, so a range you shortened looked like it did
     * nothing — and a clip boundary still cut hard, because letting particles outlive
     * their clip would rain them over whatever comes next.
     *
     * So the last stretch of the range IS the exit: births stop, and everything still on
     * screen fades and shrinks to nothing by the moment the range closes. The range is
     * then exactly what it says, and its end is animated rather than a switch.
     */
    const EXIT_MS = 420;
    const tail = stopsAt === Infinity ? 0 : Math.min(EXIT_MS, stopsAt * 0.4);
    const exit = tail > 0 ? Math.min(1, Math.max(0, (stopsAt - t) / tail)) : 1;
    if (exit <= 0) continue;

    /**
     * And the mirror of it at the other end: the effect arrives rather than appearing.
     *
     * An orbit is the case that needs this most — a full ring of five objects popped into
     * existence on one frame. The individual particles of a stream fade themselves in over
     * the first stretch of their own life, but nothing covered the effect as a whole.
     */
    const head = Math.min(EXIT_MS, stopsAt === Infinity ? EXIT_MS : stopsAt * 0.4);
    const enter = head > 0 ? Math.min(1, Math.max(0, t / head)) : 1;
    // an orbit uses every slot it was given: they are positions on a ring, not spawns
    // an orbit uses every slot, and so does a burst: every particle is born at once
    const slots = e.path === 'orbit' || e.path === 'burst'
      ? Math.max(1, Math.min(2000, Math.round(e.count)))
      : Math.max(1, Math.min(e.count, Math.ceil(life / rate)));
    const cycle = slots * rate;
    const from = anchor(e.from), to = anchor(e.to);
    const seed = e.seed ?? 0;

    // one revolution per lifeMs, so "lives" reads as "how long a lap takes" on an orbit
    const orbitPhase = (t / life) % 1;

    const parts = e.parts?.length ? e.parts : null;

    /**
     * Where particle i lands on an attraction target: spread evenly round its outline, or
     * (fill) scattered over its area. Read from the target as drawn — and when it is not
     * drawn yet (an assembly forms a layer that is still invisible), as it WOULD be drawn.
     */
    const targetItem = e.attract ? targetOf(e.attract.nodeId) : undefined;
    const outline = targetItem && !targetItem.glyphs ? pathSampler(targetItem.path ?? CIRCLE) : null;
    const targetPoint = (_id: string, i: number, n: number, fill: boolean, s: number): Vec2 | undefined => {
      // onto words: each particle to a spot inside one of the letters, spread across them all
      if (targetItem?.glyphs?.length && targetItem.font) {
        const g = targetItem.glyphs[i % targetItem.glyphs.length];
        const sz = targetItem.font.size * g.scale;
        const r = (targetItem.rotation * Math.PI) / 180;
        const lx = g.x + (hash01(i, s, 41) - 0.5) * sz * 0.5, ly = g.y - sz * 0.35 + (hash01(i, s, 43) - 0.5) * sz * 0.6;
        return { x: targetItem.cx + lx * Math.cos(r) - ly * Math.sin(r), y: targetItem.cy + lx * Math.sin(r) + ly * Math.cos(r) };
      }
      if (!targetItem || !outline) return undefined;
      const p = outline.at((((i + hash01(i, s, 5) * 0.5) / n) % 1) * outline.length);
      const k = fill ? Math.sqrt(hash01(i, s, 13)) : 1;
      const r = (targetItem.rotation * Math.PI) / 180;
      const lx = p.x * targetItem.w * k, ly = p.y * targetItem.h * k;
      return { x: targetItem.cx + lx * Math.cos(r) - ly * Math.sin(r), y: targetItem.cy + lx * Math.sin(r) + ly * Math.cos(r) };
    };

    for (let i = 0; i < slots; i++) {
      const pt = parts ? parts[i % parts.length] : null;

      // Per-particle speed. A stream where everything travels at one rate reads as a
      // conveyor belt; jitter spreads it across a range, deterministically by slot so
      // scrubbing back gives the same picture.
      const jitter = e.speedJitter ?? 0;
      const vary = jitter ? 1 + noise1d(i * 3.1 + 11, seed) * jitter : 1;
      // e.speed is the whole stream's dial; pt.speed is one piece's offset from it
      const rateOf = Math.max(0.05, (e.speed ?? 1) * (pt?.speed ?? 1) * vary);

      // an orbit never dies and never respawns — it goes round. Everything else is born,
      // travels and fades.
      const age = e.path === 'burst' ? t
        : e.path === 'orbit'
        ? ((t * rateOf + (i / slots) * life) % life)
        : ((t * rateOf - i * rate) % cycle + cycle) % cycle;

      /**
       * Spin runs on an UNWRAPPED clock, unlike everything else driven by `u`.
       *
       * On an orbit `u` restarts at every lap, so an object spinning 90° over a life
       * snapped back to 0° the instant it crossed the seam — visible as a rotation that
       * resets partway round the ring. A particle that is born and dies has no seam to
       * cross, so for those the two clocks are identical.
       */
      const spinPhase = e.path === 'orbit'
        ? (t * rateOf + (i / slots) * life) / life
        : age / life;
      if (age >= life) continue;                       // this slot is between spawns
      // when this particle started, in the emitter's OWN clock. `age` is measured on the
      // slot's speed-scaled clock, so subtracting it from unscaled `t` compared two
      // different times and let births through (or cut them) at the wrong moment.
      const born = (t * rateOf - age) / rateOf;
      // nothing new is born once the exit has begun — an orbit has no births to stop
      if (e.path !== 'orbit' && e.path !== 'burst' && born > stopsAt - tail) continue;
      /**
       * Two clocks, deliberately: `life` is how far through its life the particle is, and
       * `travel` is how far along its path.
       *
       * They used to be one, which meant an overshooting travel curve corrupted the fade,
       * the growth and the cull along with the movement. Notify's elastic badge swung
       * outside 0..1 several times per life and so it blinked on and off at full size,
       * half size, nothing — the erratic behaviour was the easing leaking into every
       * other thing `u` drove. Easing shapes the journey; life is always linear.
       */
      const u = age / life;
      const travel = e.easing ? applyEasing(e.easing, u) : u;

      let x: number, y: number;
      if (e.path === 'burst') {
        // physics in closed form: velocity decays with drag, gravity pulls, noise stirs
        const ts = (age * (e.speed ?? 1)) / 1000;
        const dirDeg = (e.angle ?? -90) + (noise1d(i * 1.37 + 3.1, seed) * 0.5 + (hash01(i, seed, 11) - 0.5)) * (e.spread ?? 360);
        const speed = (e.velocity ?? 300) * (1 + ((hash01(i, seed, 23) - 0.5) * 2) * (e.velocityJitter ?? 0.4));
        const k = Math.max(1e-3, e.drag ?? 1.2);
        const reach = (speed * (1 - Math.exp(-k * ts))) / k;
        const rad = (dirDeg * Math.PI) / 180;
        const turb = (e.turbulence ?? 0) * unit;
        x = from.x + Math.cos(rad) * reach * unit + noise1d(ts * 1.3 + i * 0.71, seed + 5) * turb;
        y = from.y + Math.sin(rad) * reach * unit + 0.5 * (e.gravity ?? 0) * ts * ts * unit + noise1d(ts * 1.3 + i * 0.93 + 40, seed + 9) * turb;
        // then, from startMs, each flies to its own point on the target's shape
        const at = e.attract && targetPoint(e.attract.nodeId, i, slots, !!e.attract.fill, seed);
        if (e.attract && at) {
          const u = Math.min(1, Math.max(0, (t - e.attract.startMs) / Math.max(1, e.attract.durationMs)));
          if (u > 0) {
            const g = u * u * (3 - 2 * u);
            // a curved approach: bowed sideways, most in the middle of the flight
            const bow = Math.sin(Math.PI * g) * (hash01(i, seed, 31) - 0.5) * 120 * unit;
            const dxp = at.x - x, dyp = at.y - y, nl = Math.hypot(dxp, dyp) || 1;
            x = x + dxp * g - (dyp / nl) * bow;
            y = y + dyp * g + (dxp / nl) * bow;
          }
        }
      } else if (e.path === 'orbit') {
        // radius defaults to the from->to distance, so dragging the end handle sizes the
        // ellipse — one gesture, whichever path is selected
        const rx = (e.radiusX ?? Math.hypot(to.x - from.x, to.y - from.y) / unit) * unit;
        const ry = (e.radiusY ?? e.radiusX ?? Math.hypot(to.x - from.x, to.y - from.y) / unit) * unit;
        // Spaced by INDEX around the ring, not by age. Age-staggering clumped them: with
        // `count` below life/rate the birth cycle is shorter than a life, so several sat
        // almost on top of each other. An orbit divides its track evenly, always.
        const a = 2 * Math.PI * (orbitPhase + i / slots);
        // the ring can be tilted, so it reads as a halo seen at an angle rather than
        // always lying flat
        const ox = Math.cos(a) * rx, oy = Math.sin(a) * ry;
        const tilt = ((e.orbitTilt ?? 0) * Math.PI) / 180;
        const ct = Math.cos(tilt), st = Math.sin(tilt);
        x = from.x + ox * ct - oy * st;
        y = from.y + ox * st + oy * ct;
      } else {
        ({ x, y } = emitterPathAt(e, from, to, unit, travel, i / slots - 0.5));
      }

      if (e.wobble) {
        const w = e.wobble * unit;
        const phase = u * e.wobbleFrequency * (life / 1000) + i * 7.3;
        x += noise1d(phase, seed) * w;
        y += noise1d(phase + 31.7, seed) * w;
      }

      /**
       * An orbit is a position on a ring, not something born and lost: it neither fades in
       * (which punched a hole in the ring each time a slot's phase crossed zero) nor fades
       * or shrinks on its way round. Its only fade is the exit. Everything else is born,
       * travels and fades out from `fadeStart`.
       */
      const orbiting = e.path === 'orbit';
      const fadeIn = orbiting ? 1 : Math.min(1, u / (e.path === 'burst' ? 0.02 : 0.12));
      const fadeSpan = Math.max(1e-3, 1 - e.fadeStart);
      const fadeOut = orbiting || u <= e.fadeStart ? 1 : Math.max(0, 1 - (u - e.fadeStart) / fadeSpan);
      const alpha = e.color.a * fadeIn * fadeOut * exit * enter;
      if (alpha <= 0.002) continue;

      // a particle shrinks as it fades rather than staying full size and vanishing. Fading
      // alone reads as popping out of existence — the same reason a layer keyframed to
      // `visible: 0` scales away instead of blinking off.
      const grow = orbiting ? 1 : e.scaleFrom + (e.scaleTo - e.scaleFrom) * u;
      /**
       * Shrinking only at the very end, not across the whole fade.
       *
       * Multiplying size by `fadeOut` outright cancels the growth a glyph is authored
       * with: zzz rise from 0.45x to 1.35x while fading from 42% of their life, so the two
       * fought and they peaked at a third of their intended size — small enough to be
       * invisible in an export. Below 35% alpha the particle is on its way out anyway, and
       * that is the stretch where shrinking reads as leaving rather than as never arriving.
       */
      const SHRINK_FROM = 0.35;
      const shrink = fadeOut < SHRINK_FROM ? fadeOut / SHRINK_FROM : 1;
      // fadeIn is the particle's own arrival ramp; scaling with it is the exact mirror of
      // `shrink` on the way out, so a glyph grows in instead of popping at full size
      const size = e.size * grow * (pt?.sizeScale ?? 1) * unit * shrink * exit * fadeIn * enter;
      const tint = e.colorTo ? lerpColor(pt?.color ?? e.color, e.colorTo, u) : pt?.color ?? e.color;

      // what this particle IS: a library/project shape, or a character. `resolveShape` is
      // passed in rather than looked up here, so core/scene stays free of the library.
      const glyph = pt?.glyph ?? e.glyphs[i % Math.max(1, e.glyphs.length)] ?? '';
      // a typed character that the library has a vector for is DRAWN, not typed: the font
      // it used is not in any Lottie player, so those particles could not be exported
      const art = pt?.shapeId || pt?.svgAssetId
        ? resolveShape?.(pt.shapeId, pt.svgAssetId)
        : (e.svg ?? resolveShape?.(undefined, undefined, glyph) ?? undefined);

      out.push({
        id: `${e.id}#${i}`, name: e.name, shape: 'pill',
        cx: x, cy: y, w: size, h: size, r: size / 2,
        rotation: (e.spin + (pt?.spin ?? 0)) * spinPhase,
        color: { ...tint, a: (tint.a ?? 1) * (alpha / Math.max(1e-6, e.color.a)) },
        depth: 3, zIndex: 900,
        // nothing to show (a burst of plain sparks): a round dot
        ...(art ? { svg: art } : glyph ? { text: glyph } : {}),
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
  /**
   * Echo: fading copies of a layer where it was a moment ago — trails, and motion blur when
   * the delay is short. Each copy is the layer as it WAS evaluated at that earlier time, so
   * a trail follows the real path, curves and all. Only the layers that ask pay for it.
   */
  const echoing = Object.values(rig.nodes).filter((n) => effectOf(n, 'echo'));
  if (echoing.length) {
    const ids = new Set(echoing.map((n) => n.id));
    const maxCount = Math.max(...echoing.map((n) => Math.round(effectOf(n, 'echo')!.params.count ?? 4)));
    const earlier = new Map<number, SceneItem[]>();
    for (const n of echoing) {
      const e = effectOf(n, 'echo')!;
      const count = Math.min(maxCount, Math.round(e.params.count ?? 4));
      for (let k = count; k >= 1; k--) {
        const at = timeMs - k * (e.params.delay ?? 40);
        if (at < 0) continue;
        const key = Math.round(at);
        if (!earlier.has(key)) earlier.set(key, buildScene(evaluateRig(project, at), view));
        const fade = (e.params.falloff ?? 0.55) ** k;
        for (const item of earlier.get(key)!.filter((i) => ids.has(i.id) && i.id === n.id)) {
          base.push({
            ...item, id: `${item.id}~echo${k}`, zIndex: item.zIndex - 0.001 * k,
            color: { ...item.color, a: item.color.a * fade }, alpha: (item.alpha ?? 1) * fade,
            ...(item.stroke ? { stroke: { ...item.stroke, color: { ...item.stroke.color, a: item.stroke.color.a * fade } } } : {}),
          });
        }
      }
    }
    base.sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
  }
  // emitters resolved here rather than inside emitterItems: this is the level that has the
  // project, and therefore the clip retiming a block-scoped effect track needs
  const tl = activeTimeline(project);
  const resolved = { ...tl, emitters: (tl.emitters ?? []).map((e) => effectAt(project, tl, e, timeMs)) };
  const extra = emitterItems(resolved, rig, base, timeMs, view, shapeResolver(project.svgAssets));
  if (!extra.length) return base;
  return [...base, ...extra].sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth);
}

export const sceneAt = (project: Project, t: number, view: Viewport): SceneItem[] =>
  composeScene(project, evaluateRig(project, t), t, view);

/** Current value of a property, tracks included — what the inspector shows. Mirrors
 * evaluateRig's own per-track sampling (block speed/loop included) so the inspector can
 * never show a value the preview doesn't actually render. */
/** The active timeline with its loop-closing keys, as evaluateRig samples it. Not cached:
 *  projects are mutated in place mid-commit, and a stale read there is worse than the cost. */
function resolvedTimeline(project: Project): Timeline {
  const tl = activeTimeline(project);
  return tl.loop ? { ...tl, tracks: resolveTracks(project) } : tl;
}

export function valueAt(project: Project, nodeId: string, path: string, t: number): KeyValue | undefined {
  const tl = resolvedTimeline(project);
  const track = activeTrackFor(tl, nodeId, path, t, project.rig);
  const sampleT = track?.blockId ? blockSampleTime(project, tl, track.blockId, t) : t;
  const sampled = track && sampleTrack(track, sampleT);
  if (sampled !== undefined) return sampled;
  return isEffectProp(path) ? readEffectProp(tl, nodeId, path) : readProp(project.rig, nodeId, path);
}
