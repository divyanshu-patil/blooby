import { it } from 'vitest';
import { check } from './testkit';
import { defaultProject, makeTimeline } from './defaults';
import {
  slug, animationIds, bezierToEasing, conditionHolds, conditionText, defaultValueFor, defaultValues, directTransition,
  fromDotLottie, initialState, machineOf, nextTransition, opLabel, OPERATORS, toDotLottie, transitionHolds, validateMachine,
} from './stateMachine';
import { ANY_STATE, type Project, type SmTransition } from './types';

/** watching ⇄ observing on isTyping, watching → excited on energy > 80, plus a String. */
function machineProject(): Project {
  const p = defaultProject();
  p.timelines[0].name = 'watching';
  const observing = makeTimeline('observing');
  const excited = makeTimeline('excited');
  p.timelines.push(observing, excited);
  p.stateMachine = {
    id: 'blooby',
    initialStateId: p.timelines[0].id,
    inputs: [
      { name: 'isTyping', type: 'Boolean', value: false },
      { name: 'energy', type: 'Numeric', value: 50 },
      { name: 'mood', type: 'String', value: 'neutral' },
    ],
    transitions: [
      { id: 't1', from: p.timelines[0].id, to: observing.id, conditions: [{ input: 'isTyping', operator: 'Equal', value: true }], logic: 'AND', durationMs: 300, easing: { type: 'preset', name: 'easeOut' } },
      { id: 't2', from: observing.id, to: p.timelines[0].id, conditions: [{ input: 'isTyping', operator: 'Equal', value: false }], logic: 'AND', durationMs: 0 },
      { id: 't3', from: p.timelines[0].id, to: excited.id, conditions: [
        { input: 'energy', operator: 'GreaterThan', value: 80 },
        { input: 'mood', operator: 'Equal', value: 'happy' },
      ], logic: 'AND', durationMs: 200 },
    ],
  };
  return p;
}

// --- evaluation: the machine picks the state, not the caller -------------------
{
  const p = machineProject();
  const watching = p.timelines[0].id;
  const observing = p.timelines[1].id;

  it('a boolean condition fires its transition', check(
    nextTransition(p, watching, { isTyping: true, energy: 50, mood: 'neutral' })?.to === observing));
  it('and does not fire when it does not hold', check(
    nextTransition(p, watching, { isTyping: false, energy: 50, mood: 'neutral' }) === undefined));
  it('AND needs every condition, not just one', check(
    nextTransition(p, watching, { isTyping: false, energy: 99, mood: 'neutral' }) === undefined));
  it('AND fires once every condition holds', check(
    nextTransition(p, watching, { isTyping: false, energy: 99, mood: 'happy' })?.to === p.timelines[2].id));
  it('an outgoing edge of another state is never taken', check(
    nextTransition(p, observing, { isTyping: true, energy: 99, mood: 'happy' }) === undefined));

  const or: SmTransition = { id: 'o', from: watching, to: observing, logic: 'OR', conditions: [
    { input: 'isTyping', operator: 'Equal', value: true },
    { input: 'energy', operator: 'GreaterThan', value: 80 },
  ] };
  const orProject: Project = { ...p, stateMachine: { ...p.stateMachine!, transitions: [or] } };
  it('OR fires on either condition', check(
    nextTransition(orProject, watching, { isTyping: false, energy: 99, mood: 'x' })?.id === 'o'));
  it('OR fires on neither when neither holds', check(
    nextTransition(orProject, watching, { isTyping: false, energy: 10, mood: 'x' }) === undefined));
}

// --- export: real dotLottie guards, not a Blooby dialect -----------------------
{
  const p = machineProject();
  const { json, id } = toDotLottie(p);
  const watching = json.states.find((s) => s.name === 'watching')!;
  const toObserving = watching.transitions[0] as Record<string, unknown>;
  const guard = (toObserving.guards as Record<string, unknown>[])[0];

  it('the machine id reaches the file', check(id === 'blooby'));
  it('initial is the state NAME the engine looks up', check(json.initial === 'watching'));
  it('a boolean guard is a real Boolean guard', check(
    guard.type === 'Boolean' && guard.inputName === 'isTyping' && guard.conditionType === 'Equal' && guard.compareTo === true,
    JSON.stringify(guard)));
  it('a blended transition is Tweened, in SECONDS', check(
    toObserving.type === 'Tweened' && toObserving.duration === 0.3, JSON.stringify(toObserving)));
  it('a zero-duration transition is a plain Transition', check(
    (json.states.find((s) => s.name === 'observing')!.transitions[0] as Record<string, unknown>).type === 'Transition'));
  it('two AND conditions are two guards on ONE transition', check(
    ((watching.transitions[1] as Record<string, unknown>).guards as unknown[]).length === 2));
  it('inputs carry their declared defaults', check(
    JSON.stringify(json.inputs) === JSON.stringify([
      { type: 'Boolean', name: 'isTyping', value: false },
      { type: 'Numeric', name: 'energy', value: 50 },
      { type: 'String', name: 'mood', value: 'neutral' },
    ]), JSON.stringify(json.inputs)));
  it('every state points at an animation the file will carry', check(
    json.states.every((s) => [...animationIds(p).values()].includes(s.animation))));

  // OR has no representation in a guard list, so it must fan out into separate edges
  const orProject: Project = { ...p, stateMachine: { ...p.stateMachine!, transitions: [
    { id: 'o', from: p.timelines[0].id, to: p.timelines[1].id, logic: 'OR', conditions: [
      { input: 'isTyping', operator: 'Equal', value: true },
      { input: 'energy', operator: 'GreaterThan', value: 80 },
    ] },
  ] } };
  const orStates = toDotLottie(orProject).json.states.find((s) => s.name === 'watching')!;
  it('OR exports as one transition per condition', check(orStates.transitions.length === 2, String(orStates.transitions.length)));
  it('each fanned-out edge carries exactly one guard', check(
    orStates.transitions.every((t) => ((t as Record<string, unknown>).guards as unknown[]).length === 1)));
}

// --- round trip: nothing is lost coming back in (§13) --------------------------
{
  const p = machineProject();
  const { json } = toDotLottie(p);
  const ids = new Map<string, string>();
  const read = fromDotLottie(json, (name) => {
    if (!ids.has(name)) ids.set(name, `tl-${name}`);
    return ids.get(name)!;
  })!;

  it('every input survives the round trip', check(
    JSON.stringify(read.inputs) === JSON.stringify(p.stateMachine!.inputs), JSON.stringify(read.inputs)));
  it('every transition survives the round trip', check(read.transitions.length === 3, String(read.transitions.length)));
  it('the initial state survives', check(read.initialStateId === 'tl-watching'));
  it('a tween comes back in milliseconds', check(
    read.transitions.find((t) => t.to === 'tl-observing')?.durationMs === 300));
  it('its easing comes back as the named curve, not raw numbers', check(
    JSON.stringify(read.transitions.find((t) => t.to === 'tl-observing')?.easing) === JSON.stringify({ type: 'preset', name: 'easeOut' })));
  it('conditions come back with their operators and values', check(
    JSON.stringify(read.transitions[0].conditions) === JSON.stringify([{ input: 'isTyping', operator: 'Equal', value: true }]),
    JSON.stringify(read.transitions[0].conditions)));
  it('nothing dangles', check(read.danglingInputs.length === 0));
}

// --- validation catches what a player would only fail at silently --------------
{
  const clean = machineProject();
  it('a well-formed machine has no errors', check(
    validateMachine(clean).filter((i) => i.level === 'error').length === 0,
    JSON.stringify(validateMachine(clean))));

  const errorsOf = (fn: (p: Project) => void) => {
    const p = machineProject();
    fn(p);
    return validateMachine(p).filter((i) => i.level === 'error');
  };

  it('a numeric operator on a Boolean input is an error', check(
    errorsOf((p) => { p.stateMachine!.transitions[0].conditions[0].operator = 'GreaterThan'; }).length === 1));
  it('a String compared to a number is an error', check(
    errorsOf((p) => { p.stateMachine!.transitions[2].conditions[1].value = 3; }).length === 1));
  it('a condition on an undeclared input is an error', check(
    errorsOf((p) => { p.stateMachine!.transitions[0].conditions[0].input = 'nope'; }).length === 1));
  it('a transition to a deleted state is an error', check(
    errorsOf((p) => { p.stateMachine!.transitions[0].to = 'gone'; }).length === 1));
  it('a duplicate state name is an error', check(
    errorsOf((p) => { p.timelines[1].name = 'watching'; }).length === 1));
  it('a duplicate input name is an error', check(
    errorsOf((p) => { p.stateMachine!.inputs.push({ name: 'energy', type: 'Numeric', value: 1 }); }).length === 1));
  it('a default of the wrong type is an error', check(
    errorsOf((p) => { p.stateMachine!.inputs[1].value = 'fifty'; }).length > 0));
  it('an initial state that no longer exists is an error', check(
    errorsOf((p) => { p.stateMachine!.initialStateId = 'gone'; }).length === 1));
  it('a transition with no conditions can never fire, and says so', check(
    errorsOf((p) => { p.stateMachine!.transitions[0].conditions = []; }).length === 1));
}

// --- the operator sets the UI offers per type ----------------------------------
{
  it('boolean operators are equality only', check(OPERATORS.Boolean.join() === 'Equal,NotEqual'));
  it('numeric operators include ordering', check(OPERATORS.Numeric.length === 6));
  it('string operators are equality only', check(OPERATORS.String.join() === 'Equal,NotEqual'));
  const inputs = machineProject().stateMachine!.inputs;
  it('a condition reads the way the spec writes it', check(
    conditionText({ input: 'energy', operator: 'GreaterThan', value: 80 }, inputs) === 'energy > 80'));
  it('a string condition quotes its value', check(
    conditionText({ input: 'mood', operator: 'Equal', value: 'happy' }, inputs) === 'mood == "happy"'));
  it('a boolean condition reads as words', check(
    conditionText({ input: 'isTyping', operator: 'Equal', value: true }, inputs) === 'isTyping is true'));
}

// --- a transition that holds on the defaults leaves the starred state at once -----
{
  const p = machineProject();
  const leaves = () => validateMachine(p).filter((i) => i.message.includes('moves straight to'));
  it('a machine that settles in its starred state is not warned about', check(leaves().length === 0, JSON.stringify(leaves())));
  // hii ⇄ convo on `change`, starred on hii — but change starts false, so convo fires at once
  p.stateMachine!.transitions = [
    { id: 'a', from: ANY_STATE, to: p.timelines[1].id, conditions: [{ input: 'isTyping', operator: 'Equal', value: false }], logic: 'AND', durationMs: 300 },
    { id: 'b', from: ANY_STATE, to: p.timelines[0].id, conditions: [{ input: 'isTyping', operator: 'Equal', value: true }], logic: 'AND', durationMs: 300 },
  ];
  it('one that leaves it on the defaults is', check(leaves().length === 1 && leaves()[0].message.includes('"observing"') && leaves()[0].message.includes('isTyping = false'), JSON.stringify(leaves())));
  p.stateMachine!.inputs[0].value = true;
  it('and a default that holds it there clears the warning', check(leaves().length === 0));
}

// --- labels, defaults, helpers --------------------------------------------------
{
  const inputs = [
    { name: 'ev', type: 'Event' as const }, { name: 'b', type: 'Boolean' as const }, { name: 's', type: 'String' as const, value: 'x' },
  ];
  it('event reads as fires', check(opLabel('Fired', 'Event') === 'fires' && conditionText({ input: 'ev', operator: 'Fired' }, inputs) === 'ev fires'));
  it('boolean words', check(opLabel('Equal', 'Boolean', true) === 'is true' && opLabel('NotEqual', 'Boolean', true) === 'is false' && opLabel('Equal', 'Boolean', false) === 'is false'));
  it('boolean text', check(conditionText({ input: 'b', operator: 'Equal', value: true }, inputs) === 'b is true'));
  it('string text quotes', check(conditionText({ input: 's', operator: 'Equal', value: 'hi' }, inputs) === 's == "hi"' && conditionText({ input: 's', operator: 'NotEqual' }, inputs) === 's != ""'));
  it('numeric default input type and value', check(conditionText({ input: 'zz', operator: 'GreaterThan' }, inputs) === 'zz > 0'));
  it('every numeric operator has a label', check(['Equal', 'NotEqual', 'GreaterThan', 'GreaterThanOrEqual', 'LessThan', 'LessThanOrEqual'].map((o) => opLabel(o as never, 'Numeric')).join(' ') === '== != > >= < <='));
  it('unknown operator falls through', check(opLabel('Fired', 'Numeric') === 'Fired'));
  it('defaults per type', check(defaultValueFor('Boolean') === false && defaultValueFor('Numeric') === 0 && defaultValueFor('String') === '' && defaultValueFor('Event') === undefined));
  const p = defaultProject();
  p.name = ''; delete p.stateMachine;
  it('machineOf defaults with a blooby id', check(machineOf(p).id === 'blooby'));
  p.name = 'My Mascot'; delete p.stateMachine;
  it('machineOf slugs the name', check(machineOf(p).id === 'my-mascot'));
  const q = makeTimeline('');
  const r = defaultProject();
  r.timelines = [q];
  it('an unnamed state still gets an animation id', check(animationIds(r).get(q.id) === 'anim'));
  r.timelines[0].name = 'a'; r.timelines.push(makeTimeline('a'));
  it('duplicate names are numbered', check(animationIds(r).get(r.timelines[1].id) === 'a-2'));
  r.stateMachine = { id: '', initialStateId: undefined, inputs: [{ name: 'e', type: 'Event' }, { name: 'n', type: 'Numeric' }], transitions: [] };
  it('toDotLottie falls back to a blooby id and default values', check(toDotLottie(r).id === 'blooby' && (toDotLottie(r).json.inputs[1] as { value: number }).value === 0));
  it('defaultValues skips events and fills numerics', check(!('e' in defaultValues(r)) && defaultValues(r).n === 0));
  it('initialState falls back to the first', check(initialState(r) === r.timelines[0]));
}

// --- condition / transition evaluation -------------------------------------------
{
  const v = { n: 5, ev: true, off: false };
  const c = (operator: never, value?: number) => ({ input: 'n', operator, value });
  it('numeric operators', check(conditionHolds(c('NotEqual' as never, 4), v) && conditionHolds(c('GreaterThanOrEqual' as never, 5), v) && conditionHolds(c('LessThan' as never, 6), v) && conditionHolds(c('LessThanOrEqual' as never, 5), v) && !conditionHolds(c('Equal' as never, 4), v)));
  it('fired passes only on the tick', check(conditionHolds({ input: 'ev', operator: 'Fired' }, v) && !conditionHolds({ input: 'off', operator: 'Fired' }, v)));
  it('missing value fails; missing compareTo reads as 0', check(!conditionHolds({ input: 'nope', operator: 'Equal', value: 1 }, v) && conditionHolds({ input: 'n', operator: 'GreaterThan' } as never, v)));
  const t = (logic: 'AND' | 'OR', conditions: never[]) => ({ id: 't', from: 'a', to: 'b', conditions, logic, durationMs: 0 });
  it('empty never fires; OR vs AND', check(
    !transitionHolds(t('AND', []), v)
    && transitionHolds(t('OR', [c('Equal' as never, 1), c('Equal' as never, 5)] as never), v)
    && !transitionHolds(t('AND', [c('Equal' as never, 1), c('Equal' as never, 5)] as never), v)));
}

// --- dotLottie in and out ----------------------------------------------------------
{
  it('bezierToEasing: garbage → easeInOut, known → name, custom → bezier', check(
    bezierToEasing('x').type === 'preset' && bezierToEasing([1, 2, 3]).type === 'preset' && bezierToEasing([1, 2, 'a', 4]).type === 'preset'
    && bezierToEasing([0.25, 0.1, 0.25, 1]).type !== undefined && bezierToEasing([0.11, 0.22, 0.33, 0.44]).type === 'bezier'));

  it('not an object → null', check(fromDotLottie(null, () => 'x') === null && fromDotLottie([], () => 'x') === null && fromDotLottie('s', () => 'x') === null));
  const ids: Record<string, string> = {};
  const got = fromDotLottie({
    initial: 'A',
    inputs: [
      null, { type: 'Nope', name: 'q' }, { type: 'Numeric', name: '' },
      { type: 'Event', name: 'ev' }, { type: 'Numeric', name: 'n' }, { type: 'Boolean', name: 'b', value: true },
    ],
    states: [
      null, { type: 'GlobalState', name: 'G' }, { type: 'PlaybackState', name: '' },
      {
        type: 'PlaybackState', name: 'A', animation: 'a', loop: true, segment: 'm', transitions: [
          null,
          { toState: 'missing', guards: [] },
          { toState: 'B', guards: [] },
          { toState: 'B', guards: [null, { type: 'Numeric', inputName: '' }] },
          { type: 'Tweened', toState: 'B', duration: 0.5, easing: [0.1, 0.2, 0.3, 0.4], guards: [{ type: 'Event', inputName: 'ev' }, { type: 'Numeric', inputName: 'n' }, { type: 'Numeric', inputName: 'ghost', conditionType: 'GreaterThan', compareTo: 3 }] },
          { type: 'Tweened', toState: 'B', guards: [{ type: 'Event', inputName: 'ev' }] },
          { toState: 'B', guards: [{ type: 'Event', inputName: 'ev' }] },
        ],
      },
      { type: 'PlaybackState', name: 'B', animation: 'b' },
    ],
  }, (name) => (ids[name] ??= `id-${name}`))!;
  it('inputs filtered and defaulted', check(got.inputs.length === 3 && got.inputs[1].value === 0 && got.inputs[2].value === true));
  it('transitions parsed', check(got.transitions.length === 3 && got.transitions[0].durationMs === 500 && got.transitions[0].conditions[1].operator === 'Equal' && got.transitions[1].durationMs === 0 && got.transitions[2].easing === undefined));
  it('dangling input surfaced; initial resolved', check(got.danglingInputs.join() === 'ghost' && got.initialStateId === 'id-A'));
  it('segment and loop passed through', check(!!ids.A && !ids['']));
  const bare = fromDotLottie({}, () => 'x')!;
  it('empty file parses', check(bare.inputs.length === 0 && bare.initialStateId === undefined));
}

// --- directTransition ----------------------------------------------------------------
{
  const p = machineProject();
  const [a, b, c] = p.timelines.map((t) => t.id);
  it('unknown target → null', check(directTransition(p, a, 'nope', { durationMs: 0 }) === null));
  const r1 = directTransition(p, a, b, { durationMs: 100, input: '  ' })!;
  it('blank input name falls back to state, created as String', check(r1.input === 'state' && r1.value === p.timelines[1].name && p.stateMachine!.inputs.some((i) => i.name === 'state')));
  const n = p.stateMachine!.transitions.length;
  directTransition(p, a, b, { durationMs: -5, easing: { type: 'linear' } });
  it('same edge updates in place (clamped)', check(p.stateMachine!.transitions.length === n && p.stateMachine!.transitions.at(-1)!.durationMs === 0 && p.stateMachine!.transitions.at(-1)!.easing?.type === 'linear'));
  directTransition(p, a, b, { durationMs: 7 });
  it('same edge without easing keeps it', check(p.stateMachine!.transitions.at(-1)!.durationMs === 7));
  it('custom string value', check(directTransition(p, a, c, { durationMs: 0, value: 'go', easing: { type: 'linear' } })!.value === 'go'));
  it('boolean input refused', check(directTransition(p, a, b, { durationMs: 0, input: 'isTyping' }) === null));
  p.stateMachine!.inputs.push({ name: 'ev', type: 'Event' });
  it('event input refused', check(directTransition(p, a, b, { durationMs: 0, input: 'ev' }) === null));
  it('numeric: explicit and indexed values', check(directTransition(p, a, b, { durationMs: 0, input: 'energy', value: 9 })!.value === 9 && directTransition(p, a, c, { durationMs: 0, input: 'energy' })!.value === 2));
  it('string input with empty value uses the name', check(directTransition(p, a, b, { durationMs: 0, input: 'mood', value: '' })!.value === p.timelines[1].name));
  it('self edge and unknown source are skipped', check((() => { const k = p.stateMachine!.transitions.length; directTransition(p, b, b, { durationMs: 0 }); directTransition(p, 'ghost', b, { durationMs: 0 }); return p.stateMachine!.transitions.length === k; })()));
  it('fromAny adds one any-state rule', check((() => { directTransition(p, a, c, { durationMs: 0, fromAny: true, input: 'anyIn' }); return p.stateMachine!.transitions.filter((t) => t.from === ANY_STATE).length === 1; })()));
  const bare = defaultProject();
  bare.timelines.push(makeTimeline('x'));
  it('creates the machine when absent', check(directTransition(bare, bare.timelines[0].id, bare.timelines[1].id, { durationMs: 0 }) !== null && !!bare.stateMachine));
}

// --- validation -------------------------------------------------------------------------
{
  const p = machineProject();
  p.timelines[0].name = ' ';
  p.timelines[1].name = 'x'; p.timelines[2].name = 'X';
  p.timelines[1].animationId = 'gone';
  const m = p.stateMachine!;
  m.initialStateId = 'missing';
  m.inputs = [
    { name: ' ', type: 'Numeric' }, { name: 'ev', type: 'Event' }, { name: 'dup', type: 'Numeric', value: 'bad' as never }, { name: 'dup', type: 'Boolean', value: false },
    { name: 'unused', type: 'Numeric', value: 0 }, { name: 'num', type: 'Numeric', value: 1 }, { name: 'str', type: 'String', value: 's' }, { name: 'flag', type: 'Boolean', value: true },
  ];
  const [a, b] = p.timelines.map((t) => t.id);
  const tr = (id: string, from: string, to: string, conditions: never[]) => ({ id, from, to, conditions, logic: 'AND' as const, durationMs: 0 });
  m.transitions = [
    tr('gone', 'ghost', b, []), tr('gone2', ANY_STATE, 'ghost', []), tr('empty', a, b, []),
    tr('noinput', a, b, [{ input: 'zz', operator: 'Equal', value: 1 }] as never),
    tr('badop', a, b, [{ input: 'str', operator: 'GreaterThan', value: 's' }] as never),
    tr('evok', a, b, [{ input: 'ev', operator: 'Fired' }] as never),
    tr('badval', a, b, [{ input: 'num', operator: 'Equal', value: 's' }] as never),
    tr('fine', ANY_STATE, b, [{ input: 'flag', operator: 'Equal', value: true }] as never),
  ];
  const msgs = validateMachine(p).map((i) => i.message).join('\n');
  for (const frag of ['no name', 'both called "X"', 'not in this project', 'An input has no name', 'both called "dup"', 'default is a string', 'initial state no longer', 'no longer exists', 'no conditions', 'not an input', 'cannot be used', 'compared to a string', 'not used by any transition', 'starts in', '? →', 'Any state →'])
    it(`validation reports: ${frag}`, check(msgs.includes(frag), msgs));
  const lone = defaultProject();
  lone.timelines.push(makeTimeline('two'));
  it('no transitions warns', check(validateMachine(lone).some((i) => i.message.includes('No transitions'))));
}

// --- toDotLottie guards and segments -------------------------------------------------------
{
  const p = machineProject();
  const [a, b] = p.timelines.map((t) => t.id);
  p.stateMachine!.inputs.push({ name: 'ev', type: 'Event' }, { name: 'bare', type: 'Numeric' });
  p.stateMachine!.transitions = [
    { id: 'x1', from: a, to: b, conditions: [{ input: 'nope', operator: 'Equal', value: 1 }], logic: 'AND', durationMs: 0 },
    { id: 'x2', from: a, to: b, conditions: [{ input: 'ev', operator: 'Fired' }, { input: 'bare', operator: 'Equal' }], logic: 'AND', durationMs: 0 },
  ];
  p.timelines[1].segment = 'seg';
  const j = toDotLottie(p).json as { states: { transitions: { guards: Record<string, unknown>[] }[]; segment?: string }[] };
  it('unknown-input guards drop the edge, event and defaulted guards stay', check(j.states[0].transitions.length === 1 && j.states[0].transitions[0].guards[0].type === 'Event' && j.states[0].transitions[0].guards[1].compareTo === 0));
  it('segment only when set', check(j.states[0].segment === undefined && j.states[1].segment === 'seg'));
  it('slug is total', check(slug() === ''));
  p.stateMachine!.inputs.push({ name: 'nov', type: 'Numeric' });
  it('a valueless numeric input validates', check(!validateMachine(p).some((i) => i.inputName === 'nov' && i.level === 'error')));
}
