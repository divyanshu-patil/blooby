import { COMP } from '../core/defaults';
import { sceneAt, type SceneItem } from '../core/scene';
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
  const layers: Record<string, unknown>[] = [];
  let keyframeCount = 0;

  order.forEach((id, n) => {
    const first = seen.get(id)!;
    // Lottie has no shape for either of these: an SVG layer is arbitrary markup, and an
    // emitter's particles are glyphs, which would need a text layer with an embedded font
    // descriptor. Both are named in `skipped` rather than silently dropped — GIF and MP4
    // go through the real renderer and keep them.
    if (first.svg || first.text !== undefined) { skipped.push(first.name); return; }

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

    const shape = first.shape === 'ellipse'
      ? { ty: 'el', d: 1, s: { a: 0, k: [w0, h0] }, p: { a: 0, k: [0, 0] }, nm: 'body' }
      : { ty: 'rc', d: 1, s: { a: 0, k: [w0, h0] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: Math.min(w0, h0) / 2 }, nm: 'pill' };

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
          shape,
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
  };
}

const round = (v: number, d: number) => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};
