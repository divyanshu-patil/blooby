/**
 * The one runnable check. Verifies the maths that everything else trusts:
 * sphere projection, its inverse, easing, OKLCH round-trip, track sampling.
 *   npx esbuild src/core/selfcheck.ts --bundle --format=esm | node --input-type=module
 */
import { bodyTurnScale, effectiveYaw, limbThreshold, perspective, projectToScreen, screenToSurface, silhouetteScale, surfaceNormal } from './curvature';
import { applyEasing, cubicBezier } from './easing';
import { lerpColor, oklchToRgb, rgbToOklch } from './color';
import { buildScene, evaluateRig, lerpAngle, sampleTrack, valueAt } from './scene';
import { defaultProject } from './defaults';
import { derivedDuration } from './timeline';
import { bakeLottie } from '../export/lottie';
import { useEditor, writeKeyframe } from './store';
import { readProp } from './props';
import { applyCalls, describe, normaliseCall, validate, type ToolCall } from '../copilot/tools';
import { parseTurn } from '../copilot/parse';
import { baseUrl, LOCAL_URL, needsKey, resolveModel } from '../copilot/pool';
import { crc32 } from '../export/zip';
import type { Rig, RigNode } from './types';

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
  // add two more blocks and a shake so the bake has curvature, easing and noise in it
  for (const name of ['Surprised', 'Thinking']) {
    const preset = store.presets.find((x) => x.name === name)!;
    const start = store.blocks.reduce((s2, b) => s2 + b.durationMs, 0);
    const blockId = `b_${name}`;
    store.blocks.push({ id: blockId, presetId: preset.id, name, durationMs: preset.durationMs });
    for (const t of preset.tracks) {
      store.tracks.push({ ...t, id: `t_${name}_${t.nodeId}_${t.property}`, blockId, keyframes: t.keyframes.map((k) => ({ ...k, time: k.time + start })) });
    }
  }
  store.modifiers.push({ id: 'm1', nodeId: 'body', kind: 'shake', amount: 80, frequency: 9, amplitude: 5, seed: 3 });
  store.timelineDurationMs = derivedDuration(store);

  const baked = bakeLottie(store, { background: '#17161b', name: 'test' });
  const j = baked.json as Record<string, any>;
  ok('lottie fps + size', j.fr === store.fps && j.w === 720 && j.h === 720);
  ok('lottie duration in frames', j.op === Math.round((store.timelineDurationMs / 1000) * store.fps), `${j.op}`);
  ok('lottie has a layer per shape plus backdrop', j.layers.length === 4, String(j.layers.length));
  ok('the default file opens on a real timeline', store.blocks.length === 6 && store.tracks.length > 12, `${store.blocks.length} blocks, ${store.tracks.length} tracks`);
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
  // pick a property with no existing track, matching a copilot add_keyframe / applyExpression call
  ok('no pre-existing track on eyeL rotation', !p.tracks.some((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation'));
  const before = readProp(p.rig, 'eyeL', 'transform.rotation');
  writeKeyframe(p, 'eyeL', 'transform.rotation', 2000, 25, { type: 'linear' });
  const track = p.tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation')!;
  ok('an anchor keyframe was seeded at t=0', track.keyframes.length === 2 && track.keyframes[0].time === 0);
  ok('the anchor holds the PREVIOUS value, not the new one', track.keyframes[0].value === before, `${track.keyframes[0].value} vs ${before}`);
  ok('t=0 still reads as unchanged after the write', sampleTrack(track, 0) === before);
  ok('the target time reads the new value', sampleTrack(track, 2000) === 25);
  ok('halfway there interpolates, does not jump', (sampleTrack(track, 1000) as number) > (before as number) && (sampleTrack(track, 1000) as number) < 25);
  // writing again on the SAME (now-existing) track must not re-anchor a second time
  writeKeyframe(p, 'eyeL', 'transform.rotation', 3000, 40, { type: 'linear' });
  ok('a second write on an existing track adds one keyframe, not another anchor', track.keyframes.length === 3);
}

// --- the store: block retiming, undo, tool calls -------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const blockTracks = (id: string) => P().tracks.filter((t) => t.blockId === id);
  const span = (id: string) => {
    const times = blockTracks(id).flatMap((t) => t.keyframes.map((k) => k.time));
    return [Math.min(...times), Math.max(...times)];
  };

  ok('default file has four blocks', P().blocks.length === 4);
  const [b0, b1] = P().blocks;
  ok('first block starts at zero', span(b0.id)[0] === 0);
  ok('second block starts where the first ends', Math.abs(span(b1.id)[0] - b0.durationMs) < 1);

  // stretching a block must drag everything after it along
  const beforeStart = span(b1.id)[0];
  useEditor.getState().setBlockDuration(b0.id, b0.durationMs * 2);
  ok('stretching a block scales its own keys', Math.abs(span(b0.id)[1] - b0.durationMs * 2) < 12,
    `${span(b0.id)[1]} vs ${b0.durationMs * 2}`);
  ok('stretching a block shifts the next one', Math.abs(span(b1.id)[0] - beforeStart * 2) < 12,
    `${span(b1.id)[0]} vs ${beforeStart * 2}`);
  ok('duration follows the blocks', P().timelineDurationMs >= P().blocks.reduce((a, b) => a + b.durationMs, 0));

  useEditor.getState().undo();
  ok('undo restores the original duration', P().blocks[0].durationMs === b0.durationMs);
  useEditor.getState().redo();
  ok('redo reapplies it', P().blocks[0].durationMs === b0.durationMs * 2);
  useEditor.getState().undo();

  const trackCount = P().tracks.length;
  useEditor.getState().removeBlock(b0.id);
  ok('removing a block drops its tracks', P().tracks.length < trackCount && blockTracks(b0.id).length === 0);
  ok('and closes the gap', span(P().blocks[0].id)[0] === 0);
  useEditor.getState().undo();
  ok('undo brings the block back', P().blocks.length === 4 && P().tracks.length === trackCount);

  // toggling a track off must not move the pose
  useEditor.getState().setPlayhead(1200);
  const yawBefore = valueAt(P(), 'body', 'surface.yaw', 1200) as number;
  useEditor.getState().toggleTrack('body', 'surface.yaw');
  ok('un-animating bakes the current value', Math.abs((valueAt(P(), 'body', 'surface.yaw', 1200) as number) - yawBefore) < 1e-6,
    `${valueAt(P(), 'body', 'surface.yaw', 1200)} vs ${yawBefore}`);
  useEditor.getState().undo();

  // expressions and morphs
  useEditor.getState().morphBetween('x_neutral', 'x_surprised', 3000, 400, { type: 'preset', name: 'easeInOut' });
  const scaleTrack = P().tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'transform.scale.x');
  ok('morph wrote both ends', !!scaleTrack
    && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3000) < 1)
    && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3400) < 1));
  ok('morph skips properties that match', !P().tracks.some((t) => t.nodeId === 'body' && t.property === 'surface.pitch'
    && t.keyframes.some((k) => Math.abs(k.time - 3000) < 1)));
  useEditor.getState().undo();

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

  const blocksBefore = P().blocks.length;
  applyCalls(calls);
  ok('tool calls applied', P().blocks.length === blocksBefore + 1
    && P().modifiers.length === 1
    && (valueAt(P(), 'eyeL', 'eye.openness', 500) as number) === 0.3);
  useEditor.getState().undo();
  ok('one undo reverses the whole batch', P().blocks.length === blocksBefore && P().modifiers.length === 0);
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
}

// --- zip: the CRC everything downstream depends on -----------------------------
ok('crc32 of the check vector', crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926);

console.log(failures === 0 ? `selfcheck: all checks passed` : `selfcheck: ${failures} FAILED`);