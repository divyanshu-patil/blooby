import { makeCurveLayer, makeShapeLayer } from './layers';
import { art, both, flat, k, limb, looped, point, tr, type E } from './showcase';
import type { Appearance, ColorStop, Emitter, EmitterPart, Keyframe, Modifier, Preset, RigNode, Track } from './types';

/**
 * The app mascot kit: every state an app's screens ask a mascot for — generating, failed,
 * cancelled, completed, dealing cards, a hero wave and idle, floating on a cloud, empty states,
 * errors, celebrations and small reactions — each one a preset named after the `.lottie` it
 * belongs in and the state it plays there (see `KIT_ASSETS`).
 *
 * Built for shipping, so built only from what a .lottie carries: layers, keyframes, modifiers
 * and particles, no filter effects (a test bakes each one and checks nothing was lost).
 *
 * The craft rules they all keep (copilot/craft.ts): anticipation before every big move, ~10%
 * overshoot, 40–120ms of overlap between the body, the face and the hands, holds long enough to
 * read, and loops whose every track starts and ends on the same value AND the same velocity —
 * loops are written as sines (`sine`), keyed at crossings and peaks, so there is no hitch at the
 * seam. The hands are the rubber-hose arms (`armL`/`armR`, reused if the mascot has them); where
 * a hand has to be IN FRONT of the body (covering eyes, clapping, hugging) a mitten layer rides
 * exactly on the hand, because limbs tuck behind the body.
 */

// --- palette and art ------------------------------------------------------------------------
export const INK = '#141318';
export const MAGNIFIER = `<svg viewBox="0 0 100 100">
  <circle cx="40" cy="40" r="26" fill="#dff2ff" fill-opacity="0.55" stroke="${INK}" stroke-width="9"/>
  <path d="M59 59 L86 86" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
  <path d="M28 30 A14 14 0 0 1 40 22" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>`;
export const EMPTY_DECK = `<svg viewBox="0 0 120 150">
  <rect x="22" y="6" width="90" height="124" rx="12" fill="#e9e3d7" stroke="${INK}" stroke-width="5"/>
  <rect x="8" y="18" width="90" height="124" rx="12" fill="#ffffff" stroke="${INK}" stroke-width="5"/>
  <path d="M30 60 H76 M30 78 H62" stroke="#c9c1b1" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 13"/>
</svg>`;
export const BOOKMARK = `<svg viewBox="0 0 80 110">
  <path d="M10 10 A8 8 0 0 1 18 2 H62 A8 8 0 0 1 70 10 V104 L40 80 L10 104 Z" fill="#8ec5ff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
</svg>`;
export const QUESTION = `<svg viewBox="0 0 60 90">
  <path d="M12 24 A18 18 0 1 1 38 40 C31 45 30 49 30 58" stroke="${INK}" stroke-width="10" stroke-linecap="round" fill="none"/>
  <circle cx="30" cy="78" r="6.5" fill="${INK}"/>
</svg>`;
const rgb = (r: number, g: number, b: number, a = 1): ColorStop => ({ r, g, b, a });
const PINK = rgb(242, 155, 184), YELLOW = rgb(247, 201, 72), SKY = rgb(142, 197, 255), CORAL = rgb(232, 88, 74);
const PAPER = '#fffdf6', BONE = '#f2efe9';

const NOTEPAD = `<svg viewBox="0 0 120 140">
  <rect x="6" y="10" width="108" height="124" rx="10" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  <path d="M26 12 V2 M48 12 V2 M70 12 V2 M92 12 V2" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M18 34 H102" stroke="#f29bb8" stroke-width="3"/>
</svg>`;
const PENCIL = `<svg viewBox="0 0 24 110">
  <rect x="3" y="3" width="18" height="13" rx="3" fill="#f29bb8" stroke="${INK}" stroke-width="3"/>
  <rect x="3" y="16" width="18" height="66" fill="#f7c948" stroke="${INK}" stroke-width="3"/>
  <path d="M3 82 L12 106 L21 82 Z" fill="#f3d9b1" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M9 98 L12 106 L15 98 Z" fill="${INK}"/>
</svg>`;
const PENCIL_TOP = `<svg viewBox="0 0 24 56">
  <rect x="3" y="3" width="18" height="13" rx="3" fill="#f29bb8" stroke="${INK}" stroke-width="3"/>
  <path d="M3 16 H21 V48 L16 54 L12 47 L7 53 L3 47 Z" fill="#f7c948" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
const PENCIL_TIP = `<svg viewBox="0 0 24 56">
  <path d="M3 8 L7 2 L12 9 L16 3 L21 8 V28 H3 Z" fill="#f7c948" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M3 28 L12 52 L21 28 Z" fill="#f3d9b1" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M9 44 L12 52 L15 44 Z" fill="${INK}"/>
</svg>`;
const BUBBLE = `<svg viewBox="0 0 120 110">
  <circle cx="16" cy="100" r="6" fill="#ffffff" stroke="${INK}" stroke-width="4"/>
  <circle cx="32" cy="82" r="9" fill="#ffffff" stroke="${INK}" stroke-width="4"/>
  <path d="M42 40 C32 20 60 4 72 16 C84 2 112 14 104 34 C120 44 110 70 92 66 C86 80 60 80 54 68 C36 70 28 52 42 40 Z" fill="#ffffff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const SQUIGGLE = `<svg viewBox="0 0 60 60">
  <path d="M12 30 C12 14 30 10 36 22 C42 34 26 42 22 32 C18 20 44 12 48 30 C52 46 30 52 22 44" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
</svg>`;
const SPARKLE = `<svg viewBox="0 0 40 40">
  <path d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2 Z" fill="#f7c948" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
const HEART = `<svg viewBox="0 0 40 36">
  <path d="M20 33 C4 22 0 14 4 8 C8 2 16 2 20 10 C24 2 32 2 36 8 C40 14 36 22 20 33 Z" fill="#f29bb8" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
const CARD_BACK = `<svg viewBox="0 0 70 96">
  <rect x="3" y="3" width="64" height="90" rx="9" fill="#2233e0" stroke="${INK}" stroke-width="5"/>
  <rect x="12" y="12" width="46" height="72" rx="5" fill="none" stroke="#8ec5ff" stroke-width="3"/>
  <path d="M35 34 L44 48 L35 62 L26 48 Z" fill="#8ec5ff"/>
</svg>`;
const cardFront = (dot: string) => `<svg viewBox="0 0 70 96">
  <rect x="3" y="3" width="64" height="90" rx="9" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  <path d="M16 24 H54 M16 38 H44" stroke="#c9c1b1" stroke-width="5" stroke-linecap="round"/>
  <circle cx="35" cy="66" r="13" fill="${dot}" stroke="${INK}" stroke-width="3"/>
</svg>`;
const CLOUD = `<svg viewBox="0 0 360 150">
  <path d="M40 124 C6 124 6 78 44 74 C40 34 98 22 118 54 C138 12 208 12 224 54 C252 26 310 40 302 82 C348 82 352 126 316 128 Z" fill="#ffffff" stroke="#c3d2e6" stroke-width="7" stroke-linejoin="round"/>
  <path d="M74 106 C124 118 240 118 290 106" stroke="#dbe6f3" stroke-width="7" stroke-linecap="round" fill="none"/>
</svg>`;
const PUFF = `<svg viewBox="0 0 120 60">
  <path d="M18 52 C2 52 2 30 20 30 C20 12 46 6 56 22 C66 6 98 12 96 32 C114 32 116 52 100 52 Z" fill="#ffffff" stroke="#c3d2e6" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const CROWN = `<svg viewBox="0 0 90 64">
  <path d="M8 56 L4 16 L26 34 L45 6 L64 34 L86 16 L82 56 Z" fill="#f7c948" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="45" cy="42" r="6" fill="#e8584a"/><circle cx="4" cy="16" r="4" fill="#f7c948" stroke="${INK}" stroke-width="3"/>
  <circle cx="86" cy="16" r="4" fill="#f7c948" stroke="${INK}" stroke-width="3"/><circle cx="45" cy="6" r="4" fill="#f7c948" stroke="${INK}" stroke-width="3"/>
</svg>`;
const PAGE = `<svg viewBox="0 0 380 110">
  <path d="M44 8 H336 L374 102 H6 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M62 30 H318" stroke="#e8e1d2" stroke-width="3"/><path d="M52 54 H328" stroke="#e8e1d2" stroke-width="3"/>
</svg>`;
const TELESCOPE = `<svg viewBox="0 0 150 60">
  <rect x="2" y="21" width="26" height="18" rx="4" fill="#8ec5ff" stroke="${INK}" stroke-width="4"/>
  <path d="M28 17 L96 9 V51 L28 43 Z" fill="#2233e0" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <rect x="96" y="4" width="50" height="52" rx="6" fill="#f7c948" stroke="${INK}" stroke-width="4"/>
  <path d="M60 18 V42" stroke="#8ec5ff" stroke-width="4" stroke-linecap="round"/>
</svg>`;
const PLUG = `<svg viewBox="0 0 70 60">
  <path d="M2 30 H20" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
  <rect x="18" y="12" width="34" height="36" rx="8" fill="#e9e3d7" stroke="${INK}" stroke-width="5"/>
  <path d="M52 22 H66 M52 38 H66" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
const SOCKET = `<svg viewBox="0 0 70 60">
  <path d="M68 30 H50" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
  <rect x="16" y="10" width="36" height="40" rx="8" fill="#e9e3d7" stroke="${INK}" stroke-width="5"/>
  <path d="M28 21 V27 M28 33 V39" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
</svg>`;
const STORM = `<svg viewBox="0 0 130 80">
  <path d="M22 70 C0 70 2 40 26 40 C26 16 60 8 70 30 C82 10 120 18 112 48 C132 50 130 76 108 76 Z" fill="#9aa4b5" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const BOLT = `<svg viewBox="0 0 40 60">
  <path d="M24 2 L6 34 H20 L14 58 L36 22 H22 Z" fill="#f7c948" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
</svg>`;
const MEGAPHONE = `<svg viewBox="0 0 110 80">
  <rect x="4" y="29" width="18" height="24" rx="4" fill="#e8584a" stroke="${INK}" stroke-width="4"/>
  <path d="M22 28 L92 6 V74 L22 54 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M92 6 C106 20 106 60 92 74" fill="#f7c948" stroke="${INK}" stroke-width="5"/>
  <path d="M34 56 L40 76 H52 L48 60" fill="#e8584a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
</svg>`;
const WAVES = `<svg viewBox="0 0 50 80">
  <path d="M8 27 C16 35 16 45 8 53 M22 15 C38 29 38 51 22 65 M36 4 C58 24 58 56 36 76" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
const PLANE = `<svg viewBox="0 0 100 70">
  <path d="M4 34 L96 4 L64 66 L46 44 Z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M96 4 L46 44 L42 62 L56 50" fill="#dff2ff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const THUMB = `<svg viewBox="0 0 70 80">
  <path d="M22 36 L30 10 C32 2 44 4 42 14 L40 30 H58 C66 30 68 38 64 44 C68 48 66 56 60 58 C64 62 60 70 54 70 C56 76 50 78 46 78 H24 C18 78 16 74 16 70 V42 C16 38 18 36 22 36 Z" fill="${BONE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <rect x="2" y="38" width="16" height="40" rx="5" fill="#2233e0" stroke="${INK}" stroke-width="5"/>
</svg>`;
const mitten = (thumbX: number) => `<svg viewBox="0 0 60 60">
  <ellipse cx="${thumbX}" cy="24" rx="9" ry="11" fill="${BONE}" stroke="${INK}" stroke-opacity="0.3" stroke-width="3"/>
  <circle cx="30" cy="33" r="23" fill="${BONE}" stroke="${INK}" stroke-opacity="0.3" stroke-width="3"/>
</svg>`;
const BLUSH = `<svg viewBox="0 0 40 20"><ellipse cx="20" cy="10" rx="18" ry="8" fill="#f29bb8"/></svg>`;
const DROP = `<svg viewBox="0 0 30 44">
  <path d="M15 2 C22 16 28 24 28 30 A13 13 0 0 1 2 30 C2 24 8 16 15 2 Z" fill="#8ec5ff" stroke="${INK}" stroke-width="3"/>
  <path d="M9 30 A6 6 0 0 0 14 36" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>
</svg>`;

// --- authoring helpers ------------------------------------------------------------------------
type P = [number, number, number, E?];
const on = (nodeId: string, startMs: number, endMs: number, fadeInMs = 140, fadeOutMs = 200): Omit<Appearance, 'id' | 'blockId'> =>
  ({ nodeId, startMs, endMs, fadeInMs, fadeOutMs });
const tk = (nodeId: string, property: string, keys: [number, number, E?][]): Track => tr(nodeId, property, keys.map(([t, v, e]) => k(t, v, e)));
const xy = (nodeId: string, keys: P[]): Track[] => [
  tr(nodeId, 'flatOffset.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'flatOffset.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
const squish = (nodeId: string, keys: P[]): Track[] => [
  tr(nodeId, 'squish.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'squish.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
const scaled = (nodeId: string, keys: [number, number, E?][]): Track[] => [tk(nodeId, 'transform.scale.x', keys), tk(nodeId, 'transform.scale.y', keys)];
/** a prop the face holds: it tilts and lags with the head, and so do the hands holding it */
const held = (x: number, y: number, w: number, h: number, zIndex = 30): Partial<RigNode> => ({ parentId: 'face', surface: flat(x, y), size: { x: w, y: h }, zIndex });
const onBody = (x: number, y: number, w: number, h: number, zIndex = 30): Partial<RigNode> => ({ parentId: 'body', surface: flat(x, y), size: { x: w, y: h }, zIndex });
const inWorld = (x: number, y: number, w: number, h: number, zIndex = 30): Partial<RigNode> => ({ parentId: null, surface: flat(x, y), size: { x: w, y: h }, zIndex });

/**
 * A sine as keys: a key at every crossing and peak, easing out of a crossing and into the next
 * one, which is a sine's own speed profile to within a few percent — and a loop made of whole
 * periods meets itself at the same value and speed. `quarter` starts it at a peak (1) instead.
 */
function sine(t0: number, period: number, amp: number, cycles: number, base = 0, quarter = 0): Keyframe[] {
  const out: Keyframe[] = [];
  for (let i = 0; i <= cycles * 4; i++) {
    const v = base + amp * [0, 1, 0, -1][(i + quarter) % 4];
    out.push(k(Math.round(t0 + (i * period) / 4), Math.round(v * 1000) / 1000, v === base ? 'easeOut' : 'easeIn'));
  }
  return out;
}

const SHOULDER = { L: [-118, 30], R: [118, 30] } as const;
const REST = { L: [-196, 96], R: [196, 96] } as const;
const ARM = 114;
/** a hand's path — its point and a length that reaches it, so the hose never falls short */
function hand(side: 'L' | 'R', keys: P[]): Track[] {
  const [sx, sy] = SHOULDER[side];
  return [
    ...point(`arm${side}`, 'b', keys),
    tr(`arm${side}`, 'limb.length', keys.map(([t, x, y, e]) => k(t, Math.max(ARM, Math.round(Math.hypot(x - sx, y - sy) * 1.08)), e))),
  ];
}
const rest = (side: 'L' | 'R', t: number, e: E = 'easeInOut'): P => [t, REST[side][0], REST[side][1], e];
/** a hand in FRONT of the body: the arm and a mitten on its end, moving as one */
const mittenHand = (side: 'L' | 'R', keys: P[]): Track[] => [...hand(side, keys), ...xy(`mitten${side}`, keys)];
const mittens = (): RigNode[] => [
  art('mittenL', 'Left mitten', mitten(48), held(-196, 96, 84, 84, 40)),
  art('mittenR', 'Right mitten', mitten(12), held(196, 96, 84, 84, 40)),
];
const arms = (): RigNode[] => [limb('arm', -1), limb('arm', 1)];
/** legs splayed out front — sitting on the floor with the body lowered by `drop` */
const sittingLegs = (drop: number): Track[] => [
  ...point('legL', 'b', [[0, -104, 176 - drop * 0.3]]), ...point('legL', 'c', [[0, -150, 226 - drop]]),
  ...point('legR', 'b', [[0, 104, 176 - drop * 0.3]]), ...point('legR', 'c', [[0, 150, 226 - drop]]),
  tk('legL', 'limb.foot.angle', [[0, -24]]), tk('legR', 'limb.foot.angle', [[0, 24]]),
];
const legs = (): RigNode[] => [limb('leg', -1), limb('leg', 1)];

const eyes = (property: string, keys: [number, number, E?][]): Track[] => both(property, keys.map(([t, v, e]) => k(t, v, e)));
/** happy eyes: squeezed to smiles and a little wider */
const happyEyes = (from: number, to: number, fade = 180): Track[] => [
  ...eyes('eye.openness', [[0, 1], [from, 1, 'easeOut'], [from + fade, 0.42], [to, 0.42, 'easeInOut'], [to + fade, 1]]),
  ...eyes('transform.scale.x', [[0, 1], [from, 1, 'easeOut'], [from + fade, 1.16, 'overshoot'], [to, 1.16, 'easeInOut'], [to + fade, 1]]),
];
const blinks = (at: number[], open = 1): Keyframe[] =>
  [k(0, open), ...at.flatMap((t) => [k(t, open, 'easeIn'), k(t + 70, 0.05, 'linear'), k(t + 110, 0.05, 'easeOut'), k(t + 210, open)])];

const follow = (amplitude = 55, frequency = 3.2): Omit<Modifier, 'id' | 'blockId'> => ({ nodeId: 'face', kind: 'follow', amount: 100, frequency, amplitude });
const PART = (id: string, shapeId: string, color: ColorStop, spin = 180, sizeScale = 1): EmitterPart => ({ id, shapeId, color, weight: 1, speed: 1, sizeScale, spin });
const burst = (over: Partial<Omit<Emitter, 'id' | 'blockId'>>): Omit<Emitter, 'id' | 'blockId'> => ({
  name: 'sparkles', glyphs: [], color: YELLOW, size: 18, path: 'burst', from: { nodeId: 'body', x: 0, y: -40 }, to: { nodeId: 'body', x: 0, y: -40 },
  bow: 0, rateMs: 100, lifeMs: 900, count: 12, fadeStart: 0.55, scaleFrom: 0.4, scaleTo: 1, spin: 120, wobble: 0, wobbleFrequency: 1,
  velocity: 420, velocityJitter: 0.45, angle: -90, spread: 170, drag: 2.6, gravity: 0, turbulence: 4, seed: 9,
  parts: [PART('sp', 'spark', YELLOW, 160), PART('sp2', 'spark', rgb(255, 255, 255), 220, 0.7)], ...over,
});
const confetti = (startMs: number, count = 48, over: Partial<Omit<Emitter, 'id' | 'blockId'>> = {}) => burst({
  name: 'confetti', size: 16, count, lifeMs: 2000, fadeStart: 0.75, scaleFrom: 1, scaleTo: 0.9, spin: 520, wobble: 16, wobbleFrequency: 2.2,
  velocity: 640, spread: 110, drag: 1.5, gravity: 1100, turbulence: 14, seed: 21, startMs, endMs: startMs + 2000,
  parts: [PART('cs', 'streamer', PINK, 400), PART('cc', 'chip', YELLOW, 520), PART('cu', 'curl', SKY, 300), PART('cb', 'chip', CORAL, 600)], ...over,
});
/** a sparkle that twinkles once: in with a turn, out again */
const twinkle = (id: string, at: number, dur = 700, peak = 1.1): Track[] => [
  ...scaled(id, [[at, 0, 'easeOut'], [at + dur * 0.35, peak, 'easeInOut'], [at + dur, 0, 'easeIn']]),
  tk(id, 'transform.rotation', [[at, -40, 'easeOut'], [at + dur, 50]]),
];
/** a continuous turn as keys under 180° apart (rotation takes the short way between keys) */
const turn = (t0: number, t1: number, degrees: number): Keyframe[] => {
  const steps = Math.max(2, Math.ceil(Math.abs(degrees) / 120));
  return Array.from({ length: steps + 1 }, (_, i) => k(t0 + ((t1 - t0) * i) / steps, (degrees * i) / steps, 'linear'));
};
/** body breathing: a slow squish that keeps volume, whole periods so it loops */
const breathe = (period: number, cycles: number, amp = 0.022, t0 = 0): Track[] => [
  tr('body', 'squish.y', sine(t0, period, amp, cycles, 1)),
  tr('body', 'squish.x', sine(t0, period, -amp * 0.8, cycles, 1)),
];

// the generating family shares its props, so moving between those states keeps them
const notepad = () => art('notepad', 'Notepad', NOTEPAD, held(-58, 92, 120, 140, 30));
const pencil = () => art('pencil', 'Pencil', PENCIL, held(40, 40, 24, 110, 32));
const scribbles = (): RigNode[] => [0, 1, 2].map((i) => {
  const y = 90 + i * 20;
  const c = makeCurveLayer([[-96, y], [-78, y - 5], [-62, y + 3], [-46, y - 4], [-30, y + 2], [-18, y - 3]].map(([x, yy]) => ({ x, y: yy })),
    { name: `Scribble ${i + 1}`, type: 'smooth', color: rgb(20, 19, 24), width: 3.5, parentId: 'face' })!;
  return { ...c, id: `scribble${i + 1}`, ranged: true, zIndex: 31, trim: { start: 0, end: 0 } };
});
/** where the pencil sits for its tip to be at (x, y): it leans 28°, its tip 50px down its length */
const PENCIL_LEAN = 28;
const WRITE_LOOP = 2400;
const pencilAt = (x: number, y: number): [number, number] => {
  const r = (PENCIL_LEAN * Math.PI) / 180;
  return [Math.round(x + 50 * Math.sin(r)), Math.round(y - 50 * Math.cos(r))];
};
/** the writing hand: a zigzag along each scribble line, the pencil and the right hand with it */
function writingMotion(t0: number, lines: number, lineMs = 700): Track[] {
  const tips: P[] = [];
  for (let l = 0; l < lines; l++) {
    const y = 90 + l * 20, s = t0 + l * lineMs;
    for (let j = 0; j <= 6; j++) tips.push([s + (j * lineMs) / 7, -96 + j * 13, y + (j % 2 ? -5 : 3), 'easeInOut']);
    if (l < lines - 1) tips.push([s + lineMs - 30, -20, y + 8, 'easeInOut']);
  }
  // then lifted back to where it started, so a loop has no jump
  const end = t0 + lines * lineMs;
  if (end < t0 + WRITE_LOOP) tips.push([end + 60, -60, 70, 'easeInOut'], [t0 + WRITE_LOOP, tips[0][1], tips[0][2]]);
  const pen = tips.map(([t, x, y, e]): P => [t, ...pencilAt(x, y), e]);
  return [...xy('pencil', pen), ...hand('R', pen.map(([t, x, y, e]): P => [Math.min(t + 30, t0 + WRITE_LOOP), x + 10, y + 14, e]))];
}

// --- the kit ----------------------------------------------------------------------------------
export function mascotKitPresets(): Preset[] {
  const all: Preset[] = [
    // ── watching.lottie ──────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_excited', name: 'Sparkle Excited', source: 'builtin', durationMs: 2000,
      tagline: 'watching.lottie · excited · a good brief: bounce, sparkle eyes, hands up',
      layers: [...arms(), art('sparkleA', 'Sparkle', SPARKLE, held(-150, -150, 40, 40)), art('sparkleB', 'Sparkle', SPARKLE, held(165, -120, 30, 30))],
      appearances: [on('armL', 0, 2000, 0, 0), on('armR', 0, 2000, 0, 0), on('sparkleA', 280, 1100, 0, 0), on('sparkleB', 420, 1300, 0, 0)],
      tracks: [
        tk('body', 'flatOffset.y', [[0, 0], [160, 8, 'easeOut'], [420, -48, 'easeIn'], [640, 0, 'easeOut'], [800, -16, 'easeIn'], [960, 0, 'easeOut'], [2000, 0]]),
        ...squish('body', [[0, 1, 1, 'easeOut'], [160, 1.12, 0.88, 'easeIn'], [300, 0.9, 1.12, 'easeOut'], [520, 0.97, 1.03, 'easeIn'], [650, 1.16, 0.86, 'easeOut'],
          [800, 0.96, 1.05, 'easeIn'], [960, 1.06, 0.95, 'easeOut'], [1120, 1, 1], [2000, 1, 1]]),
        tk('face', 'transform.rotation', [[0, 0], [700, 0, 'easeInOut'], [820, 6, 'easeInOut'], [940, -5, 'easeInOut'], [1060, 3, 'easeInOut'], [1200, 0], [2000, 0]]),
        ...eyes('transform.scale.x', [[0, 1], [260, 1, 'easeOut'], [420, 1.32, 'overshoot'], [1600, 1.28, 'easeInOut'], [1850, 1]]),
        ...eyes('transform.scale.y', [[0, 1], [260, 1, 'easeOut'], [420, 1.32, 'overshoot'], [1600, 1.28, 'easeInOut'], [1850, 1]]),
        ...eyes('eye.openness', [[0, 1], [140, 1, 'easeIn'], [220, 0.2, 'easeOut'], [360, 1.1], [1600, 1.1, 'easeInOut'], [1850, 1]]),
        ...hand('L', [rest('L', 0), [180, -170, 120, 'easeOut'], [420, -214, -70, 'overshoot'], [1100, -206, -60, 'easeInOut'], rest('L', 1500), rest('L', 2000)]),
        ...hand('R', [rest('R', 0), [220, 170, 120, 'easeOut'], [460, 214, -70, 'overshoot'], [1140, 206, -60, 'easeInOut'], rest('R', 1540), rest('R', 2000)]),
        ...twinkle('sparkleA', 280, 820, 1.2), ...twinkle('sparkleB', 420, 880),
      ],
      emitters: [burst({ startMs: 380, endMs: 1400, count: 14 })],
      modifiers: [follow(60)],
    },
    {
      id: 'p_kit_covereyes', name: 'Cover Eyes', source: 'builtin', durationMs: 2800,
      tagline: 'watching.lottie · coverEyes · password field: hands over eyes, shy peek, blush (loops)',
      layers: [...arms(), ...mittens(), art('blushL', 'Blush', BLUSH, held(-78, 34, 40, 20, 20)), art('blushR', 'Blush', BLUSH, held(78, 34, 40, 20, 20))],
      appearances: ['armL', 'armR', 'mittenL', 'mittenR', 'blushL', 'blushR'].map((id) => on(id, 0, 2800, 0, 0)),
      tracks: [
        // covered at the seam; the right hand slides down for a peek and pops back
        ...mittenHand('L', [[0, -56, -12], [1200, -56, -12, 'easeInOut'], [1320, -60, -6, 'easeInOut'], [1440, -56, -12], [2800, -56, -12]]),
        ...mittenHand('R', [[0, 56, -12], [700, 56, -12, 'easeInOut'], [960, 64, 44, 'easeOut'], [1500, 64, 44, 'easeIn'], [1640, 56, -16, 'overshoot'], [1780, 56, -12], [2800, 56, -12]]),
        tk('mittenR', 'transform.rotation', [[0, 0], [700, 0, 'easeInOut'], [960, 14, 'easeInOut'], [1500, 14, 'easeIn'], [1640, 0], [2800, 0]]),
        tk('face', 'surface.pitch', [[0, 8], [960, 8, 'easeInOut'], [1100, 0, 'easeInOut'], [1500, 0, 'easeIn'], [1640, 10, 'easeOut'], [1900, 8], [2800, 8]]),
        tk('face', 'transform.rotation', [[0, -5], [1640, -5, 'easeInOut'], [1760, 4, 'easeInOut'], [1880, -6, 'easeInOut'], [2000, 2, 'easeInOut'], [2150, -5], [2800, -5]]),
        // the peeking eye glances out, wide
        tk('eyeR', 'surface.yaw', [[0, 0], [1000, 0, 'easeOut'], [1120, 10], [1400, 10, 'easeInOut'], [1500, 0], [2800, 0]]),
        tk('eyeR', 'transform.scale.y', [[0, 1], [1000, 1, 'easeOut'], [1100, 1.2, 'overshoot'], [1480, 1.2, 'easeIn'], [1560, 1], [2800, 1]]),
        ...['blushL', 'blushR'].map((id) => tk(id, 'opacity', [[0, 0.55], [1640, 0.55, 'easeOut'], [1800, 0.95, 'easeInOut'], [2600, 0.55], [2800, 0.55]])),
        tr('body', 'flatOffset.y', sine(0, 1400, 3, 2, 4)),
        ...breathe(1400, 2, 0.018),
      ],
    },

    // ── generating.lottie ────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_writing', name: 'Writing', source: 'builtin', durationMs: 2400,
      tagline: 'generating.lottie · status=generating · script: scribbles on a notepad, head bobbing (loops)',
      layers: [...arms(), notepad(), ...scribbles(), pencil()],
      appearances: ['armL', 'armR', 'notepad', 'pencil', 'scribble1', 'scribble2', 'scribble3'].map((id) => on(id, 0, 2400, 0, 0)),
      tracks: [
        ...writingMotion(0, 3),
        // back to the start of the first line for the seam
        ...[0, 1, 2].map((i) => tk(`scribble${i + 1}`, 'trim.end', [[0, 0], [i * 700, 0, 'linear'], [i * 700 + 700, 1], [2340, 1, 'hold'], [2400, 0]])),
        ...[0, 1, 2].map((i) => tk(`scribble${i + 1}`, 'opacity', [[0, 1], [2150, 1, 'easeIn'], [2340, 0, 'hold'], [2400, 1]])),
        tk('pencil', 'transform.rotation', [[0, PENCIL_LEAN]]),
        tr('notepad', 'flatOffset.y', sine(0, 1200, 2.5, 2, 92, 1)),
        tk('notepad', 'transform.rotation', [[0, -8]]),
        ...hand('L', [[0, -122, 118], [2400, -122, 118]]),
        tk('face', 'surface.pitch', [[0, 16]]), tk('face', 'surface.yaw', [[0, -12]]),
        tr('face', 'transform.rotation', sine(0, 600, 2.2, 4)),
        tr('face', 'flatOffset.y', sine(0, 1200, 2, 2, 0, 1)),
        tr('eyeL', 'eye.openness', blinks([1500], 0.85)), tr('eyeR', 'eye.openness', blinks([1500], 0.85)),
        ...breathe(1200, 2),
      ],
    },
    {
      id: 'p_kit_failed', name: 'Generation Failed', source: 'builtin', durationMs: 3400,
      tagline: 'generating.lottie · status=failed: pencil snaps, slumps, squiggle thought bubble, sigh',
      layers: [...arms(), notepad(), pencil(), art('pencilTop', 'Pencil (top half)', PENCIL_TOP, held(40, 20, 24, 56, 33)), art('pencilTip', 'Pencil (tip half)', PENCIL_TIP, held(56, 70, 24, 56, 33)),
        art('thought', 'Thought bubble', BUBBLE, held(-156, -206, 120, 110, 34)), art('squiggle', 'Squiggle', SQUIGGLE, held(-140, -224, 46, 46, 35))],
      appearances: [on('armL', 0, 3400, 0, 0), on('armR', 0, 3400, 0, 0), on('notepad', 0, 1500, 0, 280), on('pencil', 0, 560, 0, 0),
        on('pencilTop', 560, 1700, 0, 260), on('pencilTip', 560, 1400, 0, 220), on('thought', 1500, 3400, 0, 0), on('squiggle', 1560, 3400, 0, 0)],
      tracks: [
        // pressing harder and harder…
        ...xy('pencil', [[0, ...pencilAt(-60, 96), 'easeInOut'], [240, ...pencilAt(-44, 92), 'easeInOut'], [440, ...pencilAt(-50, 100), 'easeIn'], [540, ...pencilAt(-50, 104)]]),
        tk('pencil', 'transform.rotation', [[0, PENCIL_LEAN], [540, PENCIL_LEAN + 6]]),
        ...squish('pencil', [[0, 1, 1], [440, 1, 1, 'easeIn'], [540, 1.12, 0.9]]),
        // …snap: the top half kicks up in the hand, the tip flies off and falls
        ...xy('pencilTop', [[560, 32, 34, 'easeOut'], [700, 26, 2, 'easeInOut'], [1150, 30, 12, 'easeIn'], [1650, 50, 250]]),
        tk('pencilTop', 'transform.rotation', [[560, PENCIL_LEAN, 'easeOut'], [700, -10, 'easeInOut'], [1150, 0, 'easeIn'], [1650, 110]]),
        ...xy('pencilTip', [[560, 54, 76, 'easeOut'], [820, 150, -60, 'easeIn'], [1400, 260, 300]]),
        tk('pencilTip', 'transform.rotation', [[560, PENCIL_LEAN], [820, 190, 'linear'], [1100, 340, 'linear'], [1400, 480]]),
        ...hand('R', [[0, 60, 64], [440, 60, 70, 'easeIn'], [540, 60, 76, 'easeOut'], [700, 44, 30, 'easeInOut'], [1150, 48, 40, 'easeIn'], [1500, 168, 150, 'easeInOut'], [3400, 168, 150]]),
        ...hand('L', [[0, -122, 118], [1100, -122, 118, 'easeIn'], [1500, -168, 150, 'easeInOut'], [3400, -168, 150]]),
        ...xy('notepad', [[0, -58, 92], [1100, -58, 92, 'easeIn'], [1500, -90, 190]]),
        tk('notepad', 'transform.rotation', [[0, -8], [1100, -8, 'easeIn'], [1500, -34]]),
        // the jolt, then the slump
        tk('body', 'flatOffset.y', [[0, 0], [560, 0, 'easeOut'], [680, -12, 'easeInOut'], [1100, 0, 'easeInOut'], [1500, 16, 'easeInOut'], [2400, 16, 'easeInOut'], [2650, 10, 'easeInOut'], [3000, 20, 'easeOut'], [3400, 18]]),
        ...squish('body', [[0, 1, 1], [560, 1, 1, 'easeOut'], [680, 0.9, 1.12, 'easeInOut'], [860, 1.03, 0.97, 'easeInOut'], [1100, 1, 1, 'easeInOut'],
          [1500, 1.08, 0.92, 'easeInOut'], [2400, 1.08, 0.92, 'easeInOut'], [2650, 1.0, 1.04, 'easeInOut'], [3000, 1.12, 0.88, 'easeOut'], [3400, 1.1, 0.9]]),
        tk('face', 'surface.pitch', [[0, 16], [560, 16, 'easeOut'], [680, 0, 'easeInOut'], [1100, 0, 'easeInOut'], [1500, 18, 'easeInOut'], [2650, 12, 'easeInOut'], [3000, 20], [3400, 20]]),
        tk('face', 'transform.rotation', [[0, 0], [1100, 0, 'easeInOut'], [1500, -7, 'easeInOut'], [3400, -7]]),
        ...eyes('transform.scale.x', [[0, 1], [560, 1, 'easeOut'], [680, 1.34, 'overshoot'], [1000, 1.3, 'easeInOut'], [1400, 1], [3400, 1]]),
        ...eyes('transform.scale.y', [[0, 0.85], [560, 0.85, 'easeOut'], [680, 1.34, 'overshoot'], [1000, 1.3, 'easeInOut'], [1400, 0.8], [3400, 0.8]]),
        ...eyes('eye.openness', [[0, 0.85], [560, 0.85, 'easeOut'], [680, 1.15], [1100, 1.1, 'easeInOut'], [1500, 0.5], [2000, 0.5, 'easeIn'], [2080, 0.05, 'easeOut'], [2250, 0.5], [2650, 0.55, 'easeInOut'], [3000, 0.35], [3400, 0.4]]),
        // the thought bubble inflates, its squiggle turning
        ...scaled('thought', [[1500, 0, 'easeOut'], [1720, 1.12, 'easeInOut'], [1880, 0.97, 'easeInOut'], [2020, 1]]),
        ...scaled('squiggle', [[1560, 0, 'overshoot'], [1840, 1]]),
        tr('squiggle', 'transform.rotation', turn(1560, 3400, -540)),
      ],
      emitters: [burst({ name: 'snap', from: { nodeId: 'pencil', x: 0, y: 0 }, to: { nodeId: 'pencil', x: 0, y: 0 }, count: 6, velocity: 300, lifeMs: 420, size: 16, startMs: 560, endMs: 1000,
        parts: [PART('bang', 'bang', rgb(20, 19, 24), 0, 0.8)] })],
      modifiers: [follow(45)],
    },
    {
      id: 'p_kit_cancelled', name: 'Generation Cancelled', source: 'builtin', durationMs: 2800,
      tagline: 'generating.lottie · status=cancelled: puts the pencil down, small shrug and a wave',
      layers: [...arms(), notepad(), pencil()],
      appearances: [on('armL', 0, 2800, 0, 0), on('armR', 0, 2800, 0, 0), on('notepad', 0, 1150, 0, 260), on('pencil', 0, 1150, 0, 260)],
      tracks: [
        ...xy('pencil', [[0, ...pencilAt(-60, 96), 'easeInOut'], [200, ...pencilAt(-60, 96), 'easeInOut'], [700, 30, 170, 'easeOut'], [1150, 30, 180]]),
        tk('pencil', 'transform.rotation', [[0, PENCIL_LEAN], [200, PENCIL_LEAN, 'easeInOut'], [700, 90, 'easeOut'], [1150, 90]]),
        ...xy('notepad', [[0, -58, 92], [300, -58, 92, 'easeInOut'], [800, -64, 176, 'easeOut'], [1150, -64, 180]]),
        tk('notepad', 'transform.rotation', [[0, -8], [300, -8, 'easeInOut'], [800, 0]]),
        tk('face', 'surface.pitch', [[0, 16], [150, 16, 'easeInOut'], [520, 0, 'easeOut'], [2800, 0]]),
        tk('face', 'surface.yaw', [[0, -12], [150, -12, 'easeInOut'], [520, 0], [2800, 0]]),
        // shrug
        ...hand('L', [[0, -122, 118], [300, -122, 118, 'easeInOut'], [760, -124, 150, 'easeInOut'], [960, -122, 150, 'easeOut'], [1160, -196, 10, 'overshoot'], [1500, -190, 16, 'easeInOut'], rest('L', 1850), rest('L', 2800)]),
        ...hand('R', [[0, 60, 64], [200, 60, 64, 'easeInOut'], [700, 40, 170, 'easeInOut'], [960, 60, 150, 'easeOut'], [1180, 196, 10, 'overshoot'], [1500, 190, 16, 'easeInOut'],
          // …and a little wave
          [1760, 204, -80, 'easeOut'], [1920, 168, -70, 'easeInOut'], [2080, 206, -84, 'easeInOut'], [2240, 170, -72, 'easeInOut'], [2400, 204, -82, 'easeInOut'], rest('R', 2780), rest('R', 2800)]),
        tk('body', 'flatOffset.y', [[0, 0], [960, 0, 'easeOut'], [1160, -12, 'easeInOut'], [1500, -8, 'easeInOut'], [1700, 0], [2800, 0]]),
        ...squish('body', [[0, 1, 1], [960, 1, 1, 'easeOut'], [1100, 0.95, 1.06, 'easeInOut'], [1500, 0.97, 1.03, 'easeInOut'], [1720, 1.04, 0.96, 'easeOut'], [1900, 1, 1], [2800, 1, 1]]),
        tk('face', 'transform.rotation', [[0, 0], [1000, 0, 'easeOut'], [1200, -9, 'easeInOut'], [1520, -8, 'easeInOut'], [1780, 5, 'easeInOut'], [2450, 4, 'easeInOut'], [2750, 0]]),
        ...eyes('eye.openness', [[0, 0.85], [400, 1, 'easeOut'], [1000, 1, 'easeInOut'], [1200, 0.7], [1600, 0.7, 'easeInOut'], [1800, 0.42], [2450, 0.42, 'easeInOut'], [2750, 1]]),
        ...eyes('transform.scale.x', [[0, 1], [1600, 1, 'easeInOut'], [1800, 1.15, 'overshoot'], [2450, 1.15, 'easeInOut'], [2750, 1]]),
      ],
      modifiers: [follow(45)],
    },
    {
      id: 'p_kit_completed', name: 'Generation Complete', source: 'builtin', durationMs: 2600,
      tagline: 'generating.lottie · status=completed · ta-da: jump, arms up, sparkles and confetti (one-shot)',
      layers: [...arms(), art('sparkleA', 'Sparkle', SPARKLE, held(-150, -150, 40, 40)), art('sparkleB', 'Sparkle', SPARKLE, held(165, -120, 30, 30)), art('sparkleC', 'Sparkle', SPARKLE, held(-40, -210, 26, 26))],
      appearances: [on('armL', 0, 2600, 0, 0), on('armR', 0, 2600, 0, 0), on('sparkleA', 460, 1400, 0, 0), on('sparkleB', 560, 1500, 0, 0), on('sparkleC', 700, 1650, 0, 0)],
      tracks: [
        tk('body', 'flatOffset.y', [[0, 0], [200, 12, 'easeOut'], [470, -74, 'easeIn'], [720, 0, 'easeOut'], [880, -14, 'easeIn'], [1020, 0, 'easeOut'], [2600, 0]]),
        ...squish('body', [[0, 1, 1, 'easeOut'], [200, 1.14, 0.86, 'easeIn'], [330, 0.86, 1.16, 'easeOut'], [600, 0.98, 1.02, 'easeIn'], [730, 1.2, 0.82, 'easeOut'],
          [880, 0.96, 1.05, 'easeIn'], [1020, 1.05, 0.96, 'easeOut'], [1200, 1, 1], [2600, 1, 1]]),
        ...hand('L', [rest('L', 0), [200, -150, 130, 'easeOut'], [470, -206, -124, 'overshoot'], [1100, -214, -110, 'easeInOut'], [1350, -222, -40, 'easeInOut'], [2000, -218, -44, 'easeInOut'], rest('L', 2450), rest('L', 2600)]),
        ...hand('R', [rest('R', 0), [230, 150, 130, 'easeOut'], [500, 206, -124, 'overshoot'], [1130, 214, -110, 'easeInOut'], [1380, 222, -40, 'easeInOut'], [2030, 218, -44, 'easeInOut'], rest('R', 2480), rest('R', 2600)]),
        tk('face', 'transform.rotation', [[0, 0], [1100, 0, 'easeInOut'], [1350, 7, 'easeInOut'], [2000, 5, 'easeInOut'], [2400, 0]]),
        tk('face', 'surface.pitch', [[0, 0], [200, 6, 'easeOut'], [470, -12, 'easeInOut'], [1100, -8, 'easeInOut'], [1400, 0], [2600, 0]]),
        ...happyEyes(420, 2250),
        ...twinkle('sparkleA', 460, 940, 1.25), ...twinkle('sparkleB', 560, 940), ...twinkle('sparkleC', 700, 950, 1.2),
      ],
      emitters: [burst({ startMs: 450, endMs: 1500, count: 16, velocity: 520 }), confetti(480, 40, { from: { nodeId: 'body', x: 0, y: -140 }, to: { nodeId: 'body', x: 0, y: -140 } })],
      modifiers: [follow(65)],
    },
    {
      id: 'p_kit_shuffle', name: 'Shuffling Cards', source: 'builtin', durationMs: 2000,
      tagline: 'generating.lottie · subject=deck · loading cards: riffles cards hand to hand (loops)',
      layers: [...arms(), art('deckL', 'Left stack', CARD_BACK, held(-122, 88, 66, 90, 30)), art('deckR', 'Right stack', CARD_BACK, held(122, 88, 66, 90, 30)),
        ...[1, 2, 3, 4].map((i) => art(`flyCard${i}`, `Card ${i}`, CARD_BACK, held(122, 88, 60, 82, 31 + i)))],
      appearances: [...['armL', 'armR', 'deckL', 'deckR'].map((id) => on(id, 0, 2000, 0, 0)), ...[1, 2, 3, 4].map((i) => on(`flyCard${i}`, 0, 2000, 0, 0))],
      tracks: [
        // four cards arc right → left, then left → right; each hidden inside a stack between flights
        ...[1, 2, 3, 4].flatMap((i) => {
          const a = 60 + (i - 1) * 190, b = 1060 + (i - 1) * 190, F = 360;
          return [
            ...xy(`flyCard${i}`, [[0, 122, 88], [a, 122, 88, 'easeOut'], [a + F * 0.5, 0, -40 - i * 6, 'easeIn'], [a + F, -122, 88], [b, -122, 88, 'easeOut'], [b + F * 0.5, 0, -40 - i * 6, 'easeIn'], [b + F, 122, 88], [2000, 122, 88]]),
            tk(`flyCard${i}`, 'transform.rotation', [[0, 0], [a, 0, 'easeOut'], [a + F * 0.5, -20, 'easeIn'], [a + F, 0], [b, 0, 'easeOut'], [b + F * 0.5, 20, 'easeIn'], [b + F, 0], [2000, 0]]),
            tk(`flyCard${i}`, 'opacity', [[0, 0], [a, 0, 'hold'], [a + 1, 1, 'hold'], [a + F, 0, 'hold'], [b, 0, 'hold'], [b + 1, 1, 'hold'], [b + F, 0, 'hold'], [2000, 0]]),
          ];
        }),
        // the stacks give a little as a card leaves or lands
        ...squish('deckR', [[0, 1, 1], ...[60, 250, 440, 630].flatMap((t): P[] => [[t, 1.06, 0.92, 'easeOut'], [t + 120, 1, 1, 'easeInOut']]), ...[1420, 1610, 1800].flatMap((t): P[] => [[t, 1.06, 0.92, 'easeOut'], [t + 120, 1, 1, 'easeInOut']]), [2000, 1, 1]]),
        ...squish('deckL', [[0, 1, 1], ...[420, 610, 800, 990].flatMap((t): P[] => [[t, 1.06, 0.92, 'easeOut'], [t + 120, 1, 1, 'easeInOut']]), ...[1060, 1250].flatMap((t): P[] => [[t + 20, 1.06, 0.92, 'easeOut'], [t + 140, 1, 1, 'easeInOut']]), [2000, 1, 1]]),
        tr('armR', 'limb.b.y', sine(0, 1000, 6, 2, 104, 1)), tk('armR', 'limb.b.x', [[0, 132]]), tk('armR', 'limb.length', [[0, ARM]]),
        tr('armL', 'limb.b.y', sine(0, 1000, 6, 2, 104, 3)), tk('armL', 'limb.b.x', [[0, -132]]), tk('armL', 'limb.length', [[0, ARM]]),
        // eyes follow the flights
        tr('face', 'surface.yaw', sine(0, 1000, 14, 2, 0, 1).map((x) => ({ ...x, value: -(x.value as number) }))),
        tk('face', 'surface.pitch', [[0, 4]]),
        tr('face', 'transform.rotation', sine(0, 1000, 2.5, 2, 0, 1).map((x) => ({ ...x, value: -(x.value as number) }))),
        ...eyes('eye.openness', [[0, 0.9], [2000, 0.9]]),
        ...breathe(1000, 2, 0.015),
      ],
    },
    {
      id: 'p_kit_fan', name: 'Cards Fan Out', source: 'builtin', durationMs: 2600,
      tagline: 'generating.lottie · subject=deck · completed: fans a hand of cards out and presents it',
      layers: [...arms(), ...['#f29bb8', '#f7c948', '#8ec5ff', '#78e6b4', '#e8584a'].map((c, i) => art(`fanCard${i + 1}`, `Card ${i + 1}`, cardFront(c), held(0, 120, 64, 88, 31 + i)))],
      appearances: [on('armL', 0, 2600, 0, 0), on('armR', 0, 2600, 0, 0), ...[1, 2, 3, 4, 5].map((i) => on(`fanCard${i}`, 0, 2600, 120, 200))],
      tracks: [
        // stacked, a squeeze, then each card swings out about the bottom of the hand, 40ms apart
        ...[1, 2, 3, 4, 5].flatMap((i) => {
          const a = (i - 3) * 22, r = (a * Math.PI) / 180, s = 300 + (i - 1) * 40;
          const at = (dy: number): [number, number] => [Math.round(44 * Math.sin(r)), Math.round(166 + dy - 44 * Math.cos(r))];
          return [
            ...xy(`fanCard${i}`, [[0, 0, 124], [s, 0, 124, 'easeOut'], [s + 360, ...at(0), 'easeInOut'], [900, ...at(0), 'easeInOut'], [1200, ...at(-110), 'overshoot'], [1600, ...at(-100), 'easeInOut'], [2200, ...at(-100), 'easeInOut'], [2600, 0, 124]]),
            tk(`fanCard${i}`, 'transform.rotation', [[0, 0], [s, 0, 'overshoot'], [s + 360, a], [2200, a, 'easeInOut'], [2600, 0]]),
          ];
        }),
        ...hand('L', [rest('L', 0), [200, -40, 150, 'easeInOut'], [300, -34, 156, 'easeOut'], [900, -34, 150, 'easeInOut'], [1200, -40, 44, 'overshoot'], [2200, -40, 54, 'easeInOut'], rest('L', 2600)]),
        ...hand('R', [rest('R', 0), [220, 40, 150, 'easeInOut'], [300, 34, 156, 'easeOut'], [900, 34, 150, 'easeInOut'], [1220, 40, 44, 'overshoot'], [2220, 40, 54, 'easeInOut'], rest('R', 2600)]),
        ...squish('body', [[0, 1, 1], [200, 1.06, 0.94, 'easeIn'], [300, 1.08, 0.92, 'easeOut'], [900, 1, 1, 'easeIn'], [1000, 1.08, 0.92, 'easeOut'], [1200, 0.94, 1.07, 'easeInOut'], [1420, 1, 1], [2600, 1, 1]]),
        tk('body', 'flatOffset.y', [[0, 0], [1000, 6, 'easeOut'], [1200, -26, 'easeIn'], [1400, 0, 'easeOut'], [2600, 0]]),
        tk('face', 'surface.pitch', [[0, 0], [150, 0, 'easeInOut'], [400, 18, 'easeInOut'], [900, 18, 'easeInOut'], [1200, -4], [2600, 0]]),
        tk('face', 'transform.rotation', [[0, 0], [1200, 0, 'easeInOut'], [1400, 6, 'easeInOut'], [2200, 5, 'easeInOut'], [2500, 0]]),
        ...happyEyes(1150, 2250),
      ],
      emitters: [burst({ startMs: 1150, endMs: 2100, count: 14, from: { nodeId: 'fanCard3', x: 0, y: -40 }, to: { nodeId: 'fanCard3', x: 0, y: -40 }, velocity: 460 })],
      modifiers: [follow(50)],
    },

    // ── hero.lottie ──────────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_hello', name: 'Hello Wave', source: 'builtin', durationMs: 2600,
      tagline: 'hero.lottie · wave (one-shot) · auth landing: anticipation, a big friendly wave, settle',
      layers: arms(),
      appearances: [on('armL', 0, 2600, 0, 0), on('armR', 0, 2600, 0, 0)],
      tracks: [
        ...hand('R', [rest('R', 0), [160, 204, 112, 'easeIn'], [480, 210, -102, 'overshoot'], ...[0, 1, 2, 3, 4, 5].map((i): P => [620 + i * 170, i % 2 ? 212 : 158, i % 2 ? -104 : -86, 'easeInOut']), [1640, 206, -96, 'easeInOut'], rest('R', 2080), rest('R', 2600)]),
        tk('armR', 'limb.bend', [[0, 1], [620, 1, 'easeInOut'], [790, 0.6, 'easeInOut'], [960, 1, 'easeInOut'], [1130, 0.6, 'easeInOut'], [1300, 1, 'easeInOut'], [1470, 0.6, 'easeInOut'], [1640, 1]]),
        tk('body', 'transform.rotation', [[0, 0], [160, -3, 'easeOut'], [480, 3, 'easeInOut'], [1640, 2, 'easeInOut'], [2000, 0]]),
        tk('body', 'flatOffset.y', [[0, 0], [160, 5, 'easeOut'], [400, -14, 'easeIn'], [560, 0, 'easeOut'], [2600, 0]]),
        ...squish('body', [[0, 1, 1], [160, 1.07, 0.93, 'easeOut'], [360, 0.95, 1.06, 'easeInOut'], [560, 1.05, 0.95, 'easeOut'], [740, 1, 1], [2600, 1, 1]]),
        tk('face', 'transform.rotation', [[0, 0], [300, 0, 'easeOut'], [560, 8, 'easeInOut'], ...[0, 1, 2].map((i): [number, number, E] => [820 + i * 340, i % 2 ? 8 : 5, 'easeInOut']), [1640, 7, 'easeInOut'], [2050, 0]]),
        ...happyEyes(380, 1800),
        tr('eyeL', 'transform.scale.y', [k(0, 1), k(2300, 1, 'easeIn'), k(2370, 0.1), k(2470, 1, 'easeOut')]),
        tr('eyeR', 'transform.scale.y', [k(0, 1), k(2300, 1, 'easeIn'), k(2370, 0.1), k(2470, 1, 'easeOut')]),
      ],
      modifiers: [follow(40)],
    },
    {
      id: 'p_kit_idle', name: 'Happy Idle', source: 'builtin', durationMs: 3200,
      tagline: 'hero.lottie · idle · breathing, blinking, a slow sway, little friends floating around (loops)',
      layers: [...arms(), art('floatHeart', 'Floating heart', HEART, onBody(-214, -150, 42, 38, -1)), art('floatSpark', 'Floating sparkle', SPARKLE, onBody(222, -70, 34, 34, -1)),
        art('floatSpark2', 'Floating sparkle', SPARKLE, onBody(-236, 70, 22, 22, -1))],
      appearances: ['armL', 'armR', 'floatHeart', 'floatSpark', 'floatSpark2'].map((id) => on(id, 0, 3200, 0, 0)),
      tracks: [
        ...breathe(1600, 2),
        tr('body', 'flatOffset.y', sine(0, 1600, 3, 2, 0, 1)),
        tr('body', 'transform.rotation', sine(0, 3200, 1.8, 1)),
        tr('face', 'transform.rotation', sine(0, 3200, 2.4, 1, 0, 3)),
        tr('face', 'flatOffset.x', sine(0, 3200, 3, 1, 0, 3)),
        tr('armL', 'limb.b.y', sine(0, 1600, 5, 2, 96, 1)), tk('armL', 'limb.b.x', [[0, -196]]),
        tr('armR', 'limb.b.y', sine(0, 1600, 5, 2, 96, 3)), tk('armR', 'limb.b.x', [[0, 196]]),
        tr('eyeL', 'eye.openness', blinks([1150, 2750])), tr('eyeR', 'eye.openness', blinks([1150, 2750])),
        tr('floatHeart', 'flatOffset.y', sine(0, 3200, 10, 1, -150)), tr('floatHeart', 'transform.rotation', sine(0, 1600, 8, 2, 0, 1)),
        tr('floatSpark', 'flatOffset.y', sine(0, 3200, 12, 1, -70, 2)), tr('floatSpark', 'transform.rotation', sine(0, 3200, 20, 1, 0, 3)),
        tr('floatSpark2', 'flatOffset.y', sine(0, 3200, 8, 1, 70, 1)),
        tr('floatSpark2', 'transform.scale.x', sine(0, 1600, 0.12, 2, 1)), tr('floatSpark2', 'transform.scale.y', sine(0, 1600, 0.12, 2, 1)),
      ],
    },

    // ── cloud-float.lottie ───────────────────────────────────────────────────────────────
    cloudFloat(false),
    cloudFloat(true),

    // ── pull.lottie ──────────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_release', name: 'Refresh Release', source: 'builtin', durationMs: 1400,
      tagline: 'pull.lottie · release (one-shot) · pull to refresh let go: a hop and a quick spin',
      layers: [...arms(), refreshArc()],
      appearances: [on('armL', 0, 1400, 0, 0), on('armR', 0, 1400, 0, 0), on('pullArc', 0, 900, 0, 240)],
      tracks: [
        tk('pullArc', 'trim.end', [[0, 1]]),
        tr('pullArc', 'transform.rotation', [k(0, 0), ...turn(80, 700, 540).slice(1), k(1400, 540)]),
        ...scaled('pullArc', [[0, 1, 'easeOut'], [180, 1.25, 'easeIn'], [800, 0.3]]),
        tk('body', 'flatOffset.y', [[0, 0], [90, 10, 'easeOut'], [380, -60, 'easeIn'], [660, 0, 'easeOut'], [800, -10, 'easeIn'], [920, 0, 'easeOut'], [1400, 0]]),
        tr('body', 'transform.rotation', [k(0, 0), k(90, 0, 'easeIn'), k(260, 120, 'linear'), k(430, 240, 'linear'), k(600, 360, 'easeOut'), k(601, 0, 'hold'), k(1400, 0)]),
        ...squish('body', [[0, 1, 1], [90, 1.12, 0.88, 'easeOut'], [220, 0.9, 1.12, 'easeInOut'], [560, 1, 1, 'easeIn'], [670, 1.16, 0.86, 'easeOut'], [820, 0.97, 1.03, 'easeInOut'], [980, 1, 1], [1400, 1, 1]]),
        ...hand('L', [[0, -200, -110], [300, -214, -80, 'easeInOut'], [700, -200, 20, 'easeInOut'], rest('L', 1100), rest('L', 1400)]),
        ...hand('R', [[0, 200, -110], [320, 214, -80, 'easeInOut'], [720, 200, 20, 'easeInOut'], rest('R', 1120), rest('R', 1400)]),
        ...eyes('eye.openness', [[0, 1.1], [200, 0.42, 'easeOut'], [1000, 0.42, 'easeInOut'], [1250, 1], [1400, 1]]),
        ...eyes('transform.scale.x', [[0, 1.2], [200, 1.16, 'easeOut'], [1000, 1.16, 'easeInOut'], [1250, 1], [1400, 1]]),
        ...eyes('transform.scale.y', [[0, 1.2], [200, 1, 'easeOut'], [1400, 1]]),
      ],
      emitters: [burst({ startMs: 560, endMs: 1300, count: 10, velocity: 380 })],
      modifiers: [follow(45)],
    },

    // ── empty.lottie ─────────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_noscripts', name: 'No Scripts Yet', source: 'builtin', durationMs: 3800,
      tagline: 'empty.lottie · noScripts · empty state: sits on a blank page, taps it, points to New Script',
      layers: [...arms(), ...legs(), art('blankPage', 'Blank page', PAGE, inWorld(0, 232, 400, 116, -4)), pointerArc()],
      appearances: [...['armL', 'armR', 'legL', 'legR', 'blankPage'].map((id) => on(id, 0, 3800, 0, 0)), on('pointArc', 2000, 3100, 0, 200)],
      tracks: [
        ...sittingLegs(46),
        tk('body', 'flatOffset.y', [[0, 46], [3800, 46]]),
        ...squish('body', [[0, 1.05, 0.95], [1500, 1.05, 0.95, 'easeInOut'], [1700, 1.0, 1.02, 'easeInOut'], [3400, 1.0, 1.02, 'easeInOut'], [3800, 1.05, 0.95]]),
        // tap, tap, tap on the page
        ...hand('R', [[0, 168, 150], ...[0, 1, 2].flatMap((i): P[] => [[260 + i * 340, 186, 104, 'easeIn'], [400 + i * 340, 172, 156, 'easeOut']]),
          [1500, 172, 150, 'easeInOut'], [1950, 232, -130, 'overshoot'], [2250, 214, -118, 'easeInOut'], [2400, 236, -138, 'easeInOut'], [2550, 216, -120, 'easeInOut'], [2700, 234, -136, 'easeInOut'], [3100, 230, -130, 'easeInOut'], [3600, 168, 150, 'easeInOut'], [3800, 168, 150]]),
        ...hand('L', [[0, -176, 150], [3800, -176, 150]]),
        ...squish('blankPage', [[0, 1, 1], ...[400, 740, 1080].flatMap((t): P[] => [[t, 1.02, 0.94, 'easeOut'], [t + 140, 1, 1, 'easeInOut']]), [3800, 1, 1]]),
        tk('face', 'surface.pitch', [[0, 16], [1400, 16, 'easeInOut'], [1700, 0, 'easeInOut'], [1950, -14, 'easeInOut'], [3100, -14, 'easeInOut'], [3500, 16], [3800, 16]]),
        tk('face', 'surface.yaw', [[0, 8], [1400, 8, 'easeInOut'], [1700, 0, 'easeInOut'], [1950, 22, 'easeInOut'], [3100, 22, 'easeInOut'], [3500, 8], [3800, 8]]),
        tk('face', 'transform.rotation', [[0, 0], ...[0, 1, 2].map((i): [number, number, E] => [400 + i * 340, i % 2 ? -2 : 2, 'easeInOut']), [1500, 0, 'easeInOut'], [1700, 7, 'easeInOut'], [1950, 3], [3100, 3, 'easeInOut'], [3500, 0], [3800, 0]]),
        ...eyes('eye.openness', [[0, 0.9], [1500, 0.9, 'easeOut'], [1700, 1.12], [3100, 1.1, 'easeInOut'], [3500, 0.9], [3800, 0.9]]),
        ...eyes('transform.scale.y', [[0, 1], [1500, 1, 'easeOut'], [1650, 1.14, 'overshoot'], [1900, 1.08], [3100, 1.08, 'easeInOut'], [3500, 1], [3800, 1]]),
        tk('pointArc', 'trim.end', [[2000, 0, 'easeOut'], [2500, 1], [3100, 1]]),
        tk('pointArc', 'trim.start', [[2000, 0], [2700, 0, 'easeIn'], [3100, 1]]),
      ],
      modifiers: [follow(40)],
    },
    {
      id: 'p_kit_telescope', name: 'Telescope Scan', source: 'builtin', durationMs: 3600,
      tagline: 'empty.lottie · nothingPublished · discover: looks through a telescope across an empty horizon (loops)',
      layers: [...arms(), art('telescope', 'Telescope', TELESCOPE, held(128, -46, 150, 60, 30))],
      appearances: ['armL', 'armR', 'telescope'].map((id) => on(id, 0, 3600, 0, 0)),
      tracks: [
        // the eyepiece stays at the right eye; the barrel sweeps the horizon
        ...(() => {
          const angles = sine(0, 3600, 13, 1, -24, 1);
          const pos = (a: number): [number, number] => { const r = (a * Math.PI) / 180; return [Math.round(58 + 72 * Math.cos(r)), Math.round(-12 + 72 * Math.sin(r))]; };
          return [
            tr('telescope', 'transform.rotation', angles),
            ...xy('telescope', angles.map((x): P => [x.time, ...pos(x.value as number), x.easingOut.type === 'preset' && x.easingOut.name === 'easeIn' ? 'easeIn' : 'easeOut'])),
            ...hand('R', angles.map((x): P => { const [px, py] = pos((x.value as number) + 6); return [x.time, px + 6, py + 26, 'easeInOut']; })),
            ...hand('L', angles.map((x): P => { const [px, py] = pos(x.value as number); return [x.time, px - 60, py + 34, 'easeInOut']; })),
            tr('face', 'surface.yaw', angles.map((x) => ({ ...x, value: 18 + ((x.value as number) + 24) * 0.4 }))),
          ];
        })(),
        tk('face', 'surface.pitch', [[0, -10]]),
        tk('eyeL', 'eye.openness', [[0, 0.12], [3600, 0.12]]),
        tr('eyeR', 'transform.scale.y', [k(0, 1.08), k(1700, 1.08, 'easeIn'), k(1790, 0.6), k(1900, 1.08, 'easeOut'), k(3600, 1.08)]),
        tr('body', 'transform.rotation', sine(0, 3600, 1.5, 1, 4, 1)),
        ...breathe(1800, 2, 0.015),
      ],
    },

    // ── error.lottie ─────────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_disconnected', name: 'Disconnected', source: 'builtin', durationMs: 3600,
      tagline: 'error.lottie · disconnected · network error: an unplugged cable that will not connect, a storm cloud, confused (loops)',
      layers: [...arms(), art('socketEnd', 'Socket', SOCKET, held(-164, 30, 64, 56, 31)), art('plugEnd', 'Plug', PLUG, held(164, 30, 64, 56, 31)),
        cable(), art('stormCloud', 'Storm cloud', STORM, held(0, -236, 130, 80, 33)), art('bolt', 'Lightning', BOLT, held(10, -176, 30, 46, 32)),
        art('confusedMark', 'Question mark', QUESTION, held(176, -186, 34, 52, 34))],
      appearances: [...['armL', 'armR', 'socketEnd', 'plugEnd', 'cable', 'stormCloud', 'bolt'].map((id) => on(id, 0, 3600, 0, 0)), on('confusedMark', 1700, 3000, 0, 220)],
      tracks: [
        // closer… closer… zap, apart
        ...(['L', 'R'] as const).flatMap((s) => {
          const sg = s === 'L' ? -1 : 1, id = s === 'L' ? 'socketEnd' : 'plugEnd';
          const keys: P[] = [[0, 164 * sg, 30], [300, 164 * sg, 30, 'easeInOut'], [900, 70 * sg, 20, 'easeInOut'], [1080, 44 * sg, 18, 'easeIn'], [1180, 38 * sg, 16, 'easeOut'], [1320, 176 * sg, 36, 'easeOut'], [1600, 164 * sg, 30, 'easeInOut'], [3600, 164 * sg, 30]];
          return [...xy(id, keys), ...hand(s, keys.map(([t, x, y, e]): P => [t, x - 12 * sg, y + 18, e]))];
        }),
        tk('cable', 'transform.scale.x', [[0, 1], [300, 1, 'easeInOut'], [900, 0.48, 'easeInOut'], [1180, 0.3, 'easeOut'], [1320, 1.08, 'easeOut'], [1600, 1], [3600, 1]]),
        tk('bolt', 'opacity', [[0, 0], [1150, 0, 'hold'], [1180, 1, 'hold'], [1240, 0.2, 'hold'], [1290, 1, 'hold'], [1420, 0, 'easeOut'], [3600, 0]]),
        ...scaled('bolt', [[0, 0.8], [1180, 0.8, 'easeOut'], [1260, 1.2], [1420, 1, 'hold'], [3600, 0.8]]),
        tr('stormCloud', 'flatOffset.y', sine(0, 1800, 5, 2, -236, 1)),
        tr('stormCloud', 'flatOffset.x', sine(0, 3600, 8, 1)),
        // the jolt, then a puzzled look from one end to the other
        tk('body', 'flatOffset.y', [[0, 0], [1180, 0, 'easeOut'], [1260, -10, 'easeInOut'], [1420, 0], [3600, 0]]),
        ...squish('body', [[0, 1, 1], [1180, 1, 1, 'easeOut'], [1240, 0.9, 1.1, 'easeInOut'], [1380, 1.05, 0.96, 'easeInOut'], [1520, 1, 1], [3600, 1, 1]]),
        tk('face', 'surface.yaw', [[0, 0], [300, 0, 'easeInOut'], [900, 0], [1600, 0, 'easeInOut'], [1900, -18, 'easeInOut'], [2300, -18, 'easeInOut'], [2600, 18, 'easeInOut'], [3000, 18, 'easeInOut'], [3400, 0], [3600, 0]]),
        tk('face', 'surface.pitch', [[0, 6], [900, 12, 'easeInOut'], [1180, 12, 'easeOut'], [1260, -6, 'easeInOut'], [1600, 4, 'easeInOut'], [3600, 6]]),
        tk('face', 'transform.rotation', [[0, 0], [1600, 0, 'easeInOut'], [1900, -10, 'easeInOut'], [3000, -9, 'easeInOut'], [3400, 0], [3600, 0]]),
        ...eyes('transform.scale.y', [[0, 1], [1180, 1, 'easeOut'], [1260, 1.3, 'overshoot'], [1500, 1.2, 'easeInOut'], [1800, 1], [3600, 1]]),
        tr('eyeL', 'eye.openness', [k(0, 1), k(1700, 1, 'easeInOut'), k(1900, 0.62), k(3000, 0.62, 'easeInOut'), k(3300, 1), k(3600, 1)]),
        ...scaled('confusedMark', [[1700, 0, 'overshoot'], [1920, 1], [3000, 1, 'hold'], [3600, 0]]),
        tk('confusedMark', 'transform.rotation', [[1700, -24, 'easeOut'], [2000, 8, 'easeInOut'], [2400, -6, 'easeInOut'], [3000, 4, 'hold'], [3600, -24]]),
      ],
      emitters: [burst({ name: 'fizzle', from: { nodeId: 'plugEnd', x: -30, y: 0 }, to: { nodeId: 'plugEnd', x: -30, y: 0 }, count: 9, velocity: 320, lifeMs: 380, size: 14, startMs: 1170, endMs: 1600, seed: 4 })],
      modifiers: [follow(40)],
    },

    // ── celebrate.lottie ─────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_celebrate', name: 'Clap and Bow', source: 'builtin', durationMs: 3600,
      tagline: 'celebrate.lottie · celebrate (one-shot → smile) · end of deck: claps, confetti, a jump and a bow',
      layers: [...arms(), ...mittens()],
      appearances: ['armL', 'armR', 'mittenL', 'mittenR'].map((id) => on(id, 0, 3600, 0, 0)),
      tracks: [
        // four claps in front, then both hands up with the jump, a bow, a smile
        ...(['L', 'R'] as const).flatMap((s) => {
          const g = s === 'L' ? -1 : 1;
          const claps = [0, 1, 2, 3].flatMap((i): P[] => [[260 + i * 220, 96 * g, 50, 'easeIn'], [360 + i * 220, 24 * g, 34, 'easeOut']]);
          return mittenHand(s, [[0, 196 * g, 96], [160, 130 * g, 80, 'easeInOut'], ...claps, [1300, 110 * g, 70, 'easeIn'], [1560, 206 * g, -130, 'overshoot'], [2000, 214 * g, -120, 'easeInOut'],
            [2250, 40 * g, 120, 'easeInOut'], [2800, 40 * g, 124, 'easeInOut'], [3200, 196 * g, 96, 'easeInOut'], [3600, 196 * g, 96]]);
        }),
        ...squish('mittenL', [[0, 1, 1], ...[360, 580, 800, 1020].flatMap((t): P[] => [[t, 0.84, 1.1, 'easeOut'], [t + 90, 1, 1, 'easeInOut']]), [3600, 1, 1]]),
        ...squish('mittenR', [[0, 1, 1], ...[360, 580, 800, 1020].flatMap((t): P[] => [[t, 0.84, 1.1, 'easeOut'], [t + 90, 1, 1, 'easeInOut']]), [3600, 1, 1]]),
        tk('body', 'flatOffset.y', [[0, 0], ...[0, 1, 2, 3].flatMap((i): [number, number, E][] => [[260 + i * 220, 0, 'easeOut'], [360 + i * 220, -5, 'easeInOut']]),
          [1300, 10, 'easeOut'], [1560, -70, 'easeIn'], [1800, 0, 'easeOut'], [2250, 0, 'easeInOut'], [2500, 16, 'easeInOut'], [2850, 16, 'easeInOut'], [3150, 0], [3600, 0]]),
        ...squish('body', [[0, 1, 1], [1200, 1, 1, 'easeOut'], [1300, 1.14, 0.86, 'easeIn'], [1420, 0.88, 1.14, 'easeOut'], [1680, 0.98, 1.02, 'easeIn'], [1810, 1.18, 0.84, 'easeOut'],
          [1980, 0.97, 1.03, 'easeInOut'], [2150, 1, 1, 'easeInOut'], [2500, 1.07, 0.92, 'easeInOut'], [2850, 1.07, 0.92, 'easeInOut'], [3150, 1, 1], [3600, 1, 1]]),
        // the bow
        tk('face', 'surface.pitch', [[0, 0], [2250, 0, 'easeInOut'], [2500, 20, 'easeInOut'], [2850, 20, 'easeInOut'], [3150, 0], [3600, 0]]),
        tk('face', 'flatOffset.y', [[0, 0], [2250, 0, 'easeInOut'], [2500, 10, 'easeInOut'], [2850, 10, 'easeInOut'], [3150, 0], [3600, 0]]),
        tk('face', 'transform.rotation', [[0, 0], ...[0, 1, 2, 3].map((i): [number, number, E] => [360 + i * 220, i % 2 ? -4 : 4, 'easeInOut']), [1300, 0, 'easeInOut'], [3600, 0]]),
        ...eyes('eye.openness', [[0, 1], [200, 0.42, 'easeOut'], [2250, 0.42, 'easeInOut'], [2500, 0.05], [2850, 0.05, 'easeInOut'], [3150, 0.42], [3600, 0.42]]),
        ...eyes('transform.scale.x', [[0, 1], [200, 1.16, 'overshoot'], [3600, 1.16]]),
      ],
      emitters: [confetti(1540, 56, { from: { nodeId: 'body', x: 0, y: -150 }, to: { nodeId: 'body', x: 0, y: -150 } }),
        ...[360, 580, 800, 1020].map((t, i) => burst({ name: `clap ${i + 1}`, from: { nodeId: 'body', x: 0, y: 30 }, to: { nodeId: 'body', x: 0, y: 30 }, count: 5, velocity: 260, lifeMs: 380, size: 12, startMs: t, endMs: t + 420, seed: 30 + i }))],
      modifiers: [follow(60)],
    },
    {
      id: 'p_kit_publish', name: 'Published!', source: 'builtin', durationMs: 2800,
      tagline: 'celebrate.lottie · publish · publish success: megaphone announcement with sound waves and confetti',
      layers: [...arms(), art('megaphone', 'Megaphone', MEGAPHONE, held(176, -40, 110, 80, 31)), art('soundWaves', 'Sound waves', WAVES, held(262, -104, 40, 64, 32))],
      appearances: [on('armL', 0, 2800, 0, 0), on('armR', 0, 2800, 0, 0), on('megaphone', 100, 2500, 100, 220), on('soundWaves', 420, 1650, 0, 160)],
      tracks: [
        ...xy('megaphone', [[100, 190, 110, 'easeOut'], [400, 176, -40, 'overshoot'], [2200, 176, -40, 'easeIn'], [2500, 200, 110]]),
        tk('megaphone', 'transform.rotation', [[100, 20, 'easeOut'], [400, -28, 'overshoot'], ...[480, 880, 1280].flatMap((t): [number, number, E][] => [[t, -34, 'easeOut'], [t + 160, -28, 'easeInOut']]), [2200, -28, 'easeIn'], [2500, 20]]),
        ...scaled('megaphone', [[100, 0.5, 'easeOut'], [400, 1.05], [2200, 1, 'easeIn'], [2500, 0.6]]),
          tk('soundWaves', 'transform.scale.x', [[420, 0.4], ...[480, 880, 1280].flatMap((t): [number, number, E][] => [[t, 0.5, 'easeOut'], [t + 380, 1.35, 'hold']]), [1650, 1.35]]),
          tk('soundWaves', 'transform.scale.y', [[420, 0.4], ...[480, 880, 1280].flatMap((t): [number, number, E][] => [[t, 0.5, 'easeOut'], [t + 380, 1.35, 'hold']]), [1650, 1.35]]),
          tk('soundWaves', 'opacity', [[420, 0], ...[480, 880, 1280].flatMap((t): [number, number, E][] => [[t, 1, 'easeIn'], [t + 380, 0, 'hold']]), [1650, 0]]),
        tk('soundWaves', 'transform.rotation', [[420, -28]]),
        ...hand('R', [rest('R', 0), [100, 196, 96, 'easeOut'], [400, 150, -10, 'overshoot'], [2200, 150, -10, 'easeIn'], rest('R', 2550), rest('R', 2800)]),
        // the other fist pumps with each shout
        ...hand('L', [rest('L', 0), [300, -196, 96, 'easeOut'], ...[480, 880, 1280].flatMap((t): P[] => [[t + 60, -206, -96, 'overshoot'], [t + 300, -190, -40, 'easeInOut']]), [1900, -200, -110, 'overshoot'], [2250, -196, -60, 'easeInOut'], rest('L', 2650), rest('L', 2800)]),
        tk('body', 'flatOffset.y', [[0, 0], ...[480, 880, 1280].flatMap((t): [number, number, E][] => [[t, 4, 'easeOut'], [t + 160, -8, 'easeInOut'], [t + 360, 0, 'easeInOut']]), [1750, 8, 'easeOut'], [1900, -40, 'easeIn'], [2080, 0, 'easeOut'], [2800, 0]]),
        ...squish('body', [[0, 1, 1], ...[480, 880, 1280].flatMap((t): P[] => [[t, 1.06, 0.94, 'easeOut'], [t + 160, 0.96, 1.05, 'easeInOut'], [t + 360, 1, 1, 'easeInOut']]),
          [1750, 1.1, 0.9, 'easeOut'], [1860, 0.92, 1.1, 'easeInOut'], [2080, 1.14, 0.88, 'easeOut'], [2250, 1, 1], [2800, 1, 1]]),
        tk('face', 'transform.rotation', [[0, 0], [400, 6, 'easeInOut'], [1700, 6, 'easeInOut'], [2400, 0], [2800, 0]]),
        tk('face', 'surface.yaw', [[0, 0], [400, 14, 'easeInOut'], [1700, 14, 'easeInOut'], [2000, 0], [2800, 0]]),
        ...happyEyes(420, 2350),
      ],
      emitters: [confetti(1880, 40, { from: { nodeId: 'megaphone', x: 40, y: -20 }, to: { nodeId: 'megaphone', x: 40, y: -20 }, angle: -60, spread: 90 })],
      modifiers: [follow(50)],
    },

    // ── practice: recording ──────────────────────────────────────────────────────────────
    {
      id: 'p_kit_listening', name: 'Listening', source: 'builtin', durationMs: 2400,
      tagline: 'practice · recording · listening: hand to ear, nodding along, sound waves (loops)',
      layers: [...arms(), art('earWaves', 'Sound waves', WAVES, held(226, -64, 30, 50, 32))],
      appearances: ['armL', 'armR', 'earWaves'].map((id) => on(id, 0, 2400, 0, 0)),
      tracks: [
        ...hand('R', [[0, 162, -52], [2400, 162, -52]]),
        tr('armR', 'limb.b.y', sine(0, 600, 3, 4, -52, 1)),
        tk('face', 'transform.rotation', [[0, 7]]),
        tk('face', 'surface.yaw', [[0, 12]]),
        tr('face', 'surface.pitch', sine(0, 600, 5, 4, 2, 1)),
        tr('face', 'flatOffset.y', sine(0, 600, 3, 4, 0, 1)),
        ...squish('body', [[0, 1, 1], ...[0, 1, 2, 3].flatMap((i): P[] => [[150 + i * 600, 1.03, 0.97, 'easeInOut'], [450 + i * 600, 0.99, 1.01, 'easeInOut']]), [2400, 1, 1]]),
          tk('earWaves', 'transform.scale.x', [[0, 0.5], ...[0, 800, 1600].flatMap((t): [number, number, E][] => [[t, 0.5, 'easeOut'], [t + 780, 1.25, 'hold']]), [2400, 0.5]]),
          tk('earWaves', 'transform.scale.y', [[0, 0.5], ...[0, 800, 1600].flatMap((t): [number, number, E][] => [[t, 0.5, 'easeOut'], [t + 780, 1.25, 'hold']]), [2400, 0.5]]),
          tk('earWaves', 'opacity', [[0, 0], ...[0, 800, 1600].flatMap((t): [number, number, E][] => [[t, 0, 'easeOut'], [t + 260, 1, 'easeIn'], [t + 780, 0, 'hold']]), [2400, 0]]),
        tk('earWaves', 'transform.rotation', [[0, 180]]),
        tr('eyeL', 'eye.openness', blinks([1450], 0.72)), tr('eyeR', 'eye.openness', blinks([1450], 0.72)),
        ...eyes('surface.yaw', [[0, 8], [2400, 8]]),
      ],
    },

    // ── reactions.lottie ─────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_shake', name: 'Wrong Code', source: 'builtin', durationMs: 1700,
      tagline: 'reactions.lottie · shake · wrong code, incorrect, error: flinch, head shake, wince, sweat drop',
      layers: [art('sweat', 'Sweat drop', DROP, held(128, -112, 26, 38, 32))],
      appearances: [on('sweat', 220, 1300, 80, 260)],
      tracks: [
        ...squish('body', [[0, 1, 1], [60, 0.9, 1.1, 'easeOut'], [200, 1.04, 0.97, 'easeInOut'], [360, 1, 1], [1000, 1, 1, 'easeInOut'], [1200, 1.05, 0.95, 'easeInOut'], [1500, 1, 1], [1700, 1, 1]]),
        tk('body', 'flatOffset.y', [[0, 0], [60, -8, 'easeOut'], [200, 0], [1700, 0]]),
        tk('face', 'surface.yaw', [[0, 0], [150, 0, 'easeOut'], [260, 22, 'easeInOut'], [380, -20, 'easeInOut'], [500, 16, 'easeInOut'], [620, -12, 'easeInOut'], [740, 7, 'easeInOut'], [860, -3, 'easeInOut'], [980, 0], [1700, 0]]),
        tk('body', 'transform.rotation', [[0, 0], [260, -2, 'easeInOut'], [380, 2, 'easeInOut'], [500, -1.5, 'easeInOut'], [620, 1, 'easeInOut'], [760, 0], [1700, 0]]),
        tk('face', 'transform.rotation', [[0, 0], [900, 0, 'easeInOut'], [1100, -7, 'easeInOut'], [1450, -6, 'easeInOut'], [1650, 0]]),
        ...eyes('eye.openness', [[0, 1], [50, 0.05, 'easeOut'], [220, 0.2, 'easeInOut'], [900, 0.25, 'easeInOut'], [1100, 0.55], [1450, 0.6, 'easeInOut'], [1650, 1]]),
        ...eyes('transform.scale.y', [[0, 1], [50, 0.7, 'easeOut'], [900, 0.75, 'easeInOut'], [1100, 0.85], [1650, 1]]),
        ...xy('sweat', [[220, 128, -112, 'easeIn'], [1300, 136, -64]]),
        ...scaled('sweat', [[220, 0, 'overshoot'], [400, 1], [1300, 0.8]]),
      ],
    },
    {
      id: 'p_kit_thumbsup', name: 'Thumbs Up', source: 'builtin', durationMs: 1900,
      tagline: 'reactions.lottie · thumbsUp · success, verified: a wink and a thumbs up',
      layers: [...arms(), art('thumb', 'Thumbs up', THUMB, held(196, -36, 62, 72, 33)), art('sparkleB', 'Sparkle', SPARKLE, held(165, -120, 30, 30))],
      appearances: [on('armL', 0, 1900, 0, 0), on('armR', 0, 1900, 0, 0), on('thumb', 200, 1500, 60, 180), on('sparkleB', 480, 1200, 0, 0)],
      tracks: [
        ...hand('R', [rest('R', 0), [150, 204, 110, 'easeIn'], [420, 186, -16, 'overshoot'], [1300, 186, -16, 'easeInOut'], rest('R', 1650), rest('R', 1900)]),
        ...xy('thumb', [[200, 206, 100, 'easeIn'], [440, 200, -40, 'overshoot'], [1300, 200, -40, 'easeInOut'], [1500, 206, 60]]),
        ...scaled('thumb', [[200, 0.4, 'easeOut'], [440, 1.12, 'easeInOut'], [560, 1], [1300, 1, 'easeIn'], [1500, 0.5]]),
        tk('thumb', 'transform.rotation', [[200, -30, 'easeOut'], [440, 10, 'easeInOut'], [600, -3, 'easeInOut'], [760, 0], [1500, 0]]),
        ...twinkle('sparkleB', 480, 720),
        tr('eyeL', 'eye.openness', [k(0, 1), k(380, 1, 'easeIn'), k(470, 0.06, 'easeOut'), k(1150, 0.06, 'easeInOut'), k(1300, 1)]),
        tr('eyeR', 'transform.scale.x', [k(0, 1), k(380, 1, 'easeOut'), k(500, 1.12, 'overshoot'), k(1150, 1.1, 'easeInOut'), k(1300, 1)]),
        tk('face', 'transform.rotation', [[0, 0], [380, 0, 'easeOut'], [520, 8, 'easeInOut'], [1200, 7, 'easeInOut'], [1450, 0]]),
        tk('body', 'flatOffset.y', [[0, 0], [300, 4, 'easeOut'], [440, -16, 'easeIn'], [600, 0, 'easeOut'], [1900, 0]]),
        ...squish('body', [[0, 1, 1], [300, 1.06, 0.94, 'easeOut'], [440, 0.95, 1.06, 'easeInOut'], [610, 1.07, 0.94, 'easeOut'], [780, 1, 1], [1900, 1, 1]]),
      ],
      modifiers: [follow(40)],
    },
    {
      id: 'p_kit_scratch', name: 'Head Scratch', source: 'builtin', durationMs: 2800,
      tagline: 'reactions.lottie · headScratch · forgot password, thinking: scratches its head, puzzled, looks up (loops)',
      layers: [...arms(), art('thinkMark', 'Question mark', QUESTION, held(-150, -196, 36, 54, 32))],
      appearances: [on('armL', 0, 2800, 0, 0), on('armR', 0, 2800, 0, 0), on('thinkMark', 500, 2400, 0, 240)],
      tracks: [
        ...hand('R', [[0, 118, -124], ...Array.from({ length: 8 }, (_, i): P => [110 + i * 110, i % 2 ? 118 : 100, i % 2 ? -124 : -114, 'easeInOut']), [1100, 118, -124, 'easeInOut'],
          ...Array.from({ length: 6 }, (_, i): P => [1700 + i * 110, i % 2 ? 118 : 100, i % 2 ? -124 : -114, 'easeInOut']), [2800, 118, -124]]),
        tk('face', 'transform.rotation', [[0, -8], [1100, -8, 'easeInOut'], [1350, 4, 'easeInOut'], [1650, 4, 'easeInOut'], [1900, -8], [2800, -8]]),
        tk('face', 'surface.pitch', [[0, 0], [1100, 0, 'easeInOut'], [1350, -16, 'easeInOut'], [1650, -16, 'easeInOut'], [1900, 0], [2800, 0]]),
        tk('face', 'surface.yaw', [[0, -8], [1100, -8, 'easeInOut'], [1350, -18, 'easeInOut'], [1650, -18, 'easeInOut'], [1900, -8], [2800, -8]]),
        tr('eyeL', 'eye.openness', [k(0, 0.65), k(1100, 0.65, 'easeInOut'), k(1300, 1.05), k(1650, 1.05, 'easeInOut'), k(1900, 0.65), k(2800, 0.65)]),
        tr('eyeR', 'eye.openness', blinks([2350])),
        ...eyes('surface.pitch', [[0, 0], [1100, 0, 'easeInOut'], [1300, -12], [1650, -12, 'easeInOut'], [1900, 0], [2800, 0]]),
        ...scaled('thinkMark', [[500, 0, 'overshoot'], [760, 1], [2200, 1, 'easeIn'], [2400, 0.4, 'hold'], [2800, 0]]),
        tr('thinkMark', 'transform.rotation', [k(500, -20, 'easeOut'), ...sine(800, 800, 8, 2), k(2800, -20)]),
        ...breathe(1400, 2, 0.015),
      ],
    },
    {
      id: 'p_kit_mailsent', name: 'Mail Sent', source: 'builtin', durationMs: 2800,
      tagline: 'reactions.lottie · mailSent · reset link sent: winds up and throws a paper plane, watches it fly',
      layers: [...arms(), art('paperPlane', 'Paper plane', PLANE, inWorld(214, 56, 76, 54, 40)), planeTrail()],
      appearances: [on('armL', 0, 2800, 0, 0), on('armR', 0, 2800, 0, 0), on('paperPlane', 0, 1700, 80, 0), on('planeTrail', 560, 2000, 0, 200)],
      tracks: [
        ...hand('R', [[0, 196, 96], [120, 204, 90, 'easeInOut'], [440, 236, 60, 'easeIn'], [560, 176, -118, 'easeOut'], [760, 160, -130, 'easeInOut'], [1300, 176, -40, 'easeInOut'], rest('R', 1800), rest('R', 2800)]),
        ...xy('paperPlane', [[0, 206, 70], [120, 214, 66, 'easeInOut'], [440, 246, 40, 'easeIn'], [560, 190, -130, 'linear'], [900, 360, -250, 'linear'], [1300, 560, -330, 'easeIn'], [1700, 820, -470]]),
        tk('paperPlane', 'transform.rotation', [[0, -10], [440, 10, 'easeIn'], [560, -40, 'easeOut'], [900, -30, 'easeInOut'], [1300, -22, 'easeIn'], [1700, -34]]),
        ...scaled('paperPlane', [[0, 1], [560, 1, 'linear'], [1700, 0.45]]),
        tk('planeTrail', 'trim.end', [[560, 0, 'linear'], [1300, 1]]),
        tk('planeTrail', 'trim.start', [[560, 0], [900, 0, 'easeIn'], [2000, 1]]),
        // wind up, throw, follow through, watch it go, a happy hop
        tk('body', 'transform.rotation', [[0, 0], [440, -7, 'easeIn'], [600, 6, 'easeOut'], [900, 2, 'easeInOut'], [1300, 0], [2800, 0]]),
        ...squish('body', [[0, 1, 1], [440, 0.95, 1.05, 'easeIn'], [580, 1.08, 0.93, 'easeOut'], [800, 1, 1, 'easeInOut'], [1800, 1, 1, 'easeOut'], [1950, 1.08, 0.92, 'easeIn'], [2050, 0.95, 1.05, 'easeOut'], [2250, 1.06, 0.95, 'easeOut'], [2450, 1, 1], [2800, 1, 1]]),
        tk('body', 'flatOffset.y', [[0, 0], [1950, 4, 'easeOut'], [2100, -26, 'easeIn'], [2260, 0, 'easeOut'], [2800, 0]]),
        tk('face', 'surface.yaw', [[0, 0], [300, 10, 'easeInOut'], [620, 24, 'easeInOut'], [1500, 30, 'easeInOut'], [1900, 0], [2800, 0]]),
        tk('face', 'surface.pitch', [[0, 0], [300, 6, 'easeInOut'], [700, -16, 'easeInOut'], [1500, -24, 'easeInOut'], [1900, 0], [2800, 0]]),
        ...happyEyes(1850, 2600),
      ],
      modifiers: [follow(55)],
    },
    {
      id: 'p_kit_goodbye', name: 'Sad Goodbye', source: 'builtin', durationMs: 3000,
      tagline: 'reactions.lottie · goodbye · delete account: a small sad wave and a tear',
      layers: [...arms(), art('tear', 'Tear', DROP, held(-60, 12, 16, 24, 32))],
      appearances: [on('armL', 0, 3000, 0, 0), on('armR', 0, 3000, 0, 0), on('tear', 1300, 2500, 120, 260)],
      tracks: [
        ...hand('R', [rest('R', 0), [300, 196, 96, 'easeInOut'], [900, 192, -40, 'easeInOut'], ...[0, 1, 2, 3].map((i): P => [1250 + i * 340, i % 2 ? 192 : 168, i % 2 ? -40 : -30, 'easeInOut']), [2500, 188, -36, 'easeInOut'], rest('R', 2950), rest('R', 3000)]),
        tk('face', 'surface.pitch', [[0, 0], [400, 0, 'easeInOut'], [900, 12], [2500, 12, 'easeInOut'], [2900, 0], [3000, 0]]),
        tk('face', 'transform.rotation', [[0, 0], [400, 0, 'easeInOut'], [900, -7], [2500, -7, 'easeInOut'], [2900, 0], [3000, 0]]),
        ...eyes('eye.openness', [[0, 1], [400, 1, 'easeInOut'], [900, 0.5], [1900, 0.5, 'easeIn'], [1990, 0.05, 'easeOut'], [2150, 0.5], [2500, 0.5, 'easeInOut'], [2900, 1], [3000, 1]]),
        ...eyes('transform.scale.y', [[0, 1], [400, 1, 'easeInOut'], [900, 0.86], [2500, 0.86, 'easeInOut'], [2900, 1], [3000, 1]]),
        ...xy('tear', [[1300, -60, 12, 'easeIn'], [2500, -66, 84]]),
        ...scaled('tear', [[1300, 0.3, 'easeOut'], [1600, 1], [2500, 0.8]]),
        tk('body', 'flatOffset.y', [[0, 0], [500, 0, 'easeInOut'], [1000, 8], [2500, 8, 'easeInOut'], [2900, 0], [3000, 0]]),
        ...squish('body', [[0, 1, 1], [500, 1, 1, 'easeInOut'], [800, 0.99, 1.03, 'easeInOut'], [1100, 1.06, 0.94, 'easeInOut'], [2300, 1.06, 0.94, 'easeInOut'], [2600, 1.03, 0.98, 'easeInOut'], [2900, 1, 1], [3000, 1, 1]]),
      ],
      modifiers: [follow(35)],
    },

    // ── onboarding ───────────────────────────────────────────────────────────────────────
    {
      id: 'p_kit_jumpin', name: 'Hello Jump In', source: 'builtin', durationMs: 2900,
      tagline: 'hero.lottie · onboarding welcome: jumps in from below, lands with a squash, big wave',
      layers: arms(),
      appearances: [on('armL', 0, 2900, 0, 0), on('armR', 0, 2900, 0, 0)],
      tracks: [
        tk('body', 'flatOffset.y', [[0, 520, 'hold'], [120, 520, 'easeOut'], [500, -70, 'easeIn'], [720, 0, 'easeOut'], [860, -18, 'easeIn'], [980, 0, 'easeOut'], [2900, 0]]),
        tk('body', 'transform.rotation', [[0, -14], [120, -14, 'easeOut'], [500, 4, 'easeInOut'], [720, 0], [2900, 0]]),
        ...squish('body', [[0, 0.84, 1.2], [120, 0.84, 1.2, 'easeOut'], [440, 0.94, 1.06, 'easeIn'], [560, 0.96, 1.04, 'easeIn'], [730, 1.24, 0.8, 'easeOut'], [870, 0.95, 1.06, 'easeInOut'], [990, 1.05, 0.96, 'easeOut'], [1150, 1, 1], [2900, 1, 1]]),
        ...hand('L', [[0, -150, 40], [120, -150, 40, 'easeOut'], [500, -214, -60, 'easeInOut'], [720, -210, 140, 'easeOut'], rest('L', 1100), rest('L', 2900)]),
        ...hand('R', [[0, 150, 40], [120, 150, 40, 'easeOut'], [500, 214, -60, 'easeInOut'], [720, 210, 140, 'easeOut'], [1060, 222, -132, 'overshoot'],
          ...[0, 1, 2, 3, 4].map((i): P => [1230 + i * 180, i % 2 ? 230 : 170, i % 2 ? -140 : -118, 'easeInOut']), [2100, 222, -132, 'easeInOut'], rest('R', 2550), rest('R', 2900)]),
        tk('face', 'surface.pitch', [[0, -20], [500, -8, 'easeInOut'], [760, 12, 'easeOut'], [950, 0], [2900, 0]]),
        tk('face', 'transform.rotation', [[0, 0], [1000, 0, 'easeOut'], [1200, 9, 'easeInOut'], [2100, 7, 'easeInOut'], [2500, 0]]),
        ...eyes('eye.openness', [[0, 1.1], [700, 1.1, 'easeOut'], [760, 0.3, 'easeOut'], [900, 1.1], [1050, 0.42, 'easeInOut'], [2200, 0.42, 'easeInOut'], [2450, 1], [2900, 1]]),
        ...eyes('transform.scale.x', [[0, 1], [1000, 1, 'easeOut'], [1150, 1.16, 'overshoot'], [2200, 1.16, 'easeInOut'], [2450, 1]]),
      ],
      emitters: [burst({ startMs: 720, endMs: 1300, count: 10, from: { nodeId: 'body', x: 0, y: 140 }, to: { nodeId: 'body', x: 0, y: 140 }, angle: -90, spread: 180, velocity: 360,
        parts: [PART('dust', 'splash', rgb(200, 196, 188), 0, 0.9)] })],
      modifiers: [follow(70, 2.8)],
    },
  ];
  return all.map(looped);
}

/** Floating on a cloud — slow bob and sway, the cloud giving under it; `pro` adds a crown and a halo. */
function cloudFloat(pro: boolean): Preset {
  const D = 3600;
  const layers: RigNode[] = [
    ...arms(),
    art('cloud', 'Cloud', CLOUD, onBody(0, 152, 360, 150, 30)),
    art('puffL', 'Little cloud', PUFF, inWorld(-250, -120, 110, 55, -2)),
    art('puffR', 'Little cloud', PUFF, inWorld(260, 60, 90, 45, -2)),
  ];
  if (pro) {
    layers.push(
      art('crown', 'Crown', CROWN, held(0, -166, 88, 62, 34)),
      { ...makeShapeLayer('circle', { id: 'halo', name: 'Halo', parentId: 'body', surface: flat(0, -10), size: { x: 440, y: 440 }, color: rgb(247, 201, 72, 1) }), ranged: true, zIndex: -6, opacity: 0.2 },
      art('proSparkA', 'Sparkle', SPARKLE, onBody(-190, -160, 30, 30, 35)), art('proSparkB', 'Sparkle', SPARKLE, onBody(200, -40, 24, 24, 35)),
    );
  }
  return {
    id: pro ? 'p_kit_cloudpro' : 'p_kit_cloud', name: pro ? 'Cloud Float Pro' : 'Cloud Float', source: 'builtin', durationMs: D,
    tagline: pro ? 'cloud-float.lottie · pro · profile header, subscriber: floating on a cloud with a crown and a warm halo (loops)'
      : 'cloud-float.lottie · idle · profile header, profile loading: floating on a cloud, slow bob and sway (loops)',
    layers,
    appearances: layers.map((l) => on(l.id, 0, D, 0, 0)),
    tracks: [
      tr('body', 'flatOffset.y', sine(0, D, 10, 1)),
      tr('body', 'transform.rotation', sine(0, D, 2.6, 1, 0, 1)),
      tr('cloud', 'transform.rotation', sine(0, D, 1.6, 1, 0, 3)),
      tr('cloud', 'squish.x', sine(0, D / 2, 0.025, 2, 1, 1)), tr('cloud', 'squish.y', sine(0, D / 2, -0.03, 2, 1, 1)),
      tr('face', 'transform.rotation', sine(0, D, 2.2, 1, 0, 2)),
      tr('face', 'flatOffset.y', sine(0, D / 2, 2, 2, 0, 1)),
      ...breathe(D / 2, 2, 0.018),
      tr('armL', 'limb.b.y', sine(0, D / 2, 4, 2, 92, 1)), tk('armL', 'limb.b.x', [[0, -176]]),
      tr('armR', 'limb.b.y', sine(0, D / 2, 4, 2, 92, 3)), tk('armR', 'limb.b.x', [[0, 176]]),
      tr('puffL', 'flatOffset.x', sine(0, D, 14, 1, -250)), tr('puffL', 'flatOffset.y', sine(0, D / 2, 4, 2, -120, 1)),
      tr('puffR', 'flatOffset.x', sine(0, D, 12, 1, 260, 2)), tr('puffR', 'flatOffset.y', sine(0, D / 2, 3, 2, 60, 3)),
      tr('eyeL', 'eye.openness', blinks([2200], 0.9)), tr('eyeR', 'eye.openness', blinks([2200], 0.9)),
      ...(pro ? [
        tr('crown', 'transform.rotation', sine(0, D / 2, 4, 2, 0, 1)),
        tr('crown', 'flatOffset.y', sine(0, D / 2, 3, 2, -166, 3)),
        tr('halo', 'opacity', sine(0, D / 2, 0.07, 2, 0.2)),
        tr('halo', 'transform.scale.x', sine(0, D / 2, 0.04, 2, 1, 1)), tr('halo', 'transform.scale.y', sine(0, D / 2, 0.04, 2, 1, 1)),
        ...twinkle('proSparkA', 300, 900), ...twinkle('proSparkA', 2100, 900),
        ...twinkle('proSparkB', 1200, 900), ...twinkle('proSparkB', 2900, 650),
      ].reduce<Track[]>((acc, t) => {
        // two twinkles on one layer: one track each property
        const have = acc.find((x) => x.nodeId === t.nodeId && x.property === t.property);
        if (have) have.keyframes.push(...t.keyframes); else acc.push(t);
        return acc;
      }, []).map((t) => {
        const first = t.keyframes[0], last = t.keyframes[t.keyframes.length - 1];
        if (t.property === 'transform.rotation' && last.value !== first.value) { last.easingOut = k(0, 0, 'hold').easingOut; t.keyframes.push(k(D, first.value)); }
        return t;
      }) : []),
    ],
    modifiers: [follow(35, 2.4)],
  };
}

/** The pull-to-refresh arc over the head, shared by the pull and its release. */
export function refreshArc(): RigNode {
  const pts = [-90, -10, 70, 150].map((deg) => ({ x: 30 * Math.cos((deg * Math.PI) / 180), y: -250 + 30 * Math.sin((deg * Math.PI) / 180) }));
  const c = makeCurveLayer(pts, { name: 'Refresh arc', type: 'smooth', color: rgb(20, 19, 24), width: 7 })!;
  return { ...c, id: 'pullArc', ranged: true, trim: { start: 0, end: 0 } };
}
/** a dashed-feeling arc from the pointing hand toward the top-right corner */
function pointerArc(): RigNode {
  const c = makeCurveLayer([{ x: 250, y: -150 }, { x: 290, y: -210 }, { x: 320, y: -290 }], { name: 'Point arc', type: 'smooth', color: rgb(20, 19, 24), width: 5 })!;
  return { ...c, id: 'pointArc', ranged: true, zIndex: 35, trim: { start: 0, end: 0 }, stroke: { ...c.stroke, lineCap: 'round' } };
}
function cable(): RigNode {
  const c = makeCurveLayer([{ x: -150, y: 44 }, { x: -110, y: 196 }, { x: 110, y: 196 }, { x: 150, y: 44 }], { name: 'Cable', type: 'smooth', color: rgb(20, 19, 24), width: 6, parentId: 'face' })!;
  return { ...c, id: 'cable', ranged: true, zIndex: 30 };
}
function planeTrail(): RigNode {
  const c = makeCurveLayer([{ x: 190, y: -130 }, { x: 360, y: -250 }, { x: 560, y: -330 }, { x: 820, y: -470 }], { name: 'Plane trail', type: 'smooth', color: rgb(20, 19, 24, 0.55), width: 4 })!;
  return { ...c, id: 'planeTrail', ranged: true, zIndex: 39, trim: { start: 0, end: 0 }, stroke: { ...c.stroke, lineCap: 'round' } };
}

/**
 * Which presets make which .lottie, and the input that picks each state — the inventory's asset
 * list, so a person (or the copilot) building `generating.lottie` knows the timelines to make.
 */
export const KIT_ASSETS: { file: string; input: string; states: Record<string, string> }[] = [
  { file: 'watching.lottie', input: 'isTyping (Boolean) · excited / coverEyes (Event)', states: { excited: 'p_kit_excited', coverEyes: 'p_kit_covereyes' } },
  { file: 'generating.lottie', input: 'status (String) · subject (String)',
    states: { generating: 'p_kit_writing', failed: 'p_kit_failed', cancelled: 'p_kit_cancelled', completed: 'p_kit_completed', dealing: 'p_kit_shuffle', fanned: 'p_kit_fan' } },
  { file: 'hero.lottie', input: 'wave (Event)', states: { wave: 'p_kit_hello', idle: 'p_kit_idle', welcome: 'p_kit_jumpin' } },
  { file: 'cloud-float.lottie', input: 'pro (Boolean)', states: { idle: 'p_kit_cloud', pro: 'p_kit_cloudpro' } },
  { file: 'pull.lottie', input: 'progress (Numeric, scrubbed) · release (Event)', states: { pull: 'p_app_refresh', release: 'p_kit_release' } },
  { file: 'empty.lottie', input: 'kind (String)',
    states: { noScripts: 'p_kit_noscripts', noResults: 'p_app_noresults', noSaved: 'p_app_nosaved', noCards: 'p_app_nodecks', nothingPublished: 'p_kit_telescope', search: 'p_app_search' } },
  { file: 'error.lottie', input: '—', states: { disconnected: 'p_kit_disconnected' } },
  { file: 'celebrate.lottie', input: 'variant (String)', states: { celebrate: 'p_kit_celebrate', smile: 'p_kit_idle', publish: 'p_kit_publish' } },
  { file: 'reactions.lottie', input: 'reaction (String)',
    states: { shake: 'p_kit_shake', thumbsUp: 'p_kit_thumbsup', headScratch: 'p_kit_scratch', mailSent: 'p_kit_mailsent', goodbye: 'p_kit_goodbye', listening: 'p_kit_listening' } },
];

// --- the five app-screen presets, rebuilt to the inventory (placed in appPresets()) ------------

/** keys sampled from an exact curve every `step` ms — for motion several layers must share exactly */
const sampled = (D: number, step: number, fn: (t: number) => [number, number]): P[] =>
  Array.from({ length: Math.round(D / step) + 1 }, (_, i) => { const t = i * step; return [t, ...fn(t).map((v) => Math.round(v * 10) / 10) as [number, number], 'linear']; });
const TAU = Math.PI * 2;

/**
 * Pull to Refresh, made to be SCRUBBED by pull progress (set the frame from the scroll offset,
 * never loop it): peeks up from below, eyes widen, the arc fills, and at the threshold both
 * arms go up. Every value only moves forward with progress. `Refresh Release` starts from its
 * last pose.
 */
export function pullToRefresh(): Preset {
  const D = 2000;
  return {
    id: 'p_app_refresh', name: 'Pull to Refresh', source: 'builtin', durationMs: D,
    tagline: 'pull.lottie · scrub by pull progress · peeks up, eyes widen, arc fills, arms up at the threshold · squish',
    layers: [...arms(), refreshArc()],
    appearances: [on('armL', 0, D, 0, 0), on('armR', 0, D, 0, 0), on('pullArc', 0, D, 0, 0)],
    tracks: [
      tk('body', 'flatOffset.y', [[0, 150, 'easeOut'], [900, 22, 'easeInOut'], [1500, 0, 'easeOut'], [D, 0]]),
      ...squish('body', [[0, 0.9, 1.1, 'easeOut'], [900, 0.97, 1.03, 'easeIn'], [1350, 1.07, 0.93, 'easeOut'], [1560, 0.94, 1.07, 'easeInOut'], [1800, 0.97, 1.03], [D, 0.97, 1.03]]),
      tk('face', 'surface.pitch', [[0, -16, 'easeOut'], [900, -6, 'easeInOut'], [1500, 0], [D, 0]]),
      ...eyes('eye.openness', [[0, 0.5, 'easeOut'], [600, 0.92, 'easeInOut'], [1150, 1.12, 'overshoot'], [D, 1.1]]),
      ...eyes('transform.scale.x', [[0, 1], [900, 1, 'easeOut'], [1350, 1.22, 'overshoot'], [D, 1.2]]),
      ...eyes('transform.scale.y', [[0, 1], [900, 1, 'easeOut'], [1350, 1.22, 'overshoot'], [D, 1.2]]),
      ...hand('L', [rest('L', 0, 'easeOut'), [900, -178, 124, 'easeInOut'], [1350, -150, 40, 'easeOut'], [1600, -206, -120, 'overshoot'], [D, -200, -110]]),
      ...hand('R', [rest('R', 0, 'easeOut'), [900, 178, 124, 'easeInOut'], [1350, 150, 40, 'easeOut'], [1620, 206, -120, 'overshoot'], [D, 200, -110]]),
      tk('pullArc', 'trim.end', [[0, 0, 'linear'], [1500, 1], [D, 1]]),
      tk('pullArc', 'transform.rotation', [[0, -120, 'easeOut'], [1500, 0], [D, 0]]),
      ...scaled('pullArc', [[0, 0.6, 'easeOut'], [1500, 1, 'overshoot'], [1700, 1.1], [D, 1]]),
    ],
    modifiers: [follow(45)],
  };
}

/** Start Search: holds a magnifier and sweeps it left and right, eyes and head following it. Loops. */
export function startSearch(): Preset {
  const D = 3200;
  const glass = (t: number): [number, number] => [150 * Math.sin((TAU * t) / D), -64 - 8 * Math.cos((TAU * 2 * t) / D)];
  const g = sampled(D, 200, glass);
  return {
    id: 'p_app_search', name: 'Start Search', source: 'builtin', durationMs: D,
    tagline: 'empty.lottie · search · start searching: holds a magnifying glass, looks left and right (loops)',
    layers: [...arms(), art('magnifier', 'Magnifier', MAGNIFIER, held(0, -64, 104, 104, 32))],
    appearances: ['armL', 'armR', 'magnifier'].map((id) => on(id, 0, D, 0, 0)),
    tracks: [
      ...xy('magnifier', g),
      tr('magnifier', 'transform.rotation', sine(0, D, -10, 1)),
      ...hand('R', g.map(([t, x, y]): P => [t, x + 34, y + 44, 'linear'])),
      // the face 80ms behind the glass, the body a little further behind
      tr('face', 'surface.yaw', sampled(D, 200, (t) => [26 * Math.sin((TAU * (t - 80)) / D), 0]).map(([t, v]) => k(t, v, 'linear'))),
      tk('face', 'surface.pitch', [[0, -8]]),
      tr('body', 'transform.rotation', sampled(D, 200, (t) => [3 * Math.sin((TAU * (t - 200)) / D), 0]).map(([t, v]) => k(t, v, 'linear'))),
      ...eyes('transform.scale.x', [[0, 1.12], [D, 1.12]]),
      tr('eyeL', 'eye.openness', blinks([1500])), tr('eyeR', 'eye.openness', blinks([1500])),
      tr('armL', 'limb.b.y', sine(0, D / 2, 4, 2, 96, 1)), tk('armL', 'limb.b.x', [[0, -196]]),
      ...breathe(D / 2, 2, 0.015),
    ],
  };
}

/** No Search Results: sits on the floor, sad — slow blinks, a squiggle thought spinning, a sigh. Loops. */
export function noSearchResults(): Preset {
  const D = 3600, SIT = 50;
  return {
    id: 'p_app_noresults', name: 'No Search Results', source: 'builtin', durationMs: D,
    tagline: 'empty.lottie · noResults · empty state, nothing found: sad sit, blinks, squiggle thought, a sigh (loops)',
    layers: [...arms(), ...legs(), art('sadThought', 'Thought bubble', BUBBLE, held(-160, -200, 112, 102, 34)), art('sadSquiggle', 'Squiggle', SQUIGGLE, held(-146, -216, 42, 42, 35)),
      art('magnifierDown', 'Magnifier', MAGNIFIER, inWorld(214, 196, 80, 80, 20))],
    appearances: ['armL', 'armR', 'legL', 'legR', 'sadThought', 'sadSquiggle', 'magnifierDown'].map((id) => on(id, 0, D, 0, 0)),
    tracks: [
      ...sittingLegs(SIT),
      tk('magnifierDown', 'transform.rotation', [[0, 64]]),
      // the sigh: breathe in, a long breath out
      tk('body', 'flatOffset.y', [[0, SIT], [2100, SIT, 'easeInOut'], [2500, SIT - 6, 'easeInOut'], [3000, SIT + 5, 'easeInOut'], [D, SIT]]),
      ...squish('body', [[0, 1.05, 0.95], [2100, 1.05, 0.95, 'easeInOut'], [2500, 0.99, 1.04, 'easeInOut'], [3000, 1.1, 0.9, 'easeInOut'], [D, 1.05, 0.95]]),
      tk('face', 'surface.pitch', [[0, 12], [2100, 12, 'easeInOut'], [2500, 4, 'easeInOut'], [3000, 18, 'easeInOut'], [D, 12]]),
      tr('face', 'transform.rotation', sine(0, D, 2, 1, -6)),
      ...eyes('transform.scale.y', [[0, 0.84], [D, 0.84]]),
      ...eyes('eye.openness', [[0, 0.55], [800, 0.55, 'easeIn'], [940, 0.04, 'linear'], [1080, 0.04, 'easeOut'], [1300, 0.55], [2500, 0.6, 'easeInOut'], [3000, 0.3, 'easeInOut'], [D, 0.55]]),
      ...hand('L', [[0, -160, 150], [2500, -160, 146, 'easeInOut'], [3000, -164, 156, 'easeInOut'], [D, -160, 150]]),
      ...hand('R', [[0, 160, 150], [2500, 160, 146, 'easeInOut'], [3000, 164, 156, 'easeInOut'], [D, 160, 150]]),
      tr('sadThought', 'flatOffset.y', sine(0, D / 2, 4, 2, -200, 1)),
      tr('sadSquiggle', 'flatOffset.y', sine(0, D / 2, 4, 2, -216, 1)),
      tr('sadSquiggle', 'transform.rotation', turn(0, D, -360)),
      tr('sadThought', 'transform.rotation', sine(0, D, 3, 1)),
    ],
    modifiers: [follow(30, 2.4)],
  };
}

/** No Saved Decks: hugs an empty bookmark, then looks up hopefully. Loops. */
export function noSavedDecks(): Preset {
  const D = 3400;
  const hug = (t: number, y = 96, e: E = 'easeInOut'): P[][] => [[[t, -44, y, e]], [[t, 44, y, e]]];
  const both2 = (keys: P[][][]) => ({ L: keys.map((k2) => k2[0][0]), R: keys.map((k2) => k2[1][0]) });
  const hands = both2([hug(0), hug(1300), hug(1450, 90, 'easeOut'), hug(1750, 78, 'easeInOut'), hug(2150, 78, 'easeOut'), hug(2300, 66, 'easeIn'), hug(2450, 78, 'easeInOut'), hug(2900, 78, 'easeInOut'), hug(D)]);
  return {
    id: 'p_app_nosaved', name: 'No Saved Decks', source: 'builtin', durationMs: D,
    tagline: 'empty.lottie · noSaved · empty state, nothing saved: hugs an empty bookmark, looks up hopefully (loops)',
    layers: [...arms(), art('bookmark', 'Bookmark', BOOKMARK, held(0, 92, 62, 86, 30)), ...mittens(), art('blushL', 'Blush', BLUSH, held(-78, 34, 40, 20, 20)), art('blushR', 'Blush', BLUSH, held(78, 34, 40, 20, 20))],
    appearances: ['armL', 'armR', 'bookmark', 'mittenL', 'mittenR', 'blushL', 'blushR'].map((id) => on(id, 0, D, 0, 0)),
    tracks: [
      ...mittenHand('L', hands.L), ...mittenHand('R', hands.R),
      tk('bookmark', 'flatOffset.y', [[0, 92], [1300, 92, 'easeOut'], [1750, 76, 'easeInOut'], [2150, 76, 'easeOut'], [2300, 64, 'easeIn'], [2450, 76, 'easeInOut'], [2900, 76, 'easeInOut'], [D, 92]]),
      ...squish('bookmark', [[0, 1, 1], [350, 1.08, 0.94, 'easeInOut'], [700, 1, 1, 'easeInOut'], [1050, 1.08, 0.94, 'easeInOut'], [1300, 1, 1], [D, 1, 1]]),
      tr('body', 'transform.rotation', [k(0, 0), k(350, 3, 'easeInOut'), k(700, -3, 'easeInOut'), k(1050, 3, 'easeInOut'), k(1300, 0), k(D, 0)]),
      tk('face', 'surface.pitch', [[0, 8], [1300, 8, 'easeInOut'], [1650, -20, 'overshoot'], [2900, -16, 'easeInOut'], [D, 8]]),
      tk('face', 'transform.rotation', [[0, -4], [1300, -4, 'easeInOut'], [1650, 5, 'easeInOut'], [2900, 4, 'easeInOut'], [D, -4]]),
      tk('body', 'flatOffset.y', [[0, 0], [1300, 0, 'easeOut'], [1650, -8, 'easeInOut'], [2150, -8, 'easeOut'], [2300, -20, 'easeIn'], [2450, -8, 'easeInOut'], [2900, -6, 'easeInOut'], [D, 0]]),
      ...squish('body', [[0, 1.03, 0.97], [1300, 1.03, 0.97, 'easeOut'], [1650, 0.96, 1.05, 'easeInOut'], [2150, 0.97, 1.03, 'easeOut'], [2300, 0.94, 1.07, 'easeIn'], [2450, 1.05, 0.95, 'easeOut'], [2650, 0.97, 1.03, 'easeInOut'], [D, 1.03, 0.97]]),
      ...eyes('eye.openness', [[0, 0.3], [1300, 0.3, 'easeOut'], [1600, 1.12], [2550, 1.1, 'easeIn'], [2620, 0.05, 'easeOut'], [2740, 1.1], [2900, 1.1, 'easeInOut'], [D, 0.3]]),
      ...eyes('transform.scale.y', [[0, 1], [1300, 1, 'easeOut'], [1600, 1.16, 'overshoot'], [2900, 1.12, 'easeInOut'], [D, 1]]),
      ...['blushL', 'blushR'].map((id) => tk(id, 'opacity', [[0, 0.7], [1300, 0.7, 'easeInOut'], [1650, 0.3, 'easeInOut'], [2900, 0.3, 'easeInOut'], [D, 0.7]])),
    ],
    modifiers: [follow(35)],
  };
}

/** No Decks Here: shuffles an empty deck — nothing comes out — drops it, turns its hands over and shrugs. */
export function noDecksHere(): Preset {
  const D = 3300;
  const shuffle = (g: -1 | 1): P[] => [[0, 196 * g, 96], [150, 52 * g, 108, 'easeInOut'], ...[0, 1, 2, 3].map((i): P => [320 + i * 170, (i % 2 ? 52 : 30) * g, i % 2 ? 108 : 100, 'easeInOut']),
    [1000, 52 * g, 108, 'easeInOut'], [1400, 52 * g, 104, 'easeOut'], [1700, 184 * g, 26, 'overshoot'], [2400, 190 * g, 14, 'easeInOut'], [2900, 196 * g, 96, 'easeInOut'], [D, 196 * g, 96]];
  return {
    id: 'p_app_nodecks', name: 'No Decks Here', source: 'builtin', durationMs: D,
    tagline: 'empty.lottie · noCards · empty state, no cards: shuffles an empty deck, turns its hands over, shrug',
    layers: [...arms(), art('emptyDeck', 'Empty deck', EMPTY_DECK, held(0, 110, 88, 110, 30)), ...mittens()],
    appearances: [on('armL', 0, D, 0, 0), on('armR', 0, D, 0, 0), on('mittenL', 0, D, 0, 0), on('mittenR', 0, D, 0, 0), on('emptyDeck', 0, 1750, 160, 280)],
    tracks: [
      ...mittenHand('L', shuffle(-1)), ...mittenHand('R', shuffle(1)),
      ...squish('emptyDeck', [[0, 1, 1], ...[0, 1, 2, 3].map((i): P => [320 + i * 170, i % 2 ? 1 : 0.9, i % 2 ? 1 : 1.06, 'easeInOut']), [1000, 1, 1]]),
      tk('emptyDeck', 'transform.rotation', [[0, 0], [1000, 0, 'easeInOut'], [1250, -16, 'easeInOut'], [1400, -12, 'easeIn'], [1750, -46]]),
      tk('emptyDeck', 'flatOffset.y', [[0, 110], [1000, 110, 'easeInOut'], [1250, 98, 'easeInOut'], [1400, 100, 'easeIn'], [1750, 270]]),
      // hands turned over: palms up
      tk('mittenL', 'transform.rotation', [[0, 0], [1400, 0, 'easeOut'], [1700, -180, 'overshoot'], [2400, -180, 'easeInOut'], [2900, 0], [D, 0]]),
      tk('mittenR', 'transform.rotation', [[0, 0], [1400, 0, 'easeOut'], [1700, 180, 'overshoot'], [2400, 180, 'easeInOut'], [2900, 0], [D, 0]]),
      tk('face', 'surface.pitch', [[0, 0], [300, 12, 'easeInOut'], [1000, 12, 'easeInOut'], [1250, 20, 'easeInOut'], [1500, 0, 'easeInOut'], [D, 0]]),
      tk('body', 'flatOffset.y', [[0, 0], [1600, 0, 'easeOut'], [1780, -12, 'easeInOut'], [2400, -10, 'easeInOut'], [2700, 0], [D, 0]]),
      ...squish('body', [[0, 1, 1], [1600, 1, 1, 'easeOut'], [1740, 0.95, 1.06, 'easeInOut'], [2400, 0.97, 1.03, 'easeInOut'], [2650, 1.04, 0.96, 'easeOut'], [2850, 1, 1], [D, 1, 1]]),
      tk('face', 'transform.rotation', [[0, 0], [1650, 0, 'easeOut'], [1850, -10, 'easeInOut'], [2400, -9, 'easeInOut'], [2750, 0], [D, 0]]),
      ...eyes('eye.openness', [[0, 1], [1100, 0.8, 'easeInOut'], [1500, 1, 'easeInOut'], [1700, 0.66, 'easeInOut'], [2400, 0.66, 'easeInOut'], [2700, 0.42], [3100, 0.42, 'easeInOut'], [D, 1]]),
      ...eyes('transform.scale.x', [[0, 1], [2400, 1, 'easeInOut'], [2700, 1.14, 'overshoot'], [3100, 1.12, 'easeInOut'], [D, 1]]),
    ],
    modifiers: [follow(40)],
  };
}
