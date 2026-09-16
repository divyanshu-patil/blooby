import { it } from 'vitest';
import { check } from './testkit';
import { hsvToRgb, lerpColor, oklchToRgb, parseHex, PASTELS, readHex, rgbToHsv, rgbToOklch } from './color';

// --- colour --------------------------------------------------------------------
for (const c of [{ r: 255, g: 0, b: 0, a: 1 }, { r: 12, g: 200, b: 90, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }]) {
  const rt = oklchToRgb(rgbToOklch(c));
  it('oklch round-trip', check(rt.r === c.r && rt.g === c.g && rt.b === c.b, JSON.stringify(rt)));
}
const mid = lerpColor({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 255, a: 1 }, 0.5);
it('red->blue keeps chroma (no mud)', check(rgbToOklch(mid).c > 0.12, JSON.stringify(mid)));
it('lerp t=0 is exact', check(lerpColor({ r: 20, g: 30, b: 40, a: 1 }, { r: 200, g: 10, b: 5, a: 1 }, 0).r === 20));

// --- hex as typed text ---------------------------------------------------------------
{
  it('#FF5C8A reads as that colour', check(JSON.stringify(readHex('#FF5C8A')) === JSON.stringify({ r: 255, g: 92, b: 138 })));
  it('the # is optional and case is not', check(JSON.stringify(readHex('ff5c8a')) === JSON.stringify(readHex('#FF5C8A'))));
  it('#FFF is white', check(JSON.stringify(readHex('#FFF')) === JSON.stringify({ r: 255, g: 255, b: 255 })));
  it('#RRGGBBAA carries alpha', check(readHex('#00000080')?.a === 0.502));
  it('garbage is refused rather than read as black', check(readHex('#GG0000') === null && readHex('#12345') === null && readHex('') === null));
}

// --- HSV round trip, for the picker ----------------------------------------------------
{
  const cases = ['#FF5C8A', '#000000', '#FFFFFF', '#12AB34', '#7F7F7F', '#B5EAD7'];
  const back = cases.map((h) => { const c = parseHex(h); const r = hsvToRgb(rgbToHsv(c)); return [c, r]; });
  it('rgb → hsv → rgb returns the same colour', check(back.every(([a, b]) => a.r === b.r && a.g === b.g && a.b === b.b), JSON.stringify(back)));
  it('pure red is hue 0, fully saturated and bright', check((() => { const v = rgbToHsv({ r: 255, g: 0, b: 0, a: 1 }); return v.h === 0 && v.s === 1 && v.v === 1; })()));
  it('there are pastel presets', check(PASTELS.length >= 12 && PASTELS.every((c) => c.r > 150 && c.g > 150 && c.b > 150)));
}
