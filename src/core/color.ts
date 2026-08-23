import type { ColorStop } from './types';

/** sRGB <-> Oklab (Björn Ottosson). Channels in 0..1, hue in degrees. */

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export type Oklch = { l: number; c: number; h: number; a: number };

export function rgbToOklch({ r, g, b, a }: ColorStop): Oklch {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, Bb), h: (Math.atan2(Bb, A) * 180) / Math.PI, a };
}

export function oklchToRgb({ l: L, c, h, a }: Oklch): ColorStop {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad), B = c * Math.sin(rad);
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const R = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const G = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const Bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)));
  return { r: q(R), g: q(G), b: q(Bl), a };
}

/** Hue takes the short way round so red->blue never detours through mud. */
export function lerpColor(a: ColorStop, b: ColorStop, t: number): ColorStop {
  const A = rgbToOklch(a), B = rgbToOklch(b);
  let dh = B.h - A.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  // grey has no meaningful hue — borrow the other end's so it doesn't swing
  const h = A.c < 1e-4 ? B.h : B.c < 1e-4 ? A.h : A.h + dh * t;
  return oklchToRgb({
    l: A.l + (B.l - A.l) * t,
    c: A.c + (B.c - A.c) * t,
    h,
    a: A.a + (B.a - A.a) * t,
  });
}

export const cssColor = (c: ColorStop) => `rgba(${c.r},${c.g},${c.b},${c.a})`;
export const hexColor = (c: ColorStop) =>
  '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function parseHex(hex: string, a = 1): ColorStop {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(s.slice(0, 2), 16) || 0, g: parseInt(s.slice(2, 4), 16) || 0, b: parseInt(s.slice(4, 6), 16) || 0, a };
}
