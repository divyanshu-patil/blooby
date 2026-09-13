import { useEffect, useState } from 'react';
import { useEditor } from '../core/store';
import { curveFromPath, insertPoint, moveAnchor, moveHandle, nearestOnCurve, removePoint } from '../core/curve';
import type { SceneItem } from '../core/scene';
import type { RigNode, Vec2 } from '../core/types';

/**
 * A drawn curve's points, on the stage, as the anchors of its path.
 *
 * Drag a point to move it. Click one and press Delete to remove it. Double-click the line
 * to put a new one there. A Bézier curve also shows its handles: dragging one turns its
 * partner to keep the point smooth, and Alt breaks the pair into a corner. A smooth curve
 * shows only its points — its handles are worked out, so there is nothing to fiddle with.
 */
export function CurveHandles({ node, item, toComp }: {
  node: RigNode; item: SceneItem; toComp: (e: { clientX: number; clientY: number }) => Vec2;
}) {
  const editCurve = useEditor((s) => s.editCurve);
  const [picked, setPicked] = useState<number | null>(null);
  const c = curveFromPath(item.path);
  const type = node.curve?.type ?? 'bezier';

  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const w = Math.max(Math.abs(item.w), 0.001), h = Math.max(Math.abs(item.h), 0.001);
  const toScreen = (p: Vec2): Vec2 => ({ x: item.cx + p.x * w * cos - p.y * h * sin, y: item.cy + p.x * w * sin + p.y * h * cos });
  const toLocal = (s: Vec2): Vec2 => {
    const x = s.x - item.cx, y = s.y - item.cy;
    return { x: (x * cos + y * sin) / w, y: (-x * sin + y * cos) / h };
  };

  // Delete removes the picked POINT — before the editor's own Delete removes the whole layer
  useEffect(() => {
    if (picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.key === 'Escape') { setPicked(null); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      editCurve(node.id, (cv) => removePoint(cv, picked), `rmpt.${node.id}`);
      setPicked(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picked, node.id, editCurve]);

  if (!c) return null;

  const drag = (move: (local: Vec2, ev: PointerEvent) => void) => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const onMove = (ev: PointerEvent) => move(toLocal(toComp(ev)), ev);
    const up = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  };

  const line = c.points.map((p) => toScreen(p));
  return (
    <g className="curve-edit">
      {/* the line itself, thick and invisible, so a double-click anywhere on it inserts */}
      <g transform={`translate(${item.cx} ${item.cy}) rotate(${item.rotation}) scale(${w} ${h})`}>
        <path d={item.path} className="curve-hit" vectorEffect="non-scaling-stroke"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            const at = nearestOnCurve(c, type, toLocal(toComp(e)));
            if (!at) return;
            editCurve(node.id, (cv) => insertPoint(cv, type, at.seg, at.t), `addpt.${node.id}`);
            setPicked(at.seg + 1);
          }} />
      </g>
      {type === 'bezier' && c.points.map((p, i) => (['in', 'out'] as const).map((which) => {
        const hd = which === 'in' ? p.hin : p.hout;
        if (!hd) return null;
        const a = line[i], b = toScreen({ x: p.x + hd.x, y: p.y + hd.y });
        return (
          <g key={`${i}${which}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="curve-arm" />
            <circle cx={b.x} cy={b.y} r={4} className="curve-handle"
              onPointerDown={drag((local, ev) => editCurve(node.id, (cv) => moveHandle(cv, i, which, local, ev.altKey), `curvehandle.${node.id}`))}>
              <title>Drag to curve · Alt to break the pair</title>
            </circle>
          </g>
        );
      }))}
      {line.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={i === 0 ? 6 : 5} className="curve-pt" data-picked={picked === i || undefined} data-first={i === 0 || undefined}
          onPointerDown={(e) => { setPicked(i); drag((local) => editCurve(node.id, (cv) => moveAnchor(cv, i, local), `curvept.${node.id}`))(e); }}>
          <title>{i === 0 ? 'Start — ' : ''}Drag to move · Delete to remove</title>
        </circle>
      ))}
    </g>
  );
}
