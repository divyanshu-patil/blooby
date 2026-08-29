import { primitivePath } from './path';
import type { ColorStop, Emitter } from './types';

/**
 * The built-in things an emitter can throw: real SVG shapes, not typed characters.
 *
 * A glyph was the quickest way to get zzz on screen, and it shows — a "●" tear is
 * whatever the system font decides a filled circle is, at whatever weight, and a "■"
 * confetto is a square rather than a strip of paper. These are drawn shapes, so a tear is
 * teardrop-shaped and confetti is a curled ribbon, and they scale and recolour properly.
 *
 * Each entry is a small standalone SVG body. `tint` says whether the shape takes the
 * emitter's colour or keeps its own, which is what "automatic" means in the picker.
 */
export interface ShapeLibraryEntry {
  id: string;
  name: string;
  group: 'symbols' | 'drops' | 'confetti' | 'notes';
  viewBox: string;
  markup: string;
  /** false when the artwork carries colours worth keeping */
  tint: boolean;
  /**
   * The characters this shape IS the drawn version of.
   *
   * An emitter can still be given plain text to throw, and a typed "!" was rendered with
   * whatever font the page happened to have — which no Lottie player has, so those
   * particles could not be exported at all and were dropped. When a glyph matches one of
   * these the vector is drawn instead, in the preview AND in the export, so the two agree.
   */
  glyphs?: string[];
}

/** Every entry is one filled path, so it can be baked to a Lottie bezier as well as drawn. */
const filled = (d: string) => `<path d="${d}" fill="currentColor"/>`;

/**
 * Pulls the paths back out of an entry's markup, for the exporter.
 *
 * The `fill` comes with them: built-in art paints with `currentColor` so the emitter tints
 * it, but an imported SVG carries its own colours, and the export has to honour them the
 * same way the stage does.
 */
export function outlinesOf(markup: string): { d: string; fill?: string }[] {
  const out: { d: string; fill?: string }[] = [];
  // a fill on an enclosing <g> is inherited, which is how icon sets are written — the
  // paths carry no paint of their own and the group (or the <svg> root, which the importer
  // folds into a group) supplies it
  const inherited: (string | undefined)[] = [undefined];
  for (const m of markup.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    if (/^<\/g/i.test(tag)) { if (inherited.length > 1) inherited.pop(); continue; }
    const own = /\sfill\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (/^<g\b/i.test(tag)) { inherited.push(own ?? inherited[inherited.length - 1]); continue; }
    const d = /\sd\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (d) out.push({ d, fill: own ?? inherited[inherited.length - 1] });
  }
  return out;
}

export const SHAPE_LIBRARY: ShapeLibraryEntry[] = [
  // --- drops: a real teardrop, heavy at the bottom, not a circle -----------------
  {
    id: 'drop', name: 'Teardrop', group: 'drops', viewBox: '0 0 24 32', tint: true,
    markup: filled('M12 0C12 0 2 13.4 2 20a10 10 0 0 0 20 0C22 13.4 12 0 12 0Z'),
  },
  {
    id: 'drop-small', name: 'Droplet', group: 'drops', viewBox: '0 0 16 20', tint: true,
    markup: filled('M8 0C8 0 1 8.6 1 12.6A7 7 0 0 0 15 12.6C15 8.6 8 0 8 0Z'),
  },
  {
    id: 'splash', name: 'Splash', group: 'drops', viewBox: '0 0 24 24', tint: true,
    markup: filled('M12 2c1.6 4 4.4 6.2 4.4 9.4a4.4 4.4 0 0 1-8.8 0C7.6 8.2 10.4 6 12 2Z'
      + ' M19 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z'
      + ' M5 14.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z'),
  },

  // --- confetti: paper, so strips and curls rather than squares ------------------
  {
    id: 'streamer', name: 'Paper strip', group: 'confetti', viewBox: '0 0 10 26', tint: true,
    markup: filled('M4 0h2a2 2 0 0 1 2 2v22a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2Z'),
  },
  {
    id: 'curl', name: 'Curled ribbon', group: 'confetti', viewBox: '0 0 18 26', tint: true,
    // an S-curve with width: what a strip of paper actually looks like mid-air. Filled
    // rather than stroked, so it survives being baked to a bezier for Lottie.
    markup: filled('M2.2 2.6C9 6.4 9 9.6 3.4 13c-5.6 3.4-5.6 6.6 1.2 10.4l2.6-3.6c-3.6-2-3.6-3.2 0-5.2 5.6-3.2 5.6-8 0-11.6Z'),
  },
  {
    id: 'chip', name: 'Paper chip', group: 'confetti', viewBox: '0 0 16 12', tint: true,
    markup: filled('M1 3c4-3 10-3 14 0-1 5-1 6 0 9-4 3-10 3-14 0 1-3 1-4 0-9Z'),
  },

  // --- notes: proper glyphs as paths, so weight is ours to choose ---------------
  {
    id: 'quaver', name: 'Quaver', group: 'notes', viewBox: '0 0 20 26', tint: true, glyphs: ['\u266a', '\u2669'],
    markup: filled('M8 0v17.2a4.6 4.6 0 1 0 3 4.3V6.6c3.6.9 6 2.9 6 5.4h3C20 6.4 15.6 1.6 8 0Z'),
  },
  {
    id: 'beamed', name: 'Beamed notes', group: 'notes', viewBox: '0 0 28 26', tint: true, glyphs: ['\u266b', '\u266c'],
    markup: filled('M8 3.4v13.8a4.4 4.4 0 1 0 3 4.1V8.2l11-2.4v9.6a4.4 4.4 0 1 0 3 4.1V0L8 3.4Z'),
  },

  // --- symbols ------------------------------------------------------------------
  {
    id: 'zed', name: 'Z', group: 'symbols', viewBox: '0 0 22 22', tint: true, glyphs: ['z', 'Z', '\u1d22'],
    markup: filled('M3 2h16v3.4L8.6 18.4H19V22H3v-3.4L13.4 5.6H3V2Z'),
  },
  {
    id: 'bang', name: 'Exclamation', group: 'symbols', viewBox: '0 0 12 30', tint: true, glyphs: ['!', '\uff01', '\u2757', '\u2755'],
    // deliberately heavy: a notification badge has to read at a glance
    markup: filled('M6 0a4.5 4.5 0 0 1 4.5 4.5v10A4.5 4.5 0 0 1 1.5 14.5v-10A4.5 4.5 0 0 1 6 0Z'
      + ' M6 21a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z'),
  },
  {
    id: 'query', name: 'Question', group: 'symbols', viewBox: '0 0 20 30', tint: true, glyphs: ['?', '\uff1f', '\u2753'],
    markup: filled('M10 0C4.9 0 1.4 2.9.6 7.5l5 1C6 6.2 7.5 5 9.8 5c2.2 0 3.7 1.2 3.7 3 0 1.6-.8 2.5-2.9 3.9-2.6 1.7-3.6 3.2-3.4 6.2l.1 1.4h5l-.1-1c-.1-1.6.4-2.4 2.4-3.7 3-1.9 4.4-3.8 4.4-6.9C19 3.3 15.4 0 10 0Z'
      + ' M9.8 22.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z'),
  },
  {
    id: 'star', name: 'Star', group: 'symbols', viewBox: '-0.6 -0.6 1.2 1.2', tint: true, glyphs: ['\u2605', '\u2606', '\u2b50'],
    markup: filled(primitivePath('star', { points: 5, innerRatio: 0.45, vertexRadius: 0.25 })),
  },
  {
    id: 'spark', name: 'Sparkle', group: 'symbols', viewBox: '0 0 24 24', tint: true, glyphs: ['\u2726', '\u2727', '\u2728', '\u2734'],
    markup: filled('M12 0c1.1 6.6 5.3 10.8 12 12-6.7 1.2-10.9 5.4-12 12-1.1-6.6-5.3-10.8-12-12C6.7 10.8 10.9 6.6 12 0Z'),
  },
  {
    id: 'heart', name: 'Heart', group: 'symbols', viewBox: '0 0 24 22', tint: true, glyphs: ['\u2665', '\u2764', '\u2661'],
    markup: filled('M12 21.4 2.7 12.5A6.1 6.1 0 0 1 12 4.9a6.1 6.1 0 0 1 9.3 7.6L12 21.4Z'),
  },
  {
    id: 'bell', name: 'Bell', group: 'symbols', viewBox: '0 0 24 26', tint: true,
    markup: filled('M12 0a2.6 2.6 0 0 1 2.6 2.6v.9A8.4 8.4 0 0 1 20.4 12v5l2.4 3.2V22H1.2v-1.8L3.6 17v-5a8.4 8.4 0 0 1 5.8-8.5v-.9A2.6 2.6 0 0 1 12 0Z'
      + ' M8.6 23.6h6.8a3.4 3.4 0 0 1-6.8 0Z'),
  },
];

export const shapeById = (id: string) => SHAPE_LIBRARY.find((s) => s.id === id);

/** Confetti colours — paper, not a gradient. Cycled one per particle. */
export const CONFETTI_COLORS: ColorStop[] = [
  { r: 232, g: 106, b: 84, a: 1 },
  { r: 247, g: 201, b: 72, a: 1 },
  { r: 86, g: 178, b: 128, a: 1 },
  { r: 92, g: 148, b: 226, a: 1 },
  { r: 200, g: 118, b: 196, a: 1 },
];

/** An emitter particle kind: which shape, and the dials that vary per particle. */
export type EmitterPart = NonNullable<Emitter['parts']>[number];

/** A part with everything unremarkable filled in, so a caller states only what differs. */
export const part = (p: Partial<EmitterPart> & { shapeId?: string; glyph?: string }): EmitterPart => ({
  id: `pt${Math.random().toString(36).slice(2, 8)}`,
  weight: 1, speed: 1, sizeScale: 1, spin: 0,
  ...p,
});

/**
 * Turns a part's shape reference into markup: the built-in library first, then the
 * project's own imported SVGs.
 *
 * Built from the project rather than passed in, so no call site can forget it and quietly
 * render every particle as a blank.
 */
export function shapeResolver(svgAssets?: { id: string; markup: string; viewBox: string }[]) {
  return (shapeId?: string, svgAssetId?: string, glyph?: string) => {
    if (shapeId) {
      const s = shapeById(shapeId);
      return s ? { sourceMarkup: s.markup, viewBox: s.viewBox } : undefined;
    }
    if (svgAssetId) {
      const a = svgAssets?.find((x) => x.id === svgAssetId);
      return a ? { sourceMarkup: a.markup, viewBox: a.viewBox } : undefined;
    }
    const drawn = glyph ? shapeForGlyph(glyph) : undefined;
    return drawn ? { sourceMarkup: drawn.markup, viewBox: drawn.viewBox } : undefined;
  };
}

/** The drawn version of a typed character, if the library has one. */
export function shapeForGlyph(glyph: string): ShapeLibraryEntry | undefined {
  const g = glyph.trim();
  return g ? SHAPE_LIBRARY.find((s) => s.glyphs?.includes(g)) : undefined;
}
