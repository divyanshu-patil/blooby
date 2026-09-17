import { makeEffect } from './effects';
import { both, flat, k, looped, tr, type E } from './showcase';
import { makeShapeLayer } from './layers';
import { CAMERA_ID } from './types';
import type { Appearance, ColorStop, EffectKind, Emitter, EmitterPart, Keyframe, Modifier, Preset, RigNode, Track } from './types';

/**
 * The Cartoon look and ten character presets, every one built from tools the editor already
 * has — squash and stretch, the eyes, the face's follow-through, particles, layer effects and
 * the bounce / breathe / orbit / heartbeat modifiers. No special cases in the engine.
 *
 * The rules they are written to: anticipation before every big move, follow-through after it,
 * overshoot and settle rather than stopping dead, volume kept (a squash is wider as it is
 * shorter), eyes that act before the body does, and every loop closing on the pose it opened
 * with. A look (`Preset.looks`) is switched on by the clip's own keys, so outside the clip the
 * character is exactly as it was.
 */

const rgb = (r: number, g: number, b: number, a = 1): ColorStop => ({ r, g, b, a });
const PINK = rgb(255, 120, 170), GOLD = rgb(255, 200, 80), SKY = rgb(140, 200, 255), LILAC = rgb(190, 160, 255);
/** the body's radius on the default mascot — where its feet are, for a squash that stays on the ground */
const R = 148;

const keys = (nodeId: string, property: string, ks: [number, number, E?][]): Track => tr(nodeId, property, ks.map(([t, v, e]) => k(t, v, e)));
/** squash and stretch through `squish`, about the body's feet: y as given, x keeping the volume */
const squash = (ks: [number, number, E?][]): Track[] => [
  keys('body', 'squish.y', ks),
  keys('body', 'squish.x', ks.map(([t, v, e]) => [t, v > 0 ? Math.round((1 / Math.sqrt(v)) * 1000) / 1000 : 1, e])),
];
/** squish about the feet for the length of the clip — the body's anchor, set and put back */
const feet = (D: number): Track[] => [keys('body', 'anchor.y', [[0, R, 'hold'], [D - 1, R, 'hold']])];
const eyes = (property: string, ks: [number, number, E?][]): Track[] => both(property, ks.map(([t, v, e]) => k(t, v, e)));
const blinks = (at: number[], open = 1): Keyframe[][] => [at.flatMap((t) => [k(t, open, 'linear'), k(t + 70, 0.06, 'easeIn'), k(t + 170, open, 'easeOut')])];
const part = (shapeId: string, over: Partial<EmitterPart> = {}): EmitterPart =>
  ({ id: `pt_${shapeId}_${over.speed ?? 1}_${over.sizeScale ?? 1}`, shapeId, weight: 1, speed: 1, sizeScale: 1, spin: 0, ...over });
const drift = (over: Partial<Omit<Emitter, 'id' | 'blockId'>> & Pick<Emitter, 'name'>): Omit<Emitter, 'id' | 'blockId'> => ({
  glyphs: [], color: PINK, size: 30, path: 'arc', from: { nodeId: 'body', x: 0, y: -120 }, to: { nodeId: 'body', x: 0, y: -260 }, bow: 18,
  rateMs: 420, lifeMs: 1500, count: 4, fadeStart: 0.55, scaleFrom: 0.5, scaleTo: 1.15, spin: 0, wobble: 4, wobbleFrequency: 1.2, seed: 11,
  easing: { type: 'preset', name: 'easeOut' }, speedJitter: 0.25, ...over,
});
const burst = (over: Partial<Omit<Emitter, 'id' | 'blockId'>> & Pick<Emitter, 'name'>): Omit<Emitter, 'id' | 'blockId'> => ({
  glyphs: [], color: GOLD, size: 8, path: 'burst', from: { nodeId: 'body', x: 0, y: 0 }, to: { nodeId: 'body', x: 0, y: 0 },
  bow: 0, rateMs: 100, lifeMs: 1100, count: 40, fadeStart: 0.55, scaleFrom: 1, scaleTo: 0.3, spin: 0, wobble: 0, wobbleFrequency: 1,
  velocity: 520, velocityJitter: 0.5, spread: 360, drag: 2.2, gravity: 500, turbulence: 4, seed: 5, ...over,
});
const mod = (nodeId: string, kind: Modifier['kind'], over: Partial<Modifier> = {}): Omit<Modifier, 'id' | 'blockId'> =>
  ({ nodeId, kind, amount: 100, frequency: 1, amplitude: 10, phase: 0, ...over });
const on = (nodeId: string, startMs: number, endMs: number, fadeInMs = 180, fadeOutMs = 240): Omit<Appearance, 'id' | 'blockId'> =>
  ({ nodeId, startMs, endMs, fadeInMs, fadeOutMs });
const followFace = (D: number, over: Partial<Modifier> = {}) => mod('face', 'follow', { frequency: 3, amplitude: 70, endMs: D, ...over });
/** a look: the effect, and how strong it is through the clip — ramps up at the start, down at the end */
const look = (nodeId: string, kind: EffectKind, param: string, value: number, D: number, rampMs = 220): Track =>
  keys(nodeId, `effect.${kind}.${param}`, [[0, 0, 'easeOut'], [rampMs, value], [D - rampMs, value, 'easeIn'], [D - 1, 0]]);

// --- the Cartoon look ------------------------------------------------------------------------
function cartoon(): Preset {
  const D = 2400;
  const parts = ['body', 'eyeL', 'eyeR'];
  return {
    id: 'p_cartoon', name: 'Cartoon', source: 'builtin', durationMs: D,
    tagline: 'Inked cartoon look · thick outline and hand-drawn boil · a springy boing to show it off',
    looks: parts.map((nodeId) => ({ nodeId, effects: ['outline', 'jitter'] as EffectKind[] })),
    tracks: [
      ...parts.map((id) => look(id, 'outline', 'width', id === 'body' ? 7 : 3.5, D)),
      ...parts.map((id) => look(id, 'jitter', 'amount', id === 'body' ? 2.6 : 1.2, D)),
      ...feet(D),
      ...squash([[0, 1], [260, 0.86, 'easeOut'], [520, 1.16, 'easeInOut'], [760, 0.94], [980, 1.04], [1200, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'flatOffset.y', [[0, 0], [520, -36, 'easeOut'], [800, 0, 'easeIn'], [1000, -8, 'easeOut'], [1160, 0], [D - 1, 0]]),
      ...eyes('eye.openness', [[0, 1], [240, 0.35, 'easeOut'], [520, 1.1, 'overshoot'], [760, 1], [D - 1, 1]]),
    ],
    modifiers: [followFace(D)],
  };
}

// --- 1. boing landing ------------------------------------------------------------------------
function boing(): Preset {
  const D = 2200;
  return {
    id: 'p_cr_boing', name: 'Boing Landing', source: 'builtin', durationMs: D,
    tagline: 'Falls in stretched · squashes on impact · two shrinking rebounds · eyes squeeze and pop',
    tracks: [
      ...feet(D),
      keys('body', 'flatOffset.y', [[0, -320, 'easeIn'], [380, 0, 'easeOut'], [640, -90, 'easeIn'], [860, 0, 'easeOut'], [1020, -28, 'easeIn'], [1160, 0, 'easeOut'], [D - 1, 0]]),
      ...squash([[0, 1.3, 'easeIn'], [360, 1.22], [390, 0.62, 'easeOut'], [520, 1.12, 'easeInOut'], [640, 1.05, 'easeIn'], [860, 0.82, 'easeOut'], [960, 1.04], [1160, 0.93, 'easeOut'], [1300, 1.02], [1460, 1, 'easeOut'], [D - 1, 1]]),
      ...eyes('eye.openness', [[0, 1.1], [360, 1.1, 'linear'], [390, 0.08, 'easeOut'], [560, 0.08, 'easeOut'], [720, 1.12, 'overshoot'], [880, 1], [D - 1, 1]]),
      ...eyes('transform.scale.x', [[0, 1], [390, 1.25, 'easeOut'], [700, 1], [D - 1, 1]]),
      keys('body', 'transform.rotation', [[0, -6], [390, 0, 'easeOut'], [640, 4], [860, -2], [1160, 0, 'easeOut'], [D - 1, 0]]),
    ],
    emitters: [burst({ name: 'dust', color: rgb(200, 190, 180), size: 10, from: { nodeId: 'body', x: 0, y: R }, to: { nodeId: 'body', x: 0, y: R },
      count: 18, angle: -90, spread: 160, velocity: 300, gravity: 260, lifeMs: 700, startMs: 380, endMs: 460 })],
    modifiers: [followFace(D)],
  };
}

// --- 2. shy peek -----------------------------------------------------------------------------
function shy(): Preset {
  const D = 3400;
  const blush = (id: string, x: number): RigNode => ({
    ...makeShapeLayer('circle', { id, name: id === 'blushL' ? 'Blush left' : 'Blush right', parentId: 'face', surface: flat(x, 36), size: { x: 34, y: 16 }, color: rgb(255, 140, 160, 0.75) }),
    ranged: true, effects: [{ ...makeEffect('blur'), params: { radius: 3 } }],
  });
  return {
    id: 'p_cr_shy', name: 'Shy Peek', source: 'builtin', durationMs: D,
    tagline: 'Turns away blushing · eyes drop · shrinks a little · peeks back with a blink',
    layers: [blush('blushL', -46), blush('blushR', 46)],
    appearances: [on('blushL', 300, 2900), on('blushR', 300, 2900)],
    tracks: [
      ...feet(D),
      // the eyes go first, then the head follows them away
      keys('body', 'surface.pitch', [[0, 0], [200, 8, 'easeOut'], [1900, 10], [2300, 2, 'easeInOut'], [D - 1, 0]]),
      keys('body', 'surface.yaw', [[0, 0], [380, -26, 'easeInOut'], [1900, -30], [2250, -8, 'overshoot'], [2700, 0], [D - 1, 0]]),
      keys('body', 'transform.rotation', [[0, 0], [420, -5, 'easeInOut'], [1900, -6], [2300, 1], [2600, 0], [D - 1, 0]]),
      ...squash([[0, 1], [420, 0.95, 'easeInOut'], [1900, 0.94], [2300, 1.03, 'easeOut'], [2600, 1], [D - 1, 1]]),
      tr('eyeL', 'eye.openness', [k(0, 1), k(260, 0.55, 'easeOut'), k(1900, 0.5), ...blinks([2250], 1)[0], k(D - 1, 1)]),
      tr('eyeR', 'eye.openness', [k(0, 1), k(260, 0.55, 'easeOut'), k(1900, 0.5), ...blinks([2250], 1)[0], k(D - 1, 1)]),
      keys('blushL', 'transform.scale.x', [[300, 0.4, 'easeOut'], [700, 1.05], [900, 1], [2900, 1]]),
      keys('blushR', 'transform.scale.x', [[300, 0.4, 'easeOut'], [700, 1.05], [900, 1], [2900, 1]]),
    ],
    modifiers: [followFace(D, { amplitude: 50 })],
  };
}

// --- 3. giggle -------------------------------------------------------------------------------
function giggle(): Preset {
  const D = 1900;
  const shakes: [number, number, E?][] = [[0, 1]];
  const tilt: [number, number, E?][] = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const t = 140 + i * 130, damp = 1 - i / 9;
    shakes.push([t, i % 2 ? 1 + 0.05 * damp : 1 - 0.07 * damp, 'easeInOut']);
    tilt.push([t, (i % 2 ? 1 : -1) * 4 * damp, 'easeInOut']);
  }
  shakes.push([1360, 1, 'easeOut'], [D - 1, 1]);
  tilt.push([1400, 0, 'easeOut'], [D - 1, 0]);
  return {
    id: 'p_cr_giggle', name: 'Giggle', source: 'builtin', durationMs: D,
    tagline: 'Can’t stop giggling · quick shrinking hiccups of squash · happy squinting eyes',
    tracks: [
      ...feet(D),
      ...squash(shakes),
      keys('body', 'transform.rotation', tilt),
      keys('body', 'surface.pitch', [[0, 0], [160, -6, 'easeOut'], [1300, -4], [1600, 0, 'easeInOut'], [D - 1, 0]]),
      ...eyes('eye.openness', [[0, 1], [140, 0.28, 'easeOut'], [1350, 0.3], [1650, 1, 'easeInOut'], [D - 1, 1]]),
      ...eyes('transform.scale.x', [[0, 1], [140, 1.18, 'easeOut'], [1350, 1.18], [1650, 1], [D - 1, 1]]),
    ],
    emitters: [drift({ name: 'giggles', parts: [part('spark', { sizeScale: 0.8 }), part('spark', { sizeScale: 1.1, speed: 0.9 })], color: GOLD, size: 22,
      from: { nodeId: 'body', x: 110, y: -90 }, to: { nodeId: 'body', x: 190, y: -170 }, rateMs: 260, lifeMs: 800, count: 3, startMs: 150, endMs: 1100 })],
    modifiers: [followFace(D, { frequency: 5, amplitude: 60 })],
  };
}

// --- 4. thinking… aha! -----------------------------------------------------------------------
function think(): Preset {
  const D = 3600;
  return {
    id: 'p_cr_think', name: 'Thinking… Aha!', source: 'builtin', durationMs: D,
    tagline: 'Looks up and ponders with a slow sway · thought dots rise · the idea lands with a hop and a spark',
    tracks: [
      ...feet(D),
      keys('body', 'surface.yaw', [[0, 0], [500, -16, 'easeInOut'], [2200, -12], [2350, 0, 'easeOut'], [D - 1, 0]]),
      keys('body', 'surface.pitch', [[0, 0], [500, -14, 'easeInOut'], [2200, -12], [2350, 0, 'easeOut'], [D - 1, 0]]),
      keys('body', 'transform.rotation', [[0, 0], [700, -4, 'easeInOut'], [1300, 3], [1900, -3], [2250, 0], [2600, 0], [D - 1, 0]]),
      ...eyes('eye.openness', [[0, 1], [500, 0.6, 'easeInOut'], [2200, 0.55], [2330, 1.2, 'overshoot'], [2700, 1], [D - 1, 1]]),
      ...eyes('transform.scale.x', [[0, 1], [2200, 1, 'linear'], [2330, 1.35, 'overshoot'], [2800, 1, 'easeInOut'], [D - 1, 1]]),
      // anticipation squat, then the hop of the idea
      ...squash([[0, 1], [2150, 1, 'easeIn'], [2250, 0.86, 'easeOut'], [2400, 1.12, 'easeOut'], [2650, 0.95], [2850, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'flatOffset.y', [[0, 0], [2250, 0, 'easeOut'], [2480, -40, 'easeIn'], [2700, 0, 'easeOut'], [D - 1, 0]]),
    ],
    emitters: [
      drift({ name: 'thought dots', parts: [part('circle', { sizeScale: 0.6 }), part('circle', { sizeScale: 0.85 }), part('circle', { sizeScale: 1.1 })],
        color: LILAC, size: 22, from: { nodeId: 'body', x: -80, y: -150 }, to: { nodeId: 'body', x: -170, y: -270 }, bow: -12,
        rateMs: 480, lifeMs: 1100, count: 3, startMs: 500, endMs: 1900 }),
      burst({ name: 'idea', parts: [part('spark')], color: GOLD, size: 18, from: { nodeId: 'body', x: 0, y: -180 }, to: { nodeId: 'body', x: 0, y: -180 },
        count: 14, velocity: 380, gravity: 120, lifeMs: 900, startMs: 2330, endMs: 2400 }),
    ],
    modifiers: [followFace(D)],
  };
}

// --- 5. love struck --------------------------------------------------------------------------
function love(): Preset {
  const D = 3200;
  return {
    id: 'p_cr_love', name: 'Love Struck', source: 'builtin', durationMs: D,
    tagline: 'Heart pounding · dreamy half-closed eyes · a slow sway · hearts drifting up',
    tracks: [
      ...feet(D),
      ...eyes('eye.openness', [[0, 1], [300, 0.42, 'easeInOut'], [2800, 0.42], [D - 1, 1, 'easeInOut']]),
      ...eyes('transform.scale.x', [[0, 1], [300, 1.2, 'easeOut'], [2800, 1.2], [D - 1, 1]]),
      keys('body', 'transform.rotation', [[0, 0], [700, 5, 'easeInOut'], [1500, -5], [2300, 4], [3000, 0], [D - 1, 0]]),
      keys('body', 'surface.pitch', [[0, 0], [300, 6, 'easeInOut'], [2800, 6], [D - 1, 0]]),
    ],
    emitters: [drift({ name: 'hearts', parts: [part('heart', { sizeScale: 0.8 }), part('heart', { sizeScale: 1.15, speed: 0.85 })], color: PINK, size: 34,
      from: { nodeId: 'body', x: 40, y: -130 }, to: { nodeId: 'body', x: 120, y: -300 }, bow: 26, rateMs: 520, lifeMs: 1500, count: 4, startMs: 250, endMs: 2300 })],
    modifiers: [mod('body', 'heartbeat', { frequency: 1.2, amplitude: 7, startMs: 150, endMs: D - 200 }), followFace(D, { amplitude: 40 })],
  };
}

// --- 6. dizzy --------------------------------------------------------------------------------
function dizzy(): Preset {
  const D = 3400;
  // the head wobbles round a circle: yaw and pitch a quarter-turn apart, slowing down
  const circle = (prop: 'surface.yaw' | 'surface.pitch'): [number, number, E?][] => {
    const out: [number, number, E?][] = [[0, 0]];
    for (let i = 1; i <= 10; i++) {
      const t = i * 220, a = (i * Math.PI) / 2 + (prop === 'surface.pitch' ? Math.PI / 2 : 0), damp = 1 - i / 13;
      out.push([t, Math.round(Math.sin(a) * 16 * damp * 10) / 10, 'easeInOut']);
    }
    out.push([2600, 0, 'easeOut'], [D - 1, 0]);
    return out;
  };
  return {
    id: 'p_cr_dizzy', name: 'Dizzy', source: 'builtin', durationMs: D,
    tagline: 'Head wobbles in circles · mismatched eyes · stars orbit overhead · shakes it off',
    tracks: [
      ...feet(D),
      keys('body', 'surface.yaw', circle('surface.yaw')),
      keys('body', 'surface.pitch', circle('surface.pitch')),
      keys('body', 'transform.rotation', [[0, 0], [440, 7, 'easeInOut'], [880, -6], [1320, 5], [1760, -3], [2300, 0, 'easeOut'], [2500, 0, 'linear'], [2580, 6], [2660, -6], [2740, 4], [2820, 0, 'easeOut'], [D - 1, 0]]),
      tr('eyeL', 'eye.openness', [k(0, 1), k(300, 0.45, 'easeInOut'), k(2400, 0.45), k(2600, 1, 'overshoot'), k(D - 1, 1)]),
      tr('eyeR', 'eye.openness', [k(0, 1), k(300, 1.1, 'easeInOut'), k(2400, 1.1), k(2600, 1, 'easeOut'), k(D - 1, 1)]),
      ...squash([[0, 1], [300, 0.96, 'easeInOut'], [2400, 0.96], [2500, 1.06, 'easeOut'], [2750, 1], [D - 1, 1]]),
    ],
    emitters: [drift({ name: 'dizzy stars', parts: [part('spark'), part('spark', { sizeScale: 0.7 }), part('spark', { sizeScale: 1.2 })], color: GOLD, size: 26,
      path: 'orbit', from: { nodeId: 'body', x: 0, y: -170 }, to: { x: 0, y: 0 }, bow: 0, radiusX: 110, radiusY: 26, rateMs: 500, lifeMs: 2000, count: 3,
      fadeStart: 0.85, scaleFrom: 0.9, scaleTo: 1, spin: 60, wobble: 1, startMs: 100, endMs: 2300, speedJitter: 0 })],
    modifiers: [followFace(D, { amplitude: 60 })],
  };
}

// --- 7. sneeze -------------------------------------------------------------------------------
function sneeze(): Preset {
  const D = 2300;
  return {
    id: 'p_cr_sneeze', name: 'Sneeze', source: 'builtin', durationMs: D,
    tagline: 'Ah… ah… — stretches back, eyes squeezing · CHOO! lunges forward · camera jolt · blinks it off',
    tracks: [
      ...feet(D),
      // two build-ups, each bigger, eyes squeezing a little more each time
      ...squash([[0, 1], [320, 1.08, 'easeInOut'], [460, 1.02], [820, 1.15, 'easeIn'], [1020, 1.2, 'easeIn'], [1080, 0.7, 'easeOut'], [1260, 1.06, 'easeInOut'], [1450, 0.97], [1650, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'transform.rotation', [[0, 0], [320, -5, 'easeInOut'], [460, -2], [1020, -12, 'easeIn'], [1080, 14, 'easeOut'], [1300, -3, 'easeInOut'], [1550, 0, 'easeOut'], [D - 1, 0]]),
      keys('body', 'surface.pitch', [[0, 0], [1020, -14, 'easeIn'], [1080, 12, 'easeOut'], [1400, 0, 'easeInOut'], [D - 1, 0]]),
      ...eyes('eye.openness', [[0, 1], [320, 0.6, 'easeInOut'], [460, 0.8], [1000, 0.2, 'easeIn'], [1080, 0.05, 'easeOut'], [1500, 0.05, 'easeOut'], [1650, 1, 'overshoot'], [1800, 1, 'linear'], [1870, 0.06, 'easeIn'], [1970, 1, 'easeOut'], [D - 1, 1]]),
      tr(CAMERA_ID, 'camera.zoom', [k(0, 1), k(1000, 1.06, 'easeIn'), k(1080, 0.97, 'easeOut'), k(1400, 1, 'easeInOut'), k(D - 1, 1)]),
    ],
    emitters: [burst({ name: 'achoo', parts: [part('drop-small')], color: SKY, size: 12, from: { nodeId: 'body', x: 120, y: 10 }, to: { nodeId: 'body', x: 120, y: 10 },
      count: 22, angle: 0, spread: 70, velocity: 620, gravity: 700, lifeMs: 800, startMs: 1080, endMs: 1140 })],
    modifiers: [{ nodeId: CAMERA_ID, kind: 'shake', amount: 100, frequency: 18, amplitude: 9, startMs: 1080, endMs: 1320 }, followFace(D, { frequency: 4, amplitude: 90 })],
  };
}

// --- 8. victory hop --------------------------------------------------------------------------
function victory(): Preset {
  const D = 2700;
  // a full turn in the air, keys under 180° apart so it goes round rather than back
  const turn: [number, number, E?][] = [[0, 0], [520, 0, 'easeIn'], [640, 90, 'linear'], [760, 180, 'linear'], [880, 270, 'linear'], [1000, 360, 'easeOut'], [1001, 0, 'hold'], [D - 1, 0]];
  return {
    id: 'p_cr_victory', name: 'Victory Hop', source: 'builtin', durationMs: D,
    tagline: 'Deep crouch · leaps and spins a full turn · lands with a squash · confetti and a proud glow',
    looks: [{ nodeId: 'body', effects: ['glow'] }],
    tracks: [
      ...feet(D),
      ...squash([[0, 1], [420, 0.72, 'easeIn'], [520, 1.3, 'easeOut'], [780, 1.05], [1080, 1.1, 'easeIn'], [1120, 0.7, 'easeOut'], [1300, 1.08], [1480, 0.97], [1650, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'flatOffset.y', [[0, 0], [420, 0, 'easeOut'], [780, -150, 'easeIn'], [1120, 0, 'easeOut'], [D - 1, 0]]),
      keys('body', 'transform.rotation', turn),
      ...eyes('eye.openness', [[0, 1], [420, 0.25, 'easeIn'], [520, 1.15, 'overshoot'], [1120, 0.2, 'easeOut'], [1300, 0.35], [2300, 0.35], [D - 1, 1, 'easeInOut']]),
      keys('body', 'effect.glow.strength', [[0, 0], [1120, 0, 'easeOut'], [1400, 1.6], [2200, 1.2, 'easeIn'], [D - 1, 0]]),
    ],
    emitters: [burst({ name: 'confetti', parts: [part('streamer'), part('chip'), part('curl')], color: GOLD, colorTo: PINK, size: 16,
      from: { nodeId: 'body', x: 0, y: -60 }, to: { nodeId: 'body', x: 0, y: -60 }, count: 60, angle: -90, spread: 140, velocity: 760, gravity: 900, lifeMs: 1500, startMs: 1120, endMs: 1200 })],
    modifiers: [followFace(D, { amplitude: 80 })],
  };
}

// --- 9. melt and reform ----------------------------------------------------------------------
function melt(): Preset {
  const D = 3600;
  return {
    id: 'p_cr_melt', name: 'Melt & Reform', source: 'builtin', durationMs: D,
    tagline: 'Sags into a rippling puddle, eyes drooping · wobbles · pulls itself back together with a bouncy overshoot',
    looks: [{ nodeId: 'body', effects: ['wave'] }],
    tracks: [
      ...feet(D),
      keys('body', 'squish.y', [[0, 1], [500, 0.92, 'easeIn'], [1300, 0.32, 'easeOut'], [2100, 0.34], [2500, 1.25, 'easeOut'], [2800, 0.9, 'easeInOut'], [3050, 1.04], [3300, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'squish.x', [[0, 1], [500, 1.04, 'easeIn'], [1300, 1.75, 'easeOut'], [2100, 1.7], [2500, 0.86, 'easeOut'], [2800, 1.08, 'easeInOut'], [3050, 0.98], [3300, 1, 'easeOut'], [D - 1, 1]]),
      keys('body', 'effect.wave.amount', [[0, 0], [900, 0, 'easeOut'], [1400, 9], [2100, 7, 'easeIn'], [2450, 0], [D - 1, 0]]),
      ...eyes('eye.openness', [[0, 1], [700, 0.4, 'easeInOut'], [2100, 0.3], [2500, 1.2, 'overshoot'], [2900, 1], [D - 1, 1]]),
      ...eyes('flatOffset.y', [[0, 0], [1300, 26, 'easeOut'], [2100, 24], [2500, 0, 'overshoot'], [D - 1, 0]]),
    ],
    emitters: [drift({ name: 'drips', parts: [part('drop', { sizeScale: 0.8 }), part('drop-small')], color: SKY, size: 18, path: 'fall',
      from: { nodeId: 'body', x: -90, y: 40 }, to: { nodeId: 'body', x: -110, y: 150 }, bow: 4, rateMs: 360, lifeMs: 700, count: 3, startMs: 600, endMs: 1500 })],
    modifiers: [mod('body', 'jelly', { frequency: 4, amplitude: 60, startMs: 2300, endMs: D })],
  };
}

// --- 10. dreamy float ------------------------------------------------------------------------
function dreamy(): Preset {
  const D = 4800;
  return {
    id: 'p_cr_dreamy', name: 'Dreamy Float', source: 'builtin', durationMs: D,
    tagline: 'Weightless drift on a slow orbit · deep breaths · heavy-lidded slow blinks · soft sparkles',
    tracks: [
      ...feet(D),
      tr('eyeL', 'eye.openness', [k(0, 1), k(600, 0.55, 'easeInOut'), k(1700, 0.55, 'linear'), k(2000, 0.08, 'easeInOut'), k(2400, 0.55, 'easeInOut'), k(4000, 0.55), k(D - 1, 1, 'easeInOut')]),
      tr('eyeR', 'eye.openness', [k(0, 1), k(600, 0.55, 'easeInOut'), k(1700, 0.55, 'linear'), k(2000, 0.08, 'easeInOut'), k(2400, 0.55, 'easeInOut'), k(4000, 0.55), k(D - 1, 1, 'easeInOut')]),
      keys('body', 'surface.pitch', [[0, 0], [800, -6, 'easeInOut'], [4000, -6], [D - 1, 0]]),
    ],
    emitters: [drift({ name: 'dream sparkles', parts: [part('spark', { sizeScale: 0.6 }), part('spark', { sizeScale: 0.9, speed: 0.8 })], color: LILAC, size: 20,
      from: { nodeId: 'body', x: -150, y: 40 }, to: { nodeId: 'body', x: -210, y: -220 }, bow: -30, rateMs: 700, lifeMs: 2400, count: 4, fadeStart: 0.4, startMs: 300, endMs: 3600 })],
    modifiers: [
      mod('body', 'orbit', { frequency: 1000 / D, amplitude: 16 }),
      mod('body', 'breathe', { frequency: 2000 / D, amplitude: 5 }),
      followFace(D, { amplitude: 40 }),
    ],
  };
}

export function creativePresets(): Preset[] {
  return [cartoon(), boing(), shy(), giggle(), think(), love(), dizzy(), sneeze(), victory(), melt(), dreamy()].map(looped);
}
