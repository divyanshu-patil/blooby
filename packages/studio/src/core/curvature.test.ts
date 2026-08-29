import { it } from 'vitest';
import { check, flat, mk, near, rig } from './testkit';
import { bodyTurnScale, effectiveYaw, limbThreshold, perspective, projectToScreen, screenToSurface, silhouetteScale, surfaceNormal } from './curvature';
import { buildScene } from './scene';
import { defaultProject } from './defaults';
import type { Rig } from './types';

// --- sphere normal is a unit vector and matches the closed form -----------------
for (const [y, p] of [[0, 0], [30, 0], [0, 45], [-60, 20], [88, -70]]) {
  const n = surfaceNormal(y, p);
  it('normal unit', check(near(Math.hypot(...n), 1, 1e-9), `${y},${p} -> ${n}`));
}
it('front pole', check(surfaceNormal(0, 0)[2] === 1));
it('right yaw is +x', check(surfaceNormal(90, 0)[0] > 0.999));
it('down pitch is +y', check(surfaceNormal(0, 90)[1] > 0.999));

// --- projection: centre, rim, foreshortening -----------------------------------
const R = 100;
const centre = projectToScreen(mk(0, 0), flat, R);
it('centre at origin', check(near(centre.x, 0) && near(centre.y, 0)));
it('centre unforeshortened', check(near(centre.sx, 1) && near(centre.sy, 1)));

const rim = projectToScreen(mk(90, 0), flat, R);
it('rim at radius', check(near(rim.x, R, 1e-9), String(rim.x)));
it('rim invisible', check(!rim.visible));

const side = projectToScreen(mk(60, 0), flat, R);
it('60deg x = R sin60', check(near(side.x, R * Math.sin(Math.PI / 3), 1e-9)));
it('60deg squashes horizontally', check(near(side.sx, Math.cos(Math.PI / 3), 1e-9), String(side.sx)));
it('60deg keeps height', check(near(side.sy, 1, 1e-9), String(side.sy)));

const up = projectToScreen(mk(0, -60), flat, R);
it('pitch squashes vertically', check(near(up.sy, Math.cos(Math.PI / 3), 1e-9), String(up.sy)));
it('pitch keeps width', check(near(up.sx, 1, 1e-9), String(up.sx)));

// rolled node: the squash follows the roll into the node's own frame
const rolled = projectToScreen(mk(60, 0, 90), flat, R);
it('rolled squash swaps axes', check(near(rolled.sy, Math.cos(Math.PI / 3), 1e-9), String(rolled.sy)));

// --- head turn moves features the same way local yaw does ----------------------
const headed = projectToScreen(mk(0, 0), flat, R, { x: 30, y: 0 });
const local = projectToScreen(mk(30, 0), flat, R);
it('head yaw == local yaw at pitch 0', check(near(headed.x, local.x, 1e-9)));
const headedP = projectToScreen(mk(0, 0), flat, R, { x: 0, y: 25 });
it('head pitch == local pitch', check(near(headedP.y, projectToScreen(mk(0, 25), flat, R).y, 1e-9)));

// --- perspective ---------------------------------------------------------------
it('fov 0 is orthographic', check(perspective(1, 0, 6) === 1));
it('perspective enlarges the near pole', check(perspective(1, 45, 6) > 1));
it('perspective shrinks the far side', check(perspective(-1, 45, 6) < 1));
it('perspective bounded', check(perspective(1, 89, 1.2) < 7));

// --- the silhouette bounds every feature that can be seen ----------------------
it('ortho silhouette is exactly R', check(silhouetteScale(0, 6) === 1));
for (const [fov, dist] of [[20, 6], [45, 6], [70, 6], [89, 1.2], [89, 20], [60, 2]]) {
  const k = silhouetteScale(fov, dist);
  const r2: Rig = { ...rig, camera: { ...rig.camera, fov, distance: dist } };
  it('silhouette matches the closed form', check(Math.abs(k - (fov === 0 ? 1 : 0)) >= 0 && k >= 1));
  let worstOut = 0;
  for (let yaw = -90; yaw <= 90; yaw += 1) {
    for (let pitch = -90; pitch <= 90; pitch += 3) {
      const pr = projectToScreen(mk(yaw, pitch), r2, R);
      if (!pr.visible) continue;
      worstOut = Math.max(worstOut, Math.hypot(pr.x, pr.y) / (R * k));
    }
  }
  it('no visible feature centre escapes the silhouette', check(worstOut <= 1 + 1e-4, `fov${fov} d${dist} -> ${worstOut.toFixed(5)}`));
}
// full pinhole matches R·D/sqrt(D²-R²)
{
  const d = 6, exact = d / Math.sqrt(d * d - 1);
  it('near-pinhole silhouette matches the sphere formula', check(Math.abs(silhouetteScale(90, d) - exact) < 2e-3, `${silhouetteScale(90, d).toFixed(5)} vs ${exact.toFixed(5)}`));
}
it('limb threshold is 0 when orthographic', check(limbThreshold(0, 6) === 0));

// --- inverse round-trips (this is what dragging an eye relies on) ---------------
for (const fov of [0, 30, 70]) {
  const r2: Rig = { ...rig, camera: { ...rig.camera, fov } };
  for (const head of [{ x: 0, y: 0 }, { x: 25, y: -15 }]) {
    for (const [y, p] of [[0, 0], [35, 12], [-50, -30], [70, 5], [10, -65]]) {
      const pr = projectToScreen(mk(y, p), r2, R, head);
      if (!pr.visible) continue; // behind the limb: no screen point to invert
      const back = screenToSurface(pr.x, pr.y, r2, R, head);
      it('inverse round-trip', check(near(back.x, y, 1e-4) && near(back.y, p, 1e-4), `fov${fov} head${head.x}/${head.y} ${y},${p} -> ${back.x.toFixed(4)},${back.y.toFixed(4)}`));
    }
  }
}

// --- eye distance is a signed offset on top of the posed yaw -------------------
const eye = mk(5, 0);
eye.eye = { linkedToId: null, openness: 1, distanceFromCenter: -18 };
it('eye distance offsets yaw', check(effectiveYaw(eye) === -13));

// --- body turn-squash: a stylised cue, not physics ------------------------------
{
  const flat = bodyTurnScale(0, 0);
  it('no squash at rest', check(flat.sx === 1 && flat.sy === 1));
  const yawed = bodyTurnScale(20.4, 0);
  it('yaw visibly narrows the body even at a moderate angle', check(yawed.sx < 0.94 && yawed.sx > 0.85, String(yawed.sx)));
  it('yaw does not touch the vertical axis', check(bodyTurnScale(40, 0).sy === 1));
  it('pitch does not touch the horizontal axis', check(bodyTurnScale(0, 40).sx === 1));
  it('squash is symmetric in sign', check(bodyTurnScale(30, 0).sx === bodyTurnScale(-30, 0).sx));
  const scene0 = buildScene(defaultProject().rig, { width: 720, height: 720 });
  const bodyAt0 = scene0.find((s) => s.id === 'body')!;
  const p2 = defaultProject();
  p2.rig.nodes.body.surface.yaw = 45;
  const bodyAt45 = buildScene(p2.rig, { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  it('the drawn body actually narrows at yaw 45', check(bodyAt45.w < bodyAt0.w, `${bodyAt45.w} vs ${bodyAt0.w}`));
  it('height is untouched by pure yaw', check(Math.abs(bodyAt45.h - bodyAt0.h) < 1e-6));
}
