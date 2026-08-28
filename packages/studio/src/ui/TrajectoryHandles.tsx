import { useCallback } from 'react';
import { emitterFrame, type SceneItem, type Viewport } from '../core/scene';
import { useEditor } from '../core/store';
import { cssColor } from '../core/color';
import type { Emitter, Rig, Vec2 } from '../core/types';

/**
 * The trajectory an emitter follows, drawn on the stage and draggable.
 *
 * An emitter is otherwise a dozen numbers with no way to tell what they aim at. This is
 * the arrow: a start dot, an end dot, the bow that bends the path between them, and a knob
 * on the path where the particles begin to fade. For an orbit it becomes the ellipse
 * instead, with one handle sizing it.
 *
 * Positions come from `emitterFrame`, the same mapping `emitterItems` uses, so a handle
 * lands exactly where the stream comes out rather than near it.
 */
export function TrajectoryHandles({ emitter, rig, scene, view, toComp }: {
  emitter: Emitter;
  rig: Rig;
  scene: SceneItem[];
  view: Viewport;
  toComp: (e: { clientX: number; clientY: number }) => Vec2;
}) {
  const updateEmitter = useEditor((s) => s.updateEmitter);
  const f = emitterFrame(rig, scene, view);
  const a = f.anchor(emitter.from);
  const b = f.anchor(emitter.to);
  const stroke = cssColor({ ...emitter.color, a: 1 });

  const dragEnd = useCallback((end: 'from' | 'to') => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const move = (ev: PointerEvent) => {
      const at = toComp(ev);
      updateEmitter(emitter.id, (x) => {
        const o = f.toOffset(x[end], at);
        x[end] = { ...x[end], x: Math.round(o.x), y: Math.round(o.y) };
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [emitter.id, f, toComp, updateEmitter]);

  // the fade knob rides the straight line between the ends — dragging it along projects
  // onto that line, so it cannot be pulled off the path it is describing
  const dragFade = useCallback((down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const move = (ev: PointerEvent) => {
      const at = toComp(ev);
      const t = ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2;
      updateEmitter(emitter.id, (x) => { x.fadeStart = Math.max(0, Math.min(1, Math.round(t * 100) / 100)); });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [a.x, a.y, b.x, b.y, emitter.id, toComp, updateEmitter]);

  const dragRadius = useCallback((down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const move = (ev: PointerEvent) => {
      const at = toComp(ev);
      updateEmitter(emitter.id, (x) => {
        x.radiusX = Math.max(6, Math.round(Math.abs(at.x - a.x) / f.unit));
        x.radiusY = Math.max(4, Math.round(Math.abs(at.y - a.y) / f.unit));
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [a.x, a.y, emitter.id, f.unit, toComp, updateEmitter]);

  if (emitter.path === 'orbit') {
    const rx = (emitter.radiusX ?? Math.hypot(b.x - a.x, b.y - a.y) / f.unit) * f.unit;
    const ry = (emitter.radiusY ?? emitter.radiusX ?? Math.hypot(b.x - a.x, b.y - a.y) / f.unit) * f.unit;
    return (
      <g className="traj">
        <ellipse cx={a.x} cy={a.y} rx={rx} ry={ry} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="5 5" opacity={0.8} />
        <circle className="traj-dot" cx={a.x} cy={a.y} r={6} fill={stroke}
          pointerEvents="all" onPointerDown={dragEnd('from')} />
        <circle className="traj-dot" cx={a.x + rx} cy={a.y} r={5.5} fill="var(--paper)" stroke={stroke} strokeWidth={2}
          pointerEvents="all" onPointerDown={dragRadius} />
        <text x={a.x} y={a.y - ry - 9} textAnchor="middle" className="traj-label" fill={stroke}>{emitter.name}</text>
      </g>
    );
  }

  // a quadratic whose control point sits at the bow, so the drawn curve is the path the
  // particles actually take rather than an idealised straight line between the dots
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = emitter.bow * f.unit * 2;
  const cx = mx + (-dy / len) * bow, cy = my + (dx / len) * bow;
  const fade = { x: a.x + dx * emitter.fadeStart, y: a.y + dy * emitter.fadeStart };

  return (
    <g className="traj">
      <path d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`} fill="none" stroke={stroke} strokeWidth={1.25}
        strokeDasharray="5 5" opacity={0.85} markerEnd="url(#traj-arrow)" />
      <defs>
        <marker id="traj-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 7 4 L 0 7 z" fill={stroke} />
        </marker>
      </defs>
      <circle className="traj-dot" cx={fade.x} cy={fade.y} r={4.5} fill="var(--paper)" stroke={stroke} strokeWidth={2}
        pointerEvents="all" onPointerDown={dragFade}>
        <title>Fade starts here ({Math.round(emitter.fadeStart * 100)}% of the way)</title>
      </circle>
      <circle className="traj-dot" cx={a.x} cy={a.y} r={6} fill={stroke}
        pointerEvents="all" onPointerDown={dragEnd('from')}>
        <title>Start{emitter.from.nodeId ? ` — pinned to ${rig.nodes[emitter.from.nodeId]?.name ?? emitter.from.nodeId}` : ''}</title>
      </circle>
      <circle className="traj-dot" cx={b.x} cy={b.y} r={6} fill="var(--paper)" stroke={stroke} strokeWidth={2.5}
        pointerEvents="all" onPointerDown={dragEnd('to')}>
        <title>End{emitter.to.nodeId ? ` — pinned to ${rig.nodes[emitter.to.nodeId]?.name ?? emitter.to.nodeId}` : ''}</title>
      </circle>
      <text x={b.x} y={b.y - 12} textAnchor="middle" className="traj-label" fill={stroke}>{emitter.name}</text>
    </g>
  );
}
