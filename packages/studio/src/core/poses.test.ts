import { it } from 'vitest';
import { check } from './testkit';
import { defaultProject } from './defaults';
import { makeLimbPair } from './layers';
import { applyPose, findPose, POSES } from './poses';

{
  const p = defaultProject();
  for (const n of [...makeLimbPair(p.rig, 'body', 'arm'), ...makeLimbPair(p.rig, 'body', 'leg')]) p.rig.nodes[n.id] = n;
  // every shipped pose names a middle joint; a pose that does not takes the midpoint
  POSES.push({ id: 'bare', name: 'Bare', blurb: '', limbs: { armL: { end: { x: -100, y: 100 } }, legL: { end: { x: -50, y: 200 } } } });
  const moved = applyPose(p, 'body', 'Bare', 0, false);
  const found = findPose(' BARE ')?.id;
  POSES.pop();
  it('a pose without a middle joint still moves its limbs, found by id or name', check(moved === 2 && found === 'bare'));
}
