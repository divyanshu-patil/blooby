import { Fragment, useId, type ReactNode } from 'react';
import type { SceneItem } from '../core/scene';
import { cssColor } from '../core/color';
import { cssFamily, glyphOutline } from '../core/fonts';
import { mapPath, pathSampler } from '../core/path';
import { hash01 } from '../core/effects';
import type { Vec2 } from '../core/types';

/** A layer's outline attributes — screen px, so they read the same at any layer size. */
const strokeOf = (st: SceneItem['stroke']) => (st && st.width > 0
  ? { stroke: cssColor(st.color), strokeWidth: st.width, strokeLinecap: st.cap, strokeLinejoin: st.join }
  : {});

/** The trimmed stretch(es) of a line, 0–1, after the offset slides the window: two when it wraps the end. */
function trimSpans(t: NonNullable<SceneItem['trim']>): [number, number][] {
  const lo = Math.min(t.start, t.end), hi = Math.max(t.start, t.end), span = hi - lo;
  if (span < 1e-4) return [];
  if (span >= 1) return [[0, 1]];
  const a = ((lo + (t.offset ?? 0)) % 1 + 1) % 1, b = a + span;
  return b <= 1 ? [[a, b]] : [[a, 1], [0, b - 1]];
}

/**
 * A trim path in SVG: the outline mapped out of its unit box into real px (not scaled — a
 * scaled path with a non-scaling stroke measures its dashes in the wrong space and draws a
 * dotted line), then one dash per visible stretch along its measured length. With a taper the
 * stretch is drawn as a filled brush stroke instead — thin at its ends, full width between.
 */
function trimStroke(s: SceneItem, taper: number) {
  const d = mapPath(s.path!, (u) => ({ x: u.x * s.w, y: u.y * s.h }));
  const sampler = pathSampler(d);
  const len = sampler?.length ?? 0;
  const spans = s.trim ? trimSpans(s.trim) : [[0, 1] as [number, number]];
  if (!len || !spans.length || !sampler) return null;
  const place = `translate(${s.cx} ${s.cy})${s.rotation ? ` rotate(${s.rotation})` : ''}`;
  if (taper > 0 && s.stroke) {
    return (
      <g transform={place}>
        {spans.map(([a, b], k) => <path key={k} d={brush(sampler, a * len, b * len, s.stroke!.width, taper)} fill={cssColor(s.stroke!.color)} />)}
      </g>
    );
  }
  return (
    <g transform={place}>
      {spans.map(([a, b], k) => (
        <path key={k} d={d} fill="none" {...strokeOf(s.stroke)} strokeDasharray={`${len * (b - a)} ${len * 2}`} strokeDashoffset={-len * a} />
      ))}
    </g>
  );
}

/** A brush stroke along [from, to] of a line: a filled outline whose width swells from the ends. */
function brush(sampler: NonNullable<ReturnType<typeof pathSampler>>, from: number, to: number, width: number, taper: number): string {
  const n = Math.max(8, Math.min(160, Math.ceil((to - from) / 4)));
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = sampler.at(from + (to - from) * u);
    const w = (width / 2) * (1 - taper + taper * Math.sin(Math.PI * u));
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const pts = [...left, ...right.reverse()];
  return `M${pts.map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join('L')}Z`;
}

/** The layer as drawn, before any effect: text, artwork, an outline or a primitive. */
function drawItem(s: SceneItem, fill: string, guides: boolean): ReactNode {
  const spin = s.rotation ? `rotate(${s.rotation} ${s.cx} ${s.cy})` : undefined;
  // a text layer: each glyph its real outline from the font file, so what is drawn here
  // is the vector the export writes. Until the face arrives, the letter as text.
  if (s.glyphs && s.font) {
    const f = s.font;
    const st = strokeOf(s.stroke);
    return (
      <g transform={`translate(${s.cx} ${s.cy})${s.rotation ? ` rotate(${s.rotation})` : ''}`}>
        {s.glyphs.map((g) => {
          const d = glyphOutline(f, g.ch);
          const place = `translate(${g.x} ${g.y})${g.rot ? ` rotate(${g.rot})` : ''}`;
          const opacity = g.alpha < 0.999 ? g.alpha : undefined;
          return d
            ? <path key={g.index} d={d} transform={`${place} scale(${f.size * g.scale})`} fill={fill} opacity={opacity} vectorEffect="non-scaling-stroke" {...st} />
            : <text key={g.index} transform={g.scale !== 1 ? `${place} scale(${g.scale})` : place} fontFamily={cssFamily(f)} fontWeight={f.weight}
              fontStyle={f.style} fontSize={f.size} textAnchor="middle" fill={fill} opacity={opacity} {...st} style={{ userSelect: 'none' }}>{g.ch}</text>;
        })}
      </g>
    );
  }
  // imported vector artwork: every path in the unit box, each painted as the file
  // painted it — or with the layer's own fill and stroke where it deferred to them
  if (s.paths) {
    const w = Math.max(Math.abs(s.w), 0.001), h = Math.max(Math.abs(s.h), 0.001);
    const size = Math.sqrt(w * h), alpha = s.alpha ?? 1;
    return (
      <g transform={`${spin ?? ''} translate(${s.cx} ${s.cy}) scale(${w} ${h})`}>
        {s.paths.map((p, i) => {
          const pf = p.fill === null ? 'none' : p.fill ? cssColor({ ...p.fill, a: p.fill.a * alpha }) : fill;
          const own = p.stroke ? { color: { ...p.stroke, a: p.stroke.a * alpha }, width: (p.strokeWidth ?? 0) * size } : null;
          const layer = p.stroke === undefined && s.stroke ? { color: s.stroke.color, width: p.strokeWidth ? p.strokeWidth * size : s.stroke.width } : null;
          const st = own ?? layer;
          return (
            <path key={i} d={p.d} fill={pf} fillRule={p.evenOdd ? 'evenodd' : undefined} vectorEffect="non-scaling-stroke"
              {...(st ? strokeOf({ color: st.color, width: st.width, cap: s.stroke?.cap ?? 'round', join: s.stroke?.join ?? 'round' }) : {})} />
          );
        })}
      </g>
    );
  }
  if (s.svg) {
    // `color` + opacity rather than a fill: the built-in artwork paints with
    // currentColor, so one emitter colour reaches every path inside it — while an
    // imported SVG that carries its own colours keeps them, which is what
    // "automatic" means in the picker.
    return (
      <g transform={`${spin ?? ''} translate(${s.cx - s.w / 2} ${s.cy - s.h / 2})`}
        style={{ color: cssColor({ ...s.color, a: 1 }) }} opacity={s.color.a}>
        <svg width={s.w} height={s.h} viewBox={s.svg.viewBox} overflow="visible"
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: s.svg.sourceMarkup }} />
      </g>
    );
  }
  // an outline authored in a -0.5..0.5 box, scaled into this item's own w/h. Scaling
  // the path rather than regenerating it is what lets one morph drive any size.
  if (s.path) {
    const w = Math.max(Math.abs(s.w), 0.001), h = Math.max(Math.abs(s.h), 0.001);
    const taper = s.stroke && s.stroke.width > 0 ? (s.taper ?? 0) : 0;
    // a trimmed or tapered stroke is drawn in real px, beside the fill
    const own = !s.guide && s.stroke && (s.trim || taper > 0);
    // a guide is dashed and keeps a screen-px line: it is there to work with, and will not be
    // exported. Everything else is mapped into real px rather than scaled, so its stroke is
    // composition px like the export's — it zooms with the drawing instead of staying 2px on
    // screen, and a non-uniform w/h cannot stretch it either.
    if (s.guide) {
      return (
        <g transform={`${spin ?? ''} translate(${s.cx} ${s.cy}) scale(${w} ${h})`}>
          <path d={s.path} fill={fill} vectorEffect="non-scaling-stroke" {...strokeOf(s.stroke)} strokeDasharray="7 6" opacity={0.8} />
        </g>
      );
    }
    return (
      <>
        <g transform={`${spin ?? ''} translate(${s.cx} ${s.cy})`}>
          <path d={mapPath(s.path, (u) => ({ x: u.x * w, y: u.y * h }))} fill={fill} {...strokeOf(own ? undefined : s.stroke)} />
        </g>
        {own && trimStroke(s, taper)}
      </>
    );
  }
  if (s.text !== undefined) {
    // dominantBaseline centres the glyph on cy, so an emitter's path math is about
    // the particle's middle rather than wherever a font happens to sit its baseline
    return (
      <text x={s.cx} y={s.cy} fontSize={s.h} fill={fill}
        textAnchor="middle" dominantBaseline="central" transform={spin}
        style={{ userSelect: 'none' }}>{s.text}</text>
    );
  }
  void guides;
  if (s.shape === 'ellipse') {
    return <ellipse cx={s.cx} cy={s.cy} rx={Math.max(s.w, 0) / 2} ry={Math.max(s.h, 0) / 2} fill={fill} transform={spin} {...strokeOf(s.stroke)} />;
  }
  const w = Math.max(s.w, 0.001), h = Math.max(s.h, 0.001);
  return <rect x={s.cx - w / 2} y={s.cy - h / 2} width={w} height={h}
    rx={Math.min(w, h) / 2} ry={Math.min(w, h) / 2} fill={fill} transform={spin} {...strokeOf(s.stroke)} />;
}

const BLEND: Record<string, string> = { screen: 'screen', multiply: 'multiply', overlay: 'overlay', add: 'plus-lighter', difference: 'difference' };
const param = (e: { params: Record<string, number> }, k: string, d: number) => (Number.isFinite(e.params[k]) ? e.params[k] : d);

/**
 * One layer with its effect stack applied — as SVG, so the stage, thumbnails and raster
 * exports all show the same thing.
 *
 *   gradient fill → the drawing → blur / glow / shadow (one filter chain, in stack order)
 *   → rgb split and slice copies → scanlines → clip (mask) → blend
 */
function withEffects(s: SceneItem, uid: string, guides: boolean): ReactNode {
  const id = `${uid}${s.id.replace(/[^\w-]/g, '_')}`;
  const defs: ReactNode[] = [];
  let fill = cssColor(s.color);
  if (s.gradient && s.gradient.stops.length >= 2) {
    const a = (s.gradient.angle * Math.PI) / 180, alpha = s.alpha ?? s.color.a;
    const stops = s.gradient.stops.map((st, i) => <stop key={i} offset={st.at} stopColor={cssColor({ ...st.color, a: 1 })} stopOpacity={st.color.a * alpha} />);
    defs.push(s.gradient.type === 'radial'
      ? <radialGradient key="g" id={`${id}-g`} cx={0.5 + Math.cos(a) * 0.2} cy={0.5 + Math.sin(a) * 0.2} r={0.6}>{stops}</radialGradient>
      : <linearGradient key="g" id={`${id}-g`} x1={0.5 - Math.cos(a) / 2} y1={0.5 - Math.sin(a) / 2} x2={0.5 + Math.cos(a) / 2} y2={0.5 + Math.sin(a) / 2}>{stops}</linearGradient>);
    fill = `url(#${id}-g)`;
  }
  let node: ReactNode = drawItem(s, fill, guides);
  const list = s.fx?.list ?? [];
  const clock = s.fx?.clock ?? 0;

  const chain = list.filter((e) => e.kind === 'blur' || e.kind === 'glow' || e.kind === 'shadow');
  if (chain.length) {
    const prims: ReactNode[] = [];
    let last = 'SourceGraphic';
    chain.forEach((e, i) => {
      if (e.kind === 'blur') {
        prims.push(<feGaussianBlur key={i} in={last} stdDeviation={param(e, 'radius', 4) / 2} result={`b${i}`} />);
        last = `b${i}`;
      } else if (e.kind === 'glow') {
        const c = e.color ?? { r: 140, g: 200, b: 255, a: 1 };
        prims.push(
          <Fragment key={i}>
            <feGaussianBlur in={last} stdDeviation={param(e, 'radius', 16) / 2} result={`gb${i}`} />
            <feFlood floodColor={cssColor({ ...c, a: 1 })} floodOpacity={Math.min(1, c.a * param(e, 'strength', 1))} result={`gc${i}`} />
            <feComposite in={`gc${i}`} in2={`gb${i}`} operator="in" result={`gg${i}`} />
            <feMerge result={`g${i}`}><feMergeNode in={`gg${i}`} />{param(e, 'strength', 1) > 1 && <feMergeNode in={`gg${i}`} />}<feMergeNode in={last} /></feMerge>
          </Fragment>,
        );
        last = `g${i}`;
      } else {
        const c = e.color ?? { r: 0, g: 0, b: 0, a: 1 };
        prims.push(<feDropShadow key={i} in={last} dx={param(e, 'x', 0)} dy={param(e, 'y', 12)} stdDeviation={param(e, 'blur', 10) / 2}
          floodColor={cssColor({ ...c, a: 1 })} floodOpacity={param(e, 'opacity', 0.35)} result={`s${i}`} />);
        last = `s${i}`;
      }
    });
    defs.push(<filter key="f" id={`${id}-f`} x="-100%" y="-100%" width="300%" height="300%">{prims}</filter>);
    node = <g filter={`url(#${id}-f)`}>{node}</g>;
  }

  const split = list.find((e) => e.kind === 'rgbSplit');
  if (split && param(split, 'amount', 6) > 0.01) {
    const a = (param(split, 'angle', 0) * Math.PI) / 180, amt = param(split, 'amount', 6);
    const dx = Math.cos(a) * amt, dy = Math.sin(a) * amt;
    defs.push(
      <filter key="r" id={`${id}-r`}><feColorMatrix values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>,
      <filter key="c" id={`${id}-c`}><feColorMatrix values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" /></filter>,
    );
    node = (
      <g>
        <g transform={`translate(${-dx} ${-dy})`} filter={`url(#${id}-r)`} style={{ mixBlendMode: 'screen' }}>{node}</g>
        <g transform={`translate(${dx} ${dy})`} filter={`url(#${id}-c)`} style={{ mixBlendMode: 'screen' }}>{node}</g>
        <g opacity={0.55}>{node}</g>
      </g>
    );
  }

  const slices = list.find((e) => e.kind === 'slices');
  if (slices && param(slices, 'amount', 24) > 0.01) {
    const n = Math.max(2, Math.round(param(slices, 'bands', 10)));
    // bands on a screen-wide grid, not per layer: a mascot and its eyes tear along the same lines
    const r = Math.hypot(s.w, s.h) / 2 + 40, band = 900 / n, first = Math.floor((s.cy - r) / band), last = Math.ceil((s.cy + r) / band);
    const step = Math.floor((clock / 1000) * param(slices, 'rate', 12)), seed = param(slices, 'seed', 1);
    const bands: ReactNode[] = [];
    for (let b = first; b < last; b++) {
      const shove = hash01(step, seed, b) < 0.45 ? (hash01(step, seed, b, 9) - 0.5) * 2 * param(slices, 'amount', 24) : 0;
      defs.push(<clipPath key={`s${b}`} id={`${id}-s${b}`}><rect x={s.cx - r - 200} y={b * band} width={2 * r + 400} height={band + 0.5} /></clipPath>);
      bands.push(<g key={b} clipPath={`url(#${id}-s${b})`}><g transform={`translate(${shove} 0)`}>{node}</g></g>);
    }
    node = <g>{bands}</g>;
  }

  const lines = list.find((e) => e.kind === 'scanlines');
  if (lines && param(lines, 'opacity', 0.3) > 0.005) {
    const sp = Math.max(2, param(lines, 'spacing', 4)), r = Math.hypot(s.w, s.h) / 2 + 20;
    defs.push(
      <pattern key="p" id={`${id}-p`} width={4} height={sp} patternUnits="userSpaceOnUse"><rect width={4} height={sp / 2} fill="#000" /></pattern>,
      <filter key="w" id={`${id}-w`}><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" /></filter>,
      <mask key="m" id={`${id}-m`}><g filter={`url(#${id}-w)`}>{node}</g></mask>,
    );
    node = (
      <g>
        {node}
        <rect x={s.cx - r} y={s.cy - r} width={2 * r} height={2 * r} fill={`url(#${id}-p)`} opacity={param(lines, 'opacity', 0.3)} mask={`url(#${id}-m)`} />
      </g>
    );
  }

  const style = s.blend && BLEND[s.blend] ? { mixBlendMode: BLEND[s.blend] as React.CSSProperties['mixBlendMode'] } : undefined;
  let clip: string | undefined, mask: string | undefined;
  if (s.clip) {
    if (s.clip.invert) {
      defs.push(<mask key="k" id={`${id}-k`} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
        <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="#fff" /><path d={s.clip.d} fill="#000" /></mask>);
      mask = `url(#${id}-k)`;
    } else {
      defs.push(<clipPath key="k" id={`${id}-k`}><path d={s.clip.d} /></clipPath>);
      clip = `url(#${id}-k)`;
    }
  }
  if (!defs.length && !style) return node;
  return (
    <g style={style} clipPath={clip} mask={mask}>
      {defs.length > 0 && <defs>{defs}</defs>}
      {node}
    </g>
  );
}

/**
 * The one renderer. Stage, block thumbnails, preset glyphs and every raster export draw
 * through it. `guides` draws the layers marked as guides — only the stage passes it, so a
 * guide is never in a thumbnail or an export.
 *
 * Layers in the same goo composite are drawn together, inside one filter that melts them into
 * each other where they touch, at the place the first of them comes in the draw order.
 */
export function Shapes({ scene, guides = false }: { scene: SceneItem[]; guides?: boolean }) {
  // ids unique to this drawing: the stage and every thumbnail on the page each have their own filters
  const uid = `s${useId().replace(/[^\w-]/g, '')}`;
  const gooDone = new Set<string>();
  return (
    <>
      {scene.map((s) => {
        if (s.guide && !guides) return null;
        if (s.goo) {
          if (gooDone.has(s.goo.id)) return null;
          gooDone.add(s.goo.id);
          const members = scene.filter((m) => m.goo?.id === s.goo!.id && !(m.guide && !guides));
          const gid = `${uid}goo${s.goo.id.replace(/[^\w-]/g, '_')}`;
          const r = s.goo.radius;
          return (
            <g key={`goo:${s.goo.id}`}>
              <defs>
                <filter id={gid} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation={r / 2} result="b" />
                  <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
                  <feComposite in="SourceGraphic" in2="goo" operator="atop" />
                </filter>
              </defs>
              <g filter={`url(#${gid})`}>
                {members.map((m) => <Fragment key={m.id}>{withEffects({ ...m, goo: undefined }, uid, guides)}</Fragment>)}
              </g>
            </g>
          );
        }
        return <Fragment key={s.id}>{withEffects(s, uid, guides)}</Fragment>;
      })}
    </>
  );
}

/** A frame in composition coordinates. */
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** What one frame occupies. Null for an empty scene. */
export function sceneBounds(scene: SceneItem[]): Bounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of scene) {
    const r = Math.hypot(s.w, s.h) / 2; // rotation-proof enough for a thumbnail
    x0 = Math.min(x0, s.cx - r); x1 = Math.max(x1, s.cx + r);
    y0 = Math.min(y0, s.cy - r); y1 = Math.max(y1, s.cy + r);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export const unionBounds = (a: Bounds | null, b: Bounds | null): Bounds | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

/**
 * Fits the rig to its own bounds instead of the whole composition, so a 40px preset
 * glyph is a portrait rather than a speck in a black field.
 *
 * `box` pins that frame. Refitting every frame is right for a still, and wrong the moment
 * anything moves: as an emitter throws particles the bounds grow, so the viewBox grows,
 * so the mascot slides and shrinks — it reads as the character backing away rather than
 * as confetti rising. Anything that plays an animation passes the union of the whole
 * loop's bounds instead, computed once.
 */
export function MascotThumb({ scene, view, className, pad = 14, box }: {
  scene: SceneItem[]; view: { width: number; height: number }; className?: string;
  pad?: number; box?: Bounds | null;
}) {
  const b = box ?? sceneBounds(scene) ?? { x0: 0, y0: 0, x1: view.width, y1: view.height };
  const viewBox = `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`;
  return (
    <svg className={className} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <Shapes scene={scene} />
    </svg>
  );
}
