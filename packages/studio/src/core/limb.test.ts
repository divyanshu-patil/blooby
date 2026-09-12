import { it } from 'vitest';
import { check, near } from './testkit';
import { limbPoints, restLength, rubberHose, type HoseInput } from './limb';
import { pathBounds, splitSubpaths } from './path';
import { defaultProject } from './defaults';
import { compOf } from './comp';
import { buildScene, evaluateRig, sceneAt } from './scene';
import { makeLimb } from './layers';
import type { Vec2 } from './types';

const along = (pts: Vec2[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
/** how far the centreline strays from the straight line between its ends */
const bulge = (pts: Vec2[]) => Math.max(...pts.map((p) => Math.abs(p.y)));

// --- a hose with a length, the way Cavalry's rubber hose works ------------------------
{
  const arm: HoseInput = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], thickness: 20, bend: 1, roundness: 1, taper: 0, hose: 1, length: 100 };
  const r = rubberHose(arm)!;
  const b = pathBounds(r.d)!;
  it('a two-point hose is made', check(!!r && r.d.startsWith('M')));
  it('taut, it runs straight between its points, a round cap at each end', check(near(b.x0, -10, 0.5) && near(b.x1, 110, 0.5), `${b.x0.toFixed(2)}..${b.x1.toFixed(2)}`));
  it('exactly as thick as asked', check(near(b.y1 - b.y0, 20, 0.2), (b.y1 - b.y0).toFixed(2)));
  it('deterministic — the same input, the same outline', check(rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })!.d === r.d));

  const slack = rubberHose({ ...arm, length: 160 })!;
  it('given slack, it bows', check(bulge(slack.centreline) > 30, bulge(slack.centreline).toFixed(1)));
  it('into an arc exactly as long as the hose', check(near(along(slack.centreline), 160, 1.5), along(slack.centreline).toFixed(2)));
  it('while its ends stay exactly on the points', check(near(slack.centreline[0].x, 0, 1e-6) && near(slack.centreline.at(-1)!.x, 100, 1e-6) && near(slack.centreline.at(-1)!.y, 0, 1e-6)));

  const closer = rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], length: 160 })!;
  it('bringing the hand in bows it further, keeping its length', check(bulge(closer.centreline) > bulge(slack.centreline) && near(along(closer.centreline), 160, 1.5)));
  const folded = rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 8, y: 0 }], length: 160 })!;
  it('even folded almost double it keeps its length and stays finite', check(near(along(folded.centreline), 160, 3) && !/NaN/.test(folded.d)));

  const flip = rubberHose({ ...arm, length: 160, bend: -1 })!;
  const midY = (h: typeof slack) => h.centreline[14].y;
  it('bend\'s sign flips the side it bends to', check(Math.sign(midY(flip)) === -Math.sign(midY(slack)) && Math.abs(midY(flip)) > 30));

  // the whole point: set the length, move the hand, and only the bend changes
  const reach = [40, 70, 100, 130, 159].map((x) => rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x, y: 0 }], length: 160 })!);
  it('wherever the hand goes within reach, the length stays exactly the same', check(reach.every((h) => near(along(h.centreline), 160, 2)), reach.map((h) => along(h.centreline).toFixed(1)).join(' ')));
  it('and the hand stays exactly on its point', check(reach.every((h, i) => near(h.end.x, [40, 70, 100, 130, 159][i], 1e-6))));
  it('only the bend changes — more the closer it is', check(reach.every((h, i) => i === 0 || bulge(h.centreline) < bulge(reach[i - 1].centreline))));

  const past = rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], length: 160 })!;
  it('pulled past its length it straightens and stops short — it never stretches', check(
    near(along(past.centreline), 160, 0.5) && near(past.end.x, 160, 0.5) && bulge(past.centreline) < 1e-6, `${along(past.centreline).toFixed(1)} long, ends at ${past.end.x.toFixed(1)}`));
  const diagonal = rubberHose({ ...arm, points: [{ x: 0, y: 0 }, { x: 300, y: 400 }], length: 160 })!;
  it('stopping short in the direction of the hand', check(near(diagonal.end.x, 96, 0.5) && near(diagonal.end.y, 128, 0.5)));

  const elbow = rubberHose({ ...arm, bend: 0, length: 160 })!;
  const mid = elbow.centreline[14], quarter = elbow.centreline[7];
  it('bend 0 folds the slack into a sharp elbow halfway along, still the same length', check(
    near(Math.hypot(mid.x, mid.y), 80, 0.5) && near(Math.hypot(mid.x - 100, mid.y), 80, 0.5) && near(along(elbow.centreline), 160, 0.5)));
  it('with straight segments either side of it', check(near(quarter.x, mid.x / 2, 1e-6) && near(quarter.y, mid.y / 2, 1e-6)));
  const rigid = rubberHose({ ...arm, hose: 0, length: 160 })!;
  it('rubber hose off is the plain rigid limb, straight between its points', check(bulge(rigid.centreline) < 1e-6 && near(rigid.end.x, 100, 1e-6)));

  const flat = pathBounds(rubberHose({ ...arm, roundness: 0 })!.d)!;
  it('roundness 0 cuts the ends flat', check(near(flat.x0, 0, 0.1) && near(flat.x1, 100, 0.1)));
  const tapered = pathBounds(rubberHose({ ...arm, taper: 1, roundness: 0 })!.d)!;
  it('taper narrows the far end to a point', check(tapered.x1 < 100.1 && near(tapered.y1 - tapered.y0, 20, 0.2)));

  // a leg: three points, through the knee
  const leg: HoseInput = { points: [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 120 }], thickness: 20, bend: 1, roundness: 1, taper: 0, hose: 1, length: 150,
    foot: { angle: 0, length: 40, width: 20, side: 1 } };
  const l = rubberHose(leg)!;
  const knee = Math.min(...l.centreline.map((p) => Math.hypot(p.x - 30, p.y - 60)));
  it('a three-point hose passes through its knee', check(knee < 1e-6, knee.toFixed(4)));
  it('keeping its length too', check(near(along(l.centreline), 150, 2), along(l.centreline).toFixed(1)));
  it('and ends in a foot, drawn as its own outline', check(splitSubpaths(l.d).length === 2));
  const loose = rubberHose({ ...leg, length: 220 })!;
  it('with more length, a leg bends outward, away from the hip-ankle line', check(loose.centreline[7].x > l.centreline[7].x + 5 && loose.centreline[21].x > l.centreline[21].x + 5));
  it('still through the knee, and still exactly that long', check(Math.min(...loose.centreline.map((p) => Math.hypot(p.x - 30, p.y - 60))) < 1e-6 && near(along(loose.centreline), 220, 3)));
  const short = rubberHose({ ...leg, length: 100 })!;
  it('a leg shorter than its points stops short of the ankle, never stretching', check(near(along(short.centreline), 100, 1) && short.end.y < 110));
  const moved = pathBounds(rubberHose({ ...leg, points: [leg.points[0], leg.points[1], { x: 40, y: 120 }] })!.d)!;
  it('moving the ankle moves the foot with it', check(moved.x1 > pathBounds(l.d)!.x1 + 30));
  const footOf = (d: string) => pathBounds(splitSubpaths(d)[1])!;
  const tipUp = footOf(rubberHose({ ...leg, foot: { ...leg.foot!, angle: 60 } })!.d);
  it('foot angle tips the toe up', check(tipUp.y0 < footOf(l.d).y0 - 15, `${footOf(l.d).y0.toFixed(1)} -> ${tipUp.y0.toFixed(1)}`));

  it('garbage in is nothing out — never NaN', check(
    rubberHose({ ...arm, points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }) === null
    && rubberHose({ ...arm, thickness: NaN }) === null
    && rubberHose({ ...arm, length: Infinity }) === null
    && rubberHose({ ...arm, points: [{ x: 0, y: 0 }] }) === null));
  const same = rubberHose({ ...arm, points: [{ x: 5, y: 5 }, { x: 5, y: 5 }], length: 60 });
  it('two points on top of each other still make a finite loop', check(!!same && !/NaN/.test(same.d)));
  it('a new limb rests a little longer than its points are apart', check(near(restLength({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), 112, 1e-9)));
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
