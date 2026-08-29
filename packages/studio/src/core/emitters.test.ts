import { it } from 'vitest';
import { check } from './testkit';
import { buildScene, composeScene, emitterFrame, emitterItems, evaluateRig, scopeSpan, scopeTime } from './scene';
import { builtinPresets, confetti, defaultProject } from './defaults';
import { CONFETTI_COLORS, shapeById, shapeResolver, SHAPE_LIBRARY } from './emitters';
import { characteristicTime } from './timeline';
import { useEditor } from './store';
import { activeTimeline } from './types';

// --- pendulum, and the range an effect runs in ----------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const bodyAt = (t: number) => buildScene(evaluateRig(P(), t), { width: 720, height: 720 }).find((s) => s.id === 'body')!;

  const base = Array.from({ length: 9 }, (_, i) => bodyAt(i * 120).rotation);
  ed().addModifier({ nodeId: 'body', kind: 'pendulum', amount: 100, frequency: 1, amplitude: 12 });
  const swung = Array.from({ length: 9 }, (_, i) => bodyAt(i * 120).rotation);
  it('a pendulum swings the body on rotation', check(swung.some((r, i) => Math.abs(r - base[i]) > 1)));
  it('and swings BOTH ways, which is what makes it a pendulum', check(Math.max(...swung.map((r, i) => r - base[i])) > 1 && Math.min(...swung.map((r, i) => r - base[i])) < -1, swung.map((r, i) => (r - base[i]).toFixed(1)).join(' ')));

  // the axis is a dial: the same modifier on 'x' must move it, not turn it
  const id = activeTimeline(P()).modifiers[0].id;
  ed().updateModifier(id, (m) => { m.axis = 'x'; });
  const onX = Array.from({ length: 9 }, (_, i) => bodyAt(i * 120));
  it('axis "x" slides instead of rotating', check(onX.every((s, i) => Math.abs(s.rotation - base[i]) < 1e-6) && onX.some((s) => Math.abs(s.cx - onX[0].cx) > 1)));

  // a range narrows when it runs, measured from the start of its scope
  ed().updateModifier(id, (m) => { m.axis = 'rotation'; m.startMs = 1000; m.endMs = 2000; });
  it('before the range, the effect is not running', check(Math.abs(bodyAt(500).rotation - base[4]) < 1e-6));
  it('after the range, the effect is not running', check(Math.abs(bodyAt(2600).rotation - bodyAt(2600).rotation) < 1e-6
      && Math.abs(bodyAt(2400).rotation - buildScene(evaluateRig({ ...P(), timelines: P().timelines.map((t) => ({ ...t, modifiers: [] })) }, 2400), { width: 720, height: 720 }).find((s) => s.id === 'body')!.rotation) < 1e-6));
  const inside = Array.from({ length: 6 }, (_, i) => bodyAt(1000 + i * 150).rotation);
  it('inside the range it swings', check(Math.max(...inside) - Math.min(...inside) > 1, inside.map((r) => r.toFixed(1)).join(' ')));

  // and it starts AT REST rather than picking up mid-swing
  const tl0 = activeTimeline(P());
  it('the range start is the effect\u2019s own zero', check(scopeTime(tl0, { startMs: 1000, endMs: 2000 }, 1000) === 0));
  it('and outside it there is no time at all', check(scopeTime(tl0, { startMs: 1000, endMs: 2000 }, 999) === null && scopeTime(tl0, { startMs: 1000, endMs: 2000 }, 2001) === null));

  ed().loadProject(defaultProject());
}

// --- emitters: one engine for zzz, notes, tears, orbits and confetti -------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const at = (t: number) => {
    const rig = evaluateRig(P(), t);
    return emitterItems(activeTimeline(P()), rig, buildScene(rig, VIEW), t, VIEW);
  };

  ed().addEmitter({
    name: 'zzz', glyphs: ['z', 'z', 'z'], color: { r: 90, g: 90, b: 110, a: 1 }, size: 26,
    path: 'arc', from: { nodeId: 'eyeR', x: 14, y: -18 }, to: { x: 90, y: -120 }, bow: 18,
    rateMs: 420, lifeMs: 1800, count: 4, fadeStart: 0.45,
    scaleFrom: 0.6, scaleTo: 1.25, spin: 10, wobble: 4, wobbleFrequency: 1.4, seed: 3,
  });

  const t0 = at(900);
  it('an emitter puts particles on screen', check(t0.length > 0, String(t0.length)));
  it('and they are glyphs, not shapes', check(t0.every((i) => i.text === 'z')));
  it('staggered, not stacked', check(new Set(t0.map((i) => Math.round(i.cx * 10))).size === t0.length));

  // pure function of time: the same t must give the same picture, in any order
  const a1 = JSON.stringify(at(1234)), a2 = JSON.stringify(at(1234));
  it('sceneAt(t) is answerable for any t, repeatably', check(a1 === a2));
  it('and scrubbing backwards is identical to arriving forwards', check(JSON.stringify(at(700)) === (at(1500), JSON.stringify(at(700)))));

  // the fade actually fades, AND shrinks — fading alone reads as popping out
  const sampled = Array.from({ length: 44 }, (_, i) => at(400 + i * 60)).flat();
  const alphas = sampled.map((i) => i.color.a);
  it('particles fade rather than vanishing', check(Math.min(...alphas) < 0.5 && Math.max(...alphas) > 0.9, `${Math.min(...alphas).toFixed(2)}..${Math.max(...alphas).toFixed(2)}`));
  // The shrink is deliberately late: shrinking across the whole fade cancels the growth a
  // glyph is authored with, which is how zzz came to export at a third of their size. So
  // sample where the particle is nearly gone, not merely fading.
  // measured against the faintest sample there is, rather than a threshold that may not
  // be reached: the point is that the last thing on screen is not full size
  const faintest = sampled.reduce((a, c) => (c.color.a < a.color.a ? c : a));
  const solid = sampled.filter((i) => i.color.a > 0.9);
  it('and shrink away at the end, so none of them pops out at full size', check(solid.length > 0 && faintest.w < Math.max(...solid.map((i) => i.w)), `faintest ${faintest.w.toFixed(1)}@${faintest.color.a.toFixed(2)} vs solid ${Math.max(...solid.map((i) => i.w)).toFixed(1)}`));

  // anchoring is the whole trick behind tears: move the eye, the source moves with it
  const eid = activeTimeline(P()).emitters![0].id;
  const youngest = (ts: number) => at(ts).reduce((a, b) => (a.color.a > b.color.a ? a : b));
  const before = youngest(420);
  ed().commit((p) => { p.rig.nodes.eyeR.surface.yaw += 26; });
  const after = youngest(420);
  it('an anchored source follows the layer it is attached to', check(Math.abs(after.cx - before.cx) > 4, `${before.cx.toFixed(1)} -> ${after.cx.toFixed(1)}`));
  ed().commit((p) => { p.rig.nodes.eyeR.surface.yaw -= 26; });

  // a free anchor does not
  ed().updateEmitter(eid, (e) => { e.from = { x: 0, y: 0 }; });
  const free = youngest(420);
  ed().commit((p) => { p.rig.nodes.eyeR.surface.yaw += 26; });
  it('an unanchored source stays put', check(Math.abs(youngest(420).cx - free.cx) < 1e-6));
  ed().commit((p) => { p.rig.nodes.eyeR.surface.yaw -= 26; });

  // orbit closes on itself — that is what makes it an orbit and not a line
  ed().updateEmitter(eid, (e) => { e.path = 'orbit'; e.radiusX = 70; e.radiusY = 40; e.wobble = 0; e.fadeStart = 1; });
  const ring = Array.from({ length: 24 }, (_, i) => at(i * 80)).flat();
  const cx0 = ring[0].cx;
  it('an orbit comes back round to where it started', check(Math.abs(Math.max(...ring.map((i) => i.cx)) - Math.min(...ring.map((i) => i.cx))) > 100
      && ring.some((i) => Math.abs(i.cx - cx0) < 2)));

  // emitters must reach the exporter, not just the stage
  ed().updateEmitter(eid, (e) => { e.path = 'arc'; });
  const composed = composeScene(P(), evaluateRig(P(), 900), 900, VIEW);
  // 'z' is drawn as the library's Z rather than typed, so the particle carries artwork
  const particle = (i: { text?: string; svg?: unknown; id: string }) => i.id.startsWith(eid);
  it('composeScene carries them alongside the rig', check(composed.some(particle) && composed.some((i) => i.id === 'body')));
  it('and draws them in front of the mascot', check(composed.findIndex(particle) > composed.findIndex((i) => i.id === 'body')));

  // scoped like a modifier
  ed().updateEmitter(eid, (e) => { e.startMs = 1000; e.endMs = 1600; });
  it('an emitter respects its range exactly', check(at(500).length === 0 && at(1200).length > 0 && at(1700).length === 0));
  // the exit happens INSIDE the range: the last stretch fades and shrinks to nothing, so
  // the range is exactly what it says AND its end is animated rather than a switch
  const fading = at(1500);
  it('and fades out over the last of it, rather than switching off', check(fading.length > 0 && Math.max(...fading.map((i) => i.color.a)) < Math.max(...at(1200).map((i) => i.color.a)), `${Math.max(...at(1200).map((i) => i.color.a)).toFixed(2)} -> ${Math.max(...fading.map((i) => i.color.a)).toFixed(2)}`));

  ed().loadProject(defaultProject());
  it('a project with no emitters costs nothing', check(emitterItems(activeTimeline(P()), P().rig, [], 0, VIEW).length === 0));
}

// --- the trajectory handles land where the particles actually come out ----------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };

  ed().addEmitter({
    name: 'probe', glyphs: ['z'], color: { r: 0, g: 0, b: 0, a: 1 }, size: 20,
    path: 'arc', from: { nodeId: 'eyeL', x: -6, y: 10 }, to: { x: 90, y: -120 }, bow: 0,
    rateMs: 200, lifeMs: 400, count: 2, fadeStart: 1,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1,
  });
  it('adding an emitter selects it, so its handles are immediately on the stage', check(ed().selectedEmitterId === (activeTimeline(P()).emitters ?? []).at(-1)!.id));

  const em = activeTimeline(P()).emitters!.at(-1)!;
  const rig = evaluateRig(P(), 0);
  const base = buildScene(rig, VIEW);
  const f = emitterFrame(rig, base, VIEW);

  // With one slot, no bow and no wander, the particle halfway through its life must sit
  // exactly halfway between the two handles. If the handles and the evaluator disagree
  // about the mapping, a handle is drawn next to the stream rather than on it.
  //
  // Not tested at u=0: a particle is faded in over its first 12%, so at birth it is
  // invisible and emitterItems drops it — which is correct, and cost this check a
  // rewrite before it was measuring the right thing.
  ed().updateEmitter(em.id, (x) => { x.count = 1; x.rateMs = x.lifeMs; });
  const start = f.anchor(em.from), end = f.anchor(em.to);
  const mid = emitterItems(activeTimeline(P()), rig, base, em.lifeMs / 2, VIEW)[0];
  it('the handles and the particles agree about where the path is', check(!!mid && Math.abs(mid.cx - (start.x + end.x) / 2) < 0.01 && Math.abs(mid.cy - (start.y + end.y) / 2) < 0.01, mid ? `${mid.cx.toFixed(2)},${mid.cy.toFixed(2)} vs ${((start.x + end.x) / 2).toFixed(2)},${((start.y + end.y) / 2).toFixed(2)}` : 'no particle'));

  // dragging is anchor -> screen -> anchor, and must round-trip
  const round = f.toOffset(em.from, f.anchor(em.from));
  it('screen position round-trips back to the same offset', check(Math.abs(round.x - em.from.x) < 1e-6 && Math.abs(round.y - em.from.y) < 1e-6, JSON.stringify(round)));

  // and the pinned end moves with its layer, which is what pinning is for
  const wasAnchored = f.anchor(em.from).x;
  ed().commit((p) => { p.rig.nodes.eyeL.surface.yaw -= 25; });
  const rig2 = evaluateRig(P(), 0);
  const f2 = emitterFrame(rig2, buildScene(rig2, VIEW), VIEW);
  it('a pinned handle tracks its layer', check(Math.abs(f2.anchor(em.from).x - wasAnchored) > 4));

  ed().removeEmitter(em.id);
  it('removing it clears the selection, so no handles are left pointing at nothing', check(ed().selectedEmitterId === null));

  // the range bar spans the clip when clip-scoped, the timeline otherwise
  const tl = activeTimeline(P());
  it('a global effect ranges over the whole timeline', check(scopeSpan(tl, undefined)[1] === tl.timelineDurationMs));
  const clip = tl.blocks[1];
  it('a clip-scoped one ranges over just that clip', check(scopeSpan(tl, clip.id)[1] === clip.durationMs, `${scopeSpan(tl, clip.id)[1]} vs ${clip.durationMs}`));
  it('and a clip that no longer exists falls back to the timeline rather than crashing', check(scopeSpan(tl, 'gone')[1] === tl.timelineDurationMs));

  ed().loadProject(defaultProject());
}

// --- emitters throw drawn shapes, at varied speeds, on an eased path -------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const items = (t: number) => {
    const rig = evaluateRig(P(), t);
    return emitterItems(activeTimeline(P()), rig, buildScene(rig, VIEW), t, VIEW, shapeResolver(P().svgAssets));
  };

  // every built-in shape must be real, findable artwork
  it('the library is populated', check(SHAPE_LIBRARY.length >= 12));
  it('every entry has a viewBox and markup', check(SHAPE_LIBRARY.every((e) => /\d/.test(e.viewBox) && e.markup.includes('<'))));
  it('and every one is reachable by id', check(SHAPE_LIBRARY.every((e) => shapeById(e.id) === e)));
  it('tintable artwork paints with currentColor', check(SHAPE_LIBRARY.filter((e) => e.tint).every((e) => e.markup.includes('currentColor'))));

  // every part referenced by a built-in preset must resolve, or it renders as nothing
  const missing: string[] = [];
  for (const preset of builtinPresets()) {
    for (const e of preset.emitters ?? []) {
      for (const pt of e.parts ?? []) {
        if (pt.shapeId && !shapeById(pt.shapeId)) missing.push(`${preset.name}/${pt.shapeId}`);
      }
    }
  }
  it('every built-in preset points at artwork that exists', check(missing.length === 0, missing.join(', ')));

  ed().addEmitter({
    name: 'probe', glyphs: [], color: { r: 10, g: 10, b: 10, a: 1 }, size: 20,
    parts: [
      { id: 'a', shapeId: 'drop', weight: 1, speed: 1, sizeScale: 1, spin: 0 },
      { id: 'b', shapeId: 'streamer', color: { r: 200, g: 30, b: 30, a: 1 }, weight: 1, speed: 1, sizeScale: 2, spin: 0 },
    ],
    path: 'fall', from: { nodeId: 'body', x: 0, y: -80 }, to: { nodeId: 'body', x: 0, y: 120 }, bow: 0,
    rateMs: 200, lifeMs: 1200, count: 6, fadeStart: 0.9,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1, seed: 4,
  });

  const shown = items(700);
  it('parts render as artwork, not characters', check(shown.length > 0 && shown.every((i) => !!i.svg && i.text === undefined)));
  it('and cycle through the parts', check(new Set(shown.map((i) => i.svg!.viewBox)).size === 2, [...new Set(shown.map((i) => i.svg!.viewBox))].join(' | ')));
  it('a part can carry its own colour', check(shown.some((i) => i.color.r > 150) && shown.some((i) => i.color.r < 50)));
  it('and its own size', check(new Set(shown.map((i) => Math.round(i.w))).size > 1));

  // speed variation is deterministic: scrubbing back must give the same picture
  const eid = activeTimeline(P()).emitters!.at(-1)!.id;
  ed().updateEmitter(eid, (x) => { x.speedJitter = 0.6; });
  const a1 = JSON.stringify(items(900).map((i) => Math.round(i.cy)));
  items(1500);
  it('varied speeds stay deterministic', check(JSON.stringify(items(900).map((i) => Math.round(i.cy))) === a1));
  ed().updateEmitter(eid, (x) => { x.speedJitter = 0; });
  const even = items(900).map((i) => Math.round(i.cy));
  ed().updateEmitter(eid, (x) => { x.speedJitter = 0.6; });
  const varied = items(900).map((i) => Math.round(i.cy));
  it('and they genuinely vary the stream', check(JSON.stringify(even) !== JSON.stringify(varied)));

  // easing shapes the journey rather than the spawn rate
  ed().updateEmitter(eid, (x) => { x.speedJitter = 0; x.easing = { type: 'linear' }; });
  const lin = items(600)[0].cy;
  ed().updateEmitter(eid, (x) => { x.easing = { type: 'preset', name: 'easeIn' }; });
  it('easing changes where a particle is at a given moment', check(Math.abs(items(600)[0].cy - lin) > 1));

  // confetti is the shared builder, in paper colours
  const cf = confetti('body');
  it('confetti is many parts in many colours', check((cf.parts ?? []).length >= 10 && new Set((cf.parts ?? []).map((p) => JSON.stringify(p.color))).size === CONFETTI_COLORS.length));
  it('and paper shapes rather than squares', check((cf.parts ?? []).every((p) => ['streamer', 'curl', 'chip'].includes(p.shapeId ?? ''))));

  ed().loadProject(defaultProject());
}

// --- a snapped anchor rides the shape it is pinned to -----------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const frameNow = () => {
    const rig = evaluateRig(P(), 0);
    return { f: emitterFrame(rig, buildScene(rig, VIEW), VIEW), scene: buildScene(rig, VIEW) };
  };

  const { f, scene } = frameNow();
  const eye = scene.find((i) => i.id === 'eyeL')!;

  // relative: (1,0) is the layer's right edge, whatever that edge currently is
  const snapped = { nodeId: 'eyeL', x: 1, y: 0, rel: true };
  const at0 = f.anchor(snapped);
  it('a snapped point sits on the edge it was dropped on', check(Math.abs(at0.x - (eye.cx + eye.w / 2)) < 0.01 && Math.abs(at0.y - eye.cy) < 0.01, `${at0.x.toFixed(1)} vs ${(eye.cx + eye.w / 2).toFixed(1)}`));

  // the whole point: it must move when the shape changes size, not stay where the edge was
  ed().commit((p) => { p.rig.nodes.eyeL.transform.scale.x = 2.2; });
  const after = frameNow();
  const eye2 = after.scene.find((i) => i.id === 'eyeL')!;
  it('and follows that edge when the layer is scaled', check(Math.abs(after.f.anchor(snapped).x - (eye2.cx + eye2.w / 2)) < 0.01
      && Math.abs(after.f.anchor(snapped).x - at0.x) > 4, `${at0.x.toFixed(1)} -> ${after.f.anchor(snapped).x.toFixed(1)}`));

  // an unsnapped point measures in rig units and does NOT follow the size
  const free = { nodeId: 'eyeL', x: 20, y: 0 };
  const freeBefore = after.f.anchor(free);
  ed().commit((p) => { p.rig.nodes.eyeL.transform.scale.x = 3.4; });
  const after2 = frameNow();
  it('while a free point keeps its own offset', check(Math.abs(after2.f.anchor(free).x - freeBefore.x) < 0.01));

  // and the round trip a drag performs still holds for both kinds
  it('a snapped offset round-trips', check((() => {
      const o = after2.f.toOffset(snapped, after2.f.anchor(snapped));
      return Math.abs(o.x - 1) < 1e-6 && Math.abs(o.y) < 1e-6;
    })()));

  ed().loadProject(defaultProject());
}

// --- an orbit leaves the same way everything else does ----------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const at = (t: number) => {
    const rig = evaluateRig(P(), t);
    return emitterItems(activeTimeline(P()), rig, buildScene(rig, VIEW), t, VIEW, shapeResolver(P().svgAssets));
  };

  ed().addEmitter({
    name: 'ring', glyphs: [], parts: [{ id: 'r', shapeId: 'star', weight: 1, speed: 1, sizeScale: 1, spin: 0 }],
    color: { r: 0, g: 0, b: 0, a: 1 }, size: 18, path: 'orbit',
    from: { nodeId: 'body', x: 0, y: -120 }, to: { x: 0, y: 0 }, bow: 0, radiusX: 90, radiusY: 90,
    rateMs: 500, lifeMs: 1200, count: 4, fadeStart: 1,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1,
    startMs: 0, endMs: 1500,
  });

  // an orbit has no births to stop, so ending its range used to blink the whole ring off
  const mid = at(700), late = at(1350), out = at(1600);
  it('an orbit runs full strength while orbiting', check(mid.length === 4 && mid.every((i) => Math.abs(i.color.a - 1) < 1e-6), `${mid.length} @ ${mid[0]?.color.a}`));
  it('and never shrinks on its way round', check(new Set(mid.map((i) => Math.round(i.w * 100))).size === 1, mid.map((i) => i.w.toFixed(1)).join(' ')));
  it('fading and shrinking only when it is time to go', check(late.length === 4 && Math.max(...late.map((i) => i.color.a)) < 1
      && Math.max(...late.map((i) => i.w)) < Math.max(...mid.map((i) => i.w)), `a ${Math.max(...late.map((i) => i.color.a)).toFixed(2)}, w ${Math.max(...mid.map((i) => i.w)).toFixed(1)} -> ${Math.max(...late.map((i) => i.w)).toFixed(1)}`));
  it('and gone by the end of its range, never past it', check(out.length === 0, String(out.length)));

  // a preset whose point IS its emitter must not be iconified as a plain face
  for (const id of ['p_sleepy', 'p_singing', 'p_crying', 'p_notify']) {
    const preset = builtinPresets().find((x) => x.id === id)!;
    const t = characteristicTime(preset);
    const running = (preset.emitters ?? []).some((e) => t >= (e.startMs ?? 0) && t <= (e.endMs ?? preset.durationMs));
    it(`${preset.name}'s icon is a moment when its emitter is running`, check(running, `t=${Math.round(t)} of ${preset.durationMs}`));
  }

  ed().loadProject(defaultProject());
}
