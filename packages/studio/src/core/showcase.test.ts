import { it } from 'vitest';
import { check } from './testkit';
import { useEditor } from './store';
import { builtinPresets, defaultProject, presetPreviewProject } from './defaults';
import { compOf } from './comp';
import { sceneAt } from './scene';
import { shapeIdOf } from './emitters';
import { showcasePresets } from './showcase';
import { makeLimb } from './layers';
import { bakeLottie } from '../export/lottie';
import { activeTimeline } from './types';
import type { Preset, Project } from './types';

const SHOWCASE = showcasePresets();

// --- the seven are real presets, first in the library ------------------------------------
{
  const all = builtinPresets();
  it('there are seven new presets', check(SHOWCASE.length >= 7));
  it('first in the library, so they are seen before anything else', check(SHOWCASE.every((p, i) => all[i].id === p.id)));
  it('and every older builtin is still there', check(['p_neutral', 'p_idle', 'p_blink', 'p_talk', 'p_happy', 'p_excited', 'p_celebrate'].every((id) => all.some((p) => p.id === id))));
  it('each says what it shows off', check(SHOWCASE.every((p) => (p.tagline ?? '').length > 4)));
}

/** Every frame of a preset, placed on a fresh mascot the way the Presets panel does it. */
function placed(preset: Preset): { project: Project; start: number } {
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const before = activeTimeline(useEditor.getState().project).blocks.reduce((s, b) => s + b.durationMs, 0);
  ed.addBlock(preset.id);
  return { project: useEditor.getState().project, start: before };
}

// --- each one places, draws, scrubs and exports ------------------------------------------
for (const preset of SHOWCASE) {
  const { project, start } = placed(preset);
  const view = compOf(project);
  const tl = activeTimeline(project);
  const block = tl.blocks.at(-1)!;
  it(`${preset.name}: places as a clip`, check(block.presetId === preset.id));
  it(`${preset.name}: brings its layers into the rig`, check((preset.layers ?? []).every((l) => !!project.rig.nodes[l.id])));
  it(`${preset.name}: with its ranges scoped to the clip`, check((tl.appearances ?? []).filter((a) => a.blockId === block.id).length === (preset.appearances ?? []).length));

  let bad = '';
  for (let t = start; t <= start + preset.durationMs; t += 40) {
    for (const s of sceneAt(project, t, view)) {
      const nums = [s.cx, s.cy, s.w, s.h, s.rotation, s.color.a, s.alpha ?? 1, s.stroke?.width ?? 0];
      if (!nums.every(Number.isFinite) || /NaN|Infinity/.test(s.path ?? '') || s.paths?.some((q) => /NaN/.test(q.d))) { bad = `${s.name} at ${t}ms`; break; }
    }
    if (bad) break;
  }
  it(`${preset.name}: no NaN on any frame`, check(!bad, bad));
  const at = start + preset.durationMs * 0.4;
  const frame = JSON.stringify(sceneAt(project, at, view));
  sceneAt(project, start + preset.durationMs * 0.9, view); sceneAt(project, start, view);
  it(`${preset.name}: scrubbing back to a moment gives the same frame`, check(JSON.stringify(sceneAt(project, at, view)) === frame));

  // its own layers are gone outside its clip — a sticker must not hang about elsewhere
  const own = (preset.layers ?? []).map((l) => l.id);
  const outside = own.length ? sceneAt(project, 100, view).filter((s) => own.includes(s.id)) : [];
  it(`${preset.name}: its layers are not on screen outside its clip`, check(outside.length === 0, outside.map((s) => s.name).join()));

  const baked = bakeLottie(presetPreviewProject(project, preset), { background: null, name: preset.name });
  it(`${preset.name}: exports to Lottie with nothing left out`, check(baked.skipped.length === 0, baked.skipped.join()));
}

// --- and each one really uses what it says it does ----------------------------------------
{
  const byId = (id: string) => SHOWCASE.find((p) => p.id === id)!;
  const tracksOf = (p: Preset, nodeId: string, prop?: string) => p.tracks.filter((t) => t.nodeId === nodeId && (!prop || t.property === prop));

  const hii = byId('p_hii');
  it('Hii! raises a rubber-hose hand by its point', check(tracksOf(hii, 'armR', 'limb.b.y').length === 1 && hii.layers!.some((l) => l.id === 'armR' && l.limb?.hose === 1)));
  it('and its "Hi!" is an SVG layer that pops in with overshoot inside a range', check(
    !!hii.layers!.find((l) => l.id === 'hiBubble')?.svg?.paths?.length
    && hii.appearances!.some((a) => a.nodeId === 'hiBubble' && a.startMs! > 0)
    && tracksOf(hii, 'hiBubble', 'transform.scale.x')[0].keyframes[0].easingOut.type === 'bezier'));

  const shift = byId('p_shapeshift');
  const shapes = tracksOf(shift, 'body', 'shape.path')[0].keyframes.map((k) => shapeIdOf(k.value as string));
  it('Shape Shifter morphs pebble → pill → blob → octopus', check(['pebble', 'capsule', 'blob', 'octopus'].every((s) => shapes.includes(s)), shapes.join()));

  const sticker = byId('p_sticker');
  it('Pop In Sticker attaches its sticker to the mascot and floats it', check(sticker.layers![0].parentId === 'body' && sticker.modifiers!.some((m) => m.nodeId === 'sticker' && m.kind === 'float')));
  it('from 0 to 115%, settling at 100%', check(tracksOf(sticker, 'sticker', 'transform.scale.x')[0].keyframes.slice(0, 4).map((k) => k.value).join() === '0,1.15,0.97,1'));

  // the flower goes round the rim and out of sight while its range still says "on screen"
  {
    const { project, start } = placed(byId('p_peek'));
    const seen = (t: number) => sceneAt(project, start + t, compOf(project)).some((s) => s.id === 'flower');
    it('Peek Around: the flower rides the surface — on screen, hidden past the rim, back again', check(seen(200) && !seen(1300) && seen(2400)));
  }

  const reveal = byId('p_newshape');
  it('New Shape! morphs into the octopus and brings arms and legs', check(
    shapeIdOf(tracksOf(reveal, 'body', 'shape.path')[0].keyframes[2].value as string) === 'octopus'
    && ['armL', 'armR', 'legL', 'legR'].every((id) => reveal.layers!.some((l) => l.id === id))));
  {
    const { project, start } = placed(reveal);
    const order = sceneAt(project, start + 1500, compOf(project)).map((s) => s.id);
    it('New Shape!: the badge draws on top of everything, the sparkle behind the body', check(
      order.at(-1) === 'newBadge' && order.indexOf('sparkle') < order.indexOf('body') || !order.includes('sparkle')));
  }

  const dance = byId('p_dance');
  it('Happy Dance drives hip-knee-ankle legs: knee and ankle both keyed', check(['legL', 'legR'].every((id) => tracksOf(dance, id, 'limb.b.x').length && tracksOf(dance, id, 'limb.c.y').length)));
  it('with squash on the body and particles', check(tracksOf(dance, 'body', 'transform.scale.y').length === 1 && (dance.emitters ?? []).length === 1));

  const magic = byId('p_reveal');
  const yaw = tracksOf(magic, 'orbitStar', 'surface.yaw')[0].keyframes.map((k) => k.value as number);
  it('Magical Reveal orbits its star round the head on the surface', check(magic.layers![0].surface.mapped && Math.max(...yaw) - Math.min(...yaw) > 300));
  it('grows the mascot, morphs it, and sends the star away', check(
    Math.min(...tracksOf(magic, 'body', 'transform.scale.x')[0].keyframes.map((k) => k.value as number)) < 0.62
    && tracksOf(magic, 'body', 'shape.path').length === 1 && tracksOf(magic, 'orbitStar', 'flatOffset.x').length === 1));
}

// --- a layer the user already owns is animated, never hidden or doubled ---------------------
{
  const ed = useEditor.getState();
  const base = defaultProject();
  base.rig.nodes.armR = makeLimb('arm', 1, 'body', { id: 'armR', name: 'My arm' });
  ed.loadProject(base);
  useEditor.getState().addBlock('p_hii');
  const p = useEditor.getState().project;
  it('placing Hii! reuses the arm that is already there', check(Object.values(p.rig.nodes).filter((n) => n.limb?.type === 'arm').length === 1 && p.rig.nodes.armR.name === 'My arm'));
  it('and does not narrow it to the clip', check(!(activeTimeline(p).appearances ?? []).some((a) => a.nodeId === 'armR')));
  it('so it is still there before the clip', check(sceneAt(p, 100, compOf(p)).some((s) => s.id === 'armR')));
  useEditor.getState().loadProject(defaultProject());
}
