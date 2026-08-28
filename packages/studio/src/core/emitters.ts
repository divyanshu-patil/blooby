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
}

const teardrop = (d: string) => `<path d="${d}" fill="currentColor"/>`;

export const SHAPE_LIBRARY: ShapeLibraryEntry[] = [
  // --- drops: a real teardrop, heavy at the bottom, not a circle -----------------
  {
    id: 'drop', name: 'Teardrop', group: 'drops', viewBox: '0 0 24 32', tint: true,
    markup: teardrop('M12 0C12 0 2 13.4 2 20a10 10 0 0 0 20 0C22 13.4 12 0 12 0Z'),
  },
  {
    id: 'drop-small', name: 'Droplet', group: 'drops', viewBox: '0 0 16 20', tint: true,
    markup: teardrop('M8 0C8 0 1 8.6 1 12.6A7 7 0 0 0 15 12.6C15 8.6 8 0 8 0Z'),
  },
  {
    id: 'splash', name: 'Splash', group: 'drops', viewBox: '0 0 24 24', tint: true,
    markup: teardrop('M12 2c1.6 4 4.4 6.2 4.4 9.4a4.4 4.4 0 0 1-8.8 0C7.6 8.2 10.4 6 12 2Z')
      + '<circle cx="19" cy="17" r="2.2" fill="currentColor"/><circle cx="5" cy="16" r="1.7" fill="currentColor"/>',
  },

  // --- confetti: paper, so strips and curls rather than squares ------------------
  {
    id: 'streamer', name: 'Paper strip', group: 'confetti', viewBox: '0 0 10 26', tint: true,
    markup: '<rect x="2.5" y="0" width="5" height="26" rx="1.4" fill="currentColor"/>',
  },
  {
    id: 'curl', name: 'Curled ribbon', group: 'confetti', viewBox: '0 0 18 26', tint: true,
    // an S-curve with width: what a strip of paper actually looks like mid-air
    markup: '<path d="M4 1c7 4 7 8 1 12s-6 8 1 12" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>',
  },
  {
    id: 'chip', name: 'Paper chip', group: 'confetti', viewBox: '0 0 16 12', tint: true,
    markup: '<path d="M1 3c4-3 10-3 14 0-1 5-1 6 0 9-4 3-10 3-14 0 1-3 1-4 0-9Z" fill="currentColor"/>',
  },

  // --- notes: proper glyphs as paths, so weight is ours to choose ---------------
  {
    id: 'quaver', name: 'Quaver', group: 'notes', viewBox: '0 0 20 26', tint: true,
    markup: '<path d="M8 0v17.2a4.6 4.6 0 1 0 3 4.3V6.6c3.6.9 6 2.9 6 5.4h3C20 6.4 15.6 1.6 8 0Z" fill="currentColor"/>',
  },
  {
    id: 'beamed', name: 'Beamed notes', group: 'notes', viewBox: '0 0 28 26', tint: true,
    markup: '<path d="M8 3.4v13.8a4.4 4.4 0 1 0 3 4.1V8.2l11-2.4v9.6a4.4 4.4 0 1 0 3 4.1V0L8 3.4Z" fill="currentColor"/>',
  },

  // --- symbols ------------------------------------------------------------------
  {
    id: 'zed', name: 'Z', group: 'symbols', viewBox: '0 0 22 22', tint: true,
    markup: '<path d="M3 2h16v3.4L8.6 18.4H19V22H3v-3.4L13.4 5.6H3V2Z" fill="currentColor"/>',
  },
  {
    id: 'bang', name: 'Exclamation', group: 'symbols', viewBox: '0 0 12 30', tint: true,
    // deliberately heavy: a notification badge has to read at a glance
    markup: '<rect x="1.5" y="0" width="9" height="19" rx="4.5" fill="currentColor"/>'
      + '<circle cx="6" cy="25.5" r="4.5" fill="currentColor"/>',
  },
  {
    id: 'query', name: 'Question', group: 'symbols', viewBox: '0 0 20 30', tint: true,
    markup: '<path d="M10 0C4.9 0 1.4 2.9.6 7.5l5 1C6 6.2 7.5 5 9.8 5c2.2 0 3.7 1.2 3.7 3 0 1.6-.8 2.5-2.9 3.9-2.6 1.7-3.6 3.2-3.4 6.2l.1 1.4h5l-.1-1c-.1-1.6.4-2.4 2.4-3.7 3-1.9 4.4-3.8 4.4-6.9C19 3.3 15.4 0 10 0Z" fill="currentColor"/>'
      + '<circle cx="9.8" cy="26" r="3.6" fill="currentColor"/>',
  },
  {
    id: 'star', name: 'Star', group: 'symbols', viewBox: '-0.6 -0.6 1.2 1.2', tint: true,
    markup: `<path d="${primitivePath('star', { points: 5, innerRatio: 0.45, vertexRadius: 0.25 })}" fill="currentColor"/>`,
  },
  {
    id: 'spark', name: 'Sparkle', group: 'symbols', viewBox: '0 0 24 24', tint: true,
    markup: '<path d="M12 0c1.1 6.6 5.3 10.8 12 12-6.7 1.2-10.9 5.4-12 12-1.1-6.6-5.3-10.8-12-12C6.7 10.8 10.9 6.6 12 0Z" fill="currentColor"/>',
  },
  {
    id: 'heart', name: 'Heart', group: 'symbols', viewBox: '0 0 24 22', tint: true,
    markup: '<path d="M12 21.4 2.7 12.5A6.1 6.1 0 0 1 12 4.9a6.1 6.1 0 0 1 9.3 7.6L12 21.4Z" fill="currentColor"/>',
  },
  {
    id: 'bell', name: 'Bell', group: 'symbols', viewBox: '0 0 24 26', tint: true,
    markup: '<path d="M12 0a2.6 2.6 0 0 1 2.6 2.6v.9A8.4 8.4 0 0 1 20.4 12v5l2.4 3.2V22H1.2v-1.8L3.6 17v-5a8.4 8.4 0 0 1 5.8-8.5v-.9A2.6 2.6 0 0 1 12 0Z" fill="currentColor"/>'
      + '<path d="M8.6 23.6h6.8a3.4 3.4 0 0 1-6.8 0Z" fill="currentColor"/>',
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
  return (shapeId?: string, svgAssetId?: string) => {
    if (shapeId) {
      const s = shapeById(shapeId);
      return s ? { sourceMarkup: s.markup, viewBox: s.viewBox } : undefined;
    }
    if (svgAssetId) {
      const a = svgAssets?.find((x) => x.id === svgAssetId);
      return a ? { sourceMarkup: a.markup, viewBox: a.viewBox } : undefined;
    }
    return undefined;
  };
}
