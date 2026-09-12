import { it } from 'vitest';
import { check, near } from './testkit';
import { limbPoints, rubberHose, type HoseInput } from './limb';
import { pathBounds, splitSubpaths } from './path';
import { defaultProject } from './defaults';
import { compOf } from './comp';
import { buildScene, evaluateRig, sceneAt } from './scene';
import { makeLimb } from './layers';

// --- the engine: two points, three points, dials -----------------------------------
{
  const arm: HoseInput = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], thickness: 20, bend: 0, roundness: 1, taper: 0, hose: 1, length: 1 };
  const r = rubberHose(arm)!;
  const b = pathBounds(r.d)!;
  it('a two-point hose is made', check(!!r && r.d.startsWith('M')));
  it('it spans its points, plus a round cap at each end', check(near(b.x0, -10, 0.5) && near(b.x1, 110, 0.5), `${b.x0.toFixed(2)}..${b.x1.toFixed(2)}`));
  it('and is exactly as thick as asked', check(near(b.y1 - b.y0, 20, 0.2), (b.y1 - b.y0).toFixed(2)));
  it('it is deterministic — the same input, the same outline', check(rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })!.d === r.d));

  const bent = pathBounds(rubberHose({ ...arm, bend: 0.5 })!.d)!;
  it('bend bows it sideways', check(bent.y1 - bent.y0 > 30, (bent.y1 - bent.y0).toFixed(1)));
  const rigid = pathBounds(rubberHose({ ...arm, bend: 0.5, hose: 0 })!.d)!;
  it('with rubber hose off, the same bend stays a straight limb', check(near(rigid.y1 - rigid.y0, 20, 0.2)));
  const longer = pathBounds(rubberHose({ ...arm, length: 1.5 })!.d)!;
  it('length stretches the reach from the shoulder', check(near(longer.x1, 160, 0.5) && near(longer.x0, -10, 0.5)));
  const flat = pathBounds(rubberHose({ ...arm, roundness: 0 })!.d)!;
  it('roundness 0 cuts the ends flat', check(near(flat.x0, 0, 0.1) && near(flat.x1, 100, 0.1)));
  const tapered = rubberHose({ ...arm, taper: 1 })!;
  const tip = tapered.centreline.at(-1)!;
  it('taper narrows the far end', check(pathBounds(tapered.d)!.x1 < 101 && near(tip.x, 100, 1e-6)));

  const leg: HoseInput = { points: [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 120 }], thickness: 20, bend: 0, roundness: 1, taper: 0, hose: 1, length: 1,
    foot: { angle: 0, length: 40, width: 20, side: 1 } };
  const l = rubberHose(leg)!;
  const knee = Math.min(...l.centreline.map((p) => Math.hypot(p.x - 30, p.y - 60)));
  it('a three-point hose passes through its knee', check(knee < 1e-6, knee.toFixed(4)));
  it('and ends in a foot, drawn as its own outline', check(splitSubpaths(l.d).length === 2));
  const moved = pathBounds(rubberHose({ ...leg, points: [leg.points[0], leg.points[1], { x: 40, y: 120 }] })!.d)!;
  it('moving the ankle moves the foot with it', check(moved.x1 > pathBounds(l.d)!.x1 + 30));
  // the foot is its own outline, so measure it alone — the leg's cap bounds the whole
  const footOf = (d: string) => pathBounds(splitSubpaths(d)[1])!;
  const tipUp = footOf(rubberHose({ ...leg, foot: { ...leg.foot!, angle: 60 } })!.d);
  it('foot angle tips the toe up', check(tipUp.y0 < footOf(l.d).y0 - 15, `${footOf(l.d).y0.toFixed(1)} -> ${tipUp.y0.toFixed(1)}`));

  it('garbage in is nothing out — never NaN', check(
    rubberHose({ ...arm, points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }) === null
    && rubberHose({ ...arm, thickness: NaN }) === null
    && rubberHose({ ...arm, points: [{ x: 0, y: 0 }] }) === null));
  const same = rubberHose({ ...arm, points: [{ x: 5, y: 5 }, { x: 5, y: 5 }] });
  it('two points on top of each other still make a finite blob', check(!!same && !/NaN/.test(same.d)));
}

// --- on the mascot ----------------------------------------------------------------
{
  const p = defaultProject();
  // no clips: a clip seals its own span, so a loose track would not drive anything in it
  Object.assign(p.timelines[0], { tracks: [], blocks: [], modifiers: [] });
  p.rig.nodes.armR = makeLimb('arm', 1, 'body', { id: 'armR' });
  p.rig.nodes.legL = makeLimb('leg', -1, 'body', { id: 'legL' });
  const item = (id: string) => buildScene(evaluateRig(p, 0), compOf(p)).find((s) => s.id === id)!;
  const a = item('armR');
  it('an arm is drawn as a generated outline', check(!!a && !!a.path && a.limb === true && a.rotation === 0));
  it('with nothing NaN in it', check([a.cx, a.cy, a.w, a.h].every(Number.isFinite) && !/NaN/.test(a.path!)));
  it('a hand has exactly two points to drag, a leg exactly three', check(
    limbPoints(p.rig.nodes.armR.limb!).length === 2 && limbPoints(p.rig.nodes.legL.limb!).length === 3));
  it('a new limb sits behind the body, so the shoulder tucks into it', check(p.rig.nodes.armR.zIndex < p.rig.nodes.body.zIndex));

  p.rig.nodes.body.surface.flatOffset = { x: 40, y: 0 };
  it('it rides the body as it moves', check(near(item('armR').cx, a.cx + 40, 0.01)));
  p.rig.nodes.body.surface.flatOffset = { x: 0, y: 0 };
  p.rig.nodes.body.transform.rotation = 90;
  it('and as it rolls', check(item('armR').cy > a.cy + 50));
  p.rig.nodes.body.transform.rotation = 0;

  // the points are keyframeable: a wave is the hand point moving
  const tl = p.timelines[0];
  tl.tracks.push({ id: 'wave', nodeId: 'armR', property: 'limb.b.y', keyframes: [
    { id: 'w1', time: 0, value: 96, easingOut: { type: 'preset', name: 'easeInOut' } },
    { id: 'w2', time: 400, value: -120, easingOut: { type: 'preset', name: 'easeInOut' } }] });
  const view = compOf(p);
  const up = sceneAt(p, 400, view).find((s) => s.id === 'armR')!;
  it('keyframing the hand point raises the hand', check(up.cy < a.cy - 60, `${a.cy.toFixed(1)} -> ${up.cy.toFixed(1)}`));
  const mid = JSON.stringify(sceneAt(p, 200, view));
  sceneAt(p, 380, view); sceneAt(p, 10, view);
  it('and scrubbing to the same time in any order gives the same limb', check(JSON.stringify(sceneAt(p, 200, view)) === mid));
}
