import { uid } from './id';
import { makeCurveLayer, makeShapeLayer } from './layers';
import { makeEffect } from './effects';
import { both, flat, k, limb, looped, point, shape, tr, uniform, words, type E } from './showcase';
import { CAMERA_ID } from './types';
import type { Appearance, ColorStop, EffectKind, Emitter, LayerEffect, Modifier, Preset, RigNode, Track } from './types';

/**
 * Ten cinematic presets — portal, morph, walk with parallax, particles, liquid, glitch, doodle,
 * a title, a card flip and a 20-second showreel — and not one special case in the engine for
 * any of them. Every beat is a system the editor already has, stored as plain data a person
 * can open and edit: layer effects (core/effects.ts, keyed as `effect.<kind>.<param>`), blend
 * modes, masks, gradients, 2.5D depth and the camera, burst particles that gather onto a
 * layer or a word, the walk / follow / jelly / shake modifiers, per-letter offsets, trim.
 *
 * Each brings its own layers with their own ids (prefixed by preset, so the showreel can hold
 * several at once) and says when they are on screen. The mascot itself is only ever moved by
 * tracks, never restyled — a preset must not leave an effect on someone's character.
 *
 * `sequence` joins presets end to end into one: the showreel is five of these in a row.
 */

const rgb = (r: number, g: number, b: number, a = 1): ColorStop => ({ r, g, b, a });
const INK = rgb(20, 19, 24);
const VIOLET = rgb(124, 77, 255), CYAN = rgb(90, 220, 255), MAGENTA = rgb(255, 70, 170), GOLD = rgb(255, 200, 80), MINT = rgb(120, 230, 180);

/** an effect with some params changed from its defaults */
const fx = (kind: EffectKind, params: Record<string, number> = {}, color?: ColorStop): LayerEffect => {
  const e = makeEffect(kind);
  return { ...e, params: { ...e.params, ...params }, ...(color ? { color } : {}) };
};
/** a layer on screen for this span of the clip */
const on = (nodeId: string, startMs: number, endMs: number, fadeInMs = 160, fadeOutMs = 220): Omit<Appearance, 'id' | 'blockId'> =>
  ({ nodeId, startMs, endMs, fadeInMs, fadeOutMs });
/** a world shape the preset owns */
const prop = (kindOf: Parameters<typeof makeShapeLayer>[0], id: string, name: string, x: number, y: number, w: number, h: number, color: ColorStop, over: Partial<RigNode> = {}): RigNode =>
  ({ ...makeShapeLayer(kindOf, { id, name, parentId: null, surface: flat(x, y), size: { x: w, y: h }, color }), ranged: true, ...over });
const xy = (nodeId: string, keys: [number, number, number, E?][]): Track[] => [
  tr(nodeId, 'flatOffset.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'flatOffset.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
const squish = (nodeId: string, keys: [number, number, number, E?][]): Track[] => [
  tr(nodeId, 'squish.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'squish.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
/** a full turn as keys less than 180° apart — rotation takes the short way between two keys */
const spin = (from: number, to: number, turns: number, start = 0): ReturnType<typeof k>[] => {
  const steps = Math.max(2, Math.ceil(Math.abs(turns) * 3));
  return Array.from({ length: steps + 1 }, (_, i) => k(from + ((to - from) * i) / steps, start + (360 * turns * i) / steps, i === steps ? 'easeOut' : 'linear'));
};
const blinkEyes = (at: number[]): Track[] => both('eye.openness', [k(0, 1), ...at.flatMap((t) => [k(t, 1, 'linear'), k(t + 70, 0.06, 'easeIn'), k(t + 170, 1, 'easeOut')])]);
/** a burst of particles; everything not given is a sensible spark */
const burst = (over: Partial<Omit<Emitter, 'id' | 'blockId'>>): Omit<Emitter, 'id' | 'blockId'> => ({
  name: 'burst', glyphs: [], color: GOLD, size: 6, path: 'burst', from: { nodeId: 'body', x: 0, y: 0 }, to: { nodeId: 'body', x: 0, y: 0 },
  bow: 0, rateMs: 100, lifeMs: 1400, count: 60, fadeStart: 0.6, scaleFrom: 1, scaleTo: 0.3, spin: 0, wobble: 0, wobbleFrequency: 1,
  velocity: 520, velocityJitter: 0.5, spread: 360, drag: 2, gravity: 0, turbulence: 6, seed: 7, ...over,
});
const camera = (property: string, keys: [number, number, E?][]): Track => tr(CAMERA_ID, property, keys.map(([t, v, e]) => k(t, v, e)));
const shakeCamera = (startMs: number, endMs: number, amplitude = 10): Omit<Modifier, 'id' | 'blockId'> =>
  ({ nodeId: CAMERA_ID, kind: 'shake', amount: 100, frequency: 16, amplitude, startMs, endMs });

/** A drawn curve the preset owns, starting undrawn. */
function stroke(id: string, name: string, pts: [number, number][], color: ColorStop, width: number, over: Partial<RigNode> = {}): RigNode {
  const c = makeCurveLayer(pts.map(([x, y]) => ({ x, y })), { name, type: 'smooth', color, width })!;
  return { ...c, id, ranged: true, trim: { start: 0, end: 0 }, ...over };
}

// --- 1. portal ----------------------------------------------------------------------------------
function portal(): Preset {
  const D = 4000;
  return {
    id: 'p_cine_portal', name: 'Portal Entrance', source: 'builtin', durationMs: D,
    tagline: 'Glowing portal opens · mascot rises through it · sparks, camera shake, zoom',
    layers: [
      prop('circle', 'portalGlow', 'Portal glow', 0, 150, 300, 90, VIOLET, {
        zIndex: -2, blend: 'screen', effects: [fx('blur', { radius: 14 }), fx('glow', { radius: 40, strength: 2 }, MAGENTA)],
      }),
      prop('circle', 'portalRing', 'Portal ring', 0, 150, 260, 70, INK, {
        zIndex: -1,
        gradient: { type: 'radial', angle: 0, stops: [{ at: 0, color: rgb(10, 6, 30) }, { at: 0.7, color: VIOLET }, { at: 1, color: CYAN }] },
        effects: [fx('glow', { radius: 24, strength: 1.4 }, CYAN)],
      }),
    ],
    appearances: [on('portalGlow', 0, 3300, 200, 400), on('portalRing', 0, 3300, 120, 400)],
    tracks: [
      ...uniform('portalRing', [[0, 0, 'overshoot'], [500, 1.15, 'easeInOut'], [800, 1], [2600, 1, 'easeIn'], [3200, 0]]),
      ...uniform('portalGlow', [[0, 0, 'easeOut'], [600, 1.2], [1400, 0.9], [2000, 1.1], [2600, 1, 'easeIn'], [3200, 0]]),
      tr('portalRing', 'gradient.angle', [k(0, 0, 'linear'), k(3200, 720)]),
      tr('portalGlow', 'effect.glow.strength', [k(0, 0.5), k(900, 3, 'easeOut'), k(1500, 1.4), k(3200, 0.5)]),
      // the mascot: tiny and below, rising through the ring with a spin, a stretch and a landing squash
      ...uniform('body', [[0, 0, 'hold'], [600, 0.2, 'easeOut'], [1300, 1.1, 'easeInOut'], [1600, 1]]),
      ...xy('body', [[0, 0, 150, 'hold'], [600, 0, 150, 'easeOut'], [1200, 0, -90, 'easeIn'], [1600, 0, 0, 'easeOut'], [D, 0, 0]]),
      tr('body', 'transform.rotation', [k(0, 0), k(600, -160, 'linear'), k(1000, -330, 'easeOut'), k(1300, -360), k(1301, 0, 'hold'), k(D, 0)]),
      ...squish('body', [[0, 1, 1], [600, 0.8, 1.3, 'easeIn'], [1200, 0.85, 1.2, 'easeIn'], [1600, 1.25, 0.78, 'easeOut'], [1800, 0.95, 1.06], [2000, 1, 1, 'easeOut'], [D, 1, 1]]),
      tr('face', 'flatOffset.y', [k(0, 0), k(1600, 12, 'easeOut'), k(1900, -6), k(2100, 0), k(D, 0)]),
      ...both('eye.openness', [k(0, 0.1), k(1650, 0.1, 'easeOut'), k(1850, 1.1, 'overshoot'), k(2100, 1), k(2900, 1, 'linear'), k(2970, 0.06), k(3070, 1), k(D, 1)]),
      camera('camera.zoom', [[0, 1.35, 'easeInOut'], [1600, 1.35, 'easeOut'], [2200, 1, 'easeInOut'], [D, 1]]),
    ],
    emitters: [
      burst({ name: 'portal sparks', color: CYAN, colorTo: MAGENTA, from: { nodeId: 'portalRing', x: 0, y: 0 }, to: { nodeId: 'portalRing', x: 0, y: 0 },
        count: 80, angle: -90, spread: 150, velocity: 700, gravity: 600, lifeMs: 1600, startMs: 1500, endMs: 3200 }),
    ],
    modifiers: [shakeCamera(1550, 1950, 12), { nodeId: 'face', kind: 'follow', amount: 100, frequency: 3, amplitude: 70, startMs: 600, endMs: 3000 }],
  };
}

// --- 2. morph -----------------------------------------------------------------------------------
function morph(): Preset {
  const D = 4200;
  return {
    id: 'p_cine_morph', name: 'Full Body Morph', source: 'builtin', durationMs: D,
    tagline: 'Shape morphs pebble → blob → octopus · jelly body · glowing aura · arms grow in',
    layers: [
      prop('circle', 'morphAura', 'Aura', 0, 0, 420, 420, VIOLET, {
        zIndex: -2, blend: 'screen',
        gradient: { type: 'radial', angle: 0, stops: [{ at: 0, color: rgb(255, 255, 255, 0.9) }, { at: 0.5, color: rgb(124, 77, 255, 0.6) }, { at: 1, color: rgb(90, 220, 255, 0) }] },
        effects: [fx('blur', { radius: 18 }), fx('echo', { count: 3, delay: 80, falloff: 0.5 })],
      }),
      limb('arm', -1), limb('arm', 1),
    ],
    appearances: [on('morphAura', 300, 3800, 300, 400), on('armL', 2300, D, 200, 160), on('armR', 2300, D, 200, 160)],
    tracks: [
      tr('body', 'shape.path', [
        k(0, shape('pebble'), 'hold'), k(500, shape('pebble'), 'elastic'), k(1100, shape('blob'), 'hold'),
        k(1700, shape('blob'), 'overshoot'), k(2300, shape('octopus'), 'hold'), k(3300, shape('octopus'), 'smooth'), k(3900, shape('pebble')),
      ]),
      ...uniform('morphAura', [[300, 0.3, 'easeOut'], [1100, 1.1, 'easeInOut'], [1700, 0.85, 'easeInOut'], [2300, 1.25, 'easeOut'], [3300, 1], [3800, 0.4]]),
      tr('morphAura', 'transform.rotation', spin(300, 3800, 1)),
      ...squish('body', [[0, 1, 1], [400, 1.15, 0.85, 'easeIn'], [700, 0.85, 1.2, 'overshoot'], [1100, 1, 1], [1600, 1.2, 0.82, 'easeIn'], [1900, 0.88, 1.15, 'overshoot'], [2300, 1, 1], [3300, 1, 1, 'easeIn'], [3600, 1.1, 0.9, 'easeOut'], [3900, 1, 1]]),
      tr('body', 'transform.rotation', [k(0, 0), k(1100, 0, 'easeInOut'), k(1500, 12, 'easeInOut'), k(1900, -10, 'easeInOut'), k(2300, 0), k(D, 0)]),
      ...both('transform.scale.x', [k(0, 1), k(2300, 1, 'easeOut'), k(2500, 1.25, 'overshoot'), k(3300, 1.1), k(3900, 1), k(D, 1)]),
      ...point('armL', 'b', [[2300, -60, 60, 'overshoot'], [2700, -230, -20, 'easeInOut'], [3100, -200, -120, 'easeInOut'], [3600, -196, 96]]),
      ...point('armR', 'b', [[2300, 60, 60, 'overshoot'], [2750, 230, -20, 'easeInOut'], [3150, 200, -120, 'easeInOut'], [3650, 196, 96]]),
    ],
    modifiers: [
      { nodeId: 'body', kind: 'jelly', amount: 100, frequency: 4, amplitude: 70, startMs: 0, endMs: D },
      { nodeId: 'face', kind: 'follow', amount: 100, frequency: 3, amplitude: 60, startMs: 0, endMs: D },
    ],
    emitters: [burst({ name: 'morph sparks', color: MINT, colorTo: VIOLET, count: 40, velocity: 420, startMs: 2250, endMs: 3700 })],
  };
}

// --- 3. walk with a panning camera over parallax layers ------------------------------------------
function walk(): Preset {
  const D = 5000, SPEED = 2, STRIDE = 50;
  // the camera keeps the mascot framed: the walk eases up to speed over 0.4s, so it has covered
  // about STRIDE·SPEED·(t − 0.2s) by t
  const travel = (t: number) => -Math.round(STRIDE * SPEED * Math.max(0, t / 1000 - 0.2));
  const hill = (id: string, x: number, w: number) => prop('blob', id, 'Far hill', x, 150, w, w * 0.6, rgb(150, 190, 240), { zIndex: -6, depth: { z: 1400, rotateX: 0, rotateY: 0 } });
  const tree = (id: string, x: number) => prop('capsule', id, 'Tree', x, 90, 130, 260, rgb(60, 150, 110), { zIndex: -4, depth: { z: 500, rotateX: 0, rotateY: 0 } });
  const tuft = (id: string, x: number) => prop('star', id, 'Grass', x, 330, 110, 80, rgb(40, 110, 80), { zIndex: 50, depth: { z: -280, rotateX: 0, rotateY: 0 }, effects: [fx('blur', { radius: 3 })] });
  const scenery = [hill('walkHill1', -300, 520), hill('walkHill2', 500, 640), tree('walkTree1', -180), tree('walkTree2', 380), tree('walkTree3', 900),
    prop('rect', 'walkGround', 'Ground', 400, 330, 2600, 140, rgb(90, 170, 110), { zIndex: -3 }), tuft('walkTuft1', 120), tuft('walkTuft2', 820)];
  return {
    id: 'p_cine_walk', name: 'Walk Cycle + Parallax', source: 'builtin', durationMs: D,
    tagline: 'Procedural walk with planted feet · camera follows · hills, trees and grass in parallax',
    layers: [...scenery, limb('leg', -1), limb('leg', 1), limb('arm', -1), limb('arm', 1)],
    appearances: [...scenery.map((n) => on(n.id, 0, D, 300, 300)), ...['legL', 'legR', 'armL', 'armR'].map((id) => on(id, 0, D, 120, 160))],
    tracks: [
      camera('camera.offset.x', [[0, 0, 'linear'], [200, 0, 'linear'], ...[1000, 2000, 3000, 4000].map((t): [number, number, E] => [t, travel(t), 'linear']), [4400, travel(4300), 'easeOut'], [D, travel(4300)]]),
      camera('camera.zoom', [[0, 1.1, 'easeInOut'], [2500, 0.95, 'easeInOut'], [D, 1.05]]),
      ...blinkEyes([1500, 3600]),
      tr('face', 'transform.rotation', [k(0, 0), k(600, 4, 'easeInOut'), k(4200, 4, 'easeInOut'), k(4700, 0), k(D, 0)]),
    ],
    modifiers: [
      { nodeId: 'body', kind: 'walk', amount: 100, frequency: SPEED, amplitude: STRIDE, startMs: 0, endMs: 4300 },
      { nodeId: 'face', kind: 'follow', amount: 100, frequency: 3, amplitude: 40, startMs: 0, endMs: D },
    ],
  };
}

// --- 4. explode into particles, gather into a word, come back ------------------------------------
function particles(): Preset {
  const D = 4500;
  return {
    id: 'p_cine_particles', name: 'Particle Assembly', source: 'builtin', durationMs: D,
    tagline: 'Mascot bursts into particles · they swirl and assemble into a word · pops back',
    layers: [words('assembleWord', 'Assembled word', 'HELLO', { size: 110, letterSpacing: 6 }, { parentId: null, surface: flat(0, 0), color: GOLD, effects: [fx('glow', { radius: 18, strength: 1.2 }, GOLD)] })],
    appearances: [on('assembleWord', 2500, 3700, 400, 200)],
    tracks: [
      // charge up, vanish, reappear from the word
      ...squish('body', [[0, 1, 1], [500, 1.2, 0.8, 'easeIn'], [700, 0.7, 1.35, 'easeOut'], [3800, 0.7, 1.35, 'overshoot'], [4100, 1, 1]]),
      ...uniform('body', [[0, 1], [500, 1.05, 'easeIn'], [720, 0, 'hold'], [3700, 0, 'overshoot'], [4100, 1]]),
      tr('body', 'transform.rotation', [k(0, 0), k(400, -6, 'easeInOut'), k(500, 6), k(600, 0), k(D, 0)]),
      ...uniform('assembleWord', [[2500, 0.9, 'easeOut'], [3000, 1.05, 'easeInOut'], [3500, 1, 'easeIn'], [3700, 0.3]]),
      tr('assembleWord', 'text.letterSpacing', [k(2500, 30, 'easeOut'), k(3200, 6), k(3700, 60, 'easeIn')]),
      camera('camera.zoom', [[0, 1, 'easeInOut'], [700, 1.12, 'easeOut'], [2000, 0.95, 'easeInOut'], [3200, 1.05, 'easeInOut'], [D, 1]]),
    ],
    emitters: [
      burst({ name: 'into particles', color: rgb(255, 255, 255), colorTo: GOLD, count: 260, size: 7, velocity: 300, drag: 2.2, turbulence: 24, lifeMs: 3100, fadeStart: 0.97, scaleTo: 1,
        attract: { nodeId: 'assembleWord', startMs: 1100, durationMs: 1300 }, startMs: 700, endMs: 3800, seed: 11 }),
      burst({ name: 'back together', color: GOLD, colorTo: MAGENTA, count: 90, size: 5, velocity: 380, lifeMs: 900, startMs: 3600, endMs: 4500, from: { nodeId: 'assembleWord', x: 0, y: 0 }, to: { nodeId: 'assembleWord', x: 0, y: 0 },
        attract: { nodeId: 'body', startMs: 150, durationMs: 400 }, seed: 5 }),
    ],
    modifiers: [shakeCamera(650, 950, 8)],
  };
}

// --- 5. liquid ----------------------------------------------------------------------------------
function liquid(): Preset {
  const D = 4000;
  const drop = (id: string, x: number, r: number): RigNode => ({
    ...makeShapeLayer('circle', { id, name: 'Drop', parentId: 'liquidPool', surface: flat(x, 0), size: { x: r, y: r }, color: CYAN }), ranged: true,
  });
  const drops = [drop('liquidDrop1', -40, 60), drop('liquidDrop2', 30, 46), drop('liquidDrop3', 70, 36), drop('liquidDrop4', -80, 30)];
  const arc = (id: string, t0: number, x: number, h: number): Track[] => xy(id, [[t0, x * 0.3, 0, 'easeOut'], [t0 + 450, x, -h, 'easeIn'], [t0 + 900, x * 1.4, 10, 'easeOut'], [t0 + 1200, x * 0.4, 0]]);
  return {
    id: 'p_cine_liquid', name: 'Liquid Splash', source: 'builtin', durationMs: D,
    tagline: 'Metaball goo · mascot drops into a pool · droplets split off and melt back',
    layers: [
      prop('pill', 'liquidPool', 'Pool', 0, 250, 340, 60, CYAN, {
        zIndex: -1, gradient: { type: 'linear', angle: 90, stops: [{ at: 0, color: CYAN }, { at: 1, color: rgb(40, 90, 230) }] },
        effects: [fx('goo', { radius: 14 }), fx('glow', { radius: 20, strength: 0.8 }, CYAN)],
      }),
      ...drops,
    ],
    appearances: [on('liquidPool', 0, D, 250, 300), ...drops.map((d) => on(d.id, 0, D, 200, 300))],
    tracks: [
      ...xy('body', [[0, 0, -120, 'easeIn'], [700, 0, 70, 'easeOut'], [1300, 0, 30, 'easeInOut'], [2600, 0, 40, 'easeIn'], [3300, 0, -40, 'easeOut'], [3700, 0, 0], [D, 0, 0]]),
      ...squish('body', [[0, 0.9, 1.15], [650, 0.85, 1.2, 'easeOut'], [760, 1.35, 0.7, 'easeOut'], [1100, 0.95, 1.05, 'easeInOut'], [1400, 1, 1], [3300, 1, 1], [D, 1, 1]]),
      ...uniform('liquidPool', [[0, 0.6, 'easeOut'], [700, 0.8, 'overshoot'], [1000, 1.2, 'easeInOut'], [2000, 1], [D, 1]]),
      ...arc('liquidDrop1', 700, -150, 170), ...arc('liquidDrop2', 760, 160, 200), ...arc('liquidDrop3', 900, 90, 260), ...arc('liquidDrop4', 1900, -100, 140),
      tr('liquidPool', 'effect.goo.radius', [k(0, 10), k(800, 22, 'easeOut'), k(2400, 12), k(D, 10)]),
      ...both('eye.openness', [k(0, 1), k(700, 1, 'easeIn'), k(760, 0.1, 'easeOut'), k(1300, 0.1, 'overshoot'), k(1500, 1.1), k(1700, 1), k(D, 1)]),
    ],
    modifiers: [{ nodeId: 'body', kind: 'jelly', amount: 100, frequency: 4.5, amplitude: 90, startMs: 0, endMs: D }],
    emitters: [burst({ name: 'splash', color: CYAN, colorTo: rgb(255, 255, 255), from: { nodeId: 'liquidPool', x: 0, y: -10 }, to: { nodeId: 'liquidPool', x: 0, y: -10 },
      count: 40, size: 9, angle: -90, spread: 120, velocity: 600, gravity: 1400, drag: 0.6, lifeMs: 1100, startMs: 700, endMs: 1900 })],
  };
}

// --- 6. glitch ----------------------------------------------------------------------------------
function glitch(): Preset {
  const D = 3600;
  const tear: LayerEffect[] = [fx('rgbSplit', { amount: 10 }), fx('slices', { amount: 60, bands: 14, rate: 18 }), fx('flicker', { amount: 0.7, rate: 24 })];
  return {
    id: 'p_cine_glitch', name: 'Glitch Materialize', source: 'builtin', durationMs: D,
    tagline: 'Digital glitch · RGB split, slice tearing, scanlines, flicker · mascot materializes',
    layers: [
      prop('roundedRect', 'glitchScreen', 'Screen', 0, 0, 520, 520, rgb(12, 14, 32), {
        zIndex: -2, mask: { nodeId: 'glitchWipe' },
        gradient: { type: 'linear', angle: 90, stops: [{ at: 0, color: rgb(20, 24, 60) }, { at: 1, color: rgb(4, 4, 12) }] },
        effects: [fx('scanlines', { spacing: 4, opacity: 0.35 }), ...tear],
      }),
      prop('rect', 'glitchWipe', 'Wipe (mask)', 0, 0, 540, 540, rgb(255, 255, 255, 0), { zIndex: -3 }),
      words('glitchText', 'Glitch word', 'SIGNAL', { size: 64, letterSpacing: 10 }, { parentId: null, surface: flat(0, -220), color: CYAN, effects: tear.map((e) => structuredClone(e)) }),
    ],
    appearances: [on('glitchScreen', 0, 3200, 60, 300), on('glitchWipe', 0, 3200, 0, 0), on('glitchText', 300, 3000, 60, 120)],
    tracks: [
      tr('glitchWipe', 'transform.scale.y', [k(0, 0, 'hold'), k(120, 0.15, 'hold'), k(220, 0.05, 'hold'), k(300, 0.5, 'easeOut'), k(500, 1), k(2800, 1, 'easeIn'), k(3200, 0)]),
      tr('glitchScreen', 'effect.slices.amount', [k(0, 90), k(900, 20, 'easeOut'), k(1500, 60, 'hold'), k(1600, 0, 'easeOut'), k(2600, 0, 'hold'), k(2700, 80), k(3200, 90)]),
      tr('glitchScreen', 'effect.rgbSplit.amount', [k(0, 18), k(1600, 2, 'easeOut'), k(2600, 2), k(3200, 18)]),
      tr('glitchText', 'effect.flicker.amount', [k(0, 1), k(1200, 0.2, 'easeOut'), k(2600, 0.2), k(3000, 1)]),
      tr('glitchText', 'effect.slices.amount', [k(0, 80), k(1200, 8, 'easeOut'), k(2600, 8), k(3000, 80)]),
      // the mascot flickers into existence: stepped scales, a sideways jolt, then clean
      ...squish('body', [[0, 0.05, 1.4, 'hold'], [400, 1.4, 0.2, 'hold'], [520, 0.6, 1.1, 'hold'], [640, 1.15, 0.9, 'hold'], [760, 0.9, 1.05, 'easeOut'], [1000, 1, 1], [2600, 1, 1, 'hold'], [2700, 1.2, 0.85, 'hold'], [2800, 1, 1], [D, 1, 1]]),
      ...uniform('body', [[0, 0, 'hold'], [400, 1, 'hold'], [D, 1]]),
      ...xy('body', [[0, 0, 0, 'hold'], [520, -28, 0, 'hold'], [640, 22, 0, 'hold'], [760, -8, 0, 'easeOut'], [900, 0, 0], [2600, 0, 0, 'hold'], [2700, 18, 0, 'hold'], [2800, 0, 0], [D, 0, 0]]),
      tr('body', 'surface.yaw', [k(0, 0, 'hold'), k(640, 25, 'hold'), k(760, -15, 'easeOut'), k(1000, 0), k(D, 0)]),
      ...both('eye.openness', [k(0, 1, 'hold'), k(760, 0.1, 'hold'), k(860, 1, 'hold'), k(960, 0.3, 'hold'), k(1060, 1), k(D, 1)]),
    ],
    modifiers: [shakeCamera(0, 800, 7), shakeCamera(2600, 2850, 9)],
  };
}

// --- 7. doodle ----------------------------------------------------------------------------------
function doodle(): Preset {
  const D = 4000;
  const PEN = rgb(246, 240, 228);
  const lines = [
    stroke('doodleCircle', 'Doodle circle', [[-170, 20], [-120, -150], [30, -190], [170, -80], [160, 110], [0, 190], [-160, 120], [-175, 0]], PEN, 7),
    stroke('doodleStar', 'Doodle star', [[190, -210], [205, -170], [245, -170], [215, -145], [228, -105], [190, -130], [152, -105], [165, -145], [135, -170], [175, -170], [190, -210]], rgb(240, 150, 40), 6),
    stroke('doodleUnderline', 'Doodle underline', [[-140, 250], [-40, 240], [60, 256], [150, 238]], PEN, 9),
    stroke('doodleArrow', 'Doodle arrow', [[-300, -250], [-260, -210], [-215, -185], [-190, -160]], MAGENTA, 6),
  ].map((n) => ({ ...n, effects: [fx('jitter', { amount: 2.5, rate: 8 })], stroke: { ...n.stroke, taper: 0.6 } }));
  const draw = (id: string, t0: number, t1: number): Track => tr(id, 'trim.end', [k(t0, 0, 'easeInOut'), k(t1, 1), k(3500, 1, 'easeIn'), k(3800, 0)]);
  return {
    id: 'p_cine_doodle', name: 'Doodle Reveal', source: 'builtin', durationMs: D,
    tagline: 'Hand-drawn lines draw themselves on · boiling pencil jitter · handwritten words type in',
    layers: [...lines, words('doodleWord', 'Doodle words', 'hi there!', { size: 54, font: { family: 'Caveat', weight: 700, style: 'normal' }, reveal: { start: 0, end: 0 } },
      { parentId: null, surface: flat(0, 300), color: PEN, effects: [fx('jitter', { amount: 1.5, rate: 8 })] })],
    appearances: [...lines.map((n) => on(n.id, 0, D, 0, 200)), on('doodleWord', 1600, D, 0, 200)],
    tracks: [
      draw('doodleCircle', 0, 1100), draw('doodleStar', 900, 1500), draw('doodleUnderline', 1500, 1900), draw('doodleArrow', 2000, 2400),
      tr('doodleCircle', 'trim.offset', [k(0, 0, 'linear'), k(D, 0.3)]),
      tr('doodleWord', 'text.reveal.end', [k(1600, 0, 'linear'), k(2600, 9), k(D, 9)]),
      tr('doodleStar', 'transform.rotation', [k(1500, 0, 'overshoot'), k(1800, 20, 'easeInOut'), k(2400, -10), k(3000, 0)]),
      ...uniform('body', [[0, 0.85, 'easeOut'], [1100, 0.85, 'overshoot'], [1400, 1.05, 'easeInOut'], [1700, 1], [D, 1]]),
      ...squish('body', [[1100, 1, 1, 'easeOut'], [1250, 1.12, 0.9, 'overshoot'], [1500, 1, 1]]),
      ...both('eye.openness', [k(0, 0.4), k(1100, 0.4, 'easeOut'), k(1300, 1.1, 'overshoot'), k(1500, 1), k(D, 1)]),
      tr('face', 'transform.rotation', [k(0, 0), k(2000, 0, 'easeInOut'), k(2300, -8, 'easeInOut'), k(2800, 0), k(D, 0)]),
    ],
  };
}

// --- 8. title -----------------------------------------------------------------------------------
function title(): Preset {
  const D = 5000, WORD = 'BLOOBY';
  const letters = [...WORD].flatMap((_, i): Track[] => {
    const t0 = 200 + i * 110;
    return [
      tr('titleWord', `text.char.${i}.y`, [k(0, -520, 'hold'), k(t0, -520, 'easeIn'), k(t0 + 380, 0, 'easeOut'), k(t0 + 480, -26, 'easeIn'), k(t0 + 580, 0)]),
      tr('titleWord', `text.char.${i}.rotation`, [k(0, i % 2 ? 40 : -40, 'hold'), k(t0, i % 2 ? 40 : -40, 'easeOut'), k(t0 + 480, 0)]),
      tr('titleWord', `text.char.${i}.opacity`, [k(0, 0, 'hold'), k(t0, 0, 'easeOut'), k(t0 + 150, 1)]),
    ];
  });
  // the mascot hops along the letters; each one dips and squashes as it lands on it
  const hopsAt = [1700, 2150, 2600, 3050];
  const xs = [-145, -50, 50, 145];
  const bump = (i: number, t: number): Track[] => [
    tr('titleWord', `text.char.${i}.scale`, [k(0, 1), k(t, 1, 'easeOut'), k(t + 90, 0.8, 'overshoot'), k(t + 300, 1)]),
    tr('titleWord', `text.char.${i}.y`, [k(0, 0), k(t, 0, 'easeOut'), k(t + 90, 22, 'overshoot'), k(t + 300, 0)]),
  ];
  const bumps = hopsAt.flatMap((t, j) => bump(j + 1, t));
  // a letter both drops in and gets bumped: its y keys join into one track
  const merged = new Map<string, Track>();
  for (const t of [...letters, ...bumps]) {
    const have = merged.get(t.property);
    if (!have) { merged.set(t.property, t); continue; }
    have.keyframes = [...have.keyframes, ...t.keyframes.filter((x) => x.time > have.keyframes.at(-1)!.time)];
  }
  return {
    id: 'p_cine_title', name: 'BLOOBY Title', source: 'builtin', durationMs: D,
    tagline: 'Cinematic typography · letters rain in one by one · mascot hops across the word',
    layers: [words('titleWord', 'Title', WORD, { size: 150, letterSpacing: 4 }, {
      parentId: null, surface: flat(0, 150), color: rgb(255, 255, 255), zIndex: -1,
      effects: [fx('shadow', { y: 14, blur: 0, opacity: 1 }, INK), fx('glow', { radius: 26, strength: 0.9 }, MAGENTA)],
    })],
    appearances: [on('titleWord', 0, D, 0, 300)],
    tracks: [
      ...merged.values(),
      ...xy('body', [[0, -145, -260, 'hold'], [1300, -145, -260, 'easeIn'], [1700, -145, -30, 'easeOut'],
        ...hopsAt.slice(1).flatMap((t, j): [number, number, number, E][] => [[t - 225, (xs[j] + xs[j + 1]) / 2, -150, 'easeIn'], [t, xs[j + 1], -30, 'easeOut']]),
        [3700, 145, -30, 'easeInOut'], [4300, 0, -300, 'easeInOut'], [4700, 0, -260], [D, 0, -260]]),
      ...uniform('body', [[0, 0.45], [4300, 0.45, 'overshoot'], [4700, 0.7], [D, 0.7]]),
      ...squish('body', [[0, 1, 1], ...hopsAt.flatMap((t): [number, number, number, E][] => [[t - 40, 0.9, 1.15, 'easeOut'], [t, 1.25, 0.75, 'overshoot'], [t + 160, 1, 1, 'easeOut']]), [D, 1, 1]]),
      tr('titleWord', 'effect.glow.strength', [k(0, 0.2), k(900, 0.2, 'easeInOut'), k(1300, 2), k(1700, 0.9), k(4300, 0.9, 'easeOut'), k(4600, 2.2), k(D, 1)]),
      camera('camera.zoom', [[0, 1.4, 'easeInOut'], [1600, 1, 'easeInOut'], [4200, 1.08, 'easeInOut'], [D, 1]]),
      camera('camera.offset.y', [[0, -60, 'easeInOut'], [1600, 0], [D, 0]]),
    ],
    emitters: [burst({ name: 'title sparkle', color: MAGENTA, colorTo: GOLD, from: { nodeId: 'titleWord', x: 0, y: 0 }, to: { nodeId: 'titleWord', x: 0, y: 0 },
      count: 70, velocity: 520, spread: 360, lifeMs: 1200, startMs: 4300, endMs: D })],
    modifiers: [shakeCamera(4550, 4800, 6)],
  };
}

// --- 9. card flip in depth ------------------------------------------------------------------------
function flip(): Preset {
  const D = 4000;
  const card = (id: string, name: string, stops: [ColorStop, ColorStop]) => prop('roundedRect', id, name, 0, 0, 330, 440, stops[0], {
    zIndex: -2, gradient: { type: 'linear', angle: 135, stops: [{ at: 0, color: stops[0] }, { at: 1, color: stops[1] }] },
    effects: [fx('shadow', { y: 30, blur: 30, opacity: 0.4 }, INK)], depth: { z: 900, rotateX: 0, rotateY: 0 },
  });
  const cards = [card('flipBack', 'Card back', [VIOLET, rgb(40, 20, 90)]), card('flipFront', 'Card front', [GOLD, MAGENTA])];
  return {
    id: 'p_cine_flip', name: '3D Card Flip', source: 'builtin', durationMs: D,
    tagline: '2.5D depth · card flies in and flips over · mascot spins round on its sphere',
    layers: cards,
    appearances: [on('flipBack', 0, 1300, 200, 0), on('flipFront', 1300, 3700, 0, 300)],
    tracks: [
      tr('flipBack', 'depth.z', [k(0, 900, 'easeOut'), k(900, 0), k(D, 0)]),
      tr('flipFront', 'depth.z', [k(0, 0), k(3200, 0, 'easeIn'), k(3700, 700)]),
      tr('flipBack', 'depth.rotateY', [k(0, -30, 'easeOut'), k(900, 0, 'easeIn'), k(1300, 90)]),
      tr('flipFront', 'depth.rotateY', [k(1300, -90, 'overshoot'), k(1750, 0), k(3200, 0, 'easeIn'), k(3700, 60)]),
      tr('flipBack', 'depth.rotateX', [k(0, 25, 'easeOut'), k(900, 0), k(D, 0)]),
      // the mascot rides on the card, turning all the way round in 3D as it flips
      tr('body', 'depth.rotateY', [k(0, 0), k(1000, 0, 'easeInOut'), k(1300, 90, 'linear'), k(1600, 270, 'easeOut'), k(1900, 360), k(1901, 0, 'hold'), k(D, 0)]),
      ...uniform('body', [[0, 0.3, 'easeOut'], [900, 0.7, 'easeInOut'], [1300, 0.8, 'overshoot'], [1900, 1], [3200, 1, 'easeIn'], [3700, 0.75], [D, 1]]),
      ...xy('body', [[0, 0, -40, 'easeOut'], [900, 0, 0], [1300, 0, -80, 'easeIn'], [1900, 0, 0, 'easeOut'], [D, 0, 0]]),
      ...squish('body', [[1850, 1, 1, 'easeOut'], [1950, 1.2, 0.82, 'overshoot'], [2250, 1, 1]]),
      camera('camera.zoom', [[0, 0.9, 'easeInOut'], [1300, 1.15, 'easeInOut'], [2200, 1, 'easeInOut'], [D, 1]]),
      ...blinkEyes([2500]),
    ],
    emitters: [burst({ name: 'flip sparkle', color: GOLD, colorTo: rgb(255, 255, 255), count: 50, velocity: 600, lifeMs: 1000, startMs: 1300, endMs: 2400, from: { nodeId: 'flipFront', x: 0, y: 0 }, to: { nodeId: 'flipFront', x: 0, y: 0 } })],
  };
}

/**
 * Presets end to end as ONE preset: each part's keys, effects, emitters and layer ranges moved
 * to where it starts. Tracks on the same property join into one — every part closes on the
 * value it opened with, so the join is seamless. Layer ids must not collide between parts,
 * except shared rig parts (arms, legs), which are brought once and ranged for each part.
 */
export function sequence(id: string, name: string, tagline: string, parts: Preset[]): Preset {
  const tracks = new Map<string, Track>();
  const layers = new Map<string, RigNode>();
  const out: Preset = { id, name, tagline, source: 'builtin', durationMs: 0, tracks: [], modifiers: [], emitters: [], appearances: [] };
  for (const part of parts) {
    const at = out.durationMs;
    for (const t of part.tracks) {
      const key = `${t.nodeId} ${t.property}`;
      const keys = t.keyframes.map((x) => ({ ...structuredClone(x), id: uid('k'), time: x.time + at }));
      const have = tracks.get(key);
      if (!have) { tracks.set(key, { ...t, id: uid('t'), keyframes: keys }); continue; }
      // a part's opening key replaces the previous part's closing key at the same instant
      have.keyframes = [...have.keyframes.filter((x) => x.time < keys[0].time), ...keys];
    }
    const span = <T extends { startMs?: number; endMs?: number }>(x: T): T => ({ ...structuredClone(x), startMs: at + (x.startMs ?? 0), endMs: at + (x.endMs ?? part.durationMs) });
    out.modifiers!.push(...(part.modifiers ?? []).map(span).map((m) => (m.kind === 'walk' ? { ...m, holdUntilMs: m.holdUntilMs ?? at + part.durationMs } : m)));
    out.emitters!.push(...(part.emitters ?? []).map(span));
    out.appearances!.push(...(part.appearances ?? []).map(span));
    for (const l of part.layers ?? []) if (!layers.has(l.id)) layers.set(l.id, structuredClone(l));
    out.durationMs += part.durationMs;
  }
  out.tracks = [...tracks.values()];
  out.layers = [...layers.values()];
  return out;
}

/** The mascot at rest — what each of its animated properties is when nothing moves it. */
const REST: Record<string, number> = {
  'transform.scale.x': 1, 'transform.scale.y': 1, 'squish.x': 1, 'squish.y': 1, 'flatOffset.x': 0, 'flatOffset.y': 0,
  'transform.rotation': 0, 'eye.openness': 1, 'surface.yaw': 0, 'depth.rotateY': 0,
};
const MASCOT_PARTS = new Set(['body', 'face', 'eyeL', 'eyeR']);

/**
 * `looped`, with the mascot's tracks opening — and so closing — on its REST pose: a clip whose
 * mascot is not there yet (a portal, a glitch) must not hand an invisible mascot to whatever
 * plays next, the next clip or the next part of a sequence. The preset's own first pose
 * starts 1ms in; the rest pose before it is one held instant.
 */
function settled(p: Preset): Preset {
  for (const t of p.tracks) {
    const rest = REST[t.property];
    const first = t.keyframes[0];
    if (!MASCOT_PARTS.has(t.nodeId) || rest === undefined || !first || first.value === rest) continue;
    if (first.time === 0) first.time = 1;
    t.keyframes.unshift(k(0, rest, 'hold'));
  }
  return looped(p);
}

export function cinematicPresets(): Preset[] {
  const all = [portal(), morph(), walk(), particles(), liquid(), glitch(), doodle(), title(), flip()].map(settled);
  // 20s: arrive, walk, glitch, turn into something else, burst into a word and come back
  const reel = sequence('p_cine_showreel', 'Ultimate Showreel', 'A ~20-second showreel · portal, walk + parallax, glitch, morph, particles, one continuous take',
    [portal(), walk(), glitch(), morph(), particles()].map(settled));
  return [...all, settled(reel)];
}
