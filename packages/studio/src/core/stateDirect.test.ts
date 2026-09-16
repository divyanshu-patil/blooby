import { it } from 'vitest';
import { check } from './testkit';
import { useEditor } from './store';
import { defaultProject } from './defaults';
import { concreteTransitions, machineOf, nextTransition, STATE_INPUT, validateMachine } from './stateMachine';
import { ANY_STATE } from './types';
import { namedEasing } from './easing';
import { buildDotLottie } from '../export/dotlottie';
import { unzip } from '../export/zip';

// --- CURRENT → TARGET is one direct edge -----------------------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => ed().project;
  for (const n of ['Happy', 'Excited', 'Angry']) ed().addTimeline(n);
  const id = (name: string) => P().timelines.find((t) => t.name === name)!.id;
  ed().setActiveTimeline(id('Excited'));

  ed().goToState(id('Angry'), { durationMs: 400, easing: namedEasing('easeOut') });
  const m = () => machineOf(P());
  const t = m().transitions[0];
  it('exactly one transition is written', check(m().transitions.length === 1, String(m().transitions.length)));
  it('straight from the current state to the target', check(t.from === id('Excited') && t.to === id('Angry')));
  it('with no intermediate state anywhere in it', check(!m().transitions.some((x) => [id('Idle'), id('Happy')].includes(x.to) || [id('Idle'), id('Happy')].includes(x.from))));
  it('on a String "state" input, compared to the target\'s name', check(t.conditions.length === 1 && t.conditions[0].input === STATE_INPUT && t.conditions[0].value === 'Angry'));
  it('the input is declared, as a String', check(m().inputs.some((i) => i.name === STATE_INPUT && i.type === 'String')));
  it('carrying the blend asked for', check(t.durationMs === 400 && JSON.stringify(t.easing) === JSON.stringify(namedEasing('easeOut'))));
  it('and the preview has taken it, in one hop', check(P().activeTimelineId === id('Angry'), P().timelines.find((x) => x.id === P().activeTimelineId)?.name));

  ed().setActiveTimeline(id('Excited'));
  ed().resetInputs();
  ed().goToState(id('Angry'), { durationMs: 650 });
  it('asking for the same edge again updates it rather than adding a second', check(m().transitions.length === 1 && m().transitions[0].durationMs === 650));

  ed().goToState(id('Happy'), { durationMs: 300, fromAny: true });
  const intoHappy = m().transitions.filter((x) => x.to === id('Happy'));
  it('"from any state" is ONE rule, not an edge per state', check(
    intoHappy.length === 1 && intoHappy[0].from === ANY_STATE && intoHappy[0].conditions[0].value === 'Happy', String(intoHappy.length)));
  const fanned = concreteTransitions(P()).filter((x) => x.to === id('Happy'));
  it('which the engine sees as one direct edge per state, and none from Happy to itself', check(
    fanned.length === 3 && fanned.every((x) => x.from !== id('Happy')), String(fanned.length)));
  it('the whole machine still validates', check(validateMachine(P()).filter((i) => i.level === 'error').length === 0, JSON.stringify(validateMachine(P()))));

  // a Numeric input works the same way, compared to a number
  ed().addInput({ name: 'mood', type: 'Numeric', value: 0 });
  ed().setActiveTimeline(id('Angry'));
  ed().goToState(id('Idle'), { durationMs: 200, input: 'mood', value: 0 });
  const numeric = m().transitions.find((x) => x.to === id('Idle'))!;
  it('a Numeric input gives a numeric condition', check(numeric.conditions[0].input === 'mood' && numeric.conditions[0].value === 0));
  it('and a Cut is an instant transition', check((() => {
    ed().setActiveTimeline(id('Idle'));
    ed().goToState(id('Excited'), { durationMs: 0 });
    return m().transitions.find((x) => x.to === id('Excited'))?.durationMs === 0;
  })()));

  // what ships: the dotLottie parser's own rules
  const files = await unzip(new Uint8Array(await buildDotLottie(P(), { background: null }).blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const machine = JSON.parse(new TextDecoder().decode(files.get(`s/${m().id}.json`)!));
  const excited = machine.states.find((s: { name: string }) => s.name === 'Excited');
  const edge = excited.transitions.find((x: { toState: string }) => x.toState === 'Angry');
  it('the edge exports as a Tweened transition in seconds', check(edge?.type === 'Tweened' && edge.duration === 0.65, JSON.stringify(edge)));
  it('with a String guard the engine can parse', check(edge?.guards[0].type === 'String' && edge.guards[0].conditionType === 'Equal' && edge.guards[0].compareTo === 'Angry'));
  it('and the input is in the file with a string default', check(machine.inputs.some((i: { name: string; type: string; value: unknown }) => i.name === STATE_INPUT && i.type === 'String' && typeof i.value === 'string')));
  it('and the cut ships as a plain instant Transition', check(machine.states.find((s: { name: string }) => s.name === 'Idle').transitions.some((x: { type: string; toState: string }) => x.toState === 'Excited' && x.type === 'Transition')));
  ed().loadProject(defaultProject());
}

// --- rules: "when mood == 2, play Dance" from whatever state is current ----------------
{
  const ed = () => useEditor.getState();
  const P = () => ed().project;
  ed().loadProject(defaultProject());
  for (const n of ['Happy', 'Dance', 'Sad']) ed().addTimeline(n);
  const id = (n: string) => P().timelines.find((t) => t.name === n)!.id;
  ed().renameTimeline(P().timelines[0].id, 'Idle');
  ed().addInput({ name: 'mood', type: 'Numeric', value: 0 });
  const rule = (v: number, to: string) => ed().addStateTransition(ANY_STATE, id(to), [{ input: 'mood', operator: 'Equal', value: v }]);
  rule(1, 'Happy'); rule(2, 'Dance'); rule(3, 'Sad');
  it('three rules are three transitions, not twelve', check(machineOf(P()).transitions.length === 3));
  it('and the machine validates', check(validateMachine(P()).filter((i) => i.level === 'error').length === 0, JSON.stringify(validateMachine(P()))));

  const from = (start: string, mood: number) => {
    ed().resetInputs();
    ed().setActiveTimeline(id(start));
    ed().setInput('mood', mood);
    return P().timelines.find((t) => t.id === P().activeTimelineId)!.name;
  };
  it('Idle, mood = 2 → Dance', check(from('Idle', 2) === 'Dance'));
  it('Happy, mood = 2 → Dance', check(from('Happy', 2) === 'Dance'));
  it('Sad, mood = 2 → Dance', check(from('Sad', 2) === 'Dance'));
  it('Dance, mood = 1 → Happy', check(from('Dance', 1) === 'Happy'));
  it('already in Dance, mood = 2 stays in Dance', check(from('Dance', 2) === 'Dance'));
  it('a value no rule names changes nothing', check(from('Sad', 7) === 'Sad'));

  // a specific edge still wins in its own state
  ed().addStateTransition(id('Happy'), id('Sad'), [{ input: 'mood', operator: 'Equal', value: 2 }]);
  const first = (state: string) => nextTransition(P(), id(state), { mood: 2 })?.to;
  it('a state\'s own edge is tried before the any-state rules', check(first('Happy') === id('Sad') && first('Idle') === id('Dance')));
  ed().removeStateTransition(machineOf(P()).transitions.at(-1)!.id);

  // a state added later is covered by the rules already there
  ed().addTimeline('Sleepy');
  it('a state added afterwards obeys the rules too', check(from('Sleepy', 3) === 'Sad'));

  // what ships: every state carries its own edges, as dotLottie has no "any"
  const machineJson = async () => {
    const files = await unzip(new Uint8Array(await buildDotLottie(P(), { background: null }).blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
    return JSON.parse(new TextDecoder().decode(files.get(`s/${machineOf(P()).id}.json`)!)) as { states: { name: string; transitions: { toState: string }[] }[] };
  };
  const shipped = await machineJson();
  const into = (state: string, to: string) => shipped.states.find((s) => s.name === state)!.transitions.filter((t) => t.toState === to).length;
  it('the export gives every other state an edge into Dance', check(['Idle', 'Happy', 'Sad', 'Sleepy'].every((s) => into(s, 'Dance') === 1)));
  it('and Dance none into itself', check(into('Dance', 'Dance') === 0));
  it('no state names "*"', check(!JSON.stringify(shipped).includes('"*"')));
}
