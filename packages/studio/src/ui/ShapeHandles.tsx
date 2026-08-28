import { useCallback } from 'react';
import { movePathAnchor, pathAnchors } from '../core/path';
import { useEditor } from '../core/store';
import type { SceneItem } from '../core/scene';
import type { Vec2 } from '../core/types';

/**
 * The selected layer's outline, as points you can drag.
 *
 * A primitive's dials only reach the shapes the generator can make; this is how you get
 * anything else — pull a circle into an egg, drag a star's arm out. Dragging an anchor
 * carries its control handles with it, so curvature survives the edit rather than
 * collapsing to straight lines.
 *
 * Editing by hand drops the primitive's dials, because they no longer describe the shape:
 * the editor shows "custom" from then on.
 */
export function ShapeHandles({ nodeId, item, path, toComp }: {
  nodeId: string;
  /** the layer's drawn box, which is the frame the -0.5..0.5 outline is scaled into */
  item: SceneItem;
  path: string;
  toComp: (e: { clientX: number; clientY: number }) => Vec2;
}) {
  const setValue = useEditor((s) => s.setValue);
  const updateNode = useEditor((s) => s.updateNode);

  const anchors = pathAnchors(path);
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const w = Math.max(Math.abs(item.w), 0.001), h = Math.max(Math.abs(item.h), 0.001);

  // the outline is authored in a unit box, scaled to w/h and turned by the layer's roll
  const toScreen = (p: Vec2): Vec2 => {
    const x = p.x * w, y = p.y * h;
    return { x: item.cx + x * cos - y * sin, y: item.cy + x * sin + y * cos };
  };
  const toLocal = (s: Vec2): Vec2 => {
    const x = s.x - item.cx, y = s.y - item.cy;
    return { x: (x * cos + y * sin) / w, y: (-x * sin + y * cos) / h };
  };

  const drag = useCallback((index: number) => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    // the dials described a star, not whatever this is about to become
    updateNode(nodeId, (n) => { n.shape = undefined; });
    const move = (ev: PointerEvent) => {
      const local = toLocal(toComp(ev));
      setValue(nodeId, 'shape.path', movePathAnchor(path, index, local), `shapepoint.${nodeId}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // path is captured per render, which is what we want: each pointerdown starts from
    // the outline as it currently stands rather than from a stale copy
  }, [nodeId, path, setValue, toComp, updateNode, toLocal]);

  return (
    <g className="shapepts">
      {anchors.map((p, i) => {
        const s = toScreen(p);
        return <circle key={i} cx={s.x} cy={s.y} r={4.5} pointerEvents="all" onPointerDown={drag(i)} />;
      })}
    </g>
  );
}
