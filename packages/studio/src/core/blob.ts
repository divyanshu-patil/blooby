import type { Vec2 } from './types';

/**
 * The body, pulled off round.
 *
 * A mascot drawn as a perfect circle reads as a UI element. A little asymmetry — one side
 * fuller than the other, a flat where a highlight wants to sit — reads as a character. So
 * the body carries one dial, `blob.amount`, from 0 (the circle it always was) to 1 (clearly
 * hand-drawn), and a `seed` that picks WHICH irregular shape it is.
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
 * 3. **At `amount` 0 the radius is exactly the circle's.** So dialling up from nothing is
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

/** The harmonics a seed picks out: which lobes, how strong, and where they sit. */
function harmonics(seed: number): { k: number; w: number; phase: number }[] {
  // a small integer hash — same seed, same body, on every machine and every reload
  let s = Math.abs(Math.trunc(seed)) * 2654435761 % 2147483647 || 1;
  const next = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const parts = [2, 3, 4].map((k) => ({ k, w: 0.4 + next() * 0.6, phase: next() * Math.PI * 2 }));
  // normalised so `amount` means the same amount of wobble whatever the seed drew
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
