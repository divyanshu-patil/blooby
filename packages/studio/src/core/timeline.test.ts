import { it } from 'vitest';
import { check } from './testkit';
import { evaluateRig } from './scene';
import { defaultProject } from './defaults';
import { activeTransitionAt, characteristicTime, DEFAULT_TRANSITION_MS, derivedDuration, evenDuration, explicitTransitionFor, relayoutBlocks } from './timeline';
import { makeTimeline } from './defaults';
import { buildDotLottie } from '../export/dotlottie';
import { useEditor } from './store';
import { activeTimeline } from './types';

// --- default transition: every seam morphs even with zero explicit Transition entries --
{
  useEditor.getState().loadProject(defaultProject());
  const idle = activeTimeline(useEditor.getState().project).blocks[0];
  useEditor.getState().setPlayhead(100);
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 60, 'rot3');
  // no setTransition call at all — tl.transitions is still untouched (undefined)

  it('activeTransitionAt finds an implicit default at an untouched seam', check(!!activeTransitionAt(activeTimeline(useEditor.getState().project), 2400 + 10)));
  it('explicitTransitionFor only reports what was actually stored, never the implicit default', check(explicitTransitionFor(activeTimeline(useEditor.getState().project), idle.id) === undefined));

  const seam = evaluateRig(useEditor.getState().project, 2400).nodes.body.transform.rotation;
  const nearSeamDefault = evaluateRig(useEditor.getState().project, 2400 + 10).nodes.body.transform.rotation;
  const mid = evaluateRig(useEditor.getState().project, 2400 + DEFAULT_TRANSITION_MS / 2).nodes.body.transform.rotation;
  const end = evaluateRig(useEditor.getState().project, 2400 + DEFAULT_TRANSITION_MS + 5).nodes.body.transform.rotation;
  it('an untouched seam still morphs by default — no sudden cut, no explicit Transition needed', check(Math.abs(seam - 60) < 1e-6 && nearSeamDefault > 40 && mid > 1 && mid < 59 && Math.abs(end) < 1e-6, `seam=${seam} near=${nearSeamDefault} mid=${mid} end=${end}`));

  // explicit durationMs:0 opts a seam back out into a real hard cut
  useEditor.getState().setTransition(idle.id, { durationMs: 0 });
  const nearSeamCut = evaluateRig(useEditor.getState().project, 2400 + 10).nodes.body.transform.rotation;
  it('an explicit durationMs:0 is a real hard cut, not just a very short morph', check(Math.abs(nearSeamCut) < 1e-6, `default=${nearSeamDefault} cut=${nearSeamCut}`));

  useEditor.getState().loadProject(defaultProject());
}

// --- state transitions: authored per state, honoured by a bare setState -----------
{
  const ed3 = () => useEditor.getState();
  ed3().loadProject(defaultProject());
  ed3().addTimeline('Happy');
  const [first, second] = ed3().project.timelines;
  ed3().setActiveTimeline(first.id);

  ed3().setStateTransition(second.id, 900);
  it('a state remembers how long to blend into it', check(ed3().project.timelines.find((t) => t.id === second.id)?.transitionMs === 900));

  // the integration case: a host page calls setState with no options at all
  ed3().setState(second.id);
  it('and a bare setState uses it rather than the generic default', check(ed3().stateTransition?.durationMs === 900, String(ed3().stateTransition?.durationMs)));

  ed3().clearStateTransition();
  ed3().setActiveTimeline(first.id);
  ed3().setState(second.id, { duration: 40 });
  it('an explicit duration still wins', check(ed3().stateTransition?.durationMs === 40, String(ed3().stateTransition?.durationMs)));

  // and it survives the round trip into the .lottie a host page reads back
  ed3().clearStateTransition();
  const bundle = await buildDotLottie(ed3().project, { background: null });
  it('the .lottie bundles its states as one composition', check(bundle.animations.length === 1, bundle.animations.join(',')));

  ed3().loadProject(defaultProject());
}

// --- a loop authored to close on itself ends where it says, with no held pose at the seam --
{
  const key = (time: number) => ({ id: `k${time}`, time, value: 0, easingOut: { type: 'preset' as const, name: 'easeInOut' as const } });
  const tl = { id: 't', name: 'loop', tracks: [{ id: 'tr', nodeId: 'body', property: 'flatOffset.y', keyframes: [key(0), key(3600)] }], modifiers: [], blocks: [], durationMode: 'custom' as const, timelineDurationMs: 3600, durationOverrideMs: 3600, loop: true };
  it('a closed loop is exactly its own length', check(derivedDuration(tl) === 3600, String(derivedDuration(tl))));
  it('a timeline that does not loop still gets room past its last key', check(derivedDuration({ ...tl, loop: false }) === 3800, String(derivedDuration({ ...tl, loop: false }))));
  it('and so does a loop whose keys run past its length', check(derivedDuration({ ...tl, durationOverrideMs: 3000 }) === 3800));
}

// --- relayout, evenDuration, characteristicTime --------------------------------------
{
  const blk = (id: string, durationMs: number) => ({ id, presetId: 'p', name: id, durationMs }) as never;
  const key = (time: number, value: unknown) => ({ id: `k${time}`, time, value, easing: { type: 'linear' } }) as never;
  const tl = makeTimeline('t');
  it('evenDuration of an empty strip is 1s', check(evenDuration(tl) === 1000));
  tl.blocks = [blk('a', 1000), blk('b', 500)];
  it('evenDuration averages', check(evenDuration(tl) === 750));
  tl.tracks = [
    { id: 'loose', nodeId: 'n', prop: 'x', keyframes: [key(0, 1)] },
    { id: 'ta', nodeId: 'n', prop: 'x', blockId: 'a', keyframes: [key(500, 1)] },
    { id: 'gone', nodeId: 'n', prop: 'x', blockId: 'zzz', keyframes: [key(5, 1)] },
    { id: 'tb', nodeId: 'n', prop: 'x', blockId: 'b', keyframes: [key(1100, 1)] },
  ] as never;
  relayoutBlocks(tl, [blk('a', 2000), blk('c', 100)]);
  it('block-owned keys follow; tracks of unknown or removed blocks go', check(tl.tracks.find((t) => t.id === 'ta')!.keyframes[0].time === 1000 && !tl.tracks.some((t) => t.id === 'gone') && !tl.tracks.some((t) => t.id === 'tb') && tl.tracks.some((t) => t.id === 'loose')));
  const base = { id: 'p', name: 'p', source: 'builtin', durationMs: 1000 };
  const kf = (time: number, value: unknown) => ({ time, value }) as never;
  it('no emitters: furthest key wins; non-numeric tracks skipped', check(characteristicTime({ ...base, tracks: [
    { id: 't0', nodeId: 'n', prop: 'x', keyframes: [] },
    { id: 't1', nodeId: 'n', prop: 'c', keyframes: [kf(0, 'red')] },
    { id: 't2', nodeId: 'n', prop: 'x', keyframes: [kf(0, 0), kf(300, 'x'), kf(400, 5), kf(900, 2)] },
  ] } as never) === 400));
  it('nothing numeric → 45% of the duration', check(characteristicTime({ ...base, tracks: [] } as never) === 450));
  it('emitters that start too late are ignored', check(characteristicTime({ ...base, tracks: [], emitters: [{ startMs: 2000, lifeMs: 100 }] } as never) === 450));
  it('a running emitter gives its opening moment', check(characteristicTime({ ...base, tracks: [], emitters: [{ lifeMs: 500 }] } as never) === 300));
  it('opens after the preset ends → falls through', check(characteristicTime({ ...base, tracks: [], emitters: [{ lifeMs: 5000 }] } as never) === 450));
  it('emitter with an end', check(characteristicTime({ ...base, tracks: [], emitters: [{ startMs: 100, lifeMs: 500, endMs: 200 }] } as never) === 400));
}
