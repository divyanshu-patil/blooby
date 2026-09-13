import { it } from 'vitest';
import { check } from './testkit';
import { useEditor } from './store';
import { defaultProject } from './defaults';
import { machineOf, STATE_INPUT, validateMachine } from './stateMachine';
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
  it('"from any state" is one direct edge per state, and none from Happy to itself', check(
    intoHappy.length === 3 && intoHappy.every((x) => x.from !== id('Happy') && x.conditions[0].value === 'Happy'), String(intoHappy.length)));
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
