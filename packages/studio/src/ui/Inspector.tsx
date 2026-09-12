import { useEffect, useState } from 'react';
import { useEditor } from '../core/store';
import { cssColor, hexColor, oklchToRgb, parseHex, rgbToOklch } from '../core/color';
import { appearanceSpans, valueAt } from '../core/scene';
import { activeTimeline, CAMERA_ID, MODIFIERS, type ColorStop, type LineCap, type LineJoin, type RigNode } from '../core/types';
import { KeyNav, NumberField, Panel, PropRow } from './bits';
import { ShapeEditor } from './ShapeEditor';
import { Collapsible } from './Collapsible';
import { RangeBar } from './RangeBar';
import { INK, BONE } from '../core/defaults';
import { COMP_MAX, COMP_MIN, COMP_PRESETS, compOf } from '../core/comp';
import { attachmentOf, isInside } from '../core/layers';
import { limbPoints } from '../core/limb';
import { blockStarts, fmtSec } from '../core/timeline';
import { EASING_NAMES, easingLabel, namedEasing } from '../core/easing';
import { NUMERIC_PROPS, PROP_LABEL, PROPS } from '../core/props';
import { getEntry, type GalleryEntry } from '../core/gallery';
import { useStageBg } from './stageBg';

const SWATCHES: ColorStop[] = [
  BONE, INK,
  { r: 255, g: 255, b: 255, a: 1 },
  { r: 34, g: 51, b: 224, a: 1 },
  { r: 217, g: 64, b: 31, a: 1 },
  { r: 244, g: 183, b: 63, a: 1 },
  { r: 47, g: 158, b: 87, a: 1 },
  { r: 226, g: 128, b: 178, a: 1 },
];

/**
 * A colour, as the fill or the stroke. One control for both, each keyed on its OWN
 * property — `color` for the fill, `stroke.color` for the outline — so "fill blue→pink
 * while the stroke goes black→white" is two independent tracks, interpolated by the same
 * OKLCH lerp every colour in the project goes through.
 */
export function ColorField({ value, onChange, onToggleTrack, keyNavFor, property = 'color', label = 'Fill', compact }: {
  value: ColorStop; onChange: (c: ColorStop) => void; onToggleTrack?: () => void;
  /** the layer whose colour this is, so the stopwatch and chevrons work on it */
  keyNavFor?: string;
  property?: string;
  label?: string;
  /** hide the lightness/chroma/hue dials — just the swatch, opacity and swatches */
  compact?: boolean;
}) {
  const lch = rgbToOklch(value);
  const set = (patch: Partial<typeof lch>) => onChange({ ...oklchToRgb({ ...lch, ...patch }), a: value.a });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div className="prop">
        {onToggleTrack && keyNavFor
          ? <KeyNav nodeId={keyNavFor} property={property} onToggle={onToggleTrack} />
          : <span />}
        <label className="prop-label"><span className="t">{label}</span></label>
        <input type="color" value={hexColor(value)} aria-label={`${label} colour`}
          onChange={(e) => onChange({ ...parseHex(e.target.value), a: value.a })}
          style={{ width: '100%', height: 23, border: '1px solid var(--line)', borderRadius: 5, background: 'none', padding: 1 }} />
      </div>
      {!compact && (
        <>
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
        </>
      )}
      <div className="swatches">
        {SWATCHES.map((s, i) => (
          <button key={i} className="sw" style={{ background: cssColor(s) }} aria-label={`${label} swatch ${i + 1}`}
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
      <PropRow nodeId={ids} property="opacity" />
      {nodes.every((n) => n.kind !== 'body') && <PropRow nodeId={ids} property="transform.length" />}
      {nodes.every((n) => n.kind === 'eye') && <PropRow nodeId={ids} property="eye.openness" />}
      <PropRow nodeId={ids} property="visible" />

      <div className="divider" />
      <ColorField value={colorNow ?? nodes[0].color} keyNavFor={ids[0]}
        onToggleTrack={() => { for (const i of ids) toggleKeyframe(i, 'color'); }}
        onChange={(c) => { for (const i of ids) setValue(i, 'color', c, 'multi.color'); }} />

      <div className="divider" />
      <button className="btn sm" onClick={() => select([ids[0]])}>Just select {nodes[0]?.name}</button>
    </Panel>
  );
}

/**
 * One layer, in sections. The ones you reach for constantly — Transform, Shape, Fill —
 * open by default; the rest remember whether you left them open. Every number is a
 * PropRow: stopwatch, slider and typed value, the one way a property is ever edited.
 */
export function NodeInspector() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const updateNode = useEditor((s) => s.updateNode);

  if (selection.length > 1) return <MultiNodeInspector ids={selection} />;
  const id = selection[0];
  const node = id ? project.rig.nodes[id] : undefined;
  if (!node) return <CompositionPanel />;

  const isRoot = node.id === project.rig.rootId;
  const drawsPaint = node.kind !== 'group';

  return (
    <div className="insp">
      <div className="insp-head">
        <input className="txt" value={node.name} aria-label="Layer name"
          onChange={(e) => updateNode(node.id, (n) => { n.name = e.target.value; }, `name.${node.id}`)} />
        <span className="tag">{isRoot ? 'mascot' : node.kind === 'svgLayer' ? 'svg' : node.kind}</span>
      </div>

      <Collapsible title="Transform" storageKey="insp-transform">
        <TransformSection node={node} isRoot={isRoot} />
      </Collapsible>
      {node.kind === 'limb' && (
        <Collapsible title={node.limb?.type === 'leg' ? 'Leg' : 'Hand'} storageKey="insp-limb">
          <LimbSection node={node} />
        </Collapsible>
      )}
      {node.kind !== 'limb' && node.kind !== 'group' && (
        <Collapsible title="Shape" storageKey="insp-shape">
          <ShapeEditor node={node} />
        </Collapsible>
      )}
      {drawsPaint && (
        <Collapsible title="Fill" storageKey="insp-fill">
          <FillSection node={node} />
        </Collapsible>
      )}
      {drawsPaint && (
        <Collapsible title="Stroke" storageKey="insp-stroke" defaultOpen={false}>
          <StrokeSection node={node} />
        </Collapsible>
      )}
      {!isRoot && node.kind !== 'eye' && node.kind !== 'limb' && (
        <Collapsible title="Attachment" storageKey="insp-attach">
          <AttachmentSection node={node} />
        </Collapsible>
      )}
      {!isRoot && (
        <Collapsible title="Appearance" storageKey="insp-appear" defaultOpen={false}>
          <AppearanceSection node={node} />
        </Collapsible>
      )}
      <Collapsible title="Animation" storageKey="insp-anim" defaultOpen={false}>
        <AnimationSection node={node} />
      </Collapsible>
      <Collapsible title="State" storageKey="insp-state" defaultOpen={false}>
        <TweenToTarget node={node} />
      </Collapsible>
    </div>
  );
}

function TransformSection({ node, isRoot }: { node: RigNode; isRoot: boolean }) {
  return (
    <>
      {isRoot ? (
        <>
          <PropRow nodeId={node.id} property="flatOffset.x" label="Position X" />
          <PropRow nodeId={node.id} property="flatOffset.y" label="Position Y" />
          <PropRow nodeId={node.id} property="surface.yaw" label="Head yaw" />
          <PropRow nodeId={node.id} property="surface.pitch" label="Head pitch" />
        </>
      ) : node.kind === 'limb' ? null : node.surface.mapped ? (
        <>
          <PropRow nodeId={node.id} property="surface.yaw" />
          <PropRow nodeId={node.id} property="surface.pitch" />
        </>
      ) : (
        <>
          <PropRow nodeId={node.id} property="flatOffset.x" label="Position X" />
          <PropRow nodeId={node.id} property="flatOffset.y" label="Position Y" />
        </>
      )}
      <PropRow nodeId={node.id} property="transform.scale.x" />
      <PropRow nodeId={node.id} property="transform.scale.y" />
      {node.kind !== 'limb' && <PropRow nodeId={node.id} property="transform.rotation" label={isRoot ? 'Roll' : 'Rotation'} />}
      <PropRow nodeId={node.id} property="opacity" />
      <PropRow nodeId={node.id} property="visible" label="Presence" />
      {node.kind !== 'limb' && node.kind !== 'group' && (
        <Collapsible title="Size" storageKey="insp-size" defaultOpen={false}>
          {node.kind !== 'body' && <PropRow nodeId={node.id} property="transform.length" />}
          <PropRow nodeId={node.id} property="size.x" label={isRoot ? 'Radius' : 'Width'} />
          {!isRoot && <PropRow nodeId={node.id} property="size.y" label="Height" />}
        </Collapsible>
      )}
    </>
  );
}

function FillSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const colorNow = valueAt(project, node.id, 'color', playhead) as ColorStop;
  const on = (valueAt(project, node.id, 'fill.enabled', playhead) as number) >= 0.5;
  return (
    <>
      <OnOff nodeId={node.id} property="fill.enabled" on={on} label="Fill" />
      {on && (
        <>
          <ColorField value={colorNow ?? node.color} keyNavFor={node.id} compact={node.kind === 'limb'}
            onToggleTrack={() => toggleKeyframe(node.id, 'color')}
            onChange={(c) => setValue(node.id, 'color', c, `color.${node.id}`)} />
          <PropRow nodeId={node.id} property="fill.opacity" label="Opacity" />
        </>
      )}
    </>
  );
}

const CAPS: LineCap[] = ['butt', 'round', 'square'];
const JOINS: LineJoin[] = ['miter', 'round', 'bevel'];

function StrokeSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const updateNode = useEditor((s) => s.updateNode);
  const on = (valueAt(project, node.id, 'stroke.enabled', playhead) as number) >= 0.5;
  const colorNow = valueAt(project, node.id, 'stroke.color', playhead) as ColorStop;
  return (
    <>
      <OnOff nodeId={node.id} property="stroke.enabled" on={on} label="Stroke" />
      {on && (
        <>
          <ColorField value={colorNow} keyNavFor={node.id} property="stroke.color" label="Colour" compact
            onToggleTrack={() => toggleKeyframe(node.id, 'stroke.color')}
            onChange={(c) => setValue(node.id, 'stroke.color', c, `scolor.${node.id}`)} />
          <PropRow nodeId={node.id} property="stroke.width" label="Width" />
          <PropRow nodeId={node.id} property="stroke.opacity" label="Opacity" />
          <div className="row">
            <span className="prop-label" style={{ width: 40 }}>Cap</span>
            <div className="seg">
              {CAPS.map((c) => <button key={c} aria-pressed={(node.stroke?.lineCap ?? 'round') === c}
                onClick={() => updateNode(node.id, (n) => { n.stroke = { ...n.stroke, lineCap: c }; })}>{c}</button>)}
            </div>
          </div>
          <div className="row">
            <span className="prop-label" style={{ width: 40 }}>Join</span>
            <div className="seg">
              {JOINS.map((j) => <button key={j} aria-pressed={(node.stroke?.lineJoin ?? 'round') === j}
                onClick={() => updateNode(node.id, (n) => { n.stroke = { ...n.stroke, lineJoin: j }; })}>{j}</button>)}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** An animatable switch: writes 0/1 through setValue, so it keys like anything else. */
function OnOff({ nodeId, property, on, label }: { nodeId: string; property: string; on: boolean; label: string }) {
  const setValue = useEditor((s) => s.setValue);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  return (
    <div className="prop">
      <KeyNav nodeId={nodeId} property={property} onToggle={() => toggleKeyframe(nodeId, property)} />
      <span className="prop-label"><span className="t">{label}</span></span>
      <div className="seg" style={{ justifySelf: 'end' }}>
        <button aria-pressed={on} onClick={() => setValue(nodeId, property, 1, `${property}.${nodeId}`)}>On</button>
        <button aria-pressed={!on} onClick={() => setValue(nodeId, property, 0, `${property}.${nodeId}`)}>Off</button>
      </div>
    </div>
  );
}

/**
 * World or mascot, and where on the mascot. Switching keeps the layer where it is on
 * screen — core/layers.ts re-expresses its position in the new frame rather than reusing
 * numbers that meant something else in the old one.
 */
function AttachmentSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const setAttachment = useEditor((s) => s.setAttachment);
  const mode = attachmentOf(node);
  const rig = project.rig;
  const anchors = Object.values(rig.nodes).filter((n) => n.id !== node.id && !isInside(rig, n.id, node.id) && n.kind !== 'limb' && n.kind !== 'svgLayer');
  return (
    <>
      <div className="row">
        <div className="seg" style={{ flex: 1 }}>
          <button style={{ flex: 1 }} aria-pressed={mode === 'world'} title="Stays in composition space when the mascot moves"
            onClick={() => setAttachment(node.id, 'world')}>World</button>
          <button style={{ flex: 1 }} aria-pressed={mode === 'mascot'} title="Follows the mascot — its moves, turns and squash"
            onClick={() => setAttachment(node.id, 'mascot')}>Mascot</button>
        </div>
      </div>
      {mode === 'mascot' && (
        <>
          <div className="row">
            <span className="prop-label" style={{ width: 52 }}>Anchor</span>
            <select className="sel" style={{ flex: 1 }} value={node.parentId ?? ''}
              onChange={(e) => setAttachment(node.id, 'mascot', e.target.value)}>
              {anchors.map((n) => <option key={n.id} value={n.id}>{n.id === rig.rootId ? 'Head (body)' : n.name}</option>)}
            </select>
          </div>
          {node.surface.mapped && (
            <>
              <PropRow nodeId={node.id} property="surface.yaw" />
              <PropRow nodeId={node.id} property="surface.pitch" />
            </>
          )}
          <PropRow nodeId={node.id} property="flatOffset.x" label="Offset X" />
          <PropRow nodeId={node.id} property="flatOffset.y" label="Offset Y" />
          <p className="hint">{node.surface.mapped
            ? 'On the surface: yaw and pitch carry it round the head, and it hides past the rim.'
            : 'Off the silhouette, so it rides along as a flat offset. Drag it over the head to put it on the surface.'}</p>
        </>
      )}
    </>
  );
}

/**
 * When the layer is on screen. A range decides whether it EXISTS; its opacity keyframes
 * decide how it looks while it does, and the fades soften the range's own edges.
 */
function AppearanceSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setAppearance = useEditor((s) => s.setAppearance);
  const updateNode = useEditor((s) => s.updateNode);
  const tl = activeTimeline(project);
  const spans = appearanceSpans(tl, node.id);
  const span = spans.find((s) => playhead >= s.from && playhead <= s.to) ?? spans[0];
  const duration = tl.timelineDurationMs;
  const snaps = [playhead, ...blockStarts(tl), ...tl.tracks.flatMap((t) => t.keyframes.map((k) => k.time))];
  return (
    <>
      <RangeBar spanMs={duration} startMs={span?.from} endMs={span?.to} label="On screen" snaps={snaps}
        onChange={(s, e) => (s === undefined && e === undefined
          ? setAppearance(node.id, null)
          : setAppearance(node.id, { startMs: s ?? 0, endMs: e }))} />
      <div className="row">
        <span className="prop-label" style={{ width: 34 }}>Start</span>
        <NumberField value={Math.round(span?.from ?? 0)} step={10} onChange={(v) => setAppearance(node.id, { startMs: Math.max(0, v), endMs: span?.to ?? duration })} />
        <span className="prop-label" style={{ width: 28, marginLeft: 6 }}>End</span>
        <NumberField value={Math.round(span?.to ?? duration)} step={10} onChange={(v) => setAppearance(node.id, { startMs: span?.from ?? 0, endMs: Math.min(duration, v) })} />
      </div>
      <div className="row">
        <span className="prop-label" style={{ width: 34 }}>Fade in</span>
        <NumberField value={span?.entry.fadeInMs ?? 0} step={10} onChange={(v) => setAppearance(node.id, { startMs: span?.from ?? 0, endMs: span?.to ?? duration, fadeInMs: v })} />
        <span className="prop-label" style={{ width: 28, marginLeft: 6 }}>Out</span>
        <NumberField value={span?.entry.fadeOutMs ?? 0} step={10} onChange={(v) => setAppearance(node.id, { startMs: span?.from ?? 0, endMs: span?.to ?? duration, fadeOutMs: v })} />
      </div>
      <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        title="With this on, the layer is hidden in any state (timeline) that does not give it a range of its own">
        <input type="checkbox" checked={!!node.ranged} onChange={(e) => updateNode(node.id, (n) => { n.ranged = e.target.checked; })} />
        Only inside its ranges, in every state
      </label>
      <p className="hint">{spans.length ? `${spans.length > 1 ? `${spans.length} ranges on this timeline · ` : ''}${fmtSec(span!.from)} → ${fmtSec(span!.to)}` : 'Always on screen. Drag the bar to give it a range.'}</p>
    </>
  );
}

/** What is animating this layer, at a glance — and where to go to change it. */
function AnimationSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const tl = activeTimeline(project);
  const tracks = tl.tracks.filter((t) => t.nodeId === node.id);
  const mods = tl.modifiers.filter((m) => m.nodeId === node.id);
  if (!tracks.length && !mods.length) return <p className="hint" style={{ margin: 0 }}>Nothing animates this layer yet. Click any stopwatch to key a property.</p>;
  return (
    <div className="anim-list">
      {tracks.map((t) => (
        <button key={t.id} className="anim-row" title="Jump to its first keyframe" onClick={() => setPlayhead(t.keyframes[0]?.time ?? 0)}>
          <span>{PROP_LABEL[t.property] ?? t.property}</span>
          <span className="hint">{t.keyframes.length} key{t.keyframes.length === 1 ? '' : 's'} · {easingLabel(t.keyframes[0]?.easingOut ?? { type: 'linear' })}</span>
        </button>
      ))}
      {mods.map((m) => (
        <div key={m.id} className="anim-row"><span>{MODIFIERS[m.kind].label}</span><span className="hint">{m.frequency} Hz · Effects tab</span></div>
      ))}
    </div>
  );
}

/**
 * CURRENT → TARGET for one property, in one click: the value it reads right now, where
 * you want it, how long and on what curve. Writes two keyframes — never a chain through
 * whatever states lie between.
 */
function TweenToTarget({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const tweenProperty = useEditor((s) => s.tweenProperty);
  const choices = NUMERIC_PROPS.filter((p) => PROPS[p].on === 'node' && typeof valueAt(project, node.id, p, playhead) === 'number');
  const [prop, setProp] = useState(choices.includes('transform.scale.x') ? 'transform.scale.x' : choices[0]);
  const current = valueAt(project, node.id, prop, playhead) as number;
  const [target, setTarget] = useState<number | null>(null);
  const [dur, setDur] = useState(300);
  const [ease, setEase] = useState<string>('easeOut');
  if (!choices.length) return null;
  const goal = target ?? current;
  return (
    <>
      <div className="row">
        <select className="sel" style={{ flex: 1, minWidth: 0 }} value={prop} aria-label="Property"
          onChange={(e) => { setProp(e.target.value); setTarget(null); }}>
          {choices.map((p) => <option key={p} value={p}>{PROP_LABEL[p]}</option>)}
        </select>
      </div>
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Current</span><span className="tc">{fmtVal(current)}</span></div>
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Target</span>
        <NumberField value={goal} step={PROPS[prop].range?.[2] ?? 0.01} onChange={setTarget} /></div>
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Duration</span>
        <NumberField value={dur} step={10} onChange={(v) => setDur(Math.max(20, Math.round(v)))} /><span className="hint">ms</span></div>
      <div className="row"><span className="prop-label" style={{ flex: 1 }}>Easing</span>
        <select className="sel" value={ease} onChange={(e) => setEase(e.target.value)}>
          {EASING_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select></div>
      <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} disabled={goal === current}
        title={`Key ${fmtVal(current)} here and ${fmtVal(goal)} ${dur}ms later`}
        onClick={() => { tweenProperty(node.id, prop, goal, dur, namedEasing(ease)); setTarget(null); }}>
        Apply transition
      </button>
    </>
  );
}

const fmtVal = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/**
 * The canvas: its size, its rate, its length, its backdrop. Shown whenever nothing is
 * selected, because that is when the thing you are looking at IS the composition.
 * Changing the size reframes rather than distorts — the mascot keeps its pixel size and
 * stays centred.
 */
export function CompositionPanel() {
  const project = useEditor((s) => s.project);
  const setComposition = useEditor((s) => s.setComposition);
  const setTimelineDuration = useEditor((s) => s.setTimelineDuration);
  const commit = useEditor((s) => s.commit);
  const [bg, setBg] = useStageBg();
  const c = compOf(project);
  const preset = COMP_PRESETS.find((p) => p.width === c.width && p.height === c.height);
  const clamp = (v: number) => Math.min(COMP_MAX, Math.max(COMP_MIN, Math.round(v)));
  return (
    <Panel title="Composition" actions={<span className="tag">{c.width}×{c.height}</span>}>
      <div className="comp-presets">
        {COMP_PRESETS.map((p) => (
          <button key={p.label} className="btn sm" aria-pressed={preset === p} onClick={() => setComposition({ width: p.width, height: p.height })}>{p.label}</button>
        ))}
        <span className="tag" aria-pressed={!preset}>{preset ? 'preset' : 'custom'}</span>
      </div>
      <div className="row">
        <span className="prop-label" style={{ width: 44 }}>Width</span>
        <NumberField value={c.width} step={10} onChange={(v) => setComposition({ width: clamp(v) })} />
        <span className="prop-label" style={{ width: 44, marginLeft: 6 }}>Height</span>
        <NumberField value={c.height} step={10} onChange={(v) => setComposition({ height: clamp(v) })} />
      </div>
      <div className="row">
        <span className="prop-label" style={{ width: 44 }}>FPS</span>
        <NumberField value={project.fps} step={1} onChange={(v) => commit((p) => { p.fps = Math.min(120, Math.max(1, Math.round(v))); }, 'fps')} />
        <span className="prop-label" style={{ width: 44, marginLeft: 6 }}>Length</span>
        <NumberField value={Math.round(activeTimeline(project).timelineDurationMs) / 1000} step={0.1}
          onChange={(s) => setTimelineDuration(Math.max(0.2, s) * 1000)} />
        <span className="hint">s</span>
      </div>
      <div className="row">
        <span className="prop-label" style={{ width: 44 }}>Backdrop</span>
        <input type="color" aria-label="Backdrop colour" value={bg === 'transparent' ? '#17161b' : bg}
          onChange={(e) => setBg(e.target.value)} style={{ width: 40, height: 23, border: '1px solid var(--line)', borderRadius: 5, background: 'none', padding: 1 }} />
        <button className="btn sm" aria-pressed={bg === 'transparent'} onClick={() => setBg(bg === 'transparent' ? '#17161b' : 'transparent')}>Transparent</button>
      </div>
      <p className="hint">The mascot keeps its size and stays centred — a wider canvas gives it room, it never stretches it. Every export uses this size.</p>
    </Panel>
  );
}

/**
 * The limb: its two or three points, and the dials that shape what is drawn between
 * them. The points are also draggable on the stage — exactly those, never a Bézier.
 */
function LimbSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const l = node.limb;
  if (!l) return null;
  const hose = valueAt(project, node.id, 'limb.hose', playhead) as number;
  const labels: Record<string, [string, string]> = l.type === 'leg'
    ? { a: ['Hip X', 'Hip Y'], b: ['Knee X', 'Knee Y'], c: ['Ankle X', 'Ankle Y'] }
    : { a: ['Shoulder X', 'Shoulder Y'], b: ['Hand X', 'Hand Y'] };
  return (
    <>
      <OnOffHose nodeId={node.id} on={hose >= 0.5} />
      <PropRow nodeId={node.id} property="limb.length" />
      <PropRow nodeId={node.id} property="limb.thickness" />
      <PropRow nodeId={node.id} property="limb.bend" />
      <PropRow nodeId={node.id} property="limb.roundness" />
      <PropRow nodeId={node.id} property="limb.taper" />
      {l.type === 'leg' && (
        <>
          <div className="divider" />
          <PropRow nodeId={node.id} property="limb.foot.angle" />
          <PropRow nodeId={node.id} property="limb.foot.length" />
          <PropRow nodeId={node.id} property="limb.foot.width" />
        </>
      )}
      <Collapsible title={`Points · ${limbPoints(l).length}`} storageKey="insp-limbpts" defaultOpen={false}>
        {limbPoints(l).flatMap((k) => [
          <PropRow key={`${k}x`} nodeId={node.id} property={`limb.${k}.x`} label={labels[k][0]} />,
          <PropRow key={`${k}y`} nodeId={node.id} property={`limb.${k}.y`} label={labels[k][1]} />,
        ])}
      </Collapsible>
      <p className="hint">Drag the {limbPoints(l).length} points on the stage — {l.type === 'leg' ? 'hip, knee and ankle' : 'shoulder and hand'}. They ride the body.</p>
    </>
  );
}

function OnOffHose({ nodeId, on }: { nodeId: string; on: boolean }) {
  return <OnOff nodeId={nodeId} property="limb.hose" on={on} label="Rubber hose" />;
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

/** `bare` drops the panel chrome, for when it is already inside a collapsible section. */
export function CameraPanel({ bare }: { bare?: boolean } = {}) {
  const rows = (
    <>
      <PropRow nodeId={CAMERA_ID} property="camera.fov" />
      <PropRow nodeId={CAMERA_ID} property="camera.distance" />
      <PropRow nodeId={CAMERA_ID} property="camera.offset.x" />
      <PropRow nodeId={CAMERA_ID} property="camera.offset.y" />
      <p className="hint">Perspective 0° is orthographic — features slide flat across the face. Open it up and the near side swells while the rim hides behind the silhouette.</p>
    </>
  );
  return bare ? rows : <Panel title="Camera">{rows}</Panel>;
}
