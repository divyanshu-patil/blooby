import { it } from 'vitest';
import { check } from '../core/testkit';
import { buildScene, evaluateRig } from '../core/scene';
import { builtinPresets, defaultProject } from '../core/defaults';
import { primitivePath } from '../core/path';
import { derivedDuration } from '../core/timeline';
import { bakeLottie } from './lottie';
import { useEditor } from '../core/store';
import { activeTimeline } from '../core/types';

// --- lottie bake: does the baked file actually reproduce the scene? ------------
{
  const store = defaultProject();
  const stl = activeTimeline(store);
  // add two more blocks and a shake so the bake has curvature, easing and noise in it
  for (const name of ['Surprised', 'Thinking']) {
    const preset = store.presets.find((x) => x.name === name)!;
    const start = stl.blocks.reduce((s2, b) => s2 + b.durationMs, 0);
    const blockId = `b_${name}`;
    stl.blocks.push({ id: blockId, presetId: preset.id, name, durationMs: preset.durationMs });
    for (const t of preset.tracks) {
      stl.tracks.push({ ...t, id: `t_${name}_${t.nodeId}_${t.property}`, blockId, keyframes: t.keyframes.map((k) => ({ ...k, time: k.time + start })) });
    }
  }
  stl.modifiers.push({ id: 'm1', nodeId: 'body', kind: 'shake', amount: 80, frequency: 9, amplitude: 5, seed: 3 });
  stl.timelineDurationMs = derivedDuration(stl);

  const baked = bakeLottie(store, { background: '#17161b', name: 'test' });
  const j = baked.json as Record<string, any>;
  it('lottie fps + size', check(j.fr === store.fps && j.w === 720 && j.h === 720));
  it('lottie duration in frames', check(j.op === Math.round((stl.timelineDurationMs / 1000) * store.fps), `${j.op}`));
  it('lottie has a layer per shape plus backdrop', check(j.layers.length === 4, String(j.layers.length)));
  it('the default file opens on a real timeline', check(stl.blocks.length === 6 && stl.tracks.length > 12, `${stl.blocks.length} blocks, ${stl.tracks.length} tracks`));
  it('lottie layer indices are 1..n', check(j.layers.every((l: any, i: number) => l.ind === i + 1)));

  // the backdrop is whatever colour the caller asked for — the stage's own, not a constant
  const tinted = bakeLottie(store, { background: '#ff8800', name: 'test' }).json as Record<string, any>;
  const backdrop = (x: Record<string, any>) => x.layers.find((l: any) => l.ty === 1);
  it('the backdrop takes the requested colour', check(backdrop(tinted)?.sc === '#ff8800', backdrop(tinted)?.sc));
  it('and is absent when there is none', check(!backdrop(bakeLottie(store, { background: null, name: 'test' }).json as Record<string, any>)));

  const shapeLayers = j.layers.filter((l: any) => l.ty === 4);
  for (const l of shapeLayers) {
    const geo = l.shapes[0].it[0];
    it('only ellipses and rounded rects', check(geo.ty === 'el' || geo.ty === 'rc', geo.ty));
    // a pill carries its own animated size and radius rather than being scaled, so the
    // invariant has to hold on every keyframe, not just on one static pair
    if (geo.ty === 'rc') {
      // size and radius are reduced independently, so they do not share keyframe indices —
      // sample the radius at each size keyframe's own time rather than pairing by position
      const at = (pr: any, t: number): number[] => {
        if (pr.a === 0) return Array.isArray(pr.k) ? pr.k : [pr.k];
        const ks2 = pr.k;
        if (t <= ks2[0].t) return ks2[0].s;
        if (t >= ks2[ks2.length - 1].t) return ks2[ks2.length - 1].s;
        let i2 = 0;
        while (i2 < ks2.length - 1 && ks2[i2 + 1].t <= t) i2++;
        const u2 = (t - ks2[i2].t) / (ks2[i2 + 1].t - ks2[i2].t);
        return ks2[i2].s.map((v: number, d: number) => v + (ks2[i2 + 1].s[d] - v) * u2);
      };
      const times: number[] = geo.s.a === 1 ? geo.s.k.map((x: any) => x.t) : [0];
      it('corner radius is min/2 — never a sharp angle', check(times.every((t) => {
            const sz = at(geo.s, t);
            // 0.35px covers both channels' own 0.2px reduction tolerance and nothing more:
            // the bug this catches drifted by tens of pixels
            return Math.abs(at(geo.r, t)[0] - Math.min(sz[0], sz[1]) / 2) < 0.35;
          }), `${times.length} frames`));
    }
    for (const key of ['p', 's', 'r', 'o'] as const) {
      const pr = l.ks[key];
      if (pr.a !== 1) continue;
      const times = pr.k.map((x: any) => x.t);
      it('keyframe times strictly ascending', check(times.every((t: number, i: number) => i === 0 || t > times[i - 1])));
      it('every keyframe value is finite', check(pr.k.every((x: any) => x.s.every((v: number) => Number.isFinite(v)))));
      it('non-final keys carry tangents', check(pr.k.slice(0, -1).every((x: any) => x.i && x.o)));
      it('final key carries none', check(pr.k[pr.k.length - 1].i === undefined));
    }
  }
  it('simplification removed frames', check(baked.keyframeCount < baked.frames * shapeLayers.length * 4, `${baked.keyframeCount} keys over ${baked.frames} frames`));

  // read the baked file back the way a player would and compare against the scene
  const readProp2 = (pr: any, frame: number): number[] => {
    if (pr.a !== 1) return Array.isArray(pr.k) ? pr.k : [pr.k];
    const ks = pr.k;
    if (frame <= ks[0].t) return ks[0].s;
    if (frame >= ks[ks.length - 1].t) return ks[ks.length - 1].s;
    let i = 0;
    while (i < ks.length - 1 && ks[i + 1].t <= frame) i++;
    const a2 = ks[i], b2 = ks[i + 1];
    const u = (frame - a2.t) / (b2.t - a2.t);
    return a2.s.map((v: number, d: number) => v + (b2.s[d] - v) * u);
  };

  let worst = 0;
  for (let f = 0; f <= baked.frames; f++) {
    const truth = buildScene(evaluateRig(store, (f / store.fps) * 1000), { width: 720, height: 720 });
    for (const l of shapeLayers) {
      const item = truth.find((t2) => t2.name === l.nm);
      if (!item) continue;
      const [px, py] = readProp2(l.ks.p, f);
      worst = Math.max(worst, Math.abs(px - item.cx), Math.abs(py - item.cy));
      const [sx2, sy2] = readProp2(l.ks.s, f);
      const geo = l.shapes[0].it[0];
      // a pill's size is on the rect itself; everything else scales its base geometry
      const [bw, bh] = geo.s.a === 1 ? readProp2(geo.s, f) : geo.s.k;
      worst = Math.max(worst, Math.abs((sx2 / 100) * bw - item.w) / 2, Math.abs((sy2 / 100) * bh - item.h) / 2);
    }
  }
  it('baked playback matches the canvas within a pixel', check(worst < 1, `worst error ${worst.toFixed(3)}px`));
}

// --- Lottie carries shapes now, and says what that cost ---------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // a plain rig still exports as primitives, with nothing baked and nothing skipped
  const plain = bakeLottie(P(), { from: 0, to: 600, background: '', name: 'probe' });
  it('a plain rig needs no baking', check(plain.baked.length === 0 && plain.skipped.length === 0, `${plain.baked.join()} / ${plain.skipped.join()}`));
  const kinds = (b: typeof plain) => new Set(
    (b.json.layers as { shapes?: { it: { ty: string }[] }[] }[])
      .flatMap((l) => l.shapes?.[0]?.it.map((i) => i.ty) ?? []));
  it('and uses real primitives', check(kinds(plain).has('el') || kinds(plain).has('rc')));

  // a morphing outline becomes bezier vertices, and is reported as baked
  ed().addTimeline('Morph');
  ed().setPlayhead(0);
  ed().setValue('eyeL', 'shape.path', primitivePath('pill'), 'a');
  ed().toggleKeyframe('eyeL', 'shape.path');
  ed().setPlayhead(500);
  ed().setValue('eyeL', 'shape.path', primitivePath('star', { points: 5 }), 'b');

  const morph = bakeLottie(P(), { from: 0, to: 500, background: '', name: 'probe' });
  it('a morphing outline exports as a bezier shape', check(kinds(morph).has('sh')));
  it('and is named as baked, so the note can warn about it', check(morph.baked.includes('Left eye'), morph.baked.join()));
  it('a glyph is still the one thing with no equivalent', check(morph.skipped.length === 0));

  // and it really is animated: a static outline must not pay the per-frame cost
  const shapes = (b: typeof plain, name: string) =>
    (b.json.layers as { nm: string; shapes?: { it: Record<string, unknown>[] }[] }[])
      .find((l) => l.nm === name)?.shapes?.[0]?.it.filter((i) => i.ty === 'sh') ?? [];
  const eyeShape = shapes(morph, 'Left eye')[0] as { ks: { a: number } };
  it('a changing outline is animated', check(eyeShape.ks.a === 1));
  const otherEye = shapes(morph, 'Right eye');
  it('while an untouched layer keeps a primitive', check(otherEye.length === 0));

  // THE BUG the app test found: a layer that gains an outline PARTWAY through. The
  // exporter judged from frame 0, where the eye is still a plain pill, so a morph clip at
  // the end of a timeline exported as a pill and was dropped without a word.
  ed().loadProject(defaultProject());
  ed().commit((p2) => { p2.presets = builtinPresets(); });
  ed().addBlock('p_excited');                       // appended AFTER the four default clips
  const late = bakeLottie(P(), { from: 0, to: activeTimeline(P()).timelineDurationMs, background: '', name: 'probe' });
  it('an outline that appears late is still baked', check(late.baked.includes('Left eye'), late.baked.join() || '(nothing)'));
  it('and the layer exports as a bezier for the whole clip', check(kinds(late).has('sh')));

  // an emitter's artwork exports too, rebased out of its own viewBox
  ed().loadProject(defaultProject());
  ed().addEmitter({
    name: 'drops', glyphs: [], color: { r: 40, g: 90, b: 200, a: 1 }, size: 20,
    parts: [{ id: 'p1', shapeId: 'drop', weight: 1, speed: 1, sizeScale: 1, spin: 0 }],
    path: 'fall', from: { nodeId: 'body', x: 0, y: 0 }, to: { nodeId: 'body', x: 0, y: 120 }, bow: 0,
    rateMs: 200, lifeMs: 600, count: 3, fadeStart: 0.9,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1,
  });
  const withArt = bakeLottie(P(), { from: 0, to: 600, background: '', name: 'probe' });
  it('emitter artwork exports as shapes rather than being dropped', check(withArt.baked.includes('drops') && withArt.skipped.length === 0, `baked ${withArt.baked.join()} / skipped ${withArt.skipped.join()}`));

  /**
   * A typed character exports too — that was the whole complaint.
   *
   * One the library draws ('z' is the Z shape) bakes to beziers like any artwork; one it
   * does not becomes a real Lottie text layer. Neither is skipped, because a particle
   * that silently does not exist in the file is the bug, not the note about it.
   */
  const lastEm = activeTimeline(P()).emitters!.at(-1)!.id;
  ed().updateEmitter(lastEm, (e) => {
    e.parts = [{ id: 'g', glyph: 'z', weight: 1, speed: 1, sizeScale: 1, spin: 0 }];
  });
  const drawnGlyph = bakeLottie(P(), { from: 0, to: 600, background: '', name: 'probe' });
  it('a glyph the library draws is baked, not skipped', check(drawnGlyph.skipped.length === 0 && drawnGlyph.baked.includes('drops'), `skipped ${drawnGlyph.skipped.join()} / baked ${drawnGlyph.baked.join()}`));

  ed().updateEmitter(lastEm, (e) => {
    e.parts = [{ id: 'g', glyph: '\u{1f389}', weight: 1, speed: 1, sizeScale: 1, spin: 0 }];
  });
  const typed = bakeLottie(P(), { from: 0, to: 600, background: '', name: 'probe' });
  const textLayers = (typed.json as any).layers.filter((l: any) => l.ty === 5);
  it('and one it does not becomes a text layer rather than vanishing', check(typed.skipped.length === 0 && textLayers.length > 0
      && textLayers[0].t.d.k[0].s.t === '\u{1f389}'
      && !!(typed.json as any).fonts, `skipped ${typed.skipped.join()} / ${textLayers.length} text layers`));

  ed().loadProject(defaultProject());
}
