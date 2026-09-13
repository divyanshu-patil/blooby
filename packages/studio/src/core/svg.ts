import { mapPath, normalizePath, pathBounds } from './path';
import { parseHex } from './color';
import type { ColorStop, Vec2, VectorPath } from './types';

/**
 * One SVG parser for the whole app.
 *
 * Only the inside of the <svg> is kept, plus its viewBox — the outer element is re-created
 * by the renderer at whatever size the thing drawing it is, so a file authored at 512px
 * and one authored at 24px come out the same size. Anything that can execute is stripped:
 * this markup goes through dangerouslySetInnerHTML, and pasted artwork is untrusted.
 */
const PAINT_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity'];

export function parseSvg(text: string): { markup: string; viewBox: string } | null {
  if (typeof text !== 'string') return null;
  const open = /<svg\b[^>]*>/i.exec(text);
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg\s*>/i.exec(text)?.[1];
  if (!open || inner === undefined) return null;
  const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(open[0])?.[1];
  const viewBox = attr('viewBox') ?? `0 0 ${parseFloat(attr('width') ?? '') || 100} ${parseFloat(attr('height') ?? '') || 100}`;
  let markup = inner
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();
  if (!markup) return null;

  /**
   * Paint set on the <svg> element itself has to come along.
   *
   * Icon sets put `fill="currentColor"` on the root and nothing on the paths, relying on
   * inheritance. Keeping only the inside threw that away, so the paths fell back to SVG's
   * default black — and changing the emitter colour did nothing, because nothing in the
   * artwork referred to `currentColor` any more.
   */
  const carried = PAINT_ATTRS
    .map((n) => [n, attr(n)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([n, v]) => `${n}="${v}"`);
  if (carried.length) markup = `<g ${carried.join(' ')}>${markup}</g>`;
  return { markup, viewBox };
}

/* ---- geometry ---------------------------------------------------------------
 *
 * The artwork as real vector paths, not markup: what lets an imported SVG be a layer the
 * stage draws, the timeline animates and the Lottie exporter writes as native shapes,
 * rather than a picture pasted on top.
 *
 * Regex over tags rather than DOMParser on purpose — the exporter and the test suite run
 * in node, and an import that parsed differently there than in the browser would be a
 * preview that lies about the export.
 */

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** An SVG `transform` list, composed left to right as the spec does. Unknown pieces are
 *  skipped rather than poisoning the whole list. */
export function parseTransform(s: string | undefined): M {
  let m = IDENTITY;
  if (!s) return m;
  for (const [, fn, raw] of s.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = (raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (!a.every(Number.isFinite)) continue;
    const r = ((a[0] ?? 0) * Math.PI) / 180;
    let t: M | null = null;
    switch (fn) {
      case 'matrix': if (a.length === 6) t = a as M; break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const c = Math.cos(r), sn = Math.sin(r);
        const rot: M = [c, sn, -sn, c, 0, 0];
        t = a.length >= 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(r), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(r), 0, 1, 0, 0]; break;
    }
    if (t) m = mul(m, t);
  }
  return m;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', cyan: '#00ffff',
  magenta: '#ff00ff', brown: '#a52a2a', navy: '#000080', teal: '#008080', gold: '#ffd700', silver: '#c0c0c0',
};

/**
 * An SVG paint: a colour, `null` for none, or undefined for "the layer's own" — which is
 * what `currentColor` and an unpainted element both mean here, since the layer's Fill row
 * is exactly what should recolour them. A gradient or pattern is flattened to the layer's
 * colour and reported, because Lottie-bound vector data has no slot for it.
 */
export function parsePaint(v: string | undefined, unsupported: Set<string>): ColorStop | null | 'current' | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s === 'inherit') return undefined;
  // distinct from "not painted": an unpainted stroke is NO stroke, a currentColor one is
  // the layer's — which is how every line-icon set is written
  if (s === 'currentcolor') return 'current';
  if (s === 'none' || s === 'transparent') return null;
  if (s.startsWith('url(')) { unsupported.add('gradient or pattern paint (drawn in the layer colour)'); return undefined; }
  const hex = NAMED[s] ?? s;
  if (/^#[0-9a-f]{3,8}$/.test(hex)) {
    const h = hex.slice(1);
    const alpha = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return parseHex(h.length === 4 ? h.slice(0, 3) : h.slice(0, 6), alpha);
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(s);
  if (rgb) {
    const [r, g, b, a] = rgb[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    if ([r, g, b].every(Number.isFinite)) return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Number.isFinite(a) ? Math.min(1, Math.max(0, a > 1 ? a / 255 : a)) : 1 };
  }
  unsupported.add(`paint "${v.trim()}"`);
  return undefined;
}
const clamp255 = (v: number) => Math.round(Math.min(255, Math.max(0, v)));

const num = (v: string | undefined, d = 0) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : d; };

/** An element's geometry as a path `d`, or null when it has none we can draw. */
function elementPath(tag: string, a: (n: string) => string | undefined): { d: string; closed: boolean } | null {
  switch (tag) {
    case 'path': { const d = a('d'); return d ? { d, closed: /z\s*$/i.test(d.trim()) } : null; }
    case 'rect': {
      const x = num(a('x')), y = num(a('y')), w = num(a('width')), h = num(a('height'));
      if (w <= 0 || h <= 0) return null;
      let rx = num(a('rx'), NaN), ry = num(a('ry'), NaN);
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
      if (!Number.isFinite(ry)) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return { d: `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`, closed: true };
      return {
        closed: true,
        d: `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry}`
          + ` A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
          + ` V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`,
      };
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a('cx')), cy = num(a('cy'));
      const rx = tag === 'circle' ? num(a('r')) : num(a('rx')), ry = tag === 'circle' ? rx : num(a('ry'));
      if (rx <= 0 || ry <= 0) return null;
      return { closed: true, d: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z` };
    }
    case 'line':
      return { closed: false, d: `M ${num(a('x1'))} ${num(a('y1'))} L ${num(a('x2'))} ${num(a('y2'))}` };
    case 'polyline':
    case 'polygon': {
      const pts = (a('points')?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      if (pts.length < 4) return null;
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      return { closed: tag === 'polygon', d: tag === 'polygon' ? `${d} Z` : d };
    }
    default: return null;
  }
}

/** Containers whose contents are never drawn as themselves. */
const HIDDEN = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'filter', 'marker', 'title', 'desc', 'style', 'metadata']);
/** Things an SVG can draw that we cannot turn into outlines — named, never silently lost. */
const CANNOT: Record<string, string> = {
  text: 'text (convert it to outlines before importing)', tspan: 'text', textpath: 'text',
  image: 'embedded bitmap images', use: '<use> references', foreignobject: 'foreignObject',
};

type SvgPaint = ColorStop | null | 'current' | undefined;
interface Paint { fill?: SvgPaint; stroke?: SvgPaint; strokeWidth: number; opacity: number; fillOpacity: number; strokeOpacity: number; evenOdd: boolean; m: M }

export interface SvgGeometry {
  /** in the SVG's own coordinates, transforms applied */
  paths: (VectorPath & { closed: boolean })[];
  /** human-readable list of what could not be carried over */
  unsupported: string[];
}

/**
 * Every drawable element of an SVG as a path in its own user space, with transforms
 * applied and paint resolved down the tree. Malformed input yields fewer paths, never
 * NaN: every path goes through the same guarded parser the shape editor uses.
 */
export function parseSvgGeometry(text: string): SvgGeometry | null {
  if (typeof text !== 'string') return null;
  const open = /<svg\b([^>]*)>/i.exec(text);
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg\s*>/i.exec(text)?.[1];
  if (!open || inner === undefined) return null;
  const unsupported = new Set<string>();
  const attrsOf = (s: string) => {
    const out: Record<string, string> = {};
    for (const [, k, , v1, v2] of s.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[k.toLowerCase()] = v1 ?? v2 ?? '';
    // style="fill: red; stroke-width: 2" overrides the attributes, as CSS does
    for (const decl of (out.style ?? '').split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
    return out;
  };

  const inherit = (parent: Paint, at: Record<string, string>): Paint => ({
    fill: 'fill' in at ? parsePaint(at.fill, unsupported) : parent.fill,
    stroke: 'stroke' in at ? parsePaint(at.stroke, unsupported) : parent.stroke,
    strokeWidth: 'stroke-width' in at ? num(at['stroke-width'], parent.strokeWidth) : parent.strokeWidth,
    opacity: parent.opacity * ('opacity' in at ? Math.min(1, Math.max(0, num(at.opacity, 1))) : 1),
    fillOpacity: 'fill-opacity' in at ? Math.min(1, Math.max(0, num(at['fill-opacity'], 1))) : parent.fillOpacity,
    strokeOpacity: 'stroke-opacity' in at ? Math.min(1, Math.max(0, num(at['stroke-opacity'], 1))) : parent.strokeOpacity,
    evenOdd: 'fill-rule' in at ? at['fill-rule'] === 'evenodd' : parent.evenOdd,
    m: at.transform ? mul(parent.m, parseTransform(at.transform)) : parent.m,
  });

  const rootAt = attrsOf(open[1]);
  const stack: Paint[] = [inherit({ strokeWidth: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1, evenOdd: false, m: IDENTITY }, { ...rootAt, transform: '' })];
  let hidden = 0;
  const paths: SvgGeometry['paths'] = [];
  const body = inner.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script\s*>/gi, '');

  for (const [, close, rawTag, rest, self] of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const tag = rawTag.toLowerCase();
    if (close) {
      if (HIDDEN.has(tag)) hidden = Math.max(0, hidden - 1);
      else if ((tag === 'g' || tag === 'a' || tag === 'svg' || tag === 'switch') && stack.length > 1) stack.pop();
      continue;
    }
    if (HIDDEN.has(tag)) { if (!self) hidden++; continue; }
    if (hidden) continue;
    const at = attrsOf(rest);
    if (tag === 'g' || tag === 'a' || tag === 'svg' || tag === 'switch') {
      if (!self) stack.push(inherit(stack[stack.length - 1], at));
      continue;
    }
    if (CANNOT[tag]) { unsupported.add(CANNOT[tag]); continue; }
    if (at['clip-path'] || at.mask || at.filter) unsupported.add('clip paths, masks and filters (the shape is kept, the effect is not)');
    const geo = elementPath(tag, (n) => at[n]);
    if (!geo) continue;
    const paint = inherit(stack[stack.length - 1], at);
    const d = mapPath(geo.d, (p) => apply(paint.m, p));
    if (!d) continue;
    const scale = Math.sqrt(Math.abs(paint.m[0] * paint.m[3] - paint.m[1] * paint.m[2])) || 1;
    // SVG's own defaults: an element with no fill anywhere up the tree fills black; one
    // with no stroke has none. Unpainted and currentColor fills are both "the layer's";
    // for a stroke only currentColor is — unpainted is none at all.
    const own = (c: ColorStop, k: number) => ({ ...c, a: c.a * k * paint.opacity });
    const fill = paint.fill === undefined || paint.fill === 'current' ? undefined : paint.fill && own(paint.fill, paint.fillOpacity);
    const stroke = paint.stroke === undefined ? null : paint.stroke === 'current' ? undefined : paint.stroke && own(paint.stroke, paint.strokeOpacity);
    paths.push({
      d, closed: geo.closed,
      // an open line has nothing to fill, whatever its fill says
      fill: geo.closed ? fill : null,
      stroke,
      ...(stroke !== null ? { strokeWidth: paint.strokeWidth * scale } : {}),
      ...(paint.evenOdd ? { evenOdd: true } : {}),
    });
  }
  return { paths, unsupported: [...unsupported] };
}

export interface ImportedSvg {
  /** every path, fitted together into one -0.5..0.5 box */
  paths: VectorPath[];
  /** the artwork's own size in its own units — what sizes the layer */
  width: number;
  height: number;
  /** when every path shares one fill, it becomes the layer's own paint, so the layer's
   *  Fill row (and its keyframes) recolour the whole icon */
  fill?: ColorStop;
  /** when the layer's stroke is used — a currentColor stroke, or one colour shared by
   *  every stroked path. `color` undefined means "currentColor": the caller picks. Width
   *  is a fraction of the layer's size. */
  stroke?: { color?: ColorStop; width: number };
  /** whether anything was painted with currentColor — tinted artwork */
  tinted: boolean;
  unsupported: string[];
}

/**
 * An SVG ready to be a layer: paths fitted into the unit box together (so their relative
 * placement survives), stroke widths re-expressed against the layer's size, and a shared
 * colour promoted to the layer's own paint.
 */
export function importSvg(text: string): ImportedSvg | null {
  const geo = parseSvgGeometry(text);
  if (!geo) return null;
  const tinted = /currentcolor/i.test(text);
  const drawn = geo.paths.filter((p) => pathBounds(p.d));
  if (!drawn.length) return { paths: [], width: 0, height: 0, tinted, unsupported: geo.unsupported };
  const all = normalizePath(drawn.map((p) => p.d).join(' '));
  if (!all) return null;
  const { x, y, w, h } = all.bounds;
  const unit = (d: string) => mapPath(d, (p) => ({ x: (p.x - x) / w, y: (p.y - y) / h }));
  const mean = Math.sqrt(w * h) || 1;

  const same = (cs: (ColorStop | null | undefined)[]) => {
    const [first] = cs;
    return first && cs.every((c) => c && c.r === first.r && c.g === first.g && c.b === first.b && c.a === first.a) ? first : undefined;
  };
  const fills = drawn.filter((p) => p.fill !== null).map((p) => p.fill);
  const stroked = drawn.filter((p) => p.stroke !== null);
  const sharedFill = fills.length ? same(fills) : undefined;
  // one colour on every stroked path is promoted like a fill is; currentColor strokes
  // are the layer's already
  const sharedStroke = stroked.length ? same(stroked.map((p) => p.stroke)) : undefined;
  const usesLayerStroke = stroked.some((p) => p.stroke === undefined);
  const widths = stroked.map((p) => (p.strokeWidth ?? 1) / mean);

  const paths: VectorPath[] = drawn.map((p) => ({
    d: unit(p.d),
    // a promoted colour is the layer's now: undefined hands the path back to it
    fill: p.fill === null ? null : sharedFill ? undefined : p.fill,
    stroke: p.stroke === null ? null : sharedStroke ? undefined : p.stroke,
    // as a fraction of the layer's size, so it scales with the layer like the path does
    ...(p.stroke !== null ? { strokeWidth: (p.strokeWidth ?? 1) / mean } : {}),
    ...(p.evenOdd ? { evenOdd: true } : {}),
  }));
  return {
    paths, width: w, height: h, tinted, unsupported: geo.unsupported,
    ...(sharedFill ? { fill: sharedFill } : {}),
    ...(sharedStroke || usesLayerStroke ? { stroke: { color: sharedStroke, width: Math.max(...widths) } } : {}),
  };
}

/** Every path of an SVG merged into one unit-box outline — what the shape editor takes
 *  when an SVG is pasted into it, so any icon can become a layer's morphable shape. */
export function svgOutline(text: string): string | null {
  const imp = importSvg(text);
  const closed = imp?.paths.filter((p) => p.fill !== null);
  return closed?.length ? closed.map((p) => p.d).join(' ') : null;
}

/** Whether a clipboard string is worth treating as SVG at all. */
export const looksLikeSvg = (text: string) => /<svg\b[\s\S]*<\/svg\s*>/i.test(text);
