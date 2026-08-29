import { it } from 'vitest';
import { check } from './testkit';
import { builtinPresets, defaultProject } from './defaults';
import { type ToolCall } from '../copilot/tools';
import { closes, critique } from '../copilot/critique';

// --- the built-in presets, held to the same rules the copilot is -----------------
{
  const presets = builtinPresets();

  // every clip must end on the pose it opened with, or it cannot loop and cannot be
  // followed. Checked structurally across all of them rather than by eye.
  const drifting: string[] = [];
  for (const p of presets) {
    for (const t of p.tracks) {
      const a = t.keyframes[0]?.value, b = t.keyframes[t.keyframes.length - 1]?.value;
      if (a === undefined || b === undefined) continue;
      // angles compare modulo 360, so Spin ending on 360 is the pose it opened on
      const same = typeof a === 'number' && typeof b === 'number'
        ? closes(t.property, a, b)
        : JSON.stringify(a) === JSON.stringify(b);
      if (!same) drifting.push(`${p.name}.${t.nodeId}.${t.property}`);
    }
  }
  it('every builtin returns to the pose it opened on', check(drifting.length === 0, drifting.join(', ')));

  // and the copilot's own critic must approve them. If it does not, one of the two is
  // wrong — a critic that rejects the hand-authored work is not a usable critic.
  const proj = defaultProject();
  const complaints: string[] = [];
  for (const p of presets) {
    if (!p.tracks.length) continue;
    const calls: ToolCall[] = [{ name: 'create_preset', args: { name: p.name, durationMs: p.durationMs, tracks: p.tracks.map((t) => ({
      nodeId: t.nodeId, property: t.property, keyframes: t.keyframes.map((k) => ({ time: k.time, value: k.value })),
    })) } }];
    for (const c of critique(proj, calls, '')) complaints.push(`${p.name}: ${c}`);
  }
  it('the critic approves every hand-authored builtin', check(complaints.length === 0, complaints.join('\n    ')));

  // the renamed one, and the new one that took its place
  it('Notify was renamed to Decline', check(presets.some((p) => p.id === 'p_decline' && p.name === 'Decline')));
  it('and the new Notify announces rather than refuses', check(presets.find((p) => p.id === 'p_notify')?.emitters?.length === 1
      && !presets.find((p) => p.id === 'p_notify')!.tracks.some((t) => t.property === 'surface.yaw')));
}
