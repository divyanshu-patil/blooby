import { useEditor } from '../core/store';
import { naturalShape, primitivePath, PRIMITIVE_SHAPES, type PrimitiveShape } from '../core/path';
import { valueAt } from '../core/scene';
import { KeyNav, NumberField } from './bits';
import type { RigNode } from '../core/types';

/**
 * The shape a layer draws, as an editable outline.
 *
 * Two ways in, both writing the same `shape.path`: pick a primitive and turn its dials, or
 * paste a `d` string. Keyframe it with the stopwatch and it morphs — one keyframe holding
 * a circle and the next holding a star is a real in-between, not a switch at the halfway
 * mark, because core/path.ts resamples both outlines and interpolates them.
 *
 * Everything is authored in a -0.5..0.5 box and scaled to the layer's own size, so the
 * dials describe an outline rather than a size, and a morph is about shape alone.
 */
export function ShapeEditor({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const updateNode = useEditor((s) => s.updateNode);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);

  // what is on screen right now, which is the animated value rather than the stored one
  const live = valueAt(project, node.id, 'shape.path', playhead);
  const path = typeof live === 'string' ? live : node.shapePath;
  const params = node.shape;
  // with no outline of its own a layer still HAS a shape — the body is an ellipse, an eye
  // is a stadium — so the editor opens on that rather than on nothing
  const natural = naturalShape(node.kind, node.primitive);
  const current: PrimitiveShape = params?.kind ?? (path !== undefined ? 'custom' : natural);

  const write = (d: string | undefined, label: string) => {
    // setValue keys it when the property is already animated and pokes the base pose when
    // it is not — the same rule every other property in this panel follows
    if (d === undefined) updateNode(node.id, (n) => { n.shapePath = undefined; n.shape = undefined; });
    else setValue(node.id, 'shape.path', d, label);
  };

  const applyPrimitive = (kind: PrimitiveShape) => {
    if (kind === 'custom') return;   // not a thing you can pick — it is what typing produces
    const next = {
      kind, points: params?.points ?? (kind === 'star' ? 5 : 6),
      innerRatio: params?.innerRatio ?? 0.42,
      cornerRadius: params?.cornerRadius ?? (kind === 'pill' ? 0.5 : 0.2),
      vertexRadius: params?.vertexRadius ?? 0,
      rotation: params?.rotation ?? 0,
    };
    updateNode(node.id, (n) => { n.shape = next; });
    write(primitivePath(kind, next), `shape.${node.id}`);
  };

  const tweak = (patch: Partial<NonNullable<RigNode['shape']>>) => {
    if (!params) return;
    const next = { ...params, ...patch };
    updateNode(node.id, (n) => { n.shape = next; });
    write(primitivePath(next.kind, next), `shape.${node.id}`);
  };

  return (
    <>
      <div className="row">
        <span className="panel-title" style={{ flex: 1 }}>Shape</span>
        <KeyNav nodeId={node.id} property="shape.path" onToggle={() => toggleKeyframe(node.id, 'shape.path')} />
      </div>

      {/* wraps: five shapes plus Clear overflow the rail on one line, and the clipped
          button is the one that undoes the change */}
      <div className="row wrap">
        {PRIMITIVE_SHAPES.map((k) => (
          <button key={k} className="btn sm" aria-pressed={current === k}
            title={k === natural ? `${k} — this layer's natural shape` : `Use a ${k}`}
            onClick={() => applyPrimitive(k)}>{k}</button>
        ))}
        {/* only reachable, never chosen: it is whatever was typed or dragged */}
        {current === 'custom' && <span className="tag" title="Hand-edited outline">custom</span>}
        {path !== undefined && (
          <button className="btn ghost sm" title="Back to the layer's plain shape"
            onClick={() => write(undefined, `shape.${node.id}`)}>Clear</button>
        )}
      </div>

      {params && (params.kind === 'polygon' || params.kind === 'star') && (
        <div className="prop">
          <span /><label className="prop-label"><span className="t">{params.kind === 'star' ? 'Points' : 'Sides'}</span>
            <input type="range" min={3} max={16} step={1} value={params.points ?? 5}
              onChange={(e) => tweak({ points: +e.target.value })} />
          </label><NumberField value={params.points ?? 5} onChange={(v) => tweak({ points: Math.round(v) })} />
        </div>
      )}
      {params?.kind === 'star' && (
        <div className="prop">
          <span /><label className="prop-label"><span className="t">Waist</span>
            <input type="range" min={0.05} max={0.9} step={0.01} value={params.innerRatio ?? 0.42}
              onChange={(e) => tweak({ innerRatio: +e.target.value })} />
          </label><NumberField value={params.innerRatio ?? 0.42} step={0.05} onChange={(v) => tweak({ innerRatio: v })} />
        </div>
      )}
      {params && (params.kind === 'star' || params.kind === 'polygon') && (
        <div className="prop">
          <span /><label className="prop-label"><span className="t">Point radius</span>
            <input type="range" min={0} max={1} step={0.02} value={params.vertexRadius ?? 0}
              onChange={(e) => tweak({ vertexRadius: +e.target.value })} />
          </label><NumberField value={params.vertexRadius ?? 0} step={0.1} onChange={(v) => tweak({ vertexRadius: v })} />
        </div>
      )}
      {(params?.kind === 'rect' || params?.kind === 'pill') && (
        <div className="prop">
          <span /><label className="prop-label"><span className="t">Corners</span>
            <input type="range" min={0} max={0.5} step={0.01} value={params.cornerRadius ?? 0.2}
              onChange={(e) => tweak({ cornerRadius: +e.target.value })} />
          </label><NumberField value={params.cornerRadius ?? 0.2} step={0.05} onChange={(v) => tweak({ cornerRadius: v })} />
        </div>
      )}
      {/* circles included: it is a spline now, so turning it moves real control points —
          which is what you are about to drag, and what a morph aligns against. Hiding it
          made "the circle is not rotatable" true in the UI even after it stopped being
          true in the geometry. */}
      {params && (
        <div className="prop">
          <span /><label className="prop-label"><span className="t">Turn</span>
            <input type="range" min={-180} max={180} step={1} value={params.rotation ?? 0}
              onChange={(e) => tweak({ rotation: +e.target.value })} />
          </label><NumberField value={params.rotation ?? 0} onChange={(v) => tweak({ rotation: v })} />
        </div>
      )}

      {path !== undefined && (
        <>
          <textarea className="ask pathdata" spellCheck={false} value={path} aria-label="SVG path data"
            title="The outline, in a -0.5..0.5 box. Edit it and the layer changes; keyframe it and it morphs."
            onChange={(e) => {
              // hand-edited: the primitive dials no longer describe it, so drop them
              updateNode(node.id, (n) => { n.shape = undefined; });
              write(e.target.value, `shape.${node.id}`);
            }} />
          <p className="hint">
            Authored in a −0.5…0.5 box and scaled to this layer. Put a keyframe here, move the
            playhead, pick a different shape — the in-between is a real morph.
          </p>
        </>
      )}
    </>
  );
}
