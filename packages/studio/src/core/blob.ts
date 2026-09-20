import type { Vec2 } from './types';

/**
 * The body, pulled off round.
 *
 * A mascot drawn as a perfect circle reads as a UI element. A little asymmetry — one side
 * fuller than the other, a flat where a highlight wants to sit — reads as a character. So
 * the body carries two dials. `blob.amount` is how far off round, 0 (the circle it always
 * was) to 1 (clearly hand-drawn). `blob.seed` is WHICH irregular shape, as a continuous
 * position rather than an index — so holding the amount and keyframing the seed morphs the
 * body from one shape into another. Both animate.
 *
 * Three things about the construction are load-bearing, and all three are about export:
 *
 * 1. **It is a pure function of (amount, seed).** No clock, no noise field. A body that
 *    is not animated produces the same `d` on every frame, so `bakeLottie` writes ONE
 *    static path for it — see the `ds.every(d => d === ds[0])` branch in `bezierShapes`.
 *    A blob that never moves costs nothing in the file. Time-varying wobble belongs in
 *    the existing jitter/wave effects, which already own that and already warn about it.
 *
 * 2. **The vertex count never changes with `amount`.** `LOBES` is fixed, so keyframing
 *    the dial interpolates a ring against the same ring — every point moves a little and
 *    none appear or vanish. A count that grew with the dial would make the outline jump
 *    on the frame it changed, in the editor and in the morph frames of an exported strip.
 *
 * 3. **Both dials are continuous.** Neither one steps, so neither can pop on the frame it
 *    crosses a boundary — the whole reason the seed is a smooth function rather than the
 *    integer hash it started as.
 *
 * 4. **At `amount` 0 the radius is exactly the circle's.** So dialling up from nothing is
 *    continuous, and the body only stops being a plain ellipse once the dial is off zero
 *    (see scene.ts) — an untouched project exports byte for byte as it did before.
 *
 * Shape comes from three low harmonics rather than random points per vertex: random
 * points give a lumpy potato that changes character completely as the count changes,
 * where a few sines stay smooth, stay recognisable, and have an honest derivative — which
 * is what lets the curve below carry real tangents instead of being a polygon.
 */

/** Fixed for the reasons above. Twelve is enough for three harmonics to read cleanly. */
const LOBES = 12;

/** How far the edge may stray from the circle at `amount` 1, as a fraction of the radius.
 *  Past about a third it stops reading as a body and starts reading as a puddle. */
const MAX_DEVIATION = 0.28;

const TAU = Math.PI * 2;

/** Which lobes the shape is made of. Three is enough to read as irregular, few enough to stay smooth. */
const LOBE_K = [2, 3, 4];

/**
 * How fast each lobe turns, and swells, as `seed` advances.
 *
 * All six are irrational and share no ratio, so the three lobes never come back into step
 * — walking the dial keeps finding new shapes instead of cycling through a handful. The
 * rates are around a half turn per unit, which makes `seed` and `seed + 1` clearly
 * different bodies while `seed + 0.05` is a small nudge.
 */
const PHASE_RATE = [0.7548776662, 0.5698402910, 0.3247179572];
const SWELL_RATE = [0.3722813233, 0.2360679775, 0.1149420449];

/**
 * The harmonics at a point on the dial.
 *
 * `seed` is a CONTINUOUS position, not an index. It began as a hash of a truncated
 * integer, which made the shape a step function: sliding 3 → 4 did nothing for nine
 * tenths and then snapped 51.6px on a 720px body at the boundary. Every lobe's phase and
 * weight is now a smooth function of the dial, so it can be keyframed like any other
 * property and the body travels between shapes instead of cutting between them.
 */
function harmonics(seed: number): { k: number; w: number; phase: number }[] {
  const parts = LOBE_K.map((k, i) => ({
    k,
    // 0.4..1.0: a lobe softens but never disappears, so the body keeps its character
    w: 0.7 + 0.3 * Math.sin(seed * SWELL_RATE[i] * TAU + i * 1.7),
    phase: seed * PHASE_RATE[i] * TAU + i * 2.1,
  }));
  // normalised so `amount` means the same amount of wobble wherever the dial is
  const total = parts.reduce((n, p) => n + p.w, 0);
  return parts.map((p) => ({ ...p, w: p.w / total }));
}

/** Radius and its derivative at angle `a` — the derivative is what makes the tangents right. */
function radiusAt(a: number, amount: number, parts: ReturnType<typeof harmonics>) {
  let w = 0, dw = 0;
  for (const p of parts) {
    w += p.w * Math.sin(p.k * a + p.phase);
    dw += p.w * p.k * Math.cos(p.k * a + p.phase);
  }
  const scale = amount * MAX_DEVIATION;
  return { r: 0.5 * (1 + scale * w), dr: 0.5 * scale * dw };
}

/**
 * The outline, in the -0.5..0.5 box every other generated shape uses.
 *
 * Control points come from the real derivative of the polar curve, converted from Hermite
 * to Bézier by the usual Δ/3. At `amount` 0 that reduces to a circle whose handles are
 * within a fraction of a percent of `circleSpline`'s exact `tan` form — invisible, and
 * worth it for having one expression that stays correct as the radius varies.
 */
export function blobPath(amount: number, seed = 1): string {
  const parts = harmonics(seed);
  const step = (Math.PI * 2) / LOBES;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const f = (v: Vec2) => `${round(v.x)} ${round(v.y)}`;

  const at = (i: number) => {
    const a = -Math.PI / 2 + i * step;
    const { r, dr } = radiusAt(a, amount, parts);
    const cos = Math.cos(a), sin = Math.sin(a);
    return {
      p: { x: cos * r, y: sin * r },
      // d/da of (r·cos a, r·sin a), scaled to the segment the handle spans
      t: { x: (dr * cos - r * sin) * (step / 3), y: (dr * sin + r * cos) * (step / 3) },
    };
  };

  let d = `M ${f(at(0).p)}`;
  for (let i = 0; i < LOBES; i++) {
    const a = at(i), b = at(i + 1);
    d += ` C ${f({ x: a.p.x + a.t.x, y: a.p.y + a.t.y })} ${f({ x: b.p.x - b.t.x, y: b.p.y - b.t.y })} ${f(b.p)}`;
  }
  return `${d} Z`;
}

/** What the body actually draws, or undefined when the dial is off and it stays an ellipse. */
export const blobOf = (blob: { amount?: number; seed?: number } | undefined): string | undefined =>
  blob && (blob.amount ?? 0) > 0.001 ? blobPath(blob.amount!, blob.seed ?? 1) : undefined;
