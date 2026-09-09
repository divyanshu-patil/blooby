import { curveHandles, namedEasing } from './easing';
import type {
  ConditionOp, EasingCurve, InputType, InputValue, Project, SmCondition, SmInput,
  SmTransition, StateMachineDef, Timeline,
} from './types';

/**
 * The state machine, in both directions.
 *
 * Blooby's editor state and a dotLottie state-machine file are nearly the same object on
 * purpose — the input types, the guard `conditionType`s and the transition shape are
 * dotLottie's own, verbatim (checked against dotlottie-rs's `state_machine/` parsers, not
 * guessed), so `toDotLottie` is close to an identity mapping and `fromDotLottie` loses
 * nothing on the way back. There is exactly one thing Blooby carries that the format has
 * no field for — `OR` across conditions — and it converts deterministically: a guard list
 * is always ANDed by the engine (`guards.iter().all(...)`), so an OR fans out into one
 * transition per condition, which the engine tries in order. Same semantics, no invented
 * key a player would ignore.
 */

// ---------------------------------------------------------------------------
// operators

/** dotLottie's conditionType set, per input type. Event has no condition at all. */
export const OPERATORS: Record<InputType, ConditionOp[]> = {
  Boolean: ['Equal', 'NotEqual'],
  Numeric: ['Equal', 'NotEqual', 'GreaterThan', 'GreaterThanOrEqual', 'LessThan', 'LessThanOrEqual'],
  String: ['Equal', 'NotEqual'],
  Event: ['Fired'],
};

/** How an operator reads in the editor — booleans get words, everything else gets maths. */
export function opLabel(op: ConditionOp, type: InputType, value?: InputValue): string {
  if (type === 'Event') return 'fires';
  if (type === 'Boolean') return (op === 'Equal') === (value !== false) ? 'is true' : 'is false';
  switch (op) {
    case 'Equal': return '==';
    case 'NotEqual': return '!=';
    case 'GreaterThan': return '>';
    case 'GreaterThanOrEqual': return '>=';
    case 'LessThan': return '<';
    case 'LessThanOrEqual': return '<=';
    default: return op;
  }
}

/** `isTyping == true` / `energy > 80` / `mood == "happy"` — for edge labels and lists. */
export function conditionText(c: SmCondition, inputs: SmInput[]): string {
  const type = inputs.find((i) => i.name === c.input)?.type ?? 'Numeric';
  if (type === 'Event') return `${c.input} fires`;
  if (type === 'Boolean') return `${c.input} ${opLabel(c.operator, type, c.value)}`;
  const v = type === 'String' ? JSON.stringify(String(c.value ?? '')) : String(c.value ?? 0);
  return `${c.input} ${opLabel(c.operator, type)} ${v}`;
}

export function defaultValueFor(type: InputType): InputValue | undefined {
  return type === 'Boolean' ? false : type === 'Numeric' ? 0 : type === 'String' ? '' : undefined;
}

/** The runtime call that drives this input — shown next to it in the editor (§18). */
export const RUNTIME_SETTER: Record<InputType, string> = {
  Boolean: 'stateMachineSetBooleanInput()',
  Numeric: 'stateMachineSetNumericInput()',
  String: 'stateMachineSetStringInput()',
  Event: 'stateMachineFire()',
};

// ---------------------------------------------------------------------------
// reading the machine off a project

/** The project's machine, defaulted — the one place `stateMachine` being absent is handled. */
export function machineOf(p: Project): StateMachineDef {
  return p.stateMachine ?? { id: slug(p.name) || 'blooby', inputs: [], transitions: [] };
}

export function initialState(p: Project): Timeline {
  const m = machineOf(p);
  return p.timelines.find((t) => t.id === m.initialStateId) ?? p.timelines[0];
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * timeline id → the animation id it plays, deduplicated.
 *
 * An imported state keeps whatever animation it already referenced; an authored one gets
 * a slug of its own name. Both the exporter (which writes `a/<id>.json`) and the machine
 * builder read this, so a state can never point at an animation the file does not carry.
 */
export function animationIds(p: Project): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const tl of p.timelines) {
    const base = tl.animationId ?? (slug(tl.name) || 'anim');
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    out.set(tl.id, id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// evaluation — the editor preview runs the same rules the player does

const compare = (op: ConditionOp, a: InputValue, b: InputValue): boolean => {
  switch (op) {
    case 'Equal': return a === b;
    case 'NotEqual': return a !== b;
    case 'GreaterThan': return a > b;
    case 'GreaterThanOrEqual': return a >= b;
    case 'LessThan': return a < b;
    case 'LessThanOrEqual': return a <= b;
    // an Event guard passes only on the tick its input fired, which the caller signals by
    // putting the event name in `values` — never a standing value.
    case 'Fired': return a === true;
  }
};

export function conditionHolds(c: SmCondition, values: Record<string, InputValue>): boolean {
  const actual = values[c.input];
  if (actual === undefined) return false;
  return compare(c.operator, actual, c.operator === 'Fired' ? true : c.value ?? 0);
}

export function transitionHolds(t: SmTransition, values: Record<string, InputValue>): boolean {
  if (!t.conditions.length) return false; // an unconditional edge would fire forever
  return t.logic === 'OR'
    ? t.conditions.some((c) => conditionHolds(c, values))
    : t.conditions.every((c) => conditionHolds(c, values));
}

/**
 * The first outgoing transition of `fromId` whose conditions hold — the engine's own
 * first-match-wins order, so the editor preview and the shipped file agree on which of
 * two satisfiable edges is taken.
 */
export function nextTransition(p: Project, fromId: string, values: Record<string, InputValue>): SmTransition | undefined {
  return machineOf(p).transitions.find((t) => t.from === fromId && transitionHolds(t, values));
}

/** The declared defaults, as a live value bag to start a session from. */
export function defaultValues(p: Project): Record<string, InputValue> {
  const out: Record<string, InputValue> = {};
  for (const i of machineOf(p).inputs) {
    if (i.type === 'Event') continue;
    out[i.name] = i.value ?? defaultValueFor(i.type) ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blooby → dotLottie

/** dotLottie writes easing as a 4-number cubic bezier, the same handles the curve editor
 *  already exposes. A preset outside cubic-bezier space (bounce/elastic) is approximated
 *  by its own stand-in handles rather than silently dropped. */
export function easingToBezier(c: EasingCurve): [number, number, number, number] {
  const [p1, p2] = curveHandles(c);
  return [p1.x, p1.y, p2.x, p2.y];
}

export function bezierToEasing(e: unknown): EasingCurve {
  if (!Array.isArray(e) || e.length !== 4 || e.some((n) => typeof n !== 'number')) return namedEasing('easeInOut');
  const [x1, y1, x2, y2] = e as number[];
  for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
    const [p1, p2] = curveHandles(namedEasing(name));
    if (p1.x === x1 && p1.y === y1 && p2.x === x2 && p2.y === y2) return namedEasing(name);
  }
  return { type: 'bezier', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
}

type Guard = Record<string, unknown>;

function guardFor(c: SmCondition, inputs: SmInput[]): Guard | null {
  const input = inputs.find((i) => i.name === c.input);
  if (!input) return null;
  if (input.type === 'Event') return { type: 'Event', inputName: c.input };
  return {
    type: input.type,
    inputName: c.input,
    conditionType: c.operator,
    compareTo: c.value ?? defaultValueFor(input.type),
  };
}

function transitionJson(toState: string, guards: Guard[], t: SmTransition) {
  const ms = t.durationMs ?? 0;
  return ms > 0
    // `Tweened` takes its duration in SECONDS (the engine multiplies by 1000) — the one
    // unit conversion in this file, and the easiest thing here to get silently wrong.
    ? { type: 'Tweened', toState, guards, duration: +(ms / 1000).toFixed(4), easing: easingToBezier(t.easing ?? namedEasing('easeInOut')) }
    : { type: 'Transition', toState, guards };
}

/**
 * The `s/<id>.json` payload: flat `{ initial, states, inputs, transitions… }`, exactly
 * what `state_machine_parse` reads.
 */
export function toDotLottie(p: Project) {
  const m = machineOf(p);
  const anim = animationIds(p);
  const byId = new Map(p.timelines.map((t) => [t.id, t]));
  const nameOf = (id: string) => byId.get(id)?.name ?? '';

  const states = p.timelines.map((tl) => {
    const outgoing: ReturnType<typeof transitionJson>[] = [];
    for (const t of m.transitions) {
      if (t.from !== tl.id || !byId.has(t.to)) continue;
      const to = nameOf(t.to);
      const guards = t.conditions.map((c) => guardFor(c, m.inputs)).filter((g): g is Guard => !!g);
      if (!guards.length) continue;
      // OR has no representation in a guard list, so it becomes one edge per condition —
      // the engine takes the first that holds, which is exactly an OR.
      if (t.logic === 'OR') for (const g of guards) outgoing.push(transitionJson(to, [g], t));
      else outgoing.push(transitionJson(to, guards, t));
    }
    return {
      type: 'PlaybackState',
      name: tl.name,
      animation: anim.get(tl.id)!,
      loop: tl.loop,
      autoplay: true,
      transitions: outgoing,
    };
  });

  const inputs = m.inputs.map((i) => (i.type === 'Event'
    ? { type: 'Event', name: i.name }
    : { type: i.type, name: i.name, value: i.value ?? defaultValueFor(i.type) }));

  return { id: m.id || 'blooby', json: { initial: initialState(p).name, states, inputs } };
}

// ---------------------------------------------------------------------------
// dotLottie → Blooby

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Read a state machine file back into Blooby's own shape, preserving everything §13 asks
 * for: names, input types, defaults, transitions, conditions, durations, easing, the
 * initial state and each state's animation reference.
 *
 * States become timelines, which is the same 1:1 mapping the exporter has always used —
 * `timelineIdFor` lets the caller reuse a timeline that already exists under that name
 * instead of duplicating it.
 */
export function fromDotLottie(machineJson: unknown, timelineIdFor: (stateName: string, animation: string, loop: boolean) => string) {
  const root = obj(machineJson);
  if (!root) return null;

  const inputs: SmInput[] = [];
  for (const raw of arr(root.inputs)) {
    const i = obj(raw);
    const type = str(i?.type) as InputType;
    const name = str(i?.name);
    if (!name || !OPERATORS[type]) continue;
    inputs.push(type === 'Event'
      ? { name, type }
      : { name, type, value: (i!.value as InputValue) ?? defaultValueFor(type) });
  }

  // every state first, so a transition's target resolves even when it points forward
  const stateIds = new Map<string, string>();
  const states = arr(root.states).map(obj).filter((s): s is Json => !!s && str(s.type) !== 'GlobalState');
  for (const s of states) {
    const name = str(s.name);
    if (!name) continue;
    stateIds.set(name, timelineIdFor(name, str(s.animation), s.loop === true));
  }

  const transitions: SmTransition[] = [];
  let n = 0;
  for (const s of states) {
    const from = stateIds.get(str(s.name));
    if (!from) continue;
    for (const rawT of arr(s.transitions)) {
      const t = obj(rawT);
      const to = stateIds.get(str(t?.toState));
      if (!t || !to) continue;
      const conditions: SmCondition[] = [];
      for (const rawG of arr(t.guards)) {
        const g = obj(rawG);
        const input = str(g?.inputName);
        if (!g || !input) continue;
        conditions.push(str(g.type) === 'Event'
          ? { input, operator: 'Fired' }
          : { input, operator: (str(g.conditionType) || 'Equal') as ConditionOp, value: g.compareTo as InputValue });
      }
      if (!conditions.length) continue;
      const tweened = str(t.type) === 'Tweened';
      transitions.push({
        id: `imported-t${n++}`,
        from, to, conditions,
        // guards on one transition are ANDed by the engine, always
        logic: 'AND',
        durationMs: tweened && typeof t.duration === 'number' ? Math.round(t.duration * 1000) : 0,
        ...(tweened ? { easing: bezierToEasing(t.easing) } : {}),
      });
    }
  }

  return {
    inputs,
    transitions,
    initialStateId: stateIds.get(str(root.initial)),
    /** any guard naming an input the file never declared — surfaced, not swallowed */
    danglingInputs: [...new Set(
      transitions.flatMap((t) => t.conditions.map((c) => c.input)).filter((nme) => !inputs.some((i) => i.name === nme)),
    )],
  };
}

// ---------------------------------------------------------------------------
// validation (§16)

export interface Issue { level: 'error' | 'warning'; message: string; transitionId?: string; inputName?: string }

/**
 * Everything that would make the exported machine unloadable or dead on arrival, checked
 * before the file is written rather than after a player silently refuses to transition.
 */
export function validateMachine(p: Project): Issue[] {
  const m = machineOf(p);
  const out: Issue[] = [];
  const byId = new Map(p.timelines.map((t) => [t.id, t]));
  const anim = animationIds(p);

  const seenState = new Set<string>();
  for (const tl of p.timelines) {
    if (!tl.name.trim()) out.push({ level: 'error', message: 'A state has no name.' });
    else if (seenState.has(tl.name.toLowerCase())) out.push({ level: 'error', message: `Two states are both called "${tl.name}".` });
    seenState.add(tl.name.toLowerCase());
    const id = anim.get(tl.id);
    // an imported state can point at an animation the project no longer carries
    if (tl.animationId && !p.importedAnimations?.[tl.animationId]) {
      out.push({ level: 'error', message: `State "${tl.name}" plays animation "${id}", which is not in this project.` });
    }
  }

  const seenInput = new Set<string>();
  for (const i of m.inputs) {
    if (!i.name.trim()) { out.push({ level: 'error', message: 'An input has no name.' }); continue; }
    if (seenInput.has(i.name)) out.push({ level: 'error', message: `Two inputs are both called "${i.name}".`, inputName: i.name });
    seenInput.add(i.name);
    if (i.type === 'Event') continue;
    const t = typeof (i.value ?? defaultValueFor(i.type));
    const want = i.type === 'Boolean' ? 'boolean' : i.type === 'Numeric' ? 'number' : 'string';
    if (t !== want) out.push({ level: 'error', message: `Input "${i.name}" is ${i.type} but its default is a ${t}.`, inputName: i.name });
  }

  if (m.initialStateId && !byId.has(m.initialStateId)) {
    out.push({ level: 'error', message: 'The initial state no longer exists.' });
  }

  for (const t of m.transitions) {
    const label = `${byId.get(t.from)?.name ?? '?'} → ${byId.get(t.to)?.name ?? '?'}`;
    if (!byId.has(t.from) || !byId.has(t.to)) {
      out.push({ level: 'error', message: `Transition ${label} points at a state that no longer exists.`, transitionId: t.id });
      continue;
    }
    if (!t.conditions.length) {
      out.push({ level: 'error', message: `Transition ${label} has no conditions, so it can never fire.`, transitionId: t.id });
    }
    for (const c of t.conditions) {
      const input = m.inputs.find((i) => i.name === c.input);
      if (!input) {
        out.push({ level: 'error', message: `Transition ${label} tests "${c.input}", which is not an input.`, transitionId: t.id });
        continue;
      }
      if (!OPERATORS[input.type].includes(c.operator)) {
        out.push({ level: 'error', message: `${label}: "${opLabel(c.operator, 'Numeric')}" cannot be used on the ${input.type} input "${c.input}".`, transitionId: t.id });
        continue;
      }
      if (input.type === 'Event') continue;
      const want = input.type === 'Boolean' ? 'boolean' : input.type === 'Numeric' ? 'number' : 'string';
      if (typeof c.value !== want) {
        out.push({ level: 'error', message: `${label}: "${c.input}" is ${input.type}, but it is compared to a ${typeof c.value}.`, transitionId: t.id });
      }
    }
  }

  for (const i of m.inputs) {
    if (!m.transitions.some((t) => t.conditions.some((c) => c.input === i.name))) {
      out.push({ level: 'warning', message: `Input "${i.name}" is not used by any transition.`, inputName: i.name });
    }
  }
  if (p.timelines.length > 1 && !m.transitions.length) {
    out.push({ level: 'warning', message: 'No transitions yet — the machine will stay in its initial state forever.' });
  }

  return out;
}
