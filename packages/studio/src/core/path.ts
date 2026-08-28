import type { Vec2 } from './types';

/**
 * Shape morphing: turning one SVG path into another over time.
 *
 * Two `d` strings almost never share a command structure, so lerping their numbers
 * pairwise produces garbage. Instead both are flattened to the same number of points
 * spaced evenly along their outline, rotated into their best alignment, and interpolated
 * point by point. That morphs any closed shape into any other.
 *
 * Everything here is arithmetic on purpose. `SVGPathElement.getPointAtLength` would do the
 * flattening for free, but only in a browser — the selfcheck, the exporter and any
 * headless render need this to work in node, and a morph that behaves differently in the
 * preview than in the export is worse than no morph.
 */

type Seg = { p0: Vec2; p1: Vec2; c1?: Vec2; c2?: Vec2 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

/** Parses the subset this app writes and imports: M L H V C S Q T A(chorded) Z. */
function segments(d: string): Seg[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const segs: Seg[] = [];
  let i = 0, cmd = '';
  let cur: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  let lastC: Vec2 | null = null;
  let lastQ: Vec2 | null = null;

  const num = () => Number(tokens[i++]);
  const pt = (rel: boolean): Vec2 => {
    const x = num(), y = num();
    return rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
  };

  while (i < tokens.length) {
    // every iteration MUST consume at least one token. A malformed path can otherwise
    // leave `cmd` on a command that reads nothing — 'M 1 zz 4' parked it on Z, which
    // consumes nothing and spun forever.
    const before = i;
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (i >= tokens.length && cmd.toUpperCase() !== 'Z') break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const step = () => { if (i === before) i++; };

    if (C === 'M') {
      cur = pt(rel); start = { ...cur }; lastC = lastQ = null;
      cmd = rel ? 'l' : 'L';   // repeated pairs after M are implicit line-tos
      step();
      continue;
    }
    if (C === 'Z') {
      if (dist(cur, start) > 1e-9) segs.push({ p0: cur, p1: start });
      cur = { ...start }; lastC = lastQ = null;
      // numbers after a Z are not valid SVG; drop the command so they fall through to the
      // skip below instead of re-entering this branch, which reads nothing
      cmd = '';
      step();
      continue;
    }
    if (C === 'L') { const p = pt(rel); segs.push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'H') { const x = num(); const p = { x: rel ? cur.x + x : x, y: cur.y }; segs.push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'V') { const y = num(); const p = { x: cur.x, y: rel ? cur.y + y : y }; segs.push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'C') { const c1 = pt(rel), c2 = pt(rel), p = pt(rel); segs.push({ p0: cur, c1, c2, p1: p }); cur = p; lastC = c2; lastQ = null; step(); continue; }
    if (C === 'S') {
      const c1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : cur;
      const c2 = pt(rel), p = pt(rel);
      segs.push({ p0: cur, c1, c2, p1: p }); cur = p; lastC = c2; lastQ = null; step(); continue;
    }
    if (C === 'Q' || C === 'T') {
      const q: Vec2 = C === 'Q' ? pt(rel) : (lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : cur);
      const p = pt(rel);
      // a quadratic IS a cubic with the control point pulled two-thirds of the way out
      segs.push({
        p0: cur, p1: p,
        c1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) },
        c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
      });
      cur = p; lastQ = q; lastC = null; step(); continue;
    }
    // arcs are chorded rather than swept: they are rare in this app's own output, and a
    // straight line between the endpoints keeps an imported path closed and morphable
    if (C === 'A') { i += 5; const p = pt(rel); segs.push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    i++;
  }
  return segs;
}

const along = (s: Seg, t: number): Vec2 => {
  if (!s.c1 || !s.c2) return { x: lerp(s.p0.x, s.p1.x, t), y: lerp(s.p0.y, s.p1.y, t) };
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y,
  };
};

const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** `n` points spaced evenly along the outline by arc length. */
export function flattenPath(d: string, n = 64): Vec2[] {
  // the shape editor takes pasted text, so a malformed path has to degrade to "nothing"
  // rather than to NaN coordinates the renderer would happily write into the DOM
  const segs = segments(d).filter((s) => finite(s.p0) && finite(s.p1) && (!s.c1 || finite(s.c1)) && (!s.c2 || finite(s.c2)));
  if (!segs.length) return [];

  // walk each segment finely first, so "evenly spaced" means by distance travelled rather
  // than by parameter — a long straight and a tight curve each get their fair share
  const walk: Vec2[] = [];
  const lens: number[] = [];
  let total = 0;
  for (const s of segs) {
    const steps = s.c1 ? 24 : 1;
    for (let k = 1; k <= steps; k++) {
      const p = along(s, k / steps);
      const prev = walk.length ? walk[walk.length - 1] : s.p0;
      total += dist(prev, p);
      walk.push(p);
      lens.push(total);
    }
  }
  if (total <= 0) return Array.from({ length: n }, () => ({ ...segs[0].p0 }));

  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (j < lens.length - 1 && lens[j] < target) j++;
    const prevLen = j > 0 ? lens[j - 1] : 0;
    const prevPt = j > 0 ? walk[j - 1] : segs[0].p0;
    const span = lens[j] - prevLen;
    const t = span <= 0 ? 0 : (target - prevLen) / span;
    out.push({ x: lerp(prevPt.x, walk[j].x, t), y: lerp(prevPt.y, walk[j].y, t) });
  }
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function pathFromPoints(pts: Vec2[]): string {
  if (!pts.length) return '';
  return `M ${round(pts[0].x)} ${round(pts[0].y)} ${pts.slice(1).map((p) => `L ${round(p.x)} ${round(p.y)}`).join(' ')} Z`;
}

/**
 * The offset at which `b`'s points line up best with `a`'s.
 *
 * Without it a square morphing into a star twists on the way, because the two outlines
 * happen to start at different corners.
 *
 * ponytail: O(n²) over 64 points is 4k distance checks per morphed frame, nothing next to
 * the render. If shapes ever carry hundreds of points, test a dozen candidate offsets
 * instead of all of them.
 */
function bestOffset(a: Vec2[], b: Vec2[]): number {
  let best = 0, bestScore = Infinity;
  for (let o = 0; o < b.length; o++) {
    let score = 0;
    for (let k = 0; k < a.length; k++) {
      const p = b[(k + o) % b.length];
      score += (a[k].x - p.x) ** 2 + (a[k].y - p.y) ** 2;
      if (score >= bestScore) break;
    }
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** `a` at t=0, `b` at t=1, a real shape in between. */
export function morphPath(a: string, b: string, t: number, n = 64): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = flattenPath(a, n), pb = flattenPath(b, n);
  if (!pa.length || !pb.length) return t < 0.5 ? a : b;
  const o = bestOffset(pa, pb);
  return pathFromPoints(pa.map((p, k) => {
    const q = pb[(k + o) % pb.length];
    return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
  }));
}

/* ---- built-in shapes ------------------------------------------------------
 * All generated in a -0.5..0.5 box, so the renderer scales one to any size and a morph
 * between two of them is about their outlines rather than their dimensions.
 */
export type PrimitiveShape = 'circle' | 'rect' | 'polygon' | 'star';
export const PRIMITIVE_SHAPES: PrimitiveShape[] = ['circle', 'rect', 'polygon', 'star'];

export interface ShapeParams {
  /** polygon: sides. star: points. */
  points?: number;
  /** star: how far in the inner vertices sit, 0.05–0.9 */
  innerRatio?: number;
  /** rect: corner rounding, 0–0.5 of the box */
  cornerRadius?: number;
  /** turns the whole outline, in degrees — a star on its point or on its side */
  rotation?: number;
}

const K = 0.5522847498;   // circle-through-cubics constant

export function primitivePath(shape: PrimitiveShape, p: ShapeParams = {}): string {
  const rot = ((p.rotation ?? 0) * Math.PI) / 180;
  const spin = (v: Vec2): Vec2 => (rot
    ? { x: v.x * Math.cos(rot) - v.y * Math.sin(rot), y: v.x * Math.sin(rot) + v.y * Math.cos(rot) }
    : v);
  const f = (v: Vec2) => `${round(spin(v).x)} ${round(spin(v).y)}`;

  if (shape === 'circle') {
    const r = 0.5, c = r * K;
    return `M ${f({ x: 0, y: -r })} C ${f({ x: c, y: -r })} ${f({ x: r, y: -c })} ${f({ x: r, y: 0 })}`
      + ` C ${f({ x: r, y: c })} ${f({ x: c, y: r })} ${f({ x: 0, y: r })}`
      + ` C ${f({ x: -c, y: r })} ${f({ x: -r, y: c })} ${f({ x: -r, y: 0 })}`
      + ` C ${f({ x: -r, y: -c })} ${f({ x: -c, y: -r })} ${f({ x: 0, y: -r })} Z`;
  }

  if (shape === 'rect') {
    const r = Math.min(0.5, Math.max(0, p.cornerRadius ?? 0));
    if (r <= 0) return `M ${f({ x: -0.5, y: -0.5 })} L ${f({ x: 0.5, y: -0.5 })} L ${f({ x: 0.5, y: 0.5 })} L ${f({ x: -0.5, y: 0.5 })} Z`;
    const c = r * (1 - K);
    return `M ${f({ x: -0.5 + r, y: -0.5 })} L ${f({ x: 0.5 - r, y: -0.5 })}`
      + ` C ${f({ x: 0.5 - c, y: -0.5 })} ${f({ x: 0.5, y: -0.5 + c })} ${f({ x: 0.5, y: -0.5 + r })}`
      + ` L ${f({ x: 0.5, y: 0.5 - r })}`
      + ` C ${f({ x: 0.5, y: 0.5 - c })} ${f({ x: 0.5 - c, y: 0.5 })} ${f({ x: 0.5 - r, y: 0.5 })}`
      + ` L ${f({ x: -0.5 + r, y: 0.5 })}`
      + ` C ${f({ x: -0.5 + c, y: 0.5 })} ${f({ x: -0.5, y: 0.5 - c })} ${f({ x: -0.5, y: 0.5 - r })}`
      + ` L ${f({ x: -0.5, y: -0.5 + r })}`
      + ` C ${f({ x: -0.5, y: -0.5 + c })} ${f({ x: -0.5 + c, y: -0.5 })} ${f({ x: -0.5 + r, y: -0.5 })} Z`;
  }

  const n = Math.max(3, Math.round(p.points ?? (shape === 'star' ? 5 : 6)));
  const inner = Math.min(0.9, Math.max(0.05, p.innerRatio ?? 0.42));
  const count = shape === 'star' ? n * 2 : n;
  const verts: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    // start at the top: a star stands on a point rather than lying on its side
    const a = -Math.PI / 2 + (k / count) * Math.PI * 2;
    const r = shape === 'star' && k % 2 === 1 ? 0.5 * inner : 0.5;
    verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return `M ${f(verts[0])} ${verts.slice(1).map((v) => `L ${f(v)}`).join(' ')} Z`;
}
