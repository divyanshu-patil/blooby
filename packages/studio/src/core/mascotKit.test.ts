import { it } from 'vitest';
import { check } from './testkit';
import { KIT_ASSETS, mascotKitPresets } from './mascotKit';
import { appPresets } from './appPresets';
import { builtinPresets, defaultProject, presetPreviewProject } from './defaults';
import { useEditor } from './store';
import { bakeLottie } from '../export/lottie';
import { searchPresets } from '../copilot/agent';
import type { Preset } from './types';

const kit = mascotKitPresets();
const all = builtinPresets();
const byId = (id: string) => all.find((p) => p.id === id);

it('the kit is in the library', check(kit.length >= 25 && kit.every((p) => !!byId(p.id))));
it('every state named in the asset map is a real preset', check(KIT_ASSETS.every((a) => Object.values(a.states).every((id) => !!byId(id))),
  KIT_ASSETS.flatMap((a) => Object.values(a.states)).filter((id) => !byId(id)).join()));
it('and every kit preset belongs to an asset', check(kit.every((p) => KIT_ASSETS.some((a) => Object.values(a.states).includes(p.id)))));

// app-ready: a .lottie must carry everything, so nothing may be drawn only in the editor
{
  const ed = useEditor.getState();
  const lost: string[] = [];
  for (const p of [...kit, ...appPresets()]) {
    ed.loadProject(defaultProject());
    ed.addBlock(p.id);
    const baked = bakeLottie(presetPreviewProject(useEditor.getState().project, p), { background: null, name: p.name });
    // fonts are not loaded under node, so live-text notes are expected here and nowhere else
    const warnings = baked.warnings.filter((w) => !/was not loaded/.test(w));
    if (warnings.length || baked.skipped.length) lost.push(`${p.name}: ${[...warnings, ...baked.skipped].join('; ')}`);
  }
  it('every kit and app preset exports to Lottie with nothing lost', check(lost.length === 0, lost.join('\n')));
}

// a loop is seamless only if it was authored closed: looped() never had to add a snap back
const loops = kit.filter((p) => /\(loops\)/.test(p.tagline ?? ''));
const snaps = (p: Preset) => p.tracks.filter((t) => {
  const ks = t.keyframes;
  return ks.length > 1 && ks.at(-2)!.time === p.durationMs - 1 && JSON.stringify(ks.at(-2)!.value) !== JSON.stringify(ks.at(-1)!.value);
}).map((t) => `${p.name}.${t.nodeId}.${t.property}`);
it('there are loops', check(loops.length >= 8));
it('every loop closes on itself, with no snap at the seam', check(loops.every((p) => snaps(p).length === 0), loops.flatMap(snaps).join(', ')));

// the scrubbed pull only ever moves forward, so a scroll offset can drive it
{
  const pull = appPresets().find((p) => p.id === 'p_app_refresh')!;
  const arc = pull.tracks.find((t) => t.nodeId === 'pullArc' && t.property === 'trim.end')!;
  it('Pull to Refresh fills its arc as the pull grows', check(arc.keyframes[0].value === 0 && arc.keyframes.some((k) => k.value === 1)));
  const release = kit.find((p) => p.id === 'p_kit_release')!;
  const last = (p: Preset, n: string, prop: string, at: number) => { const ks = p.tracks.find((t) => t.nodeId === n && t.property === prop)!.keyframes.filter((k) => k.time <= at); return ks.at(-1)!.value as number; };
  it('and Refresh Release starts from the pose the pull ends on', check(Math.abs(last(pull, 'armR', 'limb.b.y', 1998) - last(release, 'armR', 'limb.b.y', 0)) < 12));
}

// the copilot finds them by the words the screens use
const names = (q: string) => searchPresets(all, q, 30).map((x) => x.name);
it('"generating" finds the generating states', check(['Writing', 'Generation Failed', 'Generation Complete'].every((n) => names('generating').includes(n)), names('generating').join()));
it('"empty state" finds the new empty states', check(['No Scripts Yet', 'No Search Results'].every((n) => names('empty state').includes(n)), names('empty state').join()));
it('"password" finds Cover Eyes', check(names('password').includes('Cover Eyes'), names('password').join()));
