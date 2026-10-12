import { it, vi } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import type { SceneItem } from '../core/scene';
import type { Project } from '../core/types';

// hand-made scenes: the blend cases real rigs never produce (an alpha on one side only,
// a stroke on one side only) are what these exercise
const scenes: Record<string, SceneItem[]> = {};
vi.mock('../core/scene', async (orig) => ({
  ...(await orig<typeof import('../core/scene')>()),
  sceneAt: (p: Project) => scenes[p.activeTimelineId] ?? [],
}));

const { layoutStrip, dotLottieLayout } = await import('./strip');

const item = (id: string, over: Partial<SceneItem> = {}): SceneItem => ({
  id, cx: 0, cy: 0, w: 10, h: 10, r: 0, rotation: 0, color: { r: 0, g: 0, b: 0, a: 1 }, depth: 0, zIndex: 0, ...over,
} as SceneItem);
const stroke = { color: { r: 255, g: 0, b: 0, a: 1 }, width: 4, cap: 'round', join: 'round' } as const;

const p = defaultProject();
const a = p.timelines[0], b = makeTimeline('b');
b.transitionMs = 400;
p.timelines.push(b);
scenes[a.id] = [item('both-a'), item('both-b', { alpha: 0.5 }), item('both-c', { alpha: 0.2 }), item('out', { stroke }), item('into'), item('lonely', { alpha: 0.8 })];
scenes[b.id] = [item('both-a', { alpha: 0.5 }), item('both-b'), item('both-c', { alpha: 1 }), item('out'), item('into', { stroke: { ...stroke, width: 8 } })];

const strip = layoutStrip(p, [a, b], (tl) => tl.id);
const range = strip.segments.get(a.id)!.range;
const mid = strip.sampleAt(((range[1] + 2) / p.fps) * 1000);
const by = (id: string) => mid.find((x) => x.id === id)!;
it('an alpha on only one side blends against the colour alpha', check(by('both-a').alpha! > 0.5 && by('both-a').alpha! < 1 && by('both-b').alpha! < 1 && by('both-b').alpha! > 0.5));
it('a stroke that only the outgoing pose has fades out', check(by('out').stroke!.color.a < 1 && by('out').stroke!.color.a > 0));
it('a stroke that only the incoming pose has fades in', check(by('into').stroke!.color.a > 0 && by('into').stroke!.width > 0));
it('a layer only one pose has is faded with its alpha', check(by('lonely').alpha! < 0.8));

const past = strip.sampleAt(strip.totalMs + 10_000);
it('past the end the last pose holds', check(past.length === scenes[b.id].length));

// every state an imported animation: nothing to bake, no strip
const imp = defaultProject();
imp.importedAnimations = { x: { id: 'x' } as never };
imp.timelines[0].animationId = 'x';
const lay = dotLottieLayout(imp);
it('with nothing to bake there is no strip and no strip id', check(lay.stripId === '' && lay.strip === undefined && lay.baked.length === 0));

// a state with no declared blend gets the 300ms default
const c = makeTimeline('c');
delete (c as { transitionMs?: number }).transitionMs;
const p2 = defaultProject();
p2.timelines.push(c);
const gap = layoutStrip(p2, [p2.timelines[0], c], (tl) => tl.id).segments.get(c.id)!.range[0] - layoutStrip(p2, [p2.timelines[0]], (tl) => tl.id).segments.get(p2.timelines[0].id)!.range[1];
it('the default blend is 300ms of frames', check(gap === Math.round(0.3 * p2.fps)));

// an imported animation already called "mascot" pushes the strip's own name along
const clash = defaultProject();
clash.importedAnimations = { mascot: { id: 'mascot' } as never };
const other = makeTimeline('imported');
other.animationId = 'mascot';
clash.timelines.push(other);
it('the strip never takes the name of an imported animation', check(dotLottieLayout(clash).stripId === 'mascot-2'));
