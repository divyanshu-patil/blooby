import type { SceneItem } from '../core/scene';
import { cssColor } from '../core/color';

/** The one renderer. Stage, block thumbnails and preset glyphs all draw through it. */
export function Shapes({ scene }: { scene: SceneItem[] }) {
  return (
    <>
      {scene.map((s) => {
        const spin = s.rotation ? `rotate(${s.rotation} ${s.cx} ${s.cy})` : undefined;
        if (s.svg) {
          return (
            <g key={s.id} transform={`${spin ?? ''} translate(${s.cx - s.w / 2} ${s.cy - s.h / 2})`}>
              <svg width={s.w} height={s.h} viewBox={s.svg.viewBox} overflow="visible"
                dangerouslySetInnerHTML={{ __html: s.svg.sourceMarkup }} />
            </g>
          );
        }
        if (s.shape === 'ellipse') {
          return <ellipse key={s.id} cx={s.cx} cy={s.cy} rx={Math.max(s.w, 0) / 2} ry={Math.max(s.h, 0) / 2}
            fill={cssColor(s.color)} transform={spin} />;
        }
        const w = Math.max(s.w, 0.001), h = Math.max(s.h, 0.001);
        return <rect key={s.id} x={s.cx - w / 2} y={s.cy - h / 2} width={w} height={h}
          rx={Math.min(w, h) / 2} ry={Math.min(w, h) / 2} fill={cssColor(s.color)} transform={spin} />;
      })}
    </>
  );
}

/** Fits the rig into a box — used for every thumbnail in the app. */
export function MascotThumb({ scene, view, className }: { scene: SceneItem[]; view: { width: number; height: number }; className?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <Shapes scene={scene} />
    </svg>
  );
}
