import { useEditor } from '../core/store';
import { PropRow } from './bits';
import { valueAt } from '../core/scene';
import { curveFromPath, insertPoint, reverseCurve } from '../core/curve';
import { pathSampler, mapPath } from '../core/path';
import type { CurveType, RigNode } from '../core/types';

const TYPES: { id: CurveType; label: string; title: string }[] = [
  { id: 'smooth', label: 'Smooth', title: 'Flows through every point — handles are worked out for you' },
  { id: 'polyline', label: 'Straight', title: 'Straight lines between the points' },
  { id: 'bezier', label: 'Bézier', title: 'Every point has handles you can drag (Alt breaks a pair)' },
];

/**
 * A drawn curve: how its handles are made, how many points it has, whether it closes,
 * which way it runs, and whether it is a guide. Its points themselves are edited on the
 * stage — they are the anchors of its path, never resampled points.
 */
export function CurveSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const editCurve = useEditor((s) => s.editCurve);
  const setCurveType = useEditor((s) => s.setCurveType);
  const updateNode = useEditor((s) => s.updateNode);
  const curveToHose = useEditor((s) => s.curveToHose);
  const shown = valueAt(project, node.id, 'shape.path', playhead);
  const d = typeof shown === 'string' ? shown : node.shapePath;
  const c = curveFromPath(d);
  const type = node.curve?.type ?? 'bezier';
  // its length on the canvas, in px: the outline at the layer's own size
  const sx = node.size.x * node.transform.scale.x, sy = node.size.y * node.transform.scale.y;
  const length = d ? pathSampler(mapPath(d, (p) => ({ x: p.x * sx, y: p.y * sy })))?.length ?? 0 : 0;
  const users = Object.values(project.rig.nodes).filter((n) => n.text?.path?.mode === 'path' && n.text.path.nodeId === node.id);
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Curve type" style={{ display: 'flex' }}>
        {TYPES.map((t) => (
          <button key={t.id} role="radio" style={{ flex: 1 }} aria-checked={type === t.id} aria-pressed={type === t.id} title={t.title}
            onClick={() => setCurveType(node.id, t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="row curve-facts">
        <span><strong>{c?.points.length ?? 0}</strong> points</span>
        <span><strong>{Math.round(length)}</strong> px long</span>
        <span>{c?.closed ? 'closed' : 'open'}</span>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button className="btn sm" title="A new point halfway along the last segment"
          onClick={() => editCurve(node.id, (cv, ty) => insertPoint(cv, ty, cv.closed ? cv.points.length - 1 : cv.points.length - 2, 0.5), `addpt.${node.id}`)}>Add point</button>
        <button className="btn sm" aria-pressed={!!c?.closed} disabled={(c?.points.length ?? 0) < 3} title="Join the last point back to the first"
          onClick={() => editCurve(node.id, (cv) => ({ ...cv, closed: !cv.closed }), `close.${node.id}`)}>{c?.closed ? 'Closed' : 'Close'}</button>
        <button className="btn sm" title="Run it the other way — text on it starts from the other end"
          onClick={() => editCurve(node.id, (cv) => reverseCurve(cv), `rev.${node.id}`)}>Reverse</button>
        <button className="btn sm" disabled={!!c?.closed} title="Make it a rubber hose through its start, middle and end: it keeps its length, bows when the ends come together, and can be pinned"
          onClick={() => curveToHose(node.id)}>Rubber hose</button>
      </div>
      <div className="divider" />
      <PropRow nodeId={node.id} property="trim.start" label="Start offset" />
      <PropRow nodeId={node.id} property="trim.end" label="End offset" />
      <PropRow nodeId={node.id} property="trim.offset" label="Slide along" />
      <PropRow nodeId={node.id} property="stroke.taper" label="Brush taper" />
      <p className="hint">The part of the line that is drawn, 0–1 along it. Key End 0 → 1 to draw it on; then Start 0 → 1 to draw it off. Start past End runs it backwards.</p>
      <div className="divider" />
      <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Drawn dashed in the editor and left out of every export">
        <input type="checkbox" checked={!!node.guide} onChange={(e) => updateNode(node.id, (n) => { n.guide = e.target.checked || undefined; })} />
        Guide only — not exported
      </label>
      <p className="hint">
        {users.length ? `Carries ${users.map((u) => `“${u.name}”`).join(', ')}. ` : ''}
        Drag a point on the stage to move it, double-click the line to add one, select a point and press Delete to remove it.
      </p>
    </>
  );
}
