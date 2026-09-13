import { pathToBezier } from './path';
import type { CurveType, Vec2 } from './types';

/**
 * A drawn curve as the anchors a person grabs.
 *
 * The curve itself is stored as an ordinary path `d` (the layer's `shapePath`), so it
 * morphs, keyframes, strokes, exports and carries text through the same code as every
 * other outline. This file is only the editing view onto it: read the anchors out of a
 * `d`, change them, write a `d` back. Nothing here keeps state — the path is the truth,
 * and the anchors are always exactly the ones in it, never the resampled morph points.
 *
 * Coordinates are whatever space the path is in (a layer's -0.5..0.5 box); handles are
 * offsets from their anchor, so moving an anchor carries its curvature with it.
 */
export interface CurvePoint { x: number; y: number; hin?: Vec2; hout?: Vec2 }
export interface Curve { points: CurvePoint[]; closed: boolean }

const r = (v: number) => Math.round(v * 1000) / 1000;
const f = (p: Vec2) => `${r(p.x)} ${r(p.y)}`;
const zero = (v?: Vec2) => !v || (Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9);
const plus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The anchors of a path, with the handles it has. Null when there is nothing to edit. */
export function curveFromPath(d: string | undefined): Curve | null {
  if (!d) return null;
  const bz = pathToBezier(d);
  if (!bz?.v.length) return null;
  return {
    closed: bz.c,
    points: bz.v.map((v, i) => ({
      x: v.x, y: v.y,
      ...(zero(bz.i[i]) ? {} : { hin: bz.i[i] }),
      ...(zero(bz.o[i]) ? {} : { hout: bz.o[i] }),
    })),
  };
}

/**
 * The handle a smooth curve gives each anchor: a Catmull-Rom tangent, a sixth of the way
 * from its neighbour behind to its neighbour ahead. It passes THROUGH every anchor, which
 * is the point — the curve goes where you clicked. An open line's ends aim at their one
 * neighbour.
 */
export function smoothTangents(c: Curve): Vec2[] {
  const n = c.points.length;
  return c.points.map((_, i) => {
    const prev = c.closed ? c.points[(i - 1 + n) % n] : c.points[Math.max(0, i - 1)];
    const next = c.closed ? c.points[(i + 1) % n] : c.points[Math.min(n - 1, i + 1)];
    return scale(minus(next, prev), 1 / 6);
  });
}

/** Every anchor given the handles it currently draws with — what turning a smooth curve
 *  into a hand-edited one keeps, so switching does not change its shape. */
export function bakeHandles(c: Curve, type: CurveType): Curve {
  if (type === 'bezier') return c;
  const t = smoothTangents(c);
  return {
    closed: c.closed,
    points: c.points.map((p, i) => (type === 'polyline' ? { x: p.x, y: p.y } : { x: p.x, y: p.y, hin: scale(t[i], -1), hout: t[i] })),
  };
}

/** The four control points of segment `i` as the curve draws it. */
function segment(c: Curve, type: CurveType, i: number, tangents = type === 'smooth' ? smoothTangents(c) : null): [Vec2, Vec2, Vec2, Vec2] {
  const n = c.points.length;
  const a = c.points[i], b = c.points[(i + 1) % n];
  if (type === 'polyline') return [a, a, b, b];
  const out = tangents ? tangents[i] : (a.hout ?? { x: 0, y: 0 });
  const inn = tangents ? scale(tangents[(i + 1) % n], -1) : (b.hin ?? { x: 0, y: 0 });
  return [a, plus(a, out), plus(b, inn), b];
}

const segmentCount = (c: Curve) => (c.closed ? c.points.length : c.points.length - 1);

/** Back to a path. A single point is not a curve, and gives nothing. */
export function curveToPath(c: Curve, type: CurveType): string {
  const n = c.points.length;
  if (n < 2) return '';
  const tangents = type === 'smooth' ? smoothTangents(c) : null;
  let d = `M ${f(c.points[0])}`;
  for (let i = 0; i < segmentCount(c); i++) {
    const [, c1, c2, b] = segment(c, type, i, tangents);
    d += type === 'polyline' ? ` L ${f(b)}` : ` C ${f(c1)} ${f(c2)} ${f(b)}`;
  }
  return c.closed ? `${d} Z` : d;
}

const bez = (p: [Vec2, Vec2, Vec2, Vec2], t: number): Vec2 => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + cc * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + cc * p[2].y + d * p[3].y };
};

/** The segment, and how far along it, closest to `p` — where a double-click inserts. */
export function nearestOnCurve(c: Curve, type: CurveType, p: Vec2): { seg: number; t: number; dist: number } | null {
  if (c.points.length < 2) return null;
  const tangents = type === 'smooth' ? smoothTangents(c) : null;
  let best: { seg: number; t: number; dist: number } | null = null;
  for (let i = 0; i < segmentCount(c); i++) {
    const s = segment(c, type, i, tangents);
    for (let k = 0; k <= 32; k++) {
      const q = bez(s, k / 32);
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || dd < best.dist) best = { seg: i, t: k / 32, dist: dd };
    }
  }
  return best;
}

/**
 * A new anchor on segment `seg`, `t` of the way along, exactly where the curve already
 * runs. A hand-edited curve is split properly (de Casteljau) so its shape does not move
 * at all; a smooth one simply gains the point and flows through it.
 */
export function insertPoint(c: Curve, type: CurveType, seg: number, t: number): Curve {
  const n = c.points.length;
  const s = segment(c, type, seg);
  const at = bez(s, t);
  const points = c.points.map((p) => ({ ...p }));
  if (type !== 'bezier') {
    points.splice(seg + 1, 0, { x: at.x, y: at.y });
    return { closed: c.closed, points };
  }
  const [p0, c1, c2, p1] = s;
  const q0 = lerp2(p0, c1, t), q1 = lerp2(c1, c2, t), q2 = lerp2(c2, p1, t);
  const r0 = lerp2(q0, q1, t), r1 = lerp2(q1, q2, t);
  const a = points[seg], b = points[(seg + 1) % n];
  a.hout = minus(q0, p0);
  b.hin = minus(q2, p1);
  points.splice(seg + 1, 0, { x: at.x, y: at.y, hin: minus(r0, at), hout: minus(r1, at) });
  return { closed: c.closed, points };
}

/** Without anchor `i`. Null when that would leave fewer than two — no longer a curve. */
export function removePoint(c: Curve, i: number): Curve | null {
  if (c.points.length <= 2 || i < 0 || i >= c.points.length) return null;
  return { closed: c.closed && c.points.length > 3, points: c.points.filter((_, k) => k !== i) };
}

/** The same curve, run the other way — which end text starts from, which way it reads. */
export function reverseCurve(c: Curve): Curve {
  return { closed: c.closed, points: [...c.points].reverse().map((p) => ({ x: p.x, y: p.y, ...(p.hout ? { hin: p.hout } : {}), ...(p.hin ? { hout: p.hin } : {}) })) };
}

export function moveAnchor(c: Curve, i: number, to: Vec2): Curve {
  return { closed: c.closed, points: c.points.map((p, k) => (k === i ? { ...p, x: to.x, y: to.y } : p)) };
}

/**
 * Drag one handle to `to`. The other one on the same anchor turns to stay opposite and
 * keeps its own length, which is what keeps a smooth point smooth — unless `free`, the
 * Alt/Option drag that breaks the pair into a corner.
 */
export function moveHandle(c: Curve, i: number, which: 'in' | 'out', to: Vec2, free = false): Curve {
  return {
    closed: c.closed,
    points: c.points.map((p, k) => {
      if (k !== i) return p;
      const h = minus(to, p);
      const next: CurvePoint = { ...p, [which === 'in' ? 'hin' : 'hout']: h };
      const other = which === 'in' ? 'hout' : 'hin';
      const len = Math.hypot(h.x, h.y);
      if (!free && len > 1e-9) {
        const keep = p[other] ? Math.hypot(p[other]!.x, p[other]!.y) : len;
        next[other] = scale(h, -keep / len);
      }
      return next;
    }),
  };
}

/** Straight between its two ends: the shortest curve there is, and what a path starts as. */
export function lineCurve(a: Vec2, b: Vec2): Curve {
  return { closed: false, points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] };
}
