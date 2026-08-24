import { useEditor } from '../core/store';
import { cssColor, hexColor, oklchToRgb, parseHex, rgbToOklch } from '../core/color';
import { valueAt } from '../core/scene';
import { CAMERA_ID, type ColorStop } from '../core/types';
import { NumberField, Panel, PropRow } from './bits';
import { INK, BONE } from '../core/defaults';

const SWATCHES: ColorStop[] = [
  BONE, INK,
  { r: 255, g: 255, b: 255, a: 1 },
  { r: 34, g: 51, b: 224, a: 1 },
  { r: 217, g: 64, b: 31, a: 1 },
  { r: 244, g: 183, b: 63, a: 1 },
  { r: 47, g: 158, b: 87, a: 1 },
  { r: 226, g: 128, b: 178, a: 1 },
];

export function ColorField({ value, onChange, onToggleTrack, animated }: {
  value: ColorStop; onChange: (c: ColorStop) => void; onToggleTrack?: () => void; animated?: boolean;
}) {
  const lch = rgbToOklch(value);
  const set = (patch: Partial<typeof lch>) => onChange({ ...oklchToRgb({ ...lch, ...patch }), a: value.a });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div className="prop">
        {onToggleTrack
          ? <button className="stopwatch" aria-pressed={!!animated} title="Animate colour" onClick={onToggleTrack} />
          : <span />}
        <label className="prop-label"><span className="t">Fill</span></label>
        <input type="color" value={hexColor(value)} aria-label="Fill colour"
          onChange={(e) => onChange({ ...parseHex(e.target.value), a: value.a })}
          style={{ width: '100%', height: 23, border: '1px solid var(--line)', borderRadius: 5, background: 'none', padding: 1 }} />
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Lightness</span>
          <input type="range" min={0} max={1} step={0.005} value={lch.l} onChange={(e) => set({ l: +e.target.value })} />
        </label><NumberField value={Math.round(lch.l * 100)} step={1} onChange={(v) => set({ l: v / 100 })} />
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Chroma</span>
          <input type="range" min={0} max={0.37} step={0.002} value={lch.c} onChange={(e) => set({ c: +e.target.value })} />
        </label><NumberField value={Math.round(lch.c * 1000) / 10} step={1} onChange={(v) => set({ c: v / 100 })} />
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Hue</span>
          <input type="range" min={0} max={360} step={1} value={(lch.h + 360) % 360} onChange={(e) => set({ h: +e.target.value })} />
        </label><NumberField value={Math.round((lch.h + 360) % 360)} step={1} onChange={(v) => set({ h: v })} />
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Opacity</span>
          <input type="range" min={0} max={1} step={0.01} value={value.a} onChange={(e) => onChange({ ...value, a: +e.target.value })} />
        </label><NumberField value={Math.round(value.a * 100)} step={1} onChange={(v) => onChange({ ...value, a: Math.min(1, Math.max(0, v / 100)) })} />
      </div>
      <div className="swatches">
        {SWATCHES.map((s, i) => (
          <button key={i} className="sw" style={{ background: cssColor(s) }} aria-label={`Swatch ${i + 1}`}
            aria-pressed={hexColor(s) === hexColor(value)} onClick={() => onChange({ ...s, a: value.a })} />
        ))}
      </div>
    </div>
  );
}

/** Every node in the selection, batch-edited together — scale, roll, colour, nothing that only makes sense for one. */
function MultiNodeInspector({ ids }: { ids: string[] }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const toggleTrack = useEditor((s) => s.toggleTrack);
  const select = useEditor((s) => s.select);

  const nodes = ids.map((i) => project.rig.nodes[i]).filter((n): n is NonNullable<typeof n> => !!n);
  const names = nodes.map((n) => n.name).join(', ');
  const colorNow = valueAt(project, ids[0], 'color', playhead) as ColorStop;
  const colorTrack = project.tracks.some((t) => ids.includes(t.nodeId) && t.property === 'color');

  return (
    <Panel title={`${nodes.length} layers`} actions={<span className="tag">{names.slice(0, 28)}{names.length > 28 ? '…' : ''}</span>}>
      <p className="hint">Editing {nodes.length} layers together — every change here applies to all of them, in one undo step.</p>
      <div className="divider" />
      <PropRow nodeId={ids} property="transform.scale.x" />
      <PropRow nodeId={ids} property="transform.scale.y" />
      <PropRow nodeId={ids} property="transform.rotation" />
      {nodes.every((n) => n.kind !== 'body') && <PropRow nodeId={ids} property="transform.length" />}
      {nodes.every((n) => n.kind === 'eye') && <PropRow nodeId={ids} property="eye.openness" />}

      <div className="divider" />
      <ColorField value={colorNow ?? nodes[0].color} animated={colorTrack}
        onToggleTrack={() => { for (const i of ids) toggleTrack(i, 'color'); }}
        onChange={(c) => { for (const i of ids) setValue(i, 'color', c, 'multi.color'); }} />

      <div className="divider" />
      <button className="btn sm" onClick={() => select([ids[0]])}>Just select {nodes[0]?.name}</button>
    </Panel>
  );
}

export function NodeInspector() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const updateNode = useEditor((s) => s.updateNode);
  const setValue = useEditor((s) => s.setValue);
  const toggleTrack = useEditor((s) => s.toggleTrack);

  if (selection.length > 1) return <MultiNodeInspector ids={selection} />;

  const id = selection[0];
  const node = id ? project.rig.nodes[id] : undefined;
  if (!node) return <Panel title="Node"><p className="empty-note">Select a layer on the stage or in the list — shift-click to select more than one.</p></Panel>;

  const colorNow = valueAt(project, node.id, 'color', playhead) as ColorStop;
  const colorTrack = project.tracks.some((t) => t.nodeId === node.id && t.property === 'color');
  const isRoot = node.id === project.rig.rootId;
  const parents = Object.values(project.rig.nodes).filter((n) => n.id !== node.id && n.kind !== 'svgLayer');

  return (
    <Panel title={node.kind === 'body' ? 'Body' : node.name} actions={<span className="tag">{node.kind}</span>}>
      <input className="txt" value={node.name} aria-label="Layer name"
        onChange={(e) => updateNode(node.id, (n) => { n.name = e.target.value; }, `name.${node.id}`)} />

      {!isRoot && (
        <div className="row">
          <span className="prop-label" style={{ width: 52 }}>Parent</span>
          <select className="sel" style={{ flex: 1 }} value={node.parentId ?? ''}
            onChange={(e) => updateNode(node.id, (n) => { n.parentId = e.target.value; })}>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn sm" aria-pressed={node.surface.mapped} title="Follow the body's curvature"
            onClick={() => updateNode(node.id, (n) => { n.surface.mapped = !n.surface.mapped; })}>
            {node.surface.mapped ? 'On surface' : 'Flat'}
          </button>
        </div>
      )}

      <div className="divider" />
      {isRoot ? (
        <>
          <span className="panel-title">Head turn</span>
          <PropRow nodeId={node.id} property="surface.yaw" />
          <PropRow nodeId={node.id} property="surface.pitch" />
          <PropRow nodeId={node.id} property="flatOffset.x" label="Position X" />
          <PropRow nodeId={node.id} property="flatOffset.y" label="Position Y" />
        </>
      ) : node.surface.mapped ? (
        <>
          <PropRow nodeId={node.id} property="surface.yaw" />
          <PropRow nodeId={node.id} property="surface.pitch" />
        </>
      ) : (
        <>
          <PropRow nodeId={node.id} property="flatOffset.x" />
          <PropRow nodeId={node.id} property="flatOffset.y" />
        </>
      )}

      <div className="divider" />
      <PropRow nodeId={node.id} property="transform.scale.x" />
      <PropRow nodeId={node.id} property="transform.scale.y" />
      <PropRow nodeId={node.id} property="transform.rotation" />
      {node.kind !== 'body' && <PropRow nodeId={node.id} property="transform.length" />}
      <PropRow nodeId={node.id} property="size.x" label={isRoot ? 'Radius' : 'Width'} />
      {!isRoot && <PropRow nodeId={node.id} property="size.y" label="Height" />}

      <div className="divider" />
      <ColorField value={colorNow ?? node.color} animated={colorTrack}
        onToggleTrack={() => toggleTrack(node.id, 'color')}
        onChange={(c) => setValue(node.id, 'color', c, `color.${node.id}`)} />

      <div className="divider" />
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Stacking order</span>
        <NumberField value={node.zIndex} onChange={(v) => updateNode(node.id, (n) => { n.zIndex = Math.round(v); })} />
      </div>
    </Panel>
  );
}

export function CameraPanel() {
  return (
    <Panel title="Camera">
      <PropRow nodeId={CAMERA_ID} property="camera.fov" />
      <PropRow nodeId={CAMERA_ID} property="camera.distance" />
      <PropRow nodeId={CAMERA_ID} property="camera.offset.x" />
      <PropRow nodeId={CAMERA_ID} property="camera.offset.y" />
      <p className="hint">Perspective 0° is orthographic — features slide flat across the face. Open it up and the near side swells while the rim hides behind the silhouette.</p>
    </Panel>
  );
}
