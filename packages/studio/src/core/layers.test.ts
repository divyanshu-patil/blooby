import { it } from 'vitest';
import { check, near } from './testkit';
import { defaultProject } from './defaults';
import { compOf } from './comp';
import { buildScene, evaluateRig, sceneAt } from './scene';
import {
  duplicateLayer, groupLayers, layerOrder, makeShapeLayer, removeLayer, reorderLayer, setAppearance,
  setAttachment, ungroupLayer,
} from './layers';
import { activeTimeline } from './types';
import type { Project } from './types';

const itemOf = (p: Project, id: string, t = 0) => buildScene(evaluateRig(p, t), compOf(p)).find((s) => s.id === id);

// --- one draw order, and it is zIndex ------------------------------------------
{
  const p = defaultProject();
  p.rig.nodes.star = { ...makeShapeLayer('star', { id: 'star' }), zIndex: 10 };
  const ids = () => layerOrder(p.rig).map((n) => n.id).join(',');
  const drawn = () => buildScene(evaluateRig(p, 0), compOf(p)).map((s) => s.id).join(',');
  it('the order is back to front by zIndex', check(ids() === 'body,eyeL,eyeR,star', ids()));
  it('and the stage paints in exactly that order', check(drawn() === ids(), drawn()));

  reorderLayer(p, 'star', 'back');
  it('send to back puts it first', check(ids() === 'star,body,eyeL,eyeR', ids()));
  it('so it is painted behind the body', check(drawn().startsWith('star,'), drawn()));
  reorderLayer(p, 'star', 'forward');
  it('forward moves exactly one step', check(ids() === 'body,star,eyeL,eyeR', ids()));
  reorderLayer(p, 'star', 'front');
  it('bring to front puts it last', check(ids().endsWith(',star'), ids()));
  reorderLayer(p, 'star', 'backward');
  it('backward moves exactly one step', check(ids() === 'body,eyeL,star,eyeR', ids()));
  reorderLayer(p, 'star', 0);
  it('a number is a position', check(ids().startsWith('star,'), ids()));
  it('zIndex stays dense and unique, so a step is always one layer', check(layerOrder(p.rig).every((n, i) => n.zIndex === i)));
}

// --- world ↔ mascot, keeping everything where it is on screen ---------------------
{
  const p = defaultProject();
  // a bare timeline: the default one keyframes the body's yaw, which would mask the pose
  // these checks set directly on the rig
  Object.assign(activeTimeline(p), { tracks: [], blocks: [], modifiers: [] });
  p.rig.nodes.hat = makeShapeLayer('pebble', { id: 'hat', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 30, y: -120 } } });
  const before = itemOf(p, 'hat')!;
  it('a new shape is a world layer', check(p.rig.nodes.hat.parentId === null && before.cx === 390 && before.cy === 240, `${before.cx},${before.cy}`));

  setAttachment(p, 'hat', 'mascot', undefined, 0);
  const on = itemOf(p, 'hat')!;
  it('attaching to the mascot keeps it where it was', check(near(on.cx, before.cx, 0.6) && near(on.cy, before.cy, 0.6), `${before.cx},${before.cy} -> ${on.cx.toFixed(2)},${on.cy.toFixed(2)}`));
  it('and it lands ON the sphere, placed by angle', check(p.rig.nodes.hat.parentId === 'body' && p.rig.nodes.hat.surface.mapped));

  p.rig.nodes.body.surface.flatOffset = { x: 50, y: 0 };
  it('it follows the mascot as it moves', check(near(itemOf(p, 'hat')!.cx, on.cx + 50, 0.6)));
  p.rig.nodes.body.surface.flatOffset = { x: 0, y: 0 };

  p.rig.nodes.body.surface.yaw = 30;
  const turned = itemOf(p, 'hat')!;
  it('a head turn carries it round the surface — sideways AND foreshortened', check(turned.cx > on.cx + 20 && turned.w < on.w, `${on.cx.toFixed(1)} -> ${turned.cx.toFixed(1)}`));
  p.rig.nodes.body.surface.yaw = 0;
  p.rig.nodes.body.surface.pitch = 25;
  it('a pitch carries it vertically round the surface', check(itemOf(p, 'hat')!.cy > on.cy + 10));
  p.rig.nodes.body.surface.pitch = 0;

  p.rig.nodes.body.transform.scale = { x: 1.5, y: 1.5 };
  const big = itemOf(p, 'hat')!;
  it('when the mascot scales, the attachment scales with it', check(near((big.cy - 360) / (on.cy - 360), 1.5, 0.03), String(((big.cy - 360) / (on.cy - 360)).toFixed(3))));
  p.rig.nodes.body.transform.scale = { x: 1, y: 1 };

  // the offset on a mapped layer is the attachment nudge now, and it rides the body
  p.rig.nodes.hat.surface.flatOffset = { x: 10, y: 0 };
  it('an offset on an attached layer nudges it in the body\'s frame', check(near(itemOf(p, 'hat')!.cx, on.cx + 10, 0.6)));
  p.rig.nodes.hat.surface.flatOffset = { x: 0, y: 0 };

  setAttachment(p, 'hat', 'world', undefined, 0);
  const back = itemOf(p, 'hat')!;
  it('detaching keeps it where it was too', check(near(back.cx, before.cx, 0.6) && near(back.cy, before.cy, 0.6), `${back.cx.toFixed(2)},${back.cy.toFixed(2)}`));
  p.rig.nodes.body.surface.flatOffset = { x: 50, y: 0 };
  it('and a world layer ignores the mascot', check(near(itemOf(p, 'hat')!.cx, back.cx, 1e-6)));

  // off the silhouette it cannot be on the sphere, so it attaches as a flat offset
  p.rig.nodes.far = makeShapeLayer('star', { id: 'far', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 260, y: 0 } } });
  const far0 = itemOf(p, 'far')!;
  setAttachment(p, 'far', 'mascot', undefined, 0);
  it('past the rim it attaches flat, still where it was', check(!p.rig.nodes.far.surface.mapped && near(itemOf(p, 'far')!.cx, far0.cx, 0.6)));
  it('a layer can never be attached inside itself', check(!setAttachment(p, 'body', 'mascot', 'hat', 0)));
}

// --- appearance ranges ------------------------------------------------------------
{
  const p = defaultProject();
  p.rig.nodes.hi = makeShapeLayer('star', { id: 'hi' });
  const at = (t: number) => sceneAt(p, t, compOf(p)).find((s) => s.id === 'hi');
  setAppearance(p, 'hi', { startMs: 500, endMs: 1200 }, 0);
  it('a layer is not there before its range', check(!at(300)));
  it('it is there inside it', check(!!at(800)));
  it('and gone after it', check(!at(1300)));

  setAppearance(p, 'hi', { fadeInMs: 200 }, 800);
  it('a fade-in ramps its opacity', check((at(550)?.alpha ?? 1) < 0.5 && (at(800)?.alpha ?? 0) > 0.99, `${at(550)?.alpha} / ${at(800)?.alpha}`));
  it('without shrinking it — the range is about existing, not size', check(near(at(550)!.w, at(800)!.w, 1e-6)));
  const v = compOf(p);
  const a1 = JSON.stringify(sceneAt(p, 650, v));
  sceneAt(p, 1100, v);
  it('scrubbing back gives exactly the same frame', check(JSON.stringify(sceneAt(p, 650, v)) === a1));

  p.rig.nodes.hi.ranged = true;
  setAppearance(p, 'hi', null, 0);
  it('a ranged layer with no range is never there', check(!at(300) && !at(800)));
  p.rig.nodes.hi.ranged = false;
  it('and an unranged one with no range is always there', check(!!at(300) && !!at(1300)));

  // a range that came with a clip stays relative to the clip
  const tl = activeTimeline(p);
  tl.appearances = [{ id: 'x', nodeId: 'hi', blockId: tl.blocks[1].id, startMs: 100, endMs: 300 }];
  const start = tl.blocks[0].durationMs;
  it('a clip-scoped range runs inside its clip', check(!at(start + 50) && !!at(start + 200) && !at(start + 400)));
}

// --- duplicate, delete, group -------------------------------------------------------
{
  const p = defaultProject();
  const tl = activeTimeline(p);
  p.rig.nodes.s = makeShapeLayer('star', { id: 's' });
  tl.tracks.push({ id: 'ts', nodeId: 's', property: 'transform.rotation', keyframes: [
    { id: 'k1', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'k2', time: 500, value: 90, easingOut: { type: 'linear' } }] });
  tl.appearances = [{ id: 'ap', nodeId: 's', startMs: 0, endMs: 900 }];
  const copy = duplicateLayer(p, 's')!;
  it('duplicate makes a new layer', check(!!p.rig.nodes[copy] && copy !== 's' && p.rig.nodes[copy].name === 'Star copy'));
  it('with its own copy of the animation', check(tl.tracks.some((t) => t.nodeId === copy) && tl.tracks.find((t) => t.nodeId === copy)!.keyframes[0].id !== 'k1'));
  it('and of its appearance range', check(tl.appearances.some((a) => a.nodeId === copy)));
  it('placed just above the original', check(p.rig.nodes[copy].zIndex === p.rig.nodes.s.zIndex + 1));
  removeLayer(p, copy);
  it('delete takes the layer, its tracks and its ranges with it', check(!p.rig.nodes[copy] && !tl.tracks.some((t) => t.nodeId === copy) && !tl.appearances.some((a) => a.nodeId === copy)));
  it('the body can never be deleted', check(removeLayer(p, 'body').size === 0 && !!p.rig.nodes.body));

  p.rig.nodes.a = makeShapeLayer('star', { id: 'a', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 200, y: 0 } } });
  p.rig.nodes.b = makeShapeLayer('blob', { id: 'b', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 260, y: 60 } } });
  const pos = () => ['a', 'b'].map((id) => itemOf(p, id)!);
  const [a0, b0] = pos();
  const g = groupLayers(p, ['a', 'b'], 0)!;
  const [a1, b1] = pos();
  it('grouping moves nothing', check(near(a0.cx, a1.cx, 0.01) && near(a0.cy, a1.cy, 0.01) && near(b0.cx, b1.cx, 0.01) && near(b0.cy, b1.cy, 0.01)));
  it('and both are inside the group', check(p.rig.nodes.a.parentId === g && p.rig.nodes.b.parentId === g));
  p.rig.nodes[g].transform.rotation = 180;
  const [a2, b2] = pos();
  it('turning the group turns its children about the group centre', check(near(a2.cx, b0.cx, 0.6) && near(a2.cy, b0.cy, 0.6) && near(b2.cx, a0.cx, 0.6), `${a2.cx.toFixed(1)},${a2.cy.toFixed(1)}`));
  p.rig.nodes[g].transform.rotation = 0;
  p.rig.nodes[g].transform.scale = { x: 2, y: 2 };
  it('scaling the group scales its children', check(near(pos()[0].w, a0.w * 2, 0.01)));
  p.rig.nodes[g].transform.scale = { x: 1, y: 1 };
  ungroupLayer(p, g, 0);
  const [a3, b3] = pos();
  it('ungrouping moves nothing either, and the group is gone', check(!p.rig.nodes[g] && near(a3.cx, a0.cx, 0.01) && near(b3.cy, b0.cy, 0.01)));
}
