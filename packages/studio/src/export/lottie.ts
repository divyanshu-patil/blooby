import { compOf } from '../core/comp';
import { sceneAt, type SceneItem } from '../core/scene';
import { flattenPath, pathFromPoints, pathToBezier, primitivePath, splitSubpaths } from '../core/path';
import { outlinesOf } from '../core/emitters';
import { activeTimeline } from '../core/types';
import { parseHex } from '../core/color';
import type { ColorStop, Project, Vec2 } from '../core/types';

/**
 * Bakes a Project into Lottie JSON.
 *
 * Lottie has no sphere, no noise and no procedural anything, so the honest move is to
 * sample the same buildScene() the canvas uses once per frame and write the result as
 * literal transform keyframes. Easing, foreshortening, shake and float all arrive
 * pre-resolved. A per-channel simplification pass then throws away every frame that a
 * straight line between its neighbours already predicts, which typically removes 70–90%
 * of them on smooth motion and all of them on a property that never moves.
 *
 * Shapes are ellipses and rounded rects only — the corner radius is always min(w,h)/2,
 * so nothing in the output can have a sharp corner.
 */

export interface LottieOptions {
  /** paint a solid behind the rig; players composite on white otherwise */
  background: string | null;
  name: string;
  /** ms window to export; defaults to the whole timeline */
  from?: number;
  to?: number;
  /**
   * What to draw at a given ms, when it is not simply the active timeline. `strip.ts`
   * uses this to bake every pose plus the morphs between them into one composition —
   * the union of layers and the opacity-0 handling below then apply across the lot.
   */
  sampleAt?: (ms: number) => SceneItem[];
}

type Vec = number[];

interface Chan {
  p: Vec[]; s: Vec[]; r: Vec[]; o: Vec[]; c: Vec[];
  /** the layer fill's own opacity, apart from the layer's */
  fo: Vec[];
  /** the layer stroke: colour, its own opacity, width in the shape's own units */
  sc: Vec[]; so: Vec[]; sw: Vec[];
  /** a pill's own width/height and corner radius, in composition units */
  wh: Vec[]; rr: Vec[];
}

const EPS = { p: 0.2, s: 0.12, r: 0.04, o: 0.4, c: 0.0015, v: 0.25 };

/** Lottie's own enums for a stroke's ends and corners. */
const LINE_CAP = { butt: 1, round: 2, square: 3 } as const;
const LINE_JOIN = { miter: 1, round: 2, bevel: 3 } as const;

/** Drop every frame a straight line between its neighbours already predicts. */
function reduce(frames: Vec[], eps: number): number[] {
  const n = frames.length;
  if (n <= 2) return frames.map((_, i) => i);
  const keep = [0];
  let anchor = 0;
  for (let i = 2; i < n; i++) {
    let ok = true;
    for (let j = anchor + 1; j < i && ok; j++) {
      const u = (j - anchor) / (i - anchor);
      for (let d = 0; d < frames[j].length; d++) {
        const guess = frames[anchor][d] + (frames[i][d] - frames[anchor][d]) * u;
        if (Math.abs(guess - frames[j][d]) > eps) { ok = false; break; }
      }
    }
    if (!ok) { keep.push(i - 1); anchor = i - 1; }
  }
  keep.push(n - 1);
  return keep;
}

const same = (frames: Vec[]) =>
  frames.every((f) => f.every((v, d) => Math.abs(v - frames[0][d]) < 1e-6));

/** A Lottie animated (or static) property, with linear temporal tangents. */
function prop(frames: Vec[], eps: number, startFrame: number) {
  if (!frames.length) return { a: 0, k: [0] };
  if (same(frames)) return { a: 0, k: frames[0].length === 1 ? frames[0][0] : frames[0] };
  const keep = reduce(frames, eps);
  const k = keep.map((i, n) => {
    const key: Record<string, unknown> = { t: startFrame + i, s: frames[i] };
    if (n < keep.length - 1) { key.i = { x: [1], y: [1] }; key.o = { x: [0], y: [0] }; }
    return key;
  });
  return { a: 1, k };
}

export interface BakeResult {
  json: Record<string, unknown>;
  frames: number;
  keyframeCount: number;
  skipped: string[];
  /** names whose geometry was written as bezier vertices rather than a primitive */
  baked: string[];
}

export function bakeLottie(project: Project, opts: LottieOptions): BakeResult {
  const fps = project.fps;
  const from = opts.from ?? 0;
  const to = opts.to ?? activeTimeline(project).timelineDurationMs;
  const total = Math.max(1, Math.round(((to - from) / 1000) * fps));

  // sample once, keep everything
  const frames: SceneItem[][] = [];
  const COMP = compOf(project);
  const sample = opts.sampleAt ?? ((ms: number) => sceneAt(project, ms, COMP));
  for (let f = 0; f <= total; f++) frames.push(sample(from + (f / fps) * 1000));

  const order: string[] = [];
  const seen = new Map<string, SceneItem>();
  for (const scene of frames) {
    for (const item of scene) {
      if (!seen.has(item.id)) { seen.set(item.id, item); order.push(item.id); }
    }
  }

  // stable draw order: the order they settle into at the middle of the range
  const mid = frames[Math.floor(frames.length / 2)];
  order.sort((a, b) => {
    const ia = mid.findIndex((s) => s.id === a), ib = mid.findIndex((s) => s.id === b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  const skipped: string[] = [];
  /** set when any layer is text, so the font descriptor is only written when it is used */
  let usesFont = false;
  /** layers whose outline had to be written as vertices — what "baked" means in the note */
  const baked = new Set<string>();
  const layers: Record<string, unknown>[] = [];
  let keyframeCount = 0;

  order.forEach((id, n) => {
    const first = seen.get(id)!;
    // A glyph with no vector in the shape library — an emoji, an arbitrary character —
    // becomes a real Lottie text layer rather than being dropped. Anything the library
    // DOES have a drawing for never reaches here: emitterItems resolves it to that
    // artwork, in the preview and the export alike.
    if (first.text !== undefined) {
      layers.push(textLayer(id, first, frames, total, (n2) => { keyframeCount += n2; }));
      usesFont = true;
      return;
    }

    // Everything with an outline — a morphing shape, an emitter's artwork, an imported
    // SVG whose paths we can read — becomes real Lottie bezier shapes. Constant outlines
    // are written once; only an outline that actually CHANGES gets per-frame vertices,
    // which is what makes a morph cost what it costs.
    //
    // Scanned across ALL frames, not just the first: a layer can GAIN an outline partway
    // through, which is exactly what a morph clip late in a timeline does. Deciding from
    // frame 0 exported those eyes as plain pills and dropped the morph without a word.
    const outlines = frames
      .map((scene) => scene.find((it) => it.id === id))
      .reduce<Outline[] | null>((found, it) => found ?? (it ? outlinesFor(it) : null), null);
    if (outlines) { baked.add(first.name); }
    // An SVG whose markup held nothing readable as geometry has no honest Lottie form. It
    // is named, so the export note says so, and it does NOT fall through to the pill
    // below — a rounded rectangle standing in for someone's artwork is a silent lie.
    if (!outlines && first.svg) { skipped.push(first.name); return; }

    // base geometry: the largest the shape ever gets, so scale stays <= 100%
    let w0 = 0, h0 = 0;
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      if (it) { w0 = Math.max(w0, it.w); h0 = Math.max(h0, it.h); }
    }
    w0 = Math.max(w0, 0.01); h0 = Math.max(h0, 0.01);

    /**
     * A pill has to be resized, not scaled.
     *
     * Its corner radius lives in the shape's own coordinates, so squashing the LAYER
     * squashes the round ends with it: an eye closing to a fifth of its height came out
     * as a flattened circle rather than a stadium with a thin waist. So the rect carries
     * animated size and radius and the layer transform stays at 100%. An ellipse has no
     * such problem — a scaled ellipse is still an ellipse — and neither does a baked
     * outline, which is written per frame anyway.
     */
    const pill = !outlines && first.shape !== 'ellipse';

    const ch: Chan = { p: [], s: [], r: [], o: [], c: [], fo: [], sc: [], so: [], sw: [], wh: [], rr: [] };
    let last: SceneItem = first;
    // seeded with the FIRST stroke it ever has, so the frames before it appears hold that
    // paint rather than ramping in from an invented black
    let stroked: SceneItem['stroke'] | undefined = frames.map((scene) => scene.find((s) => s.id === id)?.stroke).find(Boolean);
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      const cur = it ?? last;
      if (it) last = it;
      ch.p.push([round(cur.cx, 2), round(cur.cy, 2)]);
      const sx = cur.w / w0, sy = cur.h / h0;
      ch.s.push([round(sx * 100, 3), round(sy * 100, 3)]);
      ch.wh.push([round(cur.w, 3), round(cur.h, 3)]);
      ch.rr.push([round(Math.min(cur.w, cur.h) / 2, 3)]);
      ch.r.push([round(cur.rotation, 3)]);
      /**
       * Layer opacity and paint opacity are separate channels. A layer's alpha — presence,
       * rim fade, opacity, appearance — is the layer's `o`; the fill's and the stroke's own
       * opacities are their own `o`. Folding them together would dim an opaque stroke
       * whenever its fill was set to half. An item that does not report a layer alpha (a
       * particle) keeps the old single channel: its colour's alpha IS its opacity.
       */
      const alpha = cur.alpha ?? cur.color.a;
      const paint = (a: number) => (cur.alpha === undefined ? 1 : Math.min(1, a / Math.max(alpha, 1e-6)));
      ch.o.push([it ? round(alpha * 100, 2) : 0]);
      ch.c.push([round(cur.color.r / 255, 4), round(cur.color.g / 255, 4), round(cur.color.b / 255, 4), 1]);
      ch.fo.push([round(paint(cur.color.a) * 100, 2)]);
      const st = it?.stroke;
      if (st) stroked = st;
      const sc = st?.color ?? stroked?.color ?? { r: 0, g: 0, b: 0, a: 0 };
      ch.sc.push([round(sc.r / 255, 4), round(sc.g / 255, 4), round(sc.b / 255, 4), 1]);
      ch.so.push([st ? round(paint(st.color.a) * 100, 2) : 0]);
      // a stroke is screen px, but the shape it wraps is scaled by the layer — divide it
      // back out (a pill is resized, not scaled, so it needs nothing)
      const k = pill ? 1 : Math.sqrt(Math.max(1e-6, Math.abs(sx * sy)));
      ch.sw.push([round((st?.width ?? stroked?.width ?? 0) / k, 3)]);
    }

    const geometry: Record<string, unknown>[] = outlines
      ? bezierShapes(id, frames, outlines, w0, h0, (n2) => { keyframeCount += n2; })
      : first.shape === 'ellipse'
        ? [{ ty: 'el', d: 1, s: { a: 0, k: [w0, h0] }, p: { a: 0, k: [0, 0] }, nm: 'body' }]
        : [{
          ty: 'rc', d: 1, nm: 'pill', p: { a: 0, k: [0, 0] },
          s: prop(ch.wh, EPS.p, 0),
          r: prop(ch.rr, EPS.p, 0),
        }];
    if (pill) for (const k of ['s', 'r'] as const) {
      const v = geometry[0][k] as { a: number; k: unknown[] };
      if (v.a === 1) keyframeCount += v.k.length;
    }

    const ks = {
      o: prop(ch.o, EPS.o, 0),
      r: prop(ch.r, EPS.r, 0),
      p: prop(ch.p, EPS.p, 0),
      a: { a: 0, k: [0, 0] },
      s: pill ? { a: 0, k: [100, 100] } : prop(ch.s, EPS.s, 0),
    };
    for (const v of Object.values(ks)) if (v.a === 1) keyframeCount += (v.k as unknown[]).length;
    const count = <T extends { a: number; k: unknown }>(v: T) => { if (v.a === 1) keyframeCount += (v.k as unknown[]).length; return v; };
    const layerPaint: LayerPaint = {
      fill: { c: count(prop(ch.c, EPS.c, 0)), o: count(prop(ch.fo, EPS.o, 0)) },
      stroke: stroked
        ? { c: count(prop(ch.sc, EPS.c, 0)), o: count(prop(ch.so, EPS.o, 0)), w: count(prop(ch.sw, EPS.p, 0)),
          lc: LINE_CAP[stroked.cap], lj: LINE_JOIN[stroked.join] }
        : undefined,
      // an imported path's own stroke width is a fraction of the layer's size, which the
      // layer transform already scales — so in the shape's own units it is constant
      unit: Math.sqrt(w0 * h0),
    };

    layers.push({
      ddd: 0, ind: n + 1, ty: 4, nm: first.name, sr: 1, ao: 0, bm: 0,
      ks,
      shapes: paintGroups(first.name, geometry, outlines ?? [], layerPaint),
      ip: 0, op: total + 1, st: 0,
    });
  });

  if (opts.background) {
    // painter's order so far is bottom-first; the backdrop belongs under all of it
    layers.unshift({
      ddd: 0, ind: 0, ty: 1, nm: 'Backdrop', sr: 1, ao: 0, bm: 0,
      sc: opts.background, sw: COMP.width, sh: COMP.height,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [COMP.width / 2, COMP.height / 2] }, a: { a: 0, k: [COMP.width / 2, COMP.height / 2] }, s: { a: 0, k: [100, 100] } },
      ip: 0, op: total + 1, st: 0,
    });
  }
  // lottie-web paints index 1 on top, so flip painter's order and renumber
  layers.reverse().forEach((l, i) => { l.ind = i + 1; });

  return {
    json: {
      v: '5.9.0', fr: fps, ip: 0, op: total, w: COMP.width, h: COMP.height,
      nm: opts.name, ddd: 0, assets: [], layers,
      // no embedded font: the descriptor names a family and the player falls back to it.
      // Only written when something actually uses it, so a file with no glyphs is unchanged.
      ...(usesFont ? { fonts: { list: [{ fName: FONT, fFamily: 'sans-serif', fStyle: 'Regular', ascent: 72 }] } } : {}),
      meta: { g: 'blooby' },
    },
    frames: total,
    keyframeCount,
    skipped,
    baked: [...baked],
  };
}

const round = (v: number, d: number) => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};


type Animated = { a: number; k: unknown };
interface LayerPaint {
  fill: { c: Animated; o: Animated };
  stroke?: { c: Animated; o: Animated; w: Animated; lc: number; lj: number };
  /** the shape's own size unit, sqrt(w0·h0) — what an imported path's stroke width is a fraction of */
  unit: number;
}

const staticColor = (c: ColorStop) => ({ a: 0, k: [round(c.r / 255, 4), round(c.g / 255, 4), round(c.b / 255, 4), 1] });

/**
 * The shape groups for one layer, each with its own fill and stroke.
 *
 * Paths run together while they share a paint, because a group is also what makes holes
 * work: a donut is two subpaths whose fills cancel by winding, and splitting them apart
 * would fill the hole. A path the artwork painted itself — its own colour, its own line —
 * starts a new run with that paint, which is how an imported SVG keeps its palette and its
 * strokes instead of coming out a flat silhouette. Only CONSECUTIVE paths share a group,
 * so the stacking the artwork was drawn in survives.
 *
 * Within a group the stroke is listed before the fill: in Lottie the earlier item paints
 * on top, and an outline belongs over its fill as it does in SVG.
 */
function paintGroups(name: string, geometry: Record<string, unknown>[], outlines: Outline[], paint: LayerPaint): Record<string, unknown>[] {
  const tr = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 'transform' };
  const keyOf = (o: Outline | undefined) => {
    const f = o?.fill === null ? 'none' : o?.fill ? `${o.fill.r},${o.fill.g},${o.fill.b},${o.fill.a}` : 'layer';
    const s = o?.stroke === null || (o?.stroke === undefined && !paint.stroke) ? 'none'
      : o?.stroke ? `${o.stroke.r},${o.stroke.g},${o.stroke.b},${o.stroke.a}:${o.strokeWidth ?? 0}` : `layer:${o?.strokeWidth ?? ''}`;
    return `${f}|${s}|${o?.evenOdd ? 'eo' : 'nz'}`;
  };
  const runs: { key: string; outline?: Outline; shapes: Record<string, unknown>[] }[] = [];
  geometry.forEach((sh, i) => {
    const key = keyOf(outlines[i]);
    const lastRun = runs[runs.length - 1];
    if (lastRun?.key === key) lastRun.shapes.push(sh);
    else runs.push({ key, outline: outlines[i], shapes: [sh] });
  });
  // later paths paint over earlier ones in SVG; in Lottie the first group is on top
  return runs.reverse().map((run, i) => {
    const o = run.outline;
    const items: Record<string, unknown>[] = [...run.shapes];
    if (o?.stroke) {
      items.push({ ty: 'st', c: staticColor(o.stroke), o: { a: 0, k: round(o.stroke.a * 100, 2) }, w: { a: 0, k: round((o.strokeWidth ?? 0) * paint.unit, 3) },
        lc: paint.stroke?.lc ?? 2, lj: paint.stroke?.lj ?? 2, ml: 4, bm: 0, nm: 'stroke', hd: false });
    } else if (o?.stroke === undefined && paint.stroke) {
      items.push({ ty: 'st', c: paint.stroke.c, o: paint.stroke.o,
        w: o?.strokeWidth ? { a: 0, k: round(o.strokeWidth * paint.unit, 3) } : paint.stroke.w,
        lc: paint.stroke.lc, lj: paint.stroke.lj, ml: 4, bm: 0, nm: 'stroke', hd: false });
    }
    if (o?.fill !== null) {
      const fill = o?.fill ? { c: staticColor(o.fill), o: { a: 0, k: round(o.fill.a * 100, 2) } } : paint.fill;
      items.push({ ty: 'fl', c: fill.c, o: fill.o, r: o?.evenOdd ? 2 : 1, bm: 0, nm: 'fill', hd: false });
    }
    items.push(tr);
    return { ty: 'gr', nm: runs.length > 1 ? `${name} ${i + 1}` : name, np: items.length - 1, cix: 2, bm: 0, hd: false, it: items };
  });
}


/* ---- text ------------------------------------------------------------------- */

const FONT = 'blooby-sans';

/**
 * A glyph particle as a Lottie text layer.
 *
 * These used to be dropped from the export with a note, which meant a "zzz" or a "♪"
 * emitter simply did not exist in the .lottie. A text layer needs no embedded font — the
 * player falls back to the family named here — so the only thing that is not guaranteed
 * is which face draws it, and a missing face beats a missing particle.
 *
 * Written as one text document per frame (deduplicated), because size and colour animate.
 * `j: 2` centres horizontally; Lottie sits text on its baseline where the preview centres
 * it on the middle, so the position carries an offset of a bit over a third of the size.
 */
const BASELINE = 0.36;

function textLayer(
  id: string, first: SceneItem, frames: SceneItem[][], total: number, countKeys: (n: number) => void,
): Record<string, unknown> {
  const docs: { t: number; s: Record<string, unknown> }[] = [];
  const pos: Vec[] = [];
  const op: Vec[] = [];
  const rot: Vec[] = [];
  let last: SceneItem = first;
  frames.forEach((scene, f) => {
    const it = scene.find((s) => s.id === id);
    const cur = it ?? last;
    if (it) last = it;
    const size = Math.max(0.01, cur.h);
    pos.push([round(cur.cx, 2), round(cur.cy + size * BASELINE, 2)]);
    op.push([it ? round(cur.color.a * 100, 2) : 0]);
    rot.push([round(cur.rotation, 3)]);
    const doc = {
      s: round(size, 2), f: FONT, t: cur.text ?? '', j: 2, tr: 0,
      lh: round(size * 1.2, 2), ls: 0,
      fc: [round(cur.color.r / 255, 4), round(cur.color.g / 255, 4), round(cur.color.b / 255, 4)],
    };
    const prev = docs[docs.length - 1];
    if (!prev || JSON.stringify(prev.s) !== JSON.stringify(doc)) docs.push({ t: f, s: doc });
  });
  countKeys(docs.length);

  const ks = {
    o: prop(op, EPS.o, 0),
    r: prop(rot, EPS.r, 0),
    p: prop(pos, EPS.p, 0),
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
  };
  for (const v of Object.values(ks)) if (v.a === 1) countKeys((v.k as unknown[]).length);

  return {
    ddd: 0, ind: 0, ty: 5, nm: first.name, sr: 1, ao: 0, bm: 0,
    ks,
    t: { d: { k: docs }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [] },
    ip: 0, op: total + 1, st: 0,
  };
}

/* ---- outlines -------------------------------------------------------------- */

/**
 * The path(s) this item draws, in its own unit box, or null when it has none.
 *
 * A `path` is already a unit-box outline. An `svg` is artwork with its own viewBox, so its
 * `d` strings are re-based into the unit box first — an emitter's teardrop is authored in
 * a 24×32 frame and has to come out the same size as everything else.
 */
export interface Outline {
  /** a unit-box `d` */
  d: string;
  /** the path's own colour, when the artwork gave it one; null for none; undefined for
   *  the layer's own (animated) fill */
  fill?: ColorStop | null;
  /** the same for its outline: undefined is the layer's stroke, if it has one */
  stroke?: ColorStop | null;
  /** an imported path's stroke width, as a fraction of the layer's size */
  strokeWidth?: number;
  evenOdd?: boolean;
  /** vertices to resample to; more for an outline that curves a lot, like a limb */
  verts?: number;
}

function outlinesFor(item: SceneItem): Outline[] | null {
  // several subpaths are several outlines — a leg and its foot, the dot on an "i" —
  // flattened as one they would be joined by an edge that is not there
  if (item.path) return splitSubpaths(item.path).map((d) => ({ d, ...(item.limb ? { verts: 72 } : {}) }));
  if (item.paths?.length) {
    const out: Outline[] = [];
    for (const p of item.paths) {
      for (const d of splitSubpaths(p.d)) {
        out.push({ d, fill: p.fill, stroke: p.stroke, strokeWidth: p.strokeWidth, evenOdd: !!p.evenOdd });
      }
    }
    return out.length ? out : null;
  }
  if (!item.svg) return null;
  const paths = outlinesOf(item.svg.sourceMarkup);
  if (!paths.length) return null;
  const [vx, vy, vw, vh] = item.svg.viewBox.trim().split(/[\s,]+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
  // preserveAspectRatio="xMidYMid meet" is what the renderer uses, so match it or the
  // exported shape is a stretched version of what the preview showed
  const k = 1 / Math.max(vw, vh);
  const out: Outline[] = [];
  for (const path of paths) {
    if (path.fill === 'none') continue;
    // a `d` with several `M`s is several outlines. Flattened as one they were joined by a
    // spurious edge, which is how an exclamation mark exported as a single blob.
    for (const d of splitSubpaths(path.d)) out.push({ d: rebase(d, vx, vy, vw, vh, k), fill: ownFill(path.fill) });
  }
  return out.length ? out : null;
}

/** An SVG paint as a colour, or undefined when the layer's own colour should win. */
function ownFill(fill?: string): ColorStop | undefined {
  if (!fill || fill === 'currentColor' || fill === 'inherit') return undefined;
  const hex = /^#[0-9a-f]{3,8}$/i.test(fill.trim()) ? fill.trim() : null;
  return hex ? parseHex(hex) : undefined;
}

/** Re-writes a path's coordinates from a viewBox into a -0.5..0.5 box. */
function rebase(d: string, vx: number, vy: number, vw: number, vh: number, k: number): string {
  const pts = flattenPath(d, 96);
  return pathFromPoints(pts.map((p) => ({
    x: (p.x - vx - vw / 2) * k,
    y: (p.y - vy - vh / 2) * k,
  })));
}

/** The layer's plain shape as a unit-box outline, for frames before a morph begins. */
function primitiveOutline(item: SceneItem): Outline[] {
  return [{ d: item.shape === 'ellipse'
    ? primitivePath('circle')
    : primitivePath('rect', { cornerRadius: 0.5 }) }];
}

const VERTS = 48;

/**
 * One Lottie `sh` per outline, with vertices baked per frame only when they change.
 *
 * A static outline costs one path; a morph costs `VERTS` points per frame, which is the
 * whole reason the export note warns about it. Corners are written with zero-length
 * tangents (`i`/`o` all zero) — the flattened points are dense enough that the result is
 * indistinguishable, and solving real tangents per frame would not survive a morph anyway.
 */
function bezierShapes(
  id: string, frames: SceneItem[][], outlines: Outline[], w0: number, h0: number,
  countKeys: (n: number) => void,
): Record<string, unknown>[] {
  // a closed outline is filled; an open one (an imported line) must stay open, or its
  // stroke gains a closing edge the artwork never had
  const closed = (d: string) => /z\s*$/i.test(d.trim());
  return outlines.map((o, oi) => {
    const verts = o.verts ?? VERTS;
    const ds = frames.map((scene) => {
      const it = scene.find((s) => s.id === id);
      // a frame where this layer has no outline of its own still needs one, or its
      // geometry would jump; use the primitive it is drawing at that instant
      const outs = it ? outlinesFor(it) ?? primitiveOutline(it) : null;
      return (outs?.[oi] ?? outs?.[0] ?? outlines[oi]).d;
    });
    const c = closed(o.d);

    // An outline that never changes is written exactly, curves and corners as they are.
    // Only one that animates is resampled, because a morph needs the same vertex count
    // on every frame and two arbitrary outlines never share one.
    if (ds.every((d) => d === ds[0])) {
      const bz = pathToBezier(ds[0]);
      if (bz) {
        const at = (p: Vec2) => [round(p.x * w0, 3), round(p.y * h0, 3)];
        return { ty: 'sh', ind: oi, ks: { a: 0, k: { i: bz.i.map(at), o: bz.o.map(at), v: bz.v.map(at), c: bz.c } }, nm: `path${oi}`, hd: false };
      }
    }
    // scaled into the layer's own base box: the transform channel handles the rest
    const perFrame = ds.map((d) => flattenPath(d, verts).map((p) => [round(p.x * w0, 3), round(p.y * h0, 3)]));

    const zeros = perFrame[0].map(() => [0, 0]);
    const same = perFrame.every((f) => JSON.stringify(f) === JSON.stringify(perFrame[0]));
    if (same) {
      return { ty: 'sh', ind: oi, ks: { a: 0, k: { i: zeros, o: zeros, v: perFrame[0], c } }, nm: `path${oi}`, hd: false };
    }
    /**
     * Only the frames a straight line between neighbours cannot predict, like every other
     * channel here. A limb holding still for half a clip, or a morph that has landed, is
     * written as two keyframes rather than one per frame. Linear tangents, because the
     * easing is already in the sampled vertices.
     */
    const keep = reduce(perFrame.map((f) => f.flat()), EPS.v);
    countKeys(keep.length);
    return {
      ty: 'sh', ind: oi, nm: `path${oi}`, hd: false,
      ks: {
        a: 1,
        k: keep.map((f, n) => ({
          t: f,
          s: [{ i: zeros, o: zeros, v: perFrame[f], c }],
          ...(n < keep.length - 1 ? { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } } : {}),
        })),
      },
    };
  });
}
