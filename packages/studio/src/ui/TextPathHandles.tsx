import { useEditor } from '../core/store';
import { mapPath, pathAnchors, pathFromPoints, pathSampler, primitivePath, type PathSampler } from '../core/path';
import { arcSampler, layoutLines, TEXT_DEFAULTS } from '../core/text';
import { metricsFor } from '../core/fonts';
import type { LayerFrame, SceneItem } from '../core/scene';
import type { RigNode, Vec2 } from '../core/types';

const CIRCLE = primitivePath('circle');
const PILL = primitivePath('pill');

/** A scene item's outline in world coordinates — what the text is laid along. */
function worldPath(it: SceneItem): string {
  const d = it.path ?? (it.shape === 'ellipse' ? CIRCLE : PILL);
  const a = (it.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return mapPath(d, (u) => ({ x: it.cx + u.x * it.w * c - u.y * it.h * s, y: it.cy + u.x * it.w * s + u.y * it.h * c }));
}

/**
 * Text on a path, made visible while it is being edited: the path it runs along, a START
 * marker where the words begin and an END marker where they stop, and a tick for the
 * baseline. Drag START along the path to slide the words; drag the tick to lift them off
 * it. None of this is drawn in playback or in any export.
 */
export function TextPathHandles({ node, item, scene, frame, toComp }: {
  node: RigNode; item: SceneItem; scene: SceneItem[]; frame?: LayerFrame;
  toComp: (e: { clientX: number; clientY: number }) => Vec2;
}) {
  const setValue = useEditor((s) => s.setValue);
  const t = node.text;
  const path = t?.path;
  if (!t || !path || path.mode === 'straight' || !item.font) return null;
  const k = item.font.size / Math.max(t.size, 1e-6);

  let d: string | null = null;
  let anchors: Vec2[] = [];
  if (path.mode === 'path') {
    const target = scene.find((s) => s.id === path.nodeId);
    if (target) {
      d = worldPath(target);
      // the curve's own points, so you can see what you would drag to reshape it
      const a = (target.rotation * Math.PI) / 180;
      anchors = pathAnchors(target.path ?? '').map((u) => ({
        x: target.cx + u.x * target.w * Math.cos(a) - u.y * target.h * Math.sin(a),
        y: target.cy + u.x * target.w * Math.sin(a) + u.y * target.h * Math.cos(a),
      }));
    }
  } else if (frame) {
    const arc = arcSampler((path.radius ?? TEXT_DEFAULTS.arc.radius) * k, path.start ?? TEXT_DEFAULTS.arc.start, path.end ?? TEXT_DEFAULTS.arc.end, !!path.reverse);
    const r = (frame.rot * Math.PI) / 180;
    const pts = Array.from({ length: 97 }, (_, i) => arc.at((arc.length * i) / 96))
      .map((p) => ({ x: frame.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: frame.y + p.x * Math.sin(r) + p.y * Math.cos(r) }));
    d = pathFromPoints(pts, false);
  }
  const sampler: PathSampler | null = d ? pathSampler(d) : null;
  if (!d || !sampler) return null;

  // where the words start and stop along it: the same alignment the layout uses
  const size = item.font.size;
  const lines = layoutLines({ ...t, size, letterSpacing: t.letterSpacing * k, width: undefined }, metricsFor(item.font, size));
  const W = lines[0]?.width ?? 0;
  const L = sampler.length;
  const align = t.align === 'left' ? 0 : t.align === 'center' ? (L - W) / 2 : L - W;
  const flip = !!path.flip;
  const s0 = (path.offset ?? 0) * k + align;
  const at = (s: number) => {
    const p = sampler.at(path.mode === 'path' && path.reverse ? L - s : s);
    const ang = p.angle + (path.mode === 'path' && path.reverse ? Math.PI : 0);
    return { x: p.x, y: p.y, ang, up: { x: Math.sin(ang) * (flip ? -1 : 1), y: -Math.cos(ang) * (flip ? -1 : 1) } };
  };
  const start = at(flip ? s0 + W : s0);
  const end = at(flip ? s0 : s0 + W);
  const lift = (path.baseline ?? 0) * k;
  const tick = { x: start.x + start.up.x * lift, y: start.y + start.up.y * lift };

  /** the distance along the path nearest a point — where START lands when dropped there */
  const nearest = (p: Vec2) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i <= 240; i++) {
      const s = (L * i) / 240;
      const q = at(s);
      const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (dd < bd) { bd = dd; best = s; }
    }
    return best;
  };
  const drag = (move: (p: Vec2) => void) => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const onMove = (ev: PointerEvent) => move(toComp(ev));
    const up = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  };
  const flag = (p: { x: number; y: number; ang: number }, label: string, cls: string) => {
    const deg = (p.ang * 180) / Math.PI;
    return (
      <g transform={`translate(${p.x} ${p.y}) rotate(${deg})`} className={cls}>
        <line x1={0} y1={-12} x2={0} y2={12} />
        <path d={label === 'Start' ? 'M 0 -12 L 9 -8 L 0 -4 Z' : 'M 0 -12 L -9 -8 L 0 -4 Z'} />
      </g>
    );
  };
  return (
    <g className="textpath-edit">
      <path d={d} className="textpath-guide" pointerEvents="none" />
      {anchors.map((a, i) => <circle key={i} cx={a.x} cy={a.y} r={2.5} className="textpath-anchor" pointerEvents="none" />)}
      {flag(end, 'End', 'textpath-flag end')}
      <g onPointerDown={drag((p) => setValue(node.id, 'text.path.offset', Math.round((nearest(p) - align - (flip ? W : 0)) / k), `tpoff.${node.id}`))}
        style={{ cursor: 'ew-resize' }}>
        {flag(start, 'Start', 'textpath-flag start')}
        <circle cx={start.x} cy={start.y} r={9} fill="transparent" />
        <title>Start — drag along the path to slide the words</title>
      </g>
      <line x1={start.x} y1={start.y} x2={tick.x} y2={tick.y} className="textpath-lift" pointerEvents="none" />
      <circle cx={tick.x} cy={tick.y} r={4.5} className="textpath-tick"
        onPointerDown={drag((p) => setValue(node.id, 'text.path.baseline',
          Math.round(((p.x - start.x) * start.up.x + (p.y - start.y) * start.up.y) / k), `tpbase.${node.id}`))}>
        <title>Baseline — drag to lift the words off the path</title>
      </circle>
    </g>
  );
}
