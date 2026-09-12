import { pathFromPoints, signedArea } from './path';
import type { LimbRig, Vec2 } from './types';

/**
 * The rubber-hose engine: two or three points in, a finished limb outline out.
 *
 * One routine for arms and legs — an arm is a hose with two points, a leg is the same hose
 * through a knee with a foot at the end, and the foot is itself a short straight hose.
 * Nothing about the outline is stored: it is a pure function of the points and the dials,
 * so `sceneAt(t)` stays answerable for any t in any order, and a scrub back gives the same
 * limb it gave on the way forward.
 *
 *   centreline  rigid: straight segments through the points; hose: one smooth curve
 *               through them. `hose` blends the two, so it animates like anything else.
 *   thickness   along the centreline, narrowed toward the far end by `taper`
 *   ends        caps whose bulge is `roundness` — a ball at 1, cut flat at 0
 */
export interface HoseInput {
  /** in screen px, already carried into place by whatever the limb is attached to */
  points: Vec2[];
  thickness: number;
  bend: number;
  roundness: number;
  taper: number;
  hose: number;
  length: number;
  /** legs: the foot, and which way is "outward" (+1 right of the body, -1 left) */
  foot?: { angle: number; length: number; width: number; side: number };
}

export interface HoseResult {
  /** where the limb actually runs, after length and bend — what the handles sit on */
  centreline: Vec2[];
  /** the whole limb as one path in screen px: the hose, plus the foot as a second outline */
  d: string;
  /** the point the foot hangs from — the far end of the centreline */
  end: Vec2;
}

/** odd, so t = 0.5 is a sample — a leg's curve passes exactly through the knee there */
const SAMPLES = 29;

/** The points a user drags: exactly two for a hand, three for a leg. Never a Bézier. */
export const limbPoints = (l: LimbRig): ('a' | 'b' | 'c')[] => (l.type === 'leg' && l.c ? ['a', 'b', 'c'] : ['a', 'b']);
const CAP = 9;

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => { const l = len(a); return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 }; };
/** the left-hand normal, on a y-down screen */
const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** The centreline at `t`, rigid and hose, on the same parameter so they can blend. */
function centreAt(pts: Vec2[], bend: number, t: number, hose: number): Vec2 {
  const [a, b] = pts;
  if (pts.length < 3) {
    // an arm: straight, or a quadratic bowed sideways by `bend`
    const rigid = lerp2(a, b, t);
    const chord = sub(b, a);
    const ctrl = add(lerp2(a, b, 0.5), mul(perp(unit(chord)), bend * len(chord) * 0.5));
    const u = 1 - t;
    const curve = add(add(mul(a, u * u), mul(ctrl, 2 * u * t)), mul(b, t * t));
    return lerp2(rigid, curve, hose);
  }
  const c = pts[2];
  // a leg: two straight segments meeting at the knee, or one quadratic that passes THROUGH
  // the knee at t = 0.5 (control = 2B - (A+C)/2 is what makes it pass through)
  const rigid = t < 0.5 ? lerp2(a, b, t * 2) : lerp2(b, c, (t - 0.5) * 2);
  const chord = sub(c, a);
  const through = sub(mul(b, 2), mul(add(a, c), 0.5));
  const ctrl = add(through, mul(perp(unit(chord)), bend * len(chord) * 0.5));
  const u = 1 - t;
  const curve = add(add(mul(a, u * u), mul(ctrl, 2 * u * t)), mul(c, t * t));
  return lerp2(rigid, curve, hose);
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
      const side = forward === 1 ? Math.cos(phi) : -Math.cos(phi);
      out.push(add(line[i], add(mul(nrm, side * r), mul(t, Math.sin(phi) * r * roundness))));
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

  // length stretches the reach from the shoulder, carrying every later point with it
  const a = pts[0];
  const reach = pts.map((p) => add(a, mul(sub(p, a), Math.max(0, input.length))));
  const hose = Math.min(1, Math.max(0, input.hose));
  const line = Array.from({ length: SAMPLES }, (_, i) => centreAt(reach, input.bend, i / (SAMPLES - 1), hose));
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

/** The input a limb node's own dials and points describe, before placement. */
export function hoseInputOf(l: LimbRig, place: (p: Vec2) => Vec2, scale: number): HoseInput {
  const pts = l.type === 'leg' && l.c ? [l.a, l.b, l.c] : [l.a, l.b];
  return {
    points: pts.map(place),
    thickness: l.thickness * scale,
    bend: l.bend, roundness: l.roundness, taper: l.taper, hose: l.hose, length: l.length,
    foot: l.type === 'leg' && l.foot
      ? { angle: l.foot.angle, length: l.foot.length * scale, width: l.foot.width * scale, side: Math.sign(l.a.x) || 1 }
      : undefined,
  };
}
