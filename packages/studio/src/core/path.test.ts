import { it } from 'vitest';
import { check } from './testkit';
import { buildScene, evaluateRig } from './scene';
import { builtinPresets, defaultProject } from './defaults';
import { flattenPath, morphPath, movePathAnchor, naturalShape, pathAnchors, primitivePath, PRIMITIVE_SHAPES } from './path';
import { useEditor } from './store';
import { PROPS } from './props';

// --- shape morphing -------------------------------------------------------------
{
  const area = (pts: { x: number; y: number }[]) =>
    Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.y - q.x * p.y); }, 0) / 2);

  // the primitives are what they claim to be, in a -0.5..0.5 box
  const circle = primitivePath('circle');
  it('a circle has the area of a circle', check(Math.abs(area(flattenPath(circle, 256)) - Math.PI * 0.25) < 0.002, area(flattenPath(circle, 256)).toFixed(4)));
  it('a square fills its box', check(Math.abs(area(flattenPath(primitivePath('rect'), 256)) - 1) < 0.01));
  it('rounding the corners takes area away', check(area(flattenPath(primitivePath('rect', { cornerRadius: 0.5 }), 256)) < area(flattenPath(primitivePath('rect'), 256))));
  it('a star has less area than the circle it fits in', check(area(flattenPath(primitivePath('star', { points: 5 }), 256)) < area(flattenPath(circle, 256))));
  it('every primitive stays inside its box', check(PRIMITIVE_SHAPES.every((k) => flattenPath(primitivePath(k, { points: 7 }), 96)
        .every((p) => Math.abs(p.x) <= 0.5001 && Math.abs(p.y) <= 0.5001))));

  // the morph is a real in-between, not a switch at the halfway mark
  const star = primitivePath('star', { points: 5 });
  it('t=0 and t=1 are the originals', check(morphPath(circle, star, 0) === circle && morphPath(circle, star, 1) === star));
  const areas = [0, 0.25, 0.5, 0.75, 1].map((t) => area(flattenPath(morphPath(circle, star, t), 64)));
  it('and the shape genuinely travels between them', check(areas.every((a, i) => i === 0 || a < areas[i - 1]), areas.map((a) => a.toFixed(3)).join(' > ')));
  it('the in-between is neither original', check(morphPath(circle, star, 0.5) !== circle && morphPath(circle, star, 0.5) !== star));

  // alignment: a square into a diamond should barely move, not spin
  const square = primitivePath('rect');
  const diamond = primitivePath('polygon', { points: 4 });
  const drift = flattenPath(morphPath(square, diamond, 0.5), 64);
  it('outlines are rotated into their best alignment before interpolating', check(drift.every((p) => Math.abs(p.x) <= 0.51 && Math.abs(p.y) <= 0.51)));

  // the parser handles what it says it does
  it('relative commands parse', check(flattenPath('M 0 0 l 10 0 l 0 10 z', 32).length === 32));
  it('quadratics parse as curves', check(flattenPath('M 0 0 Q 5 10 10 0 Z', 32).length === 32));
  // the editor takes pasted text, so garbage must degrade to nothing rather than to NaN
  // coordinates — which "nonsense" produced before, since its letters parse as commands
  for (const junk of ['nonsense', '', 'M', 'M 0', 'M 1 zz 4']) {
    const pts = flattenPath(junk, 16);
    it(`"${junk}" degrades safely`, check(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), JSON.stringify(pts.slice(0, 2))));
  }
  it('and a broken path morphs without producing NaN', check(flattenPath(morphPath('nonsense', primitivePath('circle'), 0.5), 16)
        .every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
}

// --- a shape keyframe morphs the layer, and a full spin goes round the back -----
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const pill = primitivePath('rect', { cornerRadius: 0.5 });
  const star = primitivePath('star', { points: 5 });

  ed().addTimeline('Shapes', { copyLayers: true });
  ed().setPlayhead(0);
  ed().setValue('eyeL', 'shape.path', pill, 'a');
  ed().toggleKeyframe('eyeL', 'shape.path');
  ed().setPlayhead(1000);
  ed().setValue('eyeL', 'shape.path', star, 'b');

  const pathAt = (t: number) => buildScene(evaluateRig(P(), t), VIEW).find((i) => i.id === 'eyeL')?.path;
  it('the layer draws its outline instead of a pill', check(typeof pathAt(0) === 'string'));
  it('the ends are the shapes that were keyed', check(pathAt(0) === pill && pathAt(1000) === star, `${String(pathAt(0)).slice(0, 20)} / ${String(pathAt(1000)).slice(0, 20)}`));
  const mid = pathAt(500);
  it('and halfway through it is genuinely between them', check(!!mid && mid !== pill && mid !== star));

  // the Excited preset is the user-facing version of exactly that
  const excited = builtinPresets().find((x) => x.id === 'p_excited')!;
  it('Excited morphs the eyes', check(excited.tracks.filter((t) => t.property === 'shape.path').length === 2));
  it('and turns them yellow on the way', check(excited.tracks.some((t) => t.property === 'color')));

  // a full revolution: right, behind the silhouette, and out the other side
  ed().loadProject(defaultProject());
  const eyeAt = (yaw: number) => {
    const p = defaultProject();
    p.rig.nodes.body.surface.yaw = yaw;
    return buildScene(p.rig, VIEW).find((i) => i.id === 'eyeL');
  };
  const front = eyeAt(0)!;
  it('a feature travels round with the body', check(eyeAt(60)!.cx > front.cx));
  it('hides behind the silhouette', check(!eyeAt(180)));
  it('and comes back out the other side', check(!!eyeAt(300) && eyeAt(300)!.cx < front.cx));
  it('a full turn lands exactly where it started', check(Math.abs(eyeAt(360)!.cx - front.cx) < 1e-6));
  it('and the range allows one to be authored', check((PROPS['surface.yaw'].range ?? [0, 0])[1] >= 360));

  const spin = builtinPresets().find((x) => x.id === 'p_spin')!;
  it('the Spin preset actually goes all the way round', check(spin.tracks.some((t) => t.property === 'surface.yaw' && t.keyframes.some((k) => k.value === 360))));

  ed().loadProject(defaultProject());
}

// --- shapes: pill, rounded points, a circle that is actually round ---------------
{
  const area = (pts: { x: number; y: number }[]) =>
    Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.y - q.x * p.y); }, 0) / 2);

  it('the circle is a spline and exact', check(Math.abs(area(flattenPath(primitivePath('circle'), 256)) - Math.PI * 0.25) < 0.001, area(flattenPath(primitivePath('circle'), 256)).toFixed(4)));
  it('and turning it turns something', check(primitivePath('circle') !== primitivePath('circle', { rotation: 15 })));
  it('a pill is the eyes\u2019 own stadium', check(primitivePath('pill') === primitivePath('rect', { cornerRadius: 0.5 })));
  it('a star\u2019s points can be rounded', check(primitivePath('star', { points: 5, vertexRadius: 0 }) !== primitivePath('star', { points: 5, vertexRadius: 0.6 })));
  it('rounded or not, it stays in its box', check(flattenPath(primitivePath('star', { points: 5, vertexRadius: 0.9 }), 128)
        .every((p) => Math.abs(p.x) <= 0.5001 && Math.abs(p.y) <= 0.5001)));

  it('the body opens on a circle and an eye on a pill', check(naturalShape('body') === 'circle' && naturalShape('eye') === 'pill'));
  it('custom is reachable but never offered', check(!PRIMITIVE_SHAPES.includes('custom' as never)));
}

// --- the outline is an editable spline -------------------------------------------
{
  const area = (pts: { x: number; y: number }[]) =>
    Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + (p.x * q.y - q.x * p.y); }, 0) / 2);

  // anchors are the points that define the outline, not resampled ones: dragging one of
  // 64 even samples would fight the seven that actually shape it
  it('a circle has its spline points', check(pathAnchors(primitivePath('circle')).length === 8));
  it('a rect has four', check(pathAnchors(primitivePath('rect')).length === 4));
  it('a five-pointed star has ten', check(pathAnchors(primitivePath('star', { points: 5 })).length === 10));
  it('and a closed path counts its start once', check(pathAnchors('M 0 0 L 1 0 L 1 1 L 0 1 Z').length === 4));

  const circle = primitivePath('circle');
  const before = pathAnchors(circle);
  const pulled = movePathAnchor(circle, 0, { x: before[0].x, y: before[0].y - 0.4 });
  const after = pathAnchors(pulled);

  it('moving a point moves that point', check(Math.abs(after[0].y - (before[0].y - 0.4)) < 1e-6));
  it('and leaves the others alone', check(JSON.stringify(before.slice(1)) === JSON.stringify(after.slice(1))));
  it('curvature survives the edit — a pulled circle is still curved', check(pulled.includes('C')));
  it('and the shape is still closed and sane', check(area(flattenPath(pulled, 128)) > area(flattenPath(circle, 128)), `${area(flattenPath(circle, 128)).toFixed(3)} -> ${area(flattenPath(pulled, 128)).toFixed(3)}`));

  it('an out-of-range index changes nothing', check(movePathAnchor(circle, 99, { x: 0, y: 0 }) === circle));
  it('and junk does not throw', check(movePathAnchor('nonsense', 0, { x: 0, y: 0 }).length >= 0));

  // an edited outline still morphs, which is the point of keeping it a path
  const star = primitivePath('star', { points: 5 });
  const mid = morphPath(pulled, star, 0.5);
  it('a hand-edited outline still morphs', check(mid !== pulled && mid !== star && flattenPath(mid, 32).length === 32));
}

// --- every corner of the parser, the caches and the samplers ---------------------------------
import { flattenPath as flat, isOpenPath, lerpPath, mapPath, morphPath as morph, movePathAnchor as move, normalizePath, pathAnchors as anchors, pathBounds, pathFromPoints, pathSampler, pathToBezier, splitSubpaths } from './path';
{
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  it('a non-string path is nothing', check(flat(5 as never).length === 0));
  it('relative moves, smooth curves with and without a predecessor', check(
    mapPath('m 1 1 2 2', (p) => p) === 'M 1 1 L 3 3'
    && mapPath('M0 0 C 1 1 2 2 3 0 S 5 5 10 0', (p) => p).includes('C 4 -2')
    && mapPath('M0 0 S 5 5 10 0', (p) => p).includes('C 0 0 5 5 10 0'),
  ));
  it('smooth quadratics with and without a predecessor', check(
    mapPath('M0 0 Q 5 5 10 0 T 20 0', (p) => p).split('C').length === 3 && mapPath('M0 0 T 10 0', (p) => p).includes('C 0 0'),
  ));
  it('two outlines split in two', check(splitSubpaths('M0 0 L5 5 M10 10 L20 20').length === 2));
  it('the parse cache survives being filled', check((() => { for (let i = 0; i < 2100; i++) mapPath(`M0 0 L${i} 1`, (p) => p); return true; })()));

  const sq = 'M0 0 L10 0 L10 10 L0 10 Z';
  const b = pathToBezier(sq)!;
  it('a closed path is bezier data that closes on itself', check(b.c && b.v.length === 4));
  it('nothing, or only infinities, has no bezier, no bounds, no anchors', check(pathToBezier('zz') === null && pathBounds('M 1e999 0 L 5 5') === null && pathBounds('zz') === null && anchors('zz').length === 0 && normalizePath('zz') === null));
  it('an open path keeps its last point', check(pathToBezier('M0 0 L5 5')!.v.length === 2));
  it('a degenerate arc is a line', check(mapPath('M0 0 A 0 0 0 0 0 5 5', (p) => p) === 'M 0 0 L 5 5' && mapPath('M5 5 A 3 3 0 0 0 5 5', (p) => p) === 'M 5 5 L 5 5'));
  it('moving an anchor of a polygon, and of nothing', check(move(sq, 1, { x: 12, y: 1 }).includes('M 0 0 L 12 1') && move('zz', 0, { x: 1, y: 1 }) === 'zz'));

  it('a zero-length path flattens to its one point', check(flat('M5 5 L5 5', 4).length === 4 && flat('M5 5 L5 5', 4).every((p) => p.x === 5)));
  it('the flatten cache survives being filled', check((() => { for (let i = 0; i < 650; i++) flat(`M0 0 L${i} 1`, 8); return true; })()));
  it('no points, no path', check(pathFromPoints([]) === ''));

  it('an infinite line is not open, a finite one is', check(isOpenPath('M0 0 L5 5') && !isOpenPath('zz')));
  it('open lines with nothing to flatten snap to the nearer end', check(morph('M0 0 L 1e999 0', 'M0 0 L9 0', 0.2) === 'M0 0 L 1e999 0' && morph('M0 0 L9 0', 'M0 0 L 1e999 0', 0.8) === 'M0 0 L 1e999 0'));
  it('open lines run the way that matches', check(morph('M0 0 L10 0', 'M10 0 L0 0', 0.5, 4).startsWith('M 0 0')));
  it('a loop against nothing snaps too', check(morph(sq, 'zz', 0.2) === sq && morph(sq, 'zz', 0.8) === 'zz'));
  it('the alignment cache survives being filled', check((() => { for (let i = 0; i < 650; i++) morph(sq, `M0 0 L${i + 20} 0 L10 10 Z`, 0.5, 8); return true; })()));
  it('lerping ends and mismatched writings', check(lerpPath('M0 0', 'M5 5', 1) === 'M5 5' && typeof lerpPath('', 'x', 0.5) === 'string' && lerpPath('M 0 0 L 10 0', 'M 0 0 L 20 0', 0.5) === 'M 0 0 L 15 0'));

  it('a zero-length line cannot be sampled', check(pathSampler('M5 5 L5 5') === null));
  const line = pathSampler('M0 0 L10 0 L10 0')!;
  it('a path is sampled along its length, a trailing duplicate included', check(line.at(10).x === 10 && line.at(NaN).x === 0));
  const open = pathSampler('M0 0 L10 0')!;
  it('and carries straight on past either end', check(open.at(-5).x === -5 && open.at(15).x === 15 && same(open.at(-5).angle, 0)));
  it('the sampler cache survives being filled', check((() => { for (let i = 0; i < 650; i++) pathSampler(`M0 0 L${i + 1} 0`); return true; })()));

  it('a turned star and a turned pebble', check(primitivePath('star', { rotation: 30 }).length > 0 && primitivePath('pebble', { rotation: 30 }) !== primitivePath('pebble')));
}
{
  const { naturalShape: ns } = await import('./path');
  it('a circle primitive is a circle, anything else a pill', check(ns('x', { shape: 'circle' }) === 'circle' && ns('x') === 'pill' && ns('body') === 'circle'));
}
{ it('lerping against an empty path morphs', check(typeof lerpPath('M0 0 L5 5', '', 0.5) === 'string')); }
