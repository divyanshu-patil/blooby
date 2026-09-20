import { it } from 'vitest';
import { check } from './testkit';
import { blobPath, blobOf } from './blob';
import { flattenPath, primitivePath } from './path';
import { defaultProject, kf } from './defaults';
import { uid } from './id';
import { sceneAt } from './scene';
import { compOf } from './comp';
import { bakeLottie } from '../export/lottie';
import { getProp, setProp, NUMERIC_PROPS } from './props';

const SIZE = 720;
const pts = (d: string, n = 256) => flattenPath(d, n).map((p) => ({ x: p.x * SIZE, y: p.y * SIZE }));
const worstGap = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

/**
 * At zero it is the circle. Anything else and turning the dial up from nothing would pop,
 * which is exactly what an animated body must not do on its first frame.
 */
{
  const gap = worstGap(pts(blobPath(0, 7)), pts(primitivePath('circle')));
  it('amount 0 is the circle, to within a pixel of a 720px body', check(gap < 1, `${gap.toFixed(3)}px`));
  it('and no path is drawn at all when the dial is off', check(
    blobOf(undefined) === undefined && blobOf({ amount: 0 }) === undefined));
  it('so an untouched body is still a plain ellipse', check(blobOf({ amount: 0, seed: 9 }) === undefined));
}

/**
 * Pure function of (amount, seed). A clock or a noise field here would make every frame of
 * every export a different outline — see the note in blob.ts.
 */
{
  it('the same dial gives the same shape', check(blobPath(0.6, 42) === blobPath(0.6, 42)));
  it('a different seed gives a different one', check(blobPath(0.6, 42) !== blobPath(0.6, 43)));
  it('a different amount gives a different one', check(blobPath(0.6, 42) !== blobPath(0.7, 42)));
}

/**
 * The vertex count is fixed. If it grew with the dial, keyframing it would swap one ring
 * for another with a different number of points and the outline would jump on that frame.
 */
{
  const segs = (d: string) => (d.match(/C/g) ?? []).length;
  const counts = [0, 0.01, 0.25, 0.5, 1].map((a) => segs(blobPath(a, 3)));
  it('the same number of curves at every amount', check(new Set(counts).size === 1, counts.join()));
  it('and at every seed', check(new Set([1, 2, 99, 1234].map((s) => segs(blobPath(0.5, s)))).size === 1));
}

/** It is a blob, not a star: enough deviation to read, not so much it stops being a body. */
{
  const radii = (a: number) => pts(blobPath(a, 5)).map((p) => Math.hypot(p.x, p.y));
  const spread = (a: number) => { const r = radii(a); return (Math.max(...r) - Math.min(...r)) / (SIZE / 2); };
  it('amount 1 is visibly off round', check(spread(1) > 0.15, spread(1).toFixed(3)));
  it('but never a puddle', check(spread(1) < 0.7, spread(1).toFixed(3)));
  it('and half the dial is about half the wobble', check(
    Math.abs(spread(0.5) / spread(1) - 0.5) < 0.1, (spread(0.5) / spread(1)).toFixed(3)));
}

/** It is an ordinary animatable property, so it keyframes like any other. */
{
  const node = defaultProject().rig.nodes.body;
  it('blob.amount is animatable', check(NUMERIC_PROPS.includes('blob.amount')));
  setProp(node, 'blob.amount', 0.7);
  it('and round-trips through the props table', check(getProp(node, 'blob.amount') === 0.7));
  setProp(node, 'blob.amount', 5);
  it('clamped to the dial', check(getProp(node, 'blob.amount') === 1));
}

/**
 * The export budget, which is the whole reason the shape is built the way it is.
 *
 * A body that does not animate produces one `d` on every frame, so `bezierShapes` writes a
 * single static path for it. Only a body someone actually keyframed pays per-frame
 * vertices — and then `reduce()` still throws most of the frames away.
 */
{
  const bare = () => {
    const p = defaultProject();
    p.timelines[0].blocks = []; p.timelines[0].tracks = [];
    return p;
  };
  const size = (p: Parameters<typeof bakeLottie>[0]) =>
    JSON.stringify(bakeLottie(p, { background: null, name: 'x', from: 0, to: 2000 }).json).length;

  const plain = bare();
  const still = bare();
  still.rig.nodes.body.blob = { amount: 0.6, seed: 7 };

  const moving = bare();
  moving.rig.nodes.body.blob = { amount: 0, seed: 7 };
  moving.timelines[0].tracks.push({
    id: uid('t'), nodeId: 'body', property: 'blob.amount',
    keyframes: [kf(0, 0), kf(1000, 0.8), kf(2000, 0)],
  });

  it('a blob that never moves is all but free', check(
    size(still) < size(plain) + 2048, `${size(plain)} -> ${size(still)}`));
  const baked = bakeLottie(moving, { background: null, name: 'x', from: 0, to: 2000 });
  it('and one that does is written as a morph, not as 61 frames', check(
    baked.keyframeCount > 0 && baked.keyframeCount < 30, String(baked.keyframeCount)));
}

/** The point of the fixed ring: the outline creeps, it never jumps. */
{
  const p = defaultProject();
  p.timelines[0].blocks = []; p.timelines[0].tracks = [];
  p.rig.nodes.body.blob = { amount: 0, seed: 7 };
  p.timelines[0].tracks.push({
    id: uid('t'), nodeId: 'body', property: 'blob.amount',
    keyframes: [kf(0, 0), kf(1000, 0.8), kf(2000, 0)],
  });
  const COMP = compOf(p);
  const ringAt = (f: number) => {
    const it = sceneAt(p, (f / 30) * 1000, COMP).find((s) => s.id === 'body')!;
    return flattenPath(it.path ?? primitivePath('circle'), 64).map((q) => ({ x: q.x * it.w, y: q.y * it.h }));
  };
  let worst = 0;
  for (let f = 1; f <= 60; f++) worst = Math.max(worst, worstGap(ringAt(f), ringAt(f - 1)));
  it('no outline point ever jumps between frames', check(worst < 8, `${worst.toFixed(2)}px in one frame`));
}
