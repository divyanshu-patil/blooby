import { useState } from 'react';
import { useEditor } from '../core/store';
import { naturalShape, primitivePath, SHAPE_DIALS, type ShapeParams } from '../core/path';
import { libraryOutline, shapeById, shapeIdOf, SHAPE_LIBRARY } from '../core/emitters';
import { looksLikeSvg, svgOutline } from '../core/svg';
import { MORPH_MODE_NAMES, MORPH_MODES, morphModeOf, type MorphMode } from '../core/easing';
import { activeTrackFor, valueAt } from '../core/scene';
import { activeTimeline } from '../core/types';
import { KeyNav, NumberField } from './bits';
import type { RigNode, ShapeKind } from '../core/types';

/**
 * The shape a layer draws, as something you pick, key and morph.
 *
 *   Shape  [ Pebble ▾ ]  ◇ Add keyframe
 *
 * Picking a shape writes `shape.path` the way every other control writes its property:
 * into the keyframe under the playhead when the shape is animated, onto the resting pose
 * when it is not. So "0ms Pebble, 750ms Octopus" is: key Pebble, move the playhead, pick
 * Octopus — the in-between is a real morph because core/path.ts resamples both outlines.
 *
 * Every entry in the library works here, generated outlines and drawn artwork alike, and
 * so does any SVG pasted into the path field: the morph does not care where an outline
 * came from, and nobody has to match points by hand.
 */
const DIAL: Record<keyof ShapeParams, { label: string; min: number; max: number; step: number; fallback: number }> = {
  points: { label: 'Points', min: 3, max: 16, step: 1, fallback: 5 },
  innerRatio: { label: 'Waist', min: 0.05, max: 0.9, step: 0.01, fallback: 0.42 },
  cornerRadius: { label: 'Corners', min: 0, max: 0.5, step: 0.01, fallback: 0.3 },
  vertexRadius: { label: 'Point radius', min: 0, max: 1, step: 0.02, fallback: 0 },
  rotation: { label: 'Turn', min: -180, max: 180, step: 1, fallback: 0 },
};

export function ShapeEditor({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const updateNode = useEditor((s) => s.updateNode);
  const addKeyframeNow = useEditor((s) => s.addKeyframeNow);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const setShapeMorph = useEditor((s) => s.setShapeMorph);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const editPoints = useEditor((s) => s.editPoints);
  const setEditPoints = useEditor((s) => s.setEditPoints);
  const commit = useEditor((s) => s.commit);
  const [picking, setPicking] = useState(false);
  const [showPath, setShowPath] = useState(false);

  // what is on screen right now, which is the animated value rather than the stored one
  const live = valueAt(project, node.id, 'shape.path', playhead);
  const path = typeof live === 'string' ? live : node.shapePath;
  const params = node.shape;
  const natural = naturalShape(node.kind, node.primitive);
  // named from the outline itself where it can be, so a keyframed shape reads correctly
  const currentId = shapeIdOf(path) ?? params?.kind ?? (path !== undefined ? 'custom' : natural);
  const current = shapeById(currentId);
  const dials = SHAPE_DIALS[currentId as ShapeKind] ?? [];

  const track = activeTrackFor(activeTimeline(project), node.id, 'shape.path', playhead);
  const keys = track?.keyframes ?? [];
  let at = keys.length - 1;
  while (at > 0 && keys[at].time > playhead + 1) at--;
  const kf = keys[at], next = keys[at + 1];
  const onKey = !!kf && Math.abs(kf.time - playhead) < 1;

  const write = (d: string | undefined, label: string) => {
    // setValue keys it when the property is already animated and pokes the base pose when
    // it is not — the same rule every other property in this panel follows
    if (d === undefined) updateNode(node.id, (n) => { n.shapePath = undefined; n.shape = undefined; });
    else setValue(node.id, 'shape.path', d, label);
  };

  const pick = (id: string) => {
    setPicking(false);
    const s = shapeById(id);
    if (!s) return;
    const dialsOf = s.outline ? SHAPE_DIALS[s.outline] ?? [] : [];
    // carry over the dials that still mean something for the new shape
    const next: NonNullable<RigNode['shape']> = { kind: id };
    for (const k of dialsOf) if (params?.[k] !== undefined) next[k] = params[k];
    updateNode(node.id, (n) => { n.shape = next; }, `shapekind.${node.id}`);
    const d = libraryOutline(id, next);
    if (d) write(d, `shape.${node.id}`);
  };

  const tweak = (patch: ShapeParams) => {
    const kind = (params?.kind ?? currentId) as ShapeKind;
    const next = { ...params, kind, ...patch };
    updateNode(node.id, (n) => { n.shape = next; }, `shapedial.${node.id}`);
    write(primitivePath(kind, next), `shape.${node.id}`);
  };

  const merge = () => commit((p) => {
    // several vector paths → one outline: the only way to morph or hand-edit artwork
    const n = p.rig.nodes[node.id];
    if (!n?.svg?.paths?.length) return;
    const d = n.svg.paths.filter((x) => x.fill !== null).map((x) => x.d).join(' ') || n.svg.paths.map((x) => x.d).join(' ');
    n.kind = 'primitive';
    n.primitive = { shape: 'pill' };
    n.shapePath = d;
    n.svg = { ...n.svg, paths: undefined };
  });

  if (node.kind === 'svgLayer' && node.svg?.paths?.length) {
    return (
      <>
        <div className="row"><span className="prop-label" style={{ flex: 1 }}>Vector artwork</span>
          <span className="tag">{node.svg.paths.length} paths</span></div>
        <p className="hint">Each path keeps its own colour. Merge them into one outline to morph it or drag its points.</p>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={merge}>Merge into one shape</button>
      </>
    );
  }
  if (node.kind === 'svgLayer' || node.kind === 'group' || node.kind === 'limb') return null;

  return (
    <>
      <div className="row">
        <KeyNav nodeId={node.id} property="shape.path" onToggle={() => toggleKeyframe(node.id, 'shape.path')} />
        <div className="shape-pick">
          <button className="btn sm shape-current" aria-expanded={picking} onClick={() => setPicking((v) => !v)}
            title="Pick a shape. With the shape keyframed, picking changes the keyframe under the playhead.">
            {current
              ? <svg viewBox={current.viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: current.markup }} />
              : <span className="shape-custom" aria-hidden>✎</span>}
            <span className="shape-name">{current?.name ?? 'Custom'}</span>
            <span aria-hidden>▾</span>
          </button>
          {picking && (
            <div className="shape-grid" role="listbox" aria-label="Shapes">
              {SHAPE_LIBRARY.map((s) => (
                <button key={s.id} role="option" aria-selected={s.id === currentId} className="shapepick-cell" title={s.name}
                  onClick={() => pick(s.id)}>
                  <svg viewBox={s.viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: s.markup }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost sm" disabled={onKey}
          title={onKey ? 'There is a shape keyframe here — pick a shape to change it' : 'Key the current shape at the playhead; pick another later and it morphs'}
          onClick={() => addKeyframeNow(node.id, 'shape.path')}>◇ {onKey ? 'Keyed' : 'Add keyframe'}</button>
      </div>

      {dials.filter((k) => k !== 'rotation' || params?.kind).map((k) => {
        const spec = DIAL[k];
        const v = params?.[k] ?? spec.fallback;
        return (
          <div className="prop" key={k}>
            <span /><label className="prop-label"><span className="t">{k === 'points' && currentId === 'polygon' ? 'Sides' : spec.label}</span>
              <input type="range" min={spec.min} max={spec.max} step={spec.step} value={v}
                onChange={(e) => tweak({ [k]: +e.target.value })} />
            </label>
            <NumberField value={v} step={spec.step} onChange={(n) => tweak({ [k]: Math.min(spec.max, Math.max(spec.min, k === 'points' ? Math.round(n) : n)) })} />
          </div>
        );
      })}

      {/* how THIS shape becomes the next one — the easing on the outgoing keyframe, and
          the gap to the next, which is what a morph's duration is */}
      {kf && next && (
        <div className="row">
          <span className="prop-label" style={{ width: 44 }}>Morph</span>
          <select className="sel" style={{ flex: 1, minWidth: 0 }} aria-label="Morph style"
            value={morphModeOf(kf.easingOut) ?? ''}
            onChange={(e) => setShapeMorph(node.id, e.target.value as MorphMode)}>
            {!morphModeOf(kf.easingOut) && <option value="">Custom curve</option>}
            {MORPH_MODE_NAMES.map((m) => <option key={m} value={m}>{MORPH_MODES[m].label}</option>)}
          </select>
          <NumberField value={Math.round(next.time - kf.time)} step={10}
            onChange={(ms) => setShapeMorph(node.id, morphModeOf(kf.easingOut) ?? 'morph', ms)} />
          <span className="hint">ms</span>
        </div>
      )}

      {keys.length > 1 && (
        <div className="shape-keys" aria-label="Shape keyframes">
          {keys.map((k) => (
            <button key={k.id} className="shape-key" aria-pressed={Math.abs(k.time - playhead) < 1}
              title="Jump to this shape keyframe" onClick={() => setPlayhead(k.time)}>
              <b>{Math.round(k.time)}ms</b> {typeof k.value === 'string' ? shapeById(shapeIdOf(k.value) ?? '')?.name ?? 'Custom' : ''}
            </button>
          ))}
        </div>
      )}

      <div className="row wrap">
        {path !== undefined && (
          <button className="btn sm" aria-pressed={editPoints} title="Drag the outline's own anchor points on the stage"
            onClick={() => setEditPoints(!editPoints)}>{editPoints ? 'Editing points' : 'Edit points'}</button>
        )}
        <button className="btn ghost sm" aria-expanded={showPath} onClick={() => setShowPath((v) => !v)}
          title="The outline as SVG path data — paste any SVG here to use it as this shape">Path data</button>
        {path !== undefined && (
          <button className="btn ghost sm" title="Back to the layer's plain shape"
            onClick={() => write(undefined, `shape.${node.id}`)}>Clear</button>
        )}
      </div>

      {showPath && (
        <>
          <textarea className="ask pathdata" spellCheck={false} value={path ?? ''} aria-label="SVG path data"
            placeholder="Paste an SVG, or a path d"
            title="The outline, in a -0.5..0.5 box. Edit it and the layer changes; keyframe it and it morphs."
            onPaste={(e) => {
              // a whole SVG pasted here becomes the outline — any icon is a shape
              const text = e.clipboardData.getData('text');
              if (!looksLikeSvg(text)) return;
              const d = svgOutline(text);
              if (!d) return;
              e.preventDefault();
              updateNode(node.id, (n) => { n.shape = undefined; });
              write(d, `shape.${node.id}`);
            }}
            onChange={(e) => {
              // hand-edited: the primitive dials no longer describe it, so drop them
              updateNode(node.id, (n) => { n.shape = undefined; });
              write(e.target.value, `shape.${node.id}`);
            }} />
          <p className="hint">Authored in a −0.5…0.5 box and scaled to this layer. Any outline morphs into any other.</p>
        </>
      )}
    </>
  );
}
