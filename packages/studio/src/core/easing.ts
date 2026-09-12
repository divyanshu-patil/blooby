import type { EasingCurve, Vec2 } from './types';

/** Solve y for x on a cubic-bezier with endpoints (0,0),(1,1) — the CSS curve. */
export function cubicBezier(p1: Vec2, p2: Vec2, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t;
  };
  const by = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t;
  };
  // bisection: monotone in t for valid CSS curves, and immune to the flat-derivative
  // case that breaks Newton on ease-in-out extremes
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2;
    if (bx(t) < x) lo = t; else hi = t;
  }
  return by(t);
}

const PRESET_BEZIER: Record<string, [Vec2, Vec2]> = {
  easeIn: [{ x: 0.42, y: 0 }, { x: 1, y: 1 }],
  easeOut: [{ x: 0, y: 0 }, { x: 0.58, y: 1 }],
  easeInOut: [{ x: 0.42, y: 0 }, { x: 0.58, y: 1 }],
};

export function applyEasing(curve: EasingCurve, t: number): number {
  switch (curve.type) {
    case 'linear':
      return t;
    case 'bezier':
      return cubicBezier(curve.p1, curve.p2, t);
    case 'preset': {
      if (curve.name === 'bounce') {
        // standard 4-segment bounce-out
        const n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + 0.75; }
        if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + 0.9375; }
        const u = t - 2.625 / d;
        return n * u * u + 0.984375;
      }
      // a cut, not a curve: the value holds until the next keyframe lands
      if (curve.name === 'hold') return t >= 1 ? 1 : 0;
      if (curve.name === 'elastic') {
        if (t === 0 || t === 1) return t;
        const p = 0.3;
        return 2 ** (-10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
      }
      const [p1, p2] = PRESET_BEZIER[curve.name];
      return cubicBezier(p1, p2, t);
    }
  }
}

/** Handles for the graph/curve editor — presets get a bezier stand-in so the UI is uniform. */
export function curveHandles(curve: EasingCurve): [Vec2, Vec2] {
  if (curve.type === 'bezier') return [curve.p1, curve.p2];
  if (curve.type === 'preset' && PRESET_BEZIER[curve.name]) return PRESET_BEZIER[curve.name];
  if (curve.type === 'preset' && curve.name === 'bounce') return [{ x: 0.3, y: 1.4 }, { x: 0.6, y: 1 }];
  if (curve.type === 'preset' && curve.name === 'elastic') return [{ x: 0.2, y: 1.6 }, { x: 0.5, y: 0.9 }];
  // the nearest a cubic gets to a step: flat, then everything at the very end
  if (curve.type === 'preset' && curve.name === 'hold') return [{ x: 1, y: 0 }, { x: 1, y: 0 }];
  return [{ x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 2 / 3 }];
}

export const EASING_NAMES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'elastic', 'hold'] as const;

/**
 * How one shape becomes the next, as the easing on the outgoing shape keyframe.
 *
 * Not a second interpolation system: a shape keyframe morphs through `lerpValue` like
 * every other keyframe, and these are named curves for it. `overshoot` and `elastic` carry
 * the outline past its target and back — core/path.ts extrapolates rather than clamping,
 * so that reads as a squash rather than a stall.
 */
export const MORPH_MODES = {
  morph: { label: 'Morph', easing: { type: 'preset', name: 'easeInOut' } },
  cut: { label: 'Cut', easing: { type: 'preset', name: 'hold' } },
  smooth: { label: 'Smooth morph', easing: { type: 'bezier', p1: { x: 0.65, y: 0 }, p2: { x: 0.35, y: 1 } } },
  elastic: { label: 'Elastic morph', easing: { type: 'preset', name: 'elastic' } },
  overshoot: { label: 'Overshoot', easing: { type: 'bezier', p1: { x: 0.34, y: 1.56 }, p2: { x: 0.64, y: 1 } } },
  ease: { label: 'Ease', easing: { type: 'preset', name: 'easeOut' } },
} as const satisfies Record<string, { label: string; easing: EasingCurve }>;

export type MorphMode = keyof typeof MORPH_MODES;
export const MORPH_MODE_NAMES = Object.keys(MORPH_MODES) as MorphMode[];

/** Which named morph a keyframe's easing is, or undefined for a hand-shaped curve. */
export function morphModeOf(c: EasingCurve): MorphMode | undefined {
  const s = JSON.stringify(c);
  return MORPH_MODE_NAMES.find((m) => JSON.stringify(MORPH_MODES[m].easing) === s);
}

export function namedEasing(name: string): EasingCurve {
  return name === 'linear' ? { type: 'linear' } : { type: 'preset', name: name as 'easeIn' };
}

export function easingLabel(c: EasingCurve): string {
  return c.type === 'preset' ? c.name : c.type;
}

/**
 * One glyph per easing family, so a busy lane reads at a glance instead of every
 * keyframe being an identical diamond. CSS (`.kfd[data-shape=...]`) turns these into
 * clip-path shapes — no icon assets, matches every other hand-drawn marker in the app.
 */
export type KeyframeShape = 'circle' | 'triangle-left' | 'triangle-right' | 'diamond' | 'spring' | 'square';

export function easingShape(c: EasingCurve): KeyframeShape {
  if (c.type === 'linear') return 'circle';
  if (c.type === 'bezier') return 'square';
  switch (c.name) {
    case 'easeIn': return 'triangle-left';
    case 'easeOut': return 'triangle-right';
    case 'bounce':
    case 'elastic': return 'spring';
    case 'hold': return 'square';
    default: return 'diamond'; // easeInOut — the common case keeps the familiar shape
  }
}
