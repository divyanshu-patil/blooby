import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject } from '../core/defaults';
import { critique } from './critique';
import type { ToolCall } from './tools';

{
  const p = defaultProject();
  const preset = (tracks?: unknown[]) => [{ name: 'create_preset', args: { name: 'X', durationMs: 1000, tracks } }] as ToolCall[];
  const t = (keyframes?: unknown[]) => ({ nodeId: p.rig.rootId, property: 'transform.scale.x', keyframes });

  it('a preset with no tracks key has nothing to judge', check(critique(p, preset(), 'scale').length === 0));
  it('a track without keyframes is skipped', check(critique(p, preset([t()]), 'scale').length === 0));
  it('a track with only non-finite values is skipped', check(critique(p, preset([t([{ time: 0, value: 'x' }])]), 'scale').length === 0));
  it('a tiny scale is called out', check(critique(p, preset([t([{ time: 0, value: 1 }, { time: 500, value: 1.02 }, { time: 1000, value: 1 }])]), 'scale it').some((n) => n.includes('invisible'))));
}
