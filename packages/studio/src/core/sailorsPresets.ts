import { addPresetLayers, defaultProject, defaultRig } from './defaults';
import { openEnded } from './layers';
import { art, HI_BUBBLE, limb } from './showcase';
import { uid } from './id';
import { ANY_STATE } from './types';
import type { Appearance, ColorStop, EasingCurve, Keyframe, KeyValue, Preset, Project, Rig, RigNode, Timeline, Track } from './types';

/**
 * The Sailors mascot: the round bone-white character with ink limbs, and every state the
 * Sailors app plays it in — forgot password, home, practice complete, saved, today's
 * practice and the streak-restore scenes (`SAILORS_PROJECTS` says which project holds which).
 *
 * Authored as MOTION, not as keys. Each state is written as functions of time — a breath, a
 * scratch, a hop — composed the way an animator layers them (body first, the face and hands a
 * few frames behind), then sampled into keyframes by `sample()`: a key only where the curve
 * needs one, each carrying its exact slope as a bezier handle. So every track is smooth (C1)
 * through every key and across the loop seam, nothing is linear, and a state loops with no
 * hitch because the functions it is made of are periodic.
 *
 * The limbs are the base character's: ink hoses, arms 39 thick on an 84 reach, legs 38 thick
 * with a 35-wide foot — and the legs have NO knee: each is one hose from hip to ankle, which
 * bows when the body squashes onto it. Feet stay planted: `puppet()` places each ankle by
 * inverting the body's own frame (scene.ts `toFrame`), so a squash, a lean or a sway never
 * slides them.
 */

// --- palette --------------------------------------------------------------------------------
const rgb = (r: number, g: number, b: number, a = 1): ColorStop => ({ r, g, b, a });
const hex = (h: string): ColorStop => rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
export const SAILOR_INK = rgb(20, 19, 24);
const INK = '#141318';
const PAPER = '#fffdf6';
/** the streak-restore scenes' own ink, heart and shade */
const S_INK = '#3A2418', HEART = '#E8646B', HEART_SHADE = '#C74F58';
const FRIENDS = { green: hex('#A6DCA0'), pink: hex('#F5A8C2'), blue: hex('#9DCBF4'), orange: hex('#FFB878'), yellow: hex('#F8D86A'), purple: hex('#C5B0F2') };

// --- art ------------------------------------------------------------------------------------------
const arcEye = (d: string, w = 10) => `<svg viewBox="0 0 56 32"><path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
const HAPPY_ARC = arcEye('M7 25 Q28 -3 49 25');
/** sad: a downcast ∪, tipped up at the inner corner — ( ◡́ ◡̀ ) (drawn for the left eye; mirrored) */
const SAD_ARC_L = arcEye('M7 9 Q26 25 49 6', 9);
const SAD_ARC_R = arcEye('M7 6 Q30 25 49 9', 9);
const MITTEN = `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="29" fill="${INK}"/></svg>`;
const ENVELOPE = `<svg viewBox="0 0 120 84">
  <rect x="4" y="4" width="112" height="76" rx="9" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  <path d="M8 76 L48 44 M112 76 L72 44" stroke="#d9d0bf" stroke-width="4" stroke-linecap="round" fill="none"/>
  <path d="M8 9 L60 50 L112 9" fill="#f3ecdf" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="60" cy="50" r="8" fill="#e8646b" stroke="${INK}" stroke-width="3"/>
</svg>`;
const BOOKMARK = `<svg viewBox="0 0 76 112">
  <path d="M10 12 A8 8 0 0 1 18 4 H58 A8 8 0 0 1 66 12 V104 L38 82 L10 104 Z" fill="#ffffff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M22 20 H54 V80 L38 68 L22 80 Z" fill="none" stroke="#cfd6e2" stroke-width="3.5" stroke-dasharray="7 6" stroke-linejoin="round"/>
</svg>`;
const BOOK = `<svg viewBox="0 0 210 128">
  <path d="M105 16 C76 6 34 6 8 14 V118 C34 110 76 110 105 120 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M105 16 C134 6 176 6 202 14 V118 C176 110 134 110 105 120 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M24 36 C48 30 72 30 92 36 M24 56 C48 50 72 50 92 56 M24 76 C44 71 62 71 80 75 M118 36 C138 30 162 30 186 36 M118 56 C138 50 162 50 186 56 M118 76 C134 71 150 71 168 75" stroke="#b9b1a2" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>`;
/** the page that turns: its outline flat, and bowed mid-turn (the same points, so they morph) */
const PAGE_FLAT = 'M-0.5 -0.42 C-0.22 -0.5 0.2 -0.5 0.5 -0.44 L0.5 0.44 C0.2 0.38 -0.22 0.38 -0.5 0.46 Z';
const PAGE_BENT = 'M-0.5 -0.42 C-0.3 -0.62 0.14 -0.6 0.5 -0.5 L0.5 0.38 C0.14 0.26 -0.3 0.28 -0.5 0.46 Z';
const PAGE = `<svg viewBox="-0.5 -0.5 1 1"><path d="${PAGE_FLAT}" fill="#f7f2e6" stroke="${INK}" stroke-width="0.045" stroke-linejoin="round"/></svg>`;
const YAWN = `<svg viewBox="0 0 40 48"><ellipse cx="20" cy="24" rx="17" ry="21" fill="${INK}"/><ellipse cx="20" cy="36" rx="9" ry="6" fill="#e8646b"/></svg>`;
const crackedHeart = (fill: string, shade: string, ink: string) => `<svg viewBox="0 0 110 100">
  <path d="M55 94 C18 70 4 50 6 30 C8 12 22 4 36 4 C46 4 52 10 55 16 C58 10 64 4 74 4 C88 4 102 12 104 30 C106 50 92 70 55 94 Z" fill="${fill}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M72 88 C92 72 100 56 100 36 C98 50 88 66 64 84 Z" fill="${shade}"/>
  <path d="M55 17 L47 36 L60 50 L48 66 L55 86" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M22 26 C24 18 30 14 36 14" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="5" stroke-linecap="round"/>
</svg>`;
/** the streak's heart before anything happened to it */
const wholeHeart = `<svg viewBox="0 0 110 100">
  <path d="M55 94 C18 70 4 50 6 30 C8 12 22 4 36 4 C46 4 52 10 55 16 C58 10 64 4 74 4 C88 4 102 12 104 30 C106 50 92 70 55 94 Z" fill="${HEART}" stroke="${S_INK}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M72 88 C92 72 100 56 100 36 C98 50 88 66 64 84 Z" fill="${HEART_SHADE}"/>
  <path d="M22 26 C24 18 30 14 36 14" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="5" stroke-linecap="round"/>
</svg>`;
const ALARM = `<svg viewBox="0 0 140 150">
  <path d="M34 124 L20 146 M106 124 L120 146" stroke="${S_INK}" stroke-width="9" stroke-linecap="round"/>
  <path d="M26 42 A22 22 0 0 1 52 16 Z" fill="#f7c948" stroke="${S_INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M114 42 A22 22 0 0 0 88 16 Z" fill="#f7c948" stroke="${S_INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M70 22 V12 M60 10 H80" stroke="${S_INK}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="70" cy="80" r="56" fill="#8ec5ff" stroke="${S_INK}" stroke-width="6"/>
  <circle cx="70" cy="80" r="44" fill="${PAPER}" stroke="${S_INK}" stroke-width="4"/>
  <path d="M70 42 V50 M70 110 V118 M32 80 H40 M100 80 H108" stroke="${S_INK}" stroke-width="5" stroke-linecap="round"/>
</svg>`;
/** a clock hand in a box centred on its pivot, pointing up */
const clockHand = (len: number, w: number, color: string) => `<svg viewBox="-12 -50 24 100"><rect x="-12" y="-50" width="24" height="100" fill="#000" fill-opacity="0"/><path d="M0 8 L0 ${-len}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/><circle cx="0" cy="0" r="6" fill="${S_INK}"/></svg>`;
const RING = `<svg viewBox="0 0 200 80"><path d="M30 14 C16 26 16 50 30 62 M14 6 C-4 24 -4 52 14 70 M170 14 C184 26 184 50 170 62 M186 6 C204 24 204 52 186 70" fill="none" stroke="${S_INK}" stroke-width="6" stroke-linecap="round"/></svg>`;
const SWEAT = `<svg viewBox="0 0 30 44"><path d="M15 2 C22 16 28 24 28 30 A13 13 0 0 1 2 30 C2 24 8 16 15 2 Z" fill="#8ec5ff" stroke="${S_INK}" stroke-width="3"/></svg>`;
const TEAR_STREAM = `<svg viewBox="0 0 34 150"><path d="M3 4 H31 V136 A14 14 0 0 1 3 136 Z" fill="#5aa9f0"/><path d="M11 12 V128" stroke="#bfe1ff" stroke-width="5" stroke-linecap="round"/></svg>`;
const TEAR = `<svg viewBox="0 0 30 44"><path d="M15 2 C22 16 28 24 28 30 A13 13 0 0 1 2 30 C2 24 8 16 15 2 Z" fill="#5aa9f0"/></svg>`;
const WAIL = `<svg viewBox="0 0 80 64">
  <path d="M8 16 C8 4 72 4 72 16 L64 52 C62 60 18 60 16 52 Z" fill="${INK}"/>
  <path d="M15 12 H65 L63 22 C48 26 32 26 17 22 Z" fill="#ffffff"/>
  <ellipse cx="40" cy="50" rx="16" ry="7" fill="#e8646b"/>
</svg>`;
const BROW_L = arcEye('M6 24 Q20 8 50 6', 8);
const BROW_R = arcEye('M6 6 Q36 8 50 24', 8);
const hourglass = (sandTop: boolean, glass = '#eef6ff', wood = '#c98f58', sand = '#f2c46b') => `<svg viewBox="0 0 70 100">
  <path d="M14 10 H56 C56 34 40 42 40 50 C40 58 56 66 56 90 H14 C14 66 30 58 30 50 C30 42 14 34 14 10 Z" fill="${glass}" stroke="${S_INK}" stroke-width="4" stroke-linejoin="round"/>
  ${sandTop ? `<path d="M20 22 H50 C48 34 38 40 35 46 C32 40 22 34 20 22 Z" fill="${sand}"/>` : ''}
  <path d="M${sandTop ? 22 : 17} 88 C${sandTop ? '24 74 30 70 35 70 C40 70 46 74 48' : '18 66 28 60 35 60 C42 60 52 66 53'} 88 Z" fill="${sand}"/>
  <rect x="6" y="3" width="58" height="10" rx="5" fill="${wood}" stroke="${S_INK}" stroke-width="4"/>
  <rect x="6" y="87" width="58" height="10" rx="5" fill="${wood}" stroke="${S_INK}" stroke-width="4"/>
</svg>`;
const SAND_GRAIN = `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.5" fill="#e8b54f"/></svg>`;
const BANG = `<svg viewBox="0 0 24 64"><path d="M12 4 C17 4 19 8 18 13 L15 40 C14.6 44 9.4 44 9 40 L6 13 C5 8 7 4 12 4 Z" fill="${S_INK}"/><circle cx="12" cy="55" r="6" fill="${S_INK}"/></svg>`;
const CALENDAR = `<svg viewBox="0 0 120 130">
  <rect x="6" y="14" width="108" height="112" rx="12" fill="${PAPER}" stroke="${S_INK}" stroke-width="5"/>
  <path d="M6 30 A16 16 0 0 1 22 14 H98 A16 16 0 0 1 114 30 V44 H6 Z" fill="${HEART}" stroke="${S_INK}" stroke-width="5" stroke-linejoin="round"/>
  <rect x="30" y="4" width="9" height="22" rx="4.5" fill="${S_INK}"/><rect x="81" y="4" width="9" height="22" rx="4.5" fill="${S_INK}"/>
</svg>`;
/** the calendar's top sheet: a month of days, one ringed — this month's restore, spent */
const CAL_SHEET = `<svg viewBox="0 0 104 76">
  <rect x="2" y="2" width="100" height="72" rx="6" fill="#fffaf0" stroke="${S_INK}" stroke-width="3.5"/>
  ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect x="${12 + c * 17}" y="${12 + r * 14}" width="11" height="8" rx="2.5" fill="#e3d8c6"/>`).join('')).join('')}
  <circle cx="51.5" cy="30" r="10" fill="none" stroke="${HEART}" stroke-width="4"/>
  <path d="M45 36 L58 24" stroke="${HEART}" stroke-width="4" stroke-linecap="round"/>
</svg>`;
const FLAME = `<svg viewBox="0 0 80 110"><path d="M40 4 C50 26 74 40 74 68 C74 92 58 106 40 106 C22 106 6 92 6 68 C6 50 18 40 24 28 C28 40 32 44 36 46 C34 30 36 16 40 4 Z" fill="#ff8a3d" stroke="${S_INK}" stroke-width="5" stroke-linejoin="round"/></svg>`;
const FLAME_CORE = `<svg viewBox="0 0 40 60"><path d="M20 3 C26 16 36 26 36 40 C36 52 28 58 20 58 C12 58 4 52 4 40 C4 30 10 24 14 16 C16 24 18 26 20 27 C19 18 18 10 20 3 Z" fill="#ffd35c"/></svg>`;
const SPARK = `<svg viewBox="0 0 40 40"><path d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2 Z" fill="#ffc93c"/></svg>`;

// --- the character ----------------------------------------------------------------------------
/** where the body's centre sits, from the composition's centre: the whole character — head top
 *  (-148) to sole (+218) — centred, which is ~70% of a 512 canvas */
export const BASE_Y = -35;
/** the ankle line in the body's own frame; the sole is half a foot below it */
const ANKLE_Y = 200;
const HIP = { x: 56, y: 112 };
const SHOULDER = { x: 118, y: 46 };
/** a front arm starts at the body's edge, so it can cross in front of it */
const FRONT_SHOULDER = { x: 128, y: 40 };
/** a hand at rest, hanging just off the body */
const HAND_REST = { x: 160, y: 116 };
const ARM_LEN = 84;
/** a leg's rest length: the hip-to-ankle distance, a hair over so it never pulls taut */
const LEG_LEN = Math.round(Math.hypot(2, ANKLE_Y - HIP.y) * 1.02);
/** where the eyes sit on the sphere (yaw, pitch °) — so arc eyes can stand exactly where they are */
const EYE_YAW = 22.2, EYE_PITCH = -4.6, R_BODY = 148;

/** a hand in the base character's style: an ink hose, bowing inward */
function sailorArm(side: -1 | 1, id = side < 0 ? 'armL' : 'armR', over: Partial<RigNode> = {}): RigNode {
  const n = limb('arm', side, {
    a: { x: SHOULDER.x * side, y: SHOULDER.y }, b: { x: HAND_REST.x * side, y: HAND_REST.y },
    hose: 1, thickness: 39, bend: -side, roundness: 1, taper: 0.12, length: ARM_LEN,
  });
  return { ...n, id, color: SAILOR_INK, ...over };
}
/** a leg with no knee: one hose from the hip to the ankle, and the base character's foot */
function sailorLeg(side: -1 | 1, id = side < 0 ? 'legL' : 'legR', over: Partial<RigNode> = {}): RigNode {
  const n = limb('leg', side, {
    a: { x: HIP.x * side, y: HIP.y }, b: { x: (HIP.x + 2) * side, y: ANKLE_Y },
    hose: 1, thickness: 38, bend: side, roundness: 1, taper: 0.08, length: LEG_LEN,
    foot: { angle: 0, length: 40, width: 35 },
  });
  delete n.limb!.c;
  return { ...n, id, color: SAILOR_INK, ...over };
}
export const sailorLimbs = (): RigNode[] => [sailorArm(-1), sailorArm(1), sailorLeg(-1), sailorLeg(1)];

/** The Sailors character as a rig: the default body, face and eyes, and the base limbs. */
export function sailorRig(): Rig {
  const rig = defaultRig();
  rig.nodes.body.zIndex = 7;
  rig.nodes.body.surface.flatOffset = { x: 0, y: BASE_Y };
  rig.nodes.face.zIndex = 8;
  rig.nodes.eyeL.zIndex = 8;
  rig.nodes.eyeR.zIndex = 9;
  const [aL, aR, lL, lR] = sailorLimbs();
  for (const [n, z] of [[aL, 5], [aR, 6], [lL, 3], [lR, 4]] as const) {
    rig.nodes[n.id] = { ...n, parentId: n.limb!.type === 'arm' ? 'face' : 'body', ranged: false, zIndex: z };
  }
  return rig;
}

// --- motion: functions of time, sampled into keys ----------------------------------------------
export type F = (t: number) => number;
type V2 = { x: number; y: number };
type P2 = (t: number) => V2;
const TAU = Math.PI * 2;
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** smooth 0→1, zero slope at both ends */
export const io = (u: number) => { const x = clamp01(u); return x * x * (3 - 2 * x); };
/** a smooth bump: 0 at a, rises to 1 by a+rise, holds to b-fall, back to 0 at b */
export const bump = (t: number, a: number, rise: number, b: number, fall: number) =>
  t <= a || t >= b ? 0 : t < a + rise ? io((t - a) / rise) : t > b - fall ? io((b - t) / fall) : 1;
/** a sine of whole periods over the loop — `phase` in turns (0.25 = starts at its peak) */
export const wave = (L: number, cycles: number, amp: number, phase = 0): F => (t) => amp * Math.sin(TAU * (cycles * t / L + phase));
/** `f` delayed by `ms` around a loop of `L` — follow-through */
export const lag = <T>(f: (t: number) => T, ms: number, L: number) => (t: number): T => f((((t - ms) % L) + L) % L);
/** a max with a rounded corner, so a hose that starts to reach does not kink into it */
const smax = (a: number, b: number, k = 6) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
/** |x| and a clamp without corners — a corner in a curve is a visible hitch in the motion */
const sabs = (x: number, e = 0.02) => Math.sqrt(x * x + e * e) - e;
const sat = (x: number, lim: number) => lim * Math.tanh(x / lim);
const splus = (x: number, e = 0.05) => (x + Math.sqrt(x * x + e * e)) / 2;
const V = (x: number, y: number): V2 => ({ x, y });

/**
 * Pose keys through a smooth curve: monotone cubic (Fritsch–Butland) — it passes every key,
 * never overshoots between two, and eases to a stop at every extreme. With `L` it is periodic
 * (the first and last keys must match), so the slope carries across the seam.
 */
export function spline(keys: [number, number][], L?: number): F {
  const ts = keys.map((k) => k[0]), vs = keys.map((k) => k[1]);
  const n = ts.length;
  if (n === 1) return () => vs[0];
  const d = ts.slice(0, -1).map((t, i) => (vs[i + 1] - vs[i]) / (ts[i + 1] - t));
  const h = (i: number) => ts[i + 1] - ts[i];
  const fb = (d0: number, d1: number, h0: number, h1: number) =>
    d0 * d1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  const m = ts.map((_, i) => (i > 0 && i < n - 1 ? fb(d[i - 1], d[i], h(i - 1), h(i)) : 0));
  if (L !== undefined) m[0] = m[n - 1] = fb(d[n - 2], d[0], h(n - 2), h(0));
  return (t) => {
    if (L !== undefined) t = ((t % L) + L) % L;
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const dt = h(i), u = (t - ts[i]) / dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * dt * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * dt * m[i + 1];
  };
}
/** a point moving through poses: [t, x, y] keys, periodic over `L` */
export function path(keys: [number, number, number][], L: number): P2 {
  const fx = spline(keys.map(([t, x]) => [t, x]), L), fy = spline(keys.map(([t, , y]) => [t, y]), L);
  return (t) => V(fx(t), fy(t));
}

/** eyes shut and open again: quick down, a beat closed, a softer open */
export function blinks(at: number[], close = 70, hold = 40, open = 120, shut = 0.06): F {
  return (t) => {
    let v = 1;
    for (const b of at) v = Math.min(v, 1 - (1 - shut) * bump(t, b, close, b + close + hold + open, open));
    return v;
  };
}

const FPS = 60;
/** how close the keys must follow the motion, by what the property measures */
const tolOf = (prop: string) =>
  /squish|scale|openness|opacity|visible|presence/.test(prop) ? 0.0015
    : /rotation|yaw|pitch|angle/.test(prop) ? 0.12
      : /hose|bend|taper/.test(prop) ? 0.004 : 0.2;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const EASE: EasingCurve = { type: 'preset', name: 'easeInOut' };

/** the bezier handle pair that makes a segment exactly the cubic with these end slopes */
function handles(v0: number, v1: number, m0: number, m1: number, dt: number): EasingCurve {
  const dv = v1 - v0;
  if (Math.abs(dv) < 1e-6) return EASE;
  return { type: 'bezier', p1: { x: 1 / 3, y: r4((m0 * dt) / (3 * dv)) }, p2: { x: 2 / 3, y: r4(1 - (m1 * dt) / (3 * dv)) } };
}

/**
 * `f` over [0, L] as keyframes: sampled on every frame, then only the keys the curve needs — a
 * key is dropped while the cubic between its neighbours (their values and exact slopes) still
 * follows every frame within tolerance. A constant comes out as one key.
 */
export function sample(f: F, L: number, prop: string): Keyframe[] {
  // candidate keys every other frame; the fit is still checked on every frame (the half steps)
  const N = Math.max(2, Math.round((L / 1000) * (FPS / 2)));
  const tol = tolOf(prop);
  const T = (j: number) => (j * L) / N;
  const v = Array.from({ length: N + 1 }, (_, j) => f(T(j)));
  const e = 0.5;
  const m = Array.from({ length: N + 1 }, (_, j) => {
    const a = Math.max(0, T(j) - e), b = Math.min(L, T(j) + e);
    return (f(b) - f(a)) / (b - a);
  });
  if (v.every((x) => Math.abs(x - v[0]) < tol * 0.25)) return [{ id: uid('k'), time: 0, value: r3(v[0]), easingOut: EASE }];
  const herm = (i: number, j: number, t: number) => {
    const dt = T(j) - T(i), u = (t - T(i)) / dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * dt * m[i] + (-2 * u3 + 3 * u2) * v[j] + (u3 - u2) * dt * m[j];
  };
  // and half a frame on, where a fast move could bow out between two frames
  const mid = Array.from({ length: N }, (_, q) => f(T(q) + L / N / 2));
  const fits = (i: number, j: number) => {
    // a flat segment with slope at its ends cannot be written as one bezier — keep a key inside
    if (Math.abs(v[j] - v[i]) < 1e-4 && (Math.abs(m[i]) + Math.abs(m[j])) * (T(j) - T(i)) > tol) return false;
    for (let q = i + 1; q < j; q++) if (Math.abs(herm(i, j, T(q)) - v[q]) > tol) return false;
    for (let q = i; q < j; q++) if (Math.abs(herm(i, j, T(q) + L / N / 2) - mid[q]) > tol * 1.5) return false;
    return true;
  };
  const keep = [0];
  let i = 0;
  for (let j = 2; j <= N; j++) if (!fits(i, j)) { keep.push(j - 1); i = j - 1; }
  keep.push(N);
  return keep.map((j, idx) => {
    const nx = keep[idx + 1];
    return {
      id: uid('k'), time: Math.round(T(j) * 1000) / 1000, value: r3(v[j]),
      easingOut: nx === undefined ? EASE : handles(v[j], v[nx], m[j], m[nx], T(nx) - T(j)),
    };
  });
}

/** One state being written: its length, the tracks sampled so far, and the layers it brings. */
export class Motion {
  tracks: Track[] = [];
  layers: RigNode[] = [];
  readonly L: number;
  constructor(L: number) { this.L = L; }
  /** a property of a layer as a function of time — sampled into keys */
  set(nodeId: string, property: string, f: F | number): this {
    const fn = typeof f === 'number' ? () => f : f;
    this.tracks.push({ id: uid('t'), nodeId, property, keyframes: sample(fn, this.L, property) });
    return this;
  }
  /** a value that is not a number (a colour, an outline): keys as given, eased */
  keys(nodeId: string, property: string, keys: [number, KeyValue][]): this {
    this.tracks.push({ id: uid('t'), nodeId, property, keyframes: keys.map(([time, value]) => ({ id: uid('k'), time, value, easingOut: EASE })) });
    return this;
  }
  /** a point: x and y of a layer's offset */
  at(nodeId: string, p: P2): this {
    return this.set(nodeId, 'flatOffset.x', (t) => p(t).x).set(nodeId, 'flatOffset.y', (t) => p(t).y);
  }
  scale(nodeId: string, sx: F | number, sy: F | number = sx): this {
    return this.set(nodeId, 'transform.scale.x', sx).set(nodeId, 'transform.scale.y', sy);
  }
  add(...layers: RigNode[]): this { this.layers.push(...layers); return this; }
}

/** a prop layer: on the face (it moves with the head, and the hands holding it), the body, or the world */
function prop(id: string, name: string, markup: string, x: number, y: number, w: number, h: number, z: number, parentId: string | null = 'face', over: Partial<RigNode> = {}): RigNode {
  return art(id, name, markup, { parentId, surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x, y } }, size: { x: w, y: h }, zIndex: z, ...over });
}

// --- the puppet: a whole character from a handful of motions --------------------------------------
export interface Puppet {
  /** the body over its feet: sway, lift (negative is up), lean in degrees about the feet */
  x?: F; y?: F; lean?: F;
  /** squash: the body's height factor, 1 at rest; its width answers so the area holds */
  squash?: F;
  /** how much wider than `1 / squash` — a sigh flattens more than volume alone */
  widen?: F;
  /** the head (face frame): a drift, a tilt in degrees, and where the eyes look (yaw, pitch °) */
  headX?: F; headY?: F; tilt?: F; yaw?: F; pitch?: F;
  /** eyes: openness (both, or each) and their size */
  open?: F; openL?: F; openR?: F; eyeSX?: F; eyeSY?: F;
  /** closed arc eyes instead of the ovals: happy (∩) or sad (∩ tipped up at the inside) */
  arcs?: 'happy' | 'sad'; arcSY?: F;
  /** hands in the face frame, and their shoulders when an arm comes from somewhere else */
  handL?: P2; handR?: P2; shoulderL?: P2; shoulderR?: P2;
  /** how straight each arm is drawn (1 = pulled straight; the default 1.06 always curves) */
  slackL?: number; slackR?: number;
  bendL?: F; bendR?: F;
  /** arms in FRONT of the body (holding, hugging, covering) instead of tucked behind it */
  front?: boolean;
  /** a round hand on the end of an arm, drawn over the body and whatever it holds */
  mittens?: 'both' | 'L' | 'R';
  /** where each foot is, relative to where it stands at rest: x, lift (negative up), toe angle */
  footL?: (t: number) => { x: number; y: number; angle?: number };
  footR?: (t: number) => { x: number; y: number; angle?: number };
  /** 1 = feet on the ground whatever the body does (default); 0 = they ride the body (a hop) */
  plant?: F;
  /** the character's size (1 = full) and where the middle of its ankle line stands */
  scale?: number; ground?: V2;
  /** another character: its layer ids start with this (`f1.` → `f1.body`, `f1.armL` …) */
  prefix?: string;
}

const zero: F = () => 0;
const one: F = () => 1;

/**
 * A puppet's frames as scene.ts builds them: the body's (placed so the middle of its ankle line
 * is on the ground, plus sway and lift), and the face's riding it — so a hand can be aimed at a
 * point in the world, or at another character (a pat on the shoulder lands on the shoulder).
 */
export function framesOf(p: Puppet) {
  const s = p.scale ?? 1;
  const ground = p.ground ?? { x: 0, y: BASE_Y + ANKLE_Y };
  const X = p.x ?? zero, Y = p.y ?? zero, lean = p.lean ?? zero, sq = p.squash ?? one, wid = p.widen ?? one;
  const hx = p.headX ?? zero, hy = p.headY ?? zero, tilt = p.tilt ?? zero;
  const ky = (t: number) => sq(t) * s;
  const kx = (t: number) => (wid(t) / sq(t)) * s;
  const body = (t: number) => {
    const r = (lean(t) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    const gx = ground.x + X(t) * s, gy = ground.y + Y(t) * s;
    // toFrame(f, (0, ANKLE_Y)) = f + R·(kx·0, ky·ANKLE_Y) must land on (gx, gy)
    const oy = ky(t) * ANKLE_Y;
    return { x: gx + oy * sn, y: gy - oy * c, c, sn };
  };
  const face = (t: number) => {
    const b = body(t), ox = kx(t) * hx(t), oy = ky(t) * hy(t);
    const r = ((lean(t) + tilt(t)) * Math.PI) / 180;
    return { x: b.x + ox * b.c - oy * b.sn, y: b.y + ox * b.sn + oy * b.c, c: Math.cos(r), sn: Math.sin(r) };
  };
  return {
    s, ground, kx, ky, body,
    /** a point in the face's own px → the world (composition-centred px) */
    toWorld: (t: number, v: V2): V2 => { const f = face(t), lx = v.x * kx(t), ly = v.y * ky(t); return V(f.x + lx * f.c - ly * f.sn, f.y + lx * f.sn + ly * f.c); },
    /** a point in the world → the face's own px */
    toFace: (t: number, w: V2): V2 => { const f = face(t), dx = w.x - f.x, dy = w.y - f.y; return V((dx * f.c + dy * f.sn) / kx(t), (-dx * f.sn + dy * f.c) / ky(t)); },
  };
}

/** Write a whole character's motion onto `m`. */
export function puppet(m: Motion, p: Puppet): void {
  const id = (n: string) => `${p.prefix ?? ''}${n}`;
  const lean = p.lean ?? zero, sq = p.squash ?? one, wid = p.widen ?? one;
  const plant = p.plant ?? one;
  const { s, ground, kx, ky, body: frame } = framesOf(p);
  if (s !== 1) m.scale(id('body'), s);
  m.set(id('body'), 'flatOffset.x', (t) => frame(t).x);
  m.set(id('body'), 'flatOffset.y', (t) => frame(t).y);
  m.set(id('body'), 'transform.rotation', lean);
  m.set(id('body'), 'squish.y', sq);
  m.set(id('body'), 'squish.x', (t) => wid(t) / sq(t));

  m.set(id('face'), 'flatOffset.x', p.headX ?? zero);
  m.set(id('face'), 'flatOffset.y', p.headY ?? zero);
  m.set(id('face'), 'transform.rotation', p.tilt ?? zero);
  const yaw = p.yaw ?? zero, pitch = p.pitch ?? zero;
  m.set(id('face'), 'surface.yaw', yaw);
  m.set(id('face'), 'surface.pitch', pitch);

  if (p.arcs) {
    // the ovals step aside for two arcs standing exactly where the eyes are looking from
    m.set(id('eyeL'), 'opacity', 0).set(id('eyeR'), 'opacity', 0);
    const rad = Math.PI / 180;
    for (const side of [-1, 1] as const) {
      const arcId = id(side < 0 ? 'arcL' : 'arcR');
      const arc = prop(arcId, side < 0 ? 'Left eye (closed)' : 'Right eye (closed)', p.arcs === 'sad' ? (side < 0 ? SAD_ARC_L : SAD_ARC_R) : HAPPY_ARC, side * 56, -12, 50, 29, 2, id('face'));
      // a drawn line keeps its width in screen px whatever the layer's scale — so give it the
      // character's: as heavy as the eyes it stands in for
      arc.stroke = { ...arc.stroke!, width: (p.arcs === 'sad' ? 17 : 20) * s };
      m.add(arc);
      m.at(arcId, (t) => V(R_BODY * Math.sin((side * EYE_YAW + yaw(t)) * rad), R_BODY * Math.sin((EYE_PITCH + pitch(t)) * rad) + (p.arcs === 'sad' ? 4 : 0)));
      if (p.arcSY) m.scale(arcId, 1, p.arcSY);
    }
  } else {
    m.set(id('eyeL'), 'eye.openness', p.openL ?? p.open ?? one);
    m.set(id('eyeR'), 'eye.openness', p.openR ?? p.open ?? one);
    if (p.eyeSX) { m.set(id('eyeL'), 'transform.scale.x', p.eyeSX); m.set(id('eyeR'), 'transform.scale.x', p.eyeSX); }
    if (p.eyeSY) { m.set(id('eyeL'), 'transform.scale.y', p.eyeSY); m.set(id('eyeR'), 'transform.scale.y', p.eyeSY); }
  }

  if (p.front) {
    // the arms behind the body rest hidden; two in front take their place
    m.set(id('armL'), 'opacity', 0).set(id('armR'), 'opacity', 0);
    m.add(sailorArm(-1, id('frontArmL'), { zIndex: 30, name: 'Left hand (front)' }), sailorArm(1, id('frontArmR'), { zIndex: 31, name: 'Right hand (front)' }));
  }
  const shoulderAt = p.front ? FRONT_SHOULDER : SHOULDER;
  const arm = (armId: string, side: -1 | 1, hand?: P2, shoulder?: P2, slack = 1.06, bend?: F) => {
    const sh: P2 = shoulder ?? (() => V(shoulderAt.x * side, shoulderAt.y));
    const hd: P2 = hand ?? (() => V(HAND_REST.x * side, HAND_REST.y));
    if (shoulder || p.front) { m.set(armId, 'limb.a.x', (t) => sh(t).x); m.set(armId, 'limb.a.y', (t) => sh(t).y); }
    m.set(armId, 'limb.b.x', (t) => hd(t).x);
    m.set(armId, 'limb.b.y', (t) => hd(t).y);
    // a rubber hose keeps its length: when the hand goes further than the arm reaches, the arm
    // grows with it (with a touch of slack, so it always curves), and relaxes back as it returns
    m.set(armId, 'limb.length', (t) => { const a = sh(t), b = hd(t); return smax(40, Math.hypot(b.x - a.x, b.y - a.y) * slack); });
    if (bend) m.set(armId, 'limb.bend', bend);
  };
  const armIds = p.front ? [id('frontArmL'), id('frontArmR')] : [id('armL'), id('armR')];
  arm(armIds[0], -1, p.handL, p.shoulderL, p.slackL, p.bendL);
  arm(armIds[1], 1, p.handR, p.shoulderR, p.slackR, p.bendR);
  if (p.mittens && p.mittens !== 'R') {
    m.add(prop(id('mittenL'), 'Left mitten', MITTEN, -60, 0, 62, 62, 25));
    m.at(id('mittenL'), p.handL ?? (() => V(-HAND_REST.x, HAND_REST.y)));
  }
  if (p.mittens && p.mittens !== 'L') {
    m.add(prop(id('mittenR'), 'Right mitten', MITTEN, 60, 0, 62, 62, 26));
    m.at(id('mittenR'), p.handR ?? (() => V(HAND_REST.x, HAND_REST.y)));
  }

  // the feet: where they stand in the world, back through the body's frame into its own px
  const leg = (legId: string, side: -1 | 1, foot?: Puppet['footL']) => {
    const rest = V((HIP.x + 2) * side, ANKLE_Y);
    const local = (t: number): V2 => {
      const ft = foot?.(t) ?? { x: 0, y: 0 };
      const riding = V(rest.x + ft.x, rest.y + ft.y);
      const w = plant(t);
      if (w <= 0) return riding;
      const f = frame(t);
      const wx = ground.x + (rest.x + ft.x) * s, wy = ground.y + ft.y * s;
      const dx = wx - f.x, dy = wy - f.y;
      const planted = V((dx * f.c + dy * f.sn) / kx(t), (-dx * f.sn + dy * f.c) / ky(t));
      return V(riding.x + (planted.x - riding.x) * w, riding.y + (planted.y - riding.y) * w);
    };
    m.set(legId, 'limb.b.x', (t) => local(t).x);
    m.set(legId, 'limb.b.y', (t) => local(t).y);
    // screen length hip→ankle; the hose (in the body's px × scale) never pulls taut
    m.set(legId, 'limb.length', (t) => {
      const b = local(t), a = V(HIP.x * side, HIP.y);
      return smax(LEG_LEN, (Math.hypot((b.x - a.x) * kx(t), (b.y - a.y) * ky(t)) / s) * 1.02, 4);
    });
    if (foot) m.set(legId, 'limb.foot.angle', (t) => foot(t).angle ?? 0);
  };
  leg(id('legL'), -1, p.footL);
  leg(id('legR'), 1, p.footR);
}

/** Another character for a scene: the Sailors rig under a prefix, coloured, sized and placed. */
function castMember(prefix: string, name: string, color: ColorStop, scale: number, x: number, groundY: number, z: number): RigNode[] {
  const rig = sailorRig();
  const P = (i: string | null) => (i ? `${prefix}${i}` : null);
  const zOf: Record<string, number> = { legL: z - 4, legR: z - 3, armL: z - 2, armR: z - 1, body: z, face: z + 1, eyeL: z + 1, eyeR: z + 2 };
  return Object.values(rig.nodes).map((n) => ({
    ...structuredClone(n), id: P(n.id)!, parentId: P(n.parentId), ranged: true, zIndex: zOf[n.id],
    name: n.id === 'body' ? name : `${name} · ${n.name}`,
    ...(n.id === 'body' ? {
      color, transform: { scale: { x: scale, y: scale }, rotation: 0 },
      surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x, y: groundY - ANKLE_Y * scale } },
    } : {}),
  }));
}

// --- a state as a preset -------------------------------------------------------------------------
const on = (nodeId: string, L: number): Omit<Appearance, 'id' | 'blockId'> => ({ nodeId, startMs: 0, endMs: L, fadeInMs: 0, fadeOutMs: 0 });
function preset(id: string, name: string, tagline: string, m: Motion): Preset {
  const all = [...sailorLimbs(), ...m.layers];
  return {
    id, name, source: 'builtin', durationMs: m.L, tagline, color: '#e8646b',
    layers: all, appearances: all.map((l) => on(l.id, m.L)), tracks: m.tracks,
  };
}
const rest = (side: -1 | 1) => V(HAND_REST.x * side, HAND_REST.y);
/** a hand swung from `a` to `b` round its shoulder — an arc, so the arm keeps its reach on the way
 *  (a straight line would pass by the shoulder and leave the arm a stub halfway) */
function swing(sh: V2, a: V2, b: V2, u: number): V2 {
  const ra = Math.hypot(a.x - sh.x, a.y - sh.y), rb = Math.hypot(b.x - sh.x, b.y - sh.y);
  const ta = Math.atan2(a.y - sh.y, a.x - sh.x);
  let d = Math.atan2(b.y - sh.y, b.x - sh.x) - ta;
  d -= TAU * Math.round(d / TAU);   // the short way round
  const r = ra + (rb - ra) * u, th = ta + d * u;
  return V(sh.x + r * Math.cos(th), sh.y + r * Math.sin(th));
}
/** a hand hanging at rest with a small swing that trails the body */
const hanging = (side: -1 | 1, L: number, swing: F, delay = 90, dx = 0, dy = 0): P2 =>
  lag((t: number) => V(HAND_REST.x * side + dx - 5 * swing(t), HAND_REST.y + dy - 2.5 * swing(t) ** 2), delay, L);

// ── Forgot password ──────────────────────────────────────────────────────────────────────────
/** email: scratching its head, eyes up and away, a little squash on every scratch */
function email(): Preset {
  const L = 2800;
  const m = new Motion(L);
  // two bursts of scratching; between them the hand rests up there while it thinks
  const burst = (t: number) => Math.max(bump(t, 380, 120, 1320, 160), bump(t, 1760, 120, 2440, 160));
  const stroke = (t: number) => Math.sin(TAU * (t / 170));
  const breath = wave(L, 1, 0.014);
  const think = spline([[0, 0], [1300, 0], [1600, 1], [2400, 1], [2700, 0], [2800, 0]], L);
  // the hand rides the curve of the head: along its edge (tangent) and pressing in on each stroke
  const tan = V(0.84, 0.54);
  puppet(m, {
    squash: (t) => 1 + breath(t) - 0.018 * burst(t) * (0.5 + 0.5 * stroke(t - 25)),
    lean: (t) => -1.6 + 0.6 * Math.sin(TAU * t / L),
    tilt: (t) => -7 + 1.8 * think(t) + 0.9 * burst(t) * Math.sin(TAU * ((t - 40) / 170)),
    headY: (t) => 1.4 * burst(t) * (0.5 + 0.5 * stroke(t - 50)),
    yaw: (t) => -16 + 26 * think(t),
    pitch: (t) => -13 - 2 * think(t),
    open: blinks([1480]),
    eyeSY: (t) => 1 - 0.05 * think(t),
    handR: (t) => {
      const k = 9 * burst(t) * stroke(t), press = 3 * burst(t) * stroke(t) ** 2;
      return V(80 + tan.x * k - 0.54 * press, -118 + tan.y * k + 0.84 * press + 2 * Math.sin(TAU * t / L));
    },
    shoulderR: () => V(126, 12), slackR: 1.3, bendR: () => 1,
    mittens: 'R',
    handL: hanging(-1, L, wave(L, 1, 1), 120),
  });
  return preset('p_sailors_email', 'Thinking Scratch', 'Sailors · forgot-password/email: scratches its head, thinking, eyes up (loops)', m);
}

/** code: holding an envelope up, peeking at it, then up at you, hopeful — two little bounces */
function code(): Preset {
  const L = 2400;
  const m = new Motion(L);
  const bounce = (t: number) => Math.sin(Math.PI * (2 * t / L)) ** 2;
  const look = spline([[0, 0], [700, 0], [1000, 1], [1850, 1], [2150, 0], [2400, 0]], L);
  const wob = lag((t: number) => 3.2 * Math.sin(TAU * (2 * t / L) - 0.6), 70, L);
  // raised to the face: the eyes peek over its top edge, and it lifts a little when they look up
  const held = (t: number) => V(0, 64 - 10 * look(t) - 3 * bounce(t - 60));
  puppet(m, {
    squash: (t) => 1 + 0.035 * Math.sin(TAU * (2 * t / L)),
    y: (t) => -7 * bounce(t),
    pitch: (t) => 6 - 13 * look(t),
    yaw: (t) => 3 * Math.sin(TAU * t / L),
    tilt: (t) => -4 * look(t) + 2.5 * Math.sin(TAU * (2 * t / L) - 0.9),
    headY: lag((t: number) => 2.5 * Math.sin(TAU * (2 * t / L)), 60, L),
    open: blinks([1420]),
    eyeSY: (t) => 1 + 0.1 * look(t),
    eyeSX: (t) => 1 + 0.06 * look(t),
    front: true,
    handL: (t) => { const c = held(t), r = (wob(t) * Math.PI) / 180; return V(c.x - 54 * Math.cos(r) - 6 * Math.sin(r), c.y + 6 - 54 * Math.sin(r)); },
    handR: (t) => { const c = held(t), r = (wob(t) * Math.PI) / 180; return V(c.x + 54 * Math.cos(r) - 6 * Math.sin(r), c.y + 6 + 54 * Math.sin(r)); },
  });
  m.add(prop("envelope", "Envelope", ENVELOPE, 0, 64, 112, 78, 5));
  m.at('envelope', held).set('envelope', 'transform.rotation', wob);
  return preset('p_sailors_code', 'Waiting for Mail', 'Sailors · forgot-password/code: holds an envelope up, peeks, hopeful bounce (loops)', m);
}

/** password: hands over its eyes, swaying — one hand lifts for a peek and drops back */
function password(): Preset {
  const L = 3000;
  const m = new Motion(L);
  const sway = wave(L, 1, 1);
  const peek = (t: number) => bump(t, 1250, 360, 2150, 220);
  const settle = (t: number) => (t > 2150 && t < 2600 ? Math.sin(((t - 2150) / 450) * Math.PI) * Math.exp(-(t - 2150) / 180) : 0);
  puppet(m, {
    squash: (t) => 1 + wave(L, 2, 0.016)(t) - 0.025 * settle(t) * 3,
    x: (t) => 4 * sway(t),
    lean: (t) => 2.8 * sway(t),
    tilt: lag((t: number) => -3 * sway(t) + 4 * peek(t), 100, L),
    pitch: (t) => 7 - 4 * peek(t),
    front: true, mittens: 'both',
    handL: lag((t: number) => V(-52 + 1.5 * sway(t), -10 + 1.5 * Math.sin(TAU * 2 * t / L)), 60, L),
    handR: lag((t: number) => V(54 + 1.5 * sway(t) + 10 * peek(t), -10 - 32 * peek(t) + 1.5 * Math.sin(TAU * 2 * t / L) + 6 * settle(t)), 60, L),
    openR: blinks([1760], 60, 30, 100),
  });
  // the peeking eye glances out while the hand is up
  m.set('eyeR', 'surface.yaw', (t) => 6 * bump(t, 1450, 160, 2050, 120));
  return preset('p_sailors_password', 'Covering Eyes', 'Sailors · forgot-password/password: hands over eyes, sways, a tempted peek (loops)', m);
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────
/** neutral: the first thing anyone sees — breathing, a little sway, a glance and a blink */
function neutral(): Preset {
  const L = 3000;
  const m = new Motion(L);
  const breath = wave(L, 2, 0.022);
  const sway = wave(L, 1, 1);
  puppet(m, {
    squash: (t) => 1 + breath(t),
    x: (t) => 2.5 * sway(t),
    lean: (t) => 1.4 * sway(t),
    headY: lag((t: number) => -2.2 * Math.sin(TAU * (2 * t / L)), 70, L),
    tilt: lag((t: number) => -2.4 * sway(t), 120, L),
    yaw: spline([[0, 0], [700, 0], [1100, 7], [1900, 7], [2350, 0], [3000, 0]], L),
    pitch: spline([[0, 0], [1100, -3], [1900, -3], [2350, 0], [3000, 0]], L),
    open: blinks([760, 2480]),
    handL: lag((t: number) => V(-HAND_REST.x - 4 * sway(t) + 120 * breath(t), HAND_REST.y - 3 * Math.sin(TAU * (2 * t / L))), 90, L),
    handR: lag((t: number) => V(HAND_REST.x - 4 * sway(t) - 120 * breath(t), HAND_REST.y - 3 * Math.sin(TAU * (2 * t / L))), 140, L),
  });
  return preset('p_sailors_neutral', 'Friendly Idle', 'Sailors · home/neutral: calm breathing, sway, a glance and a blink (loops)', m);
}

/** sad: slumped, heavy slow breaths, a sigh every loop, eyes downturned arcs */
function sad(): Preset {
  const L = 3600;
  const m = new Motion(L);
  // breathe in (a little taller) … and let it all out (the sigh), then slowly back
  const sigh = spline([[0, 0], [900, 0.25], [1500, 1], [2250, -1.25], [3000, -0.35], [3600, 0]], L);
  const drift = wave(L, 1, 1);
  puppet(m, {
    squash: (t) => 0.965 + 0.022 * sigh(t),
    widen: (t) => 1.015 - 0.008 * sigh(t),
    x: (t) => 2 * drift(t),
    lean: (t) => -1.2 + 1 * drift(t),
    headY: lag((t: number) => 5 - 3 * sigh(t), 110, L),
    tilt: lag((t: number) => -5 + 1.5 * drift(t) - 1 * sigh(t), 150, L),
    pitch: (t) => 12 - 3 * sigh(t),
    yaw: (t) => -3 + 2 * drift(t),
    arcs: 'sad', arcSY: (t) => 1 - 0.1 * bump(t, 1500, 250, 2400, 400),
    handL: lag((t: number) => V(-146 + 2 * drift(t), 132 - 6 * sigh(t)), 160, L),
    handR: lag((t: number) => V(146 + 2 * drift(t), 132 - 6 * sigh(t)), 220, L),
    shoulderL: lag((t: number) => V(-116, 58 - 5 * sigh(t)), 80, L),
    shoulderR: lag((t: number) => V(116, 58 - 5 * sigh(t)), 80, L),
  });
  return preset('p_sailors_sad', 'Streak Broken', 'Sailors · home/sad: slumped, slow heavy breaths and a sigh (loops)', m);
}

/** peek: rises from below the card, looks left, looks right, sinks back — bold at 100pt */
function peek(): Preset {
  const L = 3200;
  const m = new Motion(L);
  const lowY = 150;
  const y = spline([[0, lowY], [180, lowY], [560, -10], [700, 5], [830, 0], [2480, 0], [2640, -8], [3020, lowY], [3200, lowY]], L);
  const vy = (t: number) => (y(t + 8) - y(t - 8)) / 16;
  const look = spline([[0, 0], [1000, 0], [1220, -1], [1580, -1], [1860, 1], [2220, 1], [2420, 0], [3200, 0]], L);
  puppet(m, {
    plant: () => 0,
    y,
    // stretched along a fast move, squashed where it stops
    squash: (t) => 1 + sat(sabs(vy(t)) * 0.16, 0.12) - 0.07 * bump(t, 600, 90, 820, 140),
    lean: (t) => 5 * look(t),
    tilt: lag((t: number) => 8 * look(t), 90, L),
    yaw: lag((t: number) => 28 * look(t), 40, L),
    pitch: () => -4,
    headY: lag((t: number) => -sat(vy(t) * 9, 8), 60, L),
    open: blinks([1690, 2320], 60, 30, 100),
    eyeSY: (t) => 1 + 0.12 * bump(t, 700, 250, 2450, 250),
    eyeSX: (t) => 1 + 0.08 * bump(t, 700, 250, 2450, 250),
    handL: lag((t: number) => V(-156 - 6 * look(t), 104 - sat(vy(t) * 16, 18)), 90, L),
    handR: lag((t: number) => V(156 - 6 * look(t), 104 - sat(vy(t) * 16, 18)), 130, L),
    footL: (t) => ({ x: 0, y: -4 * sat(sabs(vy(t)) * 2, 1), angle: -12 * sat(sabs(vy(t)) * 2, 1) }),
    footR: (t) => ({ x: 0, y: -4 * sat(sabs(vy(t)) * 2, 1), angle: -12 * sat(sabs(vy(t)) * 2, 1) }),
  });
  return preset('p_sailors_peek', 'Card Peek', 'Sailors · home/peek: rises from below, looks left and right, sinks back (loops)', m);
}

// ── Practice complete ────────────────────────────────────────────────────────────────────────
/** celebrate: two big hops with both arms up, then a proud wiggle — happy arc eyes */
function celebrate(): Preset {
  const L = 2400;
  const m = new Motion(L);
  // lift: crouch → up → land → crouch → up (lower) → land → wiggle
  // the canvas leaves ~70px over the head, so the hops are sized to it (the stretch is spent low)
  const y = spline([[0, 0], [110, 5], [250, -22], [410, -54], [460, -56], [620, -6], [670, 0], [760, 4], [880, -18], [1020, -40], [1070, -41], [1220, -5], [1270, 0], [2400, 0]], L);
  const air = (t: number) => io((-y(t) - 4) / 14);
  const sq = spline([[0, 1], [110, 0.86], [210, 1.14], [320, 1.07], [440, 1.0], [590, 1.04], [670, 0.84], [750, 0.9], [850, 1.1], [960, 1.04], [1060, 1.0], [1180, 1.03], [1270, 0.87], [1360, 1.05], [1450, 0.98], [1540, 1.0], [2400, 1]], L);
  const wig = (t: number) => bump(t, 1450, 160, 2250, 150) * Math.sin(TAU * ((t - 1450) / 270));
  const up = (t: number) => bump(t, 60, 180, 2200, 200);
  const landDip = (t: number) => bump(t, 640, 70, 880, 150) + 0.8 * bump(t, 1240, 70, 1480, 160);
  const hand = (side: -1 | 1, delay: number) => lag((t: number) => {
    const u = up(t);
    const hx = side * (170 - 30 * landDip(t)) + 10 * wig(t - 30), hy = -104 + 26 * landDip(t) - 6 * Math.sin(TAU * t / 270) * bump(t, 1450, 160, 2250, 150);
    return swing(V(114 * side, 20), rest(side), V(hx, hy), u);
  }, delay, L);
  puppet(m, {
    y, squash: sq, plant: (t) => 1 - air(t),
    x: (t) => 9 * wig(t),
    lean: (t) => 8 * wig(t),
    tilt: lag((t: number) => -6 * wig(t), 70, L),
    headY: lag((t: number) => 10 * landDip(t) - 4 * air(t), 40, L),
    arcs: 'happy', arcSY: (t) => 1 - 0.18 * landDip(t),
    pitch: () => -4,
    handL: hand(-1, 50), handR: hand(1, 80),
    shoulderL: () => V(-114, 20), shoulderR: () => V(114, 20),
    bendL: () => -1, bendR: () => 1,
    footL: (t) => ({ x: -6 * air(t), y: -8 * air(t), angle: -18 * air(t) }),
    footR: (t) => ({ x: 6 * air(t), y: -8 * air(t), angle: -18 * air(t) }),
  });
  return preset('p_sailors_celebrate', 'Victory Bounce', 'Sailors · practice-complete/celebrate: two hops, arms up, a proud wiggle (loops)', m);
}

// ── Saved (empty) ────────────────────────────────────────────────────────────────────────────
/** empty: hugging a flat, empty bookmark — looks down at it, then up, hopeful */
function empty(): Preset {
  const L = 3200;
  const m = new Motion(L);
  const up = spline([[0, 0], [1250, 0], [1650, 1], [2550, 1], [2950, 0], [3200, 0]], L);
  const hug = (t: number) => bump(t, 420, 180, 900, 320);
  const bm = (t: number) => V(0, 88 - 4 * up(t) + 2 * hug(t));
  puppet(m, {
    squash: (t) => 1 + wave(L, 2, 0.012)(t) - 0.03 * hug(t) + 0.018 * up(t),
    widen: (t) => 1 + 0.012 * hug(t),
    lean: (t) => 1.5 * Math.sin(TAU * t / L),
    pitch: (t) => 8 - 16 * up(t),
    tilt: lag((t: number) => 5 - 9 * up(t), 110, L),
    headY: lag((t: number) => 4 * hug(t), 60, L),
    open: (t) => blinks([2080])(t) * (1 - 0.35 * hug(t)),
    eyeSY: (t) => 1 + 0.1 * up(t),
    front: true,
    // a hand on each side of it, pressed in (and the ribbon with them) on the squeeze
    handL: lag((t: number) => { const c = bm(t); return V(c.x - 40 + 6 * hug(t), c.y + 2); }, 50, L),
    handR: lag((t: number) => { const c = bm(t); return V(c.x + 40 - 6 * hug(t), c.y + 12); }, 90, L),
  });
  m.add(prop('bookmark', 'Empty bookmark', BOOKMARK, 0, 88, 78, 115, 5));
  m.at('bookmark', bm).set('bookmark', 'transform.rotation', (t) => -8 + 3 * up(t));
  m.scale('bookmark', (t) => 1 - 0.08 * hug(t), (t) => 1 + 0.03 * hug(t));
  return preset('p_sailors_empty', 'Empty Bookmark Hug', 'Sailors · saved/empty: hugs an empty bookmark, looks up hopefully (loops)', m);
}

/** pointBack: turned to the top left, pointing there — "this way!" with a double bounce */
function pointBack(): Preset {
  const L = 2200;
  const m = new Motion(L);
  // two quick bounces on the toes, then it holds the point
  const b = (t: number) => bump(t, 180, 90, 400, 120) + bump(t, 470, 90, 700, 140);
  const dip = (t: number) => bump(t, 120, 60, 240, 90) + bump(t, 420, 50, 520, 80);
  const dir = V(-0.62, -0.78);
  puppet(m, {
    y: (t) => -10 * b(t),
    squash: (t) => 1 + 0.06 * b(t) - 0.08 * dip(t) + wave(L, 1, 0.01)(t),
    lean: (t) => -7 - 2 * b(t) + 0.8 * Math.sin(TAU * t / L),
    tilt: lag((t: number) => -6 - 2 * b(t), 60, L),
    yaw: () => -24,
    pitch: (t) => -12 - 2 * b(t),
    eyeSY: (t) => 1.06 + 0.06 * b(t),
    open: blinks([1480]),
    headY: lag((t: number) => 5 * dip(t) - 3 * b(t), 40, L),
    shoulderL: () => V(-116, 22),
    handL: lag((t: number) => { const k = 14 * b(t) + 2 * Math.sin(TAU * t / L); return V(-172 + dir.x * k, -118 + dir.y * k); }, 40, L),
    slackL: 1.0, bendL: () => 1,
    handR: lag((t: number) => V(150 + 4 * b(t), 102 - 6 * b(t)), 110, L),
  });
  return preset('p_sailors_pointback', 'This Way!', 'Sailors · saved/pointBack: points to the top left with a double bounce (loops)', m);
}

// ── Today's practice ─────────────────────────────────────────────────────────────────────────
/** reading: an open book in both hands, eyes scanning line by line, a nod, one page turn */
function reading(): Preset {
  const L = 4200;
  const m = new Motion(L);
  // three lines: scan left → right, flick back with a small nod; then the page turns
  const lines = [[250, 950], [1150, 1850], [2050, 2750]];
  const scan = (t: number) => {
    for (let i = 0; i < lines.length; i++) {
      const [a, b] = lines[i];
      if (t >= a && t <= b) return -1 + 2 * io((t - a) / (b - a)) * 0.35 + 2 * ((t - a) / (b - a)) * 0.65;
      const back = lines[i + 1]?.[0];
      if (back !== undefined && t > b && t < back) return 1 - 2 * io((t - b) / (back - b));
    }
    if (t < lines[0][0]) return -1;
    // the turn: the eyes ride the page from right to left, then settle where the next line starts
    return spline([[2750, 1], [2950, 1], [3500, -1.15], [3750, -1], [4200, -1]])(t);
  };
  const nod = (t: number) => bump(t, 900, 110, 1200, 160) + bump(t, 1800, 110, 2100, 160) + 0.7 * bump(t, 2700, 120, 3000, 200);
  const turn = (t: number) => io((t - 2950) / 520);
  const lift = (t: number) => Math.sin(Math.PI * clamp01((t - 2950) / 520));
  const book = (t: number) => V(0, 116 - 2 * nod(t));
  puppet(m, {
    squash: (t) => 1 + wave(L, 2, 0.012)(t),
    lean: (t) => 1.2 * Math.sin(TAU * t / L),
    yaw: (t) => 13 * scan(t),
    pitch: (t) => 7 + 5 * nod(t),
    tilt: lag((t: number) => -2 * scan(t) + 1.5 * Math.sin(TAU * t / L), 120, L),
    headY: lag((t: number) => 3 * nod(t), 50, L),
    open: (t) => blinks([2040])(t) * 0.94,
    front: true,
    handL: lag((t: number) => { const c = book(t); return V(c.x - 88, c.y + 8); }, 40, L),
    handR: lag((t: number) => { const c = book(t); return V(c.x + 88 - 12 * lift(t), c.y + 8 - 12 * lift(t)); }, 40, L),
  });
  m.add(prop('book', 'Open book', BOOK, 0, 116, 184, 112, 4));
  m.add(prop('page', 'Turning page', PAGE, 46, 116, 88, 100, 6, 'face', { anchor: { x: -44, y: 0 }, shapePath: PAGE_FLAT }));
  m.at('book', book);
  m.at('page', (t) => { const c = book(t); return V(c.x + 46, c.y - 10 * lift(t)); });
  // over the spine and back down flat; while hidden again it slips back to the right for the next loop
  m.set('page', 'transform.scale.x', (t) => 1 - 2 * turn(t) + 2 * io((t - 3700) / 300));
  m.set('page', 'transform.scale.y', (t) => 1 + 0.08 * lift(t));
  m.set('page', 'opacity', (t) => bump(t, 2900, 50, 3520, 50));
  m.keys('page', 'shape.path', [[0, PAGE_FLAT], [2950, PAGE_FLAT], [3210, PAGE_BENT], [3470, PAGE_FLAT], [L, PAGE_FLAT]]);
  return preset('p_sailors_reading', 'Reading the Script', "Sailors · todays-practice/reading: reads line by line, nods, turns the page (loops)", m);
}

/** notReady: waiting patiently — a sleepy sway, a big slow blink, a small yawn and stretch */
function notReady(): Preset {
  const L = 4000;
  const m = new Motion(L);
  const sway = wave(L, 1, 1);
  const yawn = spline([[0, 0], [1850, 0], [2450, 1], [2800, 0.9], [3150, 0], [4000, 0]], L);
  const settle = (t: number) => bump(t, 3050, 200, 3600, 400);
  puppet(m, {
    squash: (t) => 1 + wave(L, 2, 0.014)(t) + 0.075 * yawn(t) - 0.045 * settle(t),
    widen: (t) => 1 - 0.02 * yawn(t) + 0.015 * settle(t),
    x: (t) => 5 * sway(t),
    lean: (t) => 3 * sway(t) * (1 - yawn(t)),
    tilt: lag((t: number) => -3.5 * sway(t), 180, L),
    pitch: (t) => 3 - 12 * yawn(t),
    headY: lag((t: number) => -3 * yawn(t) + 3 * settle(t), 80, L),
    open: (t) => 0.76 * blinks([700], 220, 260, 380)(t) * (1 - 0.9 * bump(t, 2050, 220, 2950, 260)),
    // the stretch: both arms up and out past the head, the left one leading
    handL: lag((t: number) => { const u = yawn(t), p = swing(V(-118, 46 - 36 * u), rest(-1), V(-188, -118), u); return V(p.x - 4 * sway(t), p.y); }, 90, L),
    handR: lag((t: number) => { const u = yawn(t), p = swing(V(118, 46 - 36 * u), rest(1), V(188, -118), u); return V(p.x - 4 * sway(t), p.y); }, 150, L),
    shoulderL: (t) => V(-118, 46 - 36 * yawn(t)), shoulderR: (t) => V(118, 46 - 36 * yawn(t)),
  });
  m.add(prop('yawn', 'Yawn', YAWN, 0, 56, 34, 41, 3));
  m.scale('yawn', (t) => 0.2 + 0.8 * bump(t, 2080, 300, 2950, 250), (t) => 0.1 + 0.9 * bump(t, 2080, 300, 2950, 250));
  m.set('yawn', 'opacity', (t) => bump(t, 2050, 90, 3000, 90));
  return preset('p_sailors_notready', 'Waiting Patiently', "Sailors · todays-practice/notReady: sleepy sway, slow blink, a small yawn (loops)", m);
}

// ── Streak restore scenes ────────────────────────────────────────────────────────────────────
/** the scene box (640×396): where the cream character stands and how big it is */
const SC = { scale: 0.7, x: -30, ground: 158 };
const heartAt = (t: number, breathe: F) => V(0, 76 + 3 * breathe(t));
/** the cream character holding the cracked heart to its chest */
function heartHolder(m: Motion, L: number, o: { breathe: F; sway: F; sad?: boolean; look?: F; pitch: F; open?: F; muted?: boolean; droop?: F; pat?: F;
  intact?: boolean; tremble?: F; eyeSY?: F; footR?: Puppet['footR'] }) {
  const d = o.droop ?? zero;
  const hp = (t: number) => heartAt(t, o.breathe);
  puppet(m, {
    scale: SC.scale, ground: V(SC.x, SC.ground),
    squash: (t) => 0.99 + 0.02 * o.breathe(t) - 0.03 * d(t) - 0.02 * (o.pat?.(t) ?? 0),
    widen: (t) => 1 + 0.012 * d(t),
    x: (t) => 3 * o.sway(t) + (o.tremble?.(t) ?? 0),
    lean: (t) => 2 * o.sway(t),
    tilt: lag((t: number) => -5 - 2 * o.sway(t) - 2 * d(t), 140, L),
    footR: o.footR,
    headY: lag((t: number) => 4 * d(t) - 2 * o.breathe(t), 90, L),
    yaw: o.look ?? (() => 0),
    pitch: o.pitch,
    ...(o.sad ? { arcs: 'sad' as const } : { open: o.open!, eyeSY: o.eyeSY ?? (() => 1.05) }),
    front: true,
    handL: (t) => { const c = hp(t); return V(c.x - 46, c.y + 4); },
    handR: (t) => { const c = hp(t); return V(c.x + 44, c.y - 6); },
  });
  const art = o.intact ? wholeHeart : o.muted ? crackedHeart('#c3a3a5', '#a88789', '#5a4c46') : crackedHeart(HEART, HEART_SHADE, S_INK);
  m.add(prop('heart', o.intact ? 'Heart' : 'Cracked heart', art, 0, 76, 104, 95, 5));
  m.at('heart', hp).set('heart', 'transform.rotation', (t) => -6 + 2 * o.sway(t));
}

/** the pink blob on the left with the hourglass on its head; sand trickling unless `empty` */
function hourglassBlob(m: Motion, L: number, o: { muted?: boolean; empty?: boolean } = {}) {
  const s = 0.42, x = -246;
  m.add(...castMember('pk.', 'Pink friend', o.muted ? hex('#d9c9cf') : FRIENDS.pink, s, x, SC.ground, -40));
  const br = wave(L, 2, 1);
  puppet(m, {
    prefix: 'pk.', scale: s, ground: V(x, SC.ground),
    squash: (t) => 1 + 0.02 * br(t), yaw: () => 16, pitch: () => o.empty ? 10 : 2,
    open: o.empty ? () => 0.7 : blinks([L * 0.55]),
    handL: lag((t: number) => V(-150, 112 - 3 * br(t)), 100, L), handR: lag((t: number) => V(150, 112 - 3 * br(t)), 140, L),
  });
  const glass = o.muted ? hourglass(false, '#eceff2', '#a89a8e', '#d4c3a3') : hourglass(!o.empty);
  m.add(prop('hourglass', 'Hourglass', glass, 0, -218, 118, 168, 1, 'pk.face'));
  m.set('hourglass', 'transform.rotation', (t) => 2 * Math.sin(TAU * (2 * t / L) - 0.8));
  if (o.empty) return;
  // grains falling through the neck: each one drops and fades, then the next — a loop of four
  for (let i = 0; i < 4; i++) {
    const gid = `grain${i + 1}`;
    m.add(prop(gid, 'Sand', SAND_GRAIN, 0, -218, 9, 9, 2, 'pk.face'));
    const per = L / 8, off = (i * per) / 4;
    const u = (t: number) => (((t - off) % per) + per) % per / per;
    m.at(gid, (t) => V(0, -222 + 50 * u(t) * u(t)));
    m.set(gid, 'opacity', (t) => Math.sin(Math.PI * u(t)) ** 0.6);
  }
}

/** ask: holding the cracked heart; friends crowd in from the right to comfort it */
function ask(): Preset {
  const L = 4000;
  const m = new Motion(L);
  const breathe = wave(L, 2, 1), sway = wave(L, 1, 1);
  // pats land at these times; the character dips a touch under each
  const pats = [1050, 1380, 2750, 3080];
  const pat = (t: number) => pats.reduce((s, p) => s + bump(t, p - 40, 60, p + 120, 100), 0);
  heartHolder(m, L, {
    breathe, sway, pat: lag(pat, 30, L),
    look: spline([[0, 0], [1500, 0], [1800, 16], [2600, 16], [2900, 0], [4000, 0]], L),
    pitch: spline([[0, 7], [1500, 7], [1800, 2], [2600, 2], [2900, 7], [4000, 7]], L),
    open: blinks([780, 3350]),
  });
  hourglassBlob(m, L);
  // three friends, nearest first: green pats its shoulder, yellow reaches out, purple frets
  const cream = framesOf({ scale: SC.scale, ground: V(SC.x, SC.ground), x: (t) => 3 * sway(t), lean: (t) => 2 * sway(t),
    squash: (t) => 0.99 + 0.02 * breathe(t) - 0.02 * lag(pat, 30, L)(t), tilt: lag((t: number) => -5 - 2 * sway(t), 140, L), headY: lag((t: number) => -2 * breathe(t), 90, L) });
  const friends: [string, string, ColorStop, number, number, number, number][] = [
    // each one a step further right and a step nearer the viewer, so every face shows
    ['f1.', 'Green friend', FRIENDS.green, 0.46, 128, -28, 0],
    ['f2.', 'Yellow friend', FRIENDS.yellow, 0.42, 208, -20, 0.37],
    ['f3.', 'Purple friend', FRIENDS.purple, 0.36, 266, -12, 0.71],
  ];
  friends.forEach(([pre, name, color, s, x, z, ph], i) => {
    m.add(...castMember(pre, name, color, s, x, SC.ground, z));
    const bob = (t: number) => Math.sin(TAU * ((2 + (i === 1 ? 1 : 0)) * t / L + ph));
    const cfg: Puppet = {
      prefix: pre, scale: s, ground: V(x, SC.ground),
      squash: (t) => 1 + 0.035 * bob(t), lean: (t) => -8 - 2 * bob(t) - (i === 0 ? 2 * pat(t) : 0),
      tilt: lag((t: number) => -6 - 2 * bob(t), 90, L), yaw: () => -13, pitch: () => 4,
      eyeSY: () => 1.08, open: blinks([(1300 + i * 900) % L, (3100 + i * 500) % L]),
      handR: lag((t: number) => V(150, 104 - 5 * bob(t)), 130, L),
    };
    const me = framesOf(cfg);
    if (i === 0) {
      // the pat lands on top of the character's shoulder, wherever its sway has taken it
      cfg.handL = (t) => { const w = cream.toWorld(t, V(98, -2 - 26 * pat(t))); return me.toFace(t, w); };
      cfg.slackL = 1.03;
    } else {
      cfg.handL = lag((t: number) => V(-128, 40 - 4 * bob(t)), 60, L);
      cfg.handR = lag((t: number) => V(128, 40 - 4 * bob(t)), 90, L);
    }
    puppet(m, cfg);
    // "!" popping above each friend in turn
    const bid = `bang${i + 1}`, at = 350 + i * 1100;
    m.add(prop(bid, '!', BANG, x + 4, SC.ground - (ANKLE_Y + 148) * s - 34, 16, 42, 3, null));
    const pop = (t: number) => { const u = (((t - at) % L) + L) % L; return u < 180 ? io(u / 180) * 1.18 : u < 300 ? 1.18 - 0.18 * io((u - 180) / 120) : u < 1250 ? 1 : u < 1450 ? 1 - io((u - 1250) / 200) : 0; };
    m.scale(bid, pop);
    m.set(bid, 'transform.rotation', (t) => 8 * Math.sin(TAU * 4 * (t - at) / L));
  });
  // the patting friend's arm reaches over the character, so it is drawn in front
  m.layers.find((n) => n.id === 'f1.armL')!.zIndex = 40;
  return preset('p_sailors_ask', 'Restore Your Streak?', 'Sailors · streak-restore/ask: a cracked heart, friends crowding in to comfort (loops)', m);
}

/** used: the same heart, alone, a calendar beside it — a page flutters; a slow, resigned sigh */
function used(): Preset {
  const L = 4000;
  const m = new Motion(L);
  const sigh = spline([[0, 0], [1400, 0.2], [1900, 0.6], [2600, -1], [3300, -0.3], [4000, 0]], L);
  const sway = wave(L, 1, 0.6);
  heartHolder(m, L, {
    breathe: (t) => 0.8 * sigh(t), sway, droop: (t) => splus(-sigh(t)),
    look: spline([[0, 0], [700, 0], [1050, 20], [1800, 20], [2150, 0], [4000, 0]], L),
    pitch: spline([[0, 8], [700, 8], [1050, 3], [1800, 3], [2150, 10], [4000, 8]], L),
    open: (t) => 0.82 * blinks([2300], 90, 60, 160)(t),
  });
  const cx = 152, h = 150;
  m.add(prop('calendar', 'Calendar', CALENDAR, cx, SC.ground + 17 * SC.scale - h / 2, 138, h, 1, null));
  m.add(prop('calSheet', 'Calendar page', CAL_SHEET, cx, SC.ground + 17 * SC.scale - h / 2 + 22, 116, 85, 2, null, { anchor: { x: 0, y: -42 } }));
  // the top page lifts in a breath of air — twice, the second smaller — and drops back
  const flutter = (t: number) => bump(t, 600, 260, 1500, 420) * (0.8 + 0.2 * Math.sin(TAU * t / 190)) + 0.5 * bump(t, 2700, 220, 3300, 380) * (0.8 + 0.2 * Math.sin(TAU * t / 170));
  m.set('calSheet', 'transform.scale.y', (t) => 1 - 0.32 * flutter(t));
  m.set('calSheet', 'transform.rotation', (t) => 4 * flutter(t) * Math.sin(TAU * t / 380));
  return preset('p_sailors_used', 'Restore Already Used', 'Sailors · streak-restore/used: alone with the heart, a calendar page flutters (loops)', m);
}

/** expired: the ask scene, muted — no friends, sad arcs, a very slow droop and recover */
function expired(): Preset {
  const L = 4000;
  const m = new Motion(L);
  const droop = spline([[0, 0], [1600, 0.9], [2300, 1], [3400, 0.15], [4000, 0]], L);
  heartHolder(m, L, {
    breathe: (t) => -0.6 * droop(t), sway: wave(L, 1, 0.5), sad: true, muted: true, droop,
    pitch: (t) => 3 + 4 * droop(t),
  });
  m.keys('body', 'color', [[0, hex('#dedad4')]]);
  for (const id of ['frontArmL', 'frontArmR', 'legL', 'legR', 'pk.armL', 'pk.armR', 'pk.legL', 'pk.legR']) m.keys(id, 'color', [[0, hex('#4a4750')]]);
  hourglassBlob(m, L, { muted: true, empty: true });
  return preset('p_sailors_expired', 'Streak Expired', 'Sailors · streak-restore/expired: muted, alone, a slow droop — a fresh start (loops)', m);
}

/** restored: marching in place, a flame held high in both hands, happy arcs */
function restored(): Preset {
  const L = 2000;
  const m = new Motion(L);
  const s = 0.72, ground = V(0, 190);
  const STEP = L / 4;
  // which foot is up and how high: left on steps 0 and 2, right on 1 and 3
  const lift = (t: number, first: number) => {
    const k = Math.floor(t / STEP), u = (t % STEP) / STEP;
    return k % 2 === first ? Math.sin(Math.PI * u) ** 2 : 0;
  };
  // the weight landing on each step: a smooth pulse, starting and ending at rest
  const contact = (t: number) => { const u = ((t % STEP) + STEP) % STEP; return u < 220 ? Math.sin(Math.PI * (u / 220)) ** 2 : 0; };
  const side = (t: number) => Math.sin(TAU * (t / (2 * STEP)) - Math.PI / 2 + 0.5);
  puppet(m, {
    scale: s, ground,
    y: (t) => -9 * Math.sin(Math.PI * (((t % STEP) + STEP) % STEP) / STEP) ** 2 + 5 * contact(t),
    squash: (t) => 1 - 0.07 * contact(t - 20) + 0.025 * Math.sin(Math.PI * (((t % STEP) + STEP) % STEP) / STEP) ** 2,
    x: (t) => 4 * side(t),
    lean: (t) => 2.6 * side(t),
    tilt: lag((t: number) => -3 * side(t), 80, L),
    headY: lag((t: number) => 5 * contact(t), 50, L),
    arcs: 'happy', pitch: () => -6,
    shoulderL: () => V(-108, -30), shoulderR: () => V(108, -30),
    handL: lag((t: number) => V(-40, -212 + 8 * contact(t)), 70, L),
    handR: lag((t: number) => V(40, -212 + 8 * contact(t)), 70, L),
    bendL: () => -1, bendR: () => 1,
    footL: (t) => ({ x: 0, y: -34 * lift(t, 0), angle: -14 * lift(t, 0) }),
    footR: (t) => ({ x: 0, y: -34 * lift(t, 1), angle: -14 * lift(t, 1) }),
  });
  const fl = lag((t: number) => V(0, -268 + 8 * contact(t)), 90, L);
  m.add(prop('flame', 'Flame', FLAME, 0, -268, 104, 143, 2), prop('flameCore', 'Flame core', FLAME_CORE, 0, -248, 50, 75, 3));
  const flick = (t: number) => 0.055 * Math.sin(TAU * (9 * t / L)) + 0.035 * Math.sin(TAU * (14 * t / L) + 1.3);
  m.at('flame', fl).at('flameCore', (t) => { const p = fl(t); return V(p.x + 2 * Math.sin(TAU * 6 * t / L), p.y + 22); });
  m.scale('flame', (t) => 1 - 0.5 * flick(t), (t) => 1 + flick(t));
  m.scale('flameCore', (t) => 1 - 0.6 * flick(t - 60), (t) => 1 + 1.4 * flick(t - 60));
  m.set('flame', 'transform.rotation', (t) => 3 * Math.sin(TAU * (5 * t / L)) - 2 * side(t - 120));
  m.set('flameCore', 'transform.rotation', (t) => 4 * Math.sin(TAU * (7 * t / L) + 0.7));
  // two sparks rising off the flame
  for (let i = 0; i < 2; i++) {
    const sid = `spark${i + 1}`, at = i * 1000;
    m.add(prop(sid, 'Spark', SPARK, 0, -330, 36, 36, 4));
    const u = (t: number) => ((((t - at) % L) + L) % L) / 1000;
    m.at(sid, (t) => V((i ? 1 : -1) * (30 + 30 * u(t)), -320 - 40 * u(t)));
    m.scale(sid, (t) => (u(t) < 1 ? Math.sin(Math.PI * u(t)) : 0));
    m.set(sid, 'transform.rotation', (t) => 160 * Math.min(1, u(t)));
  }
  return preset('p_sailors_restored', 'Streak Restored', 'Sailors · streak-restored/restored: marches in place, flame held high (loops)', m);
}

/** hi: the built-in "Hii!" (core/showcase.ts) as a Sailors state — its beats and its bubble,
 *  with the feet planted and the base arm: a dip, up past the head, two waves, back down */
function hi(): Preset {
  const L = 2200;
  const m = new Motion(L);
  const hand = path([[0, 160, 116], [140, 166, 128], [290, 214, 24], [420, 192, -114], [540, 178, -96], [720, 212, -104], [900, 158, -92],
    [1080, 212, -104], [1260, 160, -92], [1450, 192, -102], [1700, 216, 26], [1900, 160, 116], [2200, 160, 116]], L);
  const squint = (t: number) => bump(t, 300, 180, 1900, 300);
  const waving = (t: number) => bump(t, 420, 200, 1500, 300);
  puppet(m, {
    squash: spline([[0, 1], [180, 0.95], [400, 1.03], [620, 1], [2200, 1]], L),
    lean: lag(spline([[0, 0], [460, 4], [1450, 3], [1900, 0], [2200, 0]], L), 40, L),
    yaw: spline([[0, 0], [500, 8], [1600, 6], [2000, 0], [2200, 0]], L),
    tilt: lag((t: number) => 3 * waving(t) * Math.sin(TAU * (t - 540) / 360), 70, L),
    headY: lag((t: number) => 2 * waving(t) * Math.sin(TAU * (t - 540) / 180), 50, L),
    open: (t) => (1 - 0.58 * squint(t)) * blinks([1940])(t),
    eyeSX: (t) => 1 + 0.18 * squint(t),
    handR: hand, shoulderR: () => V(118, 30),
    handL: hanging(-1, L, wave(L, 1, 1), 120),
  });
  m.add(prop('hiBubble', 'Hi!', HI_BUBBLE, 176, -168, 104, 72, 6));
  m.scale('hiBubble', spline([[0, 0.7], [600, 0.7], [760, 1.12], [880, 0.97], [960, 1], [1600, 1], [1760, 0.8], [2200, 0.7]], L));
  m.set('hiBubble', 'opacity', (t) => bump(t, 600, 80, 1770, 170));
  m.set('hiBubble', 'transform.rotation', spline([[0, -10], [600, -10], [840, 2], [960, 0], [1600, 0], [1760, 6], [2200, -10]], L));
  return preset('p_sailors_hi', 'Hii! (Sailors)', 'Sailors · home/hi: the Hii! wave — up past the head, two waves, a "Hi!" bubble (loops)', m);
}

/** expiring: an alarm clock ticking down and ringing; it clutches the (still whole) heart, anxious */
function expiring(): Preset {
  const L = 4000;
  const m = new Motion(L);
  const ring = (t: number) => Math.max(bump(t, 1100, 80, 1750, 120), bump(t, 2900, 80, 3450, 120));
  const buzz = (t: number) => Math.sin(TAU * t / 100);
  const glance = spline([[0, 0], [1900, 0], [2150, 1], [2600, 1], [2850, 0], [4000, 0]], L);
  // an impatient foot, quiet while the alarm rings
  const tap = (t: number) => (1 - ring(t)) * Math.sin(TAU * 8 * t / L) ** 2;
  heartHolder(m, L, {
    intact: true, breathe: wave(L, 4, 1), sway: wave(L, 1, 0.4),
    tremble: (t) => 1.6 * ring(t) * buzz(t + 30) + 0.5 * Math.sin(TAU * 24 * t / L),
    look: (t) => -20 + 20 * glance(t), pitch: (t) => 4 - 4 * glance(t),
    eyeSY: (t) => 1.14 + 0.06 * ring(t), open: blinks([1960]),
    footR: (t) => ({ x: 0, y: 0, angle: 18 * tap(t) }),
  });
  const cx = -232, cy = SC.ground + 12 - 62;
  m.add(prop('clock', 'Alarm clock', ALARM, cx, cy, 120, 128, 1, null));
  m.add(prop('clockHour', 'Hour hand', clockHand(24, 11, S_INK), 0, 4, 20, 84, 2, 'clock'));
  m.add(prop('clockMinute', 'Minute hand', clockHand(38, 8, '#e8646b'), 0, 4, 20, 84, 3, 'clock'));
  m.add(prop('clockRing', 'Ringing', RING, cx, cy - 56, 150, 60, 4, null));
  m.at('clock', (t) => V(cx, cy - 3 * ring(t) * buzz(t) ** 2));
  m.set('clock', 'transform.rotation', (t) => 7 * ring(t) * buzz(t));
  // the minute hand ticks: holds, then snaps on with a little recoil — a whole turn a loop
  const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
  m.set('clockMinute', 'transform.rotation', (t) => { const k = Math.floor(t / 500), u = (t % 500) / 500; return 45 * (k + (u < 0.76 ? 0 : backOut((u - 0.76) / 0.24))); });
  m.set('clockHour', 'transform.rotation', (t) => -60 + 3 * ring(t) * buzz(t - 20));
  m.set('clockRing', 'opacity', (t) => ring(t) * (0.6 + 0.4 * buzz(t) ** 2));
  m.scale('clockRing', (t) => 1 + 0.08 * ring(t) * buzz(t - 25));
  // a bead of sweat runs down the side of its head, twice a loop
  const sweat = prop('sweat', 'Sweat', SWEAT, 104, -96, 22, 32, 7);
  sweat.stroke = { ...sweat.stroke!, width: 2.5 };
  m.add(sweat);
  const drip = (t: number) => ((t % 2000) + 2000) % 2000 / 1400;
  m.at('sweat', (t) => V(104 + 6 * io(drip(t)), -96 + 58 * io(drip(t))));
  m.set('sweat', 'opacity', (t) => bump(t % 2000, 0, 200, 1400, 250));
  return preset('p_sailors_expiring', 'Streak Expiring', 'Sailors · streak-restore/expiring: an alarm clock ticks and rings; it clutches its heart (loops)', m);
}

/** crying: wailing like 😭 — squeezed-shut eyes under sad brows, streams of tears, a wide open mouth, sobs */
function crying(id: string, name: string, color?: ColorStop): Preset {
  const L = 2400, SOB = 600;
  const m = new Motion(L);
  // each sob: a gulp of air (taller), then it collapses into the cry — never twice the same size
  const shape = spline([[0, 0], [90, 1], [230, -0.7], [600, 0]], SOB);
  const amp = (t: number) => 1 + 0.18 * Math.sin(TAU * t / L) + 0.08 * Math.sin(TAU * 3 * t / L + 1);
  const sob = (t: number) => shape(t) * amp(t);
  const tremble = (t: number) => Math.sin(TAU * 20 * t / L);
  const PITCH = -6;
  puppet(m, {
    squash: (t) => 1 + 0.045 * sob(t),
    widen: (t) => 1 - 0.012 * sob(t),
    x: (t) => 1.3 * tremble(t),
    lean: (t) => 1.5 * Math.sin(TAU * t / L),
    headY: lag((t: number) => -5 * sob(t), 50, L),
    tilt: lag((t: number) => 3 * Math.sin(TAU * t / L) + tremble(t), 90, L),
    pitch: () => PITCH,
    arcs: 'happy', arcSY: (t) => 0.85 - 0.12 * splus(sob(t)),
    handL: lag((t: number) => V(-170 - 2 * tremble(t), 92 - 14 * sob(t)), 70, L),
    handR: lag((t: number) => V(170 + 2 * tremble(t), 92 - 14 * sob(t)), 110, L),
    shoulderL: (t) => V(-118, 40 - 6 * sob(t)), shoulderR: (t) => V(118, 40 - 6 * sob(t)),
  });
  if (color) m.keys('body', 'color', [[0, color]]);
  const eyeY = R_BODY * Math.sin(((EYE_PITCH + PITCH) * Math.PI) / 180);
  for (const side of [-1, 1] as const) {
    const S = side < 0 ? 'L' : 'R';
    const x = R_BODY * Math.sin((side * EYE_YAW * Math.PI) / 180);
    const brow = prop(`brow${S}`, side < 0 ? 'Left brow' : 'Right brow', side < 0 ? BROW_L : BROW_R, x - side * 2, eyeY - 34, 50, 29, 3);
    brow.stroke = { ...brow.stroke!, width: 16 };
    m.add(brow);
    m.at(`brow${S}`, (t) => V(x - side * 2, eyeY - 34 + 4 * splus(sob(t))));
    m.add(prop(`stream${S}`, 'Tears', TEAR_STREAM, x, eyeY + 52, 30, 132, 1, 'face', { anchor: { x: 0, y: -66 } }));
    m.scale(`stream${S}`, (t) => 1 - 0.05 * sob(t - 40), (t) => 1 + 0.06 * sob(t - 40));
    // drops falling off the end of each stream
    for (let i = 0; i < 2; i++) {
      const did = `drop${S}${i + 1}`, off = i * SOB / 2 + (side < 0 ? 0 : 140);
      m.add(prop(did, 'Tear', TEAR, x, eyeY + 118, 16, 23, 5));
      const u = (t: number) => ((((t - off) % SOB) + SOB) % SOB) / SOB;
      m.at(did, (t) => V(x + side * 4 * u(t), eyeY + 118 + 100 * u(t) * u(t)));
      m.set(did, 'opacity', (t) => Math.sin(Math.PI * u(t)) ** 0.6);
    }
    // and a tear flung out on every sob
    const sid = `spurt${S}`;
    m.add(prop(sid, 'Tear', TEAR, x + side * 10, eyeY, 20, 29, 5));
    const v = (t: number) => ((((t - 60) % SOB) + SOB) % SOB) / 520;
    m.at(sid, (t) => { const u = Math.min(1, v(t)); return V(x + side * (12 + 110 * u), eyeY - 70 * u + 200 * u * u); });
    m.set(sid, 'opacity', (t) => (v(t) < 1 ? Math.sin(Math.PI * v(t)) ** 0.5 : 0));
    // the tip trails the flight
    m.set(sid, 'transform.rotation', (t) => { const u = Math.min(1, v(t)); return side * ((Math.atan2(-70 + 400 * u, 110) * 180) / Math.PI - 90); });
  }
  m.add(prop('wail', 'Open mouth', WAIL, 0, 62, 76, 61, 4));
  m.scale('wail', (t) => 1 - 0.06 * splus(sob(t)) + 0.02 * tremble(t), (t) => 0.9 + 0.2 * splus(sob(t)));
  return preset(id, name, 'Sailors · streak-broken: wailing like 😭 — tears streaming and flying, sobbing (loops)', m);
}
const CRY_COLORS: [string, ColorStop | undefined][] = [
  ['cream', undefined], ['pink', FRIENDS.pink], ['green', FRIENDS.green], ['blue', FRIENDS.blue],
  ['orange', FRIENDS.orange], ['yellow', FRIENDS.yellow], ['purple', FRIENDS.purple],
];
/** the crying state in every friend colour — the streak-broken project's states; only the cream one is in the library */
let variants: Preset[] | undefined;
function cryingVariants(): Preset[] {
  variants ??= CRY_COLORS.slice(1).map(([c, color]) => crying(`p_sailors_crying_${c}`, `Crying (${c})`, color));
  return structuredClone(variants);
}

/** Built once: sampling every state is not free, and every caller gets its own copy to change. */
let built: Preset[] | undefined;
export function sailorsPresets(): Preset[] {
  built ??= [email(), code(), password(), neutral(), sad(), peek(), hi(), celebrate(), empty(), pointBack(), reading(), notReady(), ask(), used(), expired(), expiring(), restored(),
    crying('p_sailors_crying', 'Crying (cream)')];
  return structuredClone(built);
}

// --- the Sailors projects -----------------------------------------------------------------------
export interface SailorsProjectSpec {
  name: string;
  composition: { width: number; height: number };
  /** timeline name (what the app asks for) → the preset that is that state */
  states: [string, string][];
}

export const SAILORS_PROJECTS: SailorsProjectSpec[] = [
  { name: 'forgot-password', composition: { width: 512, height: 512 }, states: [['email', 'p_sailors_email'], ['code', 'p_sailors_code'], ['password', 'p_sailors_password']] },
  { name: 'home', composition: { width: 512, height: 512 }, states: [['neutral', 'p_sailors_neutral'], ['sad', 'p_sailors_sad'], ['peek', 'p_sailors_peek'], ['hi', 'p_sailors_hi']] },
  { name: 'practice-complete', composition: { width: 512, height: 512 }, states: [['celebrate', 'p_sailors_celebrate']] },
  { name: 'saved-empty', composition: { width: 512, height: 512 }, states: [['empty', 'p_sailors_empty'], ['pointBack', 'p_sailors_pointback']] },
  { name: 'todays-practice', composition: { width: 512, height: 512 }, states: [['reading', 'p_sailors_reading'], ['notReady', 'p_sailors_notready']] },
  { name: 'streak-restore', composition: { width: 640, height: 396 }, states: [['ask', 'p_sailors_ask'], ['used', 'p_sailors_used'], ['expired', 'p_sailors_expired'], ['expiring', 'p_sailors_expiring']] },
  { name: 'streak-restored', composition: { width: 600, height: 468 }, states: [['restored', 'p_sailors_restored']] },
  // the same cry in every colour, so the app picks the character's colour by state
  { name: 'streak-broken', composition: { width: 512, height: 512 }, states: CRY_COLORS.map(([c]) => [c, c === 'cream' ? 'p_sailors_crying' : `p_sailors_crying_${c}`]) },
];

/**
 * One Sailors project: a timeline per state, each with its own layers (the character plus
 * whatever that state holds), and a dotLottie state machine named after the project with one
 * String input, `state`, whose values are the timeline names.
 */
export function sailorsProject(spec: SailorsProjectSpec, library: Preset[] = [...sailorsPresets(), ...cryingVariants()]): Project {
  const p = defaultProject();
  const timelines: Timeline[] = spec.states.map(([name, presetId]) => {
    const preset = library.find((x) => x.id === presetId);
    if (!preset) throw new Error(`no preset ${presetId}`);
    const rig = sailorRig();
    addPresetLayers(rig, preset);
    return {
      id: uid('tl'), name, rig, tracks: structuredClone(preset.tracks), modifiers: [], blocks: [],
      emitters: (preset.emitters ?? []).map((e) => ({ ...structuredClone(e), id: uid('e') })),
      appearances: (preset.appearances ?? []).map((a) => openEnded({ ...a, id: uid('ap') }, preset.durationMs)),
      durationMode: 'custom', timelineDurationMs: preset.durationMs, durationOverrideMs: preset.durationMs, loop: true,
    };
  });
  const [first] = timelines;
  const rig = first.rig!;
  delete first.rig;
  return {
    ...p, name: spec.name, rig, timelines, activeTimelineId: first.id, fps: FPS,
    composition: { ...spec.composition },
    stateMachine: {
      id: spec.name, initialStateId: first.id,
      inputs: [{ name: 'state', type: 'String', value: spec.states[0][0], description: `one of: ${spec.states.map((s) => s[0]).join(', ')}` }],
      transitions: timelines.map((tl) => ({
        id: uid('sm'), from: ANY_STATE, to: tl.id, conditions: [{ input: 'state', operator: 'Equal', value: tl.name }], durationMs: 250,
      })),
    },
  };
}
