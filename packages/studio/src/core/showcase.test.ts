import { it } from 'vitest';
import { appPresets } from './appPresets';
import { cinematicPresets } from './cinematicPresets';
import { mascotKitPresets } from './mascotKit';
import { check } from './testkit';
import { useEditor } from './store';
import { builtinPresets, defaultProject, presetPreviewProject } from './defaults';
import { compOf } from './comp';
import { sceneAt } from './scene';
import { shapeIdOf } from './emitters';
import { showcasePresets } from './showcase';
import { textPresets } from './textPresets';
import { makeLimb, makeTextLayer } from './layers';
import { bakeLottie } from '../export/lottie';
import { activeTimeline } from './types';
import type { Preset, Project } from './types';

const SHOWCASE = [...showcasePresets(), ...textPresets(), ...appPresets(), ...mascotKitPresets(), ...cinematicPresets()];

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

// --- several mascots in one clip -------------------------------------------------------------
{
  const byId = (id: string) => SHOWCASE.find((p) => p.id === id)!;
  {
    const { project, start } = placed(byId('p_friends'));
    const mid = sceneAt(project, start + 1600, compOf(project));
    const me = mid.find((s) => s.id === 'body'), pal = mid.find((s) => s.id === 'pal');
    it('Two Friends brings a second mascot, with eyes of its own', check(!!pal && mid.filter((s) => s.id.startsWith('pal.eye')).length === 2));
    it('standing clear of the first', check(!!me && !!pal && Math.abs(me.cx - pal.cx) > (me.w + pal.w) / 2, `${me?.cx}/${me?.w} ${pal?.cx}/${pal?.w}`));
  }
  {
    // placed on a second mascot, the words go round THAT mascot
    const ed = useEditor.getState();
    ed.loadProject(defaultProject());
    const m2 = useEditor.getState().addMascot('default');
    useEditor.getState().addBlock('p_around', undefined, m2);
    const p = useEditor.getState().project;
    it('Around You on a second mascot runs its words round that mascot', check(p.rig.nodes[`${m2}:aroundText`]?.text?.path?.nodeId === m2));
  }
  {
    const { project, start } = placed(byId('p_follow'));
    it('Follow Me: the friend is the mascot\'s child', check(project.rig.nodes.buddy?.parentId === 'body'));
    const x = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'buddy')?.cx ?? NaN;
    it('so it goes wherever the mascot goes', check(x(1500) - x(300) > 80, `${x(300)} → ${x(1500)}`));
  }
  {
    const { project, start } = placed(byId('p_crowd'));
    const bodies = sceneAt(project, start + 1200, compOf(project)).filter((s) => project.rig.nodes[s.id]?.kind === 'body');
    it('Crowd: five mascots on screen at once', check(bodies.length === 5, String(bodies.length)));
  }
}

// --- words ---------------------------------------------------------------------------------------
{
  const byId = (id: string) => SHOWCASE.find((p) => p.id === id)!;
  {
    const { project, start } = placed(byId('p_txt_ring'));
    const ring = (t: number) => JSON.stringify(sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'ringText')?.glyphs?.[0]);
    it('NEW SHAPE runs round a circle, and turns', check(project.rig.nodes.ringText.text!.path!.mode === 'arc' && ring(1000) !== ring(2000)));
  }
  {
    const preset = byId('p_txt_path');
    const { project, start } = placed(preset);
    // glyphs sit relative to the item's centre, so where the first letter is on screen is both
    const at = (t: number) => {
      const s = sceneAt(project, start + t, compOf(project)).find((i) => i.id === 'followCaption');
      return s?.glyphs?.[0] ? s.cx + s.glyphs[0].x : undefined;
    };
    it('Path Follow: the words travel along their curve', check((at(2000) ?? 0) - (at(500) ?? 0) > 100, `${at(500)} → ${at(2000)}`));
    const baked = JSON.stringify(bakeLottie(presetPreviewProject(project, preset), { background: null, name: 'x' }));
    it('and the curve is a guide, left out of the export', check(!baked.includes('Follow path')));
  }
  {
    const { project, start } = placed(byId('p_txt_lookhere'));
    const curve = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'lookPath');
    const [a, b] = [curve(300), curve(950)];
    it('LOOK HERE: the curve under the words is itself animated', check(!!a && !!b && JSON.stringify(a) !== JSON.stringify(b), `${!!a} ${!!b}`));
  }
  {
    // on a text of the user's: that text rather than a copy, and all of it typed
    const base = defaultProject();
    base.rig.nodes.mine = makeTextLayer('Good morning', { id: 'mine' });
    const ed = useEditor.getState();
    ed.loadProject(base);
    useEditor.getState().select(['mine']);
    useEditor.getState().addBlock('p_txt_type');
    const p = useEditor.getState().project;
    const reveal = activeTimeline(p).tracks.find((t) => t.nodeId === 'mine' && t.property === 'text.reveal.end');
    it('a text preset on a selected text animates that text', check(!p.rig.nodes.caption && !!reveal));
    it('and the typewriter types all of it', check(reveal?.keyframes.at(-1)?.value === 'Good morning'.length, String(reveal?.keyframes.at(-1)?.value)));
    it('and never hides it outside the clip', check(!(activeTimeline(p).appearances ?? []).some((a) => a.nodeId === 'mine')));
    useEditor.getState().addBlock('p_txt_pop');
    const kinds = activeTimeline(useEditor.getState().project).tracks.filter((t) => t.nodeId === 'mine' && t.property === 'text.chars.kind');
    it('Pop In on it keys its letter motion', check(kinds.length === 1 && kinds[0].keyframes[0].value === 'pop'));
    useEditor.getState().loadProject(defaultProject());
  }
}

// --- the cinematic ten: each is built from the systems it names -------------------------------
{
  const cine = cinematicPresets();
  const byId = (id: string) => cine.find((p) => p.id === id)!;
  const layer = (p: Preset, id: string) => p.layers!.find((l) => l.id === id)!;
  const has = (p: Preset, prop: string) => p.tracks.some((t) => t.property.startsWith(prop));
  it('there are ten', check(cine.length === 10 && new Set(cine.map((p) => p.id)).size === 10));
  it('no two presets bring a different layer under the same id', check((() => {
    const seen = new Map<string, string>();
    for (const p of cine.slice(0, 9)) for (const l of p.layers ?? []) {
      if (/^(arm|leg)[LR]$/.test(l.id)) continue;
      if (seen.has(l.id)) return false;
      seen.set(l.id, p.id);
    }
    return true;
  })()));

  const portal = byId('p_cine_portal');
  it('Portal: glow + gradient ring, sparks, camera shake and zoom', check(!!layer(portal, 'portalRing').gradient && layer(portal, 'portalGlow').blend === 'screen'
    && portal.emitters![0].path === 'burst' && portal.modifiers!.some((m) => m.kind === 'shake' && m.nodeId === '__camera') && has(portal, 'camera.zoom')));
  const morph = byId('p_cine_morph');
  it('Morph: shape keys, jelly and follow-through', check(has(morph, 'shape.path') && ['jelly', 'follow'].every((k) => morph.modifiers!.some((m) => m.kind === k))));
  const walk = byId('p_cine_walk');
  it('Walk: a walk modifier, and scenery at several depths', check(walk.modifiers!.some((m) => m.kind === 'walk') && new Set(walk.layers!.map((l) => l.depth?.z ?? 0)).size >= 3));
  const glitch = byId('p_cine_glitch');
  it('Glitch: a masked screen with scanlines, tearing keyed down', check(layer(glitch, 'glitchScreen').mask?.nodeId === 'glitchWipe' && has(glitch, 'effect.slices.amount')
    && layer(glitch, 'glitchScreen').effects!.some((e) => e.kind === 'scanlines')));
  const doodle = byId('p_cine_doodle');
  it('Doodle: tapered, boiling strokes drawn on with trim', check(doodle.layers!.filter((l) => l.curve).every((l) => (l.stroke?.taper ?? 0) > 0 && l.effects?.some((e) => e.kind === 'jitter')) && has(doodle, 'trim.end')));
  const title = byId('p_cine_title');
  it('Title: every letter of BLOOBY keyed on its own', check([0, 1, 2, 3, 4, 5].every((i) => has(title, `text.char.${i}.y`))));
  it('and no letter track has two keys at one time', check(title.tracks.every((t) => new Set(t.keyframes.map((x) => x.time)).size === t.keyframes.length)));
  const flip = byId('p_cine_flip');
  it('Flip: cards turn on rotateY in depth, the mascot spins its sphere', check(has(flip, 'depth.rotateY') && has(flip, 'depth.z') && flip.tracks.some((t) => t.nodeId === 'body' && t.property === 'depth.rotateY')));
  const reel = byId('p_cine_showreel');
  it('Showreel: about twenty seconds, joined from the others', check(reel.durationMs >= 20000 && reel.durationMs <= 22000 && ['portalRing', 'walkGround', 'glitchScreen', 'morphAura', 'assembleWord'].every((id) => reel.layers!.some((l) => l.id === id))));
  it('Showreel: its keys stay in order across the joins', check(reel.tracks.every((t) => t.keyframes.every((x, i) => i === 0 || x.time >= t.keyframes[i - 1].time))));

  // behaviour, on a placed clip
  {
    const { project, start } = placed(walk);
    const bodyX = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'body')!.cx;
    const treeX = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'walkTree1')?.cx ?? NaN;
    it('Walk: the camera keeps the walking mascot framed', check(Math.abs(bodyX(3500) - 360) < 60, String(bodyX(3500))));
    it('while the scenery slides past', check(treeX(3500) < treeX(800) - 100, `${treeX(800)} → ${treeX(3500)}`));
  }
  {
    const { project, start } = placed(byId('p_cine_particles'));
    const scene = sceneAt(project, start + 3300, compOf(project));
    const word = scene.find((s) => s.id === 'assembleWord');
    const bits = scene.filter((s) => /#/.test(s.id));
    it('Particles: at 3.3s the particles sit on the word', check(!!word && bits.length > 100 && bits.filter((b) => Math.abs(b.cx - word.cx) < 260 && Math.abs(b.cy - word.cy) < 90).length > bits.length * 0.8));
  }
  {
    const { project, start } = placed(reel);
    const body = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'body');
    // the portal opens with no mascot; the walk after it must not inherit that
    it('Showreel: the mascot is there when the walk begins', check(!!body(4300) && body(4300)!.w > 200, String(body(4300)?.w)));
    // the walk's travel ends with its part: back at the centre for the glitch
    it('Showreel: the walk does not carry the mascot off into the next part', check(Math.abs(body(9000 + 1200)!.cx - 360) < 40, String(body(10200)?.cx)));
    const order = sceneAt(project, start + 1000, compOf(project)).map((s) => s.id);
    it('a preset layer with a negative zIndex sits behind the mascot', check(order.indexOf('portalRing') < order.indexOf('body') && order.indexOf('portalRing') >= 0, order.join()));
  }
  {
    const { project, start } = placed(glitch);
    const at = (t: number) => sceneAt(project, start + t, compOf(project)).find((s) => s.id === 'glitchScreen');
    it('Glitch: the screen is clipped by the wipe', check(!!at(1500)?.clip?.d));
  }
}
