import { it } from 'vitest';
import { check, near } from './testkit';
import { applyEasing, cubicBezier } from './easing';
import { useEditor } from './store';
import { defaultProject, makeTimeline } from './defaults';
import { evaluateRig, valueAt } from './scene';
import type { EasingCurve } from './types';

// --- easing --------------------------------------------------------------------
it('bezier endpoints', check(cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 0) === 0 && cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 1) === 1));
it('linear is identity', check(near(applyEasing({ type: 'linear' }, 0.37), 0.37)));
it('easeIn lags', check(applyEasing({ type: 'preset', name: 'easeIn' }, 0.5) < 0.5));
it('easeOut leads', check(applyEasing({ type: 'preset', name: 'easeOut' }, 0.5) > 0.5));
it('easeInOut symmetric', check(near(applyEasing({ type: 'preset', name: 'easeInOut' }, 0.5), 0.5, 1e-4)));
it('bounce lands on 1', check(near(applyEasing({ type: 'preset', name: 'bounce' }, 1), 1, 1e-6)));
it('elastic lands on 1', check(applyEasing({ type: 'preset', name: 'elastic' }, 1) === 1));
for (let i = 0; i <= 20; i++) {
  const v = applyEasing({ type: 'preset', name: 'easeInOut' }, i / 20);
  it('easeInOut monotone in 0..1', check(v >= -1e-9 && v <= 1 + 1e-9));
}

// --- a curve edit changes what is evaluated, at every point of the tween ---------------
{
  const ed = useEditor.getState();
  const p = defaultProject();
  p.timelines = [makeTimeline('A')]; p.activeTimelineId = p.timelines[0].id;
  ed.loadProject(p);
  useEditor.setState({ autoKey: true });
  ed.setPlayhead(0); ed.setValue('body', 'flatOffset.x', 0);
  ed.setPlayhead(1000); ed.setValue('body', 'flatOffset.x', 100);
  useEditor.setState({ autoKey: false });
  const track = () => useEditor.getState().project.timelines[0].tracks.find((t) => t.property === 'flatOffset.x')!;
  const at = (f: number) => valueAt(useEditor.getState().project, 'body', 'flatOffset.x', f * 1000) as number;
  const drawn = (f: number) => evaluateRig(useEditor.getState().project, f * 1000).nodes.body.surface.flatOffset!.x;
  const curve: EasingCurve = { type: 'bezier', p1: { x: 0.9, y: 0 }, p2: { x: 1, y: 0.2 } };
  ed.setEasing(track().id, track().keyframes[0].id, curve);
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    it(`a steep ease-in, at ${f * 100}%: the value follows the curve`, check(Math.abs(at(f) - 100 * applyEasing(curve, f)) < 1e-9, `${at(f)} vs ${100 * applyEasing(curve, f)}`));
    it(`and the renderer draws that same value at ${f * 100}%`, check(Math.abs(drawn(f) - at(f)) < 1e-9));
  }
  it('the curve really changed the middle of the tween', check(at(0.5) < 10, String(at(0.5))));
}

// --- bounce and elastic become points you can see and drag, and go away again -----------
{
  const ed = useEditor.getState();
  const p = defaultProject();
  p.timelines = [makeTimeline('A')]; p.activeTimelineId = p.timelines[0].id;
  ed.loadProject(p);
  useEditor.setState({ autoKey: true });
  ed.setPlayhead(0); ed.setValue('body', 'flatOffset.y', -100);
  ed.setPlayhead(1000); ed.setValue('body', 'flatOffset.y', 0);
  useEditor.setState({ autoKey: false });
  const track = () => useEditor.getState().project.timelines[0].tracks.find((t) => t.property === 'flatOffset.y')!;
  const head = track().keyframes[0].id;
  ed.setEasing(track().id, head, { type: 'preset', name: 'bounce' });
  it('bounce adds a key at every contact and peak', check(track().keyframes.length === 7 && track().keyframes.filter((k) => k.bakedFrom === head).length === 5));
  it('each contact lands on the target', check(track().keyframes.filter((k) => k.bakedFrom && k.value === 0).length === 3));
  it('and the key remembers it is a bounce', check(track().keyframes[0].bakedAs === 'bounce'));
  const q = useEditor.getState().project;
  it('the motion still bounces: past the first contact it comes back up', check((valueAt(q, 'body', 'flatOffset.y', 545) as number) < -20 && Math.abs(valueAt(q, 'body', 'flatOffset.y', 364) as number) < 1));
  ed.setEasing(track().id, head, { type: 'preset', name: 'elastic' });
  it('switching to elastic replaces the bounce points', check(track().keyframes.length === 5 && track().keyframes.every((k) => !k.bakedFrom || k.bakedFrom === head)));
  ed.setEasing(track().id, head, { type: 'preset', name: 'easeOut' });
  it('any other easing removes them', check(track().keyframes.length === 2 && !track().keyframes[0].bakedAs));
  ed.setEasing(track().id, head, { type: 'preset', name: 'bounce' });
  ed.deleteKeyframe(track().id, head);
  it('deleting the key deletes its bounce points too', check(track().keyframes.length === 1));
}
