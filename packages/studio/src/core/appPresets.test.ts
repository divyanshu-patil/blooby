import { it } from 'vitest';
import { check } from './testkit';
import { appPresets } from './appPresets';
import { builtinPresets, defaultProject } from './defaults';
import { useEditor } from './store';
import { activeTimeline } from './types';
import { searchPresets, presetData } from '../copilot/agent';
import { sceneAt } from './scene';
import { compOf } from './comp';

const apps = appPresets();
const all = builtinPresets();

it('exactly ten app presets', check(apps.length === 10));
it('named as asked', check(['Pull to Refresh', 'Profile Hello', 'Start Search', 'No Search Results', 'No Decks Here', 'Create a Deck',
  'No Saved Decks', 'Little Vibe', 'Notification Pop', 'Tap to Start'].every((n) => apps.some((p) => p.name === n))));
it('no builtin id or name is used twice', check(new Set(all.map((p) => p.id)).size === all.length && new Set(all.map((p) => p.name.toLowerCase())).size === all.length));
it('all of them are in the registry', check(apps.every((p) => all.some((b) => b.id === p.id))));
it('durations are 1.8–4s', check(apps.every((p) => p.durationMs >= 1800 && p.durationMs <= 4000)));
it('Start Search brings a real magnifier layer', check(!!apps.find((p) => p.name === 'Start Search')!.layers!.find((l) => l.id === 'magnifier' && l.kind === 'svgLayer')));

// the copilot finds them by what they do
const names = (q: string) => searchPresets(all, q, 20).map((x) => x.name);
it('"search" finds both search presets', check(['Start Search', 'No Search Results'].every((n) => names('search').includes(n)), names('search').join()));
it('"empty state" finds the empty states', check(['No Search Results', 'No Decks Here', 'No Saved Decks'].every((n) => names('empty state').includes(n)), names('empty state').join()));
it('"squish" finds presets that use squish', check(['Pull to Refresh', 'Little Vibe', 'Tap to Start'].every((n) => names('squish').includes(n)), names('squish').join()));
it('"path drawing" finds the arc drawn on', check(names('path drawing').includes('Pull to Refresh'), names('path drawing').join()));
it('and their keyframes are readable', check(presetData(apps[0]).tracks.some((t) => t.prop === 'trim.end' && t.keys.length >= 2)));

// placed, each makes a clip of real, editable keyframes and stays in its own state
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  ed.addTimeline('Other');
  const other = useEditor.getState().project.activeTimelineId;
  ed.setActiveTimeline(useEditor.getState().project.timelines[0].id);
  for (const p of apps) ed.addBlock(p.id);
  const proj = useEditor.getState().project;
  const tl = activeTimeline(proj);
  it('all ten place as clips', check(apps.every((p) => tl.blocks.some((b) => b.presetId === p.id))));
  it('with their own tracks', check(apps.every((p) => tl.tracks.some((t) => t.blockId === tl.blocks.find((b) => b.presetId === p.id)!.id))));
  const otherScene = sceneAt({ ...proj, activeTimelineId: other }, 500, compOf(proj)).map((s) => s.id);
  it('their props are not on screen in another state', check(!['magnifier', 'emptyDeck', 'bookmark', 'notifBadge', 'tapPointer', 'pullArc'].some((id) => otherScene.includes(id)), otherScene.join()));
  const track = tl.tracks.find((t) => t.nodeId === 'magnifier' && t.property === 'transform.rotation')!;
  ed.moveKeyframe(track.id, track.keyframes[1].id, track.keyframes[1].time + 50);
  it('and their keyframes can be edited', check(activeTimeline(useEditor.getState().project).tracks.find((t) => t.id === track.id)!.keyframes.some((k) => k.time === track.keyframes[1].time + 50)));
}
