import { COMP } from '../core/defaults';
import { sceneAt, type SceneItem } from '../core/scene';
import { flattenPath, pathFromPoints, primitivePath, splitSubpaths } from '../core/path';
import { outlinesOf } from '../core/emitters';
import { activeTimeline } from '../core/types';
import { parseHex } from '../core/color';
import type { ColorStop, Project } from '../core/types';

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
}

type Vec = number[];

interface Chan {
  p: Vec[]; s: Vec[]; r: Vec[]; o: Vec[]; c: Vec[];
  /** a pill's own width/height and corner radius, in composition units */
  wh: Vec[]; rr: Vec[];
}

const EPS = { p: 0.2, s: 0.12, r: 0.04, o: 0.4, c: 0.0015 };

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
  for (let f = 0; f <= total; f++) frames.push(sceneAt(project, from + (f / fps) * 1000, COMP));

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

    // base geometry: the largest the shape ever gets, so scale stays <= 100%
    let w0 = 0, h0 = 0;
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      if (it) { w0 = Math.max(w0, it.w); h0 = Math.max(h0, it.h); }
    }
    w0 = Math.max(w0, 0.01); h0 = Math.max(h0, 0.01);

    const ch: Chan = { p: [], s: [], r: [], o: [], c: [], wh: [], rr: [] };
    let last: SceneItem = first;
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      const cur = it ?? last;
      if (it) last = it;
      ch.p.push([round(cur.cx, 2), round(cur.cy, 2)]);
      ch.s.push([round((cur.w / w0) * 100, 3), round((cur.h / h0) * 100, 3)]);
      ch.wh.push([round(cur.w, 3), round(cur.h, 3)]);
      ch.rr.push([round(Math.min(cur.w, cur.h) / 2, 3)]);
      ch.r.push([round(cur.rotation, 3)]);
      ch.o.push([it ? round(cur.color.a * 100, 2) : 0]);
      ch.c.push([round(cur.color.r / 255, 4), round(cur.color.g / 255, 4), round(cur.color.b / 255, 4), 1]);
    }

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
    const fill = prop(ch.c, EPS.c, 0);
    if (fill.a === 1) keyframeCount += (fill.k as unknown[]).length;

    layers.push({
      ddd: 0, ind: n + 1, ty: 4, nm: first.name, sr: 1, ao: 0, bm: 0,
      ks,
      shapes: groupByFill(first.name, geometry, outlines ?? [], fill),
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


/**
 * The shape groups for one layer, split so a path keeps its own colour.
 *
 * Everything painted in the layer's colour stays in ONE group, because a group is also
 * what makes holes work: a donut is two paths whose fills cancel by winding. Only a path
 * the markup gave a colour of its own is lifted out into a group with that fill, which is
 * how an imported SVG keeps its palette instead of coming out a flat silhouette.
 */
function groupByFill(
  name: string, geometry: Record<string, unknown>[], outlines: Outline[],
  layerFill: { a: number; k: unknown },
): Record<string, unknown>[] {
  const tr = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 'transform' };
  const buckets = new Map<string, { fill: { a: number; k: unknown }; shapes: Record<string, unknown>[] }>();
  geometry.forEach((sh, i) => {
    const own = outlines[i]?.fill;
    const key = own ? `${own.r},${own.g},${own.b}` : 'layer';
    if (!buckets.has(key)) {
      buckets.set(key, {
        fill: own ? { a: 0, k: [round(own.r / 255, 4), round(own.g / 255, 4), round(own.b / 255, 4), 1] } : layerFill,
        shapes: [],
      });
    }
    buckets.get(key)!.shapes.push(sh);
  });
  return [...buckets.values()].map((b, i) => ({
    ty: 'gr', nm: buckets.size > 1 ? `${name} ${i + 1}` : name, np: 2, cix: 2, bm: 0, hd: false,
    it: [...b.shapes, { ty: 'fl', c: b.fill, o: { a: 0, k: 100 }, r: 1, bm: 0, nm: 'fill', hd: false }, tr],
  }));
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
  /** the path's own colour, when the markup gave it one that is not `currentColor` */
  fill?: ColorStop;
}

function outlinesFor(item: SceneItem): Outline[] | null {
  if (item.path) return [{ d: item.path }];
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
  return outlines.map((_, oi) => {
    const perFrame = frames.map((scene) => {
      const it = scene.find((s) => s.id === id);
      // a frame where this layer has no outline of its own still needs one, or its
      // geometry would jump; use the primitive it is drawing at that instant
      const outs = it ? outlinesFor(it) ?? primitiveOutline(it) : null;
      const d = (outs?.[oi] ?? outs?.[0] ?? outlines[oi]).d;
      // scaled into the layer's own base box: the transform channel handles the rest
      return flattenPath(d, VERTS).map((p) => [round(p.x * w0, 3), round(p.y * h0, 3)]);
    });

    const zeros = perFrame[0].map(() => [0, 0]);
    const same = perFrame.every((f) => JSON.stringify(f) === JSON.stringify(perFrame[0]));
    if (same) {
      return { ty: 'sh', ind: oi, ks: { a: 0, k: { i: zeros, o: zeros, v: perFrame[0], c: true } }, nm: `path${oi}`, hd: false };
    }
    countKeys(perFrame.length);
    return {
      ty: 'sh', ind: oi, nm: `path${oi}`, hd: false,
      ks: {
        a: 1,
        k: perFrame.map((v, f) => ({
          t: f,
          s: [{ i: zeros, o: zeros, v, c: true }],
          ...(f < perFrame.length - 1 ? { i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } } : {}),
        })),
      },
    };
  });
}
