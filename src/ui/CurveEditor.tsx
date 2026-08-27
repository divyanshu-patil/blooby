import { useEffect, useRef, useState } from 'react';
import { applyEasing, curveHandles, EASING_NAMES, easingLabel, namedEasing } from '../core/easing';
import type { EasingCurve, Vec2 } from '../core/types';

const SIZE = 168;
const PAD = 12;
// bezier control points sit in 0..1 x, but y can swing past that (ease-out overshoot,
// elastic) — give the graph room to show it instead of clipping the handle off-canvas.
const Y_LO = -0.5, Y_HI = 1.5;
const toX = (x: number) => PAD + x * (SIZE - PAD * 2);
const toY = (y: number) => SIZE - PAD - ((y - Y_LO) / (Y_HI - Y_LO)) * (SIZE - PAD * 2);
const fromPx = (px: number, py: number): Vec2 => ({
  x: Math.min(1, Math.max(0, (px - PAD) / (SIZE - PAD * 2))),
  y: Y_LO + ((SIZE - PAD - py) / (SIZE - PAD * 2)) * (Y_HI - Y_LO),
});

const PREVIEW_MS = 1000, PREVIEW_PAUSE_MS = 450;

/**
 * One curve-editing widget, reused for both keyframe easing and (once clip transitions
 * exist) transition curves — the spec is explicit two implementations must not exist.
 * Presets are one click; dragging either handle always converts to a custom bezier
 * (a preset's own handles become the starting point, same stand-in GraphEditor already
 * draws for bounce/elastic). The lane under the graph previews the *actual* eased motion
 * a keyframe or transition would produce — driven by the same applyEasing() everything
 * else in the app uses, not a CSS approximation, so bounce/elastic read correctly too.
 */
export function CurveEditor({ value, onChange }: { value: EasingCurve; onChange: (c: EasingCurve) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<'p1' | 'p2' | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const cycle = PREVIEW_MS + PREVIEW_PAUSE_MS;
    const tick = (now: number) => {
      setT(Math.min(1, ((now - start) % cycle) / PREVIEW_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [p1, p2] = curveHandles(value);

  const setHandle = (which: 'p1' | 'p2', p: Vec2) => {
    const [cp1, cp2] = curveHandles(value);
    onChange({ type: 'bezier', p1: which === 'p1' ? p : cp1, p2: which === 'p2' ? p : cp2 });
  };

  const atPointer = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return fromPx(((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE);
  };

  const onDown = (which: 'p1' | 'p2') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = which;
    setHandle(which, atPointer(e));
  };
  const onMove = (e: React.PointerEvent) => { if (drag.current) setHandle(drag.current, atPointer(e)); };
  const onUp = () => { drag.current = null; };

  let d = '';
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const v = applyEasing(value, u);
    d += `${i === 0 ? 'M' : 'L'}${toX(u)},${toY(v)} `;
  }

  const dotX = Math.min(1, Math.max(0, applyEasing(value, t)));

  return (
    <div className="flex w-[212px] flex-col gap-2.5 rounded-lg border border-line-soft bg-panel p-2.5 shadow-lg">
      <div className="flex flex-wrap gap-1">
        {EASING_NAMES.map((n) => (
          <button key={n}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${easingLabel(value) === n
              ? 'bg-ink text-paper' : 'bg-field text-ink-2 hover:bg-line-soft'}`}
            onClick={() => onChange(namedEasing(n))}>
            {n}
          </button>
        ))}
        <button className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${value.type === 'bezier' ? 'bg-signal text-white' : 'bg-field text-muted'}`}
          title="Drag a handle below to create a custom curve" disabled>
          custom
        </button>
      </div>

      <svg ref={svg} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="cursor-crosshair rounded-md border border-line-soft bg-field"
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {/* the valid 0..1/0..1 cell, so overshoot outside it reads as overshoot */}
        <rect x={toX(0)} y={toY(1)} width={toX(1) - toX(0)} height={toY(0) - toY(1)} fill="rgba(34,51,224,.05)" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(1)} y2={toY(0)} stroke="var(--line)" strokeWidth={1} />
        <line x1={toX(0)} y1={toY(1)} x2={toX(1)} y2={toY(1)} stroke="var(--line)" strokeWidth={1} />
        <line x1={toX(0)} y1={toY(0)} x2={toX(0)} y2={toY(1)} stroke="var(--line)" strokeWidth={1} />
        <line x1={toX(1)} y1={toY(0)} x2={toX(1)} y2={toY(1)} stroke="var(--line)" strokeWidth={1} />

        <path d={d} fill="none" stroke="var(--signal)" strokeWidth={1.75} />

        <line x1={toX(0)} y1={toY(0)} x2={toX(p1.x)} y2={toY(p1.y)} stroke="rgba(23,22,27,.35)" strokeWidth={1} />
        <line x1={toX(1)} y1={toY(1)} x2={toX(p2.x)} y2={toY(p2.y)} stroke="rgba(23,22,27,.35)" strokeWidth={1} />
        <circle cx={toX(p1.x)} cy={toY(p1.y)} r={6} fill="#fff" stroke="var(--signal)" strokeWidth={1.75}
          style={{ cursor: 'grab' }} onPointerDown={onDown('p1')} />
        <circle cx={toX(p2.x)} cy={toY(p2.y)} r={6} fill="#fff" stroke="var(--signal)" strokeWidth={1.75}
          style={{ cursor: 'grab' }} onPointerDown={onDown('p2')} />

        <circle cx={toX(0)} cy={toY(0)} r={2.5} fill="var(--ink)" />
        <circle cx={toX(1)} cy={toY(1)} r={2.5} fill="var(--ink)" />
      </svg>

      <div className="flex items-center gap-2">
        <div className="relative h-5 flex-1 rounded-full border border-line-soft bg-field">
          <div className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-signal shadow"
            style={{ left: `calc(${dotX * 100}% - ${dotX * 10}px)` }} />
        </div>
        <button className="text-[10px] font-medium text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          onClick={() => onChange({ type: 'linear' })}>
          Reset
        </button>
      </div>
    </div>
  );
}
