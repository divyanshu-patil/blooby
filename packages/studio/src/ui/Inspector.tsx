import { useEffect, useState } from 'react';
import { useEditor } from '../core/store';
import { cssColor, hexColor, oklchToRgb, parseHex, rgbToOklch } from '../core/color';
import { valueAt } from '../core/scene';
import { activeTimeline, CAMERA_ID, type ColorStop } from '../core/types';
import { KeyNav, NumberField, Panel, PropRow } from './bits';
import { INK, BONE } from '../core/defaults';
import { blockStarts, fmtSec } from '../core/timeline';
import { easingLabel } from '../core/easing';
import { getEntry, type GalleryEntry } from '../core/gallery';

const SWATCHES: ColorStop[] = [
  BONE, INK,
  { r: 255, g: 255, b: 255, a: 1 },
  { r: 34, g: 51, b: 224, a: 1 },
  { r: 217, g: 64, b: 31, a: 1 },
  { r: 244, g: 183, b: 63, a: 1 },
  { r: 47, g: 158, b: 87, a: 1 },
  { r: 226, g: 128, b: 178, a: 1 },
];

export function ColorField({ value, onChange, onToggleTrack, keyNavFor }: {
  value: ColorStop; onChange: (c: ColorStop) => void; onToggleTrack?: () => void;
  /** the layer whose colour this is, so the stopwatch and chevrons work on it */
  keyNavFor?: string;
}) {
  const lch = rgbToOklch(value);
  const set = (patch: Partial<typeof lch>) => onChange({ ...oklchToRgb({ ...lch, ...patch }), a: value.a });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div className="prop">
        {onToggleTrack && keyNavFor
          ? <KeyNav nodeId={keyNavFor} property="color" onToggle={onToggleTrack} />
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
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const select = useEditor((s) => s.select);

  const nodes = ids.map((i) => project.rig.nodes[i]).filter((n): n is NonNullable<typeof n> => !!n);
  const names = nodes.map((n) => n.name).join(', ');
  const colorNow = valueAt(project, ids[0], 'color', playhead) as ColorStop;

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
      <ColorField value={colorNow ?? nodes[0].color} keyNavFor={ids[0]}
        onToggleTrack={() => { for (const i of ids) toggleKeyframe(i, 'color'); }}
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
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);

  if (selection.length > 1) return <MultiNodeInspector ids={selection} />;

  const id = selection[0];
  const node = id ? project.rig.nodes[id] : undefined;
  if (!node) return <Panel title="Node"><p className="empty-note">Select a layer on the stage or in the list — shift-click to select more than one.</p></Panel>;

  const colorNow = valueAt(project, node.id, 'color', playhead) as ColorStop;
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
      <ColorField value={colorNow ?? node.color} keyNavFor={node.id}
        onToggleTrack={() => toggleKeyframe(node.id, 'color')}
        onChange={(c) => setValue(node.id, 'color', c, `color.${node.id}`)} />

      <div className="divider" />
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Stacking order</span>
        <NumberField value={node.zIndex} onChange={(v) => updateNode(node.id, (n) => { n.zIndex = Math.round(v); })} />
      </div>
    </Panel>
  );
}

/**
 * "Select a clip → inspector shows clip controls" (spec §17) — the same Node-tab slot
 * NodeInspector occupies, switched by App.tsx whenever a clip is selected on the timeline
 * instead of a layer. Source/duration/start/speed/loop/effects/transition, per §8 step 3.
 */
export function ClipInspector() {
  const project = useEditor((s) => s.project);
  const selectedBlockId = useEditor((s) => s.selectedBlockId);
  const renameBlock = useEditor((s) => s.renameBlock);
  const setBlockDuration = useEditor((s) => s.setBlockDuration);
  const setBlockSpeed = useEditor((s) => s.setBlockSpeed);
  const setBlockLoop = useEditor((s) => s.setBlockLoop);
  const removeBlock = useEditor((s) => s.removeBlock);
  const duplicateBlock = useEditor((s) => s.duplicateBlock);
  const updatePresetFromBlock = useEditor((s) => s.updatePresetFromBlock);
  const selectBlock = useEditor((s) => s.selectBlock);
  const setClipGalleryTimeline = useEditor((s) => s.setClipGalleryTimeline);

  const tl = activeTimeline(project);
  const index = tl.blocks.findIndex((b) => b.id === selectedBlockId);
  const block = tl.blocks[index];

  // for a gallery-sourced clip, the timeline picker's options come from the gallery entry
  // itself — fetched once per clip selection, not carried in the (lightweight) block data.
  const [galleryEntry, setGalleryEntry] = useState<GalleryEntry | null>(null);
  const [savedPreset, setSavedPreset] = useState(false);
  useEffect(() => {
    setGalleryEntry(null);
    if (block?.gallerySource) getEntry(block.gallerySource.galleryId).then((e) => setGalleryEntry(e ?? null));
  }, [block?.gallerySource?.galleryId, block?.id]);

  if (!block) return null;

  const preset = project.presets.find((p) => p.id === block.presetId);
  const startMs = blockStarts(tl)[index];
  const effectCount = tl.modifiers.filter((m) => m.blockId === block.id).length;
  const transitionIn = tl.transitions?.find((x) => x.afterBlockId === tl.blocks[index - 1]?.id);
  const transitionOut = tl.transitions?.find((x) => x.afterBlockId === block.id);

  return (
    <Panel title="Clip" actions={<span className="tag">clip {index + 1} of {tl.blocks.length}</span>}>
      <input className="txt" value={block.name} aria-label="Clip name"
        onChange={(e) => renameBlock(block.id, e.target.value)} />

      <div className="divider" />
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Source</span>
        {block.gallerySource ? (
          <span className="tag" title="A gallery animation's timeline, copied in as this clip's own instance — editing this clip never touches the gallery item">
            {block.gallerySource.galleryName} · {block.gallerySource.timelineName}
          </span>
        ) : (
          <span className="tag" title="The reusable preset this clip is an instance of — editing this clip never changes it">
            {preset?.name ?? (block.presetId || 'clip')}
          </span>
        )}
      </div>
      {block.gallerySource && galleryEntry && galleryEntry.project.timelines.length > 1 && (
        <div className="row"><span className="prop-label" style={{ flex: 1 }}>Timeline</span>
          <select className="sel" value={block.gallerySource.timelineId}
            onChange={(e) => setClipGalleryTimeline(block.id, galleryEntry, e.target.value)}>
            {galleryEntry.project.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Start</span>
        <span className="hint">{fmtSec(startMs)} — set by clip order, drag to reorder</span>
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Duration</span>
          <input type="range" min={0.06} max={8} step={0.02} value={block.durationMs / 1000}
            onChange={(e) => setBlockDuration(block.id, +e.target.value * 1000)} />
        </label>
        <NumberField value={block.durationMs / 1000} step={0.1} onChange={(v) => setBlockDuration(block.id, Math.max(60, v * 1000))} />
      </div>
      <div className="prop">
        <span /><label className="prop-label"><span className="t">Speed</span>
          <input type="range" min={0.1} max={4} step={0.05} value={block.speed ?? 1}
            onChange={(e) => setBlockSpeed(block.id, +e.target.value)} />
        </label>
        <NumberField value={block.speed ?? 1} step={0.1} onChange={(v) => setBlockSpeed(block.id, v)} />
      </div>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }} title="Repeats this clip's own animation to fill its duration, instead of holding the last pose">Loop</span>
        <button className="btn sm" aria-pressed={!!block.loop} onClick={() => setBlockLoop(block.id, !block.loop)}>
          {block.loop ? 'Loops' : 'Once'}
        </button>
      </div>

      <div className="divider" />
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Effects</span>
        <span className="hint">{effectCount ? `${effectCount} on this clip — see Effects tab` : 'none — add from the Effects tab'}</span>
      </div>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Transition in</span>
        <span className="hint">{transitionIn ? `${easingLabel(transitionIn.easing)} · ${(transitionIn.durationMs / 1000).toFixed(2)}s` : 'none'}</span>
      </div>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Transition out</span>
        <span className="hint">{transitionOut ? `${easingLabel(transitionOut.easing)} · ${(transitionOut.durationMs / 1000).toFixed(2)}s` : 'none'}</span>
      </div>
      <p className="hint">Edit transitions from the ◆ / › connector between clips on the strip.</p>

      <div className="divider" />
      <div className="row">
        <button className="btn sm" onClick={() => selectBlock(null)}>Done editing this clip</button>
        <span className="spacer" />
        {preset && (
          <button className="btn ghost sm" title={`Overwrite the "${preset.name}" preset with this clip's keyframes and length`}
            onClick={() => { updatePresetFromBlock(block.id); setSavedPreset(true); setTimeout(() => setSavedPreset(false), 1500); }}>
            {savedPreset ? 'Saved' : 'Save to preset'}
          </button>
        )}
        <button className="btn ghost sm" title="Insert a copy right after this clip — its own instance, edits here don't affect it"
          onClick={() => duplicateBlock(block.id)}>Duplicate</button>
        <button className="btn ghost sm" onClick={() => removeBlock(block.id)}>Remove clip</button>
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
