import { useState } from 'react';
import { useEditor } from '../core/store';
import { activeTimeline, MODIFIER_AXES, MODIFIER_KINDS, MODIFIERS, type Emitter, type ModifierKind } from '../core/types';
import { scopeSpan } from '../core/scene';
import { blockStarts } from '../core/timeline';
import { hexColor, parseHex } from '../core/color';
import { NumberField } from './bits';
import { Collapsible } from './Collapsible';
import { PartEditor } from './PartEditor';
import { confetti } from '../core/defaults';
import { EASING_NAMES, namedEasing } from '../core/easing';
import { RangeBar } from './RangeBar';

/** Ready-made emitters — the same record with different numbers, which is the point. */
const EMITTER_PRESETS: {
  label: string; hint: string;
  /** a burst rather than a stream: starts at the playhead and runs this long */
  burstMs?: number;
  make: (nodeId: string) => Omit<Emitter, 'id' | 'blockId'>;
}[] = [
  {
    label: 'Glyphs', hint: 'Characters drifting off — zzz, ♪, ?, !',
    make: (nodeId) => ({
      name: 'glyphs', glyphs: ['z', 'z', 'Z'], color: { r: 108, g: 106, b: 128, a: 1 }, size: 26,
      path: 'arc', from: { nodeId, x: 46, y: -34 }, to: { nodeId, x: 118, y: -150 }, bow: 22,
      rateMs: 700, lifeMs: 2100, count: 3, fadeStart: 0.45,
      scaleFrom: 0.45, scaleTo: 1.3, spin: -10, wobble: 5, wobbleFrequency: 1.2, seed: 7,
    }),
  },
  {
    label: 'Drops', hint: 'Falling and curving — tears, rain, sweat',
    make: (nodeId) => ({
      name: 'drops', glyphs: ['●'], color: { r: 96, g: 160, b: 225, a: 1 }, size: 13,
      path: 'fall', from: { nodeId, x: 0, y: 12 }, to: { nodeId, x: -22, y: 150 }, bow: 8,
      rateMs: 380, lifeMs: 1200, count: 4, fadeStart: 0.65,
      scaleFrom: 0.7, scaleTo: 1.1, spin: 0, wobble: 2, wobbleFrequency: 1.2, seed: 2,
    }),
  },
  {
    label: 'Orbit', hint: 'Objects circling on an ellipse you can size',
    make: (nodeId) => ({
      name: 'orbit', glyphs: ['✦', '●', '▲'], color: { r: 84, g: 82, b: 112, a: 1 }, size: 20,
      path: 'orbit', from: { nodeId, x: 0, y: -128 }, to: { x: 0, y: 0 }, bow: 0,
      radiusX: 104, radiusY: 34,
      rateMs: 600, lifeMs: 2400, count: 4, fadeStart: 0.85,
      scaleFrom: 0.85, scaleTo: 1, spin: 40, wobble: 3, wobbleFrequency: 1.2, seed: 5,
    }),
  },
];

/** Starting dial positions. Keyed by ModifierKind, so a new effect will not compile
 *  until it has one — the same "add the row, the rest follows" contract as PROPS. */
const DEFAULTS: Record<ModifierKind, { amount: number; frequency: number; amplitude: number; seed?: number; phase?: number }> = {
  shake: { amount: 100, frequency: 12, amplitude: 6, seed: 1 },
  float: { amount: 100, frequency: 0.6, amplitude: 8, phase: 0 },
  stretch: { amount: 100, frequency: 0.8, amplitude: 12, phase: 0 },
  pendulum: { amount: 100, frequency: 0.7, amplitude: 10, phase: 0 },
};

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
  // which layer a NEW effect lands on. Sticky, so adding three effects to the eyes is
  // three clicks rather than six, and clearable back to the body with a second click.
  const target = targetId && project.rig.nodes[targetId] ? targetId : (selection[0] ?? project.rig.rootId);
  const emitters = (tl.emitters ?? []).filter((e) => (clipScoped ? e.blockId === selectedBlockId : !e.blockId));
  const span = scopeSpan(tl, scope)[1];
  const add = (kind: ModifierKind, nodeId: string) =>
    addModifier({ nodeId, kind, ...DEFAULTS[kind], blockId: scope });

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
      <div className="row targetbar">
        <span className="prop-label" style={{ flex: 1 }}>Apply to</span>
        {Object.values(project.rig.nodes).map((n) => (
          <button key={n.id} className="btn sm" aria-pressed={target === n.id}
            title={target === n.id ? `${n.name} — click to go back to the body` : `New effects go on ${n.name}`}
            onClick={() => setTargetId(target === n.id ? null : n.id)}>{n.name}</button>
        ))}
      </div>

      <Collapsible title="Modifiers" storageKey="modifiers" badge={list.length || undefined} actions={
        <>{MODIFIER_KINDS.map((k) => (
          <button key={k} className="btn sm" title={MODIFIERS[k].help} onClick={() => add(k, target)}>+ {MODIFIERS[k].label}</button>
        ))}</>
      }>
      {!list.length && (
        <p className="empty-note">
          Shake jitters with noise, float bobs on a sine, stretch pulses the whole rig's size,
          pendulum swings one axis. They stack on whatever the keyframes are
          doing{clipScoped ? ', for as long as this clip plays' : ''}.
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
          <RangeBar spanMs={span} startMs={m.startMs} endMs={m.endMs} label={clipScoped ? 'Runs in clip' : 'Runs in timeline'}
            onChange={(a, b) => updateModifier(m.id, (x) => { x.startMs = a; x.endMs = b; })} />
        </div>
      ))}

      </Collapsible>

      <Collapsible title="Effects" storageKey="effects" badge={emitters.length || undefined} actions={
        <>
          <button className="btn sm" title="A burst of paper confetti, starting at the playhead"
            onClick={() => addEmitter({
              ...confetti(target), blockId: scope,
              // the whole gesture: park the playhead, click, done
              startMs: localPlayhead, endMs: Math.min(span, localPlayhead + 1500),
            })}>+ Confetti</button>
          {EMITTER_PRESETS.map((e) => (
            <button key={e.label} className="btn sm" title={e.hint}
              onClick={() => addEmitter({ ...e.make(target), blockId: scope })}>+ {e.label}</button>
          ))}
        </>
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
            <input type="color" className="chip-color" title="Colour" value={hexColor(em.color)}
              onChange={(e) => updateEmitter(em.id, (x) => { x.color = { ...parseHex(e.target.value), a: x.color.a }; })} />
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
