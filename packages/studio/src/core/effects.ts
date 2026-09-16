import type { EffectKind, LayerEffect, RigNode } from './types';

/**
 * The layer effect stack, defined once.
 *
 * Every effect is data on a layer (`RigNode.effects`), evaluated like any other property —
 * each param is animatable as `effect.<kind>.<param>` — and drawn by the one renderer
 * (ui/Mascot.tsx). This table is what the inspector lists, what the copilot is told, and what
 * the Lottie baker checks: `lottie: false` effects are kept in the project and drawn in the
 * editor, GIF, MP4 and PNG, and the .lottie export says which layers lost one.
 *
 * Params: [min, max, step, unit, default].
 */
type Param = [number, number, number, string, number];
export interface EffectSpec { label: string; blurb: string; params: Record<string, Param>; color?: true; lottie: boolean }

export const EFFECTS: Record<EffectKind, EffectSpec> = {
  glow: { label: 'Glow', blurb: 'A soft halo in a colour around the layer — neon, magic, portals.', color: true, lottie: false,
    params: { radius: [0, 80, 1, 'px', 16], strength: [0, 3, 0.05, '×', 1] } },
  blur: { label: 'Blur', blurb: 'Gaussian blur — depth of field, speed, softness.', lottie: false,
    params: { radius: [0, 40, 0.5, 'px', 4] } },
  shadow: { label: 'Drop shadow', blurb: 'A soft shadow offset from the layer.', color: true, lottie: false,
    params: { x: [-100, 100, 1, 'px', 0], y: [-100, 100, 1, 'px', 12], blur: [0, 60, 1, 'px', 10], opacity: [0, 1, 0.01, '', 0.35] } },
  rgbSplit: { label: 'RGB split', blurb: 'Red and cyan copies pulled apart — chromatic glitch.', lottie: false,
    params: { amount: [0, 40, 0.5, 'px', 6], angle: [-180, 180, 1, '°', 0] } },
  slices: { label: 'Slice displace', blurb: 'Horizontal bands shoved sideways at random — digital tearing.', lottie: false,
    params: { amount: [0, 120, 1, 'px', 24], bands: [2, 40, 1, '', 10], rate: [0, 60, 1, 'fps', 12], seed: [0, 999, 1, '', 1] } },
  scanlines: { label: 'Scanlines', blurb: 'CRT lines over the layer.', lottie: false,
    params: { spacing: [2, 20, 1, 'px', 4], opacity: [0, 1, 0.01, '', 0.3] } },
  flicker: { label: 'Flicker', blurb: 'Opacity stutters at random — a failing signal.', lottie: true,
    params: { amount: [0, 1, 0.01, '', 0.6], rate: [1, 60, 1, 'fps', 20], seed: [0, 999, 1, '', 1] } },
  jitter: { label: 'Jitter', blurb: 'The outline boils, redrawn a little differently each few frames — hand-drawn life.', lottie: true,
    params: { amount: [0, 30, 0.5, 'px', 3], rate: [1, 30, 1, 'fps', 8], seed: [0, 999, 1, '', 1] } },
  echo: { label: 'Echo', blurb: 'Fading copies of where the layer was — trails and motion blur.', lottie: true,
    params: { count: [1, 8, 1, '', 4], delay: [10, 300, 5, 'ms', 40], falloff: [0.1, 0.95, 0.05, '', 0.55] } },
  goo: { label: 'Goo', blurb: 'The layer and the shapes inside it melt together where they touch — liquid, metaballs.', lottie: false,
    params: { radius: [1, 40, 0.5, 'px', 12] } },
};

export const EFFECT_KINDS = Object.keys(EFFECTS) as EffectKind[];

/** A new effect of a kind with its defaults. */
export function makeEffect(kind: EffectKind): LayerEffect {
  const spec = EFFECTS[kind];
  return {
    kind,
    params: Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p[4]])),
    ...(spec.color ? { color: kind === 'shadow' ? { r: 0, g: 0, b: 0, a: 1 } : { r: 140, g: 200, b: 255, a: 1 } } : {}),
  };
}

export const effectOf = (n: RigNode, kind: string) => n.effects?.find((e) => e.kind === kind && e.enabled !== false);

/** A deterministic pseudo-random number in [0,1) from integers — the same frame always tears the same way. */
export function hash01(...ns: number[]): number {
  let h = 2166136261;
  for (const n of ns) { h ^= Math.floor(n) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 100000) / 100000;
}
