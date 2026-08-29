import { it } from 'vitest';
import { check } from './testkit';
import { evaluateRig } from './scene';
import { defaultProject } from './defaults';
import { activeTransitionAt, DEFAULT_TRANSITION_MS, explicitTransitionFor } from './timeline';
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
  const bundle = buildDotLottie(ed3().project, { background: null });
  it('the .lottie names every state it bundles', check(bundle.animations.length === 2, bundle.animations.join(',')));

  ed3().loadProject(defaultProject());
}
