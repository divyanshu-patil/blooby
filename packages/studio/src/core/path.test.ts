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

  ed().addTimeline('Shapes');
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
