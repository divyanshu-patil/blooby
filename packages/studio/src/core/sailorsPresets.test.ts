import { it } from 'vitest';
import { check } from './testkit';
import { SAILORS_PROJECTS, sailorsPresets, sailorsProject, sample, spline } from './sailorsPresets';
import { builtinPresets } from './defaults';
import { validateMachine } from './stateMachine';
import { asTimeline } from './types';
import { bakeLottie } from '../export/lottie';
import type { Keyframe, Preset } from './types';

const lib = sailorsPresets();
const all = builtinPresets();

it('every state is in the library', check(lib.length === 18 && lib.every((p) => all.some((x) => x.id === p.id)), lib.map((p) => p.id).join()));

// the sampler: a key where the curve needs one, and the curve between keys is the curve
{
  const f = spline([[0, 0], [400, 10], [900, -4], [1500, 0]], 1500);
  const keys = sample(f, 1500, 'flatOffset.x');
  it('a smooth loop samples to a handful of keys', check(keys.length > 2 && keys.length < 20, String(keys.length)));
  it('with no linear segments', check(keys.every((k) => k.easingOut.type !== 'linear')));
  it('and a constant to one key', check(sample(() => 3, 1000, 'opacity').length === 1));
}

// a loop has no seam: every character track ends on the value it starts with, moving the same way
const CHARACTER = /^(body|face|eyeL|eyeR|armL|armR|legL|legR|frontArm[LR]|arc[LR]|mitten[LR])$/;
const slope = (ks: Keyframe[], end: boolean) => {
  const [a, b] = end ? [ks.at(-2)!, ks.at(-1)!] : [ks[0], ks[1]];
  const dv = (b.value as number) - (a.value as number), dt = b.time - a.time;
  const e = a.easingOut;
  if (e.type !== 'bezier' || Math.abs(dv) < 1e-6) return 0;
  return end ? ((1 - e.p2.y) * 3 * dv) / dt : (e.p1.y * 3 * dv) / dt;
};
const seams = (p: Preset) => p.tracks.filter((t) => CHARACTER.test(t.nodeId) && t.keyframes.length > 1 && typeof t.keyframes[0].value === 'number').filter((t) => {
  const ks = t.keyframes;
  return Math.abs((ks[0].value as number) - (ks.at(-1)!.value as number)) > 1e-3 || Math.abs(slope(ks, false) - slope(ks, true)) > 0.02;
}).map((t) => `${p.name}.${t.nodeId}.${t.property}`);
it('every state loops with no seam', check(lib.every((p) => seams(p).length === 0), lib.flatMap(seams).join(', ')));
it('every loop is 2–4 s (4.2 for reading, which turns a page)', check(lib.every((p) => p.durationMs >= 2000 && p.durationMs <= 4200), lib.map((p) => `${p.name} ${p.durationMs}`).join()));

// the base character's limbs, and legs with no knee
const limbs = lib.flatMap((p) => (p.layers ?? []).filter((l) => l.limb));
it('no leg has a knee', check(limbs.filter((l) => l.limb!.type === 'leg').every((l) => !l.limb!.c)
  && lib.every((p) => !p.tracks.some((t) => /^limb\.c\./.test(t.property)))));
it('arms are the base arms: ink, 39 thick', check(limbs.filter((l) => l.limb!.type === 'arm').every((l) => l.limb!.thickness === 39 && l.color.r === 20)));
it('legs are the base legs: ink, 38 thick, a 35-wide foot', check(limbs.filter((l) => l.limb!.type === 'leg').every((l) => l.limb!.thickness === 38 && l.limb!.foot?.width === 35)));

// the projects: a timeline per state, named as the app asks, and a machine driven by `state`
for (const spec of SAILORS_PROJECTS) {
  const p = sailorsProject(spec);
  const m = p.stateMachine!;
  const names = p.timelines.map((t) => t.name);
  it(`${spec.name}: its timelines are the states the app asks for`, check(names.join() === spec.states.map((s) => s[0]).join(), names.join()));
  it(`${spec.name}: its machine is named after it, with one String input "state"`, check(m.id === spec.name && m.inputs.length === 1 && m.inputs[0].name === 'state' && m.inputs[0].type === 'String'));
  it(`${spec.name}: every state is reached by its own name`, check(p.timelines.every((tl) => m.transitions.some((tr) => tr.to === tl.id && tr.conditions[0]?.value === tl.name))));
  const errors = validateMachine(p).filter((i) => i.level === 'error');
  it(`${spec.name}: the machine validates`, check(errors.length === 0, errors.map((e) => e.message).join('; ')));
  it(`${spec.name}: at ${spec.composition.width}×${spec.composition.height}, 60 fps`, check(p.composition!.width === spec.composition.width && p.fps === 60));
  // app-ready: everything it draws goes into the .lottie
  const lost = p.timelines.flatMap((tl) => {
    const baked = bakeLottie(asTimeline(p, tl.id), { background: null, name: tl.name });
    return [...baked.warnings, ...baked.skipped].map((w) => `${tl.name}: ${w}`);
  });
  it(`${spec.name}: every state exports to Lottie with nothing lost`, check(lost.length === 0, lost.join('\n')));
}

// --- the puppet with and without each of its dials ---------------------------------------------------
import { framesOf, Motion, puppet, type Puppet } from './sailorsPresets';
{
  const at = (x: number, y: number) => () => ({ x, y });
  const num = (v: number) => () => v;
  const foot = () => ({ x: 4, y: -3, angle: 10 });
  const props = (m: Motion) => new Set(m.tracks.map((t) => `${t.nodeId}:${t.property}`));
  it('a one-key spline is a constant', check(spline([[0, 7]])(123) === 7));

  const full: Puppet = {
    x: num(1), y: num(2), lean: num(3), squash: num(1.05), widen: num(1.02), headX: num(1), headY: num(1), tilt: num(2), yaw: num(5), pitch: num(4),
    open: num(1), openL: num(0.5), openR: num(0.4), eyeSX: num(1.1), eyeSY: num(1.2),
    handL: at(-120, 60), handR: at(120, 60), shoulderL: at(-110, 30), shoulderR: at(110, 30), slackL: 1.2, slackR: 1.1, bendL: num(0.2), bendR: num(-0.2),
    mittens: 'both', footL: foot, footR: () => ({ x: 1, y: 1 }), plant: num(0.5), scale: 0.8, ground: { x: 5, y: 100 }, prefix: 'f1.',
  };
  const a = new Motion(1000); puppet(a, full);
  it('every dial lands on a track of the prefixed character', check(props(a).has('f1.eyeL:eye.openness') && props(a).has('f1.mittenL:flatOffset.x') && props(a).has('f1.legL:limb.foot.angle') && props(a).has('f1.body:transform.scale.x')));
  it('a foot with no angle keeps its toe level', check((() => { const t = a.tracks.find((x) => x.nodeId === 'f1.legR' && x.property === 'limb.foot.angle')!; return t.keyframes.every((k) => k.value === 0); })()));

  const bare = new Motion(1000); puppet(bare, { mittens: 'both' });
  it('a puppet with no dials rests: eyes open, hands at rest, no foot angles', check(props(bare).has('eyeR:eye.openness') && props(bare).has('mittenR:flatOffset.x') && !props(bare).has('legL:limb.foot.angle')));
  const lone = new Motion(1000); puppet(lone, { mittens: 'L', arcs: 'happy', arcSY: num(0.8) });
  const loneR = new Motion(1000); puppet(loneR, { mittens: 'R', arcs: 'sad', front: true });
  it('one mitten, happy arcs, sad arcs, arms in front', check(props(lone).has('mittenL:flatOffset.x') && !props(lone).has('mittenR:flatOffset.x') && props(loneR).has('arcR:flatOffset.x') && props(loneR).has('frontArmL:limb.b.x')));
  it('the frames of a puppet are finite at any time', check(Object.values(framesOf(full).body(100)).every((v) => typeof v !== 'number' || Number.isFinite(v))));
}
{
  it('a project asking for a preset that is not in the library says which', check((() => { try { sailorsProject({ name: 'x', composition: { width: 1, height: 1 }, states: [['a', 'p_missing']] }); return false; } catch (e) { return /p_missing/.test((e as Error).message); } })()));
  const custom = [{ id: 'pc', name: 'pc', durationMs: 1000, tracks: [], emitters: [{ id: 'e1', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }], appearances: [{ id: 'a1', nodeId: 'body', startMs: 0, endMs: 1000 }] }] as unknown as Preset[];
  const proj = sailorsProject({ name: 'x', composition: { width: 10, height: 10 }, states: [['a', 'pc']] }, custom);
  it('a state\'s emitters and ranges come with it, each with a new id', check(proj.timelines[0].emitters![0].id !== 'e1' && proj.timelines[0].appearances![0].id !== 'a1'));
  it('a bare preset brings neither', check((() => { const q = sailorsProject({ name: 'x', composition: { width: 10, height: 10 }, states: [['a', 'pb']] }, [{ id: 'pb', name: 'pb', durationMs: 10, tracks: [] }] as unknown as Preset[]); return q.timelines[0].emitters!.length === 0 && q.timelines[0].appearances!.length === 0; })()));
}
