import type { PathSampler } from './path';
import type { TextCharAnim, TextStyle, Vec2 } from './types';

/**
 * Laying out a text layer: lines, glyph positions, and where each glyph sits when the
 * words follow an arc or a path. Pure arithmetic over a font's metrics, so the stage, a
 * thumbnail and the exporter all place every glyph in exactly the same spot.
 *
 * Nothing here knows where the metrics come from. core/fonts.ts answers with the real
 * face once it has loaded and with `fallbackMetrics` until then, which is why a text layer
 * is never missing — at worst its letters are a little differently spaced for a moment.
 */

/** What layout needs from a font, in px at the style's size. */
export interface TextMetrics {
  advance(ch: string): number;
  kern(a: string, b: string): number;
  /** above the baseline, px */
  ascent: number;
  /** below the baseline, px, positive */
  descent: number;
}

/** One drawn character. x/y is its baseline centre; `rot` degrees. */
export interface Glyph { ch: string; index: number; x: number; y: number; rot: number; scale: number; alpha: number }

export const TEXT_DEFAULTS = {
  font: { family: 'Inter', weight: 600, style: 'normal' as const },
  size: 48, lineHeight: 1.15, letterSpacing: 0,
  arc: { radius: 180, start: -70, end: 70 },
};

/* ---- fallback metrics -------------------------------------------------------------- */

const NARROW = new Set([...'iljtfr.,:;\'"!|()[]{}1']);
const WIDE = new Set([...'mwMW@%']);
/**
 * A generic sans, by character class: good enough that a box is the right size and text is
 * readable while the real face loads, and deterministic, so a test (or a machine with no
 * network) gets the same layout every time.
 */
export function fallbackMetrics(size: number, weight = 400): TextMetrics {
  const w = 1 + (weight - 400) / 2500;
  return {
    advance(ch) {
      if (ch === ' ') return size * 0.27;
      const upper = ch !== ch.toLowerCase();
      const k = NARROW.has(ch) ? 0.3 : WIDE.has(ch) ? 0.84 : upper ? 0.66 : 0.54;
      return size * k * w;
    },
    kern: () => 0,
    ascent: size * 0.93,
    descent: size * 0.24,
  };
}

/* ---- lines ------------------------------------------------------------------------- */

interface LaidChar { ch: string; index: number; x: number; adv: number }
export interface Line { chars: LaidChar[]; width: number }

/**
 * Break the content into lines — at every newline, and at spaces when a box width is set
 * (a word longer than the box breaks where it must). `index` counts every character
 * except the line breaks themselves, which is what the typewriter reveal counts.
 */
export function layoutLines(style: TextStyle, m: TextMetrics): Line[] {
  const spacing = style.letterSpacing;
  const width = style.width && style.width > 0 ? style.width : Infinity;
  const lines: Line[] = [];
  let index = 0;
  for (const para of style.content.split('\n')) {
    // words keep their trailing space so a wrapped line can drop it cleanly
    const words = para.match(/\S+\s*|\s+/g) ?? [''];
    let line: LaidChar[] = [];
    let x = 0;
    const flush = () => {
      // a line's width does not include the space a wrap left hanging at its end
      let end = line.length;
      while (end > 0 && line[end - 1].ch === ' ') end--;
      const last = line[end - 1];
      lines.push({ chars: line, width: last ? last.x + last.adv : 0 });
      line = []; x = 0;
    };
    for (const word of words) {
      const chars = [...word];
      const wordW = chars.reduce((s, ch) => s + m.advance(ch) + spacing, 0);
      if (line.length && x + wordW - spacing > width && word.trim()) flush();
      for (const ch of chars) {
        const prev = line[line.length - 1];
        if (prev) x += m.kern(prev.ch, ch);
        const adv = m.advance(ch);
        if (line.length && x + adv > width && ch !== ' ' && !word.trim().length) flush();
        line.push({ ch, index: index++, x, adv });
        x += adv + spacing;
      }
    }
    flush();
  }
  return lines;
}

/** The text block, with (0,0) at the anchor its alignment names — the corner or edge that
 *  stays put when the words change, so editing never makes a layer jump. */
export function textBlock(style: TextStyle, lines: Line[], m: TextMetrics) {
  const lh = style.size * style.lineHeight;
  const w = style.width && style.width > 0 ? style.width : Math.max(0, ...lines.map((l) => l.width));
  const h = Math.max(lh, lines.length * lh);
  const x0 = style.align === 'left' ? 0 : style.align === 'center' ? -w / 2 : -w;
  const y0 = style.valign === 'top' ? 0 : style.valign === 'middle' ? -h / 2 : -h;
  // the glyphs' own ink, centred in each line's slot
  const baseline = (i: number) => y0 + i * lh + lh / 2 + (m.ascent - m.descent) / 2;
  const lineX = (l: Line) => x0 + (style.align === 'left' ? 0 : style.align === 'center' ? (w - l.width) / 2 : w - l.width);
  return { x0, y0, w, h, lh, baseline, lineX };
}

/* ---- along an arc or a path --------------------------------------------------------- */

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * An arc as something text can run along, `start` to `end` degrees clockwise from 12
 * o'clock. Normal is a frown — the words run over the top of a circle below them, glyphs
 * pointing out; reversed is a smile, the words sitting in the bowl of a circle above. The
 * arc's middle (0°) is at the origin, so the layer's position is where the arc peaks.
 */
export function arcSampler(radius: number, start: number, end: number, reverse = false): PathSampler {
  const r = Math.max(1, Math.abs(radius));
  const a0 = rad(Math.min(start, end));
  const length = r * Math.abs(rad(end - start));
  return {
    length, closed: false,
    at(s) {
      const th = a0 + s / r;
      return reverse
        ? { x: r * Math.sin(th), y: -r * (1 - Math.cos(th)), angle: -th }
        : { x: r * Math.sin(th), y: r * (1 - Math.cos(th)), angle: th };
    },
  };
}

/** The same path run from its other end. */
const reversed = (s: PathSampler): PathSampler => ({
  length: s.length, closed: s.closed,
  at(d) { const p = s.at(s.length - d); return { ...p, angle: p.angle + Math.PI }; },
});

/* ---- per-character motion ------------------------------------------------------------ */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const backOut = (u: number) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
/** A stable pseudo-random per glyph, so a scatter lands the same way every frame. */
const hash = (i: number, k: number) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * How one glyph moves at `progress` (0 → 1 plays it; a wave keeps going past 1, a cycle a
 * unit). `stagger` 0 moves every glyph together; 1 moves them one after another.
 */
function charMotion(kind: TextCharAnim, progress: number, stagger: number, i: number, n: number, size: number) {
  const still = { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1 };
  if (kind === 'none') return still;
  if (kind === 'wave') {
    const ph = 2 * Math.PI * (progress - i * Math.max(0.04, stagger) * 0.35);
    return { ...still, dy: Math.sin(ph) * size * 0.22, rot: Math.cos(ph) * 6 };
  }
  const st = clamp01(stagger);
  const u = clamp01(progress * (1 + st * (n - 1)) - i * st);
  const fade = clamp01(u * 2.5);
  switch (kind) {
    case 'pop': return { ...still, scale: u <= 0 ? 0 : backOut(u), alpha: fade };
    case 'fade': return { ...still, alpha: u };
    case 'drop': return { ...still, dy: -(1 - backOut(u)) * size * 0.9, alpha: fade };
    case 'rise': return { ...still, dy: (1 - u) ** 2 * size * 0.7, alpha: u };
    case 'scatter': {
      const k = (1 - u) ** 2;
      return { dx: (hash(i, 1) - 0.5) * size * 5 * k, dy: (hash(i, 2) - 0.5) * size * 4 * k, rot: (hash(i, 3) - 0.5) * 240 * k, scale: 1, alpha: fade };
    }
    default: return still;
  }
}

/* ---- placing the glyphs ---------------------------------------------------------------- */

/**
 * Every visible glyph of a text layer.
 *
 * Straight text is placed in the layer's own frame around its anchor. `along` lays it on a
 * path instead — an arc in the layer's frame, or another layer's outline already in world
 * coordinates — with each glyph at its distance along, turned to the path's direction and
 * lifted off it by the baseline offset. Glyphs are placed by their CENTRE's distance along
 * the path, which is what keeps them from splaying apart round a tight curve.
 */
export function placeGlyphs(style: TextStyle, m: TextMetrics, along?: PathSampler): { glyphs: Glyph[]; lines: Line[] } {
  const lines = layoutLines(style, m);
  const block = textBlock(style, lines, m);
  const total = lines.reduce((s, l) => s + l.chars.filter((c) => c.ch !== ' ').length, 0);
  const revealFrom = Math.max(0, Math.floor(style.reveal?.start ?? 0));
  const revealTo = style.reveal?.end === undefined ? Infinity : Math.floor(style.reveal.end);
  const fx = style.chars;
  const path = style.path;
  // reversing a path runs it from its other end; an arc's "reverse" is the smile, which the
  // arc itself already is — reversing it again would read the words backwards
  const sampler = along && path?.reverse && path.mode === 'path' ? reversed(along) : along;
  const glyphs: Glyph[] = [];
  let drawn = 0;

  lines.forEach((line, li) => {
    const startX = block.lineX(line);
    for (const c of line.chars) {
      if (c.ch === ' ' || c.ch === '\t') continue;
      if (c.index < revealFrom || c.index >= revealTo) { drawn++; continue; }
      const motion = charMotion(fx?.kind ?? 'none', fx?.progress ?? 1, fx?.stagger ?? 0.5, drawn++, total, style.size);
      let x: number, y: number, rot: number;
      if (!sampler) {
        x = startX + c.x + c.adv / 2;
        y = block.baseline(li);
        rot = 0;
      } else {
        // alignment is along the path: left starts at its start, right ends at its end
        const L = sampler.length;
        const s0 = (path?.offset ?? 0) + (style.align === 'left' ? 0 : style.align === 'center' ? (L - line.width) / 2 : L - line.width);
        const flip = !!path?.flip;
        const centre = c.x + c.adv / 2;
        const at = sampler.at(s0 + (flip ? line.width - centre : centre));
        const up = { x: Math.sin(at.angle), y: -Math.cos(at.angle) };
        // further lines stack away from the path, and a flipped line hangs on its other side
        const lift = ((path?.baseline ?? 0) - li * block.lh) * (flip ? -1 : 1);
        x = at.x + up.x * lift;
        y = at.y + up.y * lift;
        rot = path?.rotate === false ? 0 : (at.angle * 180) / Math.PI + (flip ? 180 : 0);
      }
      if (motion.dx || motion.dy) {
        const r = rad(rot);
        x += motion.dx * Math.cos(r) - motion.dy * Math.sin(r);
        y += motion.dx * Math.sin(r) + motion.dy * Math.cos(r);
      }
      if (motion.alpha <= 0.002 || motion.scale <= 0.002) continue;
      glyphs.push({ ch: c.ch, index: c.index, x, y, rot: rot + motion.rot, scale: motion.scale, alpha: motion.alpha });
    }
  });
  return { glyphs, lines };
}

/** The box glyphs occupy, for a selection ring around text on a path. */
export function glyphBounds(glyphs: Glyph[], size: number): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!glyphs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of glyphs) {
    const r = size * 0.6 * g.scale;
    x0 = Math.min(x0, g.x - r); x1 = Math.max(x1, g.x + r);
    y0 = Math.min(y0, g.y - r * 1.4); y1 = Math.max(y1, g.y + r * 0.5);
  }
  return { x0, y0, x1, y1 };
}

export const isText = (v: { text?: unknown }): v is { text: TextStyle } => !!v.text;
export type { Vec2 };
