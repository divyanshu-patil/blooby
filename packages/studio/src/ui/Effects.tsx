import { useState } from 'react';
import { useEditor } from '../core/store';
import { activeTimeline, MODIFIER_AXES, MODIFIERS } from '../core/types';
import { scopeSpan } from '../core/scene';
import { blockStarts } from '../core/timeline';
import { hexColor, parseHex } from '../core/color';
import { NumberField } from './bits';
import { Collapsible } from './Collapsible';
import { EffectPicker, MODIFIER_CHOICES, type EffectChoice } from './EffectPicker';
import { PartEditor } from './PartEditor';
import { confetti } from '../core/defaults';
import { EASING_NAMES, namedEasing } from '../core/easing';
import { RangeBar } from './RangeBar';

/** Ready-made emitters — the same record with different numbers, which is the point. */
/** A sentinel target: not a layer, expanded to every eye when an effect is added. */
const BOTH_EYES = '__eyes';

/** Everything the Effects drawer offers, with a line each for the list. */
const EFFECT_CHOICES: EffectChoice[] = [
  {
    key: 'confetti', label: 'Confetti', group: 'effect', burstMs: 1500,
    help: 'A burst of paper strips and ribbons in five colours, raining down from the playhead.',
    emitter: (nodeId) => confetti(nodeId),
  },
  {
    key: 'glyphs', label: 'Glyphs', group: 'effect',
    help: 'Characters or symbols drifting off and fading — zzz over a sleeper, ♪ over a singer.',
    emitter: (nodeId) => ({
      name: 'glyphs', glyphs: [],
      parts: [
        { id: 'g1', shapeId: 'zed', weight: 1, speed: 1.1, sizeScale: 0.7, spin: 0 },
        { id: 'g2', shapeId: 'zed', weight: 1, speed: 1, sizeScale: 0.95, spin: 0 },
        { id: 'g3', shapeId: 'zed', weight: 1, speed: 0.85, sizeScale: 1.2, spin: 0 },
      ],
      color: { r: 108, g: 106, b: 128, a: 1 }, size: 26,
      path: 'arc', from: { nodeId, x: 46, y: -34 }, to: { nodeId, x: 118, y: -150 }, bow: 22,
      rateMs: 700, lifeMs: 2100, count: 3, fadeStart: 0.45,
      scaleFrom: 0.45, scaleTo: 1.3, spin: -10, wobble: 5, wobbleFrequency: 1.2, seed: 7,
      easing: { type: 'preset', name: 'easeOut' }, speedJitter: 0.25,
    }),
  },
  {
    key: 'drops', label: 'Drops', group: 'effect',
    help: 'Teardrops falling and curving away. Pin the start to an eye and they come out of it.',
    emitter: (nodeId) => ({
      name: 'drops', glyphs: [],
      parts: [
        { id: 'd1', shapeId: 'drop', weight: 1, speed: 1, sizeScale: 1, spin: 0 },
        { id: 'd2', shapeId: 'drop-small', weight: 1, speed: 1.15, sizeScale: 0.7, spin: 0 },
      ],
      color: { r: 96, g: 160, b: 225, a: 1 }, size: 17,
      path: 'fall', from: { nodeId, x: 0, y: 12 }, to: { nodeId, x: -22, y: 150 }, bow: 8,
      rateMs: 380, lifeMs: 1200, count: 4, fadeStart: 0.65,
      scaleFrom: 0.7, scaleTo: 1.1, spin: 0, wobble: 2, wobbleFrequency: 1.2, seed: 2,
      easing: { type: 'preset', name: 'easeIn' }, speedJitter: 0.3,
    }),
  },
  {
    key: 'orbit', label: 'Orbit', group: 'effect',
    help: 'Objects circling overhead on an ellipse you can size, spaced evenly round it.',
    emitter: (nodeId) => ({
      name: 'orbit', glyphs: [],
      parts: [
        { id: 'o1', shapeId: 'spark', weight: 1, speed: 1, sizeScale: 1, spin: 0 },
        { id: 'o2', shapeId: 'star', weight: 1, speed: 1, sizeScale: 0.85, spin: 0 },
        { id: 'o3', shapeId: 'heart', weight: 1, speed: 1, sizeScale: 0.9, spin: 0 },
      ],
      color: { r: 84, g: 82, b: 112, a: 1 }, size: 20, path: 'orbit',
      from: { nodeId, x: 0, y: -128 }, to: { x: 0, y: 0 }, bow: 0, radiusX: 104, radiusY: 34,
      rateMs: 600, lifeMs: 2400, count: 4, fadeStart: 0.85,
      scaleFrom: 0.85, scaleTo: 1, spin: 40, wobble: 3, wobbleFrequency: 1.2, seed: 5,
      speedJitter: 0,
    }),
  },
];



/**
 * Non-destructive layers on top of the keyframes. Baked to real keys on export.
 * Scoped by whether a clip is selected on the timeline: select one and "+ Shake" etc.
 * add an effect that only runs during that clip; with nothing selected they're global,
 * same as before per-clip effects existed. The two lists are never mixed in one view —
 * contextual editing (select a clip → its own controls) over one panel showing everything.
 */
export function Effects() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const selectedBlockId = useEditor((s) => s.selectedBlockId);
  const playhead = useEditor((s) => s.playhead);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'modifier' | 'effect' | null>(null);
  const selectBlock = useEditor((s) => s.selectBlock);
  const addModifier = useEditor((s) => s.addModifier);
  const updateModifier = useEditor((s) => s.updateModifier);
  const removeModifier = useEditor((s) => s.removeModifier);
  const addEmitter = useEditor((s) => s.addEmitter);
  const updateEmitter = useEditor((s) => s.updateEmitter);
  const removeEmitter = useEditor((s) => s.removeEmitter);
  const selectEmitter = useEditor((s) => s.selectEmitter);
  const addSvgAsset = useEditor((s) => s.addSvgAsset);
  const selectedEmitterId = useEditor((s) => s.selectedEmitterId);

  const tl = activeTimeline(project);
  const nodeName = (id: string) => project.rig.nodes[id]?.name ?? id;

  const block = selectedBlockId ? tl.blocks.find((b) => b.id === selectedBlockId) : null;
  // the block can vanish out from under a stale id for one render (removed elsewhere) —
  // fall back to global rather than silently offering to add effects to a dead clip.
  const clipScoped = !!selectedBlockId && !!block;
  const list = tl.modifiers.filter((m) => (clipScoped ? m.blockId === selectedBlockId : !m.blockId));
  const scope = clipScoped ? selectedBlockId! : undefined;

  // The layers a new effect can land on. Body, both eyes together, then each eye — the
  // three anyone actually wants — and everything else behind a dropdown, so a rig with a
  // dozen custom layers does not push the useful buttons off the panel.
  const eyes = Object.values(project.rig.nodes).filter((n) => n.kind === 'eye');
  const others = Object.values(project.rig.nodes).filter((n) => n.kind !== 'eye' && n.id !== project.rig.rootId);
  const quick = [
    { id: project.rig.rootId, label: project.rig.nodes[project.rig.rootId]?.name ?? 'Body' },
    ...(eyes.length > 1 ? [{ id: BOTH_EYES, label: 'Both eyes' }] : []),
    ...eyes.map((n) => ({ id: n.id, label: n.name })),
  ];
  const known = (id: string | null) => !!id && (id === BOTH_EYES || !!project.rig.nodes[id]);
  const target = known(targetId) ? targetId! : (selection[0] ?? project.rig.rootId);
  // BOTH_EYES is not a node, so anything that needs real ids expands it
  const targetIds = target === BOTH_EYES ? eyes.map((n) => n.id) : [target];
  const emitters = (tl.emitters ?? []).filter((e) => (clipScoped ? e.blockId === selectedBlockId : !e.blockId));
  const span = scopeSpan(tl, scope)[1];
  /** One per targeted layer, so "both eyes" is one click rather than two identical ones. */
  const addToTargets = (make: (nodeId: string) => void) => targetIds.forEach(make);

  /**
   * Read an .svg off disk, keep it with the project, and point this emitter at it.
   *
   * Only the inside of the <svg> is kept, plus its viewBox — the outer element is
   * re-created by the renderer at whatever size the particle is, so a file authored at
   * 512px and one authored at 24px both come out the same size.
   */
  const importSvg = (emitterId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const box = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
      const inner = /<svg[^>]*>([\s\S]*)<\/svg>/i.exec(text)?.[1];
      if (!inner) { alert('That file does not look like an SVG.'); return; }
      const id = addSvgAsset(file.name.replace(/\.svg$/i, ''), inner.trim(), box ?? '0 0 24 24');
      updateEmitter(emitterId, (x) => {
        x.svgAssetId = id;
        x.svg = { sourceMarkup: inner.trim(), viewBox: box ?? '0 0 24 24' };
      });
    };
    input.click();
  };

  /** Every layer, so an emitter's endpoints can be pinned to one — tears to an eye. */
  const anchors = Object.values(project.rig.nodes);
  // the playhead in the scope's own frame, so "burst here" means here whichever scope
  // the panel is currently editing
  const clipStart = clipScoped ? blockStarts(tl)[tl.blocks.findIndex((b) => b.id === selectedBlockId)] ?? 0 : 0;
  const localPlayhead = Math.max(0, Math.min(span, Math.round(playhead - clipStart)));

  return (
    <>
      <div className="scopebar">
        {clipScoped ? (
          <>
            <span className="dot-status ok" />
            <span>Scoped to <strong>{block!.name}</strong></span>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => selectBlock(null)}>Make global</button>
          </>
        ) : (
          <span>Global — select a clip on the strip to scope new effects to it.</span>
        )}
      </div>

      {/* which layer a new effect lands on. Clicking the one already chosen clears it back
          to the body, so "just the eyes" and "the whole thing" are both one click away. */}
      <div className="row targetbar wrap" data-tour="fx-target">
        <span className="prop-label">Apply to</span>
        <span className="spacer" />
        {quick.map((q) => (
          <button key={q.id} className="btn sm" aria-pressed={target === q.id}
            title={target === q.id ? `${q.label} — click again for the body` : `New effects go on ${q.label}`}
            onClick={() => setTargetId(target === q.id ? null : q.id)}>{q.label}</button>
        ))}
        {/* only when there is something to choose: a default rig has no other layers, and
            an empty dropdown is a control that does nothing */}
        {others.length > 0 && (
          <select className="sel" aria-label="Another layer"
            value={others.some((n) => n.id === target) ? target : ''}
            onChange={(e) => setTargetId(e.target.value || null)}>
            <option value="">Other…</option>
            {others.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
      </div>

      <Collapsible title="Modifiers" storageKey="modifiers" badge={list.length || undefined} actions={
        <button className="btn sm" onClick={() => setPicking('modifier')}>+ Add…</button>
      }>
      {!list.length && (
        <p className="empty-note">
          Procedural motion stacked on whatever the keyframes are
          doing{clipScoped ? ', for as long as this clip plays' : ''}. Add one to see them all,
          each with a preview.
        </p>
      )}
      {list.map((m) => (
        <div key={m.id} className="fxcard">
          <div className="row">
            <strong style={{ font: '700 11px var(--display)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{m.kind}</strong>
            <span className="tag">{nodeName(m.nodeId)}{m.kind === 'stretch' && m.nodeId === project.rig.rootId ? ' + all' : m.kind === 'stretch' ? ' + children' : ''}</span>
            <span className="spacer" />
            <button className="btn ghost sm icon" title="Remove" onClick={() => removeModifier(m.id)}>✕</button>
          </div>
          <div className="prop">
            <span /><label className="prop-label"><span className="t">Amount</span>
              <input type="range" min={0} max={200} step={1} value={m.amount} onChange={(e) => updateModifier(m.id, (x) => { x.amount = +e.target.value; })} />
            </label><NumberField value={m.amount} onChange={(v) => updateModifier(m.id, (x) => { x.amount = v; })} />
          </div>
          <div className="prop">
            <span /><label className="prop-label"><span className="t">Frequency</span>
              <input type="range" min={0.05} max={MODIFIERS[m.kind].maxFrequency} step={0.05} value={m.frequency} onChange={(e) => updateModifier(m.id, (x) => { x.frequency = +e.target.value; })} />
            </label><NumberField value={m.frequency} step={0.1} onChange={(v) => updateModifier(m.id, (x) => { x.frequency = v; })} />
          </div>
          <div className="prop">
            <span /><label className="prop-label"><span className="t">Amplitude</span>
              <input type="range" min={0} max={40} step={0.5} value={m.amplitude} onChange={(e) => updateModifier(m.id, (x) => { x.amplitude = +e.target.value; })} />
            </label><NumberField value={m.amplitude} step={0.5} onChange={(v) => updateModifier(m.id, (x) => { x.amplitude = v; })} />
          </div>
          {m.kind === 'pendulum' && (
            <div className="prop">
              <span /><label className="prop-label"><span className="t">Axis</span></label>
              <select className="sel" value={m.axis ?? 'rotation'}
                onChange={(e) => updateModifier(m.id, (x) => { x.axis = e.target.value as typeof x.axis; })}>
                {MODIFIER_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
          {m.kind === 'shake' ? (
            <div className="prop">
              <span /><label className="prop-label"><span className="t">Seed</span></label>
              <NumberField value={m.seed ?? 0} onChange={(v) => updateModifier(m.id, (x) => { x.seed = Math.round(v); })} />
            </div>
          ) : (
            <div className="prop">
              <span /><label className="prop-label"><span className="t">Phase</span>
                <input type="range" min={0} max={6.28} step={0.05} value={m.phase ?? 0} onChange={(e) => updateModifier(m.id, (x) => { x.phase = +e.target.value; })} />
              </label><NumberField value={m.phase ?? 0} step={0.1} onChange={(v) => updateModifier(m.id, (x) => { x.phase = v; })} />
            </div>
          )}
          <span data-tour="fx-range">
            <RangeBar spanMs={span} startMs={m.startMs} endMs={m.endMs} label={clipScoped ? 'Runs in clip' : 'Runs in timeline'}
              onChange={(a, b) => updateModifier(m.id, (x) => { x.startMs = a; x.endMs = b; })} />
          </span>
        </div>
      ))}

      </Collapsible>

      <Collapsible title="Effects" storageKey="effects" badge={emitters.length || undefined} actions={
        <button className="btn sm" onClick={() => setPicking('effect')}>+ Add…</button>
      }>

      {!emitters.length && (
        <p className="empty-note">
          Little things leaving the mascot — zzz, ♪, tears, confetti, objects in orbit. One engine:
          a glyph, a path, some wander, a fade. Pin an endpoint to a layer and it follows that layer,
          which is how tears come out of the eyes.
        </p>
      )}

      {emitters.map((em) => (
        <div key={em.id} className={`fxcard${selectedEmitterId === em.id ? ' on' : ''}`}
          onPointerDownCapture={() => selectEmitter(em.id)}>
          <div className="row">
            <button className="btn ghost sm icon" aria-pressed={selectedEmitterId === em.id}
              title={selectedEmitterId === em.id ? 'Its path is on the stage' : 'Show its path on the stage'}
              onClick={() => selectEmitter(selectedEmitterId === em.id ? null : em.id)}>◎</button>
            <input className="txt" style={{ flex: 1 }} value={em.name} aria-label="Emitter name"
              onChange={(e) => updateEmitter(em.id, (x) => { x.name = e.target.value; })} />
            <input type="color" className="chip-color" title="Colour of everything this throws"
              value={hexColor(em.color)}
              onChange={(e) => updateEmitter(em.id, (x) => {
                const c = { ...parseHex(e.target.value), a: x.color.a };
                x.color = c;
                // A part with its own colour ignores the emitter's, which made this swatch
                // look broken on anything placed from a preset — Sleepy's zzz and Crying's
                // tears both carry per-part colours. Recolour those too, keeping the
                // relative differences a multi-coloured set (confetti) depends on.
                for (const pt of x.parts ?? []) if (pt.color) pt.color = { ...c, a: pt.color.a };
              })} />
            {/* only when the parts disagree: with everything on auto there is nothing to
                spread, and a button that does nothing is worse than no button */}
            {(em.parts ?? []).some((pt) => pt.color) && (
              <button className="btn ghost sm" title="Let every piece take this colour, instead of its own"
                onClick={() => updateEmitter(em.id, (x) => { for (const pt of x.parts ?? []) delete pt.color; })}>
                tint all
              </button>
            )}
            <button className="btn ghost sm icon" title="Remove" onClick={() => removeEmitter(em.id)}>✕</button>
          </div>

          {/* glyphs, or an SVG kept with the project. The library is per-project on
              purpose: it saves, exports and opens with the file, and needs no account. */}
          <div className="row">
            <select className="sel" style={{ flex: 1 }} value={em.svgAssetId ?? ''} aria-label="What to emit"
              onChange={(e) => {
                const asset = (project.svgAssets ?? []).find((a) => a.id === e.target.value);
                updateEmitter(em.id, (x) => {
                  if (!asset) { delete x.svgAssetId; delete x.svg; return; }
                  x.svgAssetId = asset.id;
                  x.svg = { sourceMarkup: asset.markup, viewBox: asset.viewBox };
                });
              }}>
              <option value="">glyphs (below)</option>
              {(project.svgAssets ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn sm" title="Import an SVG and keep it with this project"
              onClick={() => importSvg(em.id)}>Import SVG…</button>
          </div>

          <div className="row">
            <span className="prop-label" style={{ flex: 1 }}>Path</span>
            <select className="sel" value={em.path} aria-label="Path"
              onChange={(e) => updateEmitter(em.id, (x) => { x.path = e.target.value as typeof x.path; })}>
              <option value="arc">arc — drifts</option>
              <option value="fall">fall — drops</option>
              <option value="orbit">orbit — circles</option>
            </select>
          </div>

          <PartEditor emitter={em} />

          {/* endpoints. Pinning to a layer is what makes a tear leave the eye rather than
              a fixed point in space the head has since moved away from. */}
          {(['from', 'to'] as const).map((end) => (
            <div key={end} className="row">
              <span className="tag" style={{ width: 34 }}>{end}</span>
              <select className="sel" style={{ flex: 1 }} value={em[end].nodeId ?? ''}
                aria-label={`${end} attached to`}
                onChange={(e) => updateEmitter(em.id, (x) => { x[end] = { ...x[end], nodeId: e.target.value || undefined }; })}>
                <option value="">free</option>
                {anchors.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <NumberField value={em[end].x} onChange={(v) => updateEmitter(em.id, (x) => { x[end] = { ...x[end], x: v }; })} />
              <NumberField value={em[end].y} onChange={(v) => updateEmitter(em.id, (x) => { x[end] = { ...x[end], y: v }; })} />
            </div>
          ))}

          <Dial label="Size" value={em.size} min={4} max={90} step={1} onChange={(v) => updateEmitter(em.id, (x) => { x.size = v; })} />
          <Dial label={em.path === 'orbit' ? 'Ellipse X' : 'Bow'} value={em.path === 'orbit' ? (em.radiusX ?? 100) : em.bow}
            min={em.path === 'orbit' ? 10 : -200} max={200} step={1}
            onChange={(v) => updateEmitter(em.id, (x) => { if (x.path === 'orbit') x.radiusX = v; else x.bow = v; })} />
          {em.path === 'orbit' && (
            <Dial label="Ellipse Y" value={em.radiusY ?? em.radiusX ?? 100} min={4} max={200} step={1}
              onChange={(v) => updateEmitter(em.id, (x) => { x.radiusY = v; })} />
          )}
          <Dial label="Every" value={em.rateMs} min={40} max={2000} step={10} onChange={(v) => updateEmitter(em.id, (x) => { x.rateMs = v; })} />
          <Dial label="Lives" value={em.lifeMs} min={200} max={6000} step={50} onChange={(v) => updateEmitter(em.id, (x) => { x.lifeMs = v; })} />
          <Dial label="At once" value={em.count} min={1} max={40} step={1} onChange={(v) => updateEmitter(em.id, (x) => { x.count = Math.round(v); })} />
          <Dial label="Fade from" value={em.fadeStart} min={0} max={1} step={0.01} onChange={(v) => updateEmitter(em.id, (x) => { x.fadeStart = v; })} />
          <Dial label="Grows to" value={em.scaleTo} min={0.1} max={3} step={0.05} onChange={(v) => updateEmitter(em.id, (x) => { x.scaleTo = v; })} />
          <Dial label="Spin" value={em.spin} min={-360} max={360} step={5} onChange={(v) => updateEmitter(em.id, (x) => { x.spin = v; })} />
          <Dial label="Wander" value={em.wobble} min={0} max={40} step={0.5} onChange={(v) => updateEmitter(em.id, (x) => { x.wobble = v; })} />
          <Dial label="Speed spread" value={em.speedJitter ?? 0} min={0} max={1} step={0.05}
            onChange={(v) => updateEmitter(em.id, (x) => { x.speedJitter = v; })} />
          <div className="prop">
            <span /><label className="prop-label"><span className="t">Travel</span></label>
            <select className="sel" value={easingName(em.easing)} aria-label="Travel easing"
              onChange={(e) => updateEmitter(em.id, (x) => {
                x.easing = e.target.value === 'linear' ? { type: 'linear' } : namedEasing(e.target.value);
              })}>
              <option value="linear">linear</option>
              {EASING_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <RangeBar spanMs={span} startMs={em.startMs} endMs={em.endMs} label={clipScoped ? 'Runs in clip' : 'Runs in timeline'}
            onChange={(a, b) => updateEmitter(em.id, (x) => { x.startMs = a; x.endMs = b; })} />
        </div>
      ))}
      </Collapsible>

      {picking && (
        <EffectPicker
          project={project}
          title={picking === 'modifier' ? 'Add a modifier' : 'Add an effect'}
          choices={picking === 'modifier' ? MODIFIER_CHOICES : EFFECT_CHOICES}
          onClose={() => setPicking(null)}
          onPick={(c) => addToTargets((nodeId) => {
            if (c.modifier) { addModifier({ ...c.modifier, nodeId, blockId: scope }); return; }
            if (!c.emitter) return;
            addEmitter({
              ...c.emitter(nodeId), blockId: scope,
              // a burst goes off where the playhead is: park it, click, done. A stream
              // takes its whole scope instead.
              ...(c.burstMs ? { startMs: localPlayhead, endMs: Math.min(span, localPlayhead + c.burstMs) } : {}),
            });
          })}
        />
      )}
    </>
  );
}

/** The easing curve's name, for the picker. */
const easingName = (e?: { type: string; name?: string }) => (e?.type === 'preset' ? e.name! : 'linear');

/** One labelled slider + number, which is most of this panel. */
function Dial({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="prop">
      <span /><label className="prop-label"><span className="t">{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      </label><NumberField value={value} step={step} onChange={onChange} />
    </div>
  );
}
