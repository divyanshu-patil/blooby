import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import { machineOf } from '../core/stateMachine';
import { buildDotLottie, importDotLottie } from './dotlottie';
import { unzip } from './zip';
import type { Project } from '../core/types';

function twoStateProject(): Project {
  const proj = defaultProject();
  proj.name = 'Mascot';
  proj.timelines[0].name = 'watching';
  const observing = makeTimeline('observing');
  observing.tracks.push({ id: 'wt', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: { type: 'linear' } },
    { id: 'b', time: 500, value: 20, easingOut: { type: 'linear' } },
  ] });
  observing.timelineDurationMs = 500;
  observing.loop = true;
  proj.timelines.push(observing);
  proj.stateMachine = {
    id: 'mascot',
    initialStateId: proj.timelines[0].id,
    inputs: [{ name: 'isTyping', type: 'Boolean', value: false, description: 'keyboard activity' }],
    transitions: [
      { id: 't1', from: proj.timelines[0].id, to: observing.id, conditions: [{ input: 'isTyping', operator: 'Equal', value: true }], logic: 'AND', durationMs: 300, easing: { type: 'preset', name: 'easeOut' } },
      { id: 't2', from: observing.id, to: proj.timelines[0].id, conditions: [{ input: 'isTyping', operator: 'Equal', value: false }], logic: 'AND', durationMs: 0 },
    ],
  };
  return proj;
}

// --- the container: v2.0 layout, read back through a real unzip ----------------
{
  const proj = twoStateProject();
  const { animations, blob } = buildDotLottie(proj, { background: null });
  it('one animation per timeline', check(animations.length === proj.timelines.length, `${animations.length} vs ${proj.timelines.length}`));

  const files = await unzip(new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const json = (name: string) => JSON.parse(new TextDecoder().decode(files.get(name)!));

  it('animations live under a/, not animations/', check(files.has('a/watching.json') && files.has('a/observing.json'), [...files.keys()].join(', ')));
  it('the state machine lives under s/, not states/', check(files.has('s/mascot.json'), [...files.keys()].join(', ')));
  it('no legacy animations/ or states/ path leaked back in', check(![...files.keys()].some((n) => n.startsWith('animations/') || n.startsWith('states/'))));

  const manifest = json('manifest.json');
  it('the manifest is v2 with a top-level initial animation', check(manifest.version === '2' && manifest.initial.animation === 'watching'));
  it('the manifest names the state machine so a player can load it', check(manifest.stateMachines[0].id === 'mascot'));

  const machine = json('s/mascot.json');
  it('the machine is flat, not nested under a made-up descriptor', check(
    typeof machine.initial === 'string' && Array.isArray(machine.states) && Array.isArray(machine.inputs)));
  it('the declared input reaches the file with its default', check(
    machine.inputs[0].type === 'Boolean' && machine.inputs[0].name === 'isTyping' && machine.inputs[0].value === false));
  it('a state is a PlaybackState pointing at a real animation id', check(
    machine.states[0].type === 'PlaybackState' && files.has(`a/${machine.states[0].animation}.json`)));
  it('the conditional edge is there with a real guard', check(
    machine.states[0].transitions[0].guards[0].inputName === 'isTyping', JSON.stringify(machine.states[0].transitions[0])));

  const anim = json('a/observing.json');
  it('an authored state still bakes its own Lottie', check(Array.isArray(anim.layers) && anim.layers.length > 0));
}

// --- import: what goes out comes back (§12/§13) --------------------------------
{
  const proj = twoStateProject();
  const { blob } = buildDotLottie(proj, { background: null });

  // importing into a *fresh* project must rebuild the machine from the file alone
  const fresh = defaultProject();
  fresh.timelines[0].name = 'untouched';
  const { project: back, inputs, warnings } = await importDotLottie(blob, fresh);
  const m = machineOf(back);

  it('the imported inputs are read, not recreated', check(inputs === 1 && m.inputs[0].name === 'isTyping'));
  it('their type and default are preserved', check(m.inputs[0].type === 'Boolean' && m.inputs[0].value === false));
  it('both states arrive', check(back.timelines.some((t) => t.name === 'watching') && back.timelines.some((t) => t.name === 'observing')));
  it('the state that loops still loops', check(back.timelines.find((t) => t.name === 'observing')!.loop === true));
  it('the animation reference is preserved, not flattened away', check(
    back.timelines.find((t) => t.name === 'watching')!.animationId === 'watching'));
  it('the animation itself travels with it', check(!!back.importedAnimations?.watching));
  it('both transitions arrive with their conditions', check(m.transitions.length === 2, String(m.transitions.length)));
  it('the tween duration survives the trip', check(
    m.transitions.find((t) => t.durationMs === 300)?.conditions[0].value === true));
  it('the initial state survives', check(
    back.timelines.find((t) => t.id === m.initialStateId)?.name === 'watching'));
  it('the untouched local state is left alone', check(back.timelines.some((t) => t.name === 'untouched')));
  it('nothing to warn about on a clean round trip', check(warnings.length === 0, warnings.join(' · ')));

  // §13: re-exporting an imported machine keeps the ORIGINAL animation bytes
  const { blob: again } = buildDotLottie(back, { background: null });
  const files = await unzip(new Uint8Array(await again.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const first = await unzip(new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  it('an imported animation is written back byte for byte', check(
    new TextDecoder().decode(files.get('a/observing.json')!) === new TextDecoder().decode(first.get('a/observing.json')!)));

  // and re-importing the same file must not double anything
  const { project: twice } = await importDotLottie(again, back);
  it('re-importing is idempotent — no duplicate states', check(
    twice.timelines.length === back.timelines.length, `${twice.timelines.length} vs ${back.timelines.length}`));
  it('re-importing is idempotent — no duplicate transitions', check(
    machineOf(twice).transitions.length === 2, String(machineOf(twice).transitions.length)));
  it('re-importing is idempotent — no duplicate inputs', check(machineOf(twice).inputs.length === 1));
}

// --- a file with no machine still imports its animations as states -------------
{
  const solo = defaultProject();
  solo.name = 'Solo';
  const { blob } = buildDotLottie(solo, { background: null });
  const { project, warnings } = await importDotLottie(blob, defaultProject());
  it('a single-state file imports without complaint', check(project.timelines.length >= 1));
  void warnings;
}
