import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline, uid } from '../core/defaults';
import { buildDotLottie } from './dotlottie';
import { machineConfig } from './runtime';
import { unzip } from './zip';
import type { Emitter, Project } from '../core/types';

/**
 * A Tweened transition interpolates the PLAYHEAD inside the loaded composition — there is
 * no cross-composition morph in the dotLottie runtime. So two states naming two different
 * animations hard-swap no matter what duration they declare, and the only way to morph is
 * for both to be frame ranges of ONE composition with real frames in between.
 *
 * These assertions are the shape that makes that true. Breaking any of them brings back a
 * cut that no error reports, because the file still loads and still plays.
 */

function twoPose(): Project {
  const p = defaultProject();
  p.name = 'watching';
  const root = p.rig.rootId;
  const a = p.timelines[0];
  a.name = 'watching'; a.loop = true; a.timelineDurationMs = 4200;
  // particles that exist in ONE pose only — the layer set that must not be dropped
  a.emitters = [{
    id: uid('em'), name: 'orbit', glyphs: [],
    parts: [{ id: 'g1', shapeId: 'zed', weight: 1, speed: 1, sizeScale: 1, spin: 0 }],
    color: { r: 108, g: 106, b: 128, a: 1 }, size: 26,
    path: 'arc', from: { nodeId: root, x: 46, y: -34 }, to: { nodeId: root, x: 118, y: -150 }, bow: 22,
    rateMs: 700, lifeMs: 2100, count: 3, fadeStart: 0.45,
    scaleFrom: 0.45, scaleTo: 1.3, spin: -10, wobble: 5, wobbleFrequency: 1.2, seed: 7,
    easing: { type: 'preset', name: 'easeOut' }, speedJitter: 0.25,
  } as Emitter];
  const b = makeTimeline('observe');
  b.loop = true; b.timelineDurationMs = 3033; b.transitionMs = 300;
  p.timelines.push(b);
  p.stateMachine = {
    id: 'mascot', initialStateId: a.id,
    inputs: [{ name: 'keyboard', type: 'Boolean', value: false }],
    transitions: [
      { id: 't1', from: a.id, to: b.id, logic: 'AND', durationMs: 300, conditions: [{ input: 'keyboard', operator: 'Equal', value: true }] },
      { id: 't2', from: b.id, to: a.id, logic: 'AND', durationMs: 300, conditions: [{ input: 'keyboard', operator: 'Equal', value: false }] },
    ],
  };
  return p;
}

const project = twoPose();
const files = await unzip(new Uint8Array(await buildDotLottie(project, { background: null }).blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
const read = (n: string) => JSON.parse(new TextDecoder().decode(files.get(n)!));
const anim = read('a/mascot.json');
const sm = read('s/mascot.json');
/**
 * A state's `segment` names a marker; the marker carries the frames. Reading the range
 * back THROUGH the marker is the point — it is the same lookup the engine does, so a
 * segment naming a marker that does not exist fails here rather than in silence.
 */
const marker = (name: string) => anim.markers.find((m: { cm: string }) => m.cm === name);
const rangeOf = (st: { segment: string }): [number, number] => {
  const m = marker(st.segment);
  return [m.tm, m.tm + m.dr];
};
const segs = sm.states.map(rangeOf);

it('every pose ships in ONE composition', check(
  [...files.keys()].filter((k) => k.startsWith('a/')).length === 1, [...files.keys()].join()));
it('and the manifest advertises just that one', check(read('manifest.json').animations.length === 1));
it('both states name the same animation', check(
  new Set(sm.states.map((s: { animation: string }) => s.animation)).size === 1));
// dotlottie-rs reads `segment` with opt_str_field and passes it to set_marker(). A frame
// pair is read as absent, which leaves playback unconstrained — the whole strip plays,
// every pose in sequence, which is exactly what a numeric segment shipped.
it('every state names its segment as a STRING, never a frame pair', check(
  sm.states.every((s: { segment: unknown }) => typeof s.segment === 'string'),
  JSON.stringify(sm.states.map((s: { segment: unknown }) => s.segment))));
it('and that string names a marker that really exists', check(
  sm.states.every((s: { segment: string }) => !!marker(s.segment)),
  `${JSON.stringify(sm.states.map((s: { segment: string }) => s.segment))} vs ${JSON.stringify(anim.markers.map((m: { cm: string }) => m.cm))}`));
it('the segments do not overlap', check(segs[0][1] < segs[1][0], JSON.stringify(segs)));
it('with morph frames between them, sized to the declared blend', check(
  segs[1][0] - segs[0][1] === Math.round((300 / 1000) * project.fps),
  `${segs[1][0] - segs[0][1]} frames`));
it('and the composition actually spans them', check(anim.op >= segs[1][1]));

// the constraint that makes the scrub safe: the rig must be continuous end to end
const names = anim.layers.map((l: { nm: string }) => l.nm);
it('one layer set covers the whole strip', check(new Set(names).size <= names.length && names.length === 6, names.join()));
it('including the particles that only one pose uses', check(
  names.filter((n: string) => n === 'orbit').length === 3, names.join()));

/** what a layer's opacity resolves to at a frame, following its keyframes */
const opacityAt = (nm: string, f: number, nth = 0) => {
  const l = anim.layers.filter((x: { nm: string }) => x.nm === nm)[nth];
  const k = l.ks.o;
  if (k.a === 0) return k.k as number;
  const ks = k.k as { t: number; s: number[] }[];
  if (f <= ks[0].t) return ks[0].s[0];
  for (let i = 0; i < ks.length - 1; i++) {
    if (f >= ks[i].t && f <= ks[i + 1].t) {
      const u = (f - ks[i].t) / (ks[i + 1].t - ks[i].t);
      return ks[i].s[0] + (ks[i + 1].s[0] - ks[i].s[0]) * u;
    }
  }
  return ks[ks.length - 1].s[0];
};

// dropping a layer mid-strip would make the scrub jump; it has to be animated out
const mid = Math.round((segs[0][1] + segs[1][0]) / 2);
it('a one-pose layer is still present at the morph midpoint', check(
  opacityAt('orbit', mid, 2) > 0, String(opacityAt('orbit', mid, 2))));
it('fading, not cutting', check(
  opacityAt('orbit', segs[0][1], 2) > opacityAt('orbit', mid, 2), `${opacityAt('orbit', segs[0][1], 2)} -> ${opacityAt('orbit', mid, 2)}`));
it('and gone by the time the other pose starts', check(
  opacityAt('orbit', segs[1][0], 2) === 0, String(opacityAt('orbit', segs[1][0], 2))));
it('while a layer both poses share stays up throughout', check(
  opacityAt('Body', mid) === 100));

// a guard with no conditionType makes the whole machine fail to parse, silently
it('every guard keeps its conditionType', check(
  sm.states.every((s: { transitions: { guards: object[] }[] }) =>
    s.transitions.every((t) => t.guards.every((g) => 'conditionType' in g)))));
it('and the transitions stay Tweened with a duration', check(
  sm.states.every((s: { transitions: { type: string; duration: number }[] }) =>
    s.transitions.every((t) => t.type === 'Tweened' && t.duration > 0))));

// markers are the documented fallback if a player ignores `segment`
it('each segment is also named as a marker', check(
  anim.markers.length === 2 && anim.markers[0].cm === 'watching' && anim.markers[1].tm === segs[1][0],
  JSON.stringify(anim.markers)));

// the sidecar the app imports must not disagree with the file it ships beside
const cfg = machineConfig(project);
it('the sidecar reports the same animation for every state', check(
  new Set(cfg.stateMachine.states.map((s) => s.animation)).size === 1));
it('and the same markers, with the frames spelled out beside them', check(
  JSON.stringify(cfg.stateMachine.states.map((s) => (s as { segment?: string }).segment))
    === JSON.stringify(sm.states.map((st: { segment: string }) => st.segment))
  && JSON.stringify(cfg.stateMachine.states.map((s) => (s as { frames?: number[] }).frames)) === JSON.stringify(segs),
  JSON.stringify(cfg.stateMachine.states)));
it('and the machine id the app loads', check(cfg.stateMachine.id === 'mascot', cfg.stateMachine.id));
