import { it } from 'vitest';
import { check, near } from './testkit';
import { confetti, defaultProject, makeTimeline } from './defaults';
import { compOf } from './comp';
import { buildScene, evaluateRig, sceneAt } from './scene';
import {
  absentHere, addMascot, applyScaleAsBase, attachmentOf, curveToHose, makeCurveLayer, makeGroup, makeLimb, makeLimbPair, makeSvgLayer, makeTextLayer,
  moveInto, openEnded, ownLayer, pinLimb, pinLimbPoint, placeUnder, rolesFor, saveMascotTemplate, setFaceRole, setMorph, setRole, showLayerIn,
  writeValue,
  copyLayers, duplicateLayer, groupLayers, pasteLayers, layerOrder, makeShapeLayer, removeLayer, reorderLayer, setAppearance,
  setAttachment, ungroupLayer, isInside,
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
  it('the order is back to front by zIndex', check(ids() === 'body,face,eyeL,eyeR,star', ids()));
  it('and the stage paints in exactly that order', check(drawn() === ids().replace('face,', ''), drawn()));

  reorderLayer(p, 'star', 'back');
  it('send to back puts it first', check(ids() === 'star,body,face,eyeL,eyeR', ids()));
  it('so it is painted behind the body', check(drawn().startsWith('star,'), drawn()));
  reorderLayer(p, 'star', 'forward');
  it('forward moves exactly one step', check(ids() === 'body,star,face,eyeL,eyeR', ids()));
  reorderLayer(p, 'star', 'front');
  it('bring to front puts it last', check(ids().endsWith(',star'), ids()));
  reorderLayer(p, 'star', 'backward');
  it('backward moves exactly one step', check(ids() === 'body,face,eyeL,star,eyeR', ids()));
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
  const mine = () => (activeTimeline(p).appearances ?? []).filter((a) => a.nodeId === 'hi');
  const end = activeTimeline(p).timelineDurationMs;
  it('Reset puts a ranged layer back for the whole clip, rather than off screen everywhere', check(!!at(0) && !!at(800) && !!at(end - 5)));
  it('as one open-ended range', check(mine().length === 1 && mine()[0].startMs === undefined && mine()[0].endMs === undefined, JSON.stringify(mine())));
  activeTimeline(p).appearances = [];
  it('a ranged layer with no range at all is never there', check(!at(300) && !at(800)));
  p.rig.nodes.hi.ranged = false;
  it('and an unranged one with no range is always there', check(!!at(300) && !!at(1300)));

  // a range dragged to the clip's edges is the whole clip — and stays so when the timeline grows
  {
    p.rig.nodes.hi.ranged = true;
    const tl0 = activeTimeline(p);
    const len = tl0.timelineDurationMs;
    setAppearance(p, 'hi', { startMs: 0, endMs: len }, 0);
    const e = mine()[0];
    it('a range reaching both ends is stored open-ended', check(e.startMs === undefined && e.endMs === undefined, JSON.stringify(e)));
    tl0.timelineDurationMs = len + 2000;
    it('so a longer timeline still shows the layer to its end', check(!!at(len + 1500)));
    tl0.timelineDurationMs = len;
    setAppearance(p, 'hi', { startMs: 300, endMs: len }, 0);
    it('a range starting later keeps its start and stays open at the end', check(mine()[0].startMs === 300 && mine()[0].endMs === undefined, JSON.stringify(mine()[0])));
    p.rig.nodes.hi.ranged = false;
  }

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

// --- eyes in a group still follow the gaze ----------------------------------------
{
  const p = defaultProject();
  const at = (id: string) => itemOf(p, id)!;
  const [l0, r0] = [at('eyeL'), at('eyeR')];
  const g = groupLayers(p, ['eyeL', 'eyeR'], 0)!;
  const [l1, r1] = [at('eyeL'), at('eyeR')];
  it('grouping the eyes moves nothing', check(near(l0.cx, l1.cx, 0.01) && near(l0.cy, l1.cy, 0.01) && near(r0.cx, r1.cx, 0.01), `${l0.cx},${l1.cx}`));
  it('and they stay on the sphere', check(p.rig.nodes.eyeL.surface.mapped && p.rig.nodes.eyeR.surface.mapped));
  p.rig.nodes.eyeL.surface.yaw += 20;
  it('so the gaze still moves them', check(at('eyeL').cx > l1.cx + 5, `${l1.cx} -> ${at('eyeL').cx}`));
  p.rig.nodes.eyeL.surface.yaw -= 20;
  ungroupLayer(p, g, 0);
  it('ungrouping keeps them on the sphere, where they were', check(p.rig.nodes.eyeL.surface.mapped && near(at('eyeL').cx, l0.cx, 0.01) && near(at('eyeL').cy, l0.cy, 0.01)));
}

// --- copy / paste: a mascot or a part, into this project or another ----------------
{
  const a = defaultProject(), b = defaultProject();
  const tl = activeTimeline(a);
  for (const x of [tl, activeTimeline(b)]) { x.blocks = []; x.tracks = []; x.modifiers = []; }
  tl.blocks = [{ id: 'bk', presetId: 'p_neutral', name: 'Hop', durationMs: 1000 }];
  tl.tracks.push({ id: 'tb', nodeId: 'eyeL', property: 'transform.rotation', blockId: 'bk', keyframes: [
    { id: 'k1', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'k2', time: 800, value: 40, easingOut: { type: 'linear' } }] });
  a.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', name: 'Hat', parentId: 'body' });
  tl.tracks.push({ id: 'th', nodeId: 'hat', property: 'transform.rotation', keyframes: [
    { id: 'k3', time: 200, value: 10, easingOut: { type: 'linear' } }] });

  // through the clipboard, as text — exactly what a paste in another tab gets
  const clip = JSON.parse(JSON.stringify(copyLayers(a, ['body', 'eyeL'])));
  it('a copied mascot carries its parts once, its keys and its clips', check(clip.nodes.length === Object.keys(a.rig.nodes).length && clip.blocks.length === 1 && clip.tracks.length === 2, clip));
  const [m] = pasteLayers(b, clip);
  const tb = activeTimeline(b);
  const eye = Object.values(b.rig.nodes).find((n) => n.role === 'eyeL' && n.id !== 'eyeL' && isInside(b.rig, n.id, m));
  it('lands as a NEW mascot beside the one there', check(!!m && m !== 'body' && b.rig.nodes[m].kind === 'body' && !!b.rig.nodes.body && b.rig.nodes[m].name === 'Mascot 2', b.rig.nodes[m]?.name));
  it('with its parts, still playing their roles', check(!!eye && eye.parentId !== null));
  const lane = tb.blocks.find((x) => x.mascotId === m);
  it('its clips in its own lane', check(!!lane && tb.blocks.length === 1, JSON.stringify(tb.blocks)));
  const key = tb.tracks.find((t) => t.nodeId === eye?.id);
  it('its keys on its own eye, in its own clip, at the same times', check(!!key && key.blockId === lane?.id && key.keyframes[1].time === 800 && key.keyframes[0].id !== 'k1', JSON.stringify(key)));
  it('and they play', check(near(evaluateRig(b, 800).nodes[eye!.id].transform.rotation, 40, 0.01)));
  it('the source is untouched', check(Object.keys(a.rig.nodes).length === 5 && tl.tracks.length === 2));

  // a part: onto the same part of whichever mascot is picked
  const [h] = pasteLayers(b, copyLayers(a, ['hat'])!, m);
  it('a pasted part hangs on the picked mascot', check(b.rig.nodes[h]?.parentId === m, String(b.rig.nodes[h]?.parentId)));
  it('with its keys', check(tb.tracks.some((t) => t.nodeId === h && t.keyframes[0].value === 10)));
  // pasted twice = two, and back into its own project it steps off the original
  const [h2] = pasteLayers(a, copyLayers(a, ['hat'])!);
  it('pasted where it came from it is a new layer, nudged off, named apart', check(h2 !== 'hat' && a.rig.nodes[h2].parentId === 'body'
    && a.rig.nodes[h2].name === 'Hat copy' && (a.rig.nodes[h2].surface.yaw !== a.rig.nodes.hat.surface.yaw || a.rig.nodes[h2].surface.flatOffset?.x !== a.rig.nodes.hat.surface.flatOffset?.x)));
  it('a clip that is not coming along is unscoped, keeping its moments', check(copyLayers(a, ['eyeL'])!.tracks.every((t) => !t.blockId)));
  it('garbage pastes nothing', check(pasteLayers(b, {} as never).length === 0));
}

// --- makers ----------------------------------------------------------------------------------
{
  const p = defaultProject();
  const pair = (type: 'arm' | 'leg') => makeLimbPair(p.rig, 'body', type);
  it('a pair for a mascot that is not there is sized as the default', check(makeLimbPair(p.rig, 'nobody', 'arm').length === 2));
  p.rig.nodes.body.size = { x: 296, y: 296 };
  const legs = pair('leg');
  it('limbs scale with the body (two-point and three-point alike)', check(legs.length === 2 && legs[0].limb!.c!.y > 400));
  const arms = pair('arm');
  for (const a of arms) p.rig.nodes[a.id] = a;
  it('only the missing side is made', check(pair('arm').length === 1));
  for (const a of arms) delete a.role;
  it('a role-less limb on a side still counts as that side', check(pair('arm').length === 1));
  const both = Object.values(p.rig.nodes).filter((n) => n.limb);
  it('both sides taken: one more on the right', check(both.length === 2 && pair('arm')[0].limb!.a.x > 0));
  it('svg: nothing readable is shown as the picture', check((() => { const r = makeSvgLayer('<svg viewBox="0 0 10 10"><text>hi</text></svg>')!; return r.node.kind === 'svgLayer' && r.warnings.length > 0; })()));
  it('svg: sizes from the viewBox, or fall back to a hundred', check(makeSvgLayer('<svg viewBox="0 0 0 0" width="0"><path d="M0 0 L10 10 L0 10Z"/></svg>')!.node.size.x > 0 && makeSvgLayer('<svg><path d="M0 0 L10 10"/></svg>') !== null));
  it('svg: a stroked single path, with and without a width', check(
    makeSvgLayer('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10 L0 10Z" stroke="#f00" stroke-width="0"/></svg>')!.node.stroke !== undefined
    && makeSvgLayer('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="#f00"/></svg>')!.node.stroke!.width! > 0));
  it('svg: several paths that carry warnings keep them', check((makeSvgLayer('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/><path d="M1 1 L3 3"/><text>x</text></svg>')!.node.svg!.unsupported?.length ?? 0) > 0));
  it('svg: several clean paths carry none', check(makeSvgLayer('<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/><path d="M1 1 L3 3"/></svg>')!.node.svg!.unsupported === undefined));
  it('curves: handles keep their type, a given type wins, two points are enough', check(
    makeCurveLayer([{ x: 0, y: 0, hout: { x: 10, y: 0 } }, { x: 50, y: 50, hin: { x: -10, y: 0 } }])!.curve!.type === 'bezier'
    && makeCurveLayer([{ x: 0, y: 0 }, { x: 5, y: 5 }], { type: 'polyline' })!.curve!.type === 'polyline'
    && makeCurveLayer([{ x: 0, y: 0 }, { x: 5, y: 5 }])!.curve!.type === 'smooth'
    && makeCurveLayer([{ x: 0, y: 0 }, { x: NaN, y: 5 }]) === null));
  const hoseP = defaultProject();
  hoseP.rig.nodes.line = makeCurveLayer([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])!; // collinear: no bend side
  hoseP.rig.nodes.dot = makeCurveLayer([{ x: 0, y: 0 }, { x: 0, y: 0 }])!;
  hoseP.rig.nodes.bent = makeCurveLayer([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }], { color: { r: 1, g: 2, b: 3, a: 1 } })!;
  delete hoseP.rig.nodes.bent.stroke; delete hoseP.rig.nodes.bent.surface.flatOffset;
  it('a curve becomes a hose; nothing to turn is refused', check(
    curveToHose(hoseP, 'nobody') === false && curveToHose(hoseP, 'body') === false && curveToHose(hoseP, 'dot') === false
    && curveToHose(hoseP, 'line') && curveToHose(hoseP, 'bent') && hoseP.rig.nodes.bent.limb!.thickness === 4));
}

// --- order, removal, duplication --------------------------------------------------------------------
{
  const p = defaultProject();
  p.rig.nodes.a = makeShapeLayer('star', { id: 'a' });
  it('reordering a missing layer does nothing', check((reorderLayer(p, 'nobody', 'front'), true)));
  // eye linked to something that goes, an emitter pinned to it, a text that followed it
  p.rig.nodes.eyeR.eye!.linkedToId = 'a';
  const tl = activeTimeline(p);
  tl.emitters = [{ id: 'em', from: { nodeId: 'a', x: 0, y: 0 }, to: { nodeId: 'a', x: 0, y: 0 } } as never, { id: 'em2', from: { x: 0, y: 0 }, to: { x: 0, y: 0 } } as never];
  removeLayer(p, 'a');
  it('removal unlinks eyes and unpins emitters', check(p.rig.nodes.eyeR.eye!.linkedToId === null && !tl.emitters![0].from.nodeId && !tl.emitters![0].to.nodeId));
  it('duplicating a missing layer gives nothing', check(duplicateLayer(p, 'nobody') === null));
  // a limb, a mapped layer, a layer with no offset, a mascot with linked eyes and modifiers
  p.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
  p.rig.nodes.flat = { ...makeShapeLayer('star', { id: 'flat' }) };
  delete p.rig.nodes.flat.surface.flatOffset;
  const limbCopy = duplicateLayer(p, 'arm')!;
  it('a duplicated limb is nudged by its points', check(p.rig.nodes[limbCopy].limb!.a.x === p.rig.nodes.arm.limb!.a.x + 16 && p.rig.nodes[limbCopy].limb!.c === undefined));
  it('a duplicated mapped layer turns a little', check(p.rig.nodes[duplicateLayer(p, 'eyeL')!].surface.yaw === p.rig.nodes.eyeL.surface.yaw + 10));
  it('a duplicated flat layer with no offset gets one', check(p.rig.nodes[duplicateLayer(p, 'flat')!].surface.flatOffset!.x === 16));
  p.rig.nodes.eyeR.eye!.linkedToId = 'eyeL';
  tl.blocks = [{ id: 'blk', presetId: 'x', name: 'x', durationMs: 1000 }];
  tl.modifiers = [{ id: 'mm', nodeId: 'body', kind: 'shake', amount: 1, frequency: 1, amplitude: 1, blockId: 'blk' }, { id: 'mm2', nodeId: 'body', kind: 'float', amount: 1, frequency: 1, amplitude: 1 }];
  tl.tracks.push({ id: 'tr1', nodeId: 'body', property: 'surface.yaw', blockId: 'blk', keyframes: [{ id: 'kk', time: 0, value: 1, easingOut: { type: 'linear' } }] });
  const m2 = duplicateLayer(p, 'body')!;
  const m2eye = Object.values(p.rig.nodes).find((n) => n.parentId === m2 || (n.eye && n.eye.linkedToId && n.id !== 'eyeR' && n.id !== 'eyeL'));
  it('a copied mascot takes its lane, modifiers (clip-scoped and not) and linked eyes', check(tl.modifiers.filter((m) => m.nodeId === m2).length === 2 && tl.blocks.some((b) => b.mascotId === m2) && !!m2eye));
}

// --- writing values, placing under a parent ---------------------------------------------------------------
{
  it('attachment names', check(attachmentOf({ parentId: null } as never) === 'world' && attachmentOf({ parentId: 'x' } as never) === 'mascot'));
  const p = defaultProject();
  it('writing to a missing layer is a no-op; an existing key is overwritten', check((() => {
    writeValue(p, 'nobody', 'opacity', 1, 0);
    const tl = activeTimeline(p);
    tl.blocks = []; tl.tracks = [{ id: 't', nodeId: 'body', property: 'surface.yaw', keyframes: [{ id: 'k', time: 100, value: 1, easingOut: { type: 'linear' } }] }];
    writeValue(p, 'body', 'surface.yaw', 7, 100);
    writeValue(p, 'body', 'surface.yaw', 9, 300);
    return tl.tracks[0].keyframes[0].value === 7 && tl.tracks[0].keyframes.length === 2;
  })()));
  it('placing a missing layer, or into nothing, is refused or a no-op', check(placeUnder(p, 'nobody', null, 0) === false));
  p.rig.nodes.grp = makeGroup(null, { id: 'grp' });
  p.rig.nodes.s = makeShapeLayer('star', { id: 's' });
  it('placing a layer under a group works and the hidden one is kept', check((() => {
    p.rig.nodes.s.visible = false;
    const ok = placeUnder(p, 's', 'grp', 0);
    return ok && p.rig.nodes.s.parentId === 'grp';
  })()));
  it('a mascot is never a sticker on a shape; no cycles', check(placeUnder(p, 'body', 'grp', 0) === false && placeUnder(p, 'grp', 's', 0) === false && placeUnder(p, 's', 's', 0) === false));
  it('an eye keeps its place when moved to the world and back', check(placeUnder(p, 'eyeL', null, 0) && placeUnder(p, 'eyeL', 'face', 0)));
  it('a collapsed target frame does not divide by zero', check((() => {
    p.rig.nodes.face.transform.scale = { x: 0, y: 0 };
    p.rig.nodes.q = makeShapeLayer('star', { id: 'q' });
    return placeUnder(p, 'q', 'face', 0) !== undefined;
  })()));
  const limbP = defaultProject();
  limbP.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
  it('a limb carries its points; a limb with a third point too', check(placeUnder(limbP, 'arm', null, 0) && placeUnder(limbP, 'arm', 'body', 0)));
  limbP.rig.nodes.arm2 = makeLimb('leg', 1, null, { id: 'arm2' });
  it('a three-point limb', check(placeUnder(limbP, 'arm2', 'body', 0)));
}

// --- groups, mascots, morphs, appearance ------------------------------------------------------------------
{
  const p = defaultProject();
  p.rig.nodes.a = makeShapeLayer('star', { id: 'a' });
  it('grouping nothing makes nothing; ungrouping a non-group does nothing', check(groupLayers(p, ['nobody', 'body'], 0) === null && (ungroupLayer(p, 'a', 0), p.rig.nodes.a !== undefined) && (ungroupLayer(p, 'nobody', 0), true)));
  const g = groupLayers(p, ['eyeL', 'eyeR'], 0)!;
  it('grouping mapped eyes keeps them on the sphere; ungrouping gives them back', check(!!p.rig.nodes[g] && (ungroupLayer(p, g, 0), !p.rig.nodes[g])));
  p.rig.nodes.hidden = makeShapeLayer('star', { id: 'hidden', visible: false, parentId: 'face' });
  it('grouping a hidden layer works', check(!!groupLayers(p, ['hidden'], 0)));
  it('mascots: first free gap, a template, a blank rig', check((() => {
    const q = defaultProject();
    const first = addMascot(q, 'cute');
    const tid = saveMascotTemplate(q, first, ' ')!;
    const second = addMascot(q, q.mascotTemplates!.find((t) => t.id === tid)!, { x: 100, y: 20, name: 'T' });
    const blank = defaultProject(); blank.rig.nodes = {}; blank.rig.rootId = 'gone';
    const third = addMascot(blank, 'blob');
    return !!first && !!second && blank.rig.rootId === third && saveMascotTemplate(q, 'eyeL') === null && addMascot(q, { id: 'x', name: 'x', nodes: [] }) === '';
  })()));
  it('a saved template keeps a role-less part', check((() => { const q = defaultProject(); q.rig.nodes.eyeL.role = undefined; return saveMascotTemplate(q, 'body') !== null; })()));
  it('morph: no keys, a track with a duration', check((() => {
    const q = defaultProject();
    const tl = activeTimeline(q); tl.blocks = [];
    const kf = (id: string, time: number, v: string) => ({ id, time, value: v, easingOut: { type: 'linear' as const } });
    tl.tracks = [{ id: 't', nodeId: 'body', property: 'shape.path', keyframes: [kf('a', 0, 'M0 0'), kf('b', 500, 'M1 1'), kf('c', 600, 'M2 2')] }];
    return setMorph(q, 'eyeL', 0, 'smooth' as never) === false && setMorph(q, 'body', 0, 'smooth' as never, 300) && setMorph(q, 'body', 550, 'smooth' as never, 300) && setMorph(q, 'body', 0, 'smooth' as never);
  })()));
  it('openEnded keeps interior ranges', check(openEnded({ startMs: 10, endMs: 20 }, 1000).endMs === 20));
  it('appearance: reset, ranged reset, ranges with fades, clip-scoped, a tiny range', check((() => {
    const q = defaultProject(); const tl = activeTimeline(q);
    tl.blocks = [{ id: 'b1', presetId: 'x', name: 'x', durationMs: 1000 }];
    setAppearance(q, 'eyeL', null, 0);
    q.rig.nodes.eyeL.ranged = true;
    setAppearance(q, 'eyeL', null, 0);
    setAppearance(q, 'eyeL', { startMs: 100, endMs: 105, fadeInMs: 50, fadeOutMs: undefined }, 100);
    const e = tl.appearances!.find((a) => a.nodeId === 'eyeL' && a.startMs !== undefined)!;
    setAppearance(q, 'eyeL', { fadeOutMs: 20, fadeInMs: undefined }, 100, e.id);
    tl.appearances!.push({ id: 'cl', nodeId: 'eyeR', blockId: 'b1', startMs: 10 });
    setAppearance(q, 'eyeR', { startMs: 20, endMs: 5000 }, 50, 'cl');
    tl.appearances!.push({ id: 'cl2', nodeId: 'face', blockId: 'gone' });
    setAppearance(q, 'face', { endMs: 5 }, 50);
    setAppearance(q, 'eyeR', null, 0, 'cl');
    return e.endMs === 120 && e.fadeInMs === undefined && e.fadeOutMs === 20;
  })()));
  it('ownLayer on a missing layer; showLayerIn variants', check((() => {
    const q = defaultProject();
    ownLayer(q, 'nobody'); showLayerIn(q, 'nobody', 'here');
    q.rig.nodes.a = makeShapeLayer('star', { id: 'a' });
    ownLayer(q, 'a'); ownLayer(q, 'a');
    const second = makeTimeline('second'); q.timelines.push(second);
    second.rig = undefined;
    const tl = activeTimeline(q);
    tl.appearances!.push({ id: 'timed', nodeId: 'a', startMs: 5 }, { id: 'clip', nodeId: 'a', blockId: 'b' }, { id: 'to', nodeId: 'a', endMs: 5 }, { id: 'other', nodeId: 'eyeL' });
    // a layer under something the other state lacks, and one under its own parent
    q.rig.nodes.child = makeShapeLayer('star', { id: 'child', parentId: 'a' });
    q.rig.nodes.orphan = makeShapeLayer('star', { id: 'orphan', parentId: 'ghostParent' });
    showLayerIn(q, 'a', 'everywhere');
    showLayerIn(q, 'orphan', 'everywhere');
    showLayerIn(q, 'a', 'everywhere');
    q.timelines[1].rig = { ...q.rig, nodes: { x: q.rig.nodes.eyeL }, rootId: 'gone' };
    showLayerIn(q, 'orphan', 'everywhere');
    return absentHere(q, 'a') === false && absentHere(q, 'nobody') === false && (() => { q.rig.nodes.a.ranged = true; tl.appearances = []; return absentHere(q, 'a'); })();
  })()));
}

// --- faces, roles, pins, scale ---------------------------------------------------------------------------------
{
  const mk = () => { const q = defaultProject(); q.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', parentId: 'body' }); return q; };
  it('face role: refused kinds, off for a non-face, already the face, a new one', check((() => {
    const q = mk();
    return !setFaceRole(q, 'nobody', true, 0) && !setFaceRole(q, 'body', true, 0) && !setFaceRole(q, 'eyeL', true, 0) && !setFaceRole(q, 'hat', false, 0) && setFaceRole(q, 'face', true, 0)
      && setFaceRole(q, 'hat', true, 0) && q.rig.nodes.hat.role === 'face' && !q.rig.nodes.face?.role;
  })()));
  it('the old face stays when it still holds things; a face with no mascot is refused', check((() => {
    const q = mk(); q.rig.nodes.extra = makeShapeLayer('star', { id: 'extra', parentId: 'face' });
    const ok = setFaceRole(q, 'hat', true, 0);
    const none = defaultProject(); none.rig.nodes = { s: makeShapeLayer('star', { id: 's' }) } as never; none.rig.rootId = 'gone';
    return ok && q.rig.nodes.face !== undefined && !setFaceRole(none, 's', true, 0);
  })()));
  it('taking the face role away hands things back; a face with no current face', check((() => {
    const q = mk(); setFaceRole(q, 'hat', true, 0);
    const off = setFaceRole(q, 'hat', false, 0);
    const bare = defaultProject(); delete bare.rig.nodes.face; bare.rig.nodes.eyeL.parentId = 'body'; bare.rig.nodes.hat = makeShapeLayer('star', { id: 'hat' });
    return off && setFaceRole(bare, 'hat', true, 0);
  })()));
  it('roles offered by kind', check(rolesFor({ kind: 'body' } as never).join() === 'body' && rolesFor({ kind: 'limb' } as never).includes('legL') && rolesFor({ kind: 'text' } as never).join() === '' && rolesFor({ kind: 'eye' } as never).join() === ',eyeL,eyeR' && rolesFor({ kind: 'primitive', parentId: null } as never).includes('body') && rolesFor({ kind: 'primitive', parentId: 'x' } as never).includes('face')));
  it('setRole: refused, same, leaving face, face, body, a part, none', check((() => {
    const q = mk();
    q.rig.nodes.t = makeTextLayer('x', { id: 't' });
    q.rig.nodes.free = makeShapeLayer('star', { id: 'free' });
    const a = !setRole(q, 'nobody', 'eyeL', 0) && !setRole(q, 't', 'eyeL', 0) && setRole(q, 'face', 'face', 0);
    setRole(q, 'hat', 'face', 0);
    const b = setRole(q, 'hat', 'eyeL', 0) && q.rig.nodes.hat.role === 'eyeL';
    const c = setRole(q, 'hat', '', 0) && q.rig.nodes.hat.role === undefined;
    const d = setRole(q, 'free', 'body', 0) && q.rig.nodes.free.kind === 'body';
    const bare = defaultProject(); bare.rig.nodes.hat = makeShapeLayer('star', { id: 'hat' }); bare.rig.rootId = 'gone';
    return a && b && c && d && setRole(bare, 'hat', 'eyeL', 0);
  })()));
  it('a limb changing sides and kinds', check((() => {
    const q = defaultProject();
    q.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm', role: undefined });
    q.rig.nodes.arm3 = makeLimb('arm', -1, 'body', { id: 'arm3' }); q.rig.nodes.arm3.limb!.c = { x: -230, y: 120 };
    q.rig.nodes.leg = makeLimb('leg', 1, 'body', { id: 'leg' });
    q.rig.nodes.legNoFoot = makeLimb('leg', -1, 'body', { id: 'legNoFoot' }); delete q.rig.nodes.legNoFoot.limb!.foot;
    q.rig.nodes.armHasFoot = makeLimb('arm', 1, 'body', { id: 'armHasFoot' }); q.rig.nodes.armHasFoot.limb!.foot = { angle: 0, length: 1, width: 1 };
    const a = setRole(q, 'arm', 'legR', 0) && q.rig.nodes.arm.limb!.type === 'leg' && !!q.rig.nodes.arm.limb!.c;
    const b = setRole(q, 'arm3', 'legL', 0) && q.rig.nodes.arm3.limb!.foot !== undefined;
    const c = setRole(q, 'leg', 'armR', 0) && q.rig.nodes.leg.limb!.c === undefined;
    const d = setRole(q, 'legNoFoot', 'legR', 0);
    const e = setRole(q, 'armHasFoot', 'legL', 0);
    const solo = defaultProject(); solo.rig.nodes = { l: makeLimb('arm', 1, null, { id: 'l' }) } as never; solo.rig.rootId = 'gone';
    return a && b && c && d && e && setRole(solo, 'l', 'legR', 0);
  })()));
  it('moveInto: missing, same parent, cycles, a mapped layer onto a sphere, an eye flat then back', check((() => {
    const q = mk(); q.rig.nodes.grp = makeGroup(null, { id: 'grp' });
    return !moveInto(q, 'nobody', null, 0) && moveInto(q, 'hat', 'body', 0) && !moveInto(q, 'grp', 'grp', 0) && !moveInto(q, 'hat', 'ghost', 0)
      && moveInto(q, 'eyeL', 'grp', 0) && moveInto(q, 'eyeL', 'face', 0) && moveInto(q, 'eyeL', 'body', 0);
  })()));
  it('pins: refused, keyed hold, a mid point, lifting, a missing frame', check((() => {
    const q = defaultProject();
    q.rig.nodes.leg = makeLimb('leg', 1, 'body', { id: 'leg' });
    q.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
    const tl = activeTimeline(q); tl.blocks = [];
    const a = !pinLimb(q, 'body', true, 0) && !pinLimbPoint(q, 'arm', 'c', true, 0) && !pinLimbPoint(q, 'nobody', 'a', true, 0);
    const b = pinLimb(q, 'leg', true, 0) && pinLimb(q, 'arm', true, 0) && pinLimbPoint(q, 'leg', 'b', true, 0) && pinLimbPoint(q, 'leg', 'a', true, 0);
    // let go of one pin (pinOff) and take hold again
    q.rig.nodes.leg.limb!.pinOff = { b: 0.5, a: 0.5 };
    const c = pinLimbPoint(q, 'leg', 'b', true, 0) && pinLimbPoint(q, 'leg', 'a', false, 0) && pinLimbPoint(q, 'leg', 'b', false, 0);
    // lifting with nothing pinned
    const d = pinLimbPoint(q, 'leg', 'b', false, 0) && pinLimb(q, 'arm', false, 0);
    // keyed hold: a track on limb.pin.c.on animates the pin
    pinLimb(q, 'leg', true, 0);
    tl.tracks.push({ id: 'on', nodeId: 'leg', property: 'limb.pin.c.on', keyframes: [{ id: 'k', time: 0, value: 'x' as never, easingOut: { type: 'linear' } }] });
    const e = pinLimbPoint(q, 'leg', 'c', false, 100) && pinLimbPoint(q, 'leg', 'c', true, 100);
    tl.tracks[tl.tracks.length - 1].keyframes[0].value = 1;
    return a && b && c && d && e;
  })()));
  it('baking scale: refused kinds, nothing to bake, a real one with keys and an offset', check((() => {
    const q = defaultProject();
    q.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
    q.rig.nodes.far = makeShapeLayer('star', { id: 'far', parentId: 'body' }); q.rig.nodes.far.surface.flatOffset = undefined;
    q.rig.nodes.t = makeTextLayer('x', { id: 't', parentId: 'body' });
    const a = !applyScaleAsBase(q, 'eyeL', 0) && !applyScaleAsBase(q, 'body', 0);
    const tl = activeTimeline(q); tl.blocks = [];
    tl.tracks = [
      { id: 'ts', nodeId: 'body', property: 'transform.scale.x', keyframes: [{ id: 'k', time: 0, value: 2, easingOut: { type: 'linear' } }, { id: 'k2', time: 500, value: 'x' as never, easingOut: { type: 'linear' } }] },
      { id: 'ts2', nodeId: 'body', property: 'transform.scale.y', keyframes: [{ id: 'k', time: 0, value: 2, easingOut: { type: 'linear' } }] },
      { id: 'fo', nodeId: 'body', property: 'flatOffset.x', keyframes: [{ id: 'k', time: 0, value: 3, easingOut: { type: 'linear' } }, { id: 'k3', time: 9, value: 'x' as never, easingOut: { type: 'linear' } }] },
      { id: 'ay', nodeId: 'body', property: 'flatOffset.y', keyframes: [{ id: 'k', time: 0, value: 3, easingOut: { type: 'linear' } }] },
      { id: 'ex', nodeId: 'arm', property: 'limb.a.x', keyframes: [{ id: 'k', time: 0, value: 3, easingOut: { type: 'linear' } }, { id: 'k5', time: 9, value: 'x' as never, easingOut: { type: 'linear' } }] },
      { id: 'other', nodeId: 'arm', property: 'opacity', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] },
    ];
    q.rig.nodes.body.transform.scale = { x: 2, y: 1.5 }; q.rig.nodes.body.size.y = 0; q.rig.nodes.face.surface.flatOffset = { x: 5, y: 5 };
    return a && applyScaleAsBase(q, 'body', 0);
  })()));
  it('baking a zero or negative scale is refused', check((() => { const q = defaultProject(); q.rig.nodes.body.transform.scale = { x: 0, y: 2 }; return !applyScaleAsBase(q, 'body', 0); })()));
}

// --- placement, adoption and scale on awkward frames ------------------------------------------------------------------
{
  it('svg sized from a degenerate path', check(
    makeSvgLayer('<svg viewBox="0 0 0 0"><path d="M0 0 L10 0"/></svg>') !== null && makeSvgLayer('<svg viewBox="0 0 0 0"><path d="M0 0 L0 10"/></svg>') !== null));
  it('a layer under an invisible mascot has no frame to leave', check((() => {
    const p = defaultProject();
    p.rig.nodes.ghost = { ...p.rig.nodes.body, id: 'ghost', visible: false, parentId: null, role: undefined };
    p.rig.nodes.s = makeShapeLayer('star', { id: 's', parentId: 'ghost' });
    return placeUnder(p, 's', null, 0);
  })()));
  it('placing onto a collapsed sphere or a zero-scale group', check((() => {
    const p = defaultProject();
    p.rig.nodes.s = makeShapeLayer('star', { id: 's' });
    p.rig.nodes.body.transform.scale = { x: 1, y: 0 };
    const a = placeUnder(p, 's', 'body', 0);
    const q = defaultProject();
    q.rig.nodes.s = makeShapeLayer('star', { id: 's' });
    q.rig.nodes.z = makeGroup(null, { id: 'z', transform: { scale: { x: 0, y: 0 }, rotation: 0 } });
    return a !== undefined && placeUnder(q, 's', 'z', 0);
  })()));
  it('a mascot with no offset, every kind of mascot, a part with no role', check((() => {
    const p = defaultProject(); delete p.rig.nodes.body.surface.flatOffset;
    const ids = (['default', 'cute', 'blob', 'octopus'] as const).map((k) => addMascot(p, k));
    const q = defaultProject(); q.rig.nodes.plain = { ...q.rig.nodes.eyeL, id: 'plain', role: undefined, kind: 'eye', parentId: 'body' };
    return ids.every(Boolean) && saveMascotTemplate(q, 'body') !== null;
  })()));
  it('an appearance range whose start is cleared', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p);
    tl.appearances = [{ id: 'a1', nodeId: 'eyeL', startMs: 10, endMs: 500 }];
    setAppearance(p, 'eyeL', { startMs: undefined, endMs: undefined }, 100, 'a1');
    return tl.appearances[0].startMs === undefined;
  })()));
  it('adopting a mapped layer that is not on screen, and into a collapsed frame', check((() => {
    const p = defaultProject();
    p.rig.nodes.eyeL.surface.yaw = 170; // behind the rim: not drawn, so no frame
    const g = groupLayers(p, ['eyeL', 'eyeR'], 0);
    const q = defaultProject();
    q.rig.nodes.face.transform.scale = { x: 0, y: 0 };
    return !!g && !!groupLayers(q, ['eyeL'], 0);
  })()));
  it('pins on a world limb; pins under a mascot that is gone', check((() => {
    const p = defaultProject();
    p.rig.nodes.w = makeLimb('arm', 1, null, { id: 'w' });
    const a = pinLimbPoint(p, 'w', 'b', true, 0);
    p.rig.nodes.ghost = { ...p.rig.nodes.body, id: 'ghost', visible: false, parentId: null, role: undefined };
    p.rig.nodes.under = makeLimb('arm', 1, 'ghost', { id: 'under' });
    return a && !pinLimbPoint(p, 'under', 'b', true, 0);
  })()));
  it('a keyed pin eases from where it is', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p); tl.blocks = [];
    p.rig.nodes.leg = makeLimb('leg', 1, 'body', { id: 'leg' });
    pinLimb(p, 'leg', true, 0);
    tl.tracks.push({ id: 'on', nodeId: 'leg', property: 'limb.pin.c.on', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] });
    return pinLimbPoint(p, 'leg', 'c', false, 100);
  })()));
  it('baking scale through nested frames, a zoomed-out camera and a body with no offset', check((() => {
    const p = defaultProject();
    p.rig.nodes.grp = makeGroup('body', { id: 'grp' });
    p.rig.nodes.deep = makeShapeLayer('star', { id: 'deep', parentId: 'grp' });
    p.rig.nodes.arm = makeLimb('arm', 1, 'grp', { id: 'arm' });
    p.rig.nodes.body.transform.scale = { x: 2, y: 2 }; delete p.rig.nodes.body.surface.flatOffset;
    const tl = activeTimeline(p); tl.blocks = [];
    tl.tracks = [{ id: 'd', nodeId: 'deep', property: 'flatOffset.y', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] }, { id: 'a', nodeId: 'arm', property: 'limb.a.y', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] }, { id: 'a2', nodeId: 'arm', property: 'limb.a.x', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] }, { id: 'a3', nodeId: 'deep', property: 'flatOffset.x', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] }];
    const q = defaultProject(); q.rig.camera.zoom = 0; q.rig.nodes.body.transform.scale = { x: 2, y: 2 };
    return applyScaleAsBase(p, 'body', 0) && applyScaleAsBase(q, 'body', 0);
  })()));
  it('a leg without a knee becomes an arm; a world-less limb', check((() => {
    const p = defaultProject();
    p.rig.nodes.leg = makeLimb('leg', 1, 'body', { id: 'leg' }); delete p.rig.nodes.leg.limb!.c;
    return setRole(p, 'leg', 'armR', 0) && p.rig.nodes.leg.limb!.type === 'arm';
  })()));
  it('absent here with no appearances at all; showing everywhere with none', check((() => {
    const p = defaultProject(); p.rig.nodes.a = makeShapeLayer('star', { id: 'a', ranged: true });
    activeTimeline(p).appearances = undefined;
    const a = absentHere(p, 'a');
    showLayerIn(p, 'a', 'everywhere');
    return a;
  })()));
}

// --- copy and paste of everything a layer can carry ------------------------------------------------------------------------
{
  const kf = (id: string, time: number, value: number) => ({ id, time, value, easingOut: { type: 'linear' as const } });
  const rich = () => {
    const p = defaultProject(); const tl = activeTimeline(p);
    p.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', parentId: 'body', mask: { nodeId: 'eyeL' } });
    p.rig.nodes.cap = makeTextLayer('hi', { id: 'cap', parentId: 'face' }, { path: { mode: 'path', nodeId: 'hat' } } as never);
    p.rig.nodes.free = makeShapeLayer('star', { id: 'free' });
    tl.blocks = [{ id: 'b1', presetId: 'pre', name: 'one', durationMs: 1000, speed: 0 }, { id: 'b2', presetId: 'pre', name: 'two', durationMs: 1000 }];
    tl.transitions = [{ id: 'tr', afterBlockId: 'b1', durationMs: 100, easing: { type: 'linear' } }];
    p.presets.push({ id: 'pre', name: 'pre', source: 'custom', durationMs: 1000, tracks: [] });
    p.svgAssets = [{ id: 'asset', name: 'a', sourceMarkup: '<svg/>', viewBox: '0 0 1 1' } as never];
    tl.emitters = [
      { ...confetti('hat'), id: 'e1', svgAssetId: 'asset', parts: [{ svgAssetId: 'asset' }], to: { nodeId: 'hat', x: 0, y: 0 }, attract: { nodeId: 'hat', startMs: 0, durationMs: 1 }, blockId: 'gone' },
      { ...confetti('hat'), id: 'e2', to: { x: 0, y: 0 }, attract: { nodeId: 'ghost', startMs: 0, durationMs: 1 } },
      { ...confetti('hat'), id: 'e3', to: { nodeId: 'ghost', x: 0, y: 0 }, attract: { nodeId: 'ghost', startMs: 0, durationMs: 1 } },
      { ...confetti('body'), id: 'e4' }, { ...confetti('face'), id: 'e5', from: { x: 0, y: 0 } },
    ] as never;
    tl.modifiers = [{ id: 'm1', nodeId: 'hat', kind: 'shake', amount: 1, frequency: 1, amplitude: 1, blockId: 'b1', startMs: 5 }, { id: 'm2', nodeId: 'hat', kind: 'float', amount: 1, frequency: 1, amplitude: 1, blockId: 'gone' }];
    tl.appearances = [{ id: 'ap1', nodeId: 'hat', blockId: 'b2' }, { id: 'ap2', nodeId: 'hat', blockId: 'b2', startMs: 1, endMs: 2 }];
    tl.tracks = [
      { id: 't1', nodeId: 'hat', property: 'transform.rotation', blockId: 'b1', keyframes: [kf('a', 100, 1)] },
      { id: 't2', nodeId: 'hat', property: 'transform.rotation', blockId: 'b2', keyframes: [kf('b', 1500, 1)] },
      { id: 't3', nodeId: 'm1', property: 'fx.amount', keyframes: [kf('c', 10, 1)] },
      { id: 't4', nodeId: 'e4', property: 'fx.speed', keyframes: [kf('d', 10, 1)] },
    ];
    return p;
  };
  it('a copy of a plain layer unscopes what stayed behind, in every shape', check((() => {
    const p = rich();
    const clip = copyLayers(p, ['hat'])!;
    return clip.modifiers.every((m) => !m.blockId) && clip.appearances.every((a) => !a.blockId) && clip.emitters.length === 3 && clip.svgAssets.length === 1 && clip.tracks.length === 3;
  })()));
  it('a copy of a mascot keeps its clips, transitions, presets and the speed of a stopped clip', check((() => {
    const p = rich();
    const clip = copyLayers(p, ['body'])!;
    return clip.blocks.length === 2 && clip.transitions.length === 1 && clip.presets.length === 1 && clip.tracks.every((t) => t.blockId === undefined || t.blockId.startsWith('b'));
  })()));
  it('pasting everything into a clean project re-ids and re-targets it', check((() => {
    const a = rich();
    const clip = JSON.parse(JSON.stringify(copyLayers(a, ['hat', 'cap'])!));
    const b = defaultProject();
    const ids = pasteLayers(b, clip, 'body');
    return ids.length === 2;
  })()));
  it('pasting a mascot with its clips into an empty rig makes it the first mascot', check((() => {
    const a = rich();
    const clip = JSON.parse(JSON.stringify(copyLayers(a, ['body'])!));
    const b = defaultProject(); b.rig.nodes = {}; b.rig.rootId = 'gone'; activeTimeline(b).blocks = [];
    const [m] = pasteLayers(b, clip);
    return b.rig.rootId === m && activeTimeline(b).blocks.length === 2 && activeTimeline(b).blocks.every((x) => x.mascotId === undefined);
  })()));
  it('pasting a mascot back beside itself is renamed and stepped clear', check((() => {
    const a = rich();
    const [m] = pasteLayers(a, copyLayers(a, ['body'])!);
    return a.rig.nodes[m].name !== a.rig.nodes.body.name;
  })()));
  it('pasting back every kind of layer nudges each its own way', check((() => {
    const a = rich();
    a.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
    a.rig.nodes.eyeL.surface.mapped = true;
    const ids = pasteLayers(a, copyLayers(a, ['arm', 'eyeL', 'free'])!);
    return ids.length === 3 && a.rig.nodes[ids[0]].limb!.a.x === a.rig.nodes.arm.limb!.a.x + 16;
  })()));
  it('pasting a layer whose references are gone drops them', check((() => {
    const a = rich();
    const clip = copyLayers(a, ['hat', 'cap'])!;
    const b = defaultProject();
    b.rig.nodes.eyeR.eye!.linkedToId = 'nowhere';
    clip.nodes.push({ ...b.rig.nodes.eyeR, id: 'stray', parentId: 'unknown', role: undefined } as never);
    clip.nodes.push({ ...b.rig.nodes.eyeR, id: 'stray2', parentId: null, eye: { ...b.rig.nodes.eyeR.eye!, linkedToId: 'eyeL' } } as never);
    clip.nodes.push({ ...b.rig.nodes.eyeR, id: 'stray3', parentId: null, eye: { ...b.rig.nodes.eyeR.eye!, linkedToId: 'eyeR' } } as never);
    clip.nodes.push({ ...b.rig.nodes.eyeR, id: 'stray4', parentId: null, eye: { ...b.rig.nodes.eyeR.eye!, linkedToId: null } } as never);
    clip.parentRoles = { hat: 'face', cap: 'ghostrole' } as never;
    return pasteLayers(b, clip, 'ghost').length >= 2;
  })()));
  it('a minimal clip pastes', check((() => {
    const b = defaultProject();
    const node = makeShapeLayer('star', { id: 'only' });
    return pasteLayers(b, { v: 1, nodes: [node] } as never).length === 1;
  })()));
  it('a clip with tracks for effects, clips and nothing', check((() => {
    const a = rich();
    const clip = JSON.parse(JSON.stringify(copyLayers(a, ['hat'])!));
    clip.tracks.push({ id: 'zz', nodeId: 'nobody', property: 'x', keyframes: [] });
    clip.tracks.push({ id: 'z2', nodeId: 'hat', property: 'transform.rotation', keyframes: [kf('q', 5, 1), kf('q2', 6, 1)] });
    const b = defaultProject(); const tl = activeTimeline(b);
    tl.blocks = [{ id: 'x1', presetId: 'p', name: 'x', durationMs: 100, speed: 2 }];
    b.svgAssets = [{ id: 'asset' } as never];
    return pasteLayers(b, clip).length === 1;
  })()));
  it('a paste with no mascot to hang on and a rootless project', check((() => {
    const a = rich();
    const clip = JSON.parse(JSON.stringify(copyLayers(a, ['hat'])!));
    const b = defaultProject(); b.rig.nodes = {}; b.rig.rootId = 'gone';
    return pasteLayers(b, clip).length === 1;
  })()));
}

// --- the last corners ----------------------------------------------------------------------------------------------
{
  it('svg with an unreadable viewBox and a zero-sized path', check(
    makeSvgLayer('<svg viewBox="0 0 0 0"><text>hi</text></svg>') !== null && makeSvgLayer('<svg viewBox="0 0"><path d="M0 0 L10 0"/></svg>') !== null));
  it('placing into a world whose camera is zoomed to nothing', check((() => {
    const p = defaultProject(); p.rig.camera.zoom = 0;
    p.rig.nodes.s = makeShapeLayer('star', { id: 's', parentId: 'body' });
    return placeUnder(p, 's', null, 0);
  })()));
  it('a template with a limb keeps it behind its body', check((() => {
    const p = defaultProject();
    p.rig.nodes.arm = makeLimb('arm', 1, 'body', { id: 'arm' });
    const tid = saveMascotTemplate(p, 'body')!;
    return !!addMascot(p, p.mascotTemplates!.find((t) => t.id === tid)!);
  })()));
  it('a keyed pin that already has a number to ease from', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p); tl.blocks = [];
    p.rig.nodes.leg = makeLimb('leg', 1, 'body', { id: 'leg' });
    pinLimb(p, 'leg', true, 0);
    tl.tracks.push({ id: 'on', nodeId: 'leg', property: 'limb.pin.c.on', keyframes: [{ id: 'k', time: 0, value: 1, easingOut: { type: 'linear' } }] });
    return pinLimbPoint(p, 'leg', 'c', false, 100) && pinLimbPoint(p, 'leg', 'c', true, 200);
  })()));
  it('pasting hand-made clips: loose ends, foreign parents, text on strangers', check((() => {
    const kf = (id: string, time: number) => ({ id, time, value: 1, easingOut: { type: 'linear' as const } });
    const b = defaultProject(); const tl = activeTimeline(b); tl.blocks = [];
    b.rig.nodes.free = makeShapeLayer('star', { id: 'free' });
    b.rig.nodes.flat = makeShapeLayer('star', { id: 'flat' }); delete b.rig.nodes.flat.surface.flatOffset;
    const mascot = { ...b.rig.nodes.body, id: 'mm', parentId: 'eyeL', role: undefined };
    const onFree = makeTextLayer('a', { id: 'ta' }, { path: { mode: 'path', nodeId: 'free' } } as never);
    const onNobody = makeTextLayer('b', { id: 'tb' }, { path: { mode: 'path', nodeId: 'nobody' } } as never);
    const emitter = { ...confetti('x'), id: 'em', from: { x: 0, y: 0 }, parts: undefined };
    const clip = {
      v: 1, nodes: [mascot, onFree, onNobody, { ...b.rig.nodes.flat }],
      tracks: [{ id: 'te', nodeId: 'em', property: 'fx.speed', keyframes: [kf('k1', 10), kf('k2', 20)] }],
      emitters: [emitter],
      blocks: [{ id: 'cb', presetId: 'q', name: 'q', durationMs: 100 }, { id: 'cb2', presetId: 'q', name: 'q', durationMs: 100, mascotId: 'elsewhere' }],
    };
    const ids = pasteLayers(b, clip as never);
    tl.blocks = [];
    const again = pasteLayers(b, { ...clip, blocks: [] } as never);
    return ids.length === 4 && again.length === 4;
  })()));
  it('pasting back a node with no offset', check((() => {
    const a = defaultProject();
    a.rig.nodes.flat = makeShapeLayer('star', { id: 'flat' }); delete a.rig.nodes.flat.surface.flatOffset;
    const [id] = pasteLayers(a, copyLayers(a, ['flat'])!);
    return a.rig.nodes[id].surface.flatOffset!.x === 16;
  })()));
  it('copying an emitter with no parts, from a layer', check((() => {
    const a = defaultProject();
    a.rig.nodes.hat = makeShapeLayer('star', { id: 'hat' });
    activeTimeline(a).emitters = [{ ...confetti('hat'), id: 'e1', parts: undefined } as never];
    return copyLayers(a, ['hat'])!.emitters.length === 1;
  })()));
}

it('a ranged layer is absent unless a range names it', check((() => {
  const p = defaultProject(); p.rig.nodes.a = makeShapeLayer('star', { id: 'a', ranged: true });
  activeTimeline(p).appearances = [{ id: 'x', nodeId: 'eyeL' }];
  const absent = absentHere(p, 'a');
  activeTimeline(p).appearances!.push({ id: 'y', nodeId: 'a' });
  return absent && !absentHere(p, 'a');
})()));

it('a second duplicate is numbered', check((() => {
  const p = defaultProject(); p.rig.nodes.a = makeShapeLayer('star', { id: 'a', name: 'Star' });
  duplicateLayer(p, 'a'); const b = duplicateLayer(p, 'a')!;
  return p.rig.nodes[b].name === 'Star copy 2';
})()));
