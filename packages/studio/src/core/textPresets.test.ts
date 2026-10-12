import { it } from 'vitest';
import { check } from './testkit';
import { textPresetOnto } from './textPresets';
import { makeTextLayer } from './layers';
import type { Preset } from './types';

const key = (time: number, value: number) => ({ id: `k${time}`, time, value, easingOut: { type: 'linear' } });
const caption = makeTextLayer('Hi', { id: 't1' });
const mine = makeTextLayer('Hello there', { id: 'u' });
const preset = (over: Record<string, unknown> = {}) => ({
  id: 'p', name: 'p', durationMs: 1000, layers: [caption],
  tracks: [
    { id: 'a', nodeId: 't1', property: 'text.reveal.end', keyframes: [key(0, 0), key(500, 2), key(1000, 2)] },
    { id: 'b', nodeId: 'body', property: 'transform.rotation', keyframes: [key(0, 0)] },
    { id: 'd', nodeId: 't1', property: 'transform.scale.x', keyframes: [key(0, 1), key(1000, 1)] },
    { id: 'c', nodeId: 't1', property: 'opacity', keyframes: [key(999.5, 1), key(1000, 1), key(1001, 1)] },
  ],
  modifiers: [{ id: 'm1', nodeId: 't1' }, { id: 'm2', nodeId: 'body' }],
  appearances: [{ id: 'ap', nodeId: 't1' }, { id: 'ap2', nodeId: 'body' }],
  ...over,
}) as unknown as Preset;

{
  const out = textPresetOnto(preset(), mine)!;
  it('the user\'s text replaces the preset\'s own caption throughout', check(
    out.layers!.length === 0 && out.appearances!.length === 1 && out.modifiers![0].nodeId === 'u' && out.modifiers![1].nodeId === 'body' && out.tracks[1].nodeId === 'body',
  ));
  it('the typewriter types all of it, and the closing keys go', check(out.tracks[0].keyframes.length === 2 && (out.tracks[0].keyframes[1].value as number) >= 10));
  it('a track with nothing before the end keeps every key', check(out.tracks[3].keyframes.length === 3 && out.tracks[2].keyframes.length === 2));
  it('a preset with no modifiers or appearances is fine', check(textPresetOnto(preset({ modifiers: undefined, appearances: undefined }), mine)!.modifiers === undefined));
  it('words that come with another mascot cannot take it', check(textPresetOnto(preset({ layers: [caption, { id: 'm', kind: 'body' }] }), mine) === null));
  it('nor a preset without a caption of its own, or a node that is not text', check(textPresetOnto(preset({ layers: undefined }), mine) === null && textPresetOnto(preset(), { ...mine, text: undefined }) === null));
}
