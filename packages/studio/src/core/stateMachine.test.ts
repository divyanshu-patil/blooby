import { it } from 'vitest';
import { check } from './testkit';
import { defaultProject, makeTimeline } from './defaults';
import {
  animationIds, conditionText, fromDotLottie, nextTransition, OPERATORS, toDotLottie, validateMachine,
} from './stateMachine';
import type { Project, SmTransition } from './types';

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
