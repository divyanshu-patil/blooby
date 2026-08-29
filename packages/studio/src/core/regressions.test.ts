import { it } from 'vitest';
import { check } from './testkit';
import { buildScene, emitterItems, evaluateRig, sceneAt } from './scene';
import { builtinPresets, defaultProject, presetPreviewProject } from './defaults';
import { blocksEnd, blockStarts } from './timeline';
import { useEditor } from './store';
import { activeTimeline } from './types';

// --- the reported bugs, each held down by a check --------------------------------
{
  const ed = () => useEditor.getState();
  const VIEW = { width: 720, height: 720 };

  // a preset's own effects and emitters must appear in its preview, not just on the strip
  const sleepy = builtinPresets().find((x) => x.id === 'p_sleepy')!;
  const angryP = builtinPresets().find((x) => x.id === 'p_angry')!;
  ed().loadProject(defaultProject());
  const prevSleepy = presetPreviewProject(useEditor.getState().project, sleepy);
  it('a preset preview carries its emitters', check((activeTimeline(prevSleepy).emitters ?? []).length === 1));
  it('and unscopes them, since the preview IS the clip', check((activeTimeline(prevSleepy).emitters ?? []).every((e) => e.blockId === undefined)));
  // drawn shapes, not typed characters: a "z" was whatever the system font decided
  it('the zzz actually render in the preview', check(sceneAt(prevSleepy, 1800, VIEW).some((i) => !!i.svg && i.id.startsWith('pe')), String(sceneAt(prevSleepy, 1800, VIEW).filter((i) => i.svg).length)));

  const prevAngry = presetPreviewProject(useEditor.getState().project, angryP);
  it('a preset preview carries its modifiers', check(activeTimeline(prevAngry).modifiers.length === 1));
  const still = { ...prevAngry, timelines: prevAngry.timelines.map((t) => ({ ...t, modifiers: [] })) };
  const shaken = (p: typeof prevAngry, t: number) => buildScene(evaluateRig(p, t), VIEW).find((i) => i.id === 'body')!;
  it('and the shake actually shakes it', check([700, 800, 900].some((t) => Math.abs(shaken(prevAngry, t).cx - shaken(still, t).cx) > 0.5)));

  // angry and sad tilt opposite ways, and angry's inner ends go DOWN (clockwise on the left)
  const tilt = (id: string, node: string) => builtinPresets().find((x) => x.id === id)!
    .tracks.find((t) => t.nodeId === node && t.property === 'transform.rotation')!
    .keyframes.map((k) => k.value as number).find((v) => v !== 0)!;
  it('an angry left eye tilts its inner end down', check(tilt('p_angry', 'eyeL') > 0, String(tilt('p_angry', 'eyeL'))));
  it('and the right eye mirrors it', check(tilt('p_angry', 'eyeR') < 0));
  it('sad is the exact inverse', check(tilt('p_sad', 'eyeL') < 0 && tilt('p_sad', 'eyeR') > 0));

  // surprised should be saucer-eyed, not mildly interested
  const surprised = builtinPresets().find((x) => x.id === 'p_surprised')!;
  const peak = Math.max(...surprised.tracks.filter((t) => t.property === 'transform.scale.x' && t.nodeId !== 'body')
    .flatMap((t) => t.keyframes.map((k) => k.value as number)));
  it('surprised is properly exaggerated', check(peak >= 2, String(peak)));
  // and distanceFromCenter is signed by side, so the eyes must not both go the same way
  const dc = (n: string) => surprised.tracks.find((t) => t.nodeId === n && t.property === 'eye.distanceFromCenter')!
    .keyframes[0].value as number;
  it('the eyes keep their sides', check(dc('eyeL') < 0 && dc('eyeR') > 0, `${dc('eyeL')} / ${dc('eyeR')}`));

  // a new timeline resets what switching to one resets
  ed().loadProject(defaultProject());
  ed().selectBlock(activeTimeline(useEditor.getState().project).blocks[1].id);
  ed().addTimeline('Fresh');
  it('a new timeline clears the old clip selection', check(ed().selectedBlockId === null));
  it('and starts at the beginning with nothing selected', check(ed().playhead === 0 && ed().selection.length === 0 && ed().selectedEmitterId === null));

  // a global effect covers the strip as it stands, not clips added later
  ed().loadProject(defaultProject());
  ed().selectBlock(null);
  const stripEnd = blocksEnd(activeTimeline(useEditor.getState().project));
  ed().addModifier({ nodeId: 'body', kind: 'shake', amount: 100, frequency: 10, amplitude: 5 });
  const m = activeTimeline(useEditor.getState().project).modifiers.at(-1)!;
  it('a global effect is bounded to the clips on the strip now', check(m.endMs === Math.round(stripEnd), String(m.endMs)));
  ed().addBlock('p_happy');
  const added = blockStarts(activeTimeline(useEditor.getState().project)).at(-1)!;
  it('so a clip added afterwards falls outside it', check(added >= (m.endMs ?? 0), `${added} vs ${m.endMs}`));

  // orbit glyphs divide the ring evenly instead of clumping
  ed().loadProject(defaultProject());
  ed().addEmitter({
    name: 'ring', glyphs: ['a'], color: { r: 0, g: 0, b: 0, a: 1 }, size: 18, path: 'orbit',
    // a CIRCULAR ring for this check: on an ellipse, equal steps round the track are
    // deliberately unequal angles on screen, which would make an even orbit look clumped
    from: { nodeId: 'body', x: 0, y: -120 }, to: { x: 0, y: 0 }, bow: 0, radiusX: 100, radiusY: 100,
    rateMs: 600, lifeMs: 2400, count: 4, fadeStart: 1,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1,
  });
  const P2 = () => useEditor.getState().project;
  const ring = (t: number) => {
    const rig = evaluateRig(P2(), t);
    return emitterItems(activeTimeline(P2()), rig, buildScene(rig, VIEW), t, VIEW);
  };
  it('every orbit slot is on screen at once', check(ring(500).length === 4, String(ring(500).length)));
  // angles measured from the ring's own centre, which for evenly-spaced points is their
  // centroid — from the screen origin every one of them reads as nearly the same angle
  const pts = ring(500);
  const c = { x: pts.reduce((a, p) => a + p.cx, 0) / pts.length, y: pts.reduce((a, p) => a + p.cy, 0) / pts.length };
  const angles = pts.map((i) => Math.atan2(i.cy - c.y, i.cx - c.x)).sort((a, b) => a - b);
  const gaps = angles.map((a, k) => (k === 0 ? a + Math.PI * 2 - angles[angles.length - 1] : a - angles[k - 1]));
  it('and they are evenly divided round it, not clumped', check(Math.max(...gaps) - Math.min(...gaps) < 0.2, gaps.map((g) => g.toFixed(2)).join(' ')));

  ed().loadProject(defaultProject());
}
