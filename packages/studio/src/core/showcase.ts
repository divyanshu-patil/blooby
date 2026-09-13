import { uid } from './id';
import { makeCurveLayer, makeLimb, makeSvgLayer, makeTextLayer } from './layers';
import { libraryOutline, SHAPE_LIBRARY } from './emitters';
import { primitivePath } from './path';
import { MORPH_MODES } from './easing';
import { makeMascot, type MascotKind } from './mascot';
import { curveToPath } from './curve';
import type { Appearance, ColorStop, EasingCurve, Emitter, Keyframe, KeyValue, LimbRig, Preset, RigNode, TextStyle, Track } from './types';

/**
 * Seven presets that show what the editor can do now — hands, legs, stickers, morphs,
 * attachment — rather than seven more ways to move two eyes.
 *
 * Each one brings the layers it needs (`Preset.layers`) and says when they are on screen
 * (`Preset.appearances`), so placing "Hii!" on a bare mascot gives it an arm and a speech
 * bubble for exactly that clip. A layer the user already has is animated rather than
 * duplicated, and a layer of theirs that is always there stays always there.
 *
 * Timings follow the craft block (copilot/craft.ts): anticipation before big moves, holds
 * that let a pose read, 40–80ms of overlap between the body and whatever it drives,
 * overshoot of about 10%. Limbs keep their length, the Cavalry way — when a hand has to
 * reach further, the length is animated with it, the way a rubber-hose rig does.
 */

export type E = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'elastic' | 'overshoot' | 'hold' | 'smooth';
const EASE: Record<E, EasingCurve> = {
  linear: { type: 'linear' },
  easeIn: { type: 'preset', name: 'easeIn' },
  easeOut: { type: 'preset', name: 'easeOut' },
  easeInOut: { type: 'preset', name: 'easeInOut' },
  elastic: { type: 'preset', name: 'elastic' },
  overshoot: MORPH_MODES.overshoot.easing,
  hold: MORPH_MODES.cut.easing,
  smooth: MORPH_MODES.smooth.easing,
};

export const k = (time: number, value: KeyValue, e: E = 'easeInOut'): Keyframe =>
  ({ id: uid('k'), time, value, easingOut: structuredClone(EASE[e]) as EasingCurve });
export const tr = (nodeId: string, property: string, keyframes: Keyframe[]): Track => ({ id: uid('t'), nodeId, property, keyframes });
export const both = (property: string, keys: Keyframe[]): Track[] => [
  tr('eyeL', property, keys),
  tr('eyeR', property, keys.map((x) => ({ ...x, id: uid('k') }))),
];
/** a point track pair — x and y of one limb point, keyed at the same times */
const point = (nodeId: string, key: 'a' | 'b' | 'c', keys: [number, number, number, E?][]): Track[] => [
  tr(nodeId, `limb.${key}.x`, keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, `limb.${key}.y`, keys.map(([t, , y, e]) => k(t, y, e))),
];
/** squash and stretch: y as given, x moving the opposite way so the volume holds */
export const squash = (nodeId: string, keys: [number, number, E?][]): Track[] => [
  tr(nodeId, 'transform.scale.y', keys.map(([t, v, e]) => k(t, v, e))),
  tr(nodeId, 'transform.scale.x', keys.map(([t, v, e]) => k(t, Math.round((2 - v) * 1000) / 1000, e))),
];
export const uniform = (nodeId: string, keys: [number, number, E?][]): Track[] => [
  tr(nodeId, 'transform.scale.x', keys.map(([t, v, e]) => k(t, v, e))),
  tr(nodeId, 'transform.scale.y', keys.map(([t, v, e]) => k(t, v, e))),
];
export const shape = (id: string) => libraryOutline(id)!;
export const flat = (x: number, y: number): RigNode['surface'] => ({ yaw: 0, pitch: 0, mapped: false, flatOffset: { x, y } });

/** A text layer a preset brings: its own id, Poppins Bold, only on screen where the preset says. */
export function words(id: string, name: string, content: string, style: Partial<TextStyle>, over: Partial<RigNode> = {}): RigNode {
  return makeTextLayer(content, { id, name, ranged: true, ...over }, { font: { family: 'Poppins', weight: 700, style: 'normal' }, ...style });
}

/**
 * A guide curve a preset brings — seen in the editor, never exported — through `a`, and the
 * path of the same curve through `b` in the same box, so the two can be path keyframes.
 */
export function guideCurve(id: string, name: string, a: [number, number][], b: [number, number][] = a) {
  const node = makeCurveLayer(a.map(([x, y]) => ({ x, y })), { name, guide: true, type: 'smooth' })!;
  const s = node.size.x, c = node.surface.flatOffset!;
  const d = curveToPath({ closed: false, points: b.map(([x, y]) => ({ x: (x - c.x) / s, y: (y - c.y) / s })) }, 'smooth');
  return { node: { ...node, id, ranged: true }, a: node.shapePath!, b: d };
}

/**
 * Every track closed back on the value it opened with, at the clip's very end — the
 * convention the presets above keep by hand ("closing keys land after its range has
 * ended"), because a clip has to loop and be followed. The value holds to the last
 * millisecond and snaps back then, when the layers it brought have faded out.
 */
export function looped(p: Preset): Preset {
  const end = p.durationMs;
  for (const t of p.tracks) {
    const first = t.keyframes[0], last = t.keyframes[t.keyframes.length - 1];
    if (!first || JSON.stringify(first.value) === JSON.stringify(last.value)) continue;
    if (last.time >= end - 1) last.time = end - 1;
    else t.keyframes.push(k(end - 1, last.value, 'linear'));
    t.keyframes.push(k(end, first.value, 'linear'));
  }
  return p;
}

/** Another mascot a preset brings along — a body and two eyes, only on screen in the clip. */
function friend(id: string, name: string, kind: MascotKind, x: number, y: number, width: number, parentId: string | null = null): RigNode[] {
  return makeMascot(kind, { id, name, x, y }).map((n) => ({
    ...n, ranged: true,
    ...(n.kind === 'body' ? { parentId, size: { x: width, y: Math.round((width * n.size.y) / n.size.x) } } : {}),
  }));
}
const partsOf = (id: string) => [id, `${id}.eyeL`, `${id}.eyeR`];
const onFor = (id: string, startMs: number, endMs: number, fadeInMs = 180, fadeOutMs = 220): Omit<Appearance, 'id' | 'blockId'>[] =>
  partsOf(id).map((nodeId) => ({ nodeId, startMs, endMs, fadeInMs, fadeOutMs }));
/** a friend's two eyes, keyed together */
const eyesOf = (id: string, property: string, keys: Keyframe[]): Track[] => [
  tr(`${id}.eyeL`, property, keys),
  tr(`${id}.eyeR`, property, keys.map((x) => ({ ...x, id: uid('k') }))),
];
const blink = (at: number): Keyframe[] => [k(0, 1), k(at, 1, 'linear'), k(at + 70, 0.06, 'easeIn'), k(at + 160, 1, 'easeOut')];
/** little hops from `y`: up by `h` and down again at each time */
const hops = (y: number, h: number, at: number[]): Keyframe[] =>
  [k(0, y), ...at.flatMap((t) => [k(t, y, 'easeOut'), k(t + 130, y - h, 'easeIn'), k(t + 260, y)])];
/** a jump with its crouch and its landing, from `y` */
const jump = (y: number, t: number, h = 40): Keyframe[] =>
  [k(t, y), k(t + 80, y + 8, 'easeOut'), k(t + 260, y - h, 'easeIn'), k(t + 440, y, 'easeOut')];
const jumpSquash = (t: number): [number, number, E?][] =>
  [[t, 1], [t + 80, 0.88], [t + 260, 1.08, 'easeOut'], [t + 440, 0.94, 'easeIn'], [t + 540, 1]];
/** a head wagging as it talks */
const talk = (from: number, to: number, deg = 4): Keyframe[] => {
  const keys = [k(from, 0)];
  for (let t = from + 160, i = 0; t < to; t += 160, i++) keys.push(k(t, i % 2 ? deg : -deg));
  return [...keys, k(to, 0)];
};

const YELLOW: ColorStop = { r: 247, g: 201, b: 72, a: 1 };
const PINK: ColorStop = { r: 242, g: 155, b: 184, a: 1 };

/** an SVG as a preset's own layer: fixed id, only on screen where the preset says */
function art(id: string, name: string, markup: string, over: Partial<RigNode>): RigNode {
  const made = makeSvgLayer(markup, name);
  if (!made) throw new Error(`showcase art "${id}" is not readable SVG`);
  return { ...made.node, id, name, ranged: true, ...over };
}
function limb(type: 'arm' | 'leg', side: -1 | 1, over: Partial<LimbRig> = {}): RigNode {
  const n = makeLimb(type, side, 'body', { id: `${type}${side < 0 ? 'L' : 'R'}`, ranged: true });
  n.limb = { ...n.limb!, ...over };
  return n;
}
const onMascot = (x: number, y: number): Partial<RigNode> => ({ parentId: 'body', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x, y } } });
const onSurface = (yaw: number, pitch: number): Partial<RigNode> => ({ parentId: 'body', surface: { yaw, pitch, mapped: true } });

const HI_BUBBLE = `<svg viewBox="0 0 132 92">
  <path d="M20 4H112A16 16 0 0 1 128 20V54A16 16 0 0 1 112 70H52L28 88L36 70H20A16 16 0 0 1 4 54V20A16 16 0 0 1 20 4Z" fill="#ffffff"/>
  <rect x="30" y="20" width="9" height="36" rx="3" fill="#141318"/><rect x="57" y="20" width="9" height="36" rx="3" fill="#141318"/>
  <rect x="34" y="33" width="28" height="9" rx="3" fill="#141318"/>
  <rect x="76" y="31" width="9" height="25" rx="3" fill="#141318"/><circle cx="80.5" cy="22" r="5" fill="#141318"/>
  <rect x="95" y="20" width="9" height="25" rx="3" fill="#e8584a"/><circle cx="99.5" cy="52" r="5" fill="#e8584a"/>
</svg>`;
const STICKER = `<svg viewBox="-0.6 -0.6 1.2 1.2"><path d="${primitivePath('star', { points: 5, innerRatio: 0.52, vertexRadius: 0.35 })}" fill="#F7C948" stroke="#ffffff" stroke-width="0.08" stroke-linejoin="round"/></svg>`;
const FLOWER = `<svg viewBox="0 0 60 60">
  <circle cx="30" cy="14" r="11" fill="#f29bb8"/><circle cx="45" cy="25" r="11" fill="#f29bb8"/><circle cx="39" cy="43" r="11" fill="#f29bb8"/>
  <circle cx="21" cy="43" r="11" fill="#f29bb8"/><circle cx="15" cy="25" r="11" fill="#f29bb8"/><circle cx="30" cy="30" r="9" fill="#f7c948"/>
</svg>`;
const SPARK_PATH = /d="([^"]+)"/.exec(SHAPE_LIBRARY.find((s) => s.id === 'spark')!.markup)![1];
const SPARKLE = `<svg viewBox="0 0 24 24"><path d="${SPARK_PATH}" fill="#F7C948"/></svg>`;
const NEW_BADGE = `<svg viewBox="0 0 120 52">
  <rect width="120" height="52" rx="26" fill="#e8584a"/>
  <path d="M24 36V16h5l10 12V16h5v20h-5L29 24v12Z" fill="#ffffff"/>
  <path d="M50 16h16v5H55v3h10v4H55v3h11v5H50Z" fill="#ffffff"/>
  <path d="M70 16h5l3 12 3-12h4l3 12 3-12h5l-6 20h-4l-3-11-3 11h-4Z" fill="#ffffff"/>
</svg>`;
const ORBIT_STAR = `<svg viewBox="-0.6 -0.6 1.2 1.2"><path d="${primitivePath('star', { points: 4, innerRatio: 0.38, vertexRadius: 0.2 })}" fill="#FFE27A"/></svg>`;

const joy = (): Omit<Emitter, 'id' | 'blockId'> => ({
  name: 'joy', glyphs: [], color: PINK, size: 22, path: 'arc',
  parts: [
    { id: 'joy_h', shapeId: 'heart', color: PINK, weight: 1, speed: 1, sizeScale: 0.9, spin: 30 },
    { id: 'joy_s', shapeId: 'spark', color: YELLOW, weight: 1, speed: 1.2, sizeScale: 0.8, spin: 90 },
  ],
  from: { nodeId: 'body', x: 0, y: -120 }, to: { nodeId: 'body', x: 130, y: -240 },
  bow: 40, rateMs: 260, lifeMs: 1000, count: 5, fadeStart: 0.5,
  scaleFrom: 0.3, scaleTo: 1.1, spin: 60, wobble: 10, wobbleFrequency: 1.4, seed: 23,
  easing: { type: 'preset', name: 'easeOut' }, speedJitter: 0.4, startMs: 520, endMs: 2300,
});

export function showcasePresets(): Preset[] {
  return [
    {
      // a hand comes up, bends toward us, and waves twice while "Hi!" pops in beside it
      id: 'p_hii', name: 'Hii!', source: 'builtin', durationMs: 2200, tagline: 'Hand + SVG + Rubber Hose',
      layers: [
        limb('arm', 1),
        art('hiBubble', 'Hi!', HI_BUBBLE, { ...onMascot(178, -208), size: { x: 132, y: 92 } }),
      ],
      appearances: [
        { nodeId: 'armR', startMs: 0, endMs: 2200, fadeInMs: 120, fadeOutMs: 160 },
        { nodeId: 'hiBubble', startMs: 620, endMs: 1750, fadeInMs: 50, fadeOutMs: 140 },
      ],
      tracks: [
        // a dip first (anticipation), then up past the head with a little overshoot
        ...point('armR', 'b', [[0, 196, 96], [140, 200, 110], [420, 190, -95, 'overshoot'], [560, 150, -82], [760, 204, -96],
          [960, 148, -80], [1180, 200, -94], [1450, 190, -90, 'easeIn'], [1850, 196, 96, 'easeOut'], [2200, 196, 96]]),
        // the hose lengthens to reach, and settles back — it never stretches past its length
        tr('armR', 'limb.length', [k(0, 114), k(420, 160, 'easeOut'), k(1450, 160), k(1850, 114), k(2200, 114)]),
        ...uniform('hiBubble', [[620, 0.8, 'overshoot'], [820, 1], [1600, 1, 'easeIn'], [1750, 0.8]]),
        // closing keys land after its range has ended, where nobody sees them — they only
        // make the clip end where it began, so it loops and can be followed
        tr('hiBubble', 'transform.rotation', [k(620, -10, 'overshoot'), k(840, 0), k(1600, 0, 'easeIn'), k(1750, 6), k(2200, -10)]),
        ...squash('body', [[0, 1], [180, 0.95], [400, 1.03, 'easeOut'], [620, 1], [2200, 1]]),
        // the body leans toward the hand, 40ms behind it
        tr('body', 'transform.rotation', [k(0, 0), k(460, 4, 'easeOut'), k(1450, 3), k(1900, 0), k(2200, 0)]),
        tr('body', 'surface.yaw', [k(0, 0), k(500, 8, 'easeOut'), k(1600, 6), k(2000, 0)]),
        ...both('eye.openness', [k(0, 1), k(300, 1, 'linear'), k(480, 0.42, 'easeOut'), k(1600, 0.42), k(1900, 1), k(2200, 1)]),
        ...both('transform.scale.x', [k(0, 1), k(480, 1.18, 'easeOut'), k(1600, 1.18), k(1900, 1), k(2200, 1)]),
      ],
    },
    {
      // pebble → pill → blob → octopus → pebble, each change wound up and landed
      id: 'p_shapeshift', name: 'Shape Shifter', source: 'builtin', durationMs: 3200, tagline: 'Morph + Shape Keyframes',
      tracks: [
        tr('body', 'shape.path', [
          k(0, shape('pebble'), 'hold'), k(560, shape('pebble'), 'overshoot'),
          k(960, shape('capsule'), 'hold'), k(1320, shape('capsule'), 'elastic'), k(1860, shape('blob'), 'hold'),
          k(2100, shape('blob'), 'overshoot'), k(2560, shape('octopus'), 'hold'), k(2860, shape('octopus'), 'smooth'),
          k(3200, shape('pebble')),
        ]),
        ...squash('body', [[0, 1], [500, 0.93], [700, 1.06, 'easeOut'], [960, 1], [1300, 0.9], [1480, 1.05, 'easeOut'],
          [1700, 1], [2050, 0.92], [2300, 1.07, 'easeOut'], [2560, 1], [3200, 1]]),
        tr('body', 'flatOffset.y', [k(0, 0), k(2200, 0), k(2400, -14, 'easeOut'), k(2600, 0, 'easeIn'), k(3200, 0)]),
        ...both('eye.openness', [k(0, 1), k(1300, 1, 'linear'), k(1370, 0.06, 'easeIn'), k(1460, 1, 'easeOut'), k(3200, 1)]),
        ...both('transform.scale.x', [k(0, 1), k(2300, 1), k(2560, 1.22, 'overshoot'), k(2860, 1.22), k(3200, 1)]),
      ],
    },
    {
      // a sticker pops in over the head, the mascot looks up at it, and it floats there
      id: 'p_sticker', name: 'Pop In Sticker', source: 'builtin', durationMs: 2600, tagline: 'SVG + Pop + Attach',
      layers: [art('sticker', 'Sticker', STICKER, { ...onMascot(0, -262), size: { x: 96, y: 96 } })],
      appearances: [{ nodeId: 'sticker', startMs: 200, endMs: 2600, fadeOutMs: 220 }],
      tracks: [
        // 0 → 115% → 97% → 100%: the pop, then the settle
        ...uniform('sticker', [[200, 0, 'easeOut'], [420, 1.15], [560, 0.97], [700, 1], [2400, 1, 'easeIn'], [2600, 0]]),
        tr('sticker', 'transform.rotation', [k(200, -24, 'easeOut'), k(460, 8), k(700, 0, 'easeOut'), k(2400, 0, 'easeIn'), k(2600, -24)]),
        ...squash('body', [[200, 1], [330, 1.05, 'easeOut'], [560, 1], [2600, 1]]),
        tr('body', 'surface.pitch', [k(0, 0), k(260, 0, 'linear'), k(540, -13, 'easeOut'), k(2100, -11), k(2500, 0), k(2600, 0)]),
        tr('body', 'transform.rotation', [k(0, 0), k(540, -3, 'easeOut'), k(2100, -2), k(2500, 0)]),
        ...both('transform.scale.x', [k(0, 1), k(240, 1), k(480, 1.2, 'easeOut'), k(2100, 1.2), k(2500, 1)]),
      ],
      // secondary motion: it bobs gently once it has landed
      modifiers: [{ nodeId: 'sticker', kind: 'float', amount: 100, frequency: 0.7, amplitude: 7, phase: 0, startMs: 700, endMs: 2400 }],
    },
    {
      // the head turns until a flower on it slips round the rim, then looks back
      id: 'p_peek', name: 'Peek Around', source: 'builtin', durationMs: 3000, tagline: 'Surface Attach + Yaw/Pitch',
      layers: [art('flower', 'Flower', FLOWER, { ...onSurface(48, -32), size: { x: 58, y: 58 } })],
      appearances: [{ nodeId: 'flower', startMs: 0, endMs: 3000, fadeInMs: 160, fadeOutMs: 200 }],
      tracks: [
        tr('body', 'surface.yaw', [k(0, 0), k(300, -8), k(950, 58), k(1500, 58), k(2100, -34), k(2600, 0, 'easeOut'), k(3000, 0)]),
        tr('body', 'surface.pitch', [k(0, 0), k(950, -6, 'easeOut'), k(1500, -6), k(2100, 5), k(2600, 0)]),
        tr('body', 'transform.rotation', [k(0, 0), k(1000, 4, 'easeOut'), k(1500, 4), k(2140, -3), k(2640, 0)]),
        tr('flower', 'transform.rotation', [k(0, 0), k(1500, 0), k(1700, 12, 'easeOut'), k(1900, -6), k(2100, 0)]),
        ...both('eye.openness', [k(0, 1), k(1560, 1, 'linear'), k(1630, 0.06, 'easeIn'), k(1720, 1, 'easeOut'), k(3000, 1)]),
      ],
    },
    {
      // a sparkle, a morph into the octopus, limbs arriving, and a NEW badge on top
      id: 'p_newshape', name: 'New Shape!', source: 'builtin', durationMs: 3000, tagline: 'Morph + Limbs + Badge',
      layers: [
        art('sparkle', 'Sparkle', SPARKLE, { ...onMascot(-150, -175), size: { x: 64, y: 64 }, zIndex: -4 }),
        art('newBadge', 'NEW', NEW_BADGE, { ...onMascot(0, -236), size: { x: 120, y: 52 }, zIndex: 40 }),
        limb('arm', -1), limb('arm', 1), limb('leg', -1), limb('leg', 1),
      ],
      appearances: [
        { nodeId: 'sparkle', startMs: 80, endMs: 900, fadeInMs: 60, fadeOutMs: 220 },
        { nodeId: 'newBadge', startMs: 1350, endMs: 2450, fadeInMs: 60, fadeOutMs: 160 },
        ...['armL', 'armR', 'legL', 'legR'].map((nodeId) => ({ nodeId, startMs: 1050, endMs: 2700, fadeInMs: 220, fadeOutMs: 240 })),
      ],
      tracks: [
        ...uniform('sparkle', [[80, 0.2, 'overshoot'], [380, 1.1], [700, 1, 'easeIn'], [900, 0.2]]),
        tr('sparkle', 'transform.rotation', [k(80, 0, 'linear'), k(900, 90), k(3000, 0)]),
        tr('body', 'shape.path', [k(0, shape('circle'), 'hold'), k(700, shape('circle'), 'overshoot'), k(1250, shape('octopus'), 'hold'),
          k(2500, shape('octopus'), 'smooth'), k(3000, shape('circle'))]),
        ...squash('body', [[0, 1], [650, 0.9], [900, 1.08, 'easeOut'], [1250, 1], [3000, 1]]),
        tr('body', 'flatOffset.y', [k(0, 0), k(1250, 0), k(1450, -18, 'easeOut'), k(1700, 0, 'easeIn'), k(3000, 0)]),
        ...point('armL', 'b', [[1050, -196, 96], [1500, -205, -70, 'overshoot'], [2300, -205, -70], [2700, -196, 96]]),
        ...point('armR', 'b', [[1100, 196, 96], [1550, 205, -70, 'overshoot'], [2340, 205, -70], [2700, 196, 96]]),
        tr('armL', 'limb.length', [k(1050, 114), k(1500, 165, 'easeOut'), k(2300, 165), k(2700, 114)]),
        tr('armR', 'limb.length', [k(1100, 114), k(1550, 165, 'easeOut'), k(2340, 165), k(2700, 114)]),
        ...uniform('newBadge', [[1350, 0.6, 'overshoot'], [1560, 1], [2300, 1, 'easeIn'], [2450, 0.6]]),
        tr('newBadge', 'transform.rotation', [k(1350, -10, 'overshoot'), k(1600, -4), k(2450, -4), k(3000, -10)]),
        ...both('transform.scale.x', [k(0, 1), k(1100, 1), k(1300, 1.25, 'overshoot'), k(2400, 1.25), k(2900, 1)]),
        ...both('transform.length', [k(0, 1.55), k(1100, 1.55), k(1300, 1.8, 'overshoot'), k(2400, 1.8), k(2900, 1.55)]),
      ],
    },
    {
      // crouch, jump, land — knees bend out on every squash, feet stay planted, arms swing
      id: 'p_dance', name: 'Happy Dance', source: 'builtin', durationMs: 2800, tagline: '3-Point Legs + Squash',
      layers: [limb('arm', -1, { length: 140 }), limb('arm', 1, { length: 140 }), limb('leg', -1), limb('leg', 1)],
      appearances: ['armL', 'armR', 'legL', 'legR'].map((nodeId) => ({ nodeId, startMs: 0, endMs: 2800, fadeInMs: 120, fadeOutMs: 160 })),
      tracks: [
        tr('body', 'flatOffset.y', [k(0, 0), k(260, 16), k(520, -44, 'easeOut'), k(780, 12, 'easeIn'), k(960, 0, 'easeOut'),
          k(1240, 14), k(1480, -30, 'easeOut'), k(1720, 10, 'easeIn'), k(1900, 0, 'easeOut'), k(2800, 0)]),
        ...squash('body', [[0, 1], [260, 0.88], [520, 1.1, 'easeOut'], [780, 0.9, 'easeIn'], [960, 1], [1240, 0.9],
          [1480, 1.07, 'easeOut'], [1720, 0.92, 'easeIn'], [1900, 1], [2800, 1]]),
        tr('body', 'transform.rotation', [k(0, 0), k(560, -5, 'easeOut'), k(1040, 4), k(1520, -4), k(1940, 3), k(2340, 0, 'easeOut'), k(2800, 0)]),
        // the ankles are in the body's frame, so to keep the feet on the floor they move
        // up exactly as far as the body moves down — and hang a little on the jumps
        ...(['legL', 'legR'] as const).flatMap((id) => {
          const s = id === 'legL' ? -1 : 1;
          return [
            ...point(id, 'b', [[0, 68 * s, 176], [260, 92 * s, 168], [520, 58 * s, 184, 'easeOut'], [780, 90 * s, 168, 'easeIn'],
              [960, 68 * s, 176], [1240, 90 * s, 168], [1480, 60 * s, 184, 'easeOut'], [1720, 88 * s, 170, 'easeIn'], [1900, 68 * s, 176]]),
            ...point(id, 'c', [[0, 60 * s, 230], [260, 60 * s, 214], [520, 60 * s, 240, 'easeOut'], [780, 60 * s, 218, 'easeIn'],
              [960, 60 * s, 230], [1240, 60 * s, 216], [1480, 60 * s, 238, 'easeOut'], [1720, 60 * s, 220, 'easeIn'], [1900, 60 * s, 230]]),
          ];
        }),
        // arms swing in opposition, 40-80ms behind the body
        ...point('armL', 'b', [[40, -196, 96], [560, -214, -30, 'easeOut'], [1040, -180, 130], [1520, -214, -20, 'easeOut'], [1940, -196, 96]]),
        ...point('armR', 'b', [[80, 196, 96], [600, 180, 130, 'easeOut'], [1080, 214, -30], [1560, 182, 128, 'easeOut'], [1980, 196, 96]]),
        ...both('eye.openness', [k(0, 1), k(240, 0.38, 'easeOut'), k(2400, 0.38), k(2800, 1)]),
        ...both('transform.scale.x', [k(0, 1), k(240, 1.2, 'easeOut'), k(2400, 1.2), k(2800, 1)]),
      ],
      emitters: [joy()],
    },
    {
      // small to full size, a star circling the head, a morph, and the star flying off
      id: 'p_reveal', name: 'Magical Reveal', source: 'builtin', durationMs: 3400, tagline: 'Orbit + Morph + Scale',
      layers: [art('orbitStar', 'Star', ORBIT_STAR, { ...onSurface(-40, -28), size: { x: 44, y: 44 } })],
      appearances: [{ nodeId: 'orbitStar', startMs: 350, endMs: 3150, fadeInMs: 160, fadeOutMs: 300 }],
      tracks: [
        ...uniform('body', [[0, 1], [260, 0.6, 'easeIn'], [420, 0.58, 'overshoot'], [1000, 1], [3400, 1]]),
        // round the head on its surface — behind the rim and back out the other side
        tr('orbitStar', 'surface.yaw', [k(350, -40, 'linear'), k(2050, 320, 'easeOut')]),
        tr('orbitStar', 'transform.rotation', [k(350, 0, 'linear'), k(3150, 540), k(3400, 0)]),
        // then away from the head and off, as its range fades it out
        tr('orbitStar', 'flatOffset.x', [k(2050, 0, 'easeIn'), k(2750, 230), k(3150, 230), k(3400, 0)]),
        tr('orbitStar', 'flatOffset.y', [k(2050, 0, 'easeIn'), k(2750, -190), k(3150, -190), k(3400, 0)]),
        ...uniform('orbitStar', [[350, 0.4, 'overshoot'], [650, 1], [2050, 1, 'easeIn'], [2750, 0.5], [3150, 0.5], [3400, 0.4]]),
        tr('body', 'shape.path', [k(0, shape('circle'), 'hold'), k(1500, shape('circle'), 'elastic'), k(2100, shape('blob'), 'hold'),
          k(2700, shape('blob'), 'smooth'), k(3300, shape('circle'))]),
        tr('body', 'surface.yaw', [k(0, 0), k(350, 0), k(1100, -12), k(1700, 12), k(2300, -6), k(2800, 0, 'easeOut'), k(3400, 0)]),
        ...both('transform.scale.x', [k(0, 1), k(300, 1), k(900, 1.2, 'overshoot'), k(2600, 1.2), k(3200, 1)]),
      ],
    },
    ...manyMascots(),
  ];
}

/**
 * Presets with more than one mascot, and with words. A second mascot is a layer the preset
 * brings like any other — a body and its eyes, on screen for the clip — so "Two Friends"
 * on a bare project gives it a friend, and placed again reuses that friend.
 */
function manyMascots(): Preset[] {
  const wave = guideCurve('wavePath', 'Wave path',
    [[-300, -200], [-150, -260], [0, -200], [150, -140], [300, -200]],
    [[-300, -200], [-150, -140], [0, -200], [150, -260], [300, -200]]);
  // a body draws at twice its `size` — the default one is ~296px across — so friends stand
  // well clear of it, and a line over a mascot's head starts ~150px above its centre
  const pal = () => friend('pal', 'Pal', 'cute', 170, 10, 100);
  const palIn = (end: number) => [
    tr('pal', 'transform.scale.x', [k(0, 0.3, 'overshoot'), k(440, 1), k(end - 420, 1, 'easeIn'), k(end, 0.3)]),
    tr('pal', 'transform.scale.y', [k(0, 0.3, 'overshoot'), k(440, 1), k(end - 420, 1, 'easeIn'), k(end, 0.3)]),
  ];
  const parade: [string, string, MascotKind, number][] = [['march1', 'Pebble', 'cute', 68], ['march2', 'Blobby', 'blob', 68], ['march3', 'Octo', 'octopus', 72]];
  const crowd: [string, string, MascotKind, number, number, number][] = [
    ['crowd1', 'Mo', 'default', -262, 50, 70], ['crowd2', 'Pip', 'cute', 262, 50, 70],
    ['crowd3', 'Bo', 'blob', -175, 235, 60], ['crowd4', 'Oz', 'octopus', 175, 235, 62],
  ];
  const all: Preset[] = [
    {
      // a friend pops up beside the mascot; they turn to each other, bounce in turn, blink
      id: 'p_friends', name: 'Two Friends', source: 'builtin', durationMs: 3200, tagline: 'Two Mascots + Look At',
      layers: pal(),
      appearances: onFor('pal', 0, 3200, 160, 240),
      tracks: [
        tr('body', 'flatOffset.x', [k(0, 0), k(480, -150, 'easeOut'), k(2750, -150), k(3200, 0)]),
        ...palIn(3200),
        // the friend lands, then answers the mascot's bounce with one of its own, 100ms late
        tr('pal', 'flatOffset.y', [k(0, -40, 'easeIn'), k(360, 16, 'easeOut'), k(520, 10), ...jump(10, 1420, 30), k(3200, 10)]),
        tr('body', 'surface.yaw', [k(0, 0), k(700, 0), k(1000, 24, 'easeOut'), k(2400, 24), k(2800, 0), k(3200, 0)]),
        tr('pal', 'surface.yaw', [k(0, 0), k(760, 0), k(1060, -26, 'easeOut'), k(2460, -26), k(2860, 0)]),
        tr('body', 'flatOffset.y', [k(0, 0), ...jump(0, 1320), k(3200, 0)]),
        ...squash('body', [[0, 1], ...jumpSquash(1320), [3200, 1]]),
        ...both('eye.openness', blink(1900)),
        ...eyesOf('pal', 'eye.openness', blink(2020)),
      ],
    },
    {
      // the mascot wanders right and left; a small friend hangs on it — it goes wherever the
      // mascot goes because it is the mascot's child, and trails a beat behind on its own keys
      id: 'p_follow', name: 'Follow Me', source: 'builtin', durationMs: 3600, tagline: 'Mascot Follows Mascot',
      layers: friend('buddy', 'Buddy', 'blob', -230, 40, 64, 'body'),
      appearances: onFor('buddy', 0, 3600),
      tracks: [
        tr('body', 'flatOffset.x', [k(0, 0), k(300, -12), k(1100, 100), k(1500, 100), k(2300, -40), k(2700, -40), k(3400, 0, 'easeOut'), k(3600, 0)]),
        tr('body', 'transform.rotation', [k(0, 0), k(400, 6, 'easeOut'), k(1100, 0), k(1600, -6), k(2300, 0), k(2800, 4), k(3400, 0)]),
        // drag: pulled back as the mascot sets off, catching up with a little overshoot
        tr('buddy', 'flatOffset.x', [k(0, -230), k(350, -230), k(900, -250, 'easeOut'), k(1300, -224, 'overshoot'), k(1600, -230),
          k(1900, -206, 'easeOut'), k(2500, -233, 'overshoot'), k(2800, -230), k(3400, -220), k(3600, -230)]),
        tr('buddy', 'flatOffset.y', hops(40, 26, [400, 700, 1000, 1700, 2000, 2300, 3000, 3300])),
        tr('buddy', 'surface.yaw', [k(0, 0), k(500, 22, 'easeOut'), k(3200, 22), k(3600, 0)]),
        ...both('eye.openness', blink(2500)),
        ...eyesOf('buddy', 'eye.openness', blink(2580)),
      ],
    },
    {
      // the words run round the mascot's own outline — live, so they follow its shape
      id: 'p_around', name: 'Around You', source: 'builtin', durationMs: 3000, tagline: 'Text on the Mascot Outline',
      layers: [words('aroundText', 'Around', 'HELLO • HELLO • ', { size: 24, letterSpacing: 2, path: { mode: 'path', nodeId: 'body', baseline: 14 } })],
      appearances: [{ nodeId: 'aroundText', startMs: 0, endMs: 3000, fadeOutMs: 240 }],
      tracks: [
        tr('aroundText', 'text.path.offset', [k(0, -110, 'linear'), k(3000, 110)]),
        tr('aroundText', 'text.chars.kind', [k(0, 'pop', 'hold')]),
        tr('aroundText', 'text.chars.progress', [k(0, 0, 'easeOut'), k(800, 1)]),
        tr('body', 'surface.yaw', [k(0, 0), k(700, -18, 'easeOut'), k(1500, 18), k(2300, 0), k(3000, 0)]),
        tr('body', 'transform.rotation', [k(0, 0), k(800, -5), k(1800, 5), k(2600, 0), k(3000, 0)]),
        ...both('eye.openness', blink(1700)),
      ],
    },
    {
      // typed out with a nod for every couple of letters, then one big bounce
      id: 'p_typebounce', name: 'Type & Bounce', source: 'builtin', durationMs: 2800, tagline: 'Typewriter + Squash',
      layers: [words('typeText', 'Typed', 'HELLO THERE', { size: 44 }, { surface: flat(0, -250) })],
      appearances: [{ nodeId: 'typeText', startMs: 0, endMs: 2800, fadeOutMs: 200 }],
      tracks: [
        tr('typeText', 'text.reveal.end', [k(0, 0, 'linear'), k(1200, 11)]),
        tr('body', 'flatOffset.y', [
          ...[0, 220, 440, 660, 880, 1100].flatMap((t) => [k(t, 0, 'easeOut'), k(t + 110, -7, 'easeIn')]),
          k(1320, 0), ...jump(0, 1400), k(2800, 0),
        ]),
        ...squash('body', [[0, 1], ...jumpSquash(1400), [2800, 1]]),
        ...uniform('typeText', [[0, 1], [1600, 1], [1740, 1.12, 'easeOut'], [1940, 1], [2800, 1]]),
        ...both('eye.openness', [k(0, 1), k(1400, 1), k(1560, 0.4, 'easeOut'), k(2400, 0.4), k(2700, 1)]),
      ],
    },
    {
      // a drawn wave that moves — path keyframes — with words riding along it
      id: 'p_wavepath', name: 'Wave Path', source: 'builtin', durationMs: 3400, tagline: 'Curve + Path Keyframes + Text',
      layers: [wave.node, words('waveText', 'Wave', 'RIDE THE WAVE', { size: 30, path: { mode: 'path', nodeId: 'wavePath', baseline: 8 } })],
      appearances: [
        { nodeId: 'wavePath', startMs: 0, endMs: 3400, fadeInMs: 200, fadeOutMs: 240 },
        { nodeId: 'waveText', startMs: 0, endMs: 3400, fadeInMs: 200, fadeOutMs: 240 },
      ],
      tracks: [
        tr('wavePath', 'shape.path', [k(0, wave.a), k(850, wave.b), k(1700, wave.a), k(2550, wave.b), k(3400, wave.a)]),
        tr('waveText', 'text.path.offset', [k(0, -190, 'linear'), k(3400, 190)]),
        tr('body', 'surface.pitch', [k(0, 0), k(400, -12, 'easeOut'), k(3000, -12), k(3400, 0)]),
        tr('body', 'surface.yaw', [k(0, 0), k(500, -18), k(2900, 18), k(3400, 0)]),
      ],
    },
    {
      // one says hi, the other answers — each line pops in over whoever is talking
      id: 'p_conversation', name: 'Conversation', source: 'builtin', durationMs: 3600, tagline: 'Two Mascots + Speech Text',
      layers: [
        ...pal(),
        words('sayHi', 'Line 1', 'Hi there!', { size: 30 }, { parentId: 'body', surface: flat(0, -182) }),
        words('sayHey', 'Line 2', 'Hey you!', { size: 30 }, { parentId: 'pal', surface: flat(0, -118) }),
      ],
      appearances: [
        ...onFor('pal', 0, 3600, 160, 240),
        { nodeId: 'sayHi', startMs: 350, endMs: 1500, fadeInMs: 40, fadeOutMs: 160 },
        { nodeId: 'sayHey', startMs: 1650, endMs: 2900, fadeInMs: 40, fadeOutMs: 160 },
      ],
      tracks: [
        tr('body', 'flatOffset.x', [k(0, 0), k(400, -150, 'easeOut'), k(3150, -150), k(3600, 0)]),
        ...palIn(3600),
        tr('pal', 'flatOffset.y', [k(0, -40, 'easeIn'), k(340, 16, 'easeOut'), k(500, 10)]),
        tr('body', 'surface.yaw', [k(0, 0), k(300, 24, 'easeOut'), k(3200, 24), k(3600, 0)]),
        tr('pal', 'surface.yaw', [k(0, 0), k(360, -26, 'easeOut'), k(3200, -26), k(3600, 0)]),
        tr('body', 'transform.rotation', talk(400, 1500)),
        tr('pal', 'transform.rotation', talk(1700, 2900)),
        ...(['sayHi', 'sayHey'] as const).flatMap((id, i) => [
          tr(id, 'text.chars.kind', [k(0, 'pop', 'hold')]),
          tr(id, 'text.chars.progress', [k(350 + i * 1300, 0, 'easeOut'), k(850 + i * 1300, 1)]),
        ]),
        ...both('eye.openness', blink(2200)),
        ...eyesOf('pal', 'eye.openness', blink(1000)),
      ],
    },
    {
      // three small mascots of different shapes march past; the mascot changes shape with each
      id: 'p_parade', name: 'Shape Parade', source: 'builtin', durationMs: 3600, tagline: 'Mascot Shapes on the March',
      layers: parade.flatMap(([id, name, kind, w]) => friend(id, name, kind, -440, 250, w)),
      appearances: parade.flatMap(([id]) => onFor(id, 0, 3600, 0, 200)),
      tracks: [
        ...parade.flatMap(([id], i) => {
          const from = i * 600;
          const steps = Array.from({ length: 8 }, (_, j) => from + j * 300);
          return [
            tr(id, 'flatOffset.x', from ? [k(0, -440, 'hold'), k(from, -440, 'linear'), k(from + 2400, 440)] : [k(0, -440, 'linear'), k(2400, 440)]),
            tr(id, 'flatOffset.y', hops(250, 22, steps)),
            tr(id, 'transform.rotation', [k(0, 0), ...steps.map((t, j) => k(t + 150, j % 2 ? 7 : -7)), k(Math.min(3600, from + 2550), 0)]),
          ];
        }),
        tr('body', 'shape.path', [k(0, shape('circle'), 'hold'), k(560, shape('circle'), 'overshoot'), k(900, shape('pebble'), 'hold'),
          k(1160, shape('pebble'), 'overshoot'), k(1500, shape('blob'), 'hold'), k(1760, shape('blob'), 'overshoot'),
          k(2100, shape('octopus'), 'hold'), k(3000, shape('octopus'), 'smooth'), k(3500, shape('circle'))]),
        ...squash('body', [[0, 1], [860, 0.92], [1000, 1.05, 'easeOut'], [1140, 1], [1460, 0.92], [1600, 1.05, 'easeOut'], [1740, 1],
          [2060, 0.92], [2200, 1.05, 'easeOut'], [2400, 1], [3600, 1]]),
        tr('body', 'surface.yaw', [k(0, 0), k(400, -26, 'easeOut'), k(3000, 26), k(3500, 0)]),
        tr('body', 'surface.pitch', [k(0, 0), k(400, 10, 'easeOut'), k(3100, 10), k(3500, 0)]),
      ],
    },
    {
      // four friends round the mascot, all jumping for joy in a ripple, 110ms apart
      id: 'p_crowd', name: 'Crowd', source: 'builtin', durationMs: 3000, tagline: 'Five Mascots + Staggered Timing',
      layers: crowd.flatMap(([id, name, kind, x, y, w]) => friend(id, name, kind, x, y, w)),
      appearances: crowd.flatMap(([id], i) => onFor(id, i * 120, 3000, 220, 240)),
      tracks: [
        ...crowd.flatMap(([id, , , , y], i) => {
          const a = 600 + (i + 1) * 110, b = 1500 + (i + 1) * 110;
          return [
            tr(id, 'flatOffset.y', [k(0, y), ...jump(y, a, 34), ...jump(y, b, 34), k(3000, y)]),
            ...squash(id, [[0, 1], ...jumpSquash(a), ...jumpSquash(b), [3000, 1]]),
            ...eyesOf(id, 'eye.openness', [k(0, 1), k(a - 100, 1), k(a + 40, 0.4, 'easeOut'), k(2500, 0.4), k(2800, 1)]),
          ];
        }),
        tr('body', 'flatOffset.y', [k(0, 0), ...jump(0, 600), ...jump(0, 1500), k(3000, 0)]),
        ...squash('body', [[0, 1], ...jumpSquash(600), ...jumpSquash(1500), [3000, 1]]),
        ...both('eye.openness', [k(0, 1), k(480, 1), k(620, 0.4, 'easeOut'), k(2500, 0.4), k(2800, 1)]),
      ],
      emitters: [joy()],
    },
  ];
  return all.map(looped);
}
