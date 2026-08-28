import type { EasingCurve, Emitter, Expression, Keyframe, KeyValue, Preset, Project, Rig, RigNode, Timeline, Track } from './types';
import { derivedDuration } from './timeline';
import { primitivePath } from './path';

export const uid = (p = 'n') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const COMP = { width: 720, height: 720 };

export const BONE = { r: 242, g: 239, b: 233, a: 1 };
/** Mood colours the built-in presets animate the body into and back out of. */
export const ANGRY_RED = { r: 214, g: 74, b: 58, a: 1 };
export const COLD_BLUE = { r: 150, g: 203, b: 232, a: 1 };
export const SAD_BLUE = { r: 176, g: 192, b: 214, a: 1 };
export const TEAR_BLUE = { r: 96, g: 160, b: 225, a: 1 };
export const DROWSY = { r: 108, g: 106, b: 128, a: 1 };
export const INK = { r: 20, g: 19, b: 24, a: 1 };

const ease = (name: string): EasingCurve =>
  name === 'linear' ? { type: 'linear' } : { type: 'preset', name: name as 'easeInOut' };

export const kf = (time: number, value: KeyValue, easing = 'easeInOut'): Keyframe => ({
  id: uid('k'), time, value, easingOut: ease(easing),
});

const track = (nodeId: string, property: string, keyframes: Keyframe[]): Track => ({
  id: uid('t'), nodeId, property, keyframes,
});

export function makeBody(): RigNode {
  return {
    id: 'body', name: 'Body', kind: 'body', parentId: null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 148, y: 148 },
    color: BONE, visible: true, zIndex: 0,
  };
}

export function makeEye(id: string, distance: number): RigNode {
  return {
    id, name: distance < 0 ? 'Left eye' : 'Right eye', kind: 'eye', parentId: 'body',
    surface: { yaw: 0, pitch: -4, mapped: true },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1.55 },
    size: { x: 38, y: 38 },
    color: INK, visible: true, zIndex: 1,
    eye: { linkedToId: null, openness: 1, distanceFromCenter: distance },
  };
}

export function defaultRig(): Rig {
  const nodes: Record<string, RigNode> = {};
  for (const n of [makeBody(), makeEye('eyeL', -21), makeEye('eyeR', 21)]) nodes[n.id] = n;
  return { id: uid('rig'), nodes, rootId: 'body', camera: { fov: 28, distance: 6, offset: { x: 0, y: 0 } } };
}

/* ---- built-in presets: self-contained mini-timelines starting at 0 ---------- */

/**
 * An emitter with everything unremarkable already filled in.
 *
 * A preset should read as what makes it different — the glyphs and where they go — not as
 * fourteen fields of which twelve are the same every time.
 */
const emit = (e: Partial<Omit<Emitter, 'id' | 'blockId'>> & Pick<Emitter, 'name' | 'glyphs' | 'to'>): Omit<Emitter, 'id' | 'blockId'> => ({
  color: DROWSY, size: 26, path: 'arc', from: { x: 0, y: -40 }, bow: 0,
  rateMs: 420, lifeMs: 1800, count: 4, fadeStart: 0.5,
  scaleFrom: 0.6, scaleTo: 1.2, spin: 0, wobble: 3, wobbleFrequency: 1.2, seed: 7,
  ...e,
});

/** The eye's own drawn outline, as a path — the morph's resting pose, so nothing pops. */
const PILL = primitivePath('rect', { cornerRadius: 0.5 });
const STAR = primitivePath('star', { points: 5, innerRatio: 0.45 });
const STAR_YELLOW = { r: 247, g: 201, b: 72, a: 1 };

const bothEyes = (property: string, keys: Keyframe[]): Track[] => [
  track('eyeL', property, keys),
  track('eyeR', property, keys.map((k) => ({ ...k, id: uid('k') }))),
];

export function builtinPresets(): Preset[] {
  return [
    {
      // no tracks at all — dropped into a sequence it just holds whatever pose already
      // precedes it (the rig's own rest pose if it's first). The "base state" clip §8
      // asks for, for free: addBlock() already no-ops its track-copy loop on an empty
      // preset, so this needs no new machinery, just an entry that says so.
      id: 'p_neutral', name: 'Neutral', source: 'builtin', durationMs: 800, tracks: [],
    },
    {
      id: 'p_idle', name: 'Idle', source: 'builtin', durationMs: 2400,
      tracks: [
        track('body', 'flatOffset.y', [kf(0, 0), kf(1200, -7), kf(2400, 0)]),
        track('body', 'surface.yaw', [kf(0, 0), kf(1600, 4), kf(2400, 0)]),
        ...bothEyes('eye.openness', [kf(0, 1, 'linear'), kf(1700, 1, 'linear'), kf(1790, 0.06), kf(1880, 1)]),
      ],
    },
    {
      id: 'p_blink', name: 'Blink', source: 'builtin', durationMs: 900,
      tracks: bothEyes('eye.openness', [kf(0, 1, 'linear'), kf(240, 0.06, 'easeIn'), kf(360, 1, 'easeOut'), kf(560, 1, 'linear'), kf(700, 0.06, 'easeIn'), kf(820, 1, 'easeOut')]),
    },
    {
      id: 'p_talk', name: 'Talk', source: 'builtin', durationMs: 1600,
      tracks: [
        track('body', 'transform.scale.y', [kf(0, 1), kf(200, 1.05), kf(400, 0.97), kf(600, 1.04), kf(800, 0.98), kf(1000, 1.05), kf(1200, 0.98), kf(1600, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(200, 0.97), kf(400, 1.03), kf(600, 0.98), kf(800, 1.02), kf(1000, 0.97), kf(1200, 1.02), kf(1600, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(300, 1.3), kf(700, 1.6), kf(1100, 1.35), kf(1600, 1.55)]),
      ],
    },
    {
      // Happy read as "blinks a bit while hopping". A smile on this rig is the eyes
      // becoming *arcs* — squashed flat and widened, not just narrowed — and the hop needs
      // anticipation (a crouch) and squash on landing, or it is a floating rectangle.
      id: 'p_happy', name: 'Happy', source: 'builtin', durationMs: 1600,
      tracks: [
        ...bothEyes('eye.openness', [kf(0, 1), kf(120, 1, 'linear'), kf(320, 0.34, 'easeOut'), kf(1200, 0.34), kf(1600, 1)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(320, 1.34, 'easeOut'), kf(1200, 1.34), kf(1600, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(320, 1.05, 'easeOut'), kf(1200, 1.05), kf(1600, 1.55)]),
        // crouch, leap, land with a squash, small second hop
        track('body', 'flatOffset.y', [kf(0, 0), kf(160, 9, 'easeInOut'), kf(430, -34, 'easeOut'), kf(700, 0, 'easeIn'), kf(860, -13, 'easeOut'), kf(1060, 0, 'easeIn'), kf(1600, 0)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(160, 0.9, 'easeInOut'), kf(430, 1.1, 'easeOut'), kf(700, 0.92, 'easeIn'), kf(840, 1.03), kf(1060, 1), kf(1600, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(160, 1.09, 'easeInOut'), kf(430, 0.93, 'easeOut'), kf(700, 1.07, 'easeIn'), kf(840, 0.98), kf(1060, 1), kf(1600, 1)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(430, -4, 'easeOut'), kf(860, 3), kf(1200, 0, 'elastic'), kf(1600, 0)]),
      ],
    },
    {
      // Surprised was a slow symmetrical grow, which reads as "inflating". A startle is a
      // recoil: a hard fast pop with the head snapping BACK, held wide, then a settle.
      id: 'p_surprised', name: 'Surprised', source: 'builtin', durationMs: 1300,
      tracks: [
        // properly saucer-eyed: this was a 1.7x nudge that read as mild interest
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(90, 2.35, 'easeOut'), kf(820, 2.2), kf(1300, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(90, 2.5, 'easeOut'), kf(820, 2.35), kf(1300, 1.55)]),
        // NOT bothEyes: distanceFromCenter is signed by side, so copying one eye's values
        // onto the other would fling the left eye across the face
        track('eyeL', 'eye.distanceFromCenter', [kf(0, -21), kf(90, -25, 'easeOut'), kf(820, -24), kf(1300, -21)]),
        track('eyeR', 'eye.distanceFromCenter', [kf(0, 21), kf(90, 25, 'easeOut'), kf(820, 24), kf(1300, 21)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(90, 1, 'linear'), kf(1300, 1, 'linear')]),
        // the recoil: away and up, then back down to rest
        track('body', 'surface.pitch', [kf(0, 0), kf(110, -9, 'easeOut'), kf(520, -6), kf(900, 1), kf(1300, 0, 'easeOut')]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(90, 1.16, 'easeOut'), kf(420, 1.09), kf(820, 1.06), kf(1300, 1, 'easeOut')]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(90, 0.93, 'easeOut'), kf(420, 1.02), kf(820, 1.04), kf(1300, 1, 'easeOut')]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(90, -14, 'easeOut'), kf(430, -4), kf(820, -2), kf(1300, 0, 'easeOut')]),
      ],
    },
    {
      id: 'p_thinking', name: 'Thinking', source: 'builtin', durationMs: 2200,
      tracks: [
        track('body', 'surface.yaw', [kf(0, 0), kf(600, -20), kf(1600, -20), kf(2200, 0)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(600, -10), kf(1600, -10), kf(2200, 0)]),
        track('eyeL', 'eye.openness', [kf(0, 1), kf(600, 0.5), kf(1600, 0.5), kf(2200, 1)]),
        track('eyeR', 'surface.pitch', [kf(0, -4), kf(700, -14), kf(1500, -14), kf(2200, -4)]),
      ],
    },
    {
      // this was called Notify, but a head shaking side to side is a refusal, not an
      // announcement. Renamed to what it does; the real Notify is below.
      id: 'p_decline', name: 'Decline', source: 'builtin', durationMs: 1300,
      tracks: [
        track('body', 'surface.yaw', [kf(0, 0), kf(150, 16, 'easeOut'), kf(330, -14), kf(500, 10), kf(670, -6), kf(900, 0, 'elastic'), kf(1300, 0)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(150, -5, 'easeOut'), kf(400, 4), kf(700, -2), kf(1000, 0, 'elastic'), kf(1300, 0)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(150, 1.3, 'easeOut'), kf(700, 1), kf(1300, 1)]),
      ],
    },
    {
      id: 'p_notify', name: 'Notify', source: 'builtin', durationMs: 1600,
      tracks: [
        // a perk-up: anticipate down, snap up and lean toward the badge, settle
        track('body', 'flatOffset.y', [kf(0, 0), kf(180, 6, 'easeInOut'), kf(340, -16, 'easeOut'), kf(620, -4), kf(1000, 0, 'elastic'), kf(1600, 0)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(340, 7, 'easeOut'), kf(760, -3), kf(1100, 0, 'elastic'), kf(1600, 0)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(340, -7, 'easeOut'), kf(1000, -3), kf(1600, 0)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(340, 1.32, 'easeOut'), kf(1000, 1.32), kf(1600, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(340, 1.85, 'easeOut'), kf(1000, 1.85), kf(1600, 1.55)]),
      ],
      emitters: [emit({
        name: 'badge', glyphs: ['!'], color: { r: 226, g: 88, b: 62, a: 1 }, size: 34,
        from: { nodeId: 'body', x: 42, y: -46 }, to: { nodeId: 'body', x: 58, y: -84 },
        rateMs: 700, lifeMs: 1300, count: 2, fadeStart: 0.6,
        scaleFrom: 0.2, scaleTo: 1.15, wobble: 2, startMs: 260,
      })],
    },

    /* ---- moods ------------------------------------------------------------- */
    {
      id: 'p_sleepy', name: 'Sleepy', source: 'builtin', durationMs: 4600,
      tracks: [
        ...bothEyes('eye.openness', [kf(0, 1), kf(300, 1, 'linear'), kf(760, 0.1, 'easeInOut'), kf(4100, 0.1), kf(4600, 1)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(300, 0, 'linear'), kf(900, 11, 'easeInOut'), kf(4100, 11), kf(4600, 0)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(900, 5, 'easeInOut'), kf(4100, 5), kf(4600, 0)]),
        // the breath: two slow cycles, in slower than out, scale.x/y opposed so volume holds
        track('body', 'transform.scale.y', [kf(900, 1), kf(2000, 1.045, 'easeInOut'), kf(2650, 1, 'easeOut'), kf(3450, 1.045, 'easeInOut'), kf(4100, 1, 'easeOut')]),
        track('body', 'transform.scale.x', [kf(900, 1), kf(2000, 0.975, 'easeInOut'), kf(2650, 1, 'easeOut'), kf(3450, 0.975, 'easeInOut'), kf(4100, 1, 'easeOut')]),
        track('body', 'flatOffset.y', [kf(900, 0), kf(2000, -5, 'easeInOut'), kf(2650, 0, 'easeOut'), kf(3450, -5, 'easeInOut'), kf(4100, 0, 'easeOut')]),
      ],
      emitters: [emit({
        name: 'zzz', glyphs: ['z', 'z', 'Z'],
        from: { nodeId: 'body', x: 46, y: -34 }, to: { nodeId: 'body', x: 118, y: -150 },
        bow: 22, rateMs: 700, lifeMs: 2100, count: 3, fadeStart: 0.42,
        scaleFrom: 0.45, scaleTo: 1.35, spin: -12, wobble: 5, startMs: 900, endMs: 4100,
      })],
    },
    {
      id: 'p_angry', name: 'Angry', source: 'builtin', durationMs: 1800,
      tracks: [
        track('body', 'color', [kf(0, BONE), kf(420, ANGRY_RED, 'easeOut'), kf(1400, ANGRY_RED), kf(1800, BONE)]),
        // eyes narrowed and angled inward — this rig has no brows, so the tilt IS the scowl
        ...bothEyes('transform.length', [kf(0, 1.55), kf(300, 0.82, 'easeOut'), kf(1400, 0.82), kf(1800, 1.55)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(300, 1.2, 'easeOut'), kf(1400, 1.2), kf(1800, 1)]),
        // SVG rotates clockwise for a positive angle, so an angry scowl — INNER ends down —
        // is +ve on the left eye and -ve on the right. These were the wrong way round,
        // which read as surprise rather than anger.
        track('eyeL', 'transform.rotation', [kf(0, 0), kf(300, 20, 'easeOut'), kf(1400, 20), kf(1800, 0)]),
        track('eyeR', 'transform.rotation', [kf(0, 0), kf(300, -20, 'easeOut'), kf(1400, -20), kf(1800, 0)]),
        // swelling up, then a hard forward lunge
        track('body', 'transform.scale.x', [kf(0, 1), kf(300, 1.1, 'easeOut'), kf(1400, 1.1), kf(1800, 1)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(300, 1.08, 'easeOut'), kf(900, 1.14), kf(1400, 1.08), kf(1800, 1)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(300, 0, 'linear'), kf(560, 8, 'easeOut'), kf(1400, 6), kf(1800, 0)]),
      ],
      modifiers: [{ nodeId: 'body', kind: 'shake', amount: 100, frequency: 16, amplitude: 5, seed: 4, startMs: 300, endMs: 1400 }],
    },
    {
      id: 'p_cold', name: 'Cold', source: 'builtin', durationMs: 2400,
      tracks: [
        // layers offset 40-80ms behind whatever drives them: the hunch leads, the colour
        // follows it, the eyes come last. Keyed on identical frames it read as machine-made
        // — the copilot's own critic said so when run over these presets.
        track('body', 'transform.scale.y', [kf(0, 1), kf(360, 0.92, 'easeOut'), kf(1960, 0.92), kf(2400, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(360, 1.07, 'easeOut'), kf(1960, 1.07), kf(2400, 1)]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(430, 8, 'easeOut'), kf(2020, 8), kf(2400, 0)]),
        track('body', 'color', [kf(0, BONE), kf(500, COLD_BLUE, 'easeOut'), kf(2000, COLD_BLUE), kf(2400, BONE)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(560, 0.5, 'easeOut'), kf(2060, 0.5), kf(2400, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(560, 1.15, 'easeOut'), kf(2060, 1.15), kf(2400, 1.55)]),
      ],
      // a shiver is fast and small — the opposite dial positions from an angry shake
      modifiers: [{ nodeId: 'body', kind: 'shake', amount: 100, frequency: 24, amplitude: 3, seed: 11, startMs: 400, endMs: 2000 }],
    },
    {
      id: 'p_sad', name: 'Sad', source: 'builtin', durationMs: 2600,
      tracks: [
        // the head drops first and everything else follows it down, 40-80ms apart
        track('body', 'surface.pitch', [kf(0, 0), kf(640, 16, 'easeInOut'), kf(2060, 14), kf(2600, 0)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(700, 0.93, 'easeInOut'), kf(2100, 0.93), kf(2600, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(700, 1.05, 'easeInOut'), kf(2100, 1.05), kf(2600, 1)]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(760, 12, 'easeInOut'), kf(2140, 12), kf(2600, 0)]),
        track('body', 'color', [kf(0, BONE), kf(820, SAD_BLUE, 'easeInOut'), kf(2100, SAD_BLUE), kf(2600, BONE)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(880, 0.55, 'easeInOut'), kf(2180, 0.55), kf(2600, 1)]),
        // OUTER corners down, the exact inverse of Angry's inward scowl
        track('eyeL', 'transform.rotation', [kf(0, 0), kf(940, -14, 'easeInOut'), kf(2220, -14), kf(2600, 0)]),
        track('eyeR', 'transform.rotation', [kf(0, 0), kf(940, 14, 'easeInOut'), kf(2220, 14), kf(2600, 0)]),
      ],
    },
    {
      id: 'p_crying', name: 'Crying', source: 'builtin', durationMs: 3000,
      tracks: [
        track('body', 'surface.pitch', [kf(0, 0), kf(600, 13, 'easeInOut'), kf(2500, 12), kf(3000, 0)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(600, 0.32, 'easeInOut'), kf(2500, 0.32), kf(3000, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(600, 0.95, 'easeInOut'), kf(2500, 0.95), kf(3000, 1.55)]),
        // sobbing: scale.x and scale.y opposed on a fast cycle, so it squishes rather than pulses
        track('body', 'transform.scale.y', [kf(600, 1), kf(1000, 0.9, 'easeInOut'), kf(1400, 1.02), kf(1800, 0.9, 'easeInOut'), kf(2200, 1.02), kf(2500, 1, 'easeOut'), kf(3000, 1)]),
        track('body', 'transform.scale.x', [kf(600, 1), kf(1000, 1.09, 'easeInOut'), kf(1400, 0.98), kf(1800, 1.09, 'easeInOut'), kf(2200, 0.98), kf(2500, 1, 'easeOut'), kf(3000, 1)]),
      ],
      // one emitter per eye, each ANCHORED to that eye — which is the whole point of
      // anchors: the drops leave the eyes wherever the head has moved them to
      emitters: [
        emit({
          name: 'tear L', glyphs: ['\u25cf'], color: TEAR_BLUE, size: 13, path: 'fall',
          from: { nodeId: 'eyeL', x: -4, y: 12 }, to: { nodeId: 'eyeL', x: -22, y: 150 },
          bow: 8, rateMs: 380, lifeMs: 1200, count: 4, fadeStart: 0.65,
          scaleFrom: 0.7, scaleTo: 1.1, wobble: 2, startMs: 700, endMs: 2500, seed: 2,
        }),
        emit({
          name: 'tear R', glyphs: ['\u25cf'], color: TEAR_BLUE, size: 13, path: 'fall',
          from: { nodeId: 'eyeR', x: 4, y: 12 }, to: { nodeId: 'eyeR', x: 22, y: 150 },
          bow: -8, rateMs: 380, lifeMs: 1200, count: 4, fadeStart: 0.65,
          scaleFrom: 0.7, scaleTo: 1.1, wobble: 2, startMs: 900, endMs: 2500, seed: 9,
        }),
      ],
    },
    {
      id: 'p_singing', name: 'Singing', source: 'builtin', durationMs: 3200,
      tracks: [
        // the same open/close as Talk, slower and wider — singing holds its notes
        track('body', 'transform.scale.y', [kf(0, 1), kf(400, 1.07), kf(800, 0.96), kf(1300, 1.08), kf(1800, 0.97), kf(2300, 1.06), kf(2800, 0.98), kf(3200, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(400, 0.96), kf(800, 1.04), kf(1300, 0.95), kf(1800, 1.03), kf(2300, 0.96), kf(2800, 1.02), kf(3200, 1)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(800, -6, 'easeInOut'), kf(1800, 6, 'easeInOut'), kf(2600, -4, 'easeInOut'), kf(3200, 0)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(400, 0.4, 'easeInOut'), kf(2800, 0.4), kf(3200, 1)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(400, 1.28, 'easeInOut'), kf(2800, 1.28), kf(3200, 1)]),
      ],
      emitters: [emit({
        name: 'notes', glyphs: ['\u266a', '\u266b', '\u2669', '\u266c'],
        color: { r: 58, g: 60, b: 90, a: 1 }, size: 30,
        from: { nodeId: 'body', x: -44, y: -26 }, to: { nodeId: 'body', x: -140, y: -134 },
        bow: -26, rateMs: 520, lifeMs: 1900, count: 4, fadeStart: 0.5,
        scaleFrom: 0.5, scaleTo: 1.25, spin: 18, wobble: 7, startMs: 300, endMs: 2900, seed: 5,
      })],
    },
    {
      id: 'p_confused', name: 'Confused', source: 'builtin', durationMs: 2400,
      tracks: [
        // head cocked and held, then the second-guess: it tips the other way and back
        track('body', 'transform.rotation', [kf(0, 0), kf(400, -15, 'easeOut'), kf(1100, -15), kf(1500, 9, 'easeInOut'), kf(2000, -6), kf(2400, 0, 'easeOut')]),
        track('body', 'surface.yaw', [kf(0, 0), kf(400, -12, 'easeOut'), kf(1100, -12), kf(1500, 8), kf(2400, 0)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(400, -5, 'easeOut'), kf(2000, -5), kf(2400, 0)]),
        // one eye wide, the other narrowed — asymmetry is what reads as "confused"
        track('eyeL', 'transform.scale.x', [kf(0, 1), kf(400, 1.3, 'easeOut'), kf(2000, 1.3), kf(2400, 1)]),
        track('eyeL', 'transform.length', [kf(0, 1.55), kf(400, 1.85, 'easeOut'), kf(2000, 1.85), kf(2400, 1.55)]),
        track('eyeR', 'eye.openness', [kf(0, 1), kf(400, 0.45, 'easeOut'), kf(2000, 0.45), kf(2400, 1)]),
        track('eyeR', 'transform.length', [kf(0, 1.55), kf(400, 1.1, 'easeOut'), kf(2000, 1.1), kf(2400, 1.55)]),
      ],
      emitters: [emit({
        name: 'question', glyphs: ['?'], color: { r: 70, g: 70, b: 96, a: 1 }, size: 34,
        from: { nodeId: 'body', x: 52, y: -40 }, to: { nodeId: 'body', x: 96, y: -128 },
        bow: 16, rateMs: 900, lifeMs: 1500, count: 2, fadeStart: 0.55,
        scaleFrom: 0.35, scaleTo: 1.2, spin: 14, wobble: 4, startMs: 500, endMs: 2000,
      })],
    },
    {
      id: 'p_curious', name: 'Curious', source: 'builtin', durationMs: 2200,
      tracks: [
        // lean in, look around, hold — a curious head moves toward what it is looking at
        track('body', 'transform.rotation', [kf(0, 0), kf(360, 11, 'easeOut'), kf(1500, 11), kf(2200, 0, 'easeOut')]),
        track('body', 'surface.yaw', [kf(0, 0), kf(360, 14, 'easeOut'), kf(900, 14), kf(1350, -10, 'easeInOut'), kf(1800, 4), kf(2200, 0)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(360, -8, 'easeOut'), kf(1800, -6), kf(2200, 0)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(360, 1.06, 'easeOut'), kf(1800, 1.06), kf(2200, 1)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(360, 1.06, 'easeOut'), kf(1800, 1.06), kf(2200, 1)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(360, 1.3, 'easeOut'), kf(1800, 1.3), kf(2200, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(360, 1.85, 'easeOut'), kf(1800, 1.85), kf(2200, 1.55)]),
      ],
    },
    {
      id: 'p_float', name: 'Float', source: 'builtin', durationMs: 3000,
      tracks: [...bothEyes('eye.openness', [kf(0, 1), kf(3000, 1, 'linear')])],
      // pure effect: a slow bob with an even slower sway, deliberately out of phase so it
      // never repeats the same shape twice inside one clip
      modifiers: [
        { nodeId: 'body', kind: 'float', amount: 100, frequency: 0.42, amplitude: 11, phase: 0 },
        { nodeId: 'body', kind: 'pendulum', axis: 'rotation', amount: 100, frequency: 0.27, amplitude: 5, phase: 1.1 },
      ],
    },
    {
      id: 'p_watching', name: 'Watching', source: 'builtin', durationMs: 4000,
      tracks: [
        // eyes up, head tracking the orbit — one full sweep matching the emitter's period
        track('body', 'surface.pitch', [kf(0, 0), kf(500, -14, 'easeOut'), kf(3500, -14), kf(4000, 0)]),
        track('body', 'surface.yaw', [kf(500, 0), kf(1300, 17, 'easeInOut'), kf(2300, 0, 'easeInOut'), kf(3100, -17, 'easeInOut'), kf(3500, 0, 'easeInOut'), kf(4000, 0)]),
        track('body', 'transform.rotation', [kf(500, 0), kf(1300, 5, 'easeInOut'), kf(2300, 0), kf(3100, -5, 'easeInOut'), kf(4000, 0)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(500, 1.2, 'easeOut'), kf(3500, 1.2), kf(4000, 1)]),
      ],
      emitters: [emit({
        name: 'orbit', glyphs: ['\u2726', '\u25cf', '\u25b2', '\u2726'],
        color: { r: 84, g: 82, b: 112, a: 1 }, size: 20, path: 'orbit',
        from: { nodeId: 'body', x: 0, y: -128 }, to: { x: 0, y: 0 },
        radiusX: 104, radiusY: 34,
        rateMs: 600, lifeMs: 2400, count: 4, fadeStart: 0.85,
        scaleFrom: 0.85, scaleTo: 1, spin: 40, wobble: 3, startMs: 400, endMs: 3600,
      })],
    },
    {
      // the eyes literally become stars: two keyframes on shape.path, and core/path.ts
      // resamples both outlines so the in-between is a real shape rather than a switch
      id: 'p_excited', name: 'Excited', source: 'builtin', durationMs: 2000,
      tracks: [
        ...bothEyes('shape.path', [kf(0, PILL), kf(340, STAR, 'easeOut'), kf(1500, STAR), kf(2000, PILL, 'easeInOut')]),
        ...bothEyes('color', [kf(0, INK), kf(340, STAR_YELLOW, 'easeOut'), kf(1500, STAR_YELLOW), kf(2000, INK)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(340, 1.35, 'easeOut'), kf(1500, 1.35), kf(2000, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(340, 1.05, 'easeOut'), kf(1500, 1.05), kf(2000, 1.55)]),
        ...bothEyes('eye.openness', [kf(0, 1), kf(2000, 1, 'linear')]),
        // a jolt of delight: crouch, pop, settle — the body offset from the eyes
        track('body', 'flatOffset.y', [kf(0, 0), kf(200, 8, 'easeInOut'), kf(420, -26, 'easeOut'), kf(700, 0, 'easeIn'), kf(860, -9, 'easeOut'), kf(1060, 0, 'easeIn'), kf(2000, 0)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(200, 0.91, 'easeInOut'), kf(420, 1.12, 'easeOut'), kf(700, 0.94, 'easeIn'), kf(1060, 1), kf(2000, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(200, 1.09, 'easeInOut'), kf(420, 0.92, 'easeOut'), kf(700, 1.06, 'easeIn'), kf(1060, 1), kf(2000, 1)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(480, -7, 'easeOut'), kf(940, 6), kf(1420, 0, 'elastic'), kf(2000, 0)]),
      ],
    },
    {
      // a full revolution: the eyes travel right, pass behind the silhouette and come back
      // out the left. The sphere projection already did this; only the slider range did not.
      id: 'p_spin', name: 'Spin', source: 'builtin', durationMs: 1600,
      tracks: [
        track('body', 'surface.yaw', [kf(0, 0), kf(220, -22, 'easeInOut'), kf(1300, 360, 'easeInOut'), kf(1600, 360, 'easeOut')]),
        // squash into the turn and out of it, so it reads as weight rather than a decal spinning
        track('body', 'transform.scale.x', [kf(0, 1), kf(220, 1.06), kf(760, 0.94), kf(1300, 1.04), kf(1600, 1, 'easeOut')]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(220, 0.95), kf(760, 1.05), kf(1300, 0.97), kf(1600, 1, 'easeOut')]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(300, -10, 'easeOut'), kf(900, -14), kf(1400, 0, 'easeIn'), kf(1600, 0)]),
      ],
    },
    {
      id: 'p_celebrate', name: 'Celebrate', source: 'builtin', durationMs: 2400,
      tracks: [
        ...bothEyes('eye.openness', [kf(0, 1), kf(300, 0.3, 'easeOut'), kf(1900, 0.3), kf(2400, 1)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(300, 1.4, 'easeOut'), kf(1900, 1.4), kf(2400, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(300, 1, 'easeOut'), kf(1900, 1), kf(2400, 1.55)]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(180, 11, 'easeInOut'), kf(460, -44, 'easeOut'), kf(760, 0, 'easeIn'), kf(920, -16, 'easeOut'), kf(1140, 0, 'easeIn'), kf(2400, 0)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(180, 0.88, 'easeInOut'), kf(460, 1.13, 'easeOut'), kf(760, 0.9, 'easeIn'), kf(920, 1.04), kf(1140, 1), kf(2400, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(180, 1.11, 'easeInOut'), kf(460, 0.91, 'easeOut'), kf(760, 1.09, 'easeIn'), kf(920, 0.98), kf(1140, 1), kf(2400, 1)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(460, -6, 'easeOut'), kf(920, 5), kf(1400, 0, 'elastic'), kf(2400, 0)]),
      ],
      emitters: [emit({
        name: 'confetti', glyphs: ['\u25a0', '\u25cf', '\u25b2', '\u2726', '\u25a0', '\u25cf'],
        color: { r: 232, g: 106, b: 84, a: 1 }, size: 15, path: 'fall',
        from: { nodeId: 'body', x: 0, y: -150 }, to: { nodeId: 'body', x: 0, y: 190 },
        bow: 150, rateMs: 90, lifeMs: 1500, count: 16, fadeStart: 0.7,
        scaleFrom: 1, scaleTo: 0.85, spin: 300, wobble: 14, wobbleFrequency: 2.2,
        startMs: 380, endMs: 1900, seed: 21,
      })],
    },
  ];
}

export function builtinExpressions(): Expression[] {
  return [
    { id: 'x_neutral', name: 'Neutral', snapshot: { 'eyeL.eye.openness': 1, 'eyeR.eye.openness': 1, 'eyeL.transform.length': 1.55, 'eyeR.transform.length': 1.55, 'eyeL.transform.scale.x': 1, 'eyeR.transform.scale.x': 1, 'body.surface.yaw': 0, 'body.surface.pitch': 0 } },
    { id: 'x_happy', name: 'Happy', snapshot: { 'eyeL.eye.openness': 0.42, 'eyeR.eye.openness': 0.42, 'eyeL.transform.scale.x': 1.22, 'eyeR.transform.scale.x': 1.22, 'body.surface.pitch': 4 } },
    { id: 'x_surprised', name: 'Surprised', snapshot: { 'eyeL.transform.scale.x': 1.5, 'eyeR.transform.scale.x': 1.5, 'eyeL.transform.length': 1.15, 'eyeR.transform.length': 1.15, 'body.transform.scale.x': 1.07, 'body.transform.scale.y': 1.07 } },
    { id: 'x_sleepy', name: 'Sleepy', snapshot: { 'eyeL.eye.openness': 0.14, 'eyeR.eye.openness': 0.14, 'body.surface.pitch': 10 } },
  ];
}

export function makeTimeline(name: string): Timeline {
  return { id: uid('tl'), name, tracks: [], modifiers: [], blocks: [], durationMode: 'custom', timelineDurationMs: 1000, loop: false };
}

/**
 * The non-track half of a preset, scoped to the clip it was just placed as.
 *
 * Shared by every path that places a preset — the Presets panel, `appendPreset` below and
 * the copilot's add_preset_to_timeline — because three copies of "and also copy the
 * effects" is three places to forget one.
 */
export function attachPresetEffects(timeline: Timeline, preset: Preset, blockId: string): void {
  for (const m of preset.modifiers ?? []) timeline.modifiers.push({ ...m, id: uid('m'), blockId });
  for (const e of preset.emitters ?? []) (timeline.emitters ??= []).push({ ...e, id: uid('e'), blockId });
}

/**
 * A throwaway project that plays one preset on its own, for a preview.
 *
 * Every preview site used to build this inline with `modifiers: []`, so a preset's own
 * shake never shook and its emitters never appeared — Sleepy previewed as a mascot with
 * its eyes shut and no zzz, which is exactly what the preset exists to avoid. One helper,
 * so a fourth preview cannot get it wrong again.
 */
export function presetPreviewProject(project: Project, preset: Preset): Project {
  const tl = project.timelines.find((t) => t.id === project.activeTimelineId) ?? project.timelines[0];
  return {
    ...project,
    timelines: [{
      ...tl,
      tracks: preset.tracks,
      blocks: [],
      // the preset's own effects, unscoped: there is no clip here to scope them to, and
      // the preview IS the clip
      modifiers: (preset.modifiers ?? []).map((m, i) => ({ ...m, id: `pm${i}`, blockId: undefined })),
      emitters: (preset.emitters ?? []).map((e, i) => ({ ...e, id: `pe${i}`, blockId: undefined })),
      timelineDurationMs: Math.max(200, preset.durationMs),
      durationOverrideMs: Math.max(200, preset.durationMs),
    }],
    activeTimelineId: tl.id,
  };
}

/** Appends a preset as a block at the end of a timeline. */
export function appendPreset(p: Project, presetId: string, timeline: Timeline = p.timelines[0]): void {
  const preset = p.presets.find((x) => x.id === presetId);
  if (!preset) return;
  const start = timeline.blocks.reduce((s, b) => s + b.durationMs, 0);
  const blockId = uid('b');
  timeline.blocks.push({ id: blockId, presetId, name: preset.name, durationMs: preset.durationMs });
  for (const t of preset.tracks) {
    timeline.tracks.push({
      id: uid('t'), nodeId: t.nodeId, property: t.property, blockId,
      keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + start })),
    });
  }
  attachPresetEffects(timeline, preset, blockId);
  // same formula store.commit() uses after every edit — otherwise a freshly-built
  // project reads a different duration than the very first edit would settle it to.
  timeline.timelineDurationMs = derivedDuration(timeline);
}

/** A new file opens on a working four-beat loop, not an empty strip. */
export function defaultProject(): Project {
  const idle = makeTimeline('Idle');
  const p: Project = {
    name: 'Untitled mascot',
    rig: defaultRig(),
    expressions: builtinExpressions(),
    presets: builtinPresets(),
    timelines: [idle],
    activeTimelineId: idle.id,
    fps: 30,
  };
  for (const id of ['p_idle', 'p_blink', 'p_talk', 'p_happy']) appendPreset(p, id, idle);
  return p;
}
