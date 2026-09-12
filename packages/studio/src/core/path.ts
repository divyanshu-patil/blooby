import type { ShapeKind, Vec2 } from './types';

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

type Seg = {
  p0: Vec2; p1: Vec2; c1?: Vec2; c2?: Vec2;
  /** first segment of a subpath */
  head?: true;
  /** on a head: the subpath ended in Z. An imported polyline does not, and closing it
   *  on the way through would give it an edge it never had. */
  closed?: true;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

/** Parses the subset this app writes and imports: M L H V C S Q T A Z. */
function segments(d: string): Seg[] {
  if (typeof d !== 'string') return [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const segs: Seg[] = [];
  let opensSubpath = true;
  let headAt = -1;
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
    const push = (...ss: Seg[]) => {
      if (ss.length && opensSubpath) { ss[0].head = true; opensSubpath = false; headAt = segs.length; }
      segs.push(...ss);
    };

    if (C === 'M') {
      cur = pt(rel); start = { ...cur }; lastC = lastQ = null;
      cmd = rel ? 'l' : 'L';   // repeated pairs after M are implicit line-tos
      opensSubpath = true;
      step();
      continue;
    }
    if (C === 'Z') {
      if (dist(cur, start) > 1e-9) push({ p0: cur, p1: start });
      if (headAt >= 0 && !opensSubpath) segs[headAt].closed = true;
      cur = { ...start }; lastC = lastQ = null;
      // numbers after a Z are not valid SVG; drop the command so they fall through to the
      // skip below instead of re-entering this branch, which reads nothing
      cmd = '';
      step();
      continue;
    }
    if (C === 'L') { const p = pt(rel); push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'H') { const x = num(); const p = { x: rel ? cur.x + x : x, y: cur.y }; push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'V') { const y = num(); const p = { x: cur.x, y: rel ? cur.y + y : y }; push({ p0: cur, p1: p }); cur = p; lastC = lastQ = null; step(); continue; }
    if (C === 'C') { const c1 = pt(rel), c2 = pt(rel), p = pt(rel); push({ p0: cur, c1, c2, p1: p }); cur = p; lastC = c2; lastQ = null; step(); continue; }
    if (C === 'S') {
      const c1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : cur;
      const c2 = pt(rel), p = pt(rel);
      push({ p0: cur, c1, c2, p1: p }); cur = p; lastC = c2; lastQ = null; step(); continue;
    }
    if (C === 'Q' || C === 'T') {
      const q: Vec2 = C === 'Q' ? pt(rel) : (lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : cur);
      const p = pt(rel);
      // a quadratic IS a cubic with the control point pulled two-thirds of the way out
      push({
        p0: cur, p1: p,
        c1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) },
        c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
      });
      cur = p; lastQ = q; lastC = null; step(); continue;
    }
    if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      const p = pt(rel);
      push(...arcSegs(cur, p, rx, ry, rot, large, sweep));
      cur = p; lastC = lastQ = null; step(); continue;
    }
    i++;
  }
  return segs;
}

/**
 * One `d` per subpath.
 *
 * A path with two `M`s is two separate outlines — the bar and the dot of an exclamation
 * mark. Flattened as one polyline they get joined by a spurious edge, which in the Lottie
 * export drew the two as a single filled blob.
 */
export function splitSubpaths(d: string): string[] {
  return subpathSegs(segments(d)).map(serialise);
}

function subpathSegs(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  for (const seg of segs) {
    if (seg.head || !out.length) out.push([]);
    out[out.length - 1].push(seg);
  }
  return out.filter((g) => g.length);
}

const finiteSeg = (s: Seg) => finite(s.p0) && finite(s.p1) && (!s.c1 || finite(s.c1)) && (!s.c2 || finite(s.c2));

/**
 * Every point of a path pushed through `f`, curves kept as curves.
 *
 * Exact for an affine `f` — a Bézier's control points transform with it — which is every
 * use here: an SVG element's own transform, a viewBox re-based into the unit box, a
 * library shape fitted to a layer. Flattening to points first would throw away the
 * curves an imported outline is made of, and the anchors the shape editor lets you drag.
 */
export function mapPath(d: string, f: (p: Vec2) => Vec2): string {
  const fp = (p: Vec2 | undefined) => (p ? f(p) : p);
  return subpathSegs(segments(d).filter(finiteSeg))
    .map((g) => serialise(g.map((s) => ({ p0: f(s.p0), p1: f(s.p1), c1: fp(s.c1), c2: fp(s.c2), closed: s.closed }))))
    .join(' ');
}

/** The box a path's outline occupies, or null for a path with nothing in it. */
export function pathBounds(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segments(d)) {
    if (!finiteSeg(s)) continue;
    // a curve can bulge past its end points, so walk it rather than trusting the anchors
    const steps = s.c1 ? 16 : 1;
    for (let k = 0; k <= steps; k++) {
      const p = along(s, k / steps);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * A path fitted into the -0.5..0.5 box, filling it on both axes, plus the box it came from.
 *
 * Filling both axes rather than keeping the aspect is deliberate: the layer's own size
 * carries the aspect, exactly as it does for every generated shape, so a morph between an
 * imported outline and a circle is a morph between two outlines of the same box.
 */
export function normalizePath(d: string): { d: string; bounds: { x: number; y: number; w: number; h: number } } | null {
  const b = pathBounds(d);
  if (!b) return null;
  const w = Math.max(b.x1 - b.x0, 1e-6), h = Math.max(b.y1 - b.y0, 1e-6);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const out = mapPath(d, (p) => ({ x: (p.x - cx) / w, y: (p.y - cy) / h }));
  return out ? { d: out, bounds: { x: cx, y: cy, w, h } } : null;
}


/**
 * An elliptical arc as cubic segments, per the SVG spec's endpoint parameterisation.
 *
 * These used to be chorded — a straight line from start to end — on the grounds that this
 * app does not write arcs itself. It imports them: half the shape library draws its round
 * parts with `a`, so an exclamation mark and a quaver's notehead both flattened to slivers
 * and vanished from the Lottie export while the all-straight `zed` came out fine.
 */
function arcSegs(p0: Vec2, p1: Vec2, rx: number, ry: number, rotDeg: number, large: number, sweep: number): Seg[] {
  if (!rx || !ry || (p0.x === p1.x && p0.y === p1.y)) return [{ p0, p1 }];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy;

  // an arc whose radii cannot span the chord is scaled up until it just can
  const over = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (over > 1) { const k = Math.sqrt(over); rx *= k; ry *= k; }

  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(uy, ux), b = Math.atan2(vy, vx);
    let d = b - a;
    if (d < 0) d += 2 * Math.PI;
    return d;
  };
  const th0 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
  let sweepAng = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep) sweepAng -= 2 * Math.PI;

  const on = (th: number): Vec2 => ({
    x: cx + rx * Math.cos(th) * cosP - ry * Math.sin(th) * sinP,
    y: cy + rx * Math.cos(th) * sinP + ry * Math.sin(th) * cosP,
  });
  const slope = (th: number): Vec2 => ({
    x: -rx * Math.sin(th) * cosP - ry * Math.cos(th) * sinP,
    y: -rx * Math.sin(th) * sinP + ry * Math.cos(th) * cosP,
  });

  // <=90 degrees per cubic: the standard bound where the approximation error stays invisible
  const n = Math.max(1, Math.ceil(Math.abs(sweepAng) / (Math.PI / 2)));
  const dth = sweepAng / n;
  const alpha = (4 / 3) * Math.tan(dth / 4);
  const out: Seg[] = [];
  for (let s = 0; s < n; s++) {
    const a0 = th0 + s * dth, a1 = a0 + dth;
    const q0 = on(a0), q1 = on(a1), d0 = slope(a0), d1 = slope(a1);
    out.push({
      p0: q0, p1: q1,
      c1: { x: q0.x + alpha * d0.x, y: q0.y + alpha * d0.y },
      c2: { x: q1.x - alpha * d1.x, y: q1.y - alpha * d1.y },
    });
  }
  return out;
}

/**
 * Back to a `d` string, faithfully enough to edit.
 *
 * H/V/S/T come back as L/C and an arc as a line, which is what `segments` already
 * normalised them to — visually identical for anything this app draws, and it means one
 * representation to move a point in rather than a parser that must preserve every spelling.
 */
function serialise(segs: Seg[]): string {
  if (!segs.length) return '';
  const f = (v: Vec2) => `${round(v.x)} ${round(v.y)}`;
  let d = `M ${f(segs[0].p0)}`;
  for (const s of segs) d += s.c1 && s.c2 ? ` C ${f(s.c1)} ${f(s.c2)} ${f(s.p1)}` : ` L ${f(s.p1)}`;
  return segs[0].closed ? `${d} Z` : d;
}

/**
 * The on-curve points of a path, in order — what a user grabs to reshape it.
 *
 * Anchors, not the resampled points `flattenPath` produces: dragging one of 64 evenly
 * spaced samples would fight the seven that actually define the outline.
 */
export function pathAnchors(d: string): Vec2[] {
  const segs = segments(d);
  if (!segs.length) return [];
  const pts = [segs[0].p0, ...segs.map((s) => s.p1)];
  // a closed path ends where it started; that is one anchor, not two
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts;
}

/**
 * Moves one anchor, carrying its adjacent control handles with it.
 *
 * Translating the handles rigidly rather than leaving them behind keeps the curvature
 * either side of the point — otherwise dragging a corner of a circle flattens the two
 * arcs meeting there and the shape collapses as you edit it.
 */
export function movePathAnchor(d: string, index: number, to: Vec2): string {
  const segs = segments(d).map((s) => ({ ...s }));
  if (!segs.length) return d;
  const anchors = pathAnchors(d);
  if (index < 0 || index >= anchors.length) return d;
  const from = anchors[index];
  const dx = to.x - from.x, dy = to.y - from.y;
  const shift = (p: Vec2 | undefined) => (p ? { x: p.x + dx, y: p.y + dy } : p);
  const same = (p: Vec2) => dist(p, from) < 1e-9;

  for (const s of segs) {
    if (same(s.p0)) { s.p0 = shift(s.p0)!; s.c1 = shift(s.c1); }
    if (same(s.p1)) { s.p1 = shift(s.p1)!; s.c2 = shift(s.c2); }
  }
  return serialise(segs);
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

/**
 * Recently flattened outlines. A morph resamples both ends on every frame it is drawn, and
 * the exporter asks for the same outlines again per frame — the answer for a given `d`
 * never changes, so it is worked out once. Treat what comes back as read-only.
 *
 * ponytail: clear-when-full rather than LRU; a scrub touches a handful of outlines, and a
 * project would need hundreds of distinct shapes in play at once before this thrashed.
 */
const flatCache = new Map<string, Vec2[]>();
const CACHE_MAX = 600;

/** `n` points spaced evenly along the outline by arc length. */
export function flattenPath(d: string, n = 64): Vec2[] {
  const key = `${n}|${d}`;
  const hit = flatCache.get(key);
  if (hit) return hit;
  const out = flattenUncached(d, n);
  if (flatCache.size >= CACHE_MAX) flatCache.clear();
  flatCache.set(key, out);
  return out;
}

function flattenUncached(d: string, n: number): Vec2[] {
  // the shape editor takes pasted text, so a malformed path has to degrade to "nothing"
  // rather than to NaN coordinates the renderer would happily write into the DOM
  const segs = segments(d).filter(finiteSeg);
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

/** Signed area (shoelace). Its sign is the winding direction. */
export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** `b`'s points, wound the same way as `a`'s and rotated into their best alignment. */
const alignCache = new Map<string, Vec2[]>();
function aligned(a: string, b: string, n: number): { pa: Vec2[]; pb: Vec2[] } | null {
  const pa = flattenPath(a, n), raw = flattenPath(b, n);
  if (!pa.length || !raw.length) return null;
  const key = `${n}|${a} ${b}`;
  let pb = alignCache.get(key);
  if (!pb) {
    // two outlines drawn in opposite directions morph by turning inside out; an imported
    // SVG is as likely to run anticlockwise as not, so match the direction first
    const src = Math.sign(signedArea(pa)) !== Math.sign(signedArea(raw)) ? [...raw].reverse() : raw;
    const o = bestOffset(pa, src);
    pb = pa.map((_, k) => src[(k + o) % src.length]);
    if (alignCache.size >= CACHE_MAX) alignCache.clear();
    alignCache.set(key, pb);
  }
  return { pa, pb };
}

/**
 * `a` at t=0, `b` at t=1, a real shape in between.
 *
 * `t` is allowed past either end: an overshooting or elastic curve eases a morph beyond
 * its target and back, and the outline carrying on past `b` for a moment is exactly the
 * squash-and-settle that curve is for. Clamping it made "Elastic Morph" a plain one.
 */
export function morphPath(a: string, b: string, t: number, n = 64): string {
  if (t === 0 || !Number.isFinite(t)) return a;
  if (t === 1) return b;
  const al = aligned(a, b, n);
  if (!al) return t < 0.5 ? a : b;
  return pathFromPoints(al.pa.map((p, k) => {
    const q = al.pb[k];
    return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
  }));
}

/* ---- built-in shapes ------------------------------------------------------
 * All generated in a -0.5..0.5 box, so the renderer scales one to any size and a morph
 * between two of them is about their outlines rather than their dimensions.
 */
export type PrimitiveShape = ShapeKind | 'custom';
/**
 * Every outline this file can generate, in the order the pickers offer them.
 * `custom` is not generated — it is whatever was typed or dragged, so it is not offered.
 * The shape library (core/emitters SHAPE_LIBRARY) lists each of these with a name and an
 * icon; this is the engine it reads.
 */
export const PRIMITIVE_SHAPES: ShapeKind[] = ['circle', 'pill', 'rect', 'polygon', 'star', 'pebble', 'capsule', 'roundedRect', 'blob', 'octopus'];

/** What a person calls each one. `pill` is the eyes' stadium; the character pill is `capsule`. */
export const SHAPE_LABEL: Record<ShapeKind, string> = {
  circle: 'Circle', pill: 'Stadium', rect: 'Rectangle', polygon: 'Polygon', star: 'Star',
  pebble: 'Pebble', capsule: 'Pill', roundedRect: 'Rounded rect', blob: 'Cute blob', octopus: 'Octopus',
};

/** Which generated shapes have dials, and which. The rest are fixed outlines. */
export const SHAPE_DIALS: Partial<Record<ShapeKind, (keyof ShapeParams)[]>> = {
  rect: ['cornerRadius', 'rotation'], roundedRect: ['cornerRadius', 'rotation'], pill: ['rotation'],
  polygon: ['points', 'vertexRadius', 'rotation'], star: ['points', 'innerRatio', 'vertexRadius', 'rotation'],
  circle: ['rotation'], pebble: ['rotation'], capsule: ['rotation'], blob: ['rotation'], octopus: ['rotation'],
};

export interface ShapeParams {
  /** polygon: sides. star: points. */
  points?: number;
  /** star: how far in the inner vertices sit, 0.05–0.9 */
  innerRatio?: number;
  /** rect: corner rounding, 0–0.5 of the box. pill: how round the ends are. */
  cornerRadius?: number;
  /** star/polygon: rounds the vertices, 0–1 of the way to the neighbouring edge */
  vertexRadius?: number;
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

  // A circle as a cubic spline: exact (a rounded 12-gon came out 6.5% short of πr²), and
  // made of real control points, so turning it turns something and the editor has
  // something to drag when you want to pull it into an egg.
  if (shape === 'circle') return circleSpline(8, 0.5, f);

  // the eyes' own shape: a stadium, which is a rect with fully rounded ends
  if (shape === 'pill') return primitivePath('rect', { ...p, cornerRadius: 0.5 });
  if (shape === 'roundedRect') return primitivePath('rect', { ...p, cornerRadius: p.cornerRadius ?? 0.3 });

  // The character outlines. Each is a handful of points through a smooth closed spline,
  // so they are soft by construction and come with real anchors to drag. They sit inside
  // the unit box at their own proportions rather than filling it — on the square body a
  // pill has to read as a pill, not stretch back into a circle.
  // A spline through points overshoots them between points, so each is drawn plain,
  // shrunk back inside the box, and only then turned — every generated shape stays in
  // -0.5..0.5, which is what lets the renderer scale any of them to any layer.
  const character = (pts: Vec2[]) => {
    const d = fitBox(smoothClosed(pts, (v) => `${round(v.x)} ${round(v.y)}`));
    return rot ? mapPath(d, spin) : d;
  };
  if (shape === 'pebble') {
    // wider than tall, heavier at the bottom: a stone that has settled
    return character(ring(14, (a) => {
      const r = 0.5 * (1 + 0.06 * Math.sin(a) - 0.035 * Math.cos(2 * a));
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.84 + 0.02 };
    }));
  }
  if (shape === 'capsule') return capsule(0.34, f);
  if (shape === 'blob') {
    // two low lobes on different phases, so it never looks like a flower
    return character(ring(16, (a) => {
      const r = 0.47 * (1 + 0.075 * Math.sin(3 * a + 0.6) + 0.05 * Math.sin(2 * a + 1.9));
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }));
  }
  if (shape === 'octopus') return character(OCTOPUS);

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
  return roundedPolygon(shape === 'star' ? n * 2 : n, 0.5, shape === 'star' ? 0.5 * inner : 0.5,
    Math.min(1, Math.max(0, p.vertexRadius ?? 0)), f);
}

/** Scale a centred outline down, about the origin, until it fits the -0.5..0.5 box. */
function fitBox(d: string): string {
  const b = pathBounds(d);
  if (!b) return d;
  // a hair inside, not on, the edge: coordinates are written rounded to 0.001, and a
  // point fitted to exactly 0.5 can round out past it
  const reach = Math.max(-b.x0, b.x1, -b.y0, b.y1);
  if (reach <= 0.498) return d;
  const k = 0.498 / reach;
  return mapPath(d, (p) => ({ x: p.x * k, y: p.y * k }));
}

/** `n` points around the centre, clockwise from the top like every other shape here. */
function ring(n: number, at: (angle: number) => Vec2): Vec2[] {
  return Array.from({ length: n }, (_, i) => at(-Math.PI / 2 + (i / n) * Math.PI * 2));
}

/** A tall capsule inside the unit box: straight sides, round ends, `hw` half-width. */
function capsule(hw: number, f: (v: Vec2) => string): string {
  // each round end is two quarter circles of radius hw; k is the circle-through-cubics
  // handle length for that radius
  const r = hw, k = r * K, top = -0.5, bot = 0.5;
  return `M ${f({ x: -hw, y: top + r })}`
    + ` C ${f({ x: -hw, y: top + r - k })} ${f({ x: -k, y: top })} ${f({ x: 0, y: top })}`
    + ` C ${f({ x: k, y: top })} ${f({ x: hw, y: top + r - k })} ${f({ x: hw, y: top + r })}`
    + ` L ${f({ x: hw, y: bot - r })}`
    + ` C ${f({ x: hw, y: bot - r + k })} ${f({ x: k, y: bot })} ${f({ x: 0, y: bot })}`
    + ` C ${f({ x: -k, y: bot })} ${f({ x: -hw, y: bot - r + k })} ${f({ x: -hw, y: bot - r })} Z`;
}

/**
 * The octopus: a dome over four stubby, rounded tentacles. Clockwise from the right
 * shoulder, down and along the tentacle tips, up the left side and over the top. The
 * spline rounds every tip and every gap, so there is no corner anywhere in it.
 */
const OCTOPUS: Vec2[] = [
  { x: 0.5, y: 0.02 },
  { x: 0.48, y: 0.34 }, { x: 0.43, y: 0.47 }, { x: 0.375, y: 0.5 }, { x: 0.315, y: 0.46 }, { x: 0.27, y: 0.34 },
  { x: 0.23, y: 0.34 }, { x: 0.19, y: 0.46 }, { x: 0.125, y: 0.5 }, { x: 0.06, y: 0.46 }, { x: 0.02, y: 0.34 },
  { x: -0.02, y: 0.34 }, { x: -0.06, y: 0.46 }, { x: -0.125, y: 0.5 }, { x: -0.19, y: 0.46 }, { x: -0.23, y: 0.34 },
  { x: -0.27, y: 0.34 }, { x: -0.315, y: 0.46 }, { x: -0.375, y: 0.5 }, { x: -0.43, y: 0.47 }, { x: -0.48, y: 0.34 },
  { x: -0.5, y: 0.02 },
  { x: -0.46, y: -0.24 }, { x: -0.33, y: -0.43 }, { x: 0, y: -0.5 }, { x: 0.33, y: -0.43 }, { x: 0.46, y: -0.24 },
];

/**
 * A closed Catmull-Rom spline through `pts`, written as cubics.
 *
 * Catmull-Rom because it passes THROUGH its points: the outline is exactly the points it
 * was designed from, and each one becomes an anchor the shape editor can drag.
 */
function smoothClosed(pts: Vec2[], f: (v: Vec2) => string): string {
  const n = pts.length;
  const P = (i: number) => pts[((i % n) + n) % n];
  let d = `M ${f(P(0))}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${f(c1)} ${f(c2)} ${f(p2)}`;
  }
  return `${d} Z`;
}

/**
 * A circle as `n` cubic segments.
 *
 * The handle length 4/3·tan(π/2n) is the standard approximation, exact to within a few
 * parts in 10,000 at n=8 — near enough that the area check cannot tell it from πr².
 */
function circleSpline(n: number, r: number, f: (v: Vec2) => string): string {
  const k = r * (4 / 3) * Math.tan(Math.PI / (2 * n));
  const at = (i: number): Vec2 => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };
  const tangent = (i: number): Vec2 => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: -Math.sin(a) * k, y: Math.cos(a) * k };
  };
  let d = `M ${f(at(0))}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i), p1 = at(i + 1), t0 = tangent(i), t1 = tangent(i + 1);
    d += ` C ${f({ x: p0.x + t0.x, y: p0.y + t0.y })} ${f({ x: p1.x - t1.x, y: p1.y - t1.y })} ${f(p1)}`;
  }
  return `${d} Z`;
}

/**
 * A ring of vertices alternating between two radii, with the corners optionally rounded.
 *
 * Covers the circle (12 fully-rounded points), the polygon (one radius, sharp) and the
 * star (two radii, roundable) from one routine — a rounded star is the same construction
 * as a circle, just with a waist.
 *
 * Rounding pulls each corner back along both its edges by `round` and joins them with a
 * quadratic through the original vertex, which is what a corner radius IS.
 */
function roundedPolygon(count: number, outer: number, innerR: number, round: number, f: (v: Vec2) => string): string {
  const verts: Vec2[] = [];
  for (let k = 0; k < count; k++) {
    // start at the top: a star stands on a point rather than lying on its side
    const a = -Math.PI / 2 + (k / count) * Math.PI * 2;
    const r = innerR !== outer && k % 2 === 1 ? innerR : outer;
    verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  if (round <= 0) return `M ${f(verts[0])} ${verts.slice(1).map((v) => `L ${f(v)}`).join(' ')} Z`;

  const toward = (from: Vec2, to: Vec2, amount: number): Vec2 => {
    // never past the midpoint, or neighbouring corners would cross
    const t = Math.min(0.5, amount);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  };

  let d = '';
  for (let k = 0; k < count; k++) {
    const prev = verts[(k - 1 + count) % count], cur = verts[k], next = verts[(k + 1) % count];
    const a = toward(cur, prev, round / 2), b = toward(cur, next, round / 2);
    d += k === 0 ? `M ${f(a)}` : ` L ${f(a)}`;
    d += ` Q ${f(cur)} ${f(b)}`;
  }
  return `${d} Z`;
}

/**
 * The outline a layer already has, before anyone touches the shape editor.
 *
 * The body is drawn as an ellipse and the eyes as stadiums, so those are the shapes the
 * editor should open on — selecting an eye and being told it is a "circle" is a lie, and
 * morphing away from the wrong resting shape pops on the first frame.
 */
export function naturalShape(kind: string, primitive?: { shape: string }): PrimitiveShape {
  if (kind === 'body') return 'circle';
  if (primitive?.shape === 'circle') return 'circle';
  return 'pill';
}

/** The outline a layer draws right now: its own, or the one its plain primitive is. What
 *  a first shape keyframe holds, so keying a layer that never had an outline works. */
export const naturalOutline = (n: { kind: string; primitive?: { shape: string }; shapePath?: string }) =>
  n.shapePath ?? primitivePath(naturalShape(n.kind, n.primitive));
