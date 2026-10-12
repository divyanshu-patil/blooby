import { it } from 'vitest';
import { check } from './testkit';
import { sequence } from './cinematicPresets';
import type { Preset } from './types';

const key = (time: number, value: number) => ({ id: `k${time}`, time, value, easingOut: { type: 'linear' } });
const part = (durationMs: number, over: Record<string, unknown> = {}) => ({ id: 'p', name: 'p', durationMs, tracks: [], ...over }) as unknown as Preset;

{
  const a = part(1000, {
    tracks: [{ id: 'a', nodeId: 'body', property: 'transform.rotation', keyframes: [key(0, 0), key(1000, 0)] }],
    modifiers: [{ id: 'm1', nodeId: 'body', kind: 'walk' }, { id: 'm2', nodeId: 'body', kind: 'walk', holdUntilMs: 5, startMs: 1, endMs: 2 }, { id: 'm3', nodeId: 'body', kind: 'float' }],
    emitters: [{ id: 'e', startMs: 10 }],
    appearances: [{ id: 'ap', nodeId: 'l1' }],
    layers: [{ id: 'l1' }],
  });
  const b = part(500, { tracks: [{ id: 'b', nodeId: 'body', property: 'transform.rotation', keyframes: [key(0, 0), key(500, 3)] }], layers: [{ id: 'l1' }, { id: 'l2' }] });
  const s = sequence('s', 'S', 't', [a, b, part(100)]);
  it('parts play end to end, a part with nothing but a length just adds its time', check(s.durationMs === 1600));
  it('tracks on one property join, the next part\'s opening replacing the last closing', check(s.tracks.length === 1 && s.tracks[0].keyframes.length === 3 && s.tracks[0].keyframes[2].time === 1500));
  it('effects are moved to where their part starts, and unset ranges span the part', check(
    s.modifiers![0].startMs === 0 && s.modifiers![0].endMs === 1000 && s.modifiers![2].endMs === 1000 && s.modifiers![1].startMs === 1 && s.emitters![0].startMs === 10 && s.emitters![0].endMs === 1000,
  ));
  it('a walk holds until its part ends unless it says otherwise', check(s.modifiers![0].holdUntilMs === 1000 && s.modifiers![1].holdUntilMs === 5 && s.modifiers![2].holdUntilMs === undefined));
  it('a layer shared between parts is brought once', check(s.layers!.map((l) => l.id).join() === 'l1,l2' && s.appearances!.length === 1));
}
