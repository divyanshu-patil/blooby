import { useRef } from 'react';
import { useEditor } from '../core/store';
import { activeTrackFor, valueAt } from '../core/scene';
import { activeTimeline } from '../core/types';
import { NumberField, Panel, PropRow } from './bits';
import type { RigNode } from '../core/types';

const PAD_RANGE = 42; // degrees at the pad's edge

/**
 * Plain-language controls on top of the raw yaw/pitch fields — the inspector still
 * shows those, this panel just speaks human.
 */
export function EyePanel() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const toggleTrack = useEditor((s) => s.toggleTrack);
  const updateNode = useEditor((s) => s.updateNode);
  const select = useEditor((s) => s.select);
  const selection = useEditor((s) => s.selection);
  const pad = useRef<HTMLDivElement>(null);

  const eyes = Object.values(project.rig.nodes).filter((n): n is RigNode & { eye: NonNullable<RigNode['eye']> } => n.kind === 'eye' && !!n.eye);
  if (!eyes.length) return <Panel title="Eyes"><p className="empty-note">This rig has no eye layers.</p></Panel>;

  const sorted = [...eyes].sort((a, b) => a.eye.distanceFromCenter - b.eye.distanceFromCenter);
  const left = sorted[0], right = sorted[sorted.length - 1];
  const linked = eyes.some((e) => e.eye.linkedToId);
  const num = (n: RigNode, p: string) => (valueAt(project, n.id, p, playhead) as number) ?? 0;

  const gazeYaw = num(left, 'surface.yaw');
  const gazePitch = num(left, 'surface.pitch');

  const setBoth = (property: string, value: number, label: string) => {
    for (const e of eyes) if (!e.eye.linkedToId) setValue(e.id, property, value, label);
  };
  const toggleBoth = (property: string) => {
    for (const e of eyes) if (!e.eye.linkedToId) toggleTrack(e.id, property);
  };
  const trackedLeft = (property: string) => !!activeTrackFor(activeTimeline(project), left.id, property, playhead);

  const setSeparation = (deg: number) => {
    if (left === right) { setValue(left.id, 'eye.distanceFromCenter', deg, 'sep'); return; }
    setValue(left.id, 'eye.distanceFromCenter', -deg, 'sep');
    if (!right.eye.linkedToId) setValue(right.id, 'eye.distanceFromCenter', deg, 'sep');
  };

  const onPad = (e: React.PointerEvent) => {
    if (e.buttons === 0 && e.type === 'pointermove') return;
    const r = pad.current!.getBoundingClientRect();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    setBoth('surface.yaw', round(clamp(nx, -1, 1) * PAD_RANGE), 'gaze');
    setBoth('surface.pitch', round(clamp(ny, -1, 1) * PAD_RANGE), 'gaze');
  };

  const separation = Math.abs(left.eye.distanceFromCenter);

  return (
    <Panel title="Eye expression" actions={
      <button className="btn sm" aria-pressed={linked} title="Mirror the right eye from the left"
        onClick={() => {
          if (left === right) return;
          updateNode(right.id, (n) => { if (n.eye) n.eye.linkedToId = linked ? null : left.id; });
        }}>{linked ? 'Linked' : 'Unlinked'}</button>
    }>
      <div style={{ position: 'relative' }}>
        <div ref={pad} className="pad" onPointerDown={onPad} onPointerMove={onPad}
          role="slider" aria-label="Eye direction" aria-valuenow={Math.round(gazeYaw)} tabIndex={0}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 8 : 2;
            if (e.key === 'ArrowLeft') setBoth('surface.yaw', gazeYaw - step, 'gaze');
            if (e.key === 'ArrowRight') setBoth('surface.yaw', gazeYaw + step, 'gaze');
            if (e.key === 'ArrowUp') setBoth('surface.pitch', gazePitch - step, 'gaze');
            if (e.key === 'ArrowDown') setBoth('surface.pitch', gazePitch + step, 'gaze');
          }}>
          <svg viewBox="-1 -1 2 2" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <line x1={-1} y1={0} x2={1} y2={0} stroke="rgba(255,255,255,.12)" strokeWidth={0.006} />
            <line x1={0} y1={-1} x2={0} y2={1} stroke="rgba(255,255,255,.12)" strokeWidth={0.006} />
            <circle cx={0} cy={0} r={0.55} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={0.006} />
            <circle cx={clamp(gazeYaw / PAD_RANGE, -1, 1)} cy={clamp(gazePitch / PAD_RANGE, -1, 1)} r={0.075} fill="#fff" />
          </svg>
        </div>
        <button className="stopwatch" style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(23,22,27,.55)' }}
          aria-pressed={trackedLeft('surface.yaw') || trackedLeft('surface.pitch')}
          title="Animate the gaze (yaw + pitch)"
          onClick={() => { toggleBoth('surface.yaw'); toggleBoth('surface.pitch'); }} />
      </div>
      <p className="hint">Drag to aim the eyes. They ride the sphere, so the path curves and the far eye narrows.</p>

      <div className="prop">
        <button className="stopwatch" aria-pressed={trackedLeft('eye.distanceFromCenter')} title="Animate distance apart"
          onClick={() => toggleBoth('eye.distanceFromCenter')} />
        <label className="prop-label"><span className="t">Distance apart</span>
          <input type="range" min={0} max={60} step={0.5} value={separation} onChange={(e) => setSeparation(+e.target.value)} />
        </label>
        <NumberField value={separation} step={0.5} onChange={setSeparation} />
      </div>

      <div className="prop">
        <button className="stopwatch" aria-pressed={trackedLeft('eye.openness')} title="Animate openness"
          onClick={() => toggleBoth('eye.openness')} />
        <label className="prop-label"><span className="t">Openness</span>
          <input type="range" min={0} max={1} step={0.01} value={num(left, 'eye.openness')}
            onChange={(e) => setBoth('eye.openness', +e.target.value, 'open')} />
        </label>
        <NumberField value={num(left, 'eye.openness')} step={0.05} onChange={(v) => setBoth('eye.openness', clamp(v, 0, 1), 'open')} />
      </div>

      <div className="prop">
        <button className="stopwatch" aria-pressed={trackedLeft('transform.length')} title="Animate eye length"
          onClick={() => toggleBoth('transform.length')} />
        <label className="prop-label"><span className="t">Eye length</span>
          <input type="range" min={0.2} max={3} step={0.01} value={num(left, 'transform.length')}
            onChange={(e) => setBoth('transform.length', +e.target.value, 'len')} />
        </label>
        <NumberField value={num(left, 'transform.length')} step={0.05} onChange={(v) => setBoth('transform.length', clamp(v, 0.1, 4), 'len')} />
      </div>

      <div className="prop">
        <button className="stopwatch" aria-pressed={trackedLeft('transform.scale.x')} title="Animate eye width"
          onClick={() => toggleBoth('transform.scale.x')} />
        <label className="prop-label"><span className="t">Eye width</span>
          <input type="range" min={0.2} max={2.5} step={0.01} value={num(left, 'transform.scale.x')}
            onChange={(e) => setBoth('transform.scale.x', +e.target.value, 'wide')} />
        </label>
        <NumberField value={num(left, 'transform.scale.x')} step={0.05} onChange={(v) => setBoth('transform.scale.x', clamp(v, 0.05, 4), 'wide')} />
      </div>

      <div className="divider" />
      <div className="row">
        {sorted.map((e) => (
          <button key={e.id} className="btn sm" style={{ flex: 1 }} aria-pressed={selection[0] === e.id}
            onClick={() => select([e.id])}>{e.name}</button>
        ))}
      </div>
      {selection[0] && project.rig.nodes[selection[0]]?.kind === 'eye' && (
        <>
          <span className="panel-title">This eye only</span>
          <PropRow nodeId={selection[0]} property="eye.openness" />
          <PropRow nodeId={selection[0]} property="eye.distanceFromCenter" />
          <PropRow nodeId={selection[0]} property="transform.length" />
        </>
      )}
    </Panel>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round = (v: number) => Math.round(v * 10) / 10;
