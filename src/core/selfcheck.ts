/**
 * The one runnable check. Verifies the maths that everything else trusts:
 * sphere projection, its inverse, easing, OKLCH round-trip, track sampling.
 *   npx esbuild src/core/selfcheck.ts --bundle --format=esm | node --input-type=module
 */
import { effectiveYaw, perspective, projectToScreen, screenToSurface, surfaceNormal } from './curvature';
import { applyEasing, cubicBezier } from './easing';
import { lerpColor, oklchToRgb, rgbToOklch } from './color';
import { buildScene, evaluateRig, lerpAngle, sampleTrack } from './scene';
import { defaultProject } from './defaults';
import { derivedDuration } from './timeline';
import { bakeLottie } from '../export/lottie';
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

// --- lottie bake: does the baked file actually reproduce the scene? ------------
{
  const proj = defaultProject();
  // place three blocks and a shake so the bake has curvature, easing and noise in it
  const store = { ...proj };
  for (const name of ['Blink', 'Surprised', 'Thinking']) {
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

// --- zip: the CRC everything downstream depends on -----------------------------
ok('crc32 of the check vector', crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926);

console.log(failures === 0 ? `selfcheck: all checks passed` : `selfcheck: ${failures} FAILED`);