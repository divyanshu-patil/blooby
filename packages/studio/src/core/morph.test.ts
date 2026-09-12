import { it } from 'vitest';
import { check } from './testkit';
import { useEditor } from './store';
import { defaultProject } from './defaults';
import { compOf } from './comp';
import { libraryOutline } from './emitters';
import { flattenPath, morphPath, primitivePath } from './path';
import { applyEasing, MORPH_MODE_NAMES, MORPH_MODES, morphModeOf } from './easing';
import { activeTrackFor, sceneAt, valueAt } from './scene';
import { activeTimeline } from './types';

// --- the morph modes are curves, and the morph honours them ----------------------------
{
  it('a cut holds until the very end', check(applyEasing(MORPH_MODES.cut.easing, 0.99) === 0 && applyEasing(MORPH_MODES.cut.easing, 1) === 1));
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => applyEasing(MORPH_MODES.overshoot.easing, i / 60)));
  it('overshoot goes 8-15% past its target', check(peak > 1.05 && peak < 1.2, peak.toFixed(3)));
  it('every morph mode is recognised back from its curve', check(MORPH_MODE_NAMES.every((m) => morphModeOf(MORPH_MODES[m].easing) === m)));
  const a = primitivePath('circle'), b = primitivePath('octopus');
  const over = morphPath(a, b, 1.15);
  it('a morph past its target extrapolates rather than stopping dead', check(over !== b && over !== a && !/NaN/.test(over)));
  it('and t = 0 / 1 are exactly the two shapes', check(morphPath(a, b, 0) === a && morphPath(a, b, 1) === b));
}

// --- shape keyframes, the way the inspector makes them -------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  ed().addTimeline('Shapes');
  const P = () => ed().project;
  const tl = () => activeTimeline(P());
  const shapeTrack = () => activeTrackFor(tl(), 'body', 'shape.path', 0)!;

  ed().setPlayhead(0);
  ed().addKeyframeNow('body', 'shape.path');
  it('keying a body that never had an outline keys the circle it is drawing', check(shapeTrack()?.keyframes[0].value === primitivePath('circle')));

  ed().setPlayhead(500);
  ed().setValue('body', 'shape.path', libraryOutline('capsule')!, 'pick');
  ed().setPlayhead(1000);
  ed().setValue('body', 'shape.path', libraryOutline('octopus')!, 'pick2');
  it('picking a shape at a new time adds a shape keyframe', check(shapeTrack().keyframes.length === 3, String(shapeTrack().keyframes.length)));
  ed().setPlayhead(500);
  ed().setValue('body', 'shape.path', libraryOutline('pebble')!, 'pick3');
  it('picking one ON a keyframe changes that keyframe', check(shapeTrack().keyframes.length === 3 && shapeTrack().keyframes[1].value === libraryOutline('pebble')));

  const mid = valueAt(P(), 'body', 'shape.path', 750) as string;
  it('between two shapes it is a real morph', check(mid !== libraryOutline('pebble') && mid !== libraryOutline('octopus') && flattenPath(mid, 64).length === 64));
  const drawn = (t: number) => sceneAt(P(), t, compOf(P())).find((s) => s.id === 'body')!.path;
  it('and the body on screen is that morph', check(drawn(750) === mid));

  ed().setShapeMorph('body', 'cut');
  it('Cut holds the shape until the next keyframe', check(valueAt(P(), 'body', 'shape.path', 990) === libraryOutline('pebble')));
  ed().setShapeMorph('body', 'elastic', 300);
  it('the morph duration moves the next shape keyframe', check(shapeTrack().keyframes[2].time === 800, String(shapeTrack().keyframes[2].time)));
  it('and the mode is what the keyframe now says', check(morphModeOf(shapeTrack().keyframes[1].easingOut) === 'elastic'));

  const at = drawn(650);
  drawn(100); drawn(790);
  it('scrubbing back to a moment gives the same outline', check(drawn(650) === at));

  ed().undo();
  it('morph edits are undoable', check(shapeTrack().keyframes[2].time === 1000 && morphModeOf(shapeTrack().keyframes[1].easingOut) === 'morph'));
  ed().loadProject(defaultProject());
}
