import { it } from 'vitest';
import { check } from './testkit';
import { useEditor } from './store';
import { defaultProject } from './defaults';
import { evaluateRig, sceneAt } from './scene';
import { compOf } from './comp';
import { activeTimeline } from './types';
import { addMascot, layerOrder, makeShapeLayer, placeUnder, removeLayer, reorderLayer, saveMascotTemplate } from './layers';
import { laneOf, mascotOf, mascotsOf, partOf } from './mascot';
import { blockStarts } from './timeline';
import { bakeLottie } from '../export/lottie';
import type { Project } from './types';

const at = (p: Project, id: string, t = 0) => sceneAt(p, t, compOf(p)).find((s) => s.id === id);
const order = (p: Project) => sceneAt(p, 0, compOf(p)).map((s) => s.id);
const ed = () => useEditor.getState();

// --- several mascots in one composition ---------------------------------------------------
{
  const p = defaultProject();
  const m2 = addMascot(p, 'blob');
  const m3 = addMascot(p, 'octopus', { name: 'Charlie' });
  it('three mascots in one composition', check(mascotsOf(p.rig).length === 3));
  it('named "Mascot 2" on their own, or whatever they are called', check(p.rig.nodes[m2].name === 'Mascot 2' && p.rig.nodes[m3].name === 'Charlie'));
  it('each an instance of the one rig: a body, two eyes that know which part they are', check(
    partOf(p.rig, m2, 'eyeL') === `${m2}.eyeL` && partOf(p.rig, m3, 'eyeR') === `${m3}.eyeR` && partOf(p.rig, 'body', 'eyeL') === 'eyeL'));
  it('every id unique', check(new Set(Object.values(p.rig.nodes).map((n) => n.id)).size === Object.keys(p.rig.nodes).length));
  it('all three drawn, apart from each other', check(
    [p.rig.rootId, m2, m3].every((id) => !!at(p, id)) && Math.abs(at(p, m2)!.cx - at(p, 'body')!.cx) > 150 && Math.abs(at(p, m3)!.cx - at(p, m2)!.cx) > 150));
  it('each mascot\'s eyes ride its own body', check(Math.abs(at(p, `${m2}.eyeL`)!.cx - at(p, m2)!.cx) < 60 && Math.abs(at(p, `${m3}.eyeR`)!.cx - at(p, m3)!.cx) < 60));
  it('a blob draws as a blob', check(at(p, m2)!.path === p.rig.nodes[m2].shapePath && !!at(p, m2)!.path));
  it('every part knows its mascot', check(mascotOf(p.rig, `${m3}.eyeL`)?.id === m3 && mascotOf(p.rig, 'eyeR')?.id === 'body'));

  // independent transforms
  const first = at(p, 'body')!;
  p.rig.nodes[m2].transform.scale = { x: 0.5, y: 0.5 };
  p.rig.nodes[m3].transform.rotation = 20;
  it('scaling one mascot leaves the others alone', check(at(p, 'body')!.w === first.w && at(p, m2)!.w < first.w * 0.6));
  it('and its eyes shrink with it', check(at(p, `${m2}.eyeL`)!.w < at(p, 'eyeL')!.w * 0.6));
  it('rolling one rolls only that one', check(at(p, m3)!.rotation === 20 && at(p, 'body')!.rotation === first.rotation));
}

// --- each mascot animates independently, in its own lane ---------------------------------
{
  ed().loadProject(defaultProject());
  const m2 = ed().addMascot('default');
  it('adding a mascot selects it', check(ed().selection[0] === m2));
  ed().addBlock('p_blink', undefined, m2);
  const p = ed().project;
  const tl = activeTimeline(p);
  const blk = tl.blocks.at(-1)!;
  it('a preset placed on mascot 2 sits in mascot 2\'s lane, starting at 0 alongside the first\'s clips', check(blk.mascotId === m2 && blockStarts(tl).at(-1) === 0));
  it('and animates mascot 2\'s parts, never the first mascot\'s', check(tl.tracks.filter((t) => t.blockId === blk.id).every((t) => mascotOf(p.rig, t.nodeId)?.id === m2)));
  it('its layers are in its lane', check(laneOf(p.rig, tl, `${m2}.eyeL`) === m2 && laneOf(p.rig, tl, 'eyeL') === ''));
  const closed = Array.from({ length: 80 }, (_, i) => i * 12).find((t) => evaluateRig(p, t).nodes[`${m2}.eyeL`].eye!.openness < 0.3);
  it('mascot 2 blinks while the first mascot carries on with its own clip', check(
    closed !== undefined && evaluateRig(p, closed).nodes.eyeL.eye!.openness > 0.5, String(closed)));
  // mascot 1 keeps the animation it had
  const lone = defaultProject();
  it('the first mascot plays exactly what it did before mascot 2 arrived', check(
    [0, 400, 1300, 2600, 4100].every((t) => JSON.stringify(evaluateRig(lone, t).nodes.body) === JSON.stringify(evaluateRig(p, t).nodes.body))));

  // a keyframe on mascot 2 lands in mascot 2's own clip (past a lane's end still belongs to
  // its last clip, exactly as it does for the first mascot) — never in the first mascot's
  ed().setPlayhead(3000);
  ed().toggleAutoKey();
  ed().setValue(m2, 'flatOffset.x', 400);
  ed().toggleAutoKey();
  const t2 = activeTimeline(ed().project).tracks.find((t) => t.nodeId === m2 && t.property === 'flatOffset.x');
  it('keying mascot 2 scopes the keyframe to mascot 2\'s own clip, not the first mascot\'s', check(t2?.blockId === blk.id));
  it('and it plays there, while the first mascot\'s clips run', check(evaluateRig(ed().project, 3000).nodes[m2].surface.flatOffset?.x === 400));
}

// --- new mascots find room -----------------------------------------------------------------
{
  const p = defaultProject();
  const ids = [addMascot(p, 'default'), addMascot(p, 'blob'), addMascot(p, 'octopus')];
  const xs = [0, ...ids.map((id) => p.rig.nodes[id].surface.flatOffset!.x)].sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  it('each new mascot goes into the widest gap, so none lands on another', check(Math.min(...gaps) >= 120, xs.join()));
  it('and all of them stay on the canvas', check(xs.every((x) => Math.abs(x) <= compOf(p).width / 2 - 100)));
}

// --- one clip animating several mascots ------------------------------------------------------
{
  // a clip in the FIRST mascot's lane that also walks the second mascot in — what a
  // two-mascot preset is — and the second mascot's own lane blinking at the same time
  const p = defaultProject();
  const m2 = addMascot(p, 'default');
  const tl = activeTimeline(p);
  tl.blocks = [{ id: 'duo', presetId: 'p_neutral', name: 'Duo', durationMs: 1000 }, { id: 'own', presetId: 'p_blink', name: 'Blink', durationMs: 1000, mascotId: m2 }];
  tl.tracks = [
    { id: 'walk', nodeId: m2, property: 'flatOffset.x', blockId: 'duo', keyframes: [{ id: 'a', time: 0, value: 300, easingOut: { type: 'linear' } }, { id: 'b', time: 1000, value: 100, easingOut: { type: 'linear' } }] },
    { id: 'blink', nodeId: `${m2}.eyeL`, property: 'eye.openness', blockId: 'own', keyframes: [{ id: 'c', time: 0, value: 0.2, easingOut: { type: 'linear' } }] },
  ];
  tl.transitions = [];
  const r = evaluateRig(p, 500);
  it('a clip in the first mascot\'s lane can walk the second mascot', check(Math.abs(r.nodes[m2].surface.flatOffset!.x - 200) < 1e-6));
  it('while the second mascot\'s own lane blinks it at the same moment', check(Math.abs(r.nodes[`${m2}.eyeL`].eye!.openness - 0.2) < 1e-6));
  it('and once that clip is over, it walks no more', check(evaluateRig(p, 1500).nodes[m2].surface.flatOffset!.x === p.rig.nodes[m2].surface.flatOffset!.x));
}

// --- layer order: a mascot moves as one ----------------------------------------------------
{
  const p = defaultProject();
  const m2 = addMascot(p, 'default');
  it('a new mascot draws in front of the first', check(order(p).indexOf(m2) > order(p).indexOf('eyeR')));
  reorderLayer(p, m2, 'back');
  const o = order(p);
  it('sent to the back it goes whole — its eyes too — behind the first', check(o.indexOf(`${m2}.eyeL`) < o.indexOf('body') && o.indexOf(m2) < o.indexOf('body')));
  it('its eyes still on top of its own body', check(o.indexOf(`${m2}.eyeL`) > o.indexOf(m2)));
  const s = makeShapeLayer('star', { id: 'between' });
  p.rig.nodes.between = { ...s, zIndex: 0.5 };
  // numbered among the layers it is not carrying: 'body' sits at o.indexOf('body') of them
  reorderLayer(p, 'between', layerOrder(p.rig).map((n) => n.id).filter((id) => id !== 'between').indexOf('body'));
  const o2 = order(p);
  it('and a layer can sit between two mascots', check(o2.indexOf('between') > o2.indexOf(`${m2}.eyeR`) && o2.indexOf('between') < o2.indexOf('body'), o2.join()));
}

// --- attaching to a mascot, and mascots following mascots ---------------------------------
{
  const p = defaultProject();
  const m2 = addMascot(p, 'default', { x: 220 });
  p.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', name: 'Hat', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 220, y: -170 } } });
  const h0 = at(p, 'hat')!;
  it('a hat can be attached to mascot 2', check(placeUnder(p, 'hat', m2, 0) && p.rig.nodes.hat.parentId === m2));
  it('without moving', check(Math.abs(at(p, 'hat')!.cx - h0.cx) < 0.01 && Math.abs(at(p, 'hat')!.cy - h0.cy) < 0.01));
  p.rig.nodes.body.surface.flatOffset = { x: -100, y: 0 };
  it('moving the first mascot leaves it be', check(Math.abs(at(p, 'hat')!.cx - h0.cx) < 0.01));
  p.rig.nodes[m2].surface.flatOffset = { x: 300, y: 0 };
  it('moving mascot 2 carries it', check(Math.abs(at(p, 'hat')!.cx - (h0.cx + 80)) < 0.5));
}
{
  const p = defaultProject();
  const m2 = addMascot(p, 'default');
  const m3 = addMascot(p, 'default');
  const x2 = at(p, m2)!.cx, x3 = at(p, m3)!.cx;
  it('mascot 2 can follow mascot 1', check(placeUnder(p, m2, 'body', 0) && p.rig.nodes[m2].parentId === 'body'));
  it('and mascot 3 follow mascot 2 — a chain', check(placeUnder(p, m3, m2, 0) && p.rig.nodes[m3].parentId === m2));
  it('starting to follow moves nothing', check(Math.abs(at(p, m2)!.cx - x2) < 0.01 && Math.abs(at(p, m3)!.cx - x3) < 0.01));
  it('mascot 1 following mascot 3 would be a loop, and is refused', check(!placeUnder(p, 'body', m3, 0) && p.rig.nodes.body.parentId === null));
  it('as is a mascot following itself', check(!placeUnder(p, m2, m2, 0)));
  p.rig.nodes.shape = makeShapeLayer('star', { id: 'shape' });
  it('and a mascot stuck onto a shape', check(!placeUnder(p, m3, 'shape', 0) && p.rig.nodes[m3].parentId === m2));
  p.rig.nodes.body.surface.flatOffset = { x: 50, y: 0 };
  it('the whole chain follows its leader', check(Math.abs(at(p, m2)!.cx - (x2 + 50)) < 0.5 && Math.abs(at(p, m3)!.cx - (x3 + 50)) < 0.5));
  p.rig.nodes.body.transform.rotation = 90;
  it('turning with it, too', check(at(p, m3)!.rotation === 90));
  const before = at(p, m3)!;
  it('and leaving it again stays exactly where and how it is', check(placeUnder(p, m3, null, 0) && p.rig.nodes[m3].parentId === null
    && Math.abs(at(p, m3)!.rotation - before.rotation) < 1e-6 && Math.abs(at(p, m3)!.cx - before.cx) < 0.01 && Math.abs(at(p, m3)!.cy - before.cy) < 0.01));
}

// --- duplicate and remove ------------------------------------------------------------------
{
  ed().loadProject(defaultProject());
  const copy = ed().duplicateLayer('body')!;
  const p = ed().project;
  const tl = activeTimeline(p);
  const eye = partOf(p.rig, copy, 'eyeL')!;
  it('the first mascot can be duplicated whole', check(p.rig.nodes[copy]?.kind === 'body' && !!eye && p.rig.nodes[copy].name === 'Mascot 2'));
  it('standing clear of the original', check(Math.abs(at(p, copy)!.cx - at(p, 'body')!.cx) > 150));
  it('with its own lane holding the same clips', check(tl.blocks.filter((b) => b.mascotId === copy).length === tl.blocks.filter((b) => !b.mascotId).length));
  it('so it plays the same animation', check([0, 300, 1700, 2900, 4500].every((t) =>
    Math.abs(evaluateRig(p, t).nodes[eye].eye!.openness - evaluateRig(p, t).nodes.eyeL.eye!.openness) < 1e-9)));
}
{
  const p = defaultProject();
  const m2 = addMascot(p, 'default');
  p.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', parentId: m2, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: -190 } } });
  const tl = activeTimeline(p);
  tl.blocks.push({ id: 'bb', presetId: 'p_blink', name: 'Blink', durationMs: 500, mascotId: m2 });
  tl.tracks.push({ id: 'tt', nodeId: `${m2}.eyeL`, property: 'eye.openness', blockId: 'bb', keyframes: [{ id: 'k', time: 0, value: 0.5, easingOut: { type: 'linear' } }] });
  const hatAt = at(p, 'hat')!;
  removeLayer(p, m2);
  it('removing a mascot takes its parts with it', check(!p.rig.nodes[m2] && !p.rig.nodes[`${m2}.eyeL`] && !p.rig.nodes[`${m2}.eyeR`]));
  it('and its lane of clips', check(!tl.blocks.some((b) => b.mascotId === m2) && !tl.tracks.some((t) => t.id === 'tt')));
  it('but a hat hung on it stays, in the world, exactly where it was', check(p.rig.nodes.hat?.parentId === null && Math.abs(at(p, 'hat')!.cx - hatAt.cx) < 0.5 && Math.abs(at(p, 'hat')!.cy - hatAt.cy) < 0.5));
  it('the first mascot cannot be removed', check(removeLayer(p, 'body').size === 0 && !!p.rig.nodes.body));
}

// --- saved mascots -------------------------------------------------------------------------
{
  const p = defaultProject();
  const m2 = addMascot(p, 'octopus', { name: 'Oct' });
  p.rig.nodes[m2].color = { r: 10, g: 200, b: 90, a: 1 };
  const tid = saveMascotTemplate(p, m2, 'My octopus')!;
  const m3 = addMascot(p, p.mascotTemplates!.find((t) => t.id === tid)!);
  it('a saved mascot comes back as a fresh instance of itself', check(
    m3 !== m2 && p.rig.nodes[m3].shapePath === p.rig.nodes[m2].shapePath && p.rig.nodes[m3].color.g === 200 && !!partOf(p.rig, m3, 'eyeR')));
  it('with its own ids, wired to its own body', check(p.rig.nodes[partOf(p.rig, m3, 'eyeL')!].parentId === `${m3}.face` && p.rig.nodes[`${m3}.face`]?.parentId === m3));
}

// --- export: each mascot its own layers ----------------------------------------------------
{
  ed().loadProject(defaultProject());
  const m2 = ed().addMascot('cute');
  ed().addBlock('p_blink', undefined, m2);
  const baked = bakeLottie(ed().project, { background: null, name: 'two' }).json as { layers: { nm: string }[] };
  const names = baked.layers.map((l) => l.nm);
  it('the Lottie has both mascots, each its own layers, named so they can be told apart', check(
    names.includes('Mascot 2') && names.includes('Mascot 2 / Left eye') && names.includes('Body / Left eye'), names.join(' | ')));
  ed().loadProject(defaultProject());
}

// --- labels, retargeting, templates and the odd shapes of a rig ------------------------------------
import { baseRig, ensureFaces, instantiateTemplate, makeMascot, mascotLabel, nextMascotName, retargetId } from './mascot';
import type { RigNode, Timeline } from './types';
{
  const rig = defaultProject().rig;
  const two = (extra: RigNode[]) => ({ ...rig, nodes: { ...rig.nodes, ...Object.fromEntries(extra.map((n) => [n.id, n])) } });
  const m2 = makeMascot('cute', { name: 'Mascot 2', id: 'm2', x: 30, y: 40 });
  const rig2 = two(m2);
  const root = rig.nodes[rig.rootId];
  it('a lone first mascot is "Mascot", beside others "Mascot 1", renamed it keeps its name, others theirs', check(
    mascotLabel(rig, root) === 'Mascot' && mascotLabel(rig2, root) === 'Mascot 1' && mascotLabel(rig, { ...root, name: 'Ada' }) === 'Ada' && mascotLabel(rig2, rig2.nodes.m2) === 'Mascot 2',
  ));
  it('a new mascot takes the first free number', check(nextMascotName(rig) === 'Mascot 2' && nextMascotName(rig2) === 'Mascot 3'));
  it('a mascot made at a spot sits there', check(m2[0].surface.flatOffset!.x === 30 && makeMascot('default', { name: 'x' })[0].surface.flatOffset!.y === 0));

  const tl = { blocks: [{ id: 'b1', mascotId: 'm9' }, { id: 'b2' }], tracks: [] } as unknown as Timeline;
  const tracks = [{ nodeId: 'x', blockId: 'zz' }, { nodeId: 'y' }, { nodeId: 'x', blockId: 'b1' }, { nodeId: 'q', blockId: 'b2' }] as never;
  it('a loose layer plays in the lane of the clip that animates it, whoever the clip belongs to', check(laneOf(undefined, tl, 'x', tracks) === 'm9' && laneOf(undefined, tl, 'q', tracks) === '' && laneOf(undefined, tl, 'nobody', tracks) === ''));
  it('a body is only its own body part', check(partOf(rig, 'body', 'body') === 'body' && partOf(rig, 'eyeL', 'body') === undefined));
  it('a preset\'s own layer is kept apart per mascot, a plain id is left alone', check(retargetId(rig2, 'm2', 'sticker', true) === 'm2:sticker' && retargetId(rig2, 'm2', 'sticker') === 'sticker' && retargetId(rig2, 'm2', 'eyeL') === 'm2.eyeL'));

  // faces made for bodies that have none
  const eye = (id: string, parent: string, z?: number): RigNode => ({ ...makeMascot('default', { name: 'n', id: 'tmp' })[2], id, parentId: parent, zIndex: z as number, role: undefined });
  const lone = (): Record<string, RigNode> => ({ b: { ...makeMascot('default', { name: 'n', id: 'b' })[0] }, e1: eye('e1', 'b'), e2: eye('e2', 'b', 3) });
  const a = lone(); ensureFaces(a, 'b');
  it('a body with eyes and no face gets one, the eyes move into it', check(a.face?.role === 'face' && a.e1.parentId === 'face' && a.face.zIndex === 0));
  const b = lone(); ensureFaces(b);
  it('not the root: the face is named for its body', check(!!b['b.face'] && b.e2.parentId === 'b.face'));
  const c = lone(); c['b.face'] = eye('b.face', 'zzz'); ensureFaces(c);
  it('a taken id is left alone', check(c.e1.parentId === 'b'));
  const d = lone(); d.face = eye('face', 'zzz'); ensureFaces(d, 'b');
  it('and the root falls back to a prefixed id when "face" is taken', check(!!d['b.face']));

  // saved mascots as templates
  const tpl = makeMascot('default', { name: 'T', id: 'src' });
  tpl[2].eye!.linkedToId = 'src.eyeR'; tpl[3].eye!.linkedToId = 'gone'; delete tpl[3].role;
  const inst = instantiateTemplate(tpl, { name: 'Copy', x: 5, y: 6 });
  it('a template becomes new nodes wired to each other, links to nothing cleared, no role gets a made-up one', check(
    inst[0].name === 'Copy' && inst[0].surface.flatOffset!.x === 5 && inst[2].eye!.linkedToId === inst[3].id && inst[3].eye!.linkedToId === null && inst[3].id.startsWith(inst[0].id + '.p'),
  ));
  it('at the origin by default; without a body it is nothing', check(instantiateTemplate(tpl, { name: 'x' })[0].surface.flatOffset!.y === 0 && instantiateTemplate([tpl[1]], { name: 'x' }).length === 0));
  it('a rig whose root is not a body has nothing to start from', check(baseRig({ ...rig, rootId: 'eyeL' }).rootId === '' && Object.keys(baseRig({ ...rig, rootId: 'eyeL' }).nodes).length === 0));
}
{
  const rig = defaultProject().rig;
  const m = [...makeMascot('cute', { name: 'Mascot 3', id: 'x' })];
  const crowded = { ...rig, nodes: { ...rig.nodes, ...Object.fromEntries(m.map((n) => [n.id, n])) } };
  it('a taken number is skipped', check(nextMascotName(crowded) === 'Mascot 4'));
}
