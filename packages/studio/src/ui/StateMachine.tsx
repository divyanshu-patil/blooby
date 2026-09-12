import { useState } from 'react';
import { useEditor } from '../core/store';
import { Collapsible } from './Collapsible';
import { CurveEditor } from './CurveEditor';
import { StateGraph } from './StateGraph';
import { EASING_NAMES, easingLabel, namedEasing } from '../core/easing';
import {
  conditionText, defaultValueFor, defaultValues, machineOf, OPERATORS, opLabel,
  RUNTIME_SETTER, slug, STATE_INPUT, validateMachine,
} from '../core/stateMachine';
import { valueAt } from '../core/scene';
import { shapeById, shapeIdOf } from '../core/emitters';
import type { ConditionOp, EasingCurve, InputType, InputValue, SmCondition, SmInput, SmTransition } from '../core/types';

/**
 * The State Editor: a visual authoring environment for a real dotLottie state machine.
 *
 * Everything on this panel has a runtime representation — an input is a dotLottie input
 * with a named setter, a transition is a dotLottie transition with real guards, a state
 * is a `PlaybackState` pointing at a real animation. The live input controls are not a
 * mock: writing one runs the same first-match-wins evaluation the player runs, so the
 * mascot changes state here for exactly the reason it will change state in the app.
 */

const INPUT_TYPES: InputType[] = ['Boolean', 'Numeric', 'String', 'Event'];

/**
 * Put one value back the way it was, and say so only when there is something to put back.
 *
 * Every editable value on this panel has a default it came from — an input's declared
 * value, a state's blend, the machine's own id. Rendering the control unconditionally
 * would put a dead button beside every field; rendering it only when `changed` makes it
 * double as the answer to "have I touched this?", which is the question you actually have
 * when a machine stops transitioning and you cannot see why.
 */
function Revert({ changed, what, onClick }: { changed: boolean; what: string; onClick: () => void }) {
  if (!changed) return null;
  return (
    <button className="sm-revert" title={`Reset ${what} to its default`} aria-label={`Reset ${what}`}
      onClick={onClick}>↺</button>
  );
}

/** Two EasingCurves are the same curve — cheap, and they are small flat objects. */
const sameEasing = (a: EasingCurve | undefined, b: EasingCurve) => JSON.stringify(a ?? b) === JSON.stringify(b);
const DEFAULT_EASING: EasingCurve = { type: 'preset', name: 'easeInOut' };
const DEFAULT_ENTER_MS = 300;

export function StateMachine() {
  const project = useEditor((s) => s.project);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const machine = machineOf(project);
  const issues = validateMachine(project);
  const errors = issues.filter((i) => i.level === 'error');

  return (
    <>
      <MachineHeader errors={errors.length} />
      <Collapsible title="Current → target" storageKey="sm-direct">
        <StateDirector selectedId={selectedTransition} onSelect={setSelectedTransition} />
      </Collapsible>
      <Collapsible title="Inputs" storageKey="sm-inputs" badge={machine.inputs.length || undefined}>
        <Inputs />
      </Collapsible>
      <Collapsible title="States" storageKey="sm-states" badge={project.timelines.length}>
        <States />
      </Collapsible>
      <Collapsible title="Transitions" storageKey="sm-transitions" badge={machine.transitions.length || undefined}>
        <Transitions selectedId={selectedTransition} onSelect={setSelectedTransition} />
      </Collapsible>
      <Collapsible title="Validation" storageKey="sm-validation" badge={issues.length || 'ok'} defaultOpen={errors.length > 0}>
        <Validation />
      </Collapsible>
      <Collapsible title="Manual triggers" storageKey="sm-manual" defaultOpen={false}>
        <ManualTriggers />
      </Collapsible>
      <Collapsible title="Reset" storageKey="sm-reset" defaultOpen={false}>
        <ResetSection onClearSelection={() => setSelectedTransition(null)} />
      </Collapsible>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * CURRENT → TARGET. The one question a state editor has to answer quickly: "I am in
 * Excited — take me to Angry." That is one direct transition, never Excited → Happy →
 * Idle → Angry, and it is written as a real dotLottie edge on an input the app sets.
 *
 * The current values are here so "where am I" is a set of numbers, not a guess: the
 * selected layer's (or the body's) scale, roll, opacity, shape, yaw and pitch right now.
 */
function StateDirector({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const goToState = useEditor((s) => s.goToState);
  const [target, setTarget] = useState('');
  const [cut, setCut] = useState(false);
  const [dur, setDur] = useState(400);
  const [ease, setEase] = useState('easeOut');
  const [fromAny, setFromAny] = useState(false);
  const [inputName, setInputName] = useState(STATE_INPUT);
  const machine = machineOf(project);

  const active = project.timelines.find((t) => t.id === project.activeTimelineId) ?? project.timelines[0];
  const others = project.timelines.filter((t) => t.id !== active.id);
  const targetId = others.some((t) => t.id === target) ? target : others[0]?.id ?? '';
  const targetName = project.timelines.find((t) => t.id === targetId)?.name ?? '';
  const layerId = selection[0] && project.rig.nodes[selection[0]] ? selection[0] : project.rig.rootId;
  const layer = project.rig.nodes[layerId];
  const num = (p: string) => valueAt(project, layerId, p, playhead);
  const shape = valueAt(project, layerId, 'shape.path', playhead);
  const usable = machine.inputs.filter((i) => i.type === 'String' || i.type === 'Numeric');
  const chosen = usable.find((i) => i.name === inputName);
  const fires = chosen?.type === 'Numeric' ? String(project.timelines.findIndex((t) => t.id === targetId)) : JSON.stringify(targetName);

  const rows: [string, string][] = [
    ['Scale', fmt(num('transform.scale.x'), '×')],
    ['Rotation', fmt(num('transform.rotation'), '°')],
    ['Opacity', fmt(num('opacity'), '')],
    ['Shape', typeof shape === 'string' ? shapeById(shapeIdOf(shape) ?? '')?.name ?? 'Custom' : layer?.kind === 'body' ? 'Circle' : 'Natural'],
    ['Yaw', fmt(num('surface.yaw'), '°')],
    ['Pitch', fmt(num('surface.pitch'), '°')],
  ];

  if (!others.length) {
    return <p className="hint" style={{ margin: 0 }}>Add a second state from the timeline tabs, then take the mascot to it from here.</p>;
  }
  return (
    <div className="director">
      <div className="dir-row">
        <span className="dir-key">State</span>
        <select className="sel dir-state" value={active.id} aria-label="Current state" onChange={(e) => setActiveTimeline(e.target.value)}>
          {project.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="dir-values" aria-label="Current values">
        <span className="dir-caption">Current value · {layerId === project.rig.rootId ? 'Mascot' : layer?.name}</span>
        {rows.map(([k, v]) => <div key={k} className="dir-value"><span>{k}</span><b>{v}</b></div>)}
      </div>

      <div className="dir-row">
        <span className="dir-key">Target</span>
        <select className="sel" style={{ flex: 1 }} value={targetId} aria-label="Target state" onChange={(e) => setTarget(e.target.value)}>
          {others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="dir-row">
        <span className="dir-key">Transition</span>
        <div className="seg">
          <button aria-pressed={!cut} onClick={() => setCut(false)} title="Blend into the target — dotLottie Tweened">Tween</button>
          <button aria-pressed={cut} onClick={() => setCut(true)} title="Switch instantly">Cut</button>
        </div>
      </div>
      {!cut && (
        <>
          <div className="dir-row">
            <span className="dir-key">Duration</span>
            <input className="prop-num" style={{ width: 70 }} type="number" min={0} step={20} value={dur}
              aria-label="Transition duration, ms" onChange={(e) => setDur(Math.max(0, Math.round(+e.target.value)))} />
            <span className="hint">ms</span>
          </div>
          <div className="dir-row">
            <span className="dir-key">Easing</span>
            <select className="sel" value={ease} aria-label="Transition easing" onChange={(e) => setEase(e.target.value)}>
              {EASING_NAMES.filter((n) => n !== 'hold').map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="dir-row">
        <span className="dir-key">From</span>
        <div className="seg">
          <button aria-pressed={!fromAny} onClick={() => setFromAny(false)} title={`Only from ${active.name}`}>{active.name}</button>
          <button aria-pressed={fromAny} onClick={() => setFromAny(true)} title="From every other state, one direct edge each">Any state</button>
        </div>
      </div>
      <div className="dir-row">
        <span className="dir-key">Input</span>
        <select className="sel" style={{ flex: 1 }} value={inputName} aria-label="Input the transition listens to"
          onChange={(e) => setInputName(e.target.value)}>
          {!usable.some((i) => i.name === STATE_INPUT) && <option value={STATE_INPUT}>{STATE_INPUT} (new String input)</option>}
          {usable.map((i) => <option key={i.name} value={i.name}>{i.name} ({i.type})</option>)}
        </select>
      </div>
      <button className="btn primary" disabled={!targetId}
        onClick={() => goToState(targetId, { durationMs: cut ? 0 : dur, easing: namedEasing(ease), input: inputName, fromAny })}>
        Create transition
      </button>
      <p className="hint" style={{ margin: 0 }}>
        {fromAny ? 'Every state' : active.name} → <b>{targetName}</b> directly, when <code>{inputName} == {fires}</code>. Nothing in between — and the preview takes it now.
      </p>
      <StateGraph selectedId={selectedId} onSelect={(t) => onSelect(t?.id ?? null)} />
    </div>
  );
}

const fmt = (v: unknown, unit: string) => (typeof v === 'number' ? `${Number.isInteger(v) ? v : v.toFixed(2)}${unit}` : '—');

function MachineHeader({ errors }: { errors: number }) {
  const project = useEditor((s) => s.project);
  const setMachineId = useEditor((s) => s.setMachineId);
  const setInitialState = useEditor((s) => s.setInitialState);
  const machine = machineOf(project);
  const initialId = machine.initialStateId ?? project.timelines[0]?.id;
  const defaultId = slug(project.name) || 'blooby';

  return (
    <div className="panel-body" style={{ paddingBottom: 6 }}>
      <div className="row">
        <span className="prop-label" style={{ width: 62 }}>Machine</span>
        <input className="txt" style={{ flex: 1 }} value={machine.id} aria-label="State machine id"
          title="The id a player loads: stateMachineLoad(id)"
          onChange={(e) => setMachineId(e.target.value)} />
        <Revert changed={machine.id !== defaultId} what="the machine id"
          onClick={() => setMachineId(defaultId)} />
      </div>
      <div className="row">
        <span className="prop-label" style={{ width: 62 }}>Initial</span>
        <select className="prop-num" style={{ flex: 1 }} value={initialId} aria-label="Initial state"
          onChange={(e) => setInitialState(e.target.value)}>
          {project.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Revert changed={initialId !== project.timelines[0]?.id} what="the initial state"
          onClick={() => setInitialState(project.timelines[0].id)} />
      </div>
      <p className="hint">
        States are this project's timelines. Inputs and transitions below are the dotLottie state
        machine itself — <code>stateMachineLoad("{machine.id}")</code> in the app.
        {errors > 0 && <> · <strong style={{ color: 'var(--hot)' }}>{errors} error{errors === 1 ? '' : 's'}</strong> to fix before export.</>}
      </p>
    </div>
  );
}

// --- inputs -----------------------------------------------------------------

function Inputs() {
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.inputs);
  const addInput = useEditor((s) => s.addInput);
  const updateInput = useEditor((s) => s.updateInput);
  const removeInput = useEditor((s) => s.removeInput);
  const setInput = useEditor((s) => s.setInput);
  const fireInput = useEditor((s) => s.fireInput);
  const resetInputs = useEditor((s) => s.resetInputs);

  const [name, setName] = useState('');
  const [type, setType] = useState<InputType>('Boolean');
  const machine = machineOf(project);
  const values = { ...defaultValues(project), ...live };

  const add = () => {
    const n = name.trim();
    if (!n) return;
    // §4: an existing input under that name is reused, never duplicated
    addInput({ name: n, type, value: defaultValueFor(type) });
    setName('');
  };
  const duplicate = machine.inputs.some((i) => i.name === name.trim());

  return (
    <>
      {machine.inputs.map((input) => (
        <div key={input.name} className="sm-card">
          <div className="sm-head">
            <input className="txt" value={input.name} aria-label={`Name of input ${input.name}`}
              title="The name the app passes to the runtime setter. Renaming it rewrites every condition that tests it."
              onChange={(e) => updateInput(input.name, { name: e.target.value })} />
            <select className="prop-num" style={{ width: 76 }} value={input.type} aria-label={`Type of ${input.name}`}
              title="Boolean, Numeric and String hold a value the app sets. Event is a one-shot pulse you fire. Changing the type resets this input's conditions."
              onChange={(e) => updateInput(input.name, { type: e.target.value as InputType })}>
              {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="sm-x" title={`Delete "${input.name}" and every condition that tests it`}
              aria-label={`Delete ${input.name}`} onClick={() => removeInput(input.name)}>×</button>
          </div>

          {input.type !== 'Event' && (
            <div className="sm-row">
              <span className="sm-key" title="The value the state machine starts with when the app loads it">Default</span>
              <ValueField type={input.type} value={input.value ?? defaultValueFor(input.type)}
                label={`Default for ${input.name}`}
                title={`The value "${input.name}" holds before the app sets anything. Ships inside the .lottie.`}
                onChange={(v) => updateInput(input.name, { value: v })} />
              <Revert changed={input.value !== defaultValueFor(input.type)} what={`the default for ${input.name}`}
                onClick={() => updateInput(input.name, { value: defaultValueFor(input.type) })} />
            </div>
          )}

          <div className="sm-row">
            <span className="sm-key" title="A value only for testing here — never exported">Test</span>
            {input.type === 'Event' ? (
              <button className="btn sm" title={`Fire "${input.name}" once, exactly as the app's fire("${input.name}") does`}
                onClick={() => fireInput(input.name)}>Fire once</button>
            ) : (
              <ValueField type={input.type} value={values[input.name] ?? defaultValueFor(input.type)}
                label={`Live value of ${input.name}`}
                title={`Set "${input.name}" now and watch the machine react — the same evaluation the player runs. Not exported.`}
                onChange={(v) => setInput(input.name, v)} />
            )}
            {/* only `live` — not `values` — counts as changed: `values` folds the declared
                default in, so comparing against it would never show anything */}
            <Revert changed={live[input.name] !== undefined} what={`the test value of ${input.name}`}
              onClick={() => resetInputs(input.name)} />
          </div>

          <div className="sm-row">
            <span className="sm-key" title="A note for whoever wires this up — travels into the exported config">Note</span>
            <input className="txt" placeholder="What does this input mean?"
              title="Optional. Shown in the exported config and as the doc comment on the generated Mascot prop."
              aria-label={`Description of ${input.name}`} value={input.description ?? ''}
              onChange={(e) => updateInput(input.name, { description: e.target.value })} />
            <Revert changed={!!input.description} what={`the note on ${input.name}`}
              onClick={() => updateInput(input.name, { description: '' })} />
          </div>

          {/* §18 — what this input actually maps to in the app, next to the input itself */}
          <p className="sm-note" title={`In React Native this input is driven by ${RUNTIME_SETTER[input.type]} — the generated <Mascot> calls it for you.`}>
            → <strong>{RUNTIME_SETTER[input.type]}</strong>
          </p>
        </div>
      ))}

      {!machine.inputs.length && (
        <p className="hint" style={{ margin: 0 }}>
          No inputs yet. An input is a value your app sets at runtime — the machine reads it to
          decide which state to be in.
        </p>
      )}

      <div className="divider" />
      <div className="sm-row">
        <input className="txt" placeholder="isTyping" aria-label="New input name"
          title="A name your app will use, e.g. isTyping, energy, mood"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="prop-num" style={{ width: 76 }} value={type} aria-label="New input type"
          title="Boolean: true/false · Numeric: a number · String: text · Event: a one-shot pulse"
          onChange={(e) => setType(e.target.value as InputType)}>
          {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn sm" onClick={add} disabled={!name.trim()}
          title={duplicate ? `"${name.trim()}" already exists — this will reuse it` : 'Add this input to the state machine'}>
          Add
        </button>
      </div>
      {duplicate && <p className="hint" style={{ margin: 0 }}>“{name.trim()}” already exists — Add will reuse it.</p>}
      {Object.keys(live).length > 0 && (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => resetInputs()}
          title="Put every test value back to the default its input declares">
          ↺ Reset {Object.keys(live).length} test value{Object.keys(live).length === 1 ? '' : 's'}
        </button>
      )}
    </>
  );
}

/** One value editor, shaped by the input's declared type — the §2 requirement that the
 *  value control changes with the type, in the one place every value is edited. */
function ValueField({ type, value, onChange, label, title }: {
  type: InputType; value: InputValue | undefined; onChange: (v: InputValue) => void;
  label: string; title?: string;
}) {
  if (type === 'Boolean') {
    return (
      <div className="seg" title={title}>
        <button aria-pressed={value === true} aria-label={`${label}: true`} onClick={() => onChange(true)}>true</button>
        <button aria-pressed={value !== true} aria-label={`${label}: false`} onClick={() => onChange(false)}>false</button>
      </div>
    );
  }
  if (type === 'Numeric') {
    return (
      <input className="prop-num" style={{ width: 78 }} type="number" aria-label={label} title={title}
        value={typeof value === 'number' ? value : 0}
        onChange={(e) => onChange(Number.isFinite(+e.target.value) ? +e.target.value : 0)} />
    );
  }
  return (
    <input className="txt" style={{ flex: 1, minWidth: 0 }} aria-label={label} title={title}
      value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
  );
}

// --- states -----------------------------------------------------------------

function States() {
  const project = useEditor((s) => s.project);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const renameTimeline = useEditor((s) => s.renameTimeline);
  const setStateTransition = useEditor((s) => s.setStateTransition);
  const resetStateTransition = useEditor((s) => s.resetStateTransition);
  const setInitialState = useEditor((s) => s.setInitialState);
  const commit = useEditor((s) => s.commit);
  const [curveFor, setCurveFor] = useState<string | null>(null);
  const machine = machineOf(project);
  const initialId = machine.initialStateId ?? project.timelines[0]?.id;

  return (
    <>
      {project.timelines.map((tl) => {
        const active = tl.id === project.activeTimelineId;
        const incoming = machine.transitions.filter((t) => t.to === tl.id);
        const outgoing = machine.transitions.filter((t) => t.from === tl.id);
        const easing: EasingCurve = tl.transitionEasing ?? DEFAULT_EASING;
        const name = (id: string) => project.timelines.find((t) => t.id === id)?.name ?? '?';
        const cond = (t: SmTransition) => t.conditions.map((c) => conditionText(c, machine.inputs)).join(t.logic === 'OR' ? ' or ' : ' and ') || 'nothing';
        const animation = tl.animationId ?? slug(tl.name);

        return (
          <div key={tl.id} className="sm-card" data-active={active} style={{ position: 'relative' }}>
            <div className="sm-head">
              <button className="dot-status" data-on={active}
                title={active ? `"${tl.name}" is the state showing on the stage` : `Show "${tl.name}" on the stage`}
                aria-label={`Switch to ${tl.name}`} onClick={() => setActiveTimeline(tl.id)} />
              <input className="txt" value={tl.name} aria-label={`State name ${tl.name}`}
                title="The state's name. It is what the machine and every transition refer to."
                onChange={(e) => renameTimeline(tl.id, e.target.value)} />
              <button className="sm-x" style={{ width: 'auto', padding: '0 6px', fontSize: 10 }}
                aria-pressed={tl.id === initialId} onClick={() => setInitialState(tl.id)}
                title={tl.id === initialId ? `"${tl.name}" is where the machine starts` : `Start the machine in "${tl.name}"`}>
                {tl.id === initialId ? '★' : '☆'}
              </button>
            </div>

            <div className="sm-row">
              <span className="sm-key" title="How long a blend into this state takes when the app calls setState — a transition brings its own">Enter</span>
              <input type="number" min={0} step={20} className="prop-num" style={{ width: 58 }}
                title={`Blend into "${tl.name}" when it is entered by setState(), in ms. 0 is an instant cut. A transition uses its own duration instead.`}
                aria-label={`Blend into ${tl.name}, ms`} value={tl.transitionMs ?? DEFAULT_ENTER_MS}
                onChange={(e) => setStateTransition(tl.id, Math.max(0, Math.round(+e.target.value)))} />
              <span className="hint">ms</span>
              <button className="btn sm" title={`The curve that blend follows — currently ${easingLabel(easing)}. Click to shape it.`}
                onClick={() => setCurveFor(curveFor === tl.id ? null : tl.id)}>{easingLabel(easing)} ⌃</button>
              <Revert what={`the blend into ${tl.name}`}
                changed={(tl.transitionMs ?? DEFAULT_ENTER_MS) !== DEFAULT_ENTER_MS || !sameEasing(tl.transitionEasing, DEFAULT_EASING)}
                onClick={() => { resetStateTransition(tl.id); setCurveFor(null); }} />
              <label className="hint sm-spacer" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                title={`Repeat "${tl.name}"'s animation for as long as the machine stays in it`}>
                <input type="checkbox" checked={tl.loop}
                  onChange={(e) => commit((p) => { const t = p.timelines.find((x) => x.id === tl.id); if (t) t.loop = e.target.checked; }, `loop.${tl.id}`)} />
                loop
              </label>
              {curveFor === tl.id && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20 }}>
                  <CurveEditor value={easing} onChange={(c) => setStateTransition(tl.id, tl.transitionMs ?? DEFAULT_ENTER_MS, c)} />
                </div>
              )}
            </div>

            {/* §5: what gets you into this state, and what leads out of it */}
            {(incoming.length > 0 || outgoing.length > 0) && (
              <div className="sm-edges">
                {incoming.map((t) => (
                  <p key={t.id} className="sm-edge" title={`The machine enters "${tl.name}" from "${name(t.from)}" when ${cond(t)}`}>
                    ← <b>{name(t.from)}</b> when {cond(t)}
                  </p>
                ))}
                {outgoing.map((t) => (
                  <p key={t.id} className="sm-edge" title={`The machine leaves "${tl.name}" for "${name(t.to)}" when ${cond(t)}`}>
                    → <b>{name(t.to)}</b> when {cond(t)}
                  </p>
                ))}
              </div>
            )}

            <p className="sm-note" title={tl.animationId
              ? `Plays the imported animation "${animation}", which is copied into the .lottie untouched`
              : `Plays this timeline, baked into the .lottie as the animation "${animation}"`}>
              plays <strong>{animation}</strong>{tl.animationId && ' (imported)'}
            </p>
          </div>
        );
      })}
      <p className="hint" style={{ margin: 0 }}>★ marks where the machine starts. Add or remove states from the timeline tabs below the stage.</p>
    </>
  );
}

// --- transitions ------------------------------------------------------------

function Transitions({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const project = useEditor((s) => s.project);
  const addStateTransition = useEditor((s) => s.addStateTransition);
  const machine = machineOf(project);

  const canAdd = project.timelines.length > 1;
  const first = project.timelines[0];
  const second = project.timelines[1];

  return (
    <>
      {machine.transitions.map((t) => (
        <TransitionRow key={t.id} transition={t} open={t.id === selectedId}
          onToggle={() => onSelect(t.id === selectedId ? null : t.id)} />
      ))}
      {!machine.transitions.length && <p className="hint">No transitions yet. Without one the machine stays in its initial state forever.</p>}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!canAdd}
        title={canAdd ? 'Add a transition' : 'Add a second timeline first'}
        onClick={() => addStateTransition(first.id, second.id)}>+ Transition</button>
    </>
  );
}

function TransitionRow({ transition: t, open, onToggle }: { transition: SmTransition; open: boolean; onToggle: () => void }) {
  const project = useEditor((s) => s.project);
  const update = useEditor((s) => s.updateStateTransition);
  const remove = useEditor((s) => s.removeStateTransition);
  const [curveOpen, setCurveOpen] = useState(false);
  const machine = machineOf(project);
  const name = (id: string) => project.timelines.find((x) => x.id === id)?.name ?? '?';
  const easing: EasingCurve = t.easing ?? DEFAULT_EASING;
  const joiner = t.logic === 'OR' ? 'OR' : 'AND';
  // a new edge is created carrying the target state's own blend, so that — not zero — is
  // what "reset this transition's blend" has to go back to
  const enterMs = project.timelines.find((x) => x.id === t.to)?.transitionMs ?? DEFAULT_ENTER_MS;

  const setCondition = (i: number, patch: Partial<SmCondition>) => {
    const next = t.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c));
    update(t.id, { conditions: next });
  };

  const addCondition = () => {
    const input = machine.inputs[0];
    if (!input) return;
    update(t.id, {
      conditions: [...t.conditions, {
        input: input.name,
        operator: input.type === 'Event' ? 'Fired' : 'Equal',
        value: input.value ?? defaultValueFor(input.type),
      }],
    });
  };

  return (
    <div className="sm-card" data-open={open} style={{ position: 'relative' }}>
      <button className="sm-head" style={{ textAlign: 'left' }} onClick={onToggle} aria-expanded={open}
        title={open ? 'Collapse this transition' : `Edit: the machine goes from "${name(t.from)}" to "${name(t.to)}" when its conditions hold`}>
        <span className="sm-name">{name(t.from)} → {name(t.to)}</span>
        <span className="hint" style={{ flex: 'none', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.conditions.map((c) => conditionText(c, machine.inputs)).join(` ${joiner} `) || 'no conditions'}
        </span>
      </button>

      {open && (
        <>
          <div className="sm-row">
            <span className="sm-key" title="The machine only takes this edge while it is in this state">From</span>
            <select className="prop-num" style={{ flex: 1, minWidth: 0 }} value={t.from} aria-label="Transition from"
              title="The state this transition leaves"
              onChange={(e) => update(t.id, { from: e.target.value })}>
              {project.timelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <span className="sm-key" style={{ flex: '0 0 auto' }} title="Where the machine ends up">To</span>
            <select className="prop-num" style={{ flex: 1, minWidth: 0 }} value={t.to} aria-label="Transition to"
              title="The state this transition enters"
              onChange={(e) => update(t.id, { to: e.target.value })}>
              {project.timelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>

          {t.conditions.map((c, i) => (
            <ConditionRow key={i} condition={c} index={i} joiner={joiner}
              onChange={(patch) => setCondition(i, patch)}
              onRemove={() => update(t.id, { conditions: t.conditions.filter((_, j) => j !== i) })} />
          ))}
          {!t.conditions.length && (
            <p className="hint" style={{ margin: 0, color: 'var(--hot)' }}>
              No conditions — this transition can never fire. Add one below.
            </p>
          )}

          <div className="sm-row">
            <button className="btn ghost sm" onClick={addCondition} disabled={!machine.inputs.length}
              title={machine.inputs.length ? 'Add another test that must hold for this transition to fire' : 'Add an input first — a condition tests one'}>
              + Condition
            </button>
            {t.conditions.length > 1 && (
              <div className="seg" title="AND: every condition must hold. OR: any one of them.">
                <button aria-pressed={joiner === 'AND'} onClick={() => update(t.id, { logic: 'AND' })}>AND</button>
                <button aria-pressed={joiner === 'OR'} onClick={() => update(t.id, { logic: 'OR' })}>OR</button>
              </div>
            )}
            {t.conditions.length > 1 && (
              <button className="btn ghost sm" title="Remove every condition on this transition"
                onClick={() => update(t.id, { conditions: [] })}>Clear</button>
            )}
            <button className="sm-x sm-spacer" title={`Delete the transition ${name(t.from)} → ${name(t.to)}`}
              aria-label="Delete transition" onClick={() => remove(t.id)}>×</button>
          </div>

          <div className="sm-row">
            <span className="sm-key" title="How long the mascot takes to blend into the target state when this transition fires">Blend</span>
            <input className="prop-num" style={{ width: 58 }} type="number" min={0} step={50}
              aria-label="Transition duration, ms"
              title={`How long the blend into "${name(t.to)}" takes when this transition fires, in ms. 0 is an instant cut.`}
              value={t.durationMs ?? 0}
              onChange={(e) => update(t.id, { durationMs: Math.max(0, Math.round(+e.target.value)) })} />
            <span className="hint">ms</span>
            <button className="btn sm" title={`The curve the blend follows — currently ${easingLabel(easing)}. Click to shape it.`}
              onClick={() => setCurveOpen((v) => !v)}>{easingLabel(easing)} ⌃</button>
            <Revert what="this transition's blend"
              changed={(t.durationMs ?? 0) !== enterMs || !sameEasing(t.easing, DEFAULT_EASING)}
              onClick={() => { update(t.id, { durationMs: enterMs, easing: DEFAULT_EASING }); setCurveOpen(false); }} />
            {curveOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20 }}>
                <CurveEditor value={easing} onChange={(c) => update(t.id, { easing: c })} />
              </div>
            )}
          </div>

          <p className="sm-note" title={(t.durationMs ?? 0) > 0
            ? 'dotLottie calls a blended transition "Tweened" and takes its duration in seconds'
            : 'A zero-duration edge exports as a plain instant Transition'}>
            exports as <strong>{(t.durationMs ?? 0) > 0 ? `Tweened, ${((t.durationMs ?? 0) / 1000).toFixed(2)}s` : 'Transition (instant)'}</strong>
            {joiner === 'OR' && t.conditions.length > 1 && ` · ${t.conditions.length} edges, one per condition`}
          </p>
          {joiner === 'OR' && t.conditions.length > 1 && (
            <p className="hint" style={{ margin: 0 }}>
              dotLottie has no OR, so this ships as {t.conditions.length} transitions the player tries in order. Same behaviour.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ConditionRow({ condition: c, index, joiner, onChange, onRemove }: {
  condition: SmCondition; index: number; joiner: string;
  onChange: (patch: Partial<SmCondition>) => void; onRemove: () => void;
}) {
  const project = useEditor((s) => s.project);
  const machine = machineOf(project);
  const input: SmInput | undefined = machine.inputs.find((i) => i.name === c.input);
  const type = input?.type ?? 'Numeric';
  const ops = OPERATORS[type];

  // switching input switches the operator set AND the value control — §2's "the UI must
  // dynamically change" is one code path, so the two can never disagree
  const pickInput = (nme: string) => {
    const next = machine.inputs.find((i) => i.name === nme);
    if (!next) return;
    onChange({
      input: nme,
      operator: next.type === 'Event' ? 'Fired' : OPERATORS[next.type].includes(c.operator) ? c.operator : 'Equal',
      value: next.type === 'Event' ? undefined : next.value ?? defaultValueFor(next.type),
    });
  };

  return (
    <div className="sm-row">
      <span className="sm-key" title={index === 0 ? 'This must hold for the transition to fire' : `Combined with the condition above using ${joiner}`}>
        {index === 0 ? 'When' : joiner}
      </span>
      <select className="prop-num" style={{ flex: 1, minWidth: 0 }} value={c.input} aria-label="Condition input"
        title="Which input this condition tests"
        onChange={(e) => pickInput(e.target.value)}>
        {!input && <option value={c.input}>{c.input} (missing)</option>}
        {machine.inputs.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
      </select>
      {/* a Boolean has two meanings, not six: "is true" / "is false". Offering Equal +
          NotEqual alongside a true/false value would give four controls for two outcomes. */}
      {type === 'Boolean' && (
        <div className="seg" title={`Fires while "${c.input}" holds this value`}>
          <button aria-pressed={c.value !== false} onClick={() => onChange({ operator: 'Equal', value: true })}>is true</button>
          <button aria-pressed={c.value === false} onClick={() => onChange({ operator: 'Equal', value: false })}>is false</button>
        </div>
      )}
      {(type === 'Numeric' || type === 'String') && (
        <>
          <select className="prop-num" style={{ width: 56 }} value={c.operator} aria-label="Condition operator"
            title={type === 'Numeric' ? 'How to compare — equal, not equal, or an ordering test' : 'Strings compare for equality only'}
            onChange={(e) => onChange({ operator: e.target.value as ConditionOp })}>
            {ops.map((op) => <option key={op} value={op}>{opLabel(op, type)}</option>)}
          </select>
          <ValueField type={type} value={c.value} label="Condition value"
            title={`The value "${c.input}" is compared against`}
            onChange={(v) => onChange({ value: v })} />
        </>
      )}
      {type === 'Event' && <span className="hint" style={{ flex: 1 }} title={`Fires on the tick the app calls fire("${c.input}")`}>fires</span>}
      <button className="sm-x" aria-label="Remove condition" title="Remove this condition" onClick={onRemove}>×</button>
    </div>
  );
}

// --- validation -------------------------------------------------------------

function Validation() {
  const project = useEditor((s) => s.project);
  const issues = validateMachine(project);
  if (!issues.length) {
    return <p className="hint" style={{ margin: 0 }}>No problems — this machine will export and load.</p>;
  }
  return (
    <>
      {issues.map((issue, i) => (
        <div key={i} className="sm-issue" data-level={issue.level}
          title={issue.level === 'error' ? 'Export is blocked until this is fixed' : 'Worth a look, but export still works'}>
          <b>{issue.level === 'error' ? 'Error' : 'Warning'}</b>
          <span>{issue.message}</span>
        </div>
      ))}
    </>
  );
}

// --- reset ------------------------------------------------------------------

/**
 * The two destructive resets, behind a fold and behind a confirm, saying exactly what
 * each one takes with it.
 *
 * They are different sizes on purpose. Clearing the machine is a normal editing mistake
 * to want undone and stays on the undo stack like any other edit; resetting the project
 * throws the whole document away and does not, which is the one thing worth spelling out
 * before the click rather than after it.
 */
function ResetSection({ onClearSelection }: { onClearSelection: () => void }) {
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.inputs);
  const resetMachine = useEditor((s) => s.resetMachine);
  const resetInputs = useEditor((s) => s.resetInputs);
  const resetProject = useEditor((s) => s.resetProject);
  const machine = machineOf(project);
  const counts = `${machine.inputs.length} input${machine.inputs.length === 1 ? '' : 's'} and ${machine.transitions.length} transition${machine.transitions.length === 1 ? '' : 's'}`;
  const empty = !machine.inputs.length && !machine.transitions.length;

  return (
    <>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!Object.keys(live).length}
        title="Put every live value back to the default its input declares"
        onClick={() => resetInputs()}>↺ Reset live values</button>
      <p className="hint" style={{ margin: 0 }}>
        Only the values you have been testing with. Nothing in the exported file changes.
      </p>

      <div className="divider" />
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={empty}
        title={empty ? 'Nothing to clear' : `Delete ${counts}`}
        onClick={() => {
          if (!confirm(`Delete ${counts}? The states and their animation stay. You can undo this.`)) return;
          resetMachine();
          onClearSelection();
        }}>Clear state machine</button>
      <p className="hint" style={{ margin: 0 }}>
        Deletes every input and transition. States, keyframes and effects are untouched — and
        this is one undo step.
      </p>

      <div className="divider" />
      <button className="btn sm" style={{ alignSelf: 'flex-start', borderColor: 'color-mix(in srgb, var(--hot) 45%, transparent)', color: 'var(--hot)' }}
        title="Throw away this project and start from the default mascot"
        onClick={() => {
          if (!confirm(`Reset "${project.name}"?\n\nThe rig, every timeline, the state machine and all keyframes go back to the default mascot. This cannot be undone — save or export first if you want to keep it.`)) return;
          resetProject();
        }}>Reset project</button>
      <p className="hint" style={{ margin: 0 }}>
        Everything back to the default mascot. <strong>Not undoable</strong> — the same as “New”
        in the toolbar.
      </p>
    </>
  );
}

// --- manual triggers --------------------------------------------------------

/**
 * The old direct-trigger surface, kept but demoted.
 *
 * An app should never call these for a state a transition already covers (§10) — set an
 * input instead. They stay because authoring needs a way to jump to a state that has no
 * inbound edge yet, and because `setState` is still the right call for a state the
 * machine cannot reach on its own.
 */
function ManualTriggers() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const previousTimelineId = useEditor((s) => s.previousTimelineId);
  const pendingStateChange = useEditor((s) => s.pendingStateChange);
  const setState = useEditor((s) => s.setState);
  const cancelScheduledState = useEditor((s) => s.cancelScheduledState);
  const returnToPreviousState = useEditor((s) => s.returnToPreviousState);
  const [atSec, setAtSec] = useState('');

  const previous = project.timelines.find((t) => t.id === previousTimelineId);
  const pendingTarget = project.timelines.find((t) => t.id === pendingStateChange?.timelineId);

  return (
    <>
      <p className="hint">
        Prefer setting an input above — the machine picks the state. These jump straight to one,
        for a state nothing transitions into yet.
      </p>
      <div className="row wrap">
        {project.timelines.filter((t) => t.id !== project.activeTimelineId).map((t) => (
          <span key={t.id} className="row" style={{ gap: 2 }}>
            <button className="btn ghost sm" title={`Jump to "${t.name}" now — setState("${t.name}")`}
              onClick={() => setState(t.id)}>{t.name}</button>
            <button className="btn ghost sm" style={{ padding: '0 6px' }}
              title={`Jump to "${t.name}" once playback reaches the time below — enableState("${t.name}", { at })`}
              onClick={() => setState(t.id, atSec.trim() ? { at: Math.max(0, parseFloat(atSec)) * 1000 } : undefined)}>@</button>
          </span>
        ))}
      </div>
      <div className="sm-row">
        <span className="sm-key" title="When the scheduled jumps above should fire">At</span>
        <input className="prop-num" style={{ width: 58 }} placeholder={(playhead / 1000).toFixed(1)}
          title="Seconds into playback. The “@” buttons wait until the playhead reaches this."
          aria-label="Schedule at, seconds" value={atSec} onChange={(e) => setAtSec(e.target.value)} />
        <span className="hint">s · used by “@”</span>
      </div>
      {pendingStateChange && pendingTarget && (
        <div className="sm-issue">
          <span style={{ flex: 1 }}>Scheduled → <strong>{pendingTarget.name}</strong> at {(pendingStateChange.atMs / 1000).toFixed(2)}s</span>
          <button className="sm-x" style={{ width: 'auto', padding: '0 4px', fontSize: 11 }}
            title="Cancel the scheduled jump" onClick={cancelScheduledState}>Cancel</button>
        </div>
      )}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!previous}
        title={previous ? `Go back to "${previous.name}" — returnToPreviousState()` : 'No previous state yet'}
        onClick={() => returnToPreviousState()}>
        ↩ Return to previous{previous ? ` (${previous.name})` : ''}
      </button>
    </>
  );
}
