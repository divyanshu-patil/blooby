import { useState } from 'react';
import { useEditor } from '../core/store';
import { EFFECT_KINDS, EFFECTS, makeEffect } from '../core/effects';
import { layerOrder } from '../core/layers';
import { PropRow } from './bits';
import { ColorPicker } from './ColorPicker';
import type { BlendMode, EffectKind, RigNode } from '../core/types';

/**
 * A layer's look beyond its paint: its effect stack, how it composites (blend, mask), a
 * gradient fill, and its 2.5D depth. Every number here is a registered property, so each row
 * keys like any other and the copilot can drive it.
 */

/** The effect stack: add, reorder by removing and re-adding, toggle, tune — each param keyframeable. */
export function EffectsSection({ node }: { node: RigNode }) {
  const updateNode = useEditor((s) => s.updateNode);
  const [adding, setAdding] = useState<EffectKind | ''>('');
  const list = node.effects ?? [];
  const free = EFFECT_KINDS.filter((k) => !list.some((e) => e.kind === k));
  return (
    <>
      {list.map((e) => {
        const spec = EFFECTS[e.kind];
        return (
          <div key={e.kind} className="fx-card">
            <div className="row">
              <label className="prop-label" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }} title={spec.blurb}>
                <input type="checkbox" checked={e.enabled !== false} aria-label={`${spec.label} on`}
                  onChange={(ev) => updateNode(node.id, (n) => { const x = n.effects?.find((y) => y.kind === e.kind); if (x) x.enabled = ev.target.checked; }, `fxon.${node.id}`)} />
                <span className="t">{spec.label}</span>
                {!spec.lottie && <span className="tag" title="Drawn in the editor and GIF/MP4/PNG; a .lottie cannot carry it">no lottie</span>}
              </label>
              {spec.color && (
                <ColorPicker value={e.color ?? { r: 255, g: 255, b: 255, a: 1 }} label={spec.label}
                  onChange={(c) => updateNode(node.id, (n) => { const x = n.effects?.find((y) => y.kind === e.kind); if (x) x.color = c; }, `fxcol.${node.id}.${e.kind}`)} />
              )}
              <button className="btn ghost sm icon" title={`Remove ${spec.label}`} aria-label={`Remove ${spec.label}`}
                onClick={() => updateNode(node.id, (n) => { n.effects = n.effects?.filter((y) => y.kind !== e.kind); if (!n.effects?.length) delete n.effects; })}>✕</button>
            </div>
            {Object.keys(spec.params).map((param) => <PropRow key={param} nodeId={node.id} property={`effect.${e.kind}.${param}`} label={param} />)}
          </div>
        );
      })}
      {free.length > 0 && (
        <div className="row" style={{ gap: 4 }}>
          <select className="sel" style={{ flex: 1, minWidth: 0 }} aria-label="Effect to add" value={adding} onChange={(e) => setAdding(e.target.value as EffectKind)}>
            <option value="">Add an effect…</option>
            {free.map((k) => <option key={k} value={k} title={EFFECTS[k].blurb}>{EFFECTS[k].label}</option>)}
          </select>
          <button className="btn sm" disabled={!adding}
            onClick={() => { if (adding) updateNode(node.id, (n) => { n.effects = [...(n.effects ?? []), makeEffect(adding)]; }); setAdding(''); }}>Add</button>
        </div>
      )}
      {!list.length && <p className="hint">Glow, blur, shadow, RGB split, slices, scanlines, flicker, jitter, echo trails, goo — stacked in order, every value keyframeable.</p>}
    </>
  );
}

const BLENDS: BlendMode[] = ['normal', 'screen', 'add', 'multiply', 'overlay', 'difference'];

/** How the layer sits on what is under it: its blend mode, and a mask from another layer's outline. */
export function CompositeSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const updateNode = useEditor((s) => s.updateNode);
  const others = layerOrder(project.rig).filter((n) => n.id !== node.id && n.kind !== 'text' && n.kind !== 'group');
  return (
    <>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Blend</span>
        <select className="sel" aria-label="Blend mode" value={node.blend ?? 'normal'}
          onChange={(e) => updateNode(node.id, (n) => { if (e.target.value === 'normal') delete n.blend; else n.blend = e.target.value as BlendMode; })}>
          {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }} title="Clip this layer, and what it holds, to another layer's outline — as that layer moves">Mask</span>
        <select className="sel" style={{ maxWidth: 140 }} aria-label="Mask layer" value={node.mask?.nodeId ?? ''}
          onChange={(e) => updateNode(node.id, (n) => { if (!e.target.value) delete n.mask; else n.mask = { nodeId: e.target.value, invert: n.mask?.invert }; })}>
          <option value="">none</option>
          {others.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        {node.mask && (
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Show only what is OUTSIDE the mask's outline">
            <input type="checkbox" checked={!!node.mask.invert} onChange={(e) => updateNode(node.id, (n) => { if (n.mask) n.mask.invert = e.target.checked; })} /> invert
          </label>
        )}
      </div>
      {node.mask && <p className="hint">Hide the mask layer itself if it should only cut — its outline still clips.</p>}
    </>
  );
}

/** A gradient fill: linear or radial, two or three stops, its angle keyframeable. */
export function GradientSection({ node }: { node: RigNode }) {
  const updateNode = useEditor((s) => s.updateNode);
  const g = node.gradient;
  if (!g) {
    return (
      <button className="btn sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => updateNode(node.id, (n) => { n.gradient = { type: 'linear', angle: 90, stops: [{ at: 0, color: { ...n.color } }, { at: 1, color: { r: 40, g: 30, b: 90, a: 1 } }] }; })}>
        Use a gradient fill
      </button>
    );
  }
  return (
    <>
      <div className="row" style={{ gap: 4 }}>
        <div className="seg">
          {(['linear', 'radial'] as const).map((t) => (
            <button key={t} aria-pressed={g.type === t} onClick={() => updateNode(node.id, (n) => { if (n.gradient) n.gradient.type = t; })}>{t}</button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => updateNode(node.id, (n) => { delete n.gradient; })}>Flat fill</button>
      </div>
      <PropRow nodeId={node.id} property="gradient.angle" />
      <div className="row" style={{ gap: 6 }}>
        {g.stops.map((st, i) => (
          <ColorPicker key={i} value={st.color} label={`Stop ${i + 1}`}
            onChange={(c) => updateNode(node.id, (n) => { if (n.gradient) n.gradient.stops[i] = { ...n.gradient.stops[i], color: c }; }, `grad.${node.id}.${i}`)} />
        ))}
        {g.stops.length < 3 && (
          <button className="btn ghost sm" title="A middle stop"
            onClick={() => updateNode(node.id, (n) => { if (n.gradient) n.gradient.stops = [n.gradient.stops[0], { at: 0.5, color: { r: 255, g: 255, b: 255, a: 1 } }, n.gradient.stops[n.gradient.stops.length - 1]]; })}>+ stop</button>
        )}
      </div>
    </>
  );
}

/** 2.5D: depth (parallax and scale with the camera) and card-flip turns. */
export function DepthSection({ node }: { node: RigNode }) {
  return (
    <>
      {node.parentId === null && <PropRow nodeId={node.id} property="depth.z" />}
      <PropRow nodeId={node.id} property="depth.rotateX" />
      <PropRow nodeId={node.id} property="depth.rotateY" />
      <p className="hint">{node.kind === 'body'
        ? 'Rotate spins the mascot’s sphere — its face goes round the back.'
        : 'Depth pushes a world layer away: smaller, and it pans and zooms less with the camera. Rotate narrows it like a card turning.'}</p>
    </>
  );
}
