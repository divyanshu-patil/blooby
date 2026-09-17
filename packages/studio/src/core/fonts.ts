import { fallbackMetrics, type TextMetrics } from './text';
import { rigOf, type FontRef, type Project } from './types';

/**
 * Google Fonts, loaded on demand.
 *
 * The project stores a font's NAME (family, weight, style) and nothing else. When a text
 * layer needs a face, the one file for that weight and style is fetched from Fontsource —
 * which mirrors the whole Google Fonts library, CORS-open, no key — and parsed with
 * opentype.js for two things the browser will not hand over: exact advance widths, so
 * layout is the same everywhere, and glyph OUTLINES, so the stage, the raster exports and
 * the Lottie all draw the very same vector letters with no font needed at playback.
 *
 * Nothing loads at startup. The catalogue is fetched when the font picker first opens;
 * a face when a layer first uses it. Until one arrives — or if it never does — text lays
 * out with `fallbackMetrics` and draws in a system face, so it is never missing, and
 * `fontStatus` says why it looks different.
 */

/** A face's metrics and outlines, in font units, straight from the file. */
export interface FontData {
  unitsPerEm: number;
  ascender: number;
  /** negative, as fonts store it */
  descender: number;
  advance(ch: string): number;
  kern(a: string, b: string): number;
  /** the glyph as an SVG path in EM units (1 = the font size), y down, its advance centred
   *  on 0 and its baseline at 0. Null when the face has no glyph for it. */
  outline(ch: string): string | null;
}

export type FontStatus = 'loading' | 'ready' | 'failed';
interface Face { status: FontStatus; data?: FontData; error?: string; weight?: number }

const faces = new Map<string, Face>();
const inflight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; for (const fn of listeners) fn(); };

/** Changes every time a face arrives or fails — what a renderer re-lays text out on. */
export const fontsVersion = () => version;
export function onFonts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const snapWeight = (w: number) => Math.min(900, Math.max(100, Math.round((Number.isFinite(w) ? w : 400) / 100) * 100));
export const fontKey = (f: FontRef) => `${f.family}|${snapWeight(f.weight)}|${f.style}`;
/** Fontsource's id for a family: "Playfair Display" → "playfair-display". */
export const fontId = (family: string) => family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The CSS stack a glyph falls back to while its outlines are not here. */
export const cssFamily = (f: FontRef) => `"${f.family.replace(/"/g, '')}", ui-sans-serif, system-ui, sans-serif`;
const fileUrl = (f: FontRef, weight: number) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${fontId(f.family)}@latest/latin-${weight}-${f.style}.woff`;

export const fontStatus = (f: FontRef): FontStatus | undefined => faces.get(fontKey(f))?.status;
export const fontError = (f: FontRef): string | undefined => faces.get(fontKey(f))?.error;
export const fontData = (f: FontRef): FontData | undefined => faces.get(fontKey(f))?.data;
/** The weight actually drawn — a family without the one asked for uses its nearest. */
export const fontWeightUsed = (f: FontRef): number => faces.get(fontKey(f))?.weight ?? snapWeight(f.weight);

/** Metrics at a size: the real face once loaded, the generic estimate until then. */
export function metricsFor(f: FontRef, size: number): TextMetrics {
  const d = fontData(f);
  if (!d) return fallbackMetrics(size, snapWeight(f.weight));
  const k = size / d.unitsPerEm;
  return {
    advance: (ch) => d.advance(ch) * k,
    kern: (a, b) => d.kern(a, b) * k,
    ascent: d.ascender * k,
    descent: -d.descender * k,
  };
}

/** A glyph's outline for the renderer and the exporter, or null to draw it as text. */
export const glyphOutline = (f: FontRef, ch: string): string | null => fontData(f)?.outline(ch) ?? null;

/** Hand a face in directly — how tests, and anything that already has the file, register one. */
export function registerFont(f: FontRef, data: FontData, weight = snapWeight(f.weight)): void {
  faces.set(fontKey(f), { status: 'ready', data, weight });
  bump();
}

/* ---- from a font file ------------------------------------------------------------------- */

interface OtGlyph { index: number; advanceWidth?: number; getPath(x: number, y: number, size: number): { commands: OtCmd[] } }
interface OtCmd { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
export interface OtFont {
  unitsPerEm: number; ascender: number; descender: number;
  charToGlyph(ch: string): OtGlyph;
  getKerningValue(a: OtGlyph, b: OtGlyph): number;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** An opentype.js font as FontData, with every answer kept once worked out. */
export function fontDataFrom(font: OtFont): FontData {
  const upem = font.unitsPerEm || 1000;
  const glyphs = new Map<string, OtGlyph>();
  const outlines = new Map<string, string | null>();
  const glyph = (ch: string) => {
    let g = glyphs.get(ch);
    if (!g) { g = font.charToGlyph(ch); glyphs.set(ch, g); }
    return g;
  };
  return {
    unitsPerEm: upem, ascender: font.ascender, descender: font.descender,
    advance: (ch) => glyph(ch)?.advanceWidth ?? upem * 0.5,
    kern(a, b) {
      try { return font.getKerningValue(glyph(a), glyph(b)) || 0; } catch { return 0; }
    },
    outline(ch) {
      if (outlines.has(ch)) return outlines.get(ch)!;
      const g = glyph(ch);
      let d: string | null = null;
      if (g && g.index !== 0) {
        // at size 1 the path comes out in ems, y down, baseline at 0; centred on its advance
        const cmds = g.getPath(-(g.advanceWidth ?? 0) / upem / 2, 0, 1).commands;
        d = cmds.map((c) => {
          switch (c.type) {
            case 'M': case 'L': return `${c.type} ${r4(c.x!)} ${r4(c.y!)}`;
            case 'Q': return `Q ${r4(c.x1!)} ${r4(c.y1!)} ${r4(c.x!)} ${r4(c.y!)}`;
            case 'C': return `C ${r4(c.x1!)} ${r4(c.y1!)} ${r4(c.x2!)} ${r4(c.y2!)} ${r4(c.x!)} ${r4(c.y!)}`;
            case 'Z': return 'Z';
            default: return '';
          }
        }).join(' ').trim() || null;
      }
      outlines.set(ch, d);
      return d;
    },
  };
}

/** opentype.js, only when a face is first needed — it is never in the startup bundle. */
async function parseFont(buf: ArrayBuffer): Promise<OtFont> {
  const mod = (await import('opentype.js')) as unknown as { parse?: (b: ArrayBuffer) => OtFont; default?: { parse: (b: ArrayBuffer) => OtFont } };
  const parse = mod.parse ?? mod.default?.parse;
  if (!parse) throw new Error('the font parser did not load');
  return parse(buf);
}

/**
 * Load one face. Resolves true once it is drawable, false when it cannot be had — in which
 * case the text keeps its fallback look and `fontError` says what happened. A family that
 * lacks the requested weight is loaded at its nearest one instead.
 */
export function loadFont(f: FontRef): Promise<boolean> {
  const key = fontKey(f);
  if (faces.get(key)?.status === 'ready') return Promise.resolve(true);
  const running = inflight.get(key);
  if (running) return running;
  faces.set(key, { status: 'loading' });
  bump();
  const job = (async () => {
    const want = snapWeight(f.weight);
    const entry = catalogEntry(f.family);
    const weights = entry?.weights.length ? entry.weights : [want];
    const weight = weights.includes(want) ? want : weights.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    const style = entry && !entry.styles.includes(f.style) ? 'normal' : f.style;
    const url = fileUrl({ ...f, style }, weight);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${f.family} ${weight}${style === 'italic' ? ' italic' : ''} is not in Google Fonts (${res.status})`);
      const data = fontDataFrom(await parseFont(await res.arrayBuffer()));
      faces.set(key, { status: 'ready', data, weight });
      // the same file for CSS, so the picker's previews and any not-yet-outlined glyph match
      if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
        new FontFace(f.family, `url(${url})`, { weight: String(weight), style }).load().then((ff) => document.fonts.add(ff)).catch(() => { /* outlines already carry it */ });
      }
      bump();
      return true;
    } catch (e) {
      faces.set(key, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
      bump();
      return false;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Every face a project's text asks for, its keyframed families and weights included. */
export function projectFonts(p: Project): FontRef[] {
  const out = new Map<string, FontRef>();
  const add = (f: FontRef) => out.set(fontKey(f), { ...f, weight: snapWeight(f.weight) });
  // every state's own layers — an export carries them all
  for (const tl of p.timelines) {
    for (const n of Object.values(rigOf(p, tl).nodes)) {
      if (!n.text) continue;
      add(n.text.font);
      for (const t of tl.tracks) {
        if (t.nodeId !== n.id) continue;
        for (const k of t.keyframes) {
          if (t.property === 'text.font.family' && typeof k.value === 'string') add({ ...n.text.font, family: k.value });
          if (t.property === 'text.font.weight' && typeof k.value === 'number') add({ ...n.text.font, weight: k.value });
        }
      }
    }
  }
  return [...out.values()];
}

/** Load everything a project's text needs; true when all of it drew from real faces. */
export async function ensureFonts(p: Project): Promise<boolean> {
  const results = await Promise.all(projectFonts(p).map(loadFont));
  return results.every(Boolean);
}

/** Families whose outlines are not here — what an export has to warn about. */
export const missingFonts = (p: Project): string[] =>
  [...new Set(projectFonts(p).filter((f) => !fontData(f)).map((f) => `${f.family} ${snapWeight(f.weight)}${f.style === 'italic' ? ' italic' : ''}`))];

/* ---- the catalogue ----------------------------------------------------------------------- */

export interface CatalogFont { id: string; family: string; weights: number[]; styles: string[]; category: string }

/** Offered first, and all there is if the catalogue cannot be reached. */
export const POPULAR_FONTS = [
  'Inter', 'Poppins', 'Montserrat', 'Roboto', 'Playfair Display', 'Space Grotesk', 'DM Sans', 'Nunito', 'Outfit',
  'Open Sans', 'Lato', 'Rubik', 'Fredoka', 'Baloo 2', 'Bebas Neue', 'Oswald', 'Raleway', 'Quicksand',
  'Pacifico', 'Lobster', 'Caveat', 'Permanent Marker', 'Bricolage Grotesque', 'Sora', 'Manrope', 'Space Mono',
];
const OFFLINE: CatalogFont[] = POPULAR_FONTS.map((family) => ({
  id: fontId(family), family, weights: [400, 700], styles: ['normal'], category: 'sans-serif',
}));

let catalog: CatalogFont[] | null = null;
let catalogJob: Promise<CatalogFont[]> | null = null;
let catalogFailed = false;

export const catalogEntry = (family: string): CatalogFont | undefined =>
  (catalog ?? OFFLINE).find((c) => c.family.toLowerCase() === family.toLowerCase());
export const catalogOffline = () => catalogFailed;

/** Every Google font, fetched once, when first asked for. */
export function fontCatalog(): Promise<CatalogFont[]> {
  if (catalog) return Promise.resolve(catalog);
  catalogJob ??= fetch('https://api.fontsource.org/v1/fonts?type=google')
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<CatalogFont[]>; })
    .then((list) => {
      catalog = list
        .filter((c) => c && typeof c.family === 'string' && Array.isArray(c.weights))
        .map((c) => ({ id: c.id, family: c.family, weights: c.weights, styles: c.styles ?? ['normal'], category: c.category ?? 'sans-serif' }))
        .sort((a, b) => a.family.localeCompare(b.family));
      catalogFailed = false;
      bump();
      return catalog;
    })
    .catch(() => { catalogJob = null; catalogFailed = true; return OFFLINE; });
  return catalogJob;
}

/** The catalogue narrowed by a search, the popular families first when there is none. */
export function searchFonts(list: CatalogFont[], query: string, category?: string): CatalogFont[] {
  const q = query.trim().toLowerCase();
  const pool = category ? list.filter((c) => c.category === category) : list;
  if (!q) {
    const pop = POPULAR_FONTS.map((f) => pool.find((c) => c.family === f)).filter((c): c is CatalogFont => !!c);
    return [...pop, ...pool.filter((c) => !POPULAR_FONTS.includes(c.family))];
  }
  const starts = pool.filter((c) => c.family.toLowerCase().startsWith(q));
  const has = pool.filter((c) => !c.family.toLowerCase().startsWith(q) && c.family.toLowerCase().includes(q));
  return [...starts, ...has];
}

/** The weights a family has — only those are offered. */
export const weightsOf = (family: string): number[] => catalogEntry(family)?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];
export const hasItalic = (family: string): boolean => catalogEntry(family)?.styles.includes('italic') ?? true;

/** A preview of a family for the picker: its 400 weight as CSS, loaded when shown. */
export function previewFont(family: string): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  const key = `preview|${family}`;
  if (faces.has(key)) return;
  faces.set(key, { status: 'loading' });
  const entry = catalogEntry(family);
  const w = entry?.weights.includes(400) ? 400 : entry?.weights[0] ?? 400;
  new FontFace(family, `url(${fileUrl({ family, weight: w, style: 'normal' }, w).replace('.woff', '.woff2')})`, { weight: String(w) })
    .load().then((ff) => { document.fonts.add(ff); faces.set(key, { status: 'ready' }); })
    .catch(() => faces.set(key, { status: 'failed' }));
}
