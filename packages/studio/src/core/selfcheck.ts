/**
 * The one runnable check. Verifies the maths that everything else trusts:
 * sphere projection, its inverse, easing, OKLCH round-trip, track sampling.
 *   npx esbuild src/core/selfcheck.ts --bundle --format=esm | node --input-type=module
 */
import { bodyTurnScale, effectiveYaw, limbThreshold, perspective, projectToScreen, screenToSurface, silhouetteScale, surfaceNormal } from './curvature';
import { applyEasing, cubicBezier } from './easing';
import { lerpColor, oklchToRgb, rgbToOklch } from './color';
import { activeTrackFor, buildScene, evaluateRig, lerpAngle, resolveTracks, sampleTrack, valueAt } from './scene';
import { defaultProject, makeTimeline } from './defaults';
import { activeTransitionAt, blocksEnd, blockStarts, DEFAULT_TRANSITION_MS, derivedDuration, explicitTransitionFor, relayoutBlocks } from './timeline';
import { bakeLottie } from '../export/lottie';
import { buildDotLottie } from '../export/dotlottie';
import { useEditor, writeKeyframe } from './store';
import { NUMERIC_PROPS, PROP_ALIAS, PROPS, readProp, resolveProp, writeProp } from './props';
import { MODIFIER_KINDS, MODIFIERS } from './types';
import { applyCalls, describe, normaliseCall, RESPONSE_SCHEMA, validate, validateBatch, type ToolCall } from '../copilot/tools';
import { parseTurn } from '../copilot/parse';
import { suggestedStart, systemPrompt } from '../copilot/prompt';
import { critique } from '../copilot/critique';
import { baseUrl, CLOUD_CATALOGUE, LOCAL_URL, needsKey, resolveModel, usesBackend } from '../copilot/pool';
import { listModels } from '../copilot/client';
import { crc32 } from '../export/zip';
import { activeTimeline } from './types';
import type { Project, Rig, RigNode } from './types';

let failures = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.error('FAIL', label, detail); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const rig: Rig = defaultProject().rig;
const flat: Rig = { ...rig, camera: { ...rig.camera, fov: 0 } };

const mk = (yaw: number, pitch: number, roll = 0): RigNode => ({
  id: 't', name: 't', kind: 'primitive', parentId: rig.rootId,
  surface: { yaw, pitch, mapped: true },
  transform: { scale: { x: 1, y: 1 }, rotation: roll },
  size: { x: 10, y: 10 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 0,
});

// --- sphere normal is a unit vector and matches the closed form -----------------
for (const [y, p] of [[0, 0], [30, 0], [0, 45], [-60, 20], [88, -70]]) {
  const n = surfaceNormal(y, p);
  ok('normal unit', near(Math.hypot(...n), 1, 1e-9), `${y},${p} -> ${n}`);
}
ok('front pole', surfaceNormal(0, 0)[2] === 1);
ok('right yaw is +x', surfaceNormal(90, 0)[0] > 0.999);
ok('down pitch is +y', surfaceNormal(0, 90)[1] > 0.999);

// --- projection: centre, rim, foreshortening -----------------------------------
const R = 100;
const centre = projectToScreen(mk(0, 0), flat, R);
ok('centre at origin', near(centre.x, 0) && near(centre.y, 0));
ok('centre unforeshortened', near(centre.sx, 1) && near(centre.sy, 1));

const rim = projectToScreen(mk(90, 0), flat, R);
ok('rim at radius', near(rim.x, R, 1e-9), String(rim.x));
ok('rim invisible', !rim.visible);

const side = projectToScreen(mk(60, 0), flat, R);
ok('60deg x = R sin60', near(side.x, R * Math.sin(Math.PI / 3), 1e-9));
ok('60deg squashes horizontally', near(side.sx, Math.cos(Math.PI / 3), 1e-9), String(side.sx));
ok('60deg keeps height', near(side.sy, 1, 1e-9), String(side.sy));

const up = projectToScreen(mk(0, -60), flat, R);
ok('pitch squashes vertically', near(up.sy, Math.cos(Math.PI / 3), 1e-9), String(up.sy));
ok('pitch keeps width', near(up.sx, 1, 1e-9), String(up.sx));

// rolled node: the squash follows the roll into the node's own frame
const rolled = projectToScreen(mk(60, 0, 90), flat, R);
ok('rolled squash swaps axes', near(rolled.sy, Math.cos(Math.PI / 3), 1e-9), String(rolled.sy));

// --- head turn moves features the same way local yaw does ----------------------
const headed = projectToScreen(mk(0, 0), flat, R, { x: 30, y: 0 });
const local = projectToScreen(mk(30, 0), flat, R);
ok('head yaw == local yaw at pitch 0', near(headed.x, local.x, 1e-9));
const headedP = projectToScreen(mk(0, 0), flat, R, { x: 0, y: 25 });
ok('head pitch == local pitch', near(headedP.y, projectToScreen(mk(0, 25), flat, R).y, 1e-9));

// --- perspective ---------------------------------------------------------------
ok('fov 0 is orthographic', perspective(1, 0, 6) === 1);
ok('perspective enlarges the near pole', perspective(1, 45, 6) > 1);
ok('perspective shrinks the far side', perspective(-1, 45, 6) < 1);
ok('perspective bounded', perspective(1, 89, 1.2) < 7);

// --- the silhouette bounds every feature that can be seen ----------------------
ok('ortho silhouette is exactly R', silhouetteScale(0, 6) === 1);
for (const [fov, dist] of [[20, 6], [45, 6], [70, 6], [89, 1.2], [89, 20], [60, 2]]) {
  const k = silhouetteScale(fov, dist);
  const r2: Rig = { ...rig, camera: { ...rig.camera, fov, distance: dist } };
  ok('silhouette matches the closed form', Math.abs(k - (fov === 0 ? 1 : 0)) >= 0 && k >= 1);
  let worstOut = 0;
  for (let yaw = -90; yaw <= 90; yaw += 1) {
    for (let pitch = -90; pitch <= 90; pitch += 3) {
      const pr = projectToScreen(mk(yaw, pitch), r2, R);
      if (!pr.visible) continue;
      worstOut = Math.max(worstOut, Math.hypot(pr.x, pr.y) / (R * k));
    }
  }
  ok('no visible feature centre escapes the silhouette', worstOut <= 1 + 1e-4, `fov${fov} d${dist} -> ${worstOut.toFixed(5)}`);
}
// full pinhole matches R·D/sqrt(D²-R²)
{
  const d = 6, exact = d / Math.sqrt(d * d - 1);
  ok('near-pinhole silhouette matches the sphere formula', Math.abs(silhouetteScale(90, d) - exact) < 2e-3,
    `${silhouetteScale(90, d).toFixed(5)} vs ${exact.toFixed(5)}`);
}
ok('limb threshold is 0 when orthographic', limbThreshold(0, 6) === 0);

// --- inverse round-trips (this is what dragging an eye relies on) ---------------
for (const fov of [0, 30, 70]) {
  const r2: Rig = { ...rig, camera: { ...rig.camera, fov } };
  for (const head of [{ x: 0, y: 0 }, { x: 25, y: -15 }]) {
    for (const [y, p] of [[0, 0], [35, 12], [-50, -30], [70, 5], [10, -65]]) {
      const pr = projectToScreen(mk(y, p), r2, R, head);
      if (!pr.visible) continue; // behind the limb: no screen point to invert
      const back = screenToSurface(pr.x, pr.y, r2, R, head);
      ok('inverse round-trip', near(back.x, y, 1e-4) && near(back.y, p, 1e-4),
        `fov${fov} head${head.x}/${head.y} ${y},${p} -> ${back.x.toFixed(4)},${back.y.toFixed(4)}`);
    }
  }
}

// --- eye distance is a signed offset on top of the posed yaw -------------------
const eye = mk(5, 0);
eye.eye = { linkedToId: null, openness: 1, distanceFromCenter: -18 };
ok('eye distance offsets yaw', effectiveYaw(eye) === -13);

// --- easing --------------------------------------------------------------------
ok('bezier endpoints', cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 0) === 0 && cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 1) === 1);
ok('linear is identity', near(applyEasing({ type: 'linear' }, 0.37), 0.37));
ok('easeIn lags', applyEasing({ type: 'preset', name: 'easeIn' }, 0.5) < 0.5);
ok('easeOut leads', applyEasing({ type: 'preset', name: 'easeOut' }, 0.5) > 0.5);
ok('easeInOut symmetric', near(applyEasing({ type: 'preset', name: 'easeInOut' }, 0.5), 0.5, 1e-4));
ok('bounce lands on 1', near(applyEasing({ type: 'preset', name: 'bounce' }, 1), 1, 1e-6));
ok('elastic lands on 1', applyEasing({ type: 'preset', name: 'elastic' }, 1) === 1);
for (let i = 0; i <= 20; i++) {
  const v = applyEasing({ type: 'preset', name: 'easeInOut' }, i / 20);
  ok('easeInOut monotone in 0..1', v >= -1e-9 && v <= 1 + 1e-9);
}

// --- colour --------------------------------------------------------------------
for (const c of [{ r: 255, g: 0, b: 0, a: 1 }, { r: 12, g: 200, b: 90, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 }]) {
  const rt = oklchToRgb(rgbToOklch(c));
  ok('oklch round-trip', rt.r === c.r && rt.g === c.g && rt.b === c.b, JSON.stringify(rt));
}
const mid = lerpColor({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 255, a: 1 }, 0.5);
ok('red->blue keeps chroma (no mud)', rgbToOklch(mid).c > 0.12, JSON.stringify(mid));
ok('lerp t=0 is exact', lerpColor({ r: 20, g: 30, b: 40, a: 1 }, { r: 200, g: 10, b: 5, a: 1 }, 0).r === 20);

// --- angles --------------------------------------------------------------------
ok('angle takes the short way', near(lerpAngle(170, -170, 0.5), 180));
ok('angle plain case', near(lerpAngle(0, 90, 0.5), 45));

// --- track sampling ------------------------------------------------------------
const track = {
  id: 'k', nodeId: 'n', property: 'surface.yaw',
  keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 100, easingOut: { type: 'linear' as const } },
  ],
};
ok('before first key holds', sampleTrack(track, -50) === 0);
ok('after last key holds', sampleTrack(track, 5000) === 100);
ok('midpoint linear', near(sampleTrack(track, 500) as number, 50));
ok('empty track undefined', sampleTrack({ ...track, keyframes: [] }, 0) === undefined);

// --- scene: the default rig actually renders two eyes on a body ----------------
const scene = buildScene(rig, { width: 600, height: 600 });
ok('default rig renders 3 shapes', scene.length === 3, String(scene.length));
ok('every shape is round', scene.every((s) => s.shape === 'ellipse' || s.r >= Math.min(s.w, s.h) / 2 - 1e-9));
ok('body is an ellipse, eyes are pills', scene[0].shape === 'ellipse' && scene[1].shape === 'pill');
ok('eyes are mirrored', near(scene[1].cx + scene[2].cx, 600, 1e-6), `${scene[1].cx} ${scene[2].cx}`);

// --- do drawn features ever escape the drawn body outline? ---------------------
{
  let worst = 0, worstAt = '';
  for (const fov of [0, 28, 55, 78, 89]) {
    for (let yaw = -80; yaw <= 80; yaw += 2) {
      for (let pitch = -60; pitch <= 60; pitch += 5) {
        const proj = defaultProject();
        proj.rig.camera.fov = fov;
        proj.rig.nodes.body.surface.yaw = yaw;
        proj.rig.nodes.body.surface.pitch = pitch;
        const sc = buildScene(proj.rig, { width: 720, height: 720 });
        const body = sc.find((x) => x.id === 'body')!;
        for (const it of sc) {
          if (it.id === 'body' || it.color.a < 0.5) continue; // mostly faded out at the limb
          // a pill is the inner rect swept by a disc of radius r — sample that outline,
          // not the bounding box, or the corners lie about how far the ink reaches
          const ix = Math.max(0, it.w / 2 - it.r), iy = Math.max(0, it.h / 2 - it.r);
          const a2 = (it.rotation * Math.PI) / 180;
          for (const [sx2, sy2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            for (let k = 0; k < 24; k++) {
              const th = (k / 24) * Math.PI * 2;
              const lx = sx2 * ix + it.r * Math.cos(th);
              const ly = sy2 * iy + it.r * Math.sin(th);
              const px = it.cx + lx * Math.cos(a2) - ly * Math.sin(a2) - body.cx;
              const py = it.cy + lx * Math.sin(a2) + ly * Math.cos(a2) - body.cy;
              const d = Math.hypot(px / (body.w / 2), py / (body.h / 2));
              if (d > worst) { worst = d; worstAt = `fov${fov} yaw${yaw} pitch${pitch} ${it.name}`; }
            }
          }
        }
      }
    }
  }
  // A flat decal tangent to a sphere genuinely pokes past the silhouette near the rim —
  // the exact shear transform spills 5.3% here, so 5.3% is the floor, not a bug. The
  // scale-only approximation costs about 1.4 points on top of that, and the stylised
  // turn-squash (bodyTurnScale, up to 22% at combined extreme yaw+pitch) adds a couple
  // more at the extremes where both squash independently — swept the full grid, worst
  // case is 9.2%.
  ok('features stay within the body outline', worst <= 1.10, `${worst.toFixed(4)} at ${worstAt}`);
}

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
  ok('lottie fps + size', j.fr === store.fps && j.w === 720 && j.h === 720);
  ok('lottie duration in frames', j.op === Math.round((stl.timelineDurationMs / 1000) * store.fps), `${j.op}`);
  ok('lottie has a layer per shape plus backdrop', j.layers.length === 4, String(j.layers.length));
  ok('the default file opens on a real timeline', stl.blocks.length === 6 && stl.tracks.length > 12, `${stl.blocks.length} blocks, ${stl.tracks.length} tracks`);
  ok('lottie layer indices are 1..n', j.layers.every((l: any, i: number) => l.ind === i + 1));

  const shapeLayers = j.layers.filter((l: any) => l.ty === 4);
  for (const l of shapeLayers) {
    const geo = l.shapes[0].it[0];
    ok('only ellipses and rounded rects', geo.ty === 'el' || geo.ty === 'rc', geo.ty);
    if (geo.ty === 'rc') ok('corner radius is min/2 — never a sharp angle', Math.abs(geo.r.k - Math.min(geo.s.k[0], geo.s.k[1]) / 2) < 1e-9);
    for (const key of ['p', 's', 'r', 'o'] as const) {
      const pr = l.ks[key];
      if (pr.a !== 1) continue;
      const times = pr.k.map((x: any) => x.t);
      ok('keyframe times strictly ascending', times.every((t: number, i: number) => i === 0 || t > times[i - 1]));
      ok('every keyframe value is finite', pr.k.every((x: any) => x.s.every((v: number) => Number.isFinite(v))));
      ok('non-final keys carry tangents', pr.k.slice(0, -1).every((x: any) => x.i && x.o));
      ok('final key carries none', pr.k[pr.k.length - 1].i === undefined);
    }
  }
  ok('simplification removed frames', baked.keyframeCount < baked.frames * shapeLayers.length * 4,
    `${baked.keyframeCount} keys over ${baked.frames} frames`);

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
      worst = Math.max(worst, Math.abs((sx2 / 100) * geo.s.k[0] - item.w) / 2, Math.abs((sy2 / 100) * geo.s.k[1] - item.h) / 2);
    }
  }
  ok('baked playback matches the canvas within a pixel', worst < 1, `worst error ${worst.toFixed(3)}px`);
}

// --- body turn-squash: a stylised cue, not physics ------------------------------
{
  const flat = bodyTurnScale(0, 0);
  ok('no squash at rest', flat.sx === 1 && flat.sy === 1);
  const yawed = bodyTurnScale(20.4, 0);
  ok('yaw visibly narrows the body even at a moderate angle', yawed.sx < 0.94 && yawed.sx > 0.85, String(yawed.sx));
  ok('yaw does not touch the vertical axis', bodyTurnScale(40, 0).sy === 1);
  ok('pitch does not touch the horizontal axis', bodyTurnScale(0, 40).sx === 1);
  ok('squash is symmetric in sign', bodyTurnScale(30, 0).sx === bodyTurnScale(-30, 0).sx);
  const scene0 = buildScene(defaultProject().rig, { width: 720, height: 720 });
  const bodyAt0 = scene0.find((s) => s.id === 'body')!;
  const p2 = defaultProject();
  p2.rig.nodes.body.surface.yaw = 45;
  const bodyAt45 = buildScene(p2.rig, { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  ok('the drawn body actually narrows at yaw 45', bodyAt45.w < bodyAt0.w, `${bodyAt45.w} vs ${bodyAt0.w}`);
  ok('height is untouched by pure yaw', Math.abs(bodyAt45.h - bodyAt0.h) < 1e-6);
}

// --- writeKeyframe anchors a brand-new track instead of going constant ---------
{
  const p = defaultProject();
  const ptl = activeTimeline(p);
  // pick a property with no existing track, matching a copilot add_keyframe / applyExpression call
  ok('no pre-existing track on eyeL rotation', !ptl.tracks.some((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation'));
  const before = readProp(p.rig, 'eyeL', 'transform.rotation');
  writeKeyframe(p, 'eyeL', 'transform.rotation', 2000, 25, { type: 'linear' });
  const track = ptl.tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation')!;
  ok('an anchor keyframe was seeded at t=0', track.keyframes.length === 2 && track.keyframes[0].time === 0);
  ok('the anchor holds the PREVIOUS value, not the new one', track.keyframes[0].value === before, `${track.keyframes[0].value} vs ${before}`);
  ok('t=0 still reads as unchanged after the write', sampleTrack(track, 0) === before);
  ok('the target time reads the new value', sampleTrack(track, 2000) === 25);
  ok('halfway there interpolates, does not jump', (sampleTrack(track, 1000) as number) > (before as number) && (sampleTrack(track, 1000) as number) < 25);
  // writing again on the SAME (now-existing) track must not re-anchor a second time —
  // stays inside Idle's own window (0–2400ms), the block this track just got scoped to;
  // a write outside it would correctly become a *different* clip's own track instead.
  writeKeyframe(p, 'eyeL', 'transform.rotation', 2200, 40, { type: 'linear' });
  ok('a second write on an existing track adds one keyframe, not another anchor', track.keyframes.length === 3);
}

// --- stretch modifier: the whole rig, not one node ------------------------------
{
  const proj = defaultProject();
  const before = buildScene(proj.rig, { width: 720, height: 720 });
  activeTimeline(proj).modifiers.push({ id: 'm', nodeId: proj.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20 });
  // t chosen so sin(2*pi*1*t) = 1 exactly, i.e. the modifier is at its full +20% swing
  const tSec = 0.25;
  const after = buildScene(evaluateRig(proj, tSec * 1000), { width: 720, height: 720 });
  const bodyBefore = before.find((s) => s.id === 'body')!, bodyAfter = after.find((s) => s.id === 'body')!;
  const eyeBefore = before.find((s) => s.id === 'eyeL')!, eyeAfter = after.find((s) => s.id === 'eyeL')!;
  ok('stretch grows the body', bodyAfter.w > bodyBefore.w * 1.15, `${bodyAfter.w} vs ${bodyBefore.w}`);
  ok('stretch grows features too, not just the body node', eyeAfter.w > eyeBefore.w * 1.15, `${eyeAfter.w} vs ${eyeBefore.w}`);
  const ratio = (a: number, b: number) => a / b;
  ok('body and eye scale by the same factor — one rig-wide pulse', Math.abs(ratio(bodyAfter.w, bodyBefore.w) - ratio(eyeAfter.w, eyeBefore.w)) < 0.02,
    `${ratio(bodyAfter.w, bodyBefore.w)} vs ${ratio(eyeAfter.w, eyeBefore.w)}`);
  ok('amount=0 leaves it alone', (() => {
    // compare against the same evaluated-at-t baseline (the Idle preset's own yaw
    // track already moves the body a hair via the Stage-1 turn-squash) — isolating
    // the modifier's own effect, not conflating it with unrelated keyframed motion.
    const p2 = defaultProject();
    const baseline = buildScene(evaluateRig(p2, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
    activeTimeline(p2).modifiers.push({ id: 'm2', nodeId: p2.rig.rootId, kind: 'stretch', amount: 0, frequency: 1, amplitude: 20 });
    const b = buildScene(evaluateRig(p2, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
    return Math.abs(b.w - baseline.w) < 1e-6;
  })());
}

// --- per-clip effects: scoped to one block's own time window, phase resets at its start
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const blinkBlock = tl.blocks[1]; // 2400–3300ms — away from t=0, so an origin-shift bug can't hide
  tl.modifiers.push({ id: 'cm', nodeId: proj.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20, blockId: blinkBlock.id });

  const noModifier = defaultProject();
  const inside = buildScene(evaluateRig(proj, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!; // 250ms into Blink
  const baseline2650 = buildScene(evaluateRig(noModifier, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  ok('a clip-scoped effect actually runs inside its own clip', Math.abs(inside.w - baseline2650.w) > 5,
    `${inside.w} vs ${baseline2650.w}`);

  // Idle runs 0–2400ms — well outside Blink's window, so the effect must vanish there
  const outsideDuringIdle = buildScene(evaluateRig(proj, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const baseline250 = buildScene(evaluateRig(noModifier, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  ok('a clip-scoped effect does not leak into a different clip', Math.abs(outsideDuringIdle.w - baseline250.w) < 1e-6,
    `${outsideDuringIdle.w} vs ${baseline250.w}`);

  // the effect's own phase is relative to the clip's start, not absolute timeline time —
  // its *contribution* 250ms into Blink (starts at 2400ms) must match a global one's
  // contribution 250ms into t=0, not 2650ms in. Compares deltas against the same
  // no-modifier baselines, so the unrelated keyframed motion each preset already does at
  // that absolute time (which legitimately differs between t=250 and t=2650) cancels out.
  const globalEquivalent = defaultProject();
  activeTimeline(globalEquivalent).modifiers.push({ id: 'gm', nodeId: globalEquivalent.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20 });
  const globalAt250 = buildScene(evaluateRig(globalEquivalent, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const globalAt2650 = buildScene(evaluateRig(globalEquivalent, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const insideDelta = inside.w - baseline2650.w;
  const global250Delta = globalAt250.w - baseline250.w;
  const global2650Delta = globalAt2650.w - baseline2650.w;
  ok('a clip-scoped effect phases from its own clip start, not absolute timeline time',
    Math.abs(insideDelta - global250Delta) < 0.05 && Math.abs(insideDelta - global2650Delta) > 5,
    `Δinside=${insideDelta} vs Δglobal@250=${global250Delta} vs Δglobal@2650=${global2650Delta}`);

  // removing the block it belongs to must drop the effect too, not leave it orphaned
  useEditor.getState().loadProject(proj);
  useEditor.getState().removeBlock(blinkBlock.id);
  ok('removing a clip drops its per-clip effects along with it',
    !activeTimeline(useEditor.getState().project).modifiers.some((m) => m.id === 'cm'));
}

// --- per-clip playback speed and loop ---------------------------------------------
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const talk = tl.blocks[2]; // 3300–4900ms, body.transform.scale.y is a multi-segment track
  const talkTrack = tl.tracks.find((t) => t.blockId === talk.id && t.nodeId === 'body' && t.property === 'transform.scale.y')!;

  talk.speed = 2;
  const withSpeed = valueAt(proj, 'body', 'transform.scale.y', 3300 + 300);
  const expected = sampleTrack(talkTrack, 3300 + 300 * 2); // 2x speed samples the source at double the elapsed local time
  ok('block speed re-times its own sampling, not the block\'s position or duration',
    Math.abs((withSpeed as number) - (expected as number)) < 1e-6, `${withSpeed} vs ${expected}`);
  delete talk.speed;

  const blink = tl.blocks[1]; // 2400–3300ms; its preset's natural length is 900ms
  const before = blink.durationMs;
  blink.loop = true; // set *before* relayoutBlocks: a looping block keeps its natural
  // timing on resize instead of being proportionally stretched, so there's still a
  // natural-length cycle for evaluateRig to wrap at, not just one stretched-out playthrough
  relayoutBlocks(tl, tl.blocks.map((b) => (b.id === blink.id ? { ...b, durationMs: before * 3, loop: true } : b)));

  const atFirstRep = valueAt(proj, 'eyeL', 'eye.openness', 2400 + 200);
  const atThirdRep = evaluateRig(proj, 2400 + before * 2 + 200).nodes.eyeL.eye!.openness;
  ok('a looping clip repeats its own content instead of holding the last frame',
    Math.abs((atFirstRep as number) - atThirdRep) < 1e-6, `${atFirstRep} vs ${atThirdRep}`);

  const nonLoopProj = defaultProject();
  const nonLoopBlink = activeTimeline(nonLoopProj).blocks[1];
  relayoutBlocks(activeTimeline(nonLoopProj), activeTimeline(nonLoopProj).blocks.map((b) => (b.id === nonLoopBlink.id ? { ...b, durationMs: before * 3 } : b)));
  const nonLoopAtThirdRep = evaluateRig(nonLoopProj, 2400 + before * 2 + 200).nodes.eyeL.eye!.openness;
  ok('without loop, the same resize instead proportionally stretches the content (existing behavior unchanged)',
    Math.abs(nonLoopAtThirdRep - (atFirstRep as number)) > 0.05, `${nonLoopAtThirdRep} vs ${atFirstRep}`);
}

// --- transitions: runtime blend between the outgoing pose and the incoming animation
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const idle = tl.blocks[0]; // 0–2400ms
  tl.transitions = [{ id: 'tx', afterBlockId: idle.id, durationMs: 400, easing: { type: 'linear' } }];
  const boundary = 2400;

  // the same project with the transition explicitly turned off — the "no blending at
  // all" baseline. An *empty* transitions array no longer means this (every seam morphs
  // by default now — see the dedicated default-transition test below), so this has to be
  // an explicit durationMs:0 hard cut, the one real opt-out that exists.
  const noTransitionProj = { ...proj, timelines: proj.timelines.map((t) => (t.id === tl.id ? { ...t, transitions: [{ id: 'none', afterBlockId: idle.id, durationMs: 0, easing: { type: 'linear' as const } }] } : t)) };
  const rawAtBoundary = evaluateRig(noTransitionProj, boundary);

  const atSeam = evaluateRig(proj, boundary); // progress 0 — must read as 100% outgoing
  ok('right at the seam, the blend is entirely the outgoing clip\'s pose',
    Math.abs(atSeam.nodes.eyeL.eye!.openness - rawAtBoundary.nodes.eyeL.eye!.openness) < 1e-6,
    `${atSeam.nodes.eyeL.eye!.openness} vs ${rawAtBoundary.nodes.eyeL.eye!.openness}`);

  const incomingLiveAtEnd = evaluateRig(noTransitionProj, boundary + 400).nodes.eyeL.eye!.openness;
  const atEnd = evaluateRig(proj, boundary + 399.99); // progress ≈ 1 — must read as ≈100% incoming
  ok('by the end of the transition, the blend is essentially the incoming clip\'s own animation',
    Math.abs(atEnd.nodes.eyeL.eye!.openness - incomingLiveAtEnd) < 0.01,
    `${atEnd.nodes.eyeL.eye!.openness} vs ${incomingLiveAtEnd}`);

  const mid = evaluateRig(proj, boundary + 200).nodes.body.surface.yaw;
  const outVal = rawAtBoundary.nodes.body.surface.yaw;
  const inVal = evaluateRig(noTransitionProj, boundary + 200).nodes.body.surface.yaw;
  ok('midway through a linear transition, the blend sits between outgoing and incoming',
    (mid - outVal) * (inVal - mid) >= -1e-9, // mid must lie on the segment between out and in
    `out=${outVal} mid=${mid} in=${inVal}`);

  ok('a transition never touches the outgoing or incoming clip\'s own stored keyframes',
    JSON.stringify(activeTimeline(proj).tracks) === JSON.stringify(activeTimeline(noTransitionProj).tracks));

  const beforeCount = tl.blocks.length;
  useEditor.getState().loadProject(proj);
  useEditor.getState().removeBlock(idle.id);
  ok('removing a clip drops the transition that followed it',
    activeTimeline(useEditor.getState().project).blocks.length === beforeCount - 1
    && !activeTimeline(useEditor.getState().project).transitions?.some((x) => x.id === 'tx'));

  // the checks above all happen to use properties/moments where the default project's own
  // authored values coincide at the Idle/Blink boundary (Idle's own yaw curve returns to 0
  // by its end; Blink never touches yaw either) — every one of them still passes if the
  // "outgoing" snapshot is silently captured on the *incoming* side of the seam instead
  // (blending a value with itself is invisible). Use a property forced to genuinely differ
  // on each side, so a regression like that can't hide behind coincidentally-equal fixture
  // data the way it did the first time this was written.
  useEditor.getState().loadProject(defaultProject());
  const idle2 = activeTimeline(useEditor.getState().project).blocks[0];
  useEditor.getState().setPlayhead(100);
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 60, 'rot2');
  useEditor.getState().setTransition(idle2.id, { durationMs: 400, easing: { type: 'linear' } });
  const rotAtSeam = evaluateRig(useEditor.getState().project, 2400).nodes.body.transform.rotation;
  const rotMidway = evaluateRig(useEditor.getState().project, 2600).nodes.body.transform.rotation;
  const rotAtEnd = evaluateRig(useEditor.getState().project, 2800).nodes.body.transform.rotation;
  ok('a transition actually morphs a property that differs on each side of the seam, not a same-value no-op',
    Math.abs(rotAtSeam - 60) < 1e-6 && Math.abs(rotMidway - 30) < 1e-6 && Math.abs(rotAtEnd) < 1e-6,
    `seam=${rotAtSeam} mid=${rotMidway} end=${rotAtEnd} (want 60, 30, 0)`);
}

// --- duplicateBlock: an independent instance, inserted right after the original --------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const idle = PT().blocks[0];
  const trackCountBefore = PT().tracks.filter((t) => t.blockId === idle.id).length;
  const blockCountBefore = PT().blocks.length;

  useEditor.getState().duplicateBlock(idle.id);
  ok('duplicate inserts a new block right after the original', PT().blocks.length === blockCountBefore + 1
    && PT().blocks[1].presetId === idle.presetId && PT().blocks[1].id !== idle.id);

  const dup = PT().blocks[1];
  ok('duplicate gets its own copy of the tracks, not shared references',
    PT().tracks.filter((t) => t.blockId === dup.id).length === trackCountBefore
    && PT().tracks.filter((t) => t.blockId === dup.id).every((t) => !PT().tracks.some((o) => o.blockId === idle.id && o.id === t.id)));

  ok('the duplicate is selected for editing', useEditor.getState().selectedBlockId === dup.id);

  // editing a property inside the duplicate's own window must never touch the original's
  // corresponding track — they're independent instances, not a shared reference
  const idleTrack = PT().tracks.find((t) => t.blockId === idle.id)!;
  const idleFirstKfBefore = JSON.stringify(idleTrack.keyframes[0]);
  const dupWindowMidpoint = idle.durationMs + idle.durationMs / 2; // dup sits right after idle
  useEditor.getState().setPlayhead(dupWindowMidpoint);
  useEditor.getState().setValue(idleTrack.nodeId, idleTrack.property, 999, 'test');
  ok('editing the duplicate\'s track does not mutate the original clip\'s keyframes',
    JSON.stringify(PT().tracks.find((t) => t.id === idleTrack.id)!.keyframes[0]) === idleFirstKfBefore);
  ok('the edit actually landed on the duplicate\'s own track',
    PT().tracks.find((t) => t.blockId === dup.id && t.nodeId === idleTrack.nodeId && t.property === idleTrack.property)!
      .keyframes.some((k) => k.value === 999));
  useEditor.getState().undo();

  const blocksEndAfter = PT().blocks.reduce((s, b) => s + b.durationMs, 0);
  ok('duplicating extends the sequence by exactly the original\'s duration',
    blocksEndAfter === PT().blocks.filter((b) => b.id !== dup.id).reduce((s, b) => s + b.durationMs, 0) + idle.durationMs);
}

// --- addClipFrom: "another timeline" and gallery animations as a clip source -----------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const blocksBefore = PT().blocks.length;

  // a same-project source timeline — every track is trivially rig-compatible
  const source = makeTimeline('Wave');
  source.tracks = [{ id: 'wt', nodeId: 'body', property: 'transform.rotation', keyframes: [{ id: 'wk1', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'wk2', time: 500, value: 20, easingOut: { type: 'linear' } }] }];
  source.timelineDurationMs = 500;
  useEditor.getState().addClipFrom({ label: 'Wave', timeline: source });
  ok('addClipFrom appends a new clip built from another timeline\'s tracks',
    PT().blocks.length === blocksBefore + 1 && PT().blocks.at(-1)!.name === 'Wave'
    && PT().tracks.some((t) => t.blockId === PT().blocks.at(-1)!.id && t.nodeId === 'body' && t.property === 'transform.rotation'));
  ok('the new clip is selected', useEditor.getState().selectedBlockId === PT().blocks.at(-1)!.id);

  // a "gallery" timeline whose rig doesn't fully match this one — one track on a real
  // node (body), one on a node this rig has no idea about (a custom layer from some
  // other mascot). Only the compatible one should ever make it into the sequence.
  const incompatible = makeTimeline('Foreign');
  incompatible.tracks = [
    { id: 'ft1', nodeId: 'body', property: 'surface.yaw', keyframes: [{ id: 'fk1', time: 0, value: 10, easingOut: { type: 'linear' } }] },
    { id: 'ft2', nodeId: 'tentacle_9', property: 'transform.rotation', keyframes: [{ id: 'fk2', time: 0, value: 5, easingOut: { type: 'linear' } }] },
  ];
  incompatible.timelineDurationMs = 300;
  const blocksBefore2 = PT().blocks.length;
  useEditor.getState().addClipFrom({
    label: 'Foreign', timeline: incompatible,
    gallerySource: { galleryId: 'g1', galleryName: 'Some Other Mascot', timelineId: incompatible.id, timelineName: 'Foreign' },
  });
  const added = PT().blocks.at(-1)!;
  ok('a rig-incompatible track is silently skipped, not copied in',
    PT().blocks.length === blocksBefore2 + 1
    && !PT().tracks.some((t) => t.blockId === added.id && t.nodeId === 'tentacle_9'));
  ok('a rig-compatible track from the same source still comes along',
    PT().tracks.some((t) => t.blockId === added.id && t.nodeId === 'body' && t.property === 'surface.yaw'));
  ok('the clip remembers it came from a gallery item, for the inspector\'s source label',
    added.gallerySource?.galleryName === 'Some Other Mascot');

  // a *multi-block* source timeline (any real saved project — defaultProject()'s own
  // active timeline has 4) contributes several tracks for the same property, one per its
  // own sub-block. Brought in as one clip, this used to "deform the mascot": every copied
  // track shared the new clip's single blockId, so activeTrackFor couldn't tell them
  // apart and just picked whichever sub-block's track came first, for the clip's entire
  // span. mergeTracksForClip combines same-property tracks into one before copying.
  const sourceProj = defaultProject();
  const sourceTl = activeTimeline(sourceProj);
  useEditor.getState().loadProject(defaultProject());
  useEditor.getState().addClipFrom({
    label: 'Idle (imported)', timeline: sourceTl,
    gallerySource: { galleryId: 'g2', galleryName: 'Other', timelineId: sourceTl.id, timelineName: 'Idle' },
  });
  const importedTl = activeTimeline(useEditor.getState().project);
  const imported = importedTl.blocks.at(-1)!;
  const importedStart = blockStarts(importedTl).at(-1)!;
  ok('a multi-block source becomes exactly one new clip, not several',
    imported.durationMs === sourceTl.timelineDurationMs
    && importedTl.tracks.filter((t) => t.blockId === imported.id && t.nodeId === 'eyeL' && t.property === 'eye.openness').length === 1);
  let worstDiff = 0;
  for (const rel of [100, 500, 1200, 1790, 1880, 2400, 2800, 3220, 3600, 4200, 4900, 5200, 5900, 6299]) {
    const got = evaluateRig(useEditor.getState().project, importedStart + rel).nodes.eyeL.eye!.openness;
    const want = evaluateRig(sourceProj, rel).nodes.eyeL.eye!.openness;
    worstDiff = Math.max(worstDiff, Math.abs(got - want));
  }
  ok('the imported clip reproduces the source\'s full animation exactly, no cross-block bleed',
    worstDiff < 1e-6, `worst diff ${worstDiff}`);
}

// --- moveBlock: reordering drags its keyframes along, in one undo step ---------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const names = () => PT().blocks.map((b) => b.name);
  ok('default order', names().join(',') === 'Idle,Blink,Talk,Happy', names().join(','));

  const blinkId = PT().blocks[1].id;
  const blinkTrackBefore = PT().tracks.find((t) => t.blockId === blinkId)!;
  const blinkKeysBefore = blinkTrackBefore.keyframes.map((k) => k.value);

  useEditor.getState().moveBlock(blinkId, 3); // drag Blink to the very end
  ok('block moved to the end', names().join(',') === 'Idle,Talk,Happy,Blink', names().join(','));
  const blinkTrackAfter = PT().tracks.find((t) => t.id === blinkTrackBefore.id)!;
  ok('its keyframe VALUES are untouched by the move', JSON.stringify(blinkTrackAfter.keyframes.map((k) => k.value)) === JSON.stringify(blinkKeysBefore));
  ok('its keyframe TIMES shifted to its new slot', blinkTrackAfter.keyframes[0].time > blinkTrackBefore.keyframes[0].time);
  const starts = blockStarts(PT());
  ok('blocks are contiguous with no gap after reordering', starts.every((s, i) => i === 0 || s === starts[i - 1] + PT().blocks[i - 1].durationMs));

  useEditor.getState().undo();
  ok('undo restores the original order', names().join(',') === 'Idle,Blink,Talk,Happy', names().join(','));
}

// --- resolveTracks: the loop seam is derived, never written into the file ------
{
  type TL = ReturnType<typeof activeTimeline>;
  /** a project whose active timeline is exactly these tracks/blocks */
  const fixture = (tracks: TL['tracks'], blocks: TL['blocks'], durationMs: number, loop = true) => {
    const p = defaultProject();
    const tl = activeTimeline(p);
    tl.loop = loop;
    tl.blocks = blocks;
    tl.tracks = tracks;
    tl.timelineDurationMs = durationMs;
    return p;
  };

  // a fixture that deliberately does NOT return to its start value — the whole point —
  // and whose outgoing easing is deliberately NOT easeOut, to prove the close forces its
  // own easeOut rather than happening to inherit it from the segment before
  const openTrack = { id: 't1', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 10, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 70, easingOut: { type: 'linear' as const } },
  ] };
  const off = resolveTracks(fixture([openTrack], [], 2000, false));
  ok('loop off: tracks pass through completely unchanged', off[0] === openTrack);

  const looped = resolveTracks(fixture([openTrack], [], 2000));
  const seam = looped[0];
  ok('loop on: the original track object is not mutated', openTrack.keyframes.length === 2);
  ok('loop on: a closing keyframe is appended at the very end', seam.keyframes.length === 3 && seam.keyframes[2].time === 2000);
  ok('the closing value matches the pose rendered at t=0', seam.keyframes[2].value === 10);
  ok('so the last frame and the first frame land on the same pose', sampleTrack(seam, 2000) === sampleTrack(seam, 0));
  ok('the close always eases in with easeOut, not whatever the outgoing segment used', seam.keyframes[2].easingOut.type === 'preset' && (seam.keyframes[2].easingOut as { name: string }).name === 'easeOut');

  // even a track already flat at its start value still gets its own closing keyframe —
  // "first frame == last frame" holds unconditionally, not just when there's a gap to close
  const constTrack = { id: 't2', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 5, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 5, easingOut: { type: 'linear' as const } },
  ] };
  const stillClosed = resolveTracks(fixture([constTrack], [], 2000));
  ok('a track already flat at its start value still gets a closing keyframe', stillClosed[0].keyframes.length === 3 && stillClosed[0].keyframes[2].value === 5);

  // evaluateRig actually uses this — the seam is visible in playback, not just in theory.
  const proj = fixture([{ id: 't3', nodeId: 'body', property: 'transform.rotation', keyframes: openTrack.keyframes }], [], 2000);
  const atEnd = evaluateRig(proj, 2000).nodes.body.transform.rotation;
  const atStart = evaluateRig(proj, 0).nodes.body.transform.rotation;
  ok('evaluateRig itself loops the pose, not just the raw track helper', atEnd === atStart, `${atEnd} vs ${atStart}`);

  /** two 1000ms clips, so the tail is owned by a different clip than t=0 is */
  const twoClips = (tracksFor: (a: string, b: string) => TL['tracks']) => {
    const p = defaultProject();
    const tl = activeTimeline(p);
    tl.loop = true;
    tl.blocks = tl.blocks.slice(0, 2);
    for (const b of tl.blocks) { b.durationMs = 1000; b.loop = false; b.speed = 1; }
    tl.timelineDurationMs = 2000;
    tl.tracks = tracksFor(tl.blocks[0].id, tl.blocks[1].id);
    return p;
  };

  // THE reported bug: yaw/pitch read 0 at t=0 but 9.2/21.0 at the loop point, because the
  // closing clip owns its own separate track for that property and each track was closing
  // back to *its own* t=0 rather than to the pose actually on screen at t=0.
  const crossProj = twoClips((a, b) => [
    { id: 'ca', nodeId: 'body', property: 'transform.rotation', blockId: a, keyframes: [
      { id: 'ca1', time: 0, value: 10, easingOut: { type: 'linear' as const } },
      { id: 'ca2', time: 900, value: 80, easingOut: { type: 'linear' as const } }] },
    { id: 'cb', nodeId: 'body', property: 'transform.rotation', blockId: b, keyframes: [
      { id: 'cb1', time: 1200, value: 200, easingOut: { type: 'linear' as const } },
      { id: 'cb2', time: 1900, value: 250, easingOut: { type: 'linear' as const } }] },
  ]);
  const xEnd = evaluateRig(crossProj, 2000).nodes.body.transform.rotation;
  const xStart = evaluateRig(crossProj, 0).nodes.body.transform.rotation;
  ok('a property owned by a different clip at the tail still closes onto the t=0 pose', xEnd === xStart, `${xEnd} vs ${xStart}`);

  // and the harder half: a property the closing clip does not animate at all, so there is
  // no track there to hang the closing keyframe on — one has to be synthesized
  const orphanProj = twoClips((a) => [
    { id: 'oa', nodeId: 'body', property: 'surface.pitch', blockId: a, keyframes: [
      { id: 'oa1', time: 0, value: 15, easingOut: { type: 'linear' as const } },
      { id: 'oa2', time: 900, value: 60, easingOut: { type: 'linear' as const } }] },
  ]);
  const oEnd = evaluateRig(orphanProj, 2000).nodes.body.surface.pitch;
  const oStart = evaluateRig(orphanProj, 0).nodes.body.surface.pitch;
  ok('a property the closing clip never animates still gets closed onto the t=0 pose', oEnd === oStart, `${oEnd} vs ${oStart}`);

  // a clip-owned track must hold its pose into any padding where the timeline's own
  // duration outlives the sum of block durations — not snap to the rig's bare defaults
  // the instant blockAt stops recognizing the time as "inside" the last block (the bug
  // behind the reported yaw/pitch jump right at the loop point)
  const proj3 = defaultProject();
  const ptl3 = activeTimeline(proj3);
  ptl3.blocks = [ptl3.blocks[0]];
  ptl3.timelineDurationMs = ptl3.blocks[0].durationMs + 300;
  ptl3.tracks = [{ id: 't4', nodeId: 'body', property: 'transform.rotation', blockId: ptl3.blocks[0].id,
    keyframes: [{ id: 'a', time: 50, value: 42, easingOut: { type: 'linear' } }] }];
  const inPadding = evaluateRig(proj3, ptl3.blocks[0].durationMs + 150).nodes.body.transform.rotation;
  ok('a clip-owned track holds its value past blocksEnd instead of resetting to defaults', inPadding === 42, `${inPadding}`);
}

// --- the store: block retiming, undo, tool calls -------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const blockTracks = (id: string) => PT().tracks.filter((t) => t.blockId === id);
  const span = (id: string) => {
    const times = blockTracks(id).flatMap((t) => t.keyframes.map((k) => k.time));
    return [Math.min(...times), Math.max(...times)];
  };

  ok('default file has four blocks', PT().blocks.length === 4);
  const [b0, b1] = PT().blocks;
  ok('first block starts at zero', span(b0.id)[0] === 0);
  ok('second block starts where the first ends', Math.abs(span(b1.id)[0] - b0.durationMs) < 1);

  // stretching a block must drag everything after it along
  const beforeStart = span(b1.id)[0];
  useEditor.getState().setBlockDuration(b0.id, b0.durationMs * 2);
  ok('stretching a block scales its own keys', Math.abs(span(b0.id)[1] - b0.durationMs * 2) < 12,
    `${span(b0.id)[1]} vs ${b0.durationMs * 2}`);
  ok('stretching a block shifts the next one', Math.abs(span(b1.id)[0] - beforeStart * 2) < 12,
    `${span(b1.id)[0]} vs ${beforeStart * 2}`);
  ok('duration follows the blocks', PT().timelineDurationMs >= PT().blocks.reduce((a, b) => a + b.durationMs, 0));

  useEditor.getState().undo();
  ok('undo restores the original duration', PT().blocks[0].durationMs === b0.durationMs);
  useEditor.getState().redo();
  ok('redo reapplies it', PT().blocks[0].durationMs === b0.durationMs * 2);
  useEditor.getState().undo();

  const trackCount = PT().tracks.length;
  useEditor.getState().removeBlock(b0.id);
  ok('removing a block drops its tracks', PT().tracks.length < trackCount && blockTracks(b0.id).length === 0);
  ok('and closes the gap', span(PT().blocks[0].id)[0] === 0);
  useEditor.getState().undo();
  ok('undo brings the block back', PT().blocks.length === 4 && PT().tracks.length === trackCount);

  // toggling a track off must not move the pose
  useEditor.getState().setPlayhead(1200);
  const yawBefore = valueAt(P(), 'body', 'surface.yaw', 1200) as number;
  useEditor.getState().toggleTrack('body', 'surface.yaw');
  ok('un-animating bakes the current value', Math.abs((valueAt(P(), 'body', 'surface.yaw', 1200) as number) - yawBefore) < 1e-6,
    `${valueAt(P(), 'body', 'surface.yaw', 1200)} vs ${yawBefore}`);
  useEditor.getState().undo();

  // a clip is a sealed instance: a property toggled/edited while scrubbed into one clip
  // must stay that clip's own override, never leak into a different (especially a brand
  // new, blank) clip that doesn't animate the property itself.
  useEditor.getState().setPlayhead(500); // inside Idle (0–2400ms)
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 33, 'rot');
  ok('an edit made inside one clip applies there', evaluateRig(P(), 500).nodes.body.transform.rotation === 33);
  useEditor.getState().addBlock('p_neutral'); // the blank builtin preset — appends at the end
  const neutral = PT().blocks.at(-1)!;
  const neutralMid = blockStarts(PT()).at(-1)! + neutral.durationMs / 2;
  ok('a brand-new blank clip shows the rig\'s own rest pose, not another clip\'s edit',
    evaluateRig(P(), neutralMid).nodes.body.transform.rotation === 0,
    `${evaluateRig(P(), neutralMid).nodes.body.transform.rotation}`);
  useEditor.getState().undo();
  useEditor.getState().undo();
  useEditor.getState().undo();

  // expressions and morphs — both ends land inside Talk's window (3300–4900ms), so this
  // exercises "one clip's own track gets both keyframes" rather than the cross-clip case
  // covered separately below.
  useEditor.getState().morphBetween('x_neutral', 'x_surprised', 3400, 400, { type: 'preset', name: 'easeInOut' });
  const scaleTrack = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3400);
  ok('morph wrote both ends', !!scaleTrack
    && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3400) < 1)
    && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3800) < 1));
  ok('morph skips properties that match', !PT().tracks.some((t) => t.nodeId === 'body' && t.property === 'surface.pitch'
    && t.keyframes.some((k) => Math.abs(k.time - 3400) < 1)));
  useEditor.getState().undo();

  // a morph spanning a clip boundary writes into *each* clip's own track — a clip is a
  // sealed instance, so one keyframe can't reach across into a different clip's track.
  useEditor.getState().morphBetween('x_neutral', 'x_surprised', 3000, 400, { type: 'preset', name: 'easeInOut' }); // 3000 in Blink, 3400 in Talk
  const blinkScale = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3000);
  const talkScale = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3400);
  ok('a morph across a clip boundary lands in two independent clip-scoped tracks',
    !!blinkScale && !!talkScale && blinkScale.id !== talkScale.id
    && blinkScale.keyframes.some((k) => Math.abs(k.time - 3000) < 1)
    && talkScale.keyframes.some((k) => Math.abs(k.time - 3400) < 1));
  useEditor.getState().undo();

  // duration: can extend past content (a trailing hold), shrinking clamps keyframes onto
  // the new end instead of dropping them, and it can never shrink below the tiled blocks.
  const blocksLen = PT().blocks.reduce((s, b) => s + b.durationMs, 0);
  useEditor.getState().setTimelineDuration(blocksLen + 5000);
  ok('duration can extend past the blocks', Math.abs(PT().timelineDurationMs - (blocksLen + 5000)) < 1);
  useEditor.getState().setTimelineDuration(1); // coalesces with the extend above — one edit
  // the floor is blocksLen OR later (a block's own final keyframe can sit right at its
  // block's end, which the pre-existing lastKeyframe+200 padding then pushes past it) —
  // the invariant setTimelineDuration actually owns is just "never *below* the blocks".
  ok('duration cannot shrink below the tiled blocks', PT().timelineDurationMs >= blocksLen - 1,
    `${PT().timelineDurationMs} vs ${blocksLen}`);
  useEditor.getState().undo();

  // a free (blockless) keyframe out past the blocks — the only kind shrinking can reach,
  // since every block-owned keyframe already lives inside its own block's window.
  useEditor.getState().commit((p) => { writeKeyframe(p, 'body', 'transform.rotation', blocksLen + 3000, 40, { type: 'linear' }); });
  useEditor.getState().setTimelineDuration(blocksLen + 500);
  ok('shrinking clamps an out-of-range keyframe onto the new end instead of dropping it',
    PT().tracks.find((t) => t.nodeId === 'body' && t.property === 'transform.rotation')!
      .keyframes.some((k) => Math.abs(k.time - (blocksLen + 500)) < 1));
  useEditor.getState().undo();
  useEditor.getState().undo();

  // --- state machine: setState/enableState, scheduling, blending, previous-state -------
  // defaultProject() ships one timeline ("Idle") with the four presets as its own blocks —
  // states are a *project's timelines*, so this needs a few more of those to test against.
  {
    useEditor.getState().loadProject(defaultProject());
    const P = () => useEditor.getState().project;
    const idleId = P().activeTimelineId;
    useEditor.getState().addTimeline('Blink state');
    useEditor.getState().addTimeline('Happy state');
    useEditor.getState().addTimeline('Talk state');
    useEditor.getState().setActiveTimeline(idleId); // addTimeline switches to each as it's made
    const blinkTl = P().timelines.find((t) => t.name === 'Blink state')!;
    const happyTl = P().timelines.find((t) => t.name === 'Happy state')!;
    const talkTl = P().timelines.find((t) => t.name === 'Talk state')!;

    useEditor.getState().setState('blink state'); // name match is case-insensitive
    ok('setState switches the active timeline by name, case-insensitively', P().activeTimelineId === blinkTl.id);
    ok('setState resets the playhead for the new state', useEditor.getState().playhead === 0);
    ok('setState records what was active before it', useEditor.getState().previousTimelineId === idleId);
    ok('setState morphs by default — no opts still sets up a blend to preview, not an instant cut',
      useEditor.getState().stateTransition !== null && useEditor.getState().stateTransition!.durationMs > 0);
    useEditor.getState().clearStateTransition();

    useEditor.getState().returnToPreviousState({ duration: 0 });
    ok('returnToPreviousState switches back', P().activeTimelineId === idleId);
    ok('{ duration: 0 } opts out of the morph for an instant cut', useEditor.getState().stateTransition === null);

    useEditor.getState().setState(happyTl.id, { duration: 250, easing: { type: 'linear' } });
    ok('an explicit duration overrides the default', useEditor.getState().stateTransition?.durationMs === 250);
    useEditor.getState().clearStateTransition();

    useEditor.getState().setPlayhead(0);
    useEditor.getState().setState(talkTl.id, { at: 5000 });
    ok('setState with a future "at" schedules instead of switching immediately',
      P().activeTimelineId === happyTl.id && useEditor.getState().pendingStateChange?.timelineId === talkTl.id);
    useEditor.getState().cancelScheduledState();
    ok('cancelScheduledState clears the pending switch', useEditor.getState().pendingStateChange === null);

    useEditor.getState().setState('does-not-exist');
    ok('setState silently ignores an unknown name/id rather than clearing the active state',
      P().activeTimelineId === happyTl.id);

    // land back on Idle — the copilot section right after this shares this scope's PT()
    useEditor.getState().setActiveTimeline(idleId);
  }

  // copilot tool calls: validated, then applied as one undo step
  const calls: ToolCall[] = [
    { name: 'add_preset_to_timeline', args: { preset: 'Blink' } },
    { name: 'set_eye_params', args: { nodeId: 'eyeL', openness: 0.3, atMs: 500 } },
    { name: 'add_modifier', args: { nodeId: 'body', kind: 'float', amount: 80, frequency: 0.5, amplitude: 6 } },
  ];
  ok('valid calls pass validation', calls.every((c) => validate(P(), c) === null),
    calls.map((c) => validate(P(), c)).join('|'));
  ok('a bad layer is rejected', validate(P(), { name: 'set_eye_params', args: { nodeId: 'nope' } }) !== null);
  ok('a bad property is rejected', validate(P(), { name: 'set_property', args: { nodeId: 'body', property: 'hack', value: 1 } }) !== null);
  ok('an unknown tool is rejected', validate(P(), { name: 'rm_rf', args: {} }) !== null);
  ok('calls describe themselves', describe(P(), calls[0]).includes('Blink'));

  const blocksBefore = PT().blocks.length;
  applyCalls(calls);
  ok('tool calls applied', PT().blocks.length === blocksBefore + 1
    && PT().modifiers.length === 1
    && (valueAt(P(), 'eyeL', 'eye.openness', 500) as number) === 0.3);
  useEditor.getState().undo();
  ok('one undo reverses the whole batch', PT().blocks.length === blocksBefore && PT().modifiers.length === 0);
}

// --- copilot: parsing what models actually send back ---------------------------
{
  // verbatim replies from gpt-oss:120b via Ollama Cloud, where `format` is not enforced
  const cloudA = '```json\n[\n  { "add_preset_to_timeline": { "preset": "Blink", "index": 0 } },\n  { "add_preset_to_timeline": { "preset": "Blink", "index": 1 } },\n  { "apply_expression": { "expression": "Surprised", "atMs": 2500 } }\n]\n```';
  const cloudB = '```json\n{\n  "calls": [\n    { "add_preset_to_timeline": { "preset": "Thinking", "index": 0 } },\n    { "add_modifier": { "nodeId": "Body", "kind": "float", "amount": 10, "frequency": 0.2, "amplitude": 5 } }\n  ]\n}\n```';

  const a = parseTurn(cloudA);
  ok('fenced bare array parses', a.calls.length === 3, JSON.stringify(a.calls));
  ok('{tool: args} becomes {name, args}', a.calls[0].name === 'add_preset_to_timeline' && a.calls[0].args.preset === 'Blink');
  ok('blink twice then surprised', a.calls.filter((c) => c.args.preset === 'Blink').length === 2
    && a.calls[2].name === 'apply_expression' && a.calls[2].args.expression === 'Surprised');

  const b = parseTurn(cloudB);
  ok('fenced {calls:[...]} parses', b.calls.length === 2);
  ok('missing reply is tolerated', b.reply === '');

  // the strict shape must still work
  const strict = parseTurn('{"reply":"done","calls":[{"name":"add_modifier","args":{"nodeId":"body","kind":"shake","amount":50,"frequency":8,"amplitude":4}}]}');
  ok('documented shape parses', strict.reply === 'done' && strict.calls[0].name === 'add_modifier');
  // and the awkward ones
  ok('prose before the json', parseTurn('Sure! Here you go:\n{"reply":"hi","calls":[]}').reply === 'hi');
  ok('tool_calls alias', parseTurn('{"tool_calls":[{"tool":"add_keyframe","arguments":{"nodeId":"body","property":"surface.yaw","atMs":100,"value":10}}]}').calls.length === 1);
  ok('a single unwrapped call', parseTurn('{"name":"apply_expression","args":{"expression":"Happy","atMs":0}}').calls.length === 1);
  ok('junk is rejected, not guessed', (() => { try { parseTurn('I cannot do that'); return false; } catch { return true; } })());
  ok('unknown tools are dropped', parseTurn('{"calls":[{"name":"drop_database","args":{}}]}').calls.length === 0);

  // what actually broke "create a big eye effect": the JSON itself was fine, but the
  // model kept talking past the closing brace and the whole blob went to JSON.parse
  ok('prose AFTER the json', parseTurn('{"reply":"hi","calls":[]}\n\nHope that helps!').reply === 'hi');
  ok('an unclosed fence still parses', parseTurn('```json\n{"reply":"hi","calls":[]}').reply === 'hi');
  ok('prose is reported as no JSON, not as a cut-off', (() => {
    try { parseTurn('I cannot do that'); return false; } catch (e) { return /did not return JSON/.test((e as Error).message); }
  })());

  // and when a reply genuinely runs out of budget, keep the calls it did manage to emit
  const cut = '{"reply":"Here is a BigEye preset.","calls":[{"name":"add_preset_to_timeline","args":{"preset":"Blink"}},{"name":"set_eye_par';
  const salvaged = parseTurn(cut);
  ok('a truncated response keeps its complete calls',
    salvaged.calls.length === 1 && salvaged.reply.startsWith('Here is'), JSON.stringify(salvaged));
  ok('a truncated reply-only string still yields the reply', parseTurn('{"reply":"half a sen').reply === 'half a sen');
  ok('the new tool names survive the parser',
    parseTurn('{"calls":[{"name":"set_camera","args":{"property":"distance","value":3}},{"move_block":{"block":0,"index":1}}]}').calls.length === 2);

  // normalisation: layer names and argument aliases become the real thing
  const proj = defaultProject();
  const n1 = normaliseCall(proj, { name: 'add_modifier', args: { nodeId: 'Body', kind: 'float', amount: 10, frequency: 0.2, amplitude: 5 } });
  ok('a layer name resolves to its id', n1.args.nodeId === 'body', String(n1.args.nodeId));
  ok('and then validates', validate(proj, n1) === null, String(validate(proj, n1)));
  const n2 = normaliseCall(proj, { name: 'apply_expression', args: { expression: 'Surprised', time: 900 } });
  ok('time becomes atMs', n2.args.atMs === 900 && validate(proj, n2) === null);
  const n3 = normaliseCall(proj, { name: 'set_eye_params', args: { layer: 'Left eye', openness: 0.2 } });
  ok('layer alias resolves', n3.args.nodeId === 'eyeL' && validate(proj, n3) === null);
  ok('an unresolvable layer still fails', validate(proj, normaliseCall(proj, { name: 'set_eye_params', args: { nodeId: 'Nose' } })) !== null);

  // the whole cloud reply, end to end
  const applied = a.calls.map((c) => normaliseCall(proj, c));
  ok('the cloud reply validates end to end', applied.every((c) => validate(proj, c) === null),
    applied.map((c) => validate(proj, c)).join('|'));
}

// --- endpoint routing ----------------------------------------------------------
{
  const base = { customUrl: '', model: 'gpt-oss:120b', keys: [] };
  ok('cloud is routed through the local daemon', baseUrl({ ...base, endpoint: 'cloud' }) === LOCAL_URL);
  ok('cloud models take the -cloud suffix', resolveModel({ ...base, endpoint: 'cloud' }, 'gpt-oss:120b') === 'gpt-oss:120b-cloud');
  ok('the suffix is not doubled', resolveModel({ ...base, endpoint: 'cloud' }, 'gpt-oss:120b-cloud') === 'gpt-oss:120b-cloud');
  ok('local models are untouched', resolveModel({ ...base, endpoint: 'local' }, 'llama3') === 'llama3');
  ok('only a custom endpoint needs a key', !needsKey({ ...base, endpoint: 'cloud' }) && !needsKey({ ...base, endpoint: 'local' }) && needsKey({ ...base, endpoint: 'custom' }));
  ok('custom urls lose their trailing slash', baseUrl({ ...base, endpoint: 'custom', customUrl: 'https://proxy.example/' }) === 'https://proxy.example');

  // the cloud tier has two completely different routes, decided by whether keys exist
  const daemon = { ...base, endpoint: 'cloud' as const };
  const backend = { ...daemon, keys: [{ id: 'k', value: 'sk-test', status: 'ok' as const }] };
  ok('your own keys switch cloud onto the backend', usesBackend(backend) && needsKey(backend));
  ok('and no keys leaves it on the local daemon', !usesBackend(daemon));

  // the proxy marker is an instruction TO the daemon; straight to ollama.com it is wrong
  ok('the backend addresses the plain model name',
    resolveModel(backend, 'gpt-oss:120b') === 'gpt-oss:120b'
    && resolveModel(backend, 'gpt-oss:120b-cloud') === 'gpt-oss:120b'
    && resolveModel(backend, 'glm-5.2:cloud') === 'glm-5.2');
  ok('a tagged model takes -cloud on its tag', resolveModel(daemon, 'qwen3.5:397b') === 'qwen3.5:397b-cloud');
  ok('an untagged one takes :cloud AS the tag — "glm-5.2-cloud" is a 404',
    resolveModel(daemon, 'glm-5.2') === 'glm-5.2:cloud');

  // listing must not touch a daemon this route never uses: with no Ollama installed at
  // all, asking localhost reported "not reachable" for a copilot that worked fine
  ok('the backend route lists the catalogue without a network call',
    (await listModels(backend, () => {})).join() === CLOUD_CATALOGUE.join());
}

// --- multiple timelines: isolated tracks, correct active-timeline redirection --
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  const firstId = P().activeTimelineId;
  ed.addTimeline('Wave');
  ok('a new timeline is created and becomes active', P().timelines.length === 2 && P().activeTimelineId !== firstId);
  ok('the new timeline starts with no blocks — a genuinely fresh sequence', activeTimeline(P()).blocks.length === 0);

  // work done on the new (active) timeline must not leak into the first
  ed.toggleTrack('body', 'surface.yaw'); // stopwatch-on: bakes a track at the current value
  ed.setValue('body', 'surface.yaw', 33, 'wavetest');
  ok('a track landed on the SECOND timeline', activeTimeline(P()).tracks.some((t) => t.property === 'surface.yaw' && t.nodeId === 'body'));
  // the first (Idle) timeline already has its own surface.yaw track from the Idle
  // preset — the isolation check is that it never picks up the value written on
  // the second timeline, not that the property is absent there entirely.
  const firstTl = P().timelines.find((t) => t.id === firstId)!;
  ok('the first timeline is untouched', !firstTl.tracks.some((t) => t.property === 'surface.yaw' && t.nodeId === 'body' && t.keyframes.some((k) => k.value === 33)));

  ed.setActiveTimeline(firstId);
  ok('switching back restores the first timeline\'s own content', activeTimeline(P()).id === firstId && activeTimeline(P()).blocks.length === 4);

  ed.renameTimeline(P().activeTimelineId, 'Idle loop');
  ok('rename applies to the right timeline', P().timelines.find((t) => t.id === firstId)!.name === 'Idle loop');

  const secondId = P().timelines.find((t) => t.id !== firstId)!.id;
  ed.deleteTimeline(secondId);
  ok('delete removes it and falls back to a survivor', P().timelines.length === 1 && !P().timelines.some((t) => t.id === secondId));
  ed.deleteTimeline(firstId);
  ok('the last timeline cannot be deleted — always at least one', P().timelines.length === 1);
}

// --- migrate(): a project saved before Stage 3 still loads correctly -----------
{
  const legacy = defaultProject();
  const flat = legacy as unknown as Record<string, unknown>;
  const tl = activeTimeline(legacy);
  flat.tracks = tl.tracks; flat.blocks = tl.blocks; flat.modifiers = tl.modifiers;
  flat.durationMode = tl.durationMode; flat.timelineDurationMs = tl.timelineDurationMs; flat.loop = true;
  delete flat.timelines; delete flat.activeTimelineId;

  useEditor.getState().loadProject(legacy as unknown as Project);
  const p = useEditor.getState().project;
  ok('a legacy flat project is lifted into exactly one timeline', p.timelines.length === 1);
  ok('its blocks made it across', activeTimeline(p).blocks.length === 4);
  ok('its loop flag made it across', activeTimeline(p).loop === true);
  useEditor.getState().loadProject(defaultProject());
}

// --- dotLottie: one state per timeline, 1:1 ------------------------------------
{
  const proj = defaultProject();
  const tl2 = makeTimeline('Wave');
  tl2.tracks.push({ id: 'wt', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: { type: 'linear' } },
    { id: 'b', time: 500, value: 20, easingOut: { type: 'linear' } },
  ] });
  tl2.timelineDurationMs = 500;
  tl2.loop = true;
  proj.timelines.push(tl2);

  const { animations, blob } = buildDotLottie(proj, { background: null });
  ok('one animation per timeline', animations.length === proj.timelines.length, `${animations.length} vs ${proj.timelines.length}`);

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const text = new TextDecoder().decode(bytes);
  // cheap local-file-header scan — good enough to confirm the v2.0 directory names
  // without pulling in a zip-reader for a test
  ok('animations live under a/, not animations/', text.includes('a/idle.json') || text.includes('a/wave.json'));
  ok('the state machine lives under s/, not states/', text.includes('s/mascot.json'));
  ok('no legacy animations/ or states/ path leaked back in', !text.includes('animations/idle.json') && !text.includes('states/mascot.json'));

  // the looping second timeline gets no auto-advance guard — it never completes
  const sIdx = text.indexOf('s/mascot.json');
  ok('a .lottie was actually produced with a state machine entry', sIdx >= 0);
}

// --- default transition: every seam morphs even with zero explicit Transition entries --
{
  useEditor.getState().loadProject(defaultProject());
  const idle = activeTimeline(useEditor.getState().project).blocks[0];
  useEditor.getState().setPlayhead(100);
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 60, 'rot3');
  // no setTransition call at all — tl.transitions is still untouched (undefined)

  ok('activeTransitionAt finds an implicit default at an untouched seam',
    !!activeTransitionAt(activeTimeline(useEditor.getState().project), 2400 + 10));
  ok('explicitTransitionFor only reports what was actually stored, never the implicit default',
    explicitTransitionFor(activeTimeline(useEditor.getState().project), idle.id) === undefined);

  const seam = evaluateRig(useEditor.getState().project, 2400).nodes.body.transform.rotation;
  const nearSeamDefault = evaluateRig(useEditor.getState().project, 2400 + 10).nodes.body.transform.rotation;
  const mid = evaluateRig(useEditor.getState().project, 2400 + DEFAULT_TRANSITION_MS / 2).nodes.body.transform.rotation;
  const end = evaluateRig(useEditor.getState().project, 2400 + DEFAULT_TRANSITION_MS + 5).nodes.body.transform.rotation;
  ok('an untouched seam still morphs by default — no sudden cut, no explicit Transition needed',
    Math.abs(seam - 60) < 1e-6 && nearSeamDefault > 40 && mid > 1 && mid < 59 && Math.abs(end) < 1e-6,
    `seam=${seam} near=${nearSeamDefault} mid=${mid} end=${end}`);

  // explicit durationMs:0 opts a seam back out into a real hard cut
  useEditor.getState().setTransition(idle.id, { durationMs: 0 });
  const nearSeamCut = evaluateRig(useEditor.getState().project, 2400 + 10).nodes.body.transform.rotation;
  ok('an explicit durationMs:0 is a real hard cut, not just a very short morph',
    Math.abs(nearSeamCut) < 1e-6, `default=${nearSeamDefault} cut=${nearSeamCut}`);

  useEditor.getState().loadProject(defaultProject());
}

// --- transform.scale cascades down the rig tree: scaling the body also scales the eyes -
{
  const proj = defaultProject();
  const before = buildScene(proj.rig, { width: 720, height: 720 }).find((s) => s.id === 'eyeL')!;
  const scaled: Rig = structuredClone(proj.rig);
  scaled.nodes.body.transform.scale = { x: 1.5, y: 1.5 };
  const after = buildScene(scaled, { width: 720, height: 720 }).find((s) => s.id === 'eyeL')!;
  ok('scaling the body also scales its children (eyes), not just the body node itself',
    Math.abs(after.w / before.w - 1.5) < 1e-6, `${after.w} vs ${before.w}`);

  // three levels deep, ratio-based (not an absolute pixel count) so it can't depend on
  // exactly what projectToScreen's own foreshortening happens to be for this rig shape
  const mkNode = (id: string, parentId: string, scale: number): RigNode => ({
    id, name: id, kind: 'primitive', parentId,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: scale, y: scale }, rotation: 0 },
    size: { x: 10, y: 10 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 0,
    primitive: { shape: 'circle' },
  });
  const rigWithScaledGroup: Rig = structuredClone(proj.rig);
  rigWithScaledGroup.nodes['g'] = mkNode('g', 'body', 2);
  rigWithScaledGroup.nodes['gc'] = mkNode('gc', 'g', 1);
  const gcScaled = buildScene(rigWithScaledGroup, { width: 720, height: 720 }).find((s) => s.id === 'gc')!.w;
  const rigNoScaledGroup: Rig = structuredClone(rigWithScaledGroup);
  rigNoScaledGroup.nodes['g'].transform.scale = { x: 1, y: 1 };
  const gcUnscaled = buildScene(rigNoScaledGroup, { width: 720, height: 720 }).find((s) => s.id === 'gc')!.w;
  ok('cascade multiplies through multiple ancestor levels, not just the immediate parent',
    Math.abs(gcScaled / gcUnscaled - 2) < 1e-3, `${gcScaled} vs ${gcUnscaled}`);
}

// --- unique naming: captured poses and timelines auto-suffix on a name collision -------
{
  useEditor.getState().loadProject(defaultProject());
  const beforeCount = useEditor.getState().project.expressions.length;
  useEditor.getState().captureExpression('Neutral'); // 'Neutral' is already a builtin expression
  const names = useEditor.getState().project.expressions.map((e) => e.name);
  ok('capturing a duplicate name gets a numeric suffix instead of colliding',
    names.filter((n) => n === 'Neutral').length === 1 && names.includes('Neutral 2'), names.join(', '));
  ok('exactly one new expression was added', useEditor.getState().project.expressions.length === beforeCount + 1);

  useEditor.getState().addTimeline('Idle'); // 'Idle' is already the default timeline's name
  const tlNames = useEditor.getState().project.timelines.map((t) => t.name);
  ok('adding a timeline with a taken name gets a numeric suffix', tlNames.includes('Idle 2'), tlNames.join(', '));

  useEditor.getState().loadProject(defaultProject());
}

// --- batch keyframe move/delete: a multi-select drag/delete is one undo step -----------
{
  useEditor.getState().loadProject(defaultProject());
  const tl = activeTimeline(useEditor.getState().project);
  const idleYaw = tl.tracks.find((t) => t.nodeId === 'body' && t.property === 'surface.yaw')!;
  const idleOffsetY = tl.tracks.find((t) => t.nodeId === 'body' && t.property === 'flatOffset.y')!;

  const moved = [
    { trackId: idleYaw.id, kfId: idleYaw.keyframes[1].id, time: idleYaw.keyframes[1].time + 100 },
    { trackId: idleOffsetY.id, kfId: idleOffsetY.keyframes[1].id, time: idleOffsetY.keyframes[1].time + 100 },
  ];
  const pastLen = useEditor.getState().past.length;
  useEditor.getState().moveKeyframes(moved);
  const afterMove = activeTimeline(useEditor.getState().project);
  ok('moveKeyframes moves every entry across different tracks to its own explicit time',
    afterMove.tracks.find((t) => t.id === idleYaw.id)!.keyframes.some((k) => k.id === moved[0].kfId && Math.abs(k.time - moved[0].time) < 1)
    && afterMove.tracks.find((t) => t.id === idleOffsetY.id)!.keyframes.some((k) => k.id === moved[1].kfId && Math.abs(k.time - moved[1].time) < 1));
  ok('a multi-keyframe move is exactly one undo step, not one per keyframe',
    useEditor.getState().past.length === pastLen + 1);

  const doomed = [
    { trackId: idleYaw.id, kfId: idleYaw.keyframes[0].id },
    { trackId: idleOffsetY.id, kfId: idleOffsetY.keyframes[0].id },
  ];
  useEditor.getState().deleteKeyframes(doomed);
  const afterDelete = activeTimeline(useEditor.getState().project);
  ok('deleteKeyframes removes every selected keyframe across different tracks in one call',
    !afterDelete.tracks.find((t) => t.id === idleYaw.id)?.keyframes.some((k) => k.id === doomed[0].kfId)
    && !afterDelete.tracks.find((t) => t.id === idleOffsetY.id)?.keyframes.some((k) => k.id === doomed[1].kfId));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: the tools that give it the rest of the editor ---------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());

  // every clip-owned keyframe must stay inside its clip's span after any strip edit —
  // that is the invariant relayoutBlocks exists to hold, and the one a copilot tool that
  // edits tl.blocks directly would quietly break
  const glued = () => {
    const starts = blockStarts(PT());
    const span = new Map(PT().blocks.map((b, i) => [b.id, [starts[i], starts[i] + b.durationMs]] as const));
    return PT().tracks.filter((t) => t.blockId).every((t) => {
      const s = span.get(t.blockId!);
      return !!s && t.keyframes.every((k) => k.time >= s[0] - 1 && k.time <= s[1] + 1);
    });
  };

  const names = () => PT().blocks.map((b) => b.name).join(',');
  ok('a fresh file opens on the four-beat strip', names() === 'Idle,Blink,Talk,Happy', names());

  // a clip is addressable by name, by id and by index — models reach for all three
  applyCalls([{ name: 'set_block_duration', args: { block: 'Blink', durationMs: 900 } }]);
  ok('set_block_duration resizes the clip', PT().blocks[1].durationMs === 900, String(PT().blocks[1].durationMs));
  ok('and drags every clip-owned keyframe with it', glued());

  applyCalls([{ name: 'move_block', args: { block: 3, index: 0 } }]);
  ok('move_block reorders the strip', names() === 'Happy,Idle,Blink,Talk', names());
  ok('reordering keeps the keyframes glued', glued());

  const doomed = PT().blocks.find((b) => b.name === 'Blink')!.id;
  applyCalls([{ name: 'remove_block', args: { block: 'Blink' } }]);
  ok('remove_block drops the clip and its tracks',
    names() === 'Happy,Idle,Talk' && !PT().tracks.some((t) => t.blockId === doomed));
  ok('removing keeps the keyframes glued', glued());

  const before = P().timelines.length;
  applyCalls([
    { name: 'add_timeline', args: { name: 'Wave' } },
    { name: 'set_timeline', args: { durationMs: 2400, loop: true, fps: 24 } },
    { name: 'set_camera', args: { property: 'perspective', value: 42 } },
  ]);
  ok('add_timeline makes a new state and switches to it',
    P().timelines.length === before + 1 && PT().name === 'Wave', PT().name);
  ok('the rest of the batch lands on the timeline it just made',
    PT().timelineDurationMs === 2400 && PT().loop === true && P().fps === 24);
  ok('set_camera maps the inspector label "perspective" onto fov', P().rig.camera.fov === 42);

  applyCalls([{ name: 'add_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: 400, value: 0.2 } }]);
  applyCalls([{ name: 'clear_animation', args: { nodeId: 'eyeL', property: 'eye.openness' } }]);
  ok('clear_animation drops the track it names',
    !PT().tracks.some((t) => t.nodeId === 'eyeL' && t.property === 'eye.openness'));

  ok('one undo reverses a whole tool batch', (() => {
    const n = P().timelines.length;
    applyCalls([{ name: 'add_timeline', args: { name: 'Scratch' } }]);
    useEditor.getState().undo();
    return P().timelines.length === n;
  })());
}

// --- copilot: one natural-language turn becomes a working animation -------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // the exact request that used to fail: a new preset built from scratch, then staged
  const turn = parseTurn(JSON.stringify({
    reply: 'Made a BigEye preset and put it on the strip.',
    calls: [
      { name: 'create_preset', args: { name: 'BigEye', durationMs: 1200, tracks: [
        { nodeId: 'Left eye', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 1.6 }, { time: 1200, value: 1 }] },
        { nodeId: 'eyeR', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 1.6 }, { time: 1200, value: 1 }] },
        { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 400, value: 0 }, { time: 800, value: 8 }, { time: 1200, value: 0 }] },
      ] } },
      { name: 'add_preset_to_timeline', args: { preset: 'BigEye' } },
    ],
  }));
  const staged = turn.calls.map((c) => normaliseCall(P(), c));
  ok('the whole turn parses', staged.length === 2 && turn.reply.startsWith('Made'));
  ok('create_preset validates', validate(P(), staged[0]) === null, String(validate(P(), staged[0])));

  applyCalls(staged);
  const made = P().presets.find((x) => x.name === 'BigEye');
  ok('the preset exists with all three tracks', !!made && made.tracks.length === 3, String(made?.tracks.length));
  ok('and is on the strip', activeTimeline(P()).blocks.some((b) => b.name === 'BigEye'));
  const start = blockStarts(activeTimeline(P())).at(-1)!;
  ok('the eyes actually grow mid-clip',
    (valueAt(P(), 'eyeL', 'transform.scale.x', start + 400) as number) > 1.5,
    String(valueAt(P(), 'eyeL', 'transform.scale.x', start + 400)));
  ok('the body actually rotates mid-clip',
    Math.abs(valueAt(P(), 'body', 'transform.rotation', start + 800) as number) > 5);

  useEditor.getState().loadProject(defaultProject());
}

// --- the registries: one table, and everything downstream derives from it -------
{
  // The contract COPILOT.md states: add a row to PROPS plus a case in
  // getProp/setProp, and the property is animatable, inspectable AND known to the agent.
  // These two checks are what make that a guarantee rather than a note in a file.
  const rig = defaultProject().rig;
  const missing = NUMERIC_PROPS.filter((path) => {
    const spec = PROPS[path];
    const nodeId = spec.on === 'camera' ? '__camera' : (path.startsWith('eye.') ? 'eyeL' : rig.rootId);
    const probe = (spec.range![0] + spec.range![1]) / 2;
    writeProp(rig, nodeId, path, probe);
    return readProp(rig, nodeId, path) !== probe;
  });
  ok('every PROPS row round-trips through get/setProp', missing.length === 0, missing.join(', '));

  ok('every PROPS row has a help line the prompt can use',
    Object.entries(PROPS).every(([, s]) => s.help.length > 20 && s.label.length > 0));

  // a short name must resolve, and an ambiguous one must NOT be guessed
  ok('"openness" resolves to eye.openness', resolveProp('openness') === 'eye.openness');
  ok('"rotation" resolves to transform.rotation', resolveProp('rotation') === 'transform.rotation');
  ok('"scale.x" resolves to transform.scale.x', resolveProp('scale.x') === 'transform.scale.x');
  ok('a full path resolves to itself', resolveProp('surface.yaw') === 'surface.yaw');
  ok('an ambiguous tail is refused, not guessed', PROP_ALIAS.x === undefined && PROP_ALIAS.y === undefined);
  ok('junk stays junk', resolveProp('vibes') === undefined);

  // every effect the renderer implements must be one the copilot may ask for
  const proj = defaultProject();
  const unreachable = MODIFIER_KINDS.filter((kind) =>
    validate(proj, { name: 'add_modifier', args: { nodeId: 'body', kind, amount: 100, frequency: 1, amplitude: 6 } }) !== null);
  ok('every MODIFIERS kind is accepted by the copilot', unreachable.length === 0, unreachable.join(', '));
  ok('every MODIFIERS kind has a help line', MODIFIER_KINDS.every((k) => MODIFIERS[k].help.length > 20));
  ok('and an unknown effect is still refused',
    validate(proj, { name: 'add_modifier', args: { nodeId: 'body', kind: 'wobble' } }) !== null);
}

// --- copilot: the two ways the "big eye" turn actually failed -------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // 1. the model wrote the short name inside a preset track, because that is what
  //    set_eye_params documents. Rejected as `"openness" is not an animatable property`.
  const short = normaliseCall(P(), { name: 'create_preset', args: { name: 'CatEyes', durationMs: 900, tracks: [
    { nodeId: 'Left eye', property: 'openness', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 0.2 }] },
    { nodeId: 'body', property: 'rotation', keyframes: [{ time: 0, value: 0 }, { time: 400, value: 8 }] },
  ] } });
  const tracks = short.args.tracks as Record<string, string>[];
  ok('a short property name inside a preset track is resolved',
    tracks[0].property === 'eye.openness' && tracks[0].nodeId === 'eyeL' && tracks[1].property === 'transform.rotation',
    JSON.stringify(tracks.map((t) => `${t.nodeId}.${t.property}`)));
  ok('and then validates', validate(P(), short) === null, String(validate(P(), short)));

  // and the same in an expression snapshot
  const snap = normaliseCall(P(), { name: 'create_expression', args: { name: 'Wide', snapshot: { 'Left eye.openness': 1, 'body.rotation': 4 } } });
  ok('a snapshot key is resolved on both halves',
    Object.keys(snap.args.snapshot as object).join() === 'eyeL.eye.openness,body.transform.rotation',
    Object.keys(snap.args.snapshot as object).join());
  ok('and validates', validate(P(), snap) === null, String(validate(P(), snap)));

  // 2. create_preset then add_preset_to_timeline in ONE turn: the second call named a
  //    preset the first had not made yet, so it was rejected as `no preset "cat eyes"`
  const batch = [
    { name: 'create_preset', args: { name: 'cat eyes', durationMs: 900, tracks: [
      { nodeId: 'eyeL', property: 'eye.openness', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 0.2 }] },
    ] } },
    { name: 'add_preset_to_timeline', args: { preset: 'cat eyes' } },
  ].map((c) => normaliseCall(P(), c as ToolCall));
  ok('call-by-call validation rejects the correct batch', validate(P(), batch[1]) !== null);
  ok('batch validation accepts it', validateBatch(P(), batch).every((x) => x === null),
    validateBatch(P(), batch).join('|'));
  applyCalls(batch);
  ok('and it applies: the preset exists and is on the strip',
    P().presets.some((x) => x.name === 'cat eyes')
    && activeTimeline(P()).blocks.some((b) => b.name === 'cat eyes'));

  // a batch must still reject a preset nobody ever creates
  ok('a preset that is never created is still rejected',
    validateBatch(P(), [{ name: 'add_preset_to_timeline', args: { preset: 'nope' } }])[0] !== null);

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: editing what is already on the timeline ---------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const openness = () => PT().tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'eye.openness' && t.blockId === PT().blocks[1].id)!;

  // The prompt must name the exact coordinates the editing tools take, or the copilot can
  // only ever append. Blink is the second clip, so its keys are absolute, not clip-local.
  const prompt = systemPrompt(P());
  const blinkStart = blockStarts(PT())[1];
  ok('the prompt lists the clips and their spans', prompt.includes(`"Blink" ${Math.round(blinkStart)}-`), 'no clip span');
  ok('the prompt lists real keyframes at absolute times',
    prompt.includes(`eyeL.eye.openness [Blink@${Math.round(blinkStart)}]: ${Math.round(blinkStart)}=1`), 'no keyframe line');
  ok('and the times it prints are the times the tools accept',
    openness().keyframes.every((k) => prompt.includes(`${Math.round(k.time)}=`)));

  const shut = openness().keyframes[1];
  ok('a keyframe the prompt lists validates for editing',
    validate(P(), { name: 'move_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', fromMs: shut.time, toMs: shut.time + 60 } }) === null);
  ok('a time nothing sits on is refused, and says where to look',
    /Keyframes/.test(validate(P(), { name: 'remove_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: shut.time + 7000 } }) ?? ''));

  applyCalls([{ name: 'move_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', fromMs: shut.time, toMs: shut.time + 60 } }]);
  ok('move_keyframe retimes it and keeps the track sorted',
    openness().keyframes.some((k) => Math.round(k.time) === Math.round(shut.time + 60))
    && openness().keyframes.every((k, i, arr) => i === 0 || arr[i - 1].time <= k.time));

  // a short name and a rounded time still land, the way a model writes them
  applyCalls([normaliseCall(P(), { name: 'add_keyframe', args: { nodeId: 'Left eye', property: 'openness', atMs: shut.time + 60, value: 0.5 } })]);
  ok('add_keyframe at a listed time overwrites rather than adding a second key',
    openness().keyframes.filter((k) => Math.abs(k.time - (shut.time + 60)) < 8).length === 1
    && (valueAt(P(), 'eyeL', 'eye.openness', shut.time + 60) as number) === 0.5);

  const before = openness().keyframes.length;
  applyCalls([{ name: 'remove_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: shut.time + 60 } }]);
  ok('remove_keyframe deletes exactly one', openness().keyframes.length === before - 1);

  // emptying a track must not leave a lane on the strip with nothing in it
  const tiny = PT().tracks.find((t) => t.blockId === PT().blocks[1].id)!;
  const id = tiny.id;
  for (const k of [...tiny.keyframes]) {
    applyCalls([{ name: 'remove_keyframe', args: { nodeId: tiny.nodeId, property: tiny.property, atMs: k.time } }]);
  }
  ok('an emptied track is dropped, not left as a blank lane', !PT().tracks.some((t) => t.id === id));

  useEditor.getState().loadProject(defaultProject());
}

// --- editing a preset, from the copilot and from a clip -------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const blink = () => P().presets.find((x) => x.name === 'Blink')!;

  ok('edit_preset needs something to change',
    validate(P(), { name: 'edit_preset', args: { preset: 'Blink' } }) !== null);
  ok('and a preset that exists', validate(P(), { name: 'edit_preset', args: { preset: 'nope', durationMs: 500 } }) !== null);
  ok('a bad layer in replacement tracks is caught, not silently built',
    validate(P(), { name: 'edit_preset', args: { preset: 'Blink', tracks: [{ nodeId: 'nose', property: 'eye.openness', keyframes: [{ time: 0, value: 1 }] }] } }) !== null);

  const wasDuration = blink().durationMs;
  applyCalls([normaliseCall(P(), { name: 'edit_preset', args: { preset: 'Blink', durationMs: 400, tracks: [
    { nodeId: 'Left eye', property: 'openness', keyframes: [{ time: 0, value: 1 }, { time: 200, value: 0 }, { time: 400, value: 1 }] },
  ] } })]);
  ok('edit_preset rewrites duration and tracks, with names resolved',
    blink().durationMs === 400 && wasDuration !== 400
    && blink().tracks.length === 1 && blink().tracks[0].nodeId === 'eyeL' && blink().tracks[0].property === 'eye.openness');

  // the UI route: place a clip, change it on the strip, save it back over the preset
  useEditor.getState().loadProject(defaultProject());
  const ed = () => useEditor.getState();
  const clip = activeTimeline(P()).blocks[1];
  const start = blockStarts(activeTimeline(P()))[1];
  ed().commit((p) => {
    const tl = activeTimeline(p);
    const t = tl.tracks.find((x) => x.blockId === clip.id)!;
    t.keyframes[1].value = 0.9;
  });
  ed().updatePresetFromBlock(clip.id);
  const saved = P().presets.find((x) => x.id === clip.presetId)!;
  ok('save-to-preset picks up the edit', saved.tracks.some((t) => t.keyframes.some((k) => k.value === 0.9)));
  ok('and rebases its times to the clip start, so it can be placed anywhere',
    start > 0 && saved.tracks.every((t) => t.keyframes[0].time === 0));
  ok('while the clip already on the strip keeps its own copy',
    activeTimeline(P()).tracks.filter((t) => t.blockId === clip.id).length > 0);

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: where new animation lands, and the plan that precedes it ----------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // a fresh file already has four clips, so "start at 0" would overwrite them
  const end = blocksEnd(activeTimeline(P()));
  ok('new work starts after everything on the strip', suggestedStart(P()) === Math.round(end), String(suggestedStart(P())));
  ok('and the prompt says so in absolute terms', systemPrompt(P()).includes(`starts at ${Math.round(end)}ms`));

  // on an empty strip it must not be 0 either — a clip that opens mid-move reads clipped —
  // but it must not sit three seconds in doing nothing
  useEditor.getState().loadProject({ ...defaultProject(), timelines: [makeTimeline('Empty')] } as never);
  useEditor.getState().addTimeline('Blank');
  const blank = suggestedStart(P());
  ok('an empty timeline starts inside the 1.5s ceiling', blank >= 0 && blank <= 1500, String(blank));
  ok('and the prompt keeps the two kinds of time apart',
    /times inside a preset are relative/i.test(systemPrompt(P())) && /ABSOLUTE on this timeline/.test(systemPrompt(P())));

  // the plan comes first in the schema, so the model reasons before it emits calls
  const schema = RESPONSE_SCHEMA as unknown as { properties: Record<string, unknown>; required: readonly string[] };
  const props = Object.keys(schema.properties);
  ok('plan is the first key the model fills', props[0] === 'plan', props.join());
  ok('and it is required', schema.required.includes('plan'));

  const turn = parseTurn('{"plan":"Four beats: rest, grow, hold, blink out.","reply":"Done.","calls":[]}');
  ok('the plan is parsed off the turn', !!turn.plan?.startsWith('Four beats') && turn.reply === 'Done.');
  ok('a model that calls it reasoning is understood too',
    parseTurn('{"reasoning":"same thing","reply":"ok","calls":[]}').plan === 'same thing');
  ok('and a turn without one still parses', parseTurn('{"reply":"ok","calls":[]}').plan === undefined);

  useEditor.getState().loadProject(defaultProject());
}

// --- managing your own presets --------------------------------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const ed = () => useEditor.getState();
  const P = () => useEditor.getState().project;

  ed().commit((p) => {
    p.presets.push({ id: 'p_mine', name: 'Mine', source: 'custom', durationMs: 600, tracks: [
      { id: 't1', nodeId: 'eyeL', property: 'eye.openness', keyframes: [
        { id: 'k1', time: 0, value: 1, easingOut: { type: 'preset', name: 'easeInOut' } },
        { id: 'k2', time: 300, value: 0, easingOut: { type: 'preset', name: 'easeInOut' } },
      ] },
    ] });
  });

  ed().addBlock('p_mine');
  const placed = activeTimeline(P()).blocks.at(-1)!;
  // "Edit on the strip" is place-THEN-select: addBlock does not select on its own, and
  // without the selection the clip panel — and its Save to preset — never appears
  ed().selectBlock(placed.id);
  ok('the placed clip can be selected, which is what "edit" relies on',
    ed().selectedBlockId === placed.id, String(ed().selectedBlockId));

  ed().renamePreset('p_mine', 'Renamed');
  ok('rename lands', P().presets.find((x) => x.id === 'p_mine')?.name === 'Renamed');

  const tracksBefore = activeTimeline(P()).tracks.filter((t) => t.blockId === placed.id).length;
  ed().deletePreset('p_mine');
  ok('delete removes the preset', !P().presets.some((x) => x.id === 'p_mine'));
  ok('but the clip made from it keeps its own keyframes',
    activeTimeline(P()).blocks.some((b) => b.id === placed.id)
    && activeTimeline(P()).tracks.filter((t) => t.blockId === placed.id).length === tracksBefore);

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: a follow-up edits, it does not build a second clip -----------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  const bare = systemPrompt(P());
  ok('with nothing made yet, no conversation line is claimed', !/in this conversation/.test(bare));

  const withHistory = systemPrompt(P(), ['BigEye']);
  ok('once something is made, the prompt names it', /You made these in this conversation, newest last: BigEye/.test(withHistory));
  ok('and says a bare "it" refers to the newest of them', /"it", "the animation"/.test(withHistory));

  // the trap this rule exists for: edit_preset changes the template, and a clip already
  // placed keeps its own copy — so editing only the preset changes nothing on screen
  ok('the prompt warns that editing a preset alone is invisible',
    /editing the preset alone changes nothing on screen/.test(withHistory));
  ok('and points refinements at the strip keyframes',
    /overwrites that keyframe in place/.test(withHistory));
  ok('while still allowing an explicit second preset',
    /only when asked for one in so many words/.test(withHistory));

  // that warning has to be TRUE: prove a placed clip ignores a later edit_preset
  applyCalls([
    { name: 'create_preset', args: { name: 'Follow', durationMs: 600, tracks: [
      { nodeId: 'body', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 300, value: 1.2 }] },
    ] } },
    { name: 'add_preset_to_timeline', args: { preset: 'Follow' } },
  ]);
  const clipStart = blockStarts(activeTimeline(P())).at(-1)!;
  const before = valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number;

  applyCalls([{ name: 'edit_preset', args: { preset: 'Follow', tracks: [
    { nodeId: 'body', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 300, value: 1.8 }] },
  ] } }]);
  ok('editing the preset really does leave the placed clip alone',
    (valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number) === before, String(before));

  // and that the route the prompt points at DOES change it
  applyCalls([{ name: 'add_keyframe', args: { nodeId: 'body', property: 'transform.scale.x', atMs: clipStart + 300, value: 1.8 } }]);
  ok('while add_keyframe at the listed time is what the user actually sees change',
    (valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number) === 1.8);

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: judging the animation, not just the JSON --------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const ASK = 'make the mascot scale and rotate and make his eyes wide, then rest';

  const track = (nodeId: string, property: string, keys: [number, number][]) =>
    ({ nodeId, property, keyframes: keys.map(([time, value]) => ({ time, value })) });
  const preset = (tracks: unknown[]) =>
    [{ name: 'create_preset', args: { name: 'X', durationMs: 1400, tracks } }] as ToolCall[];

  // the exact failure the user reported: a body that "scales" by 1.03
  const timid = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.03], [900, 1.03], [1400, 1]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [900, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  ok('a body that scales by 0.03 is called out', timid.some((n) => /invisible/.test(n)), timid.join(' | '));

  // a motion the user named with nothing animating it at all
  const missing = critique(P(), preset([
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  ok('rotation asked for and never animated is called out',
    missing.some((n) => /rotation/.test(n) && /no track animates it/.test(n)), missing.join(' | '));

  // a clip that ends somewhere else cannot loop or be followed
  const drifts = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.2], [900, 1.2], [1400, 1.2]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [900, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  ok('a track that does not close back is called out',
    drifts.some((n) => /cannot loop or be followed/.test(n)), drifts.join(' | '));

  // no hold: every pose passed straight through
  const rushed = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.2], [800, 1]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [800, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [800, 1]]),
  ]), ASK);
  ok('nothing held is called out', rushed.some((n) => /No pose is held/.test(n)), rushed.join(' | '));
  ok('and identical timing across every layer too',
    rushed.some((n) => /same frames/.test(n)), rushed.join(' | '));

  // and the one that matters most: good work must pass silently
  const good = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [380, 1.18], [900, 1.18], [1400, 1]]),
    track('body', 'transform.scale.y', [[0, 1], [420, 1.06], [940, 1.06], [1400, 1]]),
    track('body', 'transform.rotation', [[0, 0], [450, 8], [960, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [340, 1.7], [880, 1.7], [1400, 1]]),
  ]), ASK);
  ok('a well-made clip draws no complaints', good.length === 0, good.join(' | '));

  // a request that names nothing must not be nitpicked on magnitude
  const quiet = critique(P(), preset([
    track('body', 'flatOffset.y', [[0, 0], [500, -4], [1000, -4], [1400, 0]]),
  ]), 'add a gentle idle');
  ok('a subtle animation nobody asked to be big is left alone',
    !quiet.some((n) => /invisible/.test(n)), quiet.join(' | '));

  ok('at most three complaints, so the model can act on them', timid.length <= 3 && rushed.length <= 3);
}

// --- copilot: a same-name create is an edit -------------------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  applyCalls([{ name: 'create_preset', args: { name: 'Wave', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 8 }] },
  ] } }]);
  const count = P().presets.length;

  // "make it rotate more" comes back as create_preset with the same name constantly
  const again = normaliseCall(P(), { name: 'create_preset', args: { name: 'Wave', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 20 }] },
  ] } });
  ok('a create naming an existing preset becomes an edit', again.name === 'edit_preset', again.name);
  ok('and carries the name across as the target', again.args.preset === 'Wave' && again.args.name === undefined);

  applyCalls([again]);
  ok('so no second preset appears', P().presets.length === count, `${P().presets.length} vs ${count}`);
  ok('and the edit landed', P().presets.find((x) => x.name === 'Wave')!.tracks[0].keyframes[1].value === 20);

  // a genuinely new name still creates
  const fresh = normaliseCall(P(), { name: 'create_preset', args: { name: 'Wave Two', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 8 }] },
  ] } });
  ok('a new name still creates', fresh.name === 'create_preset');

  // describe must not print "undefined" for something the same batch is about to make
  const line = describe(P(), { name: 'add_preset_to_timeline', args: { preset: 'NotYetMade' } });
  ok('describe falls back to what the model wrote', line.includes('NotYetMade'), line);

  useEditor.getState().loadProject(defaultProject());
}

// --- zip: the CRC everything downstream depends on -----------------------------
ok('crc32 of the check vector', crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926);

console.log(failures === 0 ? `selfcheck: all checks passed` : `selfcheck: ${failures} FAILED`);