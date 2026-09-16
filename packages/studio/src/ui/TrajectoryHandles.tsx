import { useCallback, useState } from 'react';
import { emitterFrame, emitterPathAt, type SceneItem, type Viewport } from '../core/scene';
import { applyEasing } from '../core/easing';
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
  const [snap, setSnap] = useState<SnapTarget | null>(null);
  const f = emitterFrame(rig, scene, view);
  // every point an endpoint can latch onto: each drawn layer's centre and eight points
  // round its edge. Latching stores the offset in half-widths, so it rides that layer.
  const targets = snapTargets(scene, rig.rootId);
  const a = f.anchor(emitter.from);
  const b = f.anchor(emitter.to);
  const stroke = cssColor({ ...emitter.color, a: 1 });

  const dragEnd = useCallback((end: 'from' | 'to') => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const move = (ev: PointerEvent) => {
      const at = toComp(ev);
      const near = nearest(targets, at, SNAP_PX);
      setSnap(near);
      updateEmitter(emitter.id, (x) => {
        if (near) {
          // snapping IS parenting: the offset is stored in the layer's own half-widths,
          // so the point follows it when it scales rather than staying where the edge was
          x[end] = { nodeId: near.nodeId, x: near.u, y: near.v, rel: true };
          return;
        }
        const free = { ...x[end], rel: undefined };
        const o = f.toOffset(free, at);
        x[end] = { ...free, x: Math.round(o.x), y: Math.round(o.y) };
      });
    };
    const up = () => {
      setSnap(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [emitter.id, f, targets, toComp, updateEmitter]);

  // the fade knob rides the particles' own path: dragging picks the point of the life whose
  // position on that path is nearest the pointer, so it cannot be pulled off what it describes
  const dragFade = useCallback((down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const move = (ev: PointerEvent) => {
      const at = toComp(ev);
      let best = 0, bestD = Infinity;
      for (let k = 0; k <= 100; k++) {
        const u = k / 100, travel = emitter.easing ? applyEasing(emitter.easing, u) : u;
        const q = emitterPathAt(emitter, a, b, f.unit, travel);
        const d = Math.hypot(q.x - at.x, q.y - at.y);
        if (d < bestD) { bestD = d; best = u; }
      }
      updateEmitter(emitter.id, (x) => { x.fadeStart = best; });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [a, b, emitter, f.unit, toComp, updateEmitter]);

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
        {snap && <SnapRing target={snap} />}
        <ellipse cx={a.x} cy={a.y} rx={rx} ry={ry} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="5 5" opacity={0.8}
          transform={emitter.orbitTilt ? `rotate(${emitter.orbitTilt} ${a.x} ${a.y})` : undefined} />
        <circle className="traj-dot" cx={a.x} cy={a.y} r={6} fill={stroke}
          pointerEvents="all" onPointerDown={dragEnd('from')} />
        <circle className="traj-dot" cx={a.x + rx} cy={a.y} r={5.5} fill="var(--paper)" stroke={stroke} strokeWidth={2}
          transform={emitter.orbitTilt ? `rotate(${emitter.orbitTilt} ${a.x} ${a.y})` : undefined}
          pointerEvents="all" onPointerDown={dragRadius} />
        <text x={a.x} y={a.y - ry - 9} textAnchor="middle" className="traj-label" fill={stroke}>{emitter.name}</text>
      </g>
    );
  }

  // sampled from the particles' own path function, so the drawn curve IS the path they take —
  // an arc bent by its bow, or a fall's gravity curve with its outer lanes either side
  const along = (lane: number) => {
    const pts = Array.from({ length: 33 }, (_, k) => emitterPathAt(emitter, a, b, f.unit, k / 32, lane));
    return `M ${pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L ')}`;
  };
  const travelAt = (u: number) => (emitter.easing ? applyEasing(emitter.easing, u) : u);
  const fade = emitterPathAt(emitter, a, b, f.unit, travelAt(emitter.fadeStart));

  return (
    <g className="traj">
      {/* the outline being latched onto, so it is obvious what the point is about to
          belong to rather than only obvious afterwards */}
      {snap && <SnapRing target={snap} />}
      <path d={along(0)} fill="none" stroke={stroke} strokeWidth={1.25}
        strokeDasharray="5 5" opacity={0.85} markerEnd="url(#traj-arrow)" />
      {emitter.path === 'fall' && emitter.bow !== 0 && [-0.5, 0.5].map((lane) => (
        <path key={lane} d={along(lane)} fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="2 6" opacity={0.45} />
      ))}
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

/* ---- snapping -------------------------------------------------------------- */

/** How close the pointer has to get before an endpoint latches on. */
const SNAP_PX = 20;

interface SnapTarget {
  nodeId: string;
  /** in the layer's own half-widths: (0,0) centre, (1,0) right edge */
  u: number; v: number;
  x: number; y: number;
  /** the layer's drawn box, for the ring that highlights it */
  cx: number; cy: number; w: number; h: number; rotation: number;
}

/**
 * Every point an endpoint can latch onto.
 *
 * Each drawn layer contributes its centre and eight points round its edge — enough that
 * "the bottom of the eye" and "the left side of the body" are both reachable without
 * offering so many that the pointer snaps to something it did not mean.
 *
 * Emitter particles are excluded: latching a stream onto one of its own particles would
 * be a loop, and they are not part of the rig anyway.
 */
function snapTargets(scene: SceneItem[], rootId: string): SnapTarget[] {
  const out: SnapTarget[] = [];
  for (const item of scene) {
    if (item.id.includes('#')) continue;                  // an emitter particle
    const rx = item.w / 2, ry = item.h / 2;
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) continue;
    const spots: [number, number][] = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7]];
    // the body's edge points are useful, its centre less so — it is where everything
    // already defaults to, and it would shadow a small feature sitting on top of it
    for (const [u, v] of spots) {
      if (item.id === rootId && u === 0 && v === 0) continue;
      out.push({
        nodeId: item.id, u, v,
        x: item.cx + u * rx, y: item.cy + v * ry,
        cx: item.cx, cy: item.cy, w: item.w, h: item.h, rotation: item.rotation,
      });
    }
  }
  return out;
}

function nearest(targets: SnapTarget[], at: Vec2, within: number): SnapTarget | null {
  let best: SnapTarget | null = null, bestD = within;
  for (const t of targets) {
    const d = Math.hypot(t.x - at.x, t.y - at.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function SnapRing({ target }: { target: SnapTarget }) {
  return (
    <g pointerEvents="none" className="snap">
      <rect x={target.cx - target.w / 2 - 4} y={target.cy - target.h / 2 - 4}
        width={target.w + 8} height={target.h + 8} rx={Math.min(target.w, target.h) / 2 + 4}
        transform={`rotate(${target.rotation} ${target.cx} ${target.cy})`} />
      <circle cx={target.x} cy={target.y} r={5} />
    </g>
  );
}
