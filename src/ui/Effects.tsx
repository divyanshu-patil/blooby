import { useEditor } from '../core/store';
import { NumberField, Panel } from './bits';

const DEFAULTS = {
  shake: { amount: 100, frequency: 12, amplitude: 6, seed: 1 },
  float: { amount: 100, frequency: 0.6, amplitude: 8, phase: 0 },
  stretch: { amount: 100, frequency: 0.8, amplitude: 12, phase: 0 },
};

/** Non-destructive layers on top of the keyframes. Baked to real keys on export. */
export function Effects() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const addModifier = useEditor((s) => s.addModifier);
  const updateModifier = useEditor((s) => s.updateModifier);
  const removeModifier = useEditor((s) => s.removeModifier);

  const target = selection[0] ?? project.rig.rootId;
  const nodeName = (id: string) => project.rig.nodes[id]?.name ?? id;

  return (
    <Panel title="Effects" actions={
      <>
        <button className="btn sm" onClick={() => addModifier({ nodeId: target, kind: 'shake', ...DEFAULTS.shake })}>+ Shake</button>
        <button className="btn sm" onClick={() => addModifier({ nodeId: target, kind: 'float', ...DEFAULTS.float })}>+ Float</button>
        <button className="btn sm" onClick={() => addModifier({ nodeId: project.rig.rootId, kind: 'stretch', ...DEFAULTS.stretch })}>+ Stretch</button>
      </>
    }>
      {!project.modifiers.length && <p className="empty-note">Shake jitters with noise, float bobs on a sine, stretch pulses the whole rig's size. All three stack on whatever the keyframes are doing.</p>}
      {project.modifiers.map((m) => (
        <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'var(--field)', border: '1px solid var(--line-soft)', borderRadius: 6 }}>
          <div className="row">
            <strong style={{ font: '700 11px var(--display)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{m.kind}</strong>
            {m.kind === 'stretch' ? <span className="tag">whole rig</span> : <span className="tag">{nodeName(m.nodeId)}</span>}
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
              <input type="range" min={0.05} max={m.kind === 'shake' ? 30 : 6} step={0.05} value={m.frequency} onChange={(e) => updateModifier(m.id, (x) => { x.frequency = +e.target.value; })} />
            </label><NumberField value={m.frequency} step={0.1} onChange={(v) => updateModifier(m.id, (x) => { x.frequency = v; })} />
          </div>
          <div className="prop">
            <span /><label className="prop-label"><span className="t">Amplitude</span>
              <input type="range" min={0} max={40} step={0.5} value={m.amplitude} onChange={(e) => updateModifier(m.id, (x) => { x.amplitude = +e.target.value; })} />
            </label><NumberField value={m.amplitude} step={0.5} onChange={(v) => updateModifier(m.id, (x) => { x.amplitude = v; })} />
          </div>
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
        </div>
      ))}
    </Panel>
  );
}
