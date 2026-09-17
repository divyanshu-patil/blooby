import { it } from 'vitest';
import { check } from './testkit';
import {
  bakeHandles, curveFromPath, curveToPath, insertPoint, lineCurve, moveAnchor, moveHandle, nearestOnCurve, removePoint, reverseCurve,
  type Curve,
} from './curve';
import { flattenPath, isOpenPath, lerpPath, morphPath, pathAnchors, pathSampler } from './path';
import { makeCurveLayer } from './layers';
import { defaultProject } from './defaults';
import { sceneAt } from './scene';
import { compOf } from './comp';
import { useEditor } from './store';
import type { Vec2 } from './types';

const near = (a: Vec2, b: Vec2, e = 1e-3) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e;
const wave = [{ x: 0, y: 0 }, { x: 100, y: -50 }, { x: 200, y: 0 }, { x: 300, y: -50 }, { x: 400, y: 0 }];
const c: Curve = { points: wave, closed: false };

// --- a curve of any number of points ------------------------------------------------------
{
  const d = curveToPath(c, 'smooth');
  it('a smooth curve through five points has five anchors', check(pathAnchors(d).length === 5));
  it('and passes exactly through every one of them', check(pathAnchors(d).every((p, i) => near(p, wave[i]))));
  it('it is an open line, not an outline', check(isOpenPath(d)));
  it('the anchors read back from the path are the ones written', check(curveFromPath(d)?.points.every((p, i) => near(p, wave[i])) === true && curveFromPath(d)?.closed === false));
  it('a polyline has straight segments only', check(!/C/.test(curveToPath(c, 'polyline')) && pathAnchors(curveToPath(c, 'polyline')).length === 5));
  const twenty = Array.from({ length: 20 }, (_, i) => ({ x: i * 20, y: Math.sin(i) * 30 }));
  it('twenty points are twenty anchors', check(pathAnchors(curveToPath({ points: twenty, closed: false }, 'smooth')).length === 20));
  it('two points are a curve too — the shortest one', check(pathAnchors(curveToPath(lineCurve({ x: 0, y: 0 }, { x: 10, y: 5 }), 'smooth')).length === 2));
  it('one point is not', check(curveToPath({ points: [{ x: 1, y: 1 }], closed: false }, 'smooth') === ''));
}

// --- editing the anchors --------------------------------------------------------------------
{
  const hit = nearestOnCurve(c, 'smooth', { x: 150, y: -40 })!;
  const ins = insertPoint(c, 'smooth', hit.seg, hit.t);
  it('a double-click inserts a point on the segment under it', check(ins.points.length === 6 && hit.seg === 1));
  const onLine = flattenPath(curveToPath(c, 'smooth'), 400).some((p) => near(p, ins.points[hit.seg + 1], 1.5));
  it('exactly where the curve already ran', check(onLine));

  const b = bakeHandles(c, 'smooth');
  it('turning a smooth curve into a hand-edited one does not move it', check(curveToPath(b, 'bezier') === curveToPath(c, 'smooth')));
  const split = insertPoint(b, 'bezier', 2, 0.3);
  const before = flattenPath(curveToPath(b, 'bezier'), 200), after = flattenPath(curveToPath(split, 'bezier'), 200);
  it('splitting a hand-edited curve leaves its shape exactly as it was', check(before.every((p) => after.some((q) => near(p, q, 1.2)))));

  const rm = removePoint(c, 2)!;
  it('removing a point drops just that anchor', check(rm.points.length === 4 && !rm.points.some((p) => near(p, wave[2]))));
  it('but a curve never goes below two points', check(removePoint(lineCurve({ x: 0, y: 0 }, { x: 9, y: 9 }), 0) === null));

  const mv = moveAnchor(c, 1, { x: 100, y: -120 });
  it('moving an anchor moves that anchor and no other', check(near(pathAnchors(curveToPath(mv, 'smooth'))[1], { x: 100, y: -120 }) && near(mv.points[3], wave[3])));

  const h = moveHandle(b, 2, 'out', { x: 260, y: 40 });
  const hin = h.points[2].hin!, hout = h.points[2].hout!;
  it('dragging a handle keeps the point smooth: the other handle turns to stay opposite', check(Math.abs(Math.atan2(hin.y, hin.x) - Math.atan2(-hout.y, -hout.x)) < 1e-6));
  it('keeping its own length', check(Math.abs(Math.hypot(hin.x, hin.y) - Math.hypot(b.points[2].hin!.x, b.points[2].hin!.y)) < 1e-9));
  const free = moveHandle(b, 2, 'out', { x: 260, y: 40 }, true);
  it('Alt breaks the pair into a corner: the other handle stays where it was', check(near(free.points[2].hin!, b.points[2].hin!)));

  const closed = curveToPath({ ...c, closed: true }, 'smooth');
  it('a curve can be closed', check(/Z\s*$/.test(closed) && !isOpenPath(closed) && pathAnchors(closed).length === 5));
  const rev = reverseCurve(c);
  it('and reversed: the same curve, run the other way', check(near(rev.points[0], wave[4]) && near(rev.points[4], wave[0])));
  const rb = reverseCurve(b);
  it('a reversed hand-edited curve draws the same shape', check(flattenPath(curveToPath(rb, 'bezier'), 100).every((p) => flattenPath(curveToPath(b, 'bezier'), 400).some((q) => near(p, q, 1.5)))));
}

// --- keyframing a curve ---------------------------------------------------------------------
{
  const a = curveToPath(c, 'smooth');
  const b = curveToPath(moveAnchor(c, 2, { x: 200, y: 80 }), 'smooth');
  const mid = lerpPath(a, b, 0.5);
  it('between two keyframes of one curve its REAL anchors move — no resampled points', check(pathAnchors(mid).length === 5));
  it('each halfway between its two keyframes', check(near(pathAnchors(mid)[2], { x: 200, y: 40 }) && near(pathAnchors(mid)[0], wave[0])));
  it('and it stays an open line', check(isOpenPath(mid)));
  const more = curveToPath({ points: [...wave, { x: 500, y: -60 }], closed: false }, 'smooth');
  const m2 = morphPath(a, more, 0.5);
  it('curves with different point counts still morph, still open', check(isOpenPath(m2) && pathAnchors(m2).length > 5));
  it('reaching from start to end — neither tip is lost', check(near(pathAnchors(m2)[0], { x: 0, y: 0 }, 0.5) && pathAnchors(m2).at(-1)!.x > 440));
  it('an open line resamples all the way to its last point', check(near(flattenPath('M 0 0 L 100 0', 11).at(-1)!, { x: 100, y: 0 })));
}

// --- measuring along a path (what text on a path reads) ------------------------------------
{
  const line = pathSampler('M 0 0 L 100 0')!;
  it('a line knows its length', check(Math.abs(line.length - 100) < 1e-9));
  it('where a distance along it lands, and which way it runs', check(near(line.at(50), { x: 50, y: 0 }) && Math.abs(line.at(50).angle) < 1e-9));
  it('past its end it carries straight on', check(near(line.at(130), { x: 130, y: 0 })));
  const ring = pathSampler('M 0 -50 C 27.6 -50 50 -27.6 50 0 C 50 27.6 27.6 50 0 50 C -27.6 50 -50 27.6 -50 0 C -50 -27.6 -27.6 -50 0 -50 Z')!;
  it('a closed loop measures its circumference', check(Math.abs(ring.length - 2 * Math.PI * 50) < 1.5, String(ring.length)));
  it('and wraps round: a lap later is the same place', check(near(ring.at(10), ring.at(10 + ring.length), 1e-6)));
  it('an empty path has nothing to measure', check(pathSampler('') === null));
  it('and asking for the same one twice builds it once', check(pathSampler('M 0 0 L 100 0') === line));
}

// --- a curve is a layer like any other -------------------------------------------------------
{
  const n = makeCurveLayer(wave.map((p) => ({ x: p.x - 200, y: p.y + 25 })), { name: 'Wave', guide: true })!;
  it('a drawn curve becomes a shape layer with its outline as the path', check(n.kind === 'primitive' && !!n.shapePath && n.curve?.type === 'smooth'));
  it('stroked, not filled', check(n.fill?.enabled === false && n.stroke?.enabled === true));
  it('its box is uniform, so a flat wave is not stretched', check(n.size.x === n.size.y && n.size.x === 400));
  it('it can be a guide', check(n.guide === true));
  it('fewer than two points is no curve', check(makeCurveLayer([{ x: 0, y: 0 }]) === null && makeCurveLayer([{ x: NaN, y: 0 }, { x: 1, y: 1 }]) === null));
  const p = defaultProject();
  p.rig.nodes[n.id] = { ...n, zIndex: 9 };
  const item = sceneAt(p, 0, compOf(p)).find((s) => s.id === n.id)!;
  it('it draws: its path, its stroke, no fill', check(item.path === n.shapePath && !!item.stroke && item.color.a === 0));
  it('where it was drawn', check(Math.abs(item.cx - (compOf(p).width / 2 + 0)) < 1 && Math.abs(item.cy - (compOf(p).height / 2)) < 1));
}

// --- through the store: the pen tool, point edits, undo --------------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const view = compOf(ed().project);
  // a pen stroke in composition px, the way the stage hands it over
  const id = ed().addCurve([{ x: 160, y: 500 }, { x: 360, y: 420 }, { x: 560, y: 500 }])!;
  const p = ed().project;
  const item = sceneAt(p, 0, view).find((s) => s.id === id)!;
  const drawn = pathAnchors(item.path!).map((a) => ({ x: item.cx + a.x * item.w, y: item.cy + a.y * item.h }));
  it('a pen stroke becomes a curve exactly where it was drawn', check(near(drawn[0], { x: 160, y: 500 }, 0.05) && near(drawn[2], { x: 560, y: 500 }, 0.05)));
  it('named "Curve 1", selected', check(p.rig.nodes[id].name === 'Curve 1' && ed().selection[0] === id));

  const before = ed().project.rig.nodes[id].shapePath;
  ed().editCurve(id, (c) => moveAnchor(c, 1, { x: 0, y: -0.4 }), 'drag');
  ed().editCurve(id, (c) => moveAnchor(c, 1, { x: 0, y: -0.45 }), 'drag');
  it('dragging a point reshapes the curve', check(ed().project.rig.nodes[id].shapePath !== before && Math.abs(pathAnchors(ed().project.rig.nodes[id].shapePath!)[1].y + 0.45) < 1e-6));
  ed().undo();
  it('and the whole drag is one undo step', check(ed().project.rig.nodes[id].shapePath === before));

  const smooth = ed().project.rig.nodes[id].shapePath!;
  ed().setCurveType(id, 'bezier');
  it('switching to hand-edited Bézier keeps the curve exactly as it was', check(ed().project.rig.nodes[id].shapePath === smooth && ed().project.rig.nodes[id].curve?.type === 'bezier'));
  ed().setCurveType(id, 'polyline');
  it('and a polyline draws it with straight segments', check(!/C/.test(ed().project.rig.nodes[id].shapePath!)));

  ed().toggleAutoKey();
  ed().setPlayhead(600);
  ed().editCurve(id, (c) => moveAnchor(c, 1, { x: 0, y: 0.2 }));
  ed().toggleAutoKey();
  const track = ed().project.timelines.flatMap((t) => t.tracks).find((t) => t.nodeId === id && t.property === 'shape.path');
  it('with autokey on, a point edit is a path keyframe — the curve animates', check(!!track && track.keyframes.some((k) => Math.abs(k.time - 600) < 1)));

  const tid = ed().addText('HELLO', { at: { x: 200, y: 150 } });
  const t = sceneAt(ed().project, 0, view).find((s) => s.id === tid)!;
  it('a text layer lands where the Text tool was clicked', check(Math.abs(t.cx - 200) < 1 && Math.abs(t.cy - 150) < 1));
  ed().loadProject(defaultProject());
}

// --- a curve made a rubber hose keeps its ends and its length ------------------------
{
  const p = defaultProject();
  const n = makeCurveLayer([{ x: -100, y: 0 }, { x: 0, y: -60 }, { x: 100, y: 0 }], { width: 10 })!;
  p.rig.nodes[n.id] = n;
  const ed = () => useEditor.getState();
  ed().loadProject(p);
  const before = sceneAt(ed().project, 0, compOf(p)).find((s) => s.id === n.id)!;
  ed().curveToHose(n.id);
  const l = ed().project.rig.nodes[n.id].limb;
  it('a curve made a hose is a limb from its start to its end', check(!!l && Math.abs(l.a.x + 100) < 1 && Math.abs(l.c!.x - 100) < 1 && Math.abs(l.a.y) < 1, JSON.stringify(l)));
  it('through its middle, at its own length and stroke width', check(!!l && Math.abs(l.b.y + 60) < 8 && l.length > 200 && l.thickness === 10, JSON.stringify(l)));
  const after = sceneAt(ed().project, 0, compOf(p)).find((s) => s.id === n.id)!;
  it('and it still draws about where the curve was', check(!!after?.limb && Math.abs(after.cx - before.cx) < 12, `${after?.cx} vs ${before.cx}`));
  ed().undo();
  it('undo gives the curve back', check(!!ed().project.rig.nodes[n.id].curve));
  ed().loadProject(defaultProject());
}
