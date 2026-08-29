import { it } from 'vitest';
import { check } from './testkit';
import { lerpColor, oklchToRgb, rgbToOklch } from './color';

// --- colour --------------------------------------------------------------------
for (const c of [{ r: 255, g: 0, b: 0, a: 1 }, { r: 12, g: 200, b: 90, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }]) {
  const rt = oklchToRgb(rgbToOklch(c));
  it('oklch round-trip', check(rt.r === c.r && rt.g === c.g && rt.b === c.b, JSON.stringify(rt)));
}
const mid = lerpColor({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 255, a: 1 }, 0.5);
it('red->blue keeps chroma (no mud)', check(rgbToOklch(mid).c > 0.12, JSON.stringify(mid)));
it('lerp t=0 is exact', check(lerpColor({ r: 20, g: 30, b: 40, a: 1 }, { r: 200, g: 10, b: 5, a: 1 }, 0).r === 20));
