import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import { machineConfig, mascotSource } from './runtime';
import type { Project } from '../core/types';

/** Every input type at once — the §9 case where the runtime must stay data-driven. */
function project(): Project {
  const p = defaultProject();
  p.name = 'Blooby';
  p.timelines[0].name = 'watching';
  const observing = makeTimeline('observing');
  p.timelines.push(observing);
  p.stateMachine = {
    id: 'blooby',
    initialStateId: p.timelines[0].id,
    inputs: [
      { name: 'isTyping', type: 'Boolean', value: false },
      { name: 'isListening', type: 'Boolean', value: false },
      { name: 'energy', type: 'Numeric', value: 75 },
      { name: 'speed', type: 'Numeric', value: 1.2 },
      { name: 'mood', type: 'String', value: 'happy' },
      { name: 'activity', type: 'String', value: 'working' },
      { name: 'poke', type: 'Event' },
    ],
    transitions: [
      { id: 't1', from: p.timelines[0].id, to: observing.id, conditions: [{ input: 'isTyping', operator: 'Equal', value: true }], logic: 'AND', durationMs: 300, easing: { type: 'preset', name: 'easeOut' } },
    ],
  };
  return p;
}

// --- the §14 export document ---------------------------------------------------
{
  const cfg = machineConfig(project()).stateMachine;
  it('carries the machine id and initial state by NAME', check(cfg.id === 'blooby' && cfg.initialState === 'watching'));
  it('every input carries name, type and default', check(
    cfg.inputs.length === 7 && cfg.inputs[2].name === 'energy' && (cfg.inputs[2] as { default?: unknown }).default === 75));
  it('an Event input has no default, because it has no value', check(!('default' in cfg.inputs[6])));
  it('each input states the runtime call that drives it', check(
    cfg.inputs[0].runtime === 'stateMachineSetBooleanInput()'
    && cfg.inputs[2].runtime === 'stateMachineSetNumericInput()'
    && cfg.inputs[4].runtime === 'stateMachineSetStringInput()'));
  it('states carry their animation and loop flag', check(
    cfg.states[0].name === 'watching' && cfg.states[0].animation === 'watching'));
  it('transitions are by state name, in seconds, with a readable easing', check(
    cfg.transitions[0].from === 'watching' && cfg.transitions[0].duration === 0.3 && cfg.transitions[0].easing === 'easeOut',
    JSON.stringify(cfg.transitions[0])));
  it('and keep the bezier the player actually needs', check(cfg.transitions[0].easingBezier.length === 4));
}

// --- the generated component ---------------------------------------------------
{
  const src = mascotSource(project());

  it('uses the installed package, not a guessed one', check(src.includes("from '@lottiefiles/dotlottie-react-native'")));
  it('loads and starts the machine by its configured id', check(
    src.includes('stateMachineLoad("blooby")') && src.includes('stateMachineStart()')));

  // §9: every configured input gets the setter its DECLARED TYPE maps to
  it('booleans map to stateMachineSetBooleanInput', check(
    src.includes('"isTyping": \'stateMachineSetBooleanInput\'') && src.includes('"isListening": \'stateMachineSetBooleanInput\'')));
  it('numerics map to stateMachineSetNumericInput', check(
    src.includes('"energy": \'stateMachineSetNumericInput\'') && src.includes('"speed": \'stateMachineSetNumericInput\'')));
  it('strings map to stateMachineSetStringInput', check(
    src.includes('"mood": \'stateMachineSetStringInput\'') && src.includes('"activity": \'stateMachineSetStringInput\'')));
  it('an Event is fired, not set', check(src.includes('stateMachineFire(name)') && !src.includes('"poke": \'stateMachineSet')));

  it('the app-facing prop is typed from what was configured', check(
    src.includes('isTyping?: boolean;') && src.includes('energy?: number;') && src.includes('mood?: string;')));

  // §8/§9: the dispatch itself must not name an input. Only the generated SETTERS table
  // does — everything below it is a loop over Object.entries.
  const dispatch = src.slice(src.indexOf('const apply ='));
  it('the runtime dispatch hardcodes no input name', check(
    !['isTyping', 'energy', 'mood', 'isListening', 'speed', 'activity'].some((n) => dispatch.includes(n)), dispatch.slice(0, 300)));

  // §10: nothing in the generated runtime plays a named animation or seeks a frame.
  // Comments are stripped first — the file's own header says "there is no play('watching')
  // here on purpose", and matching that sentence would pass the check for the wrong reason.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  it('no play("state") anywhere in the generated runtime', check(
    !/\bplay\(\s*['"]/.test(code) && !code.includes('setFrame('), code.slice(0, 200)));

  // §11
  it('state changes are reported with previous, current and the transition', check(
    src.includes('onStateMachineTransition') && src.includes('previousState') && src.includes('currentState') && src.includes('transition:')));
}

// --- a machine with no inputs still generates something that compiles -----------
{
  const bare = defaultProject();
  const src = mascotSource(bare);
  it('an empty machine yields an empty inputs type, not a syntax error', check(src.includes('Record<string, never>')));
  it('and an empty setter table', check(src.includes('// no settable inputs configured')));
}
