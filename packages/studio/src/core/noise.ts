/**
 * Value noise with cubic (smoothstep) interpolation — deterministic from a seed,
 * C1-continuous, and about 15 lines. Perlin's gradient setup buys nothing here
 * because shake only ever samples 1D.
 * ponytail: 1D value noise, swap for simplex if shake ever needs 2D/3D coherence.
 */
function hash(n: number, seed: number): number {
  let h = (n * 374761393 + seed * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise1d(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i, seed) * (1 - u) + hash(i + 1, seed) * u) * 2 - 1; // -1..1
}
