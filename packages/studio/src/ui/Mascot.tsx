import type { SceneItem } from '../core/scene';
import { cssColor } from '../core/color';
import { cssFamily, glyphOutline } from '../core/fonts';

/** A layer's outline attributes — screen px, so they read the same at any layer size. */
const strokeOf = (st: SceneItem['stroke']) => (st && st.width > 0
  ? { stroke: cssColor(st.color), strokeWidth: st.width, strokeLinecap: st.cap, strokeLinejoin: st.join }
  : {});

/**
 * The one renderer. Stage, block thumbnails, preset glyphs and every raster export draw
 * through it. `guides` draws the layers marked as guides — only the stage passes it, so a
 * guide is never in a thumbnail or an export.
 */
export function Shapes({ scene, guides = false }: { scene: SceneItem[]; guides?: boolean }) {
  return (
    <>
      {scene.map((s) => {
        if (s.guide && !guides) return null;
        const spin = s.rotation ? `rotate(${s.rotation} ${s.cx} ${s.cy})` : undefined;
        // a text layer: each glyph its real outline from the font file, so what is drawn here
        // is the vector the export writes. Until the face arrives, the letter as text.
        if (s.glyphs && s.font) {
          const f = s.font;
          const fill = cssColor(s.color);
          const st = strokeOf(s.stroke);
          return (
            <g key={s.id} transform={`translate(${s.cx} ${s.cy})${s.rotation ? ` rotate(${s.rotation})` : ''}`}>
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
            <g key={s.id} transform={`${spin ?? ''} translate(${s.cx} ${s.cy}) scale(${w} ${h})`}>
              {s.paths.map((p, i) => {
                const fill = p.fill === null ? 'none' : p.fill ? cssColor({ ...p.fill, a: p.fill.a * alpha }) : cssColor(s.color);
                const own = p.stroke ? { color: { ...p.stroke, a: p.stroke.a * alpha }, width: (p.strokeWidth ?? 0) * size } : null;
                const layer = p.stroke === undefined && s.stroke ? { color: s.stroke.color, width: p.strokeWidth ? p.strokeWidth * size : s.stroke.width } : null;
                const st = own ?? layer;
                return (
                  <path key={i} d={p.d} fill={fill} fillRule={p.evenOdd ? 'evenodd' : undefined} vectorEffect="non-scaling-stroke"
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
            <g key={s.id} transform={`${spin ?? ''} translate(${s.cx - s.w / 2} ${s.cy - s.h / 2})`}
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
          return (
            <g key={s.id} transform={`${spin ?? ''} translate(${s.cx} ${s.cy}) scale(${w} ${h})`}>
              {/* a guide is dashed: it is there to work with, and will not be exported */}
              <path d={s.path} fill={cssColor(s.color)} vectorEffect="non-scaling-stroke" {...strokeOf(s.stroke)}
                {...(s.guide ? { strokeDasharray: '7 6', opacity: 0.8 } : {})} />
            </g>
          );
        }
        if (s.text !== undefined) {
          // dominantBaseline centres the glyph on cy, so an emitter's path math is about
          // the particle's middle rather than wherever a font happens to sit its baseline
          return (
            <text key={s.id} x={s.cx} y={s.cy} fontSize={s.h} fill={cssColor(s.color)}
              textAnchor="middle" dominantBaseline="central" transform={spin}
              style={{ userSelect: 'none' }}>{s.text}</text>
          );
        }
        if (s.shape === 'ellipse') {
          return <ellipse key={s.id} cx={s.cx} cy={s.cy} rx={Math.max(s.w, 0) / 2} ry={Math.max(s.h, 0) / 2}
            fill={cssColor(s.color)} transform={spin} {...strokeOf(s.stroke)} />;
        }
        const w = Math.max(s.w, 0.001), h = Math.max(s.h, 0.001);
        return <rect key={s.id} x={s.cx - w / 2} y={s.cy - h / 2} width={w} height={h}
          rx={Math.min(w, h) / 2} ry={Math.min(w, h) / 2} fill={cssColor(s.color)} transform={spin} {...strokeOf(s.stroke)} />;
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
