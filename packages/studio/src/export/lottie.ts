import { COMP } from '../core/defaults';
import { sceneAt, type SceneItem } from '../core/scene';
import { flattenPath, pathFromPoints, primitivePath } from '../core/path';
import { outlinesOf } from '../core/emitters';
import { activeTimeline } from '../core/types';
import type { Project } from '../core/types';

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

interface Chan { p: Vec[]; s: Vec[]; r: Vec[]; o: Vec[]; c: Vec[] }

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
  /** layers whose outline had to be written as vertices — what "baked" means in the note */
  const baked = new Set<string>();
  const layers: Record<string, unknown>[] = [];
  let keyframeCount = 0;

  order.forEach((id, n) => {
    const first = seen.get(id)!;
    // Lottie has no shape for either of these: an SVG layer is arbitrary markup, and an
    // emitter's particles are glyphs, which would need a text layer with an embedded font
    // descriptor. Both are named in `skipped` rather than silently dropped — GIF and MP4
    // go through the real renderer and keep them.
    // A glyph is the one thing with no bezier to bake: it would need an embedded font
    // descriptor. Named in `skipped` rather than silently dropped.
    if (first.text !== undefined) { skipped.push(first.name); return; }

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
      .reduce<string[] | null>((found, it) => found ?? (it ? outlinesFor(it) : null), null);
    if (outlines) { baked.add(first.name); }

    // base geometry: the largest the shape ever gets, so scale stays <= 100%
    let w0 = 0, h0 = 0;
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      if (it) { w0 = Math.max(w0, it.w); h0 = Math.max(h0, it.h); }
    }
    w0 = Math.max(w0, 0.01); h0 = Math.max(h0, 0.01);

    const ch: Chan = { p: [], s: [], r: [], o: [], c: [] };
    let last: SceneItem = first;
    for (const scene of frames) {
      const it = scene.find((s) => s.id === id);
      const cur = it ?? last;
      if (it) last = it;
      ch.p.push([round(cur.cx, 2), round(cur.cy, 2)]);
      ch.s.push([round((cur.w / w0) * 100, 3), round((cur.h / h0) * 100, 3)]);
      ch.r.push([round(cur.rotation, 3)]);
      ch.o.push([it ? round(cur.color.a * 100, 2) : 0]);
      ch.c.push([round(cur.color.r / 255, 4), round(cur.color.g / 255, 4), round(cur.color.b / 255, 4), 1]);
    }

    const geometry: Record<string, unknown>[] = outlines
      ? bezierShapes(id, frames, outlines, w0, h0, (n2) => { keyframeCount += n2; })
      : [first.shape === 'ellipse'
        ? { ty: 'el', d: 1, s: { a: 0, k: [w0, h0] }, p: { a: 0, k: [0, 0] }, nm: 'body' }
        : { ty: 'rc', d: 1, s: { a: 0, k: [w0, h0] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: Math.min(w0, h0) / 2 }, nm: 'pill' }];

    const ks = {
      o: prop(ch.o, EPS.o, 0),
      r: prop(ch.r, EPS.r, 0),
      p: prop(ch.p, EPS.p, 0),
      a: { a: 0, k: [0, 0] },
      s: prop(ch.s, EPS.s, 0),
    };
    for (const v of Object.values(ks)) if (v.a === 1) keyframeCount += (v.k as unknown[]).length;
    const fill = prop(ch.c, EPS.c, 0);
    if (fill.a === 1) keyframeCount += (fill.k as unknown[]).length;

    layers.push({
      ddd: 0, ind: n + 1, ty: 4, nm: first.name, sr: 1, ao: 0, bm: 0,
      ks,
      shapes: [{
        ty: 'gr', nm: first.name, np: 2, cix: 2, bm: 0, hd: false,
        it: [
          ...geometry,
          { ty: 'fl', c: fill, o: { a: 0, k: 100 }, r: 1, bm: 0, nm: 'fill', hd: false },
          { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 'transform' },
        ],
      }],
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

/* ---- outlines -------------------------------------------------------------- */

/**
 * The path(s) this item draws, in its own unit box, or null when it has none.
 *
 * A `path` is already a unit-box outline. An `svg` is artwork with its own viewBox, so its
 * `d` strings are re-based into the unit box first — an emitter's teardrop is authored in
 * a 24×32 frame and has to come out the same size as everything else.
 */
function outlinesFor(item: SceneItem): string[] | null {
  if (item.path) return [item.path];
  if (!item.svg) return null;
  const ds = outlinesOf(item.svg.sourceMarkup);
  if (!ds.length) return null;
  const [vx, vy, vw, vh] = item.svg.viewBox.trim().split(/[\s,]+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
  // preserveAspectRatio="xMidYMid meet" is what the renderer uses, so match it or the
  // exported shape is a stretched version of what the preview showed
  const k = 1 / Math.max(vw, vh);
  return ds.map((d) => rebase(d, vx, vy, vw, vh, k));
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
function primitiveOutline(item: SceneItem): string[] {
  return [item.shape === 'ellipse'
    ? primitivePath('circle')
    : primitivePath('rect', { cornerRadius: 0.5 })];
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
  id: string, frames: SceneItem[][], outlines: string[], w0: number, h0: number,
  countKeys: (n: number) => void,
): Record<string, unknown>[] {
  return outlines.map((_, oi) => {
    const perFrame = frames.map((scene) => {
      const it = scene.find((s) => s.id === id);
      // a frame where this layer has no outline of its own still needs one, or its
      // geometry would jump; use the primitive it is drawing at that instant
      const outs = it ? outlinesFor(it) ?? primitiveOutline(it) : null;
      const d = outs?.[oi] ?? outs?.[0] ?? outlines[oi];
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
