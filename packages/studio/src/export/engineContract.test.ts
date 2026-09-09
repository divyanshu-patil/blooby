import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import { buildDotLottie } from './dotlottie';
import { unzip } from './zip';

/**
 * The exported machine, read the way dotlottie-rs reads it.
 *
 * Its parser is all-or-nothing and completely silent. `opt(field, parse)` in json.rs
 * returns `Some(None)` for an ABSENT field but propagates `None` for a field that is
 * present with the wrong type; `state_from_json` forwards that with `?`; and
 * `array_of` collects into `Option<Vec<_>>`, which short-circuits on the first `None`.
 * So ONE mistyped field on ONE state discards the entire machine — and
 * `stateMachineLoad` reports that as a bool the native bindings throw away, leaving the
 * animation to autoplay end to end and look roughly right.
 *
 * That is not hypothetical: `segment` was shipped as `[start, end]` when the field is a
 * marker NAME, and the whole machine silently failed to load. It cost hours to find,
 * because nothing anywhere says no. These assertions are that parser, so the next
 * mistyped field fails here.
 */

type Json = Record<string, unknown>;
const isStr = (v: unknown) => typeof v === 'string';
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown) => typeof v === 'boolean';

/** `opt`: absent is fine, present must parse. Anything else discards the whole state. */
const optional = (o: Json, key: string, ok: (v: unknown) => boolean) =>
  o[key] === undefined || o[key] === null || ok(o[key]);
const required = (o: Json, key: string, ok: (v: unknown) => boolean) => ok(o[key]);

function project() {
  const p = defaultProject();
  p.name = 'watching';
  p.timelines[0].name = 'watching'; p.timelines[0].loop = true; p.timelines[0].timelineDurationMs = 4200;
  const obs = makeTimeline('observe');
  obs.loop = true; obs.timelineDurationMs = 3033; obs.transitionMs = 300;
  p.timelines.push(obs);
  p.stateMachine = {
    id: 'mascot', initialStateId: p.timelines[0].id,
    inputs: [
      { name: 'isTyping', type: 'Boolean', value: false },
      { name: 'energy', type: 'Numeric', value: 40 },
      { name: 'poke', type: 'Event' },
    ],
    transitions: [
      { id: 'a', from: p.timelines[0].id, to: obs.id, logic: 'AND', durationMs: 300, conditions: [{ input: 'isTyping', operator: 'Equal', value: true }] },
      { id: 'b', from: obs.id, to: p.timelines[0].id, logic: 'AND', durationMs: 300, conditions: [{ input: 'isTyping', operator: 'Equal', value: false }] },
      { id: 'c', from: obs.id, to: p.timelines[0].id, logic: 'AND', durationMs: 0, conditions: [{ input: 'energy', operator: 'GreaterThan', value: 80 }] },
    ],
  };
  return p;
}

const p = project();
const files = await unzip(new Uint8Array(await buildDotLottie(p, { background: null }).blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
const read = (n: string) => JSON.parse(new TextDecoder().decode(files.get(n)!));
const machine = read('s/mascot.json') as Json;
const anim = read('a/mascot.json') as Json;
const states = machine.states as Json[];
const markers = (anim.markers ?? []) as { cm: string; tm: number; dr: number }[];

// --- PlaybackState, field for field, per state_machine/states.rs ----------------
const stateOk = (s: Json) => required(s, 'type', (v) => v === 'PlaybackState' || v === 'GlobalState')
  && required(s, 'name', isStr)
  && Array.isArray(s.transitions)
  && (s.type === 'GlobalState' || required(s, 'animation', isStr))
  && optional(s, 'loop', isBool)
  && optional(s, 'loopCount', isNum)
  && optional(s, 'final', isBool)
  && optional(s, 'autoplay', isBool)
  && optional(s, 'mode', (v) => ['Forward', 'Reverse', 'Bounce', 'ReverseBounce'].includes(v as string))
  && optional(s, 'speed', isNum)
  && optional(s, 'segment', isStr)
  && optional(s, 'backgroundColor', isNum)
  && optional(s, 'entryActions', Array.isArray)
  && optional(s, 'exitActions', Array.isArray);

it('every state parses, so the machine is not discarded whole', check(
  states.every(stateOk), JSON.stringify(states.find((s) => !stateOk(s)))));

// the field that actually broke: present, plausible, and the wrong type
it('segment is a marker name, never a frame pair', check(
  states.every((s) => optional(s, 'segment', isStr)),
  JSON.stringify(states.map((s) => s.segment))));
it('and every name it uses is a marker the animation really has', check(
  states.every((s) => !s.segment || markers.some((m) => m.cm === s.segment)),
  `${JSON.stringify(states.map((s) => s.segment))} vs ${JSON.stringify(markers.map((m) => m.cm))}`));

// --- transitions, per transitions/mod.rs ----------------------------------------
const transitions = states.flatMap((s) => s.transitions as Json[]);
const transitionOk = (t: Json) => required(t, 'type', (v) => v === 'Transition' || v === 'Tweened')
  && required(t, 'toState', isStr)
  && Array.isArray(t.guards)
  // a Tweened reads duration and easing with `?` — both are required, not optional
  && (t.type !== 'Tweened' || (isNum(t.duration)
    && Array.isArray(t.easing) && (t.easing as unknown[]).length === 4 && (t.easing as unknown[]).every(isNum)));
it('every transition parses', check(transitions.every(transitionOk), JSON.stringify(transitions.find((t) => !transitionOk(t)))));
it('a Tweened carries duration in SECONDS and a 4-point easing', check(
  transitions.filter((t) => t.type === 'Tweened').every((t) => (t.duration as number) > 0 && (t.duration as number) < 10),
  JSON.stringify(transitions.map((t) => t.duration))));
it('a zero-duration edge ships as a plain Transition, not a 0s Tweened', check(
  transitions.some((t) => t.type === 'Transition'), JSON.stringify(transitions.map((t) => t.type))));

// --- guards, per transitions/guard.rs -------------------------------------------
const guards = transitions.flatMap((t) => t.guards as Json[]);
const guardOk = (g: Json) => required(g, 'inputName', isStr)
  && required(g, 'type', (v) => ['Numeric', 'String', 'Boolean', 'Event'].includes(v as string))
  && (g.type === 'Event' || (isStr(g.conditionType)
    && (g.type === 'Boolean' ? isStr(g.compareTo) || isBool(g.compareTo) : g.compareTo !== undefined)));
it('every guard parses', check(guards.every(guardOk), JSON.stringify(guards.find((g) => !guardOk(g)))));
it('every guard names an input the machine declares', check(
  guards.every((g) => (machine.inputs as Json[]).some((i) => i.name === g.inputName)),
  JSON.stringify(guards.map((g) => g.inputName))));

// --- what the tween needs to be a morph rather than a cut ------------------------
it('both states name the same animation, or the engine skips the tween entirely', check(
  new Set(states.map((s) => s.animation)).size === 1,
  JSON.stringify(states.map((s) => s.animation))));
it('and the marker it tweens to starts after real morph frames', check(
  markers.length === 2 && markers[0].tm + markers[0].dr < markers[1].tm,
  JSON.stringify(markers)));
it('every marker sits inside the composition', check(
  markers.every((m) => m.tm >= (anim.ip as number) && m.tm + m.dr <= (anim.op as number)),
  `${JSON.stringify(markers)} in ${anim.ip}..${anim.op}`));

// --- the manifest the player reads first ----------------------------------------
const manifest = read('manifest.json') as Json;
const initial = manifest.initial as Json;
it('the manifest names an animation that is in the file', check(
  files.has(`a/${initial.animation}.json`), String(initial.animation)));
it('and the state machine, so it can start without the host knowing its id', check(
  files.has(`s/${initial.stateMachine}.json`), String(initial.stateMachine)));
it('and the machine it advertises is the one that ships', check(
  (manifest.stateMachines as Json[])[0].id === initial.stateMachine));
