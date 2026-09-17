import { it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check, near } from './testkit';
import { defaultProject, makeTimeline } from './defaults';
import { compOf } from './comp';
import { buildScene, emitterFrame, emitterPathAt, evaluateRig, sceneAt, sceneFrames, valueAt } from './scene';
import { makeCurveLayer, makeLimbPair, makeShapeLayer, makeTextLayer, pinLimbPoint } from './layers';
import { applyEasing } from './easing';
import { EFFECTS, makeEffect } from './effects';
import { useEditor } from './store';
import { bakeLottie } from '../export/lottie';
import { Shapes } from '../ui/Mascot';
import { CAMERA_ID, MODIFIERS, activeTimeline, type Emitter, type Keyframe, type Project, type Track } from './types';

const kf = (time: number, value: number, name: 'linear' | 'easeInOut' = 'linear'): Keyframe =>
  ({ id: `k${time}${Math.random()}`, time, value, easingOut: name === 'linear' ? { type: 'linear' } : { type: 'preset', name } });
const track = (nodeId: string, property: string, keys: Keyframe[]): Track => ({ id: `t${nodeId}${property}${Math.random()}`, nodeId, property, keyframes: keys });
/** a project with one empty, non-looping timeline */
const bare = (): Project => { const p = defaultProject(); const tl = makeTimeline('T'); tl.timelineDurationMs = 4000; p.timelines = [tl]; p.activeTimelineId = tl.id; return p; };
const item = (p: Project, id: string, t = 0) => sceneAt(p, t, compOf(p)).find((s) => s.id === id);
const html = (p: Project, t = 0) => renderToStaticMarkup(createElement('svg', null, createElement(Shapes, { scene: sceneAt(p, t, compOf(p)) })));

// --- advanced easing ----------------------------------------------------------------------
{
  it('spring overshoots and settles on 1', check(Math.max(...[0.2, 0.25, 0.3].map((t) => applyEasing({ type: 'preset', name: 'spring' }, t))) > 1.05 && near(applyEasing({ type: 'preset', name: 'spring' }, 1), 1)));
  it('anticipate pulls back below 0 first', check(applyEasing({ type: 'preset', name: 'anticipate' }, 0.2) < 0));
  it('overshoot passes 1 and comes back', check(applyEasing({ type: 'preset', name: 'overshoot' }, 0.7) > 1 && near(applyEasing({ type: 'preset', name: 'overshoot' }, 1), 1)));
}

// --- 2.5D: depth, parallax, camera zoom, rotate X/Y -----------------------------------------
{
  const p = bare();
  p.rig.nodes.near = makeShapeLayer('circle', { id: 'near', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 100, y: 0 } } });
  p.rig.nodes.far = makeShapeLayer('circle', { id: 'far', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 100, y: 0 } }, depth: { z: 1000, rotateX: 0, rotateY: 0 } });
  const cx = compOf(p).width / 2;
  it('a layer at depth 1000 is half the size', check(near(item(p, 'far')!.w, item(p, 'near')!.w / 2, 1e-6)));
  it('and half as far from the centre', check(near(item(p, 'far')!.cx - cx, (item(p, 'near')!.cx - cx) / 2, 1e-6)));
  p.rig.camera.offset.x = -200;
  it('a camera pan moves the deep layer half as far — parallax', check(near(item(p, 'near')!.cx - (cx + 100), -200, 1e-6) && near(item(p, 'far')!.cx - (cx + 50), -100, 1e-6)));
  p.rig.camera.offset.x = 0;
  p.rig.camera.zoom = 2;
  it('zoom scales the world about the centre', check(near(item(p, 'near')!.w, 192, 1e-6) && near(item(p, 'near')!.cx - cx, 200, 1e-6)));
  p.rig.camera.zoom = 1;
  p.rig.nodes.near.depth = { z: 0, rotateX: 0, rotateY: 60 };
  it('rotateY 60° narrows a card to half its width', check(near(item(p, 'near')!.w, 48, 1e-6) && near(item(p, 'near')!.h, 96, 1e-6)));
  const e0 = item(p, 'eyeL')!.cx;
  p.rig.nodes.body.depth = { z: 0, rotateX: 0, rotateY: 120 };
  it('rotateY on a mascot spins its sphere: the eyes go round the back', check(!item(p, 'eyeL') || Math.abs(item(p, 'eyeL')!.cx - e0) > 20));
}

// --- effects: flicker and jitter evaluate on the clock; drawn effects render ------------------
{
  const p = bare();
  p.rig.nodes.star = makeShapeLayer('star', { id: 'star', parentId: null, effects: [{ ...makeEffect('flicker'), params: { amount: 1, rate: 30, seed: 3 } }] });
  it('flicker at amount 1 dims the layer on every step', check([100, 700, 1300].every((t) => (item(p, 'star', t)!.alpha ?? 1) < 0.6)));
  it('the same instant always flickers the same way', check(item(p, 'star', 700)!.alpha === item(p, 'star', 700)!.alpha));
  p.rig.nodes.star.effects = [{ ...makeEffect('jitter'), params: { amount: 8, rate: 10, seed: 2 } }];
  it('jitter boils the outline: it changes between steps', check(item(p, 'star', 0)!.path !== item(p, 'star', 150)!.path));
  it('and holds within a step', check(item(p, 'star', 10)!.path === item(p, 'star', 40)!.path));
  p.rig.nodes.star.effects = ['glow', 'blur', 'shadow', 'rgbSplit', 'slices', 'scanlines'].map((k) => makeEffect(k as 'glow'));
  const out = html(p, 500);
  it('glow, blur and shadow render as one filter chain', check(/feGaussianBlur/.test(out) && /feDropShadow/.test(out) && /feFlood/.test(out)));
  it('rgb split draws red and cyan copies', check((out.match(/feColorMatrix/g) ?? []).length >= 2));
  // bands sit on a screen-wide grid (900px / bands), so a mascot and its eyes tear together
  it('slices clip the layer into bands', check((out.match(/<clipPath/g) ?? []).length >= 2));
  it('scanlines are a pattern masked to the layer', check(/<pattern/.test(out) && /<mask/.test(out)));
  p.rig.nodes.star.blend = 'screen';
  it('a blend mode is a mix-blend-mode', check(/mix-blend-mode:screen/.test(html(p))));
  p.rig.nodes.star.gradient = { type: 'radial', angle: 45, stops: [{ at: 0, color: { r: 255, g: 255, b: 255, a: 1 } }, { at: 1, color: { r: 90, g: 40, b: 200, a: 1 } }] };
  it('a gradient fill renders', check(/<radialGradient/.test(html(p))));
  const lot = bakeLottie(p, { name: 'x', background: null, from: 0, to: 300 });
  it('a Lottie export names what it could not carry', check(lot.warnings.some((w) => /glow/.test(w) && /gradient/.test(w)), lot.warnings.join(' | ')));
  it('and writes the blend mode', check(JSON.stringify(lot.json).includes('"bm":2')));
}

// --- echo: trails of where a layer was --------------------------------------------------------
{
  const p = bare();
  p.rig.nodes.dot = makeShapeLayer('circle', { id: 'dot', parentId: null, effects: [{ ...makeEffect('echo'), params: { count: 3, delay: 100, falloff: 0.5 } }] });
  activeTimeline(p).tracks.push(track('dot', 'flatOffset.x', [kf(0, 0), kf(1000, 400)]));
  const scene = sceneAt(p, 500, compOf(p));
  const now = scene.find((s) => s.id === 'dot')!, e1 = scene.find((s) => s.id === 'dot~echo1')!, e3 = scene.find((s) => s.id === 'dot~echo3')!;
  it('echo draws copies where the layer was', check(!!e1 && !!e3 && near(now.cx - e1.cx, 40, 0.01) && near(now.cx - e3.cx, 120, 0.01)));
  it('each fainter than the last', check(e3.color.a < e1.color.a && e1.color.a < now.color.a));
}

// --- masks ------------------------------------------------------------------------------------
{
  const p = bare();
  p.rig.nodes.hole = makeShapeLayer('circle', { id: 'hole', parentId: null, visible: false, size: { x: 200, y: 200 } });
  p.rig.nodes.body.mask = { nodeId: 'hole' };
  const b = item(p, 'body')!, e = item(p, 'eyeL')!;
  it('a masked mascot is clipped to the mask\'s outline', check(!!b.clip && /M/.test(b.clip.d)));
  it('and so is everything on it', check(!!e.clip));
  it('the mask layer can itself be hidden', check(!item(p, 'hole')));
  p.rig.nodes.body.mask = { nodeId: 'hole', invert: true };
  it('an inverted mask renders as a mask with the hole cut out', check(/<mask/.test(html(p))));
}

// --- goo: layers melt together ----------------------------------------------------------------
{
  const p = bare();
  p.rig.nodes.body.effects = [makeEffect('goo')];
  p.rig.nodes.drop = makeShapeLayer('circle', { id: 'drop', parentId: 'body', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 160, y: 60 } } });
  const scene = sceneAt(p, 0, compOf(p));
  it('the body and its shapes share one goo composite', check(scene.find((s) => s.id === 'body')!.goo?.id === 'body' && scene.find((s) => s.id === 'drop')!.goo?.id === 'body'));
  it('the eyes stay out of it', check(!scene.find((s) => s.id === 'eyeL')!.goo));
  const out = html(p);
  it('drawn inside one filter', check((out.match(/0 0 0 20 -9/g) ?? []).length === 1));
}

// --- particles: burst physics and assembly ----------------------------------------------------
{
  const p = bare();
  const burst: Emitter = {
    id: 'em', name: 'burst', glyphs: [], color: { r: 255, g: 200, b: 80, a: 1 }, colorTo: { r: 80, g: 120, b: 255, a: 1 },
    size: 6, path: 'burst', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, bow: 0, rateMs: 100, lifeMs: 5000, count: 300,
    fadeStart: 0.98, scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1, seed: 4,
    velocity: 500, spread: 360, drag: 1.5, gravity: 0, turbulence: 10,
    attract: { nodeId: 'body', startMs: 1500, durationMs: 1500, fill: false },
  };
  activeTimeline(p).emitters = [burst];
  const parts = (t: number) => sceneAt(p, t, compOf(p)).filter((s) => s.id.startsWith('em#'));
  const body = item(p, 'body')!;
  const spread = (t: number) => { const ps = parts(t); return ps.reduce((m, s) => m + Math.hypot(s.cx - body.cx, s.cy - body.cy), 0) / ps.length; };
  it('a burst has every particle at once', check(parts(50).length === 300));
  it('a spark with no glyph or shape is drawn as a dot', check(!parts(50)[0].text && !parts(50)[0].svg && /<(rect|ellipse|circle|path)/.test(html(p, 50))));
  it('they fly out', check(spread(1000) > spread(50) + 100, `${spread(50)} → ${spread(1000)}`));
  const r = body.w / 2;
  it('then gather onto the target\'s outline', check(parts(3200).every((s) => Math.abs(Math.hypot(s.cx - body.cx, s.cy - body.cy) - r) < r * 0.2)));
  it('changing colour over their life', check(parts(4000)[0].color.b > parts(50)[0].color.b));
  it('deterministic: the same instant twice is the same picture', check(JSON.stringify(parts(2100).map((s) => [s.cx, s.cy])) === JSON.stringify(parts(2100).map((s) => [s.cx, s.cy]))));
  const sizeAt = () => parts(900)[0].w;
  const full = sizeAt();
  p.rig.nodes.body.transform.scale = { x: 0, y: 0 };
  it('a mascot scaled to nothing does not shrink its particles to nothing', check(near(sizeAt(), full, 1e-6), `${full} vs ${sizeAt()}`));
  p.rig.nodes.body.transform.scale = { x: 1, y: 1 };
  p.rig.nodes.body.presence = 0;
  it('a target not drawn yet is still a target', check(parts(3200).length === 300 && Math.abs(Math.hypot(parts(3200)[5].cx - body.cx, parts(3200)[5].cy - body.cy) - r) < r * 0.2));
}

// --- procedural drivers: walk, follow-through, jelly, camera shake ----------------------------
{
  const p = bare();
  for (const n of [...makeLimbPair(p.rig, 'body', 'leg'), ...makeLimbPair(p.rig, 'body', 'arm')]) p.rig.nodes[n.id] = n;
  activeTimeline(p).modifiers = [{ id: 'w', nodeId: 'body', kind: 'walk', amount: 100, frequency: 2, amplitude: 60 }];
  const legL = Object.values(p.rig.nodes).find((n) => n.role === 'legL')!.id;
  const worldFoot = (t: number) => {
    const rig = evaluateRig(p, t), f = sceneFrames(rig, compOf(p)).get('body')!;
    const c = rig.nodes[legL].limb!.c!;
    return { x: f.x + c.x * f.kx, y: f.y + c.y * f.ky };
  };
  const bodyX = (t: number) => sceneFrames(evaluateRig(p, t), compOf(p)).get('body')!.x;
  // it eases up to speed over its first 400ms: past that, steps = 2·(t − 0.2s)
  it('a walk starts from a standstill', check(bodyX(100) - bodyX(0) < 3));
  it('then travels: 2 steps a second × 60px', check(near(bodyX(3000) - bodyX(2000), 120, 0.5)));
  // the left foot is planted while frac(t − 0.2s) < 0.5, e.g. 2.2s–2.7s
  const a = worldFoot(2260), b = worldFoot(2640);
  it('a planted foot stays put in the world while the body walks on, squash and all', check(near(a.x, b.x, 0.5) && near(a.y, b.y, 0.5), `${JSON.stringify(a)} ${JSON.stringify(b)}`));
  it('then swings forward, lifted', check(worldFoot(2950).y < a.y - 5 && worldFoot(3260).x > a.x + 100));
  const bob = [2200, 2450, 2700].map((t) => sceneFrames(evaluateRig(p, t), compOf(p)).get('body')!.y);
  it('the body bobs: up at passing, down at contact', check(bob[1] < bob[0] - 2 && near(bob[2], bob[0], 0.5)));
  // knees bend forward (the way it walks), feet point that way too, and the eyes look ahead
  const walking = evaluateRig(p, 2450);
  const legs = Object.values(walking.nodes).filter((n) => n.limb?.type === 'leg').map((n) => n.limb!);
  it('knees bend toward where it is walking', check(legs.every((l) => l.b.x > (l.a.x + l.c!.x) / 2 - 0.5), JSON.stringify(legs.map((l) => [l.a, l.b, l.c]))));
  it('both feet point the way it walks, the trailing-side one turned round', check(legs.every((l) => {
    const side = Math.sign(l.a.x) || 1, a = (-l.foot!.angle * Math.PI) / 180 * side;
    return Math.cos(a) * side > 0.5;
  }), legs.map((l) => l.foot!.angle.toFixed(0)).join()));
  it('the face turns toward the walk', check(walking.nodes.face.surface.yaw > p.rig.nodes.face.surface.yaw + 5));
  // with an end, it slows to a stop and stays where it got to
  activeTimeline(p).modifiers[0].endMs = 2000;
  it('a finished walk leaves the mascot where it walked to', check(bodyX(3000) - bodyX(0) > 150 && near(bodyX(3000), bodyX(3500), 1e-6)));

  // follow-through: the face lags a sudden move and swings back past rest
  const q = bare();
  activeTimeline(q).tracks.push(track('body', 'flatOffset.x', [kf(0, 0), kf(200, 200, 'easeInOut'), kf(4000, 200)]));
  activeTimeline(q).modifiers = [{ id: 'f', nodeId: 'face', kind: 'follow', amount: 100, frequency: 3, amplitude: 100 }];
  const faceX = (t: number) => { const f = sceneFrames(evaluateRig(q, t), compOf(q)); return f.get('face')!.x - f.get('body')!.x; };
  const samples = [150, 250, 350, 450, 550, 650].map(faceX);
  it('follow-through lags behind the move', check(samples[0] < -5, samples.join()));
  it('overshoots the other way as it settles', check(Math.max(...samples) > 2, samples.join()));
  it('and comes to rest', check(Math.abs(faceX(3500)) < 1));
  // …and to motion that no keyframe made: a mascot floating on a modifier
  const fl = bare();
  activeTimeline(fl).modifiers = [{ id: 'fl', nodeId: 'body', kind: 'float', amount: 100, frequency: 1.5, amplitude: 40 }];
  const still = (t: number) => { const f = sceneFrames(evaluateRig(fl, t), compOf(fl)); return f.get('face')!.y - f.get('body')!.y; };
  const restY = [300, 500, 700].map(still);
  activeTimeline(fl).modifiers.push({ id: 'ff', nodeId: 'face', kind: 'follow', ...MODIFIERS.follow.defaults });
  it('follow-through reacts to a floating mascot, not only a keyframed one', check([300, 500, 700].some((t, i) => Math.abs(still(t) - restY[i]) > 2), [300, 500, 700].map(still).join()));

  // jelly: a landing splats the outline
  const j = bare();
  activeTimeline(j).tracks.push(track('body', 'flatOffset.y', [kf(0, -300), kf(500, 0, 'linear'), kf(4000, 0)]));
  activeTimeline(j).modifiers = [{ id: 'j', nodeId: 'body', kind: 'jelly', amount: 100, frequency: 4, amplitude: 100 }];
  const box = (t: number) => { const it2 = item(j, 'body', t)!; return { w: it2.w, h: it2.h, path: it2.path }; };
  // a new jelly's own defaults are strong enough to see, not a pendulum's 10%
  it('a jelly starts at a strength that shows', check(MODIFIERS.jelly.defaults.amplitude >= 50 && MODIFIERS.follow.defaults.amplitude >= 50 && MODIFIERS.walk.defaults.amplitude >= 20));
  it('falling fast, the outline is deformed', check(!!box(400).path && box(400).path !== box(3900).path));
  const splat = sceneAt(j, 560, compOf(j)).find((s) => s.id === 'body')!;
  it('just after landing the outline is wider than tall', check((() => {
    const xs: number[] = [], ys: number[] = [];
    splat.path!.replace(/-?\d*\.?\d+(e-?\d+)?/g, (m) => { (xs.length === ys.length ? xs : ys).push(+m); return m; });
    return Math.max(...xs) - Math.min(...xs) > (Math.max(...ys) - Math.min(...ys)) * 1.08;
  })()));

  // the camera shakes like a layer
  const c = bare();
  activeTimeline(c).modifiers = [{ id: 's', nodeId: CAMERA_ID, kind: 'shake', amount: 100, frequency: 10, amplitude: 12 }];
  it('a camera shake moves the view', check([100, 300, 700].some((t) => Math.abs(evaluateRig(c, t).camera.offset.x) > 1)));
}

// --- letters: per-character offsets and orientation --------------------------------------------
{
  const p = bare();
  p.rig.nodes.title = makeTextLayer('BLOOBY', { id: 'title', parentId: null });
  const glyphs = (t: number) => item(p, 'title', t)!.glyphs!;
  const rest = glyphs(0);
  activeTimeline(p).tracks.push(
    track('title', 'text.char.2.y', [kf(0, -300), kf(1000, 0, 'easeInOut')]),
    track('title', 'text.char.2.x', [kf(0, -200), kf(1000, 0, 'linear')]),
    track('title', 'text.char.4.scale', [kf(0, 2), kf(1000, 2)]),
  );
  const g = glyphs(500);
  it('one letter moves on its own', check(g[2].y < rest[2].y - 50 && near(g[0].y, rest[0].y, 1e-6)));
  it('another is scaled on its own', check(near(g[4].scale, 2 * rest[4].scale, 1e-6)));
  it('the offsets are keyframeable values', check(near(valueAt(p, 'title', 'text.char.2.x', 500) as number, -100, 1e-6)));
  p.rig.nodes.title.text!.charOrient = true;
  it('with orient, a flying letter turns to face its path', check(Math.abs(glyphs(500)[2].rot) > 20 && near(glyphs(0)[0].rot, 0, 1e-6)));
}

// --- trim offset, taper -----------------------------------------------------------------------
{
  const p = bare();
  const c = makeCurveLayer([{ x: -200, y: 0 }, { x: 0, y: -80 }, { x: 200, y: 0 }], { name: 'line', width: 12 })!;
  c.trim = { start: 0, end: 0.3, offset: 0.85 };
  p.rig.nodes[c.id] = c;
  it('a trim that wraps past the end draws two dashes', check((html(p).match(/stroke-dasharray/g) ?? []).length === 2));
  c.trim = { start: 0, end: 1 };
  c.stroke = { ...c.stroke, taper: 1 };
  it('a tapered stroke is drawn as a filled brush outline', check(/fill="rgba\(232,106,84,1\)"/.test(html(p)) && !/stroke-dasharray/.test(html(p))));
}

// --- an emitter's drawn path is the path its particles take -----------------------------------
{
  const p = bare();
  const em: Emitter = {
    id: 'rain', name: 'rain', glyphs: ['•'], color: { r: 0, g: 0, b: 0, a: 1 }, size: 8, path: 'arc',
    from: { x: -100, y: 0 }, to: { x: 150, y: -120 }, bow: 60, rateMs: 100, lifeMs: 1000, count: 10,
    fadeStart: 1, scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1, speedJitter: 0,
  };
  activeTimeline(p).emitters = [em];
  const scene = sceneAt(p, 2000, compOf(p));
  const rig = evaluateRig(p, 2000);
  const { anchor, unit } = emitterFrame(rig, buildScene(rig, compOf(p)), compOf(p));
  const onPath = (e: Emitter) => {
    const a = anchor(e.from), b = anchor(e.to);
    return sceneAt({ ...p, timelines: [{ ...activeTimeline(p), emitters: [e] }] }, 2000, compOf(p)).filter((s) => s.id.startsWith('rain#')).every((s, i, all) => {
      void all;
      let best = Infinity;
      for (let k = 0; k <= 400; k++) for (const lane of e.path === 'fall' ? [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5, -0.4, -0.2, 0, 0.2, 0.4] : [0]) {
        const q = emitterPathAt(e, a, b, unit, k / 400, lane);
        best = Math.min(best, Math.hypot(q.x - s.cx, q.y - s.cy));
      }
      void i;
      return best < 3;
    });
  };
  it('every particle of a bowed arc lies on the drawn path', check(scene.some((s) => s.id.startsWith('rain#')) && onPath(em)));
  it('and on a fall, on one of its lanes', check(onPath({ ...em, path: 'fall', bow: 40 })));
}

// --- pinned limb points -----------------------------------------------------------------------
{
  const p = bare();
  for (const n of makeLimbPair(p.rig, 'body', 'leg')) p.rig.nodes[n.id] = n;
  const leg = Object.values(p.rig.nodes).find((n) => n.role === 'legR')!;
  const hipWorld = () => { const f = sceneFrames(evaluateRig(p, 0), compOf(p)); const w = f.get('')!, l = p.rig.nodes[leg.id].limb!; return l.pins?.a ? { x: w.x + l.pins.a.x, y: w.y + l.pins.a.y } : null; };
  it('a hip can be pinned on its own', check(pinLimbPoint(p, leg.id, 'a', true, 0) && !!p.rig.nodes[leg.id].limb!.pins?.a && !p.rig.nodes[leg.id].limb!.pin));
  const h0 = hipWorld()!;
  const len0 = p.rig.nodes[leg.id].limb!.length;
  p.rig.nodes.body.surface.flatOffset = { x: 0, y: -400 };
  const drawn = item(p, leg.id)!;
  it('it stays in the world while the body jumps away', check(!!drawn && near(hipWorld()!.x, h0.x) && near(hipWorld()!.y, h0.y)));
  it('and the leg stretches past its length to reach — the inspector length is untouched', check(drawn.h > 300 && p.rig.nodes[leg.id].limb!.length === len0, String(drawn.h)));
  p.rig.nodes.body.surface.flatOffset = { x: 0, y: 0 };
  const back = item(p, leg.id)!;
  it('back in range, the set length is the length again', check(back.h < 200, String(back.h)));
  // within reach (the stretch belongs to the pin, so unpinning a stretched leg lets it shorten)
  p.rig.nodes.body.surface.flatOffset = { x: 20, y: -12 };
  const before = item(p, leg.id)!;
  it('unpinning writes the pose back without a jump', check(pinLimbPoint(p, leg.id, 'a', false, 0) && !p.rig.nodes[leg.id].limb!.pins && near(item(p, leg.id)!.cy, before.cy, 1)));
  it('a knee can be pinned too, and the ankle', check(pinLimbPoint(p, leg.id, 'b', true, 0) && pinLimbPoint(p, leg.id, 'c', true, 0) && !!p.rig.nodes[leg.id].limb!.pins?.b && !!p.rig.nodes[leg.id].limb!.pin));
}

// --- undo, and a project round-trips through JSON --------------------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(bare());
  ed.updateNode('body', (n) => { n.effects = [makeEffect('glow')]; n.depth = { z: 200, rotateX: 0, rotateY: 30 }; n.blend = 'screen'; });
  const json = JSON.parse(JSON.stringify(useEditor.getState().project)) as Project;
  it('effects, depth and blend survive serialisation', check(json.rig.nodes.body.effects![0].kind === 'glow' && json.rig.nodes.body.depth!.rotateY === 30 && json.rig.nodes.body.blend === 'screen'));
  ed.undo();
  it('and undo takes them off', check(!useEditor.getState().project.rig.nodes.body.effects));
  const scene1 = JSON.stringify(buildScene(evaluateRig(json, 1234), compOf(json)));
  it('the same project and time always evaluate to the same scene', check(scene1 === JSON.stringify(buildScene(evaluateRig(json, 1234), compOf(json)))));
}

// --- new modifiers: bounce, breathe, orbit, heartbeat -------------------------------------------
{
  const withMod = (kind: 'bounce' | 'breathe' | 'orbit' | 'heartbeat') => {
    const p = bare();
    activeTimeline(p).modifiers = [{ id: kind, nodeId: 'body', kind, ...MODIFIERS[kind].defaults }];
    return p;
  };
  const b = withMod('bounce');
  const bodyY = (p: Project, t: number) => sceneFrames(evaluateRig(p, t), compOf(p)).get('body')!.y;
  // 1.2 hops a second: contact at 0, top of the hop at ~417ms
  it('bounce lifts the mascot mid-hop and lands it again', check(bodyY(b, 417) < bodyY(b, 0) - 30 && near(bodyY(b, 833), bodyY(b, 0), 1)));
  const landing = evaluateRig(b, 833).nodes.body.squish!;
  it('and squashes on the landing', check(landing.x > 1.08 && landing.y < 0.92, JSON.stringify(landing)));

  const br = withMod('breathe');
  const inhale = evaluateRig(br, 2000).nodes.body.squish!; // half a 0.25 Hz breath: fullest
  it('breathe draws in: taller and a little narrower', check(inhale.y > 1.04 && inhale.x < 1 && inhale.x > 0.97, JSON.stringify(inhale)));
  it('and is back at rest after a whole breath', check(near(evaluateRig(br, 4000).nodes.body.squish?.y ?? 1, 1, 1e-6)));

  const o = withMod('orbit');
  const at = (t: number) => { const f = sceneFrames(evaluateRig(o, t), compOf(o)).get('body')!; return { x: f.x, y: f.y }; };
  const q0 = at(0), q1 = at(833), q2 = at(1667); // quarter turns at 0.3 Hz
  it('orbit drifts round an ellipse, wider than tall', check(Math.abs(q0.x - q2.x) > 20 && Math.abs(q1.y - at(2500).y) > 10 && Math.abs(q0.x - q2.x) > Math.abs(q1.y - at(2500).y)));

  const h = withMod('heartbeat');
  const scaleAt = (t: number) => evaluateRig(h, t).nodes.body.transform.scale.x;
  const beat = 1000 / 1.1;
  it('heartbeat swells twice a beat, the second smaller, then rests', check(scaleAt(beat * 0.1) > 1.08 && scaleAt(beat * 0.3) > 1.04 && scaleAt(beat * 0.3) < scaleAt(beat * 0.1) && near(scaleAt(beat * 0.7), 1, 0.01)));

  // a moving modifier is felt by follow-through, like a keyframed move
  it('bounce and orbit count as motion for follow-through and jelly', check(['bounce', 'orbit'].every((k) => {
    const p = withMod(k as 'bounce');
    const faceRel = (t: number) => { const f = sceneFrames(evaluateRig(p, t), compOf(p)); return f.get('face')!.y - f.get('body')!.y; };
    const before = [300, 450, 600].map(faceRel);
    activeTimeline(p).modifiers.push({ id: 'f', nodeId: 'face', kind: 'follow', ...MODIFIERS.follow.defaults });
    return [300, 450, 600].some((t, i) => Math.abs(faceRel(t) - before[i]) > 1);
  })));
}

// --- new effects: wave, outline, grain, hue shift ------------------------------------------------
{
  const p = bare();
  const body = p.rig.nodes.body;
  body.effects = [makeEffect('wave')];
  const d0 = item(p, 'body', 0)!.path, d1 = item(p, 'body', 250)!.path;
  it('wave ripples the outline, and the ripple travels', check(!!d0 && !!d1 && d0 !== d1));
  it('wave is geometry, so it survives the Lottie export', check(EFFECTS.wave.lottie));

  body.effects = [makeEffect('outline')];
  const outlined = html(p);
  it('outline draws a fat ink stroke behind the layer', check(/stroke-width="1[2-9]/.test(outlined) || /stroke-width="[2-9]\d/.test(outlined), outlined.slice(0, 400)));

  body.effects = [makeEffect('grain')];
  const a = html(p, 0), b2 = html(p, 400);
  it('grain overlays fractal noise that reseeds over time', check(a.includes('feTurbulence') && a !== b2));

  body.effects = [makeEffect('hueShift')];
  it('hue shift turns the colours with the clock', check(html(p, 1000).includes('hueRotate') && html(p, 1000) !== html(p, 2000)));
  it('the eyes are handed grain and hue shift from the body they sit on', check((() => {
    body.effects = [makeEffect('hueShift')];
    return (item(p, 'eyeL', 1000)?.fx?.list ?? []).some((e) => e.kind === 'hueShift');
  })()));
}
