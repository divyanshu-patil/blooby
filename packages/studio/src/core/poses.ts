import { writeKeyframe } from './store';
import { writeValue } from './layers';
import { mascotOf } from './mascot';
import { evaluateRig } from './scene';
import type { Project, Vec2 } from './types';

/**
 * Whole-body poses: where every hand and foot goes, in one click.
 *
 * Posing a mascot used to be four limbs × two or three points dragged one at a time. A pose
 * sets them together — the shoulders and hips stay where they are, the hands, elbows, knees
 * and feet move — and on the timeline it is ordinary keyframes at the playhead, so a pose,
 * a second pose later, and the easing between them is an animation.
 *
 * Points are in the body's px for a mascot 148 wide (the default), +y down, and scale with
 * the actual body. An arm or a leg without a middle joint takes only its end point; the
 * rubber hose bends between. Limbs are found by role (armL, armR, legL, legR).
 */
type LimbPose = { end: Vec2; joint?: Vec2 };
export interface Pose { id: string; name: string; blurb: string; limbs: Partial<Record<'armL' | 'armR' | 'legL' | 'legR', LimbPose>> }

const REST: Pose['limbs'] = {
  armL: { end: { x: -196, y: 96 }, joint: { x: -170, y: 70 } },
  armR: { end: { x: 196, y: 96 }, joint: { x: 170, y: 70 } },
  legL: { end: { x: -60, y: 230 }, joint: { x: -68, y: 176 } },
  legR: { end: { x: 60, y: 230 }, joint: { x: 68, y: 176 } },
};

export const POSES: Pose[] = [
  { id: 'rest', name: 'Rest', blurb: 'Arms down, feet together', limbs: REST },
  { id: 'excited', name: 'Excited', blurb: 'Arms flung up, one leg kicked out — "!!?"', limbs: {
    armL: { end: { x: -205, y: -95 }, joint: { x: -228, y: 10 } },
    armR: { end: { x: 205, y: -60 }, joint: { x: 222, y: 40 } },
    legL: { end: { x: -178, y: 196 }, joint: { x: -118, y: 206 } },
    legR: { end: { x: 58, y: 236 }, joint: { x: 70, y: 180 } },
  } },
  { id: 'handsUp', name: 'Hands up', blurb: 'Both hands high over the head', limbs: {
    armL: { end: { x: -150, y: -150 }, joint: { x: -196, y: -40 } },
    armR: { end: { x: 150, y: -150 }, joint: { x: 196, y: -40 } },
    legL: REST.legL, legR: REST.legR,
  } },
  { id: 'kickL', name: 'Kick left', blurb: 'Left leg out, arms up for balance', limbs: {
    armL: { end: { x: -210, y: 10 }, joint: { x: -205, y: 60 } },
    armR: { end: { x: 215, y: -20 }, joint: { x: 210, y: 50 } },
    legL: { end: { x: -175, y: 190 }, joint: { x: -110, y: 165 } },
    legR: REST.legR,
  } },
  { id: 'kickR', name: 'Kick right', blurb: 'Right leg out, arms up for balance', limbs: {
    armL: { end: { x: -215, y: -20 }, joint: { x: -210, y: 50 } },
    armR: { end: { x: 210, y: 10 }, joint: { x: 205, y: 60 } },
    legL: REST.legL,
    legR: { end: { x: 175, y: 190 }, joint: { x: 110, y: 165 } },
  } },
  { id: 'shrug', name: 'Shrug', blurb: 'Palms up and out — "who knows?"', limbs: {
    armL: { end: { x: -182, y: 16 }, joint: { x: -200, y: 72 } },
    armR: { end: { x: 182, y: 16 }, joint: { x: 200, y: 72 } },
    legL: REST.legL, legR: REST.legR,
  } },
  { id: 'wave', name: 'Wave', blurb: 'Right hand up by the head', limbs: {
    armL: REST.armL,
    armR: { end: { x: 206, y: -86 }, joint: { x: 232, y: 10 } },
    legL: REST.legL, legR: REST.legR,
  } },
  { id: 'point', name: 'Point', blurb: 'Right arm straight out', limbs: {
    armL: REST.armL,
    armR: { end: { x: 290, y: 20 }, joint: { x: 210, y: 28 } },
    legL: REST.legL, legR: REST.legR,
  } },
  { id: 'stride', name: 'Stride', blurb: 'Mid-step: one foot forward, arms swinging', limbs: {
    armL: { end: { x: -175, y: 120 }, joint: { x: -160, y: 80 } },
    armR: { end: { x: 215, y: 60 }, joint: { x: 180, y: 70 } },
    legL: { end: { x: -115, y: 222 }, joint: { x: -92, y: 170 } },
    legR: { end: { x: 95, y: 218 }, joint: { x: 62, y: 170 } },
  } },
];

export const findPose = (ref: string): Pose | undefined => {
  const r = ref.trim().toLowerCase();
  return POSES.find((p) => p.id.toLowerCase() === r || p.name.toLowerCase() === r);
};

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Put a mascot's limbs into a pose at `atMs`. With `keyed`, every point is a keyframe
 * there (eased in and out); without, the value lands where it shows — into a track already
 * driving it, or onto the resting pose. A limb too short to reach is lengthened, never
 * shortened. Returns how many limbs moved.
 */
export function applyPose(p: Project, mascotId: string, poseRef: string, atMs: number, keyed: boolean): number {
  const pose = findPose(poseRef);
  const body = p.rig.nodes[mascotId];
  if (!pose || body?.kind !== 'body') return 0;
  const k = body.size.x / 148;
  const ev = evaluateRig(p, atMs);
  let moved = 0;
  for (const n of Object.values(p.rig.nodes)) {
    const role = n.role as keyof Pose['limbs'] | undefined;
    const target = role && n.limb && pose.limbs[role];
    if (!target || mascotOf(p.rig, n.id)?.id !== mascotId) continue;
    const l = ev.nodes[n.id]?.limb ?? n.limb!;
    const put = (path: string, v: number) => (keyed
      ? writeKeyframe(p, n.id, path, atMs, round(v), { type: 'preset', name: 'easeInOut' })
      : writeValue(p, n.id, path, round(v), atMs));
    const end = { x: target.end.x * k, y: target.end.y * k };
    const joint = target.joint ? { x: target.joint.x * k, y: target.joint.y * k } : { x: (l.a.x + end.x) / 2, y: (l.a.y + end.y) / 2 };
    const pts: Vec2[] = [l.a];
    if (l.c) {
      put('limb.b.x', joint.x); put('limb.b.y', joint.y);
      put('limb.c.x', end.x); put('limb.c.y', end.y);
      pts.push(joint, end);
    } else {
      put('limb.b.x', end.x); put('limb.b.y', end.y);
      pts.push(end);
    }
    // a rubber hose keeps its length: make sure it can reach the pose
    let reach = 0;
    for (let i = 1; i < pts.length; i++) reach += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (reach * 1.06 > l.length) put('limb.length', reach * 1.06);
    moved++;
  }
  return moved;
}
