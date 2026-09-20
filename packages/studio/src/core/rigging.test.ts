import { it } from 'vitest';
import { check, near } from './testkit';
import { defaultProject, effectPreviewProject, makeTimeline, presetPreviewProject } from './defaults';
import { compOf } from './comp';
import { buildScene, evaluateRig, sceneAt, sceneFrames, valueAt, WORLD } from './scene';
import { applyPose } from './poses';
import { limbPoints as limbPointsOf } from './limb';
import { applyScaleAsBase, moveInto, setRole, makeCurveLayer, makeLimb, makeLimbPair, makeShapeLayer, ownLayer, pinLimb, removeLayer, setFaceRole } from './layers';
import { faceOf, mascotOf } from './mascot';
import { applyEyeAction, applySquish, SQUISH_PRESETS } from './squish';
import { migrateProject } from './migrate';
import { useEditor } from './store';
import { applyEasing } from './easing';
import { activeTimeline, asTimeline, rigOf, type Project } from './types';

const itemOf = (p: Project, id: string, t = 0) => buildScene(evaluateRig(p, t), compOf(p)).find((s) => s.id === id);

// --- anchor: transforms pivot about it, and moving it moves nothing --------------------
{
  const p = defaultProject();
  p.rig.nodes.box = makeShapeLayer('rect', { id: 'box', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } } });
  const rest = itemOf(p, 'box')!;
  p.rig.nodes.box.anchor = { x: 0, y: 48 };
  const moved = itemOf(p, 'box')!;
  it('an anchor alone moves nothing', check(near(rest.cx, moved.cx) && near(rest.cy, moved.cy)));
  p.rig.nodes.box.transform.rotation = 90;
  const turned = itemOf(p, 'box')!;
  // turning 90° about a point 48px below the centre swings the centre to the left of that point
  it('a roll swings round the anchor, not the centre', check(near(turned.cx, rest.cx + 48, 1e-6) && near(turned.cy, rest.cy + 48, 1e-6), `${turned.cx},${turned.cy}`));
  p.rig.nodes.box.transform.rotation = 0;
  p.rig.nodes.box.transform.scale = { x: 1, y: 0.5 };
  const squat = itemOf(p, 'box')!;
  it('scale keeps the anchor where it is — the bottom stays on the ground', check(near(squat.cy + squat.h / 2, rest.cy + rest.h / 2, 1e-6), `${squat.cy} ${squat.h}`));
}

// --- squish: its own dial, multiplied onto scale, clamped ------------------------------
{
  const p = defaultProject();
  const rest = itemOf(p, 'body')!;
  p.rig.nodes.body.squish = { x: 1.1, y: 0.9 };
  const sq = itemOf(p, 'body')!;
  it('squish x widens the body', check(near(sq.w, rest.w * 1.1, 1e-6)));
  it('squish y flattens it', check(near(sq.h, rest.h * 0.9, 1e-6)));
  p.rig.nodes.body.transform.scale = { x: 2, y: 1 };
  it('and multiplies onto scale rather than replacing it', check(near(itemOf(p, 'body')!.w, rest.w * 2.2, 1e-6)));
  p.rig.nodes.body.transform.scale = { x: 1, y: 1 };
  p.rig.nodes.body.squish = { x: 50, y: -3 };
  const wild = itemOf(p, 'body')!;
  it('an extreme squish is clamped, so it cannot break the mascot', check(near(wild.w, rest.w * 1.8, 1e-6) && near(wild.h, rest.h * 0.4, 1e-6)));
  it('the eyes still draw', check(!!itemOf(p, 'eyeL') && !!itemOf(p, 'eyeR')));
}

// --- squish animates, and a squish preset lands at the playhead ------------------------
{
  const p = defaultProject();
  const tl = activeTimeline(p);
  const before = tl.tracks.length;
  const keysElsewhere = tl.tracks.reduce((n, t) => n + t.keyframes.length, 0);
  applySquish(p, 'body', 'landing', 1250);
  const sx = activeTimeline(p).tracks.filter((t) => t.nodeId === 'body' && t.property === 'squish.x').flatMap((t) => t.keyframes);
  const land = SQUISH_PRESETS.find((s) => s.id === 'landing')!;
  it('a squish preset writes squish keys', check(sx.length >= land.keys.length, String(sx.length)));
  it('starting at the playhead', check(sx.some((k) => near(k.time, 1250)) && sx.some((k) => near(k.time, 1350)), sx.map((k) => k.time).join()));
  it('with the preset\'s own values', check(near(valueAt(p, 'body', 'squish.x', 1350) as number, 1.18, 1e-6)));
  it('and nothing else touched', check(activeTimeline(p).tracks.filter((t) => t.property !== 'squish.x' && t.property !== 'squish.y').reduce((n, t) => n + t.keyframes.length, 0) === keysElsewhere && activeTimeline(p).tracks.length >= before));
  const k = sx.find((x) => near(x.time, 1350))!;
  k.value = 1.3;
  it('the result is plain keyframes, editable afterwards', check(near(valueAt(p, 'body', 'squish.x', 1350) as number, 1.3, 1e-6)));
  it('an unknown preset does nothing', check(!applySquish(p, 'body', 'nope', 0)));
}

// --- curve offsets: trim start/end ------------------------------------------------------
{
  const p = defaultProject();
  const c = makeCurveLayer([{ x: -100, y: 0 }, { x: 0, y: -60 }, { x: 100, y: 0 }], { name: 'Curve' })!;
  p.rig.nodes[c.id] = c;
  it('a whole curve carries no trim', check(itemOf(p, c.id)!.trim === undefined));
  const ed = useEditor.getState();
  ed.loadProject(p);
  ed.setPlayhead(0);
  useEditor.setState({ autoKey: true });
  ed.setValue(c.id, 'trim.end', 0);
  ed.setPlayhead(800);
  ed.setValue(c.id, 'trim.end', 1);
  const q = useEditor.getState().project;
  const mid = sceneAt(q, 400, compOf(q)).find((s) => s.id === c.id)!;
  it('trim.end animates: half way through a draw-on part of the line shows', check(!!mid.trim && mid.trim.end > 0 && mid.trim.end < 1, JSON.stringify(mid.trim)));
  it('and the easing shapes it', check(near(mid.trim!.end, applyEasing({ type: 'preset', name: 'easeInOut' }, 0.5), 1e-6), String(mid.trim!.end)));
  it('the end of the draw-on is the whole line', check(sceneAt(q, 800, compOf(q)).find((s) => s.id === c.id)!.trim === undefined));
  q.rig.nodes[c.id].trim = { start: 0.8, end: 0.2 };
  const rev = itemOf({ ...q, timelines: [makeTimeline('x')], activeTimelineId: '' }, c.id)!;
  it('start > end is kept as it is — a reversed span, not an error', check(rev.trim?.start === 0.8 && rev.trim?.end === 0.2, JSON.stringify(rev.trim)));
  useEditor.setState({ autoKey: false });
}

// --- the face: a real layer ------------------------------------------------------------
{
  const p = defaultProject();
  it('a new project has a face', check(faceOf(p.rig, 'body') === 'face'));
  it('the eyes live in it', check(p.rig.nodes.eyeL.parentId === 'face' && p.rig.nodes.eyeR.parentId === 'face'));
  it('and still belong to the mascot', check(mascotOf(p.rig, 'eyeL')?.id === 'body'));
  const eye0 = itemOf(p, 'eyeL')!;
  const body0 = itemOf(p, 'body')!;
  p.rig.nodes.face.surface.flatOffset = { x: 20, y: -10 };
  const eye1 = itemOf(p, 'eyeL')!;
  it('moving the face moves the eyes', check(near(eye1.cx - eye0.cx, 20, 1e-6) && near(eye1.cy - eye0.cy, -10, 1e-6), `${eye1.cx - eye0.cx},${eye1.cy - eye0.cy}`));
  it('and the head drawing with them — the head belongs to the face', check(near(itemOf(p, 'body')!.cx - body0.cx, 20, 1e-6) && near(itemOf(p, 'body')!.cy - body0.cy, -10, 1e-6)));
  const frames = sceneFrames(evaluateRig(p, 0), compOf(p));
  it('while the mascot\'s own frame — what legs ride — stays put', check(near(frames.get('body')!.x, body0.cx) && near(frames.get('body')!.y, body0.cy)));
  p.rig.nodes.face.transform.scale = { x: 1.2, y: 1.2 };
  it('scaling the face scales the head', check(near(itemOf(p, 'body')!.w, body0.w * 1.2, 1e-6)));
  p.rig.nodes.face.transform.scale = { x: 1, y: 1 };
  p.rig.nodes.face.surface.flatOffset = { x: 0, y: 0 };
  p.rig.nodes.face.surface.yaw = 30;
  const look = itemOf(p, 'eyeL')!;
  it('turning the face makes the eyes look round the sphere', check(look.cx > eye0.cx + 10, `${look.cx} vs ${eye0.cx}`));
  it('the body does not turn with it', check(p.rig.nodes.body.surface.yaw === 0));
  p.rig.nodes.face.surface.yaw = 0;
  p.rig.nodes.body.transform.rotation = 20;
  p.rig.nodes.face.transform.rotation = -20;
  const upright = itemOf(p, 'eyeL')!;
  it('the face animates apart from the body: a counter-roll keeps the eyes level', check(near(upright.rotation, 0, 1e-6)));
  p.rig.nodes.body.transform.rotation = 0; p.rig.nodes.face.transform.rotation = 0;

  removeLayer(p, 'face');
  it('deleting the face keeps the mascot', check(!!p.rig.nodes.body && !!itemOf(p, 'body')));
  it('and takes its eyes with it', check(!p.rig.nodes.eyeL && !p.rig.nodes.eyeR));
  it('leaving nothing pointing at it', check(!activeTimeline(p).tracks.some((t) => t.nodeId === 'face' || t.nodeId === 'eyeL')));
  it('the project still renders', check(sceneAt(p, 500, compOf(p)).length > 0));
}

// --- any shape can be the face ---------------------------------------------------------
{
  const p = defaultProject();
  p.rig.nodes.plate = makeShapeLayer('circle', { id: 'plate', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 10, y: -12 } } });
  const before = itemOf(p, 'eyeL')!;
  it('a shape can be made the face', check(setFaceRole(p, 'plate', true, 0)));
  it('it goes onto the mascot', check(p.rig.nodes.plate.parentId === 'body' && p.rig.nodes.plate.role === 'face'));
  it('and takes the eyes', check(p.rig.nodes.eyeL.parentId === 'plate' && p.rig.nodes.eyeR.parentId === 'plate'));
  it('the old face group is gone', check(!p.rig.nodes.face));
  const after = itemOf(p, 'eyeL')!;
  it('nothing moved on screen', check(near(before.cx, after.cx, 0.02) && near(before.cy, after.cy, 0.02), `${before.cx},${before.cy} → ${after.cx},${after.cy}`));
  it('the eyes still ride the sphere', check(p.rig.nodes.eyeL.surface.mapped));
  p.rig.nodes.plate.surface.flatOffset = { x: 40, y: -12 };
  it('moving the shape moves the eyes', check(near(itemOf(p, 'eyeL')!.cx - after.cx, 30, 0.05), String(itemOf(p, 'eyeL')!.cx - after.cx)));
  p.rig.nodes.plate.surface.flatOffset = { x: 10, y: -12 };
  it('the role can be taken away again', check(setFaceRole(p, 'plate', false, 0) && p.rig.nodes.eyeL.parentId === 'body' && !p.rig.nodes.plate.role));
  it('and the eyes stay put', check(near(itemOf(p, 'eyeL')!.cx, before.cx, 0.05)));
  it('a text cannot be a face', check(!setFaceRole(p, 'nope', true, 0)));
}

// --- pinned feet -----------------------------------------------------------------------
{
  const p = defaultProject();
  const leg = makeLimb('leg', 1, 'body', { id: 'legR' });
  p.rig.nodes.legR = leg;
  const footOf = (q: Project) => {
    const it2 = buildScene(evaluateRig(q, 0), compOf(q)).find((s) => s.id === 'legR')!;
    return { x: it2.cx, y: it2.cy + it2.h / 2 };
  };
  const endOf = (q: Project) => {
    const f = sceneFrames(evaluateRig(q, 0), compOf(q));
    const l = q.rig.nodes.legR.limb!;
    const e = l.c ?? l.b; const bf = f.get('body')!;
    return l.pin ? { x: f.get(WORLD)!.x + l.pin.x, y: f.get(WORLD)!.y + l.pin.y } : { x: bf.x + e.x * bf.kx, y: bf.y + e.y * bf.ky };
  };
  it('a leg can be pinned', check(pinLimb(p, 'legR', true, 0) && !!p.rig.nodes.legR.limb!.pin));
  const planted = endOf(p);
  const bottom0 = footOf(p).y;
  p.rig.nodes.body.surface.flatOffset = { x: 60, y: -40 };
  p.rig.nodes.body.transform.rotation = 15;
  p.rig.nodes.body.squish = { x: 1.15, y: 0.85 };
  const moved = endOf(p);
  it('the pin stays where it was planted whatever the body does', check(near(planted.x, moved.x) && near(planted.y, moved.y)));
  it('the leg is still drawn, reaching down to it', check(Math.abs(footOf(p).y - bottom0) < 30, `${footOf(p).y} vs ${bottom0}`));
  // unpinning writes the pose back: the drawn outline does not jump
  const drawn = itemOf(p, 'legR')!;
  it('it can be unpinned', check(pinLimb(p, 'legR', false, 0) && !p.rig.nodes.legR.limb!.pin));
  const after = itemOf(p, 'legR')!;
  it('without a jump', check(near(drawn.cx, after.cx, 0.1) && near(drawn.cy, after.cy, 0.1) && near(drawn.h, after.h, 0.2), `${drawn.cx},${drawn.cy},${drawn.h} → ${after.cx},${after.cy},${after.h}`));
  p.rig.nodes.body.surface.flatOffset = { x: 0, y: 0 };
  it('and then follows the body again', check(!near(itemOf(p, 'legR')!.cx, after.cx, 1)));
}

// --- a layer belongs to the state it was made in ---------------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  ed.addTimeline('Happy', { copyLayers: true });
  const happy = useEditor.getState().project.activeTimelineId;
  ed.addLayer(makeLimb('arm', 1, 'body', { id: 'wave' }));
  ed.addLayer(makeShapeLayer('star', { id: 'star1' }));
  const p = useEditor.getState().project;
  const shown = (id: string, tlId: string) => !!sceneAt(asTimeline(p, tlId), 100, compOf(p)).find((s) => s.id === id);
  const idle = p.timelines.find((t) => t.id !== happy)!.id;
  it('a hand made in Happy is on screen in Happy', check(shown('wave', happy)));
  it('and not in Idle', check(!shown('wave', idle)));
  it('same for a shape', check(shown('star1', happy) && !shown('star1', idle)));
  it('Idle does not even hold it: its layers are its own', check(!rigOf(p, p.timelines.find((t) => t.id === idle)!).nodes.star1));
  // copying the layers copied them: moving the body in Happy leaves Idle's where it was
  ed.setValue('body', 'flatOffset.x', 120, 'move');
  const q = useEditor.getState().project;
  it('changing a layer in one state never changes it in another', check(rigOf(q, q.timelines.find((t) => t.id === idle)!).nodes.body.surface.flatOffset?.x !== 120));
  const r = structuredClone(p);
  ownLayer(r, 'star1');
  it('owning twice adds no second range', check(activeTimeline(r).appearances!.filter((a) => a.nodeId === 'star1').length === 1));
}

// --- scale → base size: nothing moves, scale reads 1 ------------------------------------
{
  const p = defaultProject();
  for (const n of [...makeLimbPair(p.rig, 'body', 'arm'), ...makeLimbPair(p.rig, 'body', 'leg')]) p.rig.nodes[n.id] = n;
  p.rig.nodes.hat = makeShapeLayer('star', { id: 'hat', parentId: 'body', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 30, y: -170 } } });
  p.rig.nodes.face.surface.flatOffset = { x: 6, y: -4 };
  p.rig.nodes.body.anchor = { x: 0, y: 148 };
  p.rig.nodes.body.transform.scale = { x: 1.3, y: 1.1 };
  const draw = (q: Project) => buildScene(evaluateRig(q, 0), compOf(q)).map((s) => [s.id, s.cx, s.cy, s.w, s.h]);
  const before = draw(p);
  it('a scaled mascot bakes its scale into its size', check(applyScaleAsBase(p, 'body', 0)));
  it('scale reads 1 again', check(near(p.rig.nodes.body.transform.scale.x, 1) && near(p.rig.nodes.body.transform.scale.y, 1)));
  const after = draw(p);
  const worst = Math.max(...before.map((b, i) => Math.max(...[1, 2, 3, 4].map((j) => Math.abs((b[j] as number) - (after[i][j] as number))))));
  it('and every layer — body, face, eyes, hands, legs, a hat — is drawn where it was', check(before.length === after.length && worst < 0.2, `worst ${worst}`));
  it('baking at scale 1 does nothing', check(!applyScaleAsBase(p, 'body', 0)));
}

// --- moving layers between groups, and limbs onto any part -----------------------------
{
  const p = defaultProject();
  for (const n of makeLimbPair(p.rig, 'body', 'arm')) p.rig.nodes[n.id] = n;
  p.rig.nodes.star = makeShapeLayer('star', { id: 'star', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 40, y: -40 } } });
  const at = (id: string) => buildScene(evaluateRig(p, 0), compOf(p)).find((s) => s.id === id)!;
  const s0 = at('star'), e0 = at('eyeL');
  it('a world shape moves into the face', check(moveInto(p, 'star', 'face', 0) && p.rig.nodes.star.parentId === 'face'));
  it('without moving on screen', check(near(at('star').cx, s0.cx, 0.05) && near(at('star').cy, s0.cy, 0.05)));
  p.rig.nodes.face.surface.flatOffset = { x: 25, y: 0 };
  it('and now rides the face', check(near(at('star').cx - s0.cx, 25, 0.05)));
  p.rig.nodes.face.surface.flatOffset = { x: 0, y: 0 };
  it('an eye moves into the shape, staying on the sphere and in place', check(moveInto(p, 'eyeL', 'star', 0) && p.rig.nodes.eyeL.parentId === 'star' && near(at('eyeL').cx, e0.cx, 0.1)));
  it('a move that would make a cycle is refused', check(!moveInto(p, 'star', 'eyeL', 0)));
  const arm = Object.values(p.rig.nodes).find((n) => n.role === 'armR')!;
  const a0 = at(arm.id);
  it('a hand can be attached to the star', check(moveInto(p, arm.id, 'star', 0) && p.rig.nodes[arm.id].parentId === 'star'));
  it('its outline unmoved', check(near(at(arm.id).cx, a0.cx, 0.2) && near(at(arm.id).cy, a0.cy, 0.2)));
  p.rig.nodes.star.surface.flatOffset = { x: (p.rig.nodes.star.surface.flatOffset?.x ?? 0) + 30, y: p.rig.nodes.star.surface.flatOffset?.y ?? 0 };
  it('and then follows it', check(near(at(arm.id).cx - a0.cx, 30, 1)));
  it('moving out to the world keeps it in place', check((() => { const b = at(arm.id); return moveInto(p, arm.id, null, 0) && p.rig.nodes[arm.id].parentId === null && near(at(arm.id).cx, b.cx, 0.2); })()));
}

// --- poses, elbows, and layers from other states ---------------------------------------
{
  const p = defaultProject();
  for (const n of [...makeLimbPair(p.rig, 'body', 'arm'), ...makeLimbPair(p.rig, 'body', 'leg')]) p.rig.nodes[n.id] = n;
  const armR = Object.values(p.rig.nodes).find((n) => n.role === 'armR')!;
  armR.limb = { ...armR.limb!, c: armR.limb!.b, b: { x: 160, y: 60 } };
  const drawn = () => buildScene(evaluateRig(p, 0), compOf(p)).find((s) => s.id === armR.id);
  it('an arm with an elbow draws through three points', check(!!drawn() && limbPointsOf(armR.limb!).length === 3));
  it('the Excited pose moves every hand and foot', check(applyPose(p, 'body', 'excited', 0, false) === 4));
  const legL = Object.values(p.rig.nodes).find((n) => n.role === 'legL')!;
  it('the left leg kicks out: its foot is out to the left and up', check(legL.limb!.c!.x < -150 && legL.limb!.c!.y < 210, JSON.stringify(legL.limb)));
  it('the elbowed arm takes the elbow and the hand', check(armR.limb!.c!.y < 0 && armR.limb!.b.x > 200, JSON.stringify(armR.limb)));
  it('a limb too short for the pose is lengthened', check(legL.limb!.length >= Math.hypot(legL.limb!.b.x - legL.limb!.a.x, legL.limb!.b.y - legL.limb!.a.y)));
  it('an unknown pose does nothing', check(applyPose(p, 'body', 'backflip', 0, false) === 0));

  const ed = useEditor.getState();
  ed.loadProject(p);
  ed.setPlayhead(500);
  ed.applyPose('body', 'hands up', true);
  const q = useEditor.getState().project;
  it('keyed, a pose is keyframes at the playhead', check(activeTimeline(q).tracks.some((t) => t.nodeId === armR.id && t.property === 'limb.c.y' && t.keyframes.some((k) => k.time === 500))));

  // every state keeps its own layers: a new one has just the mascot, and a layer is copied in on request
  ed.loadProject(defaultProject());
  ed.addLayer(makeShapeLayer('star', { id: 'starA' }));
  const idleId = useEditor.getState().project.activeTimelineId;
  ed.addTimeline('Happy');
  it('a new state has the mascot but not the extra layers', check(!!useEditor.getState().project.rig.nodes.body && !useEditor.getState().project.rig.nodes.starA));
  ed.addTimeline('Sad');
  ed.setActiveTimeline(idleId);
  it('switching back brings that state\'s own layers back', check(!!useEditor.getState().project.rig.nodes.starA && !!useEditor.getState().project.rig.nodes.body));
  ed.showLayersIn(['starA'], 'everywhere');
  const e = useEditor.getState().project;
  it('"everywhere" copies it into every state', check(e.timelines.every((tl) => sceneAt(asTimeline(e, tl.id), 100, compOf(e)).some((s) => s.id === 'starA'))));
}

// --- any layer's role can be changed ---------------------------------------------------
{
  const p = defaultProject();
  for (const n of makeLimbPair(p.rig, 'body', 'arm')) p.rig.nodes[n.id] = n;
  const arm = Object.values(p.rig.nodes).find((n) => n.role === 'armR')!;
  const before = buildScene(evaluateRig(p, 0), compOf(p)).find((s) => s.id === arm.id)!;
  it('a hand can become a leg', check(setRole(p, arm.id, 'legR', 0) && p.rig.nodes[arm.id].limb!.type === 'leg' && !!p.rig.nodes[arm.id].limb!.c));
  it('moving onto the body, its shoulder staying where it was', check(p.rig.nodes[arm.id].parentId === 'body'
    && Math.abs(sceneFrames(evaluateRig(p, 0), compOf(p)).get('body')!.x + p.rig.nodes[arm.id].limb!.a.x - (before.cx - before.w / 2)) < before.w));
  it('and back into a hand', check(setRole(p, arm.id, 'armR', 0) && p.rig.nodes[arm.id].limb!.type === 'arm' && !p.rig.nodes[arm.id].limb!.c));
  p.rig.nodes.dot = makeShapeLayer('circle', { id: 'dot', parentId: 'body' });
  it('a shape can take the left-eye role', check(setRole(p, 'dot', 'eyeL', 0) && p.rig.nodes.dot.role === 'eyeL'));
  it('and the old left eye gives it up — a role is unique in its mascot', check(p.rig.nodes.eyeL.role === undefined));
  it('clearing a role makes it an ordinary layer', check(setRole(p, 'dot', '', 0) && p.rig.nodes.dot.role === undefined));
  it('a roll that makes no sense is refused', check(!setRole(p, 'dot', 'legL', 0) && !setRole(p, 'body', 'eyeL', 0)));
  p.rig.nodes.blob = makeShapeLayer('circle', { id: 'blob', parentId: null, size: { x: 120, y: 120 } });
  it('a world shape can become a mascot body', check(setRole(p, 'blob', 'body', 0) && p.rig.nodes.blob.kind === 'body' && p.rig.nodes.blob.size.x === 60));
  it('drawn the same size it was', check(Math.abs(buildScene(evaluateRig(p, 0), compOf(p)).find((s) => s.id === 'blob')!.w - 120) < 12));
}

// --- previews keep the layers this state owns ------------------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  ed.addLayer(makeLimbPair(useEditor.getState().project.rig, 'body', 'leg'));
  ed.addLayer(makeLimbPair(useEditor.getState().project.rig, 'body', 'arm'));
  const p = useEditor.getState().project;
  const limbs = Object.values(p.rig.nodes).filter((n) => n.kind === 'limb').map((n) => n.id);
  const blink = p.presets.find((x) => x.id === 'p_blink')!;
  const prev = presetPreviewProject(p, blink);
  const drawn = sceneAt(prev, 100, compOf(prev)).map((s) => s.id);
  it('a preset preview still shows the hands and legs made in this state', check(limbs.length === 4 && limbs.every((id) => drawn.includes(id)), drawn.join()));
  const fx = effectPreviewProject(p, { modifier: { nodeId: 'body', kind: 'float', amount: 100, frequency: 1, amplitude: 8 } });
  it('and so does an effect preview', check(limbs.every((id) => sceneAt(fx, 100, compOf(fx)).some((s) => s.id === id))));
}

// --- migration: an old mascot gets a face, and looks the same --------------------------
{
  const old = {
    schemaVersion: 6, name: 'old', fps: 30, activeTimelineId: 'tl', presets: [], expressions: [],
    timelines: [{ id: 'tl', name: 'Idle', tracks: [{ id: 't', nodeId: 'eyeL', property: 'eye.openness', keyframes: [{ id: 'k', time: 0, value: 0.5, easingOut: { type: 'linear' } }] }], modifiers: [], blocks: [], durationMode: 'custom', timelineDurationMs: 1000, loop: false }],
    rig: {
      id: 'r', rootId: 'body', camera: { fov: 28, distance: 6, offset: { x: 0, y: 0 } },
      nodes: {
        body: { id: 'body', name: 'Body', kind: 'body', parentId: null, surface: { yaw: 10, pitch: 0, mapped: false }, transform: { scale: { x: 1, y: 1 }, rotation: 0 }, size: { x: 148, y: 148 }, color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, zIndex: 0 },
        eyeL: { id: 'eyeL', name: 'Left eye', kind: 'eye', parentId: 'body', surface: { yaw: 0, pitch: -4, mapped: true }, transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1.55 }, size: { x: 38, y: 38 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 1, eye: { linkedToId: null, openness: 1, distanceFromCenter: -21 } },
      },
    },
    mascotTemplates: [{ id: 'mt', name: 'Saved', nodes: [
      { id: 'b2', name: 'B', kind: 'body', parentId: null, role: 'body', surface: { yaw: 0, pitch: 0, mapped: false }, transform: { scale: { x: 1, y: 1 }, rotation: 0 }, size: { x: 140, y: 140 }, color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, zIndex: 0 },
      { id: 'b2e', name: 'E', kind: 'eye', parentId: 'b2', role: 'eyeL', surface: { yaw: 0, pitch: 0, mapped: true }, transform: { scale: { x: 1, y: 1 }, rotation: 0 }, size: { x: 30, y: 30 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 1, eye: { linkedToId: null, openness: 1, distanceFromCenter: -20 } },
    ] }],
  } as unknown as Project;
  const pre = structuredClone(old);
  const drawnBefore = buildScene(evaluateRig(pre, 0), compOf(pre)).find((s) => s.id === 'eyeL')!;
  const { project, applied } = migrateProject(old);
  it('a v6 file runs the faces step', check(applied.join() === 'faces,app screen presets,cinematic presets,app mascot kit,each timeline keeps its own layers,cartoon and character presets,built-in presets are stored by reference,the body can be a blob', applied.join()));
  it('its mascot gets a face', check(project.rig.nodes.face?.role === 'face' && project.rig.nodes.face.parentId === 'body'));
  it('with its eyes in it', check(project.rig.nodes.eyeL.parentId === 'face'));
  const drawnAfter = buildScene(evaluateRig(project, 0), compOf(project)).find((s) => s.id === 'eyeL')!;
  it('and nothing moved', check(near(drawnBefore.cx, drawnAfter.cx) && near(drawnBefore.cy, drawnAfter.cy) && near(drawnBefore.w, drawnAfter.w)));
  it('its animation still plays on the eye', check(near(valueAt(project, 'eyeL', 'eye.openness', 0) as number, 0.5)));
  it('saved mascots get one too', check(project.mascotTemplates![0].nodes.some((n) => n.role === 'face') && project.mascotTemplates![0].nodes.find((n) => n.id === 'b2e')!.parentId === 'b2.face'));
  it('and running it again changes nothing', check(migrateProject(project).applied.length === 0));
  it('an empty document survives it', check((() => { try { migrateProject({ schemaVersion: 6 } as unknown as Project); return true; } catch { return false; } })()));
}

// --- eye actions: a blink at the playhead is openness keys on both eyes -------------------
{
  const p = defaultProject();
  applyEyeAction(p, ['eyeL', 'eyeR'], 'blink', 2000);
  const keys = (id: string) => activeTimeline(p).tracks.filter((t) => t.nodeId === id && t.property === 'eye.openness').flatMap((t) => t.keyframes).filter((k) => k.time >= 2000 && k.time <= 2220);
  it('a blink writes closed-then-open keys on each eye from the playhead', check(['eyeL', 'eyeR'].every((id) => keys(id).some((k) => k.value === 0.05) && keys(id).some((k) => k.time === 2220 && k.value === 1)), JSON.stringify(keys('eyeL'))));
  it('an unknown action writes nothing', check(!applyEyeAction(p, ['eyeL'], 'wink', 0) && !applyEyeAction(p, ['body'], 'blink', 0)));
}
