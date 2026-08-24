import type { Rig, RigNode, Vec2 } from './types';

/**
 * The curvature engine. A body node is the silhouette of a sphere of radius R seen
 * from the front; every mapped child is placed by two angles instead of pixels:
 *
 *   n = ( sin θ cos φ ,  sin φ ,  cos θ cos φ )      unit surface normal
 *   screen = R · n.xy · m                             m = perspective divide
 *   foreshorten = n.z                                 compression toward the rim
 *
 * Pure functions only — the SVG canvas, the Lottie baker and the copilot preview all
 * call the same code, so what you see is what exports.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface Projected {
  /** offset from the parent's centre, in px */
  x: number;
  y: number;
  /** multipliers on the node's own width/height (foreshortening + perspective) */
  sx: number;
  sy: number;
  /** n.z in -1..1 — z-order and rim clipping */
  depth: number;
  /** 0..1 — fades out over the last few degrees before the limb */
  alpha: number;
  visible: boolean;
}

export const FLAT: Projected = { x: 0, y: 0, sx: 1, sy: 1, depth: 1, alpha: 1, visible: true };

/** Width of the fade band at the limb, in units of n.z. */
const RIM_FADE = 0.14;

type V3 = [number, number, number];

/** Head turn: yaw about the body's vertical axis, then pitch about the world horizontal. */
function rotateHead(n: V3, yaw0: number, pitch0: number): V3 {
  const cy = Math.cos(yaw0), sy = Math.sin(yaw0);
  const x1 = n[0] * cy + n[2] * sy;
  const z1 = -n[0] * sy + n[2] * cy;
  const cp = Math.cos(pitch0), sp = Math.sin(pitch0);
  return [x1, n[1] * cp + z1 * sp, -n[1] * sp + z1 * cp];
}

function unrotateHead(n: V3, yaw0: number, pitch0: number): V3 {
  const cp = Math.cos(-pitch0), sp = Math.sin(-pitch0);
  const y1 = n[1] * cp + n[2] * sp;
  const z1 = -n[1] * sp + n[2] * cp;
  const cy = Math.cos(-yaw0), sy = Math.sin(-yaw0);
  return [n[0] * cy + z1 * sy, y1, -n[0] * sy + z1 * cy];
}

/** 1 when orthographic; grows toward the viewer as fov opens up. */
export function perspective(nz: number, fov: number, distance: number): number {
  const w = Math.min(Math.max(fov, 0), 89) / 90;
  if (w === 0) return 1;
  const d = Math.max(distance, 1.2);
  return 1 - w + w * (d / (d - nz));
}

/**
 * Under perspective the visible cap is smaller than the hemisphere: the eye sees only
 * down to the tangent ray, at n.z = R/D. Anything below that is hidden behind the
 * body's own limb, so it must not render and must not be a drag target.
 */
export function limbThreshold(fov: number, distance: number): number {
  const w = Math.min(Math.max(fov, 0), 89) / 90;
  return w / Math.max(distance, 1.2);
}

/**
 * How large the sphere's silhouette actually is on screen, in units of R.
 *
 * Orthographically it is exactly R. Under perspective the visible limb sits at
 * n.z = R/D and projects *outside* R — the classic result that a sphere at distance D
 * subtends R·D/√(D²−R²). Draw the body at plain R and features near the rim spill past
 * its outline, which is what makes a 2D fake read as broken. Scanning the projected
 * radius over the visible cap is exact for the blended divide too, and it is a handful
 * of multiplies once per frame.
 */
const silhouetteCache = new Map<string, number>();
export function silhouetteScale(fov: number, distance: number): number {
  const key = `${fov}|${distance}`;
  const hit = silhouetteCache.get(key);
  if (hit !== undefined) return hit;
  const lo = limbThreshold(fov, distance);
  let max = 1;
  for (let i = 0; i <= 96; i++) {
    const nz = lo + ((1 - lo) * i) / 96;
    max = Math.max(max, perspective(nz, fov, distance) * Math.sqrt(Math.max(0, 1 - nz * nz)));
  }
  if (silhouetteCache.size > 512) silhouetteCache.clear();
  silhouetteCache.set(key, max);
  return max;
}

export function surfaceNormal(yawDeg: number, pitchDeg: number): V3 {
  const t = yawDeg * D2R, p = pitchDeg * D2R;
  return [Math.sin(t) * Math.cos(p), Math.sin(p), Math.cos(t) * Math.cos(p)];
}

/**
 * Stylised "the ball is turning" cue for the body's own silhouette.
 *
 * A true sphere's outline is a circle from every angle — turning it changes nothing
 * about its drawn shape, only where features sit on it. That's mathematically correct
 * and, on its own, reads as broken: two eyes sliding across a perfectly static circle
 * doesn't parse as a head turning, especially for small-to-moderate yaw where one eye's
 * own ±offset partly cancels the head rotation. This squashes the DRAWN body (and,
 * because callers apply it to the same radius used for placement, pulls features in
 * with it) by up to TURN_K along whichever axis is turning — a cartoon cheat, not
 * physics, sized to be visible well before 90°.
 */
const TURN_K = 0.22;
export function bodyTurnScale(yawDeg: number, pitchDeg: number): { sx: number; sy: number } {
  return {
    sx: 1 - TURN_K * Math.abs(Math.sin(yawDeg * D2R)),
    sy: 1 - TURN_K * Math.abs(Math.sin(pitchDeg * D2R)),
  };
}

/** An eye's friendly "distance from centre" is a signed offset on top of its posed yaw. */
export function effectiveYaw(node: RigNode): number {
  return node.surface.yaw + (node.eye?.distanceFromCenter ?? 0);
}

/**
 * @param R parent's rendered radius in px
 * @param head parent's own yaw/pitch in degrees (the head turn)
 */
export function projectToScreen(
  node: RigNode,
  rig: Rig,
  R: number,
  head: Vec2 = { x: 0, y: 0 },
): Projected {
  if (!node.surface.mapped) {
    const o = node.surface.flatOffset ?? { x: 0, y: 0 };
    return { ...FLAT, x: o.x, y: o.y };
  }

  const n = rotateHead(
    surfaceNormal(effectiveYaw(node), node.surface.pitch),
    head.x * D2R,
    head.y * D2R,
  );
  const m = perspective(n[2], rig.camera.fov, rig.camera.distance);
  const x = R * n[0] * m;
  const y = R * n[1] * m;

  // Compression is radial: a feature near the rim squashes *along* the line to the
  // centre, not uniformly. Expressed in the node's own rolled frame it collapses into a
  // plain scale vector — which is all a Lottie transform can carry, so preview and
  // export stay bit-identical instead of drifting apart.
  //
  // Dropping the shear off-diagonal is exact when the shape's axes line up with the
  // radius (α = 0° or 90°). At 45° it is not, and the uncorrected form lets an eye
  // spill ~11% past the silhouette. Fading the anisotropy out with cos²2α makes 45°
  // exact too — there the shape is equally radial and tangential, so uniform f is the
  // right answer — and holds the worst case in between to a couple of percent.
  // ponytail: 2% too-small near the rim at 30°/60°; the exact fix needs Lottie's skew
  // decomposition, which is not worth a preview/export divergence.
  const f = Math.max(n[2], 0);
  const alpha = Math.atan2(y, x) - node.transform.rotation * D2R;
  const g = Math.cos(2 * alpha) ** 2;
  const ca = Math.cos(alpha) ** 2 * g, sa = Math.sin(alpha) ** 2 * g;

  // A feature does not pop out of existence at the limb — real occlusion would eat it
  // gradually, and the fade also covers the last percent of scale-only approximation
  // error, which lives in exactly this band.
  const limb = limbThreshold(rig.camera.fov, rig.camera.distance);
  const u = Math.min(1, Math.max(0, (n[2] - limb) / RIM_FADE));

  return {
    x,
    y,
    sx: (f + (1 - f) * sa) * m,
    sy: (f + (1 - f) * ca) * m,
    depth: n[2],
    alpha: u * u * (3 - 2 * u),
    visible: n[2] > limb + 1e-9,
  };
}

/**
 * Screen offset -> yaw/pitch. The perspective divide makes this implicit, and above
 * the limb the projected radius is monotone in n.z — so bracket the crossing on a
 * coarse scan, then bisect. Robust where a fixed point oscillates near the rim.
 */
export function screenToSurface(
  x: number,
  y: number,
  rig: Rig,
  R: number,
  head: Vec2 = { x: 0, y: 0 },
): Vec2 {
  const { fov, distance } = rig.camera;
  const target = Math.hypot(x, y) / R;
  const lo = limbThreshold(fov, distance);
  const radiusAt = (nz: number) => perspective(nz, fov, distance) * Math.sqrt(Math.max(0, 1 - nz * nz));

  let hi = 1;
  let a = lo;
  const STEPS = 64;
  for (let i = STEPS - 1; i >= 0; i--) {
    const nz = lo + ((hi - lo) * i) / STEPS;
    if (radiusAt(nz) >= target) { a = nz; break; }
    hi = nz;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (a + hi) / 2;
    if (radiusAt(mid) >= target) a = mid; else hi = mid;
  }
  const m = perspective(a, fov, distance);
  let nx = x / (R * m), ny = y / (R * m);
  const len = Math.hypot(nx, ny, a);
  if (len > 0) { nx /= len; ny /= len; }
  const n: V3 = [nx, ny, len > 0 ? a / len : 1];

  const l = unrotateHead(n, head.x * D2R, head.y * D2R);
  return {
    x: Math.atan2(l[0], l[2]) * R2D,
    y: Math.asin(Math.min(1, Math.max(-1, l[1]))) * R2D,
  };
}
