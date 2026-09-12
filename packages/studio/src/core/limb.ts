import { pathFromPoints, signedArea } from './path';
import type { LimbRig, Vec2 } from './types';

/**
 * The rubber-hose engine: two or three points in, a finished limb outline out.
 *
 * It works the way Cavalry's rubber hose does. A limb has a LENGTH — its real length
 * along the curve — and it keeps it: the points you drag are where the shoulder and the
 * hand sit, and moving them only changes how the limb bends. Bring the hand closer and it
 * bends more; pull it further and it straightens, then stops short rather than stretch.
 * Bend's sign picks which way it bends and its size how: 1 is one smooth arc, 0 folds at
 * a sharp elbow. With rubber hose off it is the plain rigid limb, straight between its
 * points.
 *
 * One routine for arms and legs — a leg is the same hose through a knee, each half taking
 * its share of the length, with a foot at the end that is itself a short straight hose.
 * Nothing about the outline is stored: it is a pure function of the points and the dials,
 * so `sceneAt(t)` stays answerable for any t in any order.
 */
export interface HoseInput {
  /** in screen px, already carried into place by whatever the limb is attached to */
  points: Vec2[];
  thickness: number;
  bend: number;
  roundness: number;
  taper: number;
  hose: number;
  /** the hose's own length along the curve, in screen px */
  length: number;
  /** legs: the foot, and which way is "outward" (+1 right of the body, -1 left) */
  foot?: { angle: number; length: number; width: number; side: number };
}

export interface HoseResult {
  /** where the limb actually runs — what the handles sit on */
  centreline: Vec2[];
  /** the whole limb as one path in screen px: the hose, plus the foot as a second outline */
  d: string;
  /** the point the foot hangs from — the far end of the centreline */
  end: Vec2;
}

/** odd, so t = 0.5 is a sample — the knee, and an elbow, land exactly on one */
const SAMPLES = 29;
const CAP = 9;

/** The points a user drags: exactly two for a hand, three for a leg. Never a Bézier. */
export const limbPoints = (l: LimbRig): ('a' | 'b' | 'c')[] => (l.type === 'leg' && l.c ? ['a', 'b', 'c'] : ['a', 'b']);

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => { const l = len(a); return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 }; };
/** the left-hand normal, on a y-down screen */
const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Total length of a polyline. */
const lengthOf = (line: Vec2[]) => line.reduce((s, p, i) => (i ? s + len(sub(p, line[i - 1])) : 0), 0);
const lerpLines = (a: Vec2[], b: Vec2[], t: number) => a.map((p, i) => lerp2(p, b[i], t));

/** The first `length` of a polyline, resampled to `n` evenly spaced points — a limb pulled
 *  past its reach, which straightens and stops short rather than stretching. */
function truncate(line: Vec2[], length: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  let j = 1, walked = 0;
  for (let i = 0; i < n; i++) {
    const want = (length * i) / (n - 1);
    while (j < line.length - 1 && walked + len(sub(line[j], line[j - 1])) < want) { walked += len(sub(line[j], line[j - 1])); j++; }
    const seg = len(sub(line[j], line[j - 1]));
    out.push(lerp2(line[j - 1], line[j], seg > 1e-9 ? Math.min(1, (want - walked) / seg) : 0));
  }
  return out;
}

/** An elbow halfway along: two straight halves of `length`, folded toward `towards`. */
function elbowAt(a: Vec2, b: Vec2, length: number, towards: Vec2, t: number): Vec2 {
  const c = len(sub(b, a)), half = Math.max(length, c) / 2;
  const left = perp(unit(sub(b, a)));
  const n = left.x * towards.x + left.y * towards.y < 0 ? mul(left, -1) : left;
  const elbow = add(lerp2(a, b, 0.5), mul(n, Math.sqrt(Math.max(0, half * half - (c / 2) * (c / 2)))));
  return t < 0.5 ? lerp2(a, elbow, t * 2) : lerp2(elbow, b, (t - 0.5) * 2);
}

/**
 * `t` in 0..1 along the circular arc from `a` to `b` whose length is `arc`, bowing toward
 * the `towards` direction. Straight when there is no slack.
 *
 * The arc's angle θ solves chord/arc = sin(θ/2)/(θ/2), which falls steadily from 1 at a
 * straight line to 0 at a full circle — so bisection always finds it.
 */
function arcAt(a: Vec2, b: Vec2, arc: number, towards: Vec2, t: number): Vec2 {
  const chord = sub(b, a);
  const c = len(chord);
  if (arc <= c + 1e-6) return lerp2(a, b, t);
  const ratio = c / arc;
  let lo = 1e-6, hi = 2 * Math.PI - 1e-6;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (Math.sin(m / 2) / (m / 2) > ratio) lo = m; else hi = m;
  }
  const theta = (lo + hi) / 2;
  const r = arc / theta;
  const u = unit(chord);
  // whichever normal of THIS segment faces `towards` — each half of a leg runs its own way
  const left = perp(u);
  const n = left.x * towards.x + left.y * towards.y < 0 ? mul(left, -1) : left;
  const mid = lerp2(a, b, 0.5);
  // the centre sits behind the chord for a shallow arc and in front of it past a semicircle
  const centre = sub(mid, mul(n, r * Math.cos(theta / 2)));
  const start = Math.atan2(a.y - centre.y, a.x - centre.x);
  // go round whichever way passes through the bulge side
  const probe = (dir: number) => {
    const ang = start + dir * theta * 0.5;
    const q = { x: centre.x + Math.cos(ang) * r - mid.x, y: centre.y + Math.sin(ang) * r - mid.y };
    return q.x * n.x + q.y * n.y;
  };
  const dir = probe(1) >= probe(-1) ? 1 : -1;
  const ang = start + dir * theta * t;
  return { x: centre.x + Math.cos(ang) * r, y: centre.y + Math.sin(ang) * r };
}

/**
 * The limb's centreline: SAMPLES points from the shoulder (or hip) to where it ends.
 *
 * The rubber hose keeps `length` whatever the points do. Slack bends it — `bend`'s size
 * shapes that bend from a sharp elbow (0) to one smooth arc (1), its sign picks the side
 * — and pulled past its length it straightens and stops short of the hand. Rigid (hose
 * 0) is the plain standard limb: straight between its points. `hose` blends the two
 * point by point, so it animates like any other number.
 */
function centreline(pts: Vec2[], length: number, bend: number, hose: number): Vec2[] {
  const grid = Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));
  const [a, b] = pts;
  const side = bend < 0 ? -1 : 1;
  const round = Math.min(1, Math.abs(bend));

  if (pts.length < 3) {
    const c = len(sub(b, a));
    const rigid = grid.map((t) => lerp2(a, b, t));
    let rubber: Vec2[];
    if (c >= length) {
      // out of reach: straight toward the hand, and exactly `length` long
      const end = add(a, mul(unit(sub(b, a)), length));
      rubber = grid.map((t) => lerp2(a, end, t));
    } else {
      const towards = mul(perp(unit(sub(b, a))), side);
      const arc = grid.map((t) => arcAt(a, b, length, towards, t));
      const elbow = grid.map((t) => elbowAt(a, b, length, towards, t));
      rubber = lerpLines(elbow, arc, round);
    }
    return lerpLines(rigid, rubber, hose);
  }

  const c = pts[2];
  const c1 = len(sub(b, a)), c2 = len(sub(c, b));
  // the knee decides which way the halves bend: outward, from the hip-ankle line toward the
  // knee. A knee sitting on that line has no outward, so the bend's sign picks one.
  const axis = unit(sub(c, a));
  const along = (b.x - a.x) * axis.x + (b.y - a.y) * axis.y;
  const offLine = sub(sub(b, a), mul(axis, along));
  const outward = len(offLine) > 1e-6 ? unit(offLine) : mul(perp(axis), side);
  const rigid = grid.map((t) => (t < 0.5 ? lerp2(a, b, t * 2) : lerp2(b, c, (t - 0.5) * 2)));
  // taut: one smooth curve through the knee (control = 2B - (A+C)/2 passes it at t = 0.5)
  const through = sub(mul(b, 2), mul(add(a, c), 0.5));
  const taut = grid.map((t) => { const u = 1 - t; return add(add(mul(a, u * u), mul(through, 2 * u * t)), mul(c, t * t)); });
  const tautLength = lengthOf(taut);
  let rubber: Vec2[];
  if (tautLength >= length) {
    rubber = truncate(taut, length, SAMPLES);
  } else {
    // slack: each half bends by its share of the length, through the knee either way
    const total = c1 + c2 || 1;
    const l1 = (length * c1) / total, l2 = (length * c2) / total;
    const arcs = grid.map((t) => (t < 0.5 ? arcAt(a, b, l1, outward, t * 2) : arcAt(b, c, l2, outward, (t - 0.5) * 2)));
    const elbows = grid.map((t) => (t < 0.5 ? elbowAt(a, b, l1, outward, t * 2) : elbowAt(b, c, l2, outward, (t - 0.5) * 2)));
    const bent = lerpLines(elbows, arcs, round);
    // eased in from the taut curve by exactly as much as keeps the length — so it never
    // jumps as the ankle crosses the point where the leg goes slack
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (lengthOf(lerpLines(taut, bent, m)) < length) lo = m; else hi = m;
    }
    rubber = lerpLines(taut, bent, hi);
  }
  return lerpLines(rigid, rubber, hose);
}

/**
 * A hose along `line`: offset both sides by the thickness at that point, and close each
 * end with a cap. Wound clockwise, so a foot or a second hose drawn with it never cuts a
 * hole where they overlap (both fill rules agree on same-direction overlaps).
 */
function hoseOutline(line: Vec2[], thickness: number, taper: number, roundness: number): Vec2[] {
  const n = line.length;
  const half = (i: number) => Math.max(0.25, (thickness * (1 - Math.min(1, taper) * (i / (n - 1)))) / 2);
  const tangent = (i: number) => unit(sub(line[Math.min(n - 1, i + 1)], line[Math.max(0, i - 1)]));
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const nrm = perp(tangent(i));
    left.push(add(line[i], mul(nrm, half(i))));
    right.push(sub(line[i], mul(nrm, half(i))));
  }
  const cap = (i: number, forward: 1 | -1): Vec2[] => {
    const t = mul(tangent(i), forward), nrm = perp(tangent(i)), r = half(i);
    const out: Vec2[] = [];
    // from the left edge round the tip to the right edge; `roundness` scales the bulge
    for (let k = 1; k < CAP; k++) {
      const phi = (k / CAP) * Math.PI;
      const s = forward === 1 ? Math.cos(phi) : -Math.cos(phi);
      out.push(add(line[i], add(mul(nrm, s * r), mul(t, Math.sin(phi) * r * roundness))));
    }
    return out;
  };
  const ring = [...left, ...cap(n - 1, 1), ...right.reverse(), ...cap(0, -1)];
  return signedArea(ring) < 0 ? ring.reverse() : ring;
}

/**
 * Remembered outlines. A limb that is not moving produces the same outline on every frame
 * of a scrub, and building one is a few hundred multiplies — cheap, but not free when a
 * stage holds four limbs and an export samples every frame twice.
 */
const cache = new Map<string, HoseResult>();

export function rubberHose(input: HoseInput): HoseResult | null {
  const pts = input.points;
  if (pts.length < 2 || !pts.every(finite)) return null;
  const nums = [input.thickness, input.bend, input.roundness, input.taper, input.hose, input.length];
  if (!nums.every(Number.isFinite)) return null;

  const key = JSON.stringify([pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), nums.map((v) => +v.toFixed(4)), input.foot]);
  const hit = cache.get(key);
  if (hit) return hit;

  const hose = Math.min(1, Math.max(0, input.hose));
  const length = Math.max(0.5, input.length);
  const line = centreline(pts, length, input.bend, hose);
  const outline = hoseOutline(line, input.thickness, input.taper, Math.min(1, Math.max(0, input.roundness)));
  const end = line[line.length - 1];

  let d = pathFromPoints(outline);
  const foot = input.foot;
  if (foot && foot.length > 0.5 && foot.width > 0.5) {
    // outward from the body, tipped by the angle — positive lifts the toe (screen y is down)
    const side = foot.side < 0 ? -1 : 1;
    const ang = (-foot.angle * Math.PI) / 180 * side;
    const dir = { x: Math.cos(ang) * side, y: Math.sin(ang) };
    // the heel sits under the ankle, so the foot reads as standing on it rather than
    // hanging off the end of the leg like a flag
    const heel = sub(end, mul(dir, foot.width * 0.25));
    const toe = add(heel, mul(dir, Math.max(foot.width * 0.5, foot.length)));
    const footLine = Array.from({ length: 6 }, (_, i) => lerp2(heel, toe, i / 5));
    d += ` ${pathFromPoints(hoseOutline(footLine, foot.width, 0, 1))}`;
  }

  const res = { centreline: line, d, end };
  if (cache.size >= 400) cache.clear();
  cache.set(key, res);
  return res;
}

/** The input a limb node's own dials and points describe, placed by `place` and scaled. */
export function hoseInputOf(l: LimbRig, place: (p: Vec2) => Vec2, scale: number): HoseInput {
  const pts = l.type === 'leg' && l.c ? [l.a, l.b, l.c] : [l.a, l.b];
  return {
    points: pts.map(place),
    thickness: l.thickness * scale,
    bend: l.bend, roundness: l.roundness, taper: l.taper, hose: l.hose,
    length: l.length * scale,
    foot: l.type === 'leg' && l.foot
      ? { angle: l.foot.angle, length: l.foot.length * scale, width: l.foot.width * scale, side: Math.sign(l.a.x) || 1 }
      : undefined,
  };
}

/** A limb's natural length: the distance along its points, with a little slack so it rests
 *  with a relaxed curve rather than pulled straight. What a new limb starts with. */
export function restLength(l: Pick<LimbRig, 'a' | 'b' | 'c'>): number {
  const pts = l.c ? [l.a, l.b, l.c] : [l.a, l.b];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += len(sub(pts[i], pts[i - 1]));
  return Math.round(d * 1.12);
}
