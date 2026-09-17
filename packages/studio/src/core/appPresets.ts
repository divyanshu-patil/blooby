import { art, both, k, limb, looped, onMascot, point, tr, uniform, words, flat, type E } from './showcase';
import { makeShapeLayer } from './layers';
import type { Appearance, Preset, RigNode, Track } from './types';
import { INK, noDecksHere, noSavedDecks, noSearchResults, pullToRefresh, startSearch } from './mascotKit';

/**
 * Ten presets for the screens an app actually has: refresh, a profile, search and its empty
 * result, empty and new decks, saved items, an idle vibe, a notification, onboarding.
 *
 * Built like the showcase (core/showcase.ts): every prop is a real layer the preset brings —
 * a magnifier, a card, a bookmark, a badge, a button, a pull arc drawn on with trim.end — on
 * screen only inside the clip, and every move is plain keyframes to edit afterwards. The
 * FACE moves on its own (it is its own layer now), and squash goes on squish.x / squish.y so
 * it stacks on anything else animating scale.
 *
 * Timings follow copilot/craft.ts: anticipation, a hold that lets the pose read, 40–80ms of
 * overlap between the body and what it drives, ~10% overshoot. Taglines carry the words
 * people search for ("empty state"), so the copilot finds them.
 */


const DECK_SLOT = `<svg viewBox="0 0 120 150">
  <rect x="8" y="8" width="104" height="134" rx="14" fill="none" stroke="#9c9486" stroke-width="5" stroke-dasharray="14 10"/>
  <path d="M60 52 V98 M37 75 H83" stroke="#9c9486" stroke-width="7" stroke-linecap="round"/>
</svg>`;
const NEW_DECK = `<svg viewBox="0 0 120 150">
  <rect x="20" y="4" width="92" height="126" rx="12" fill="#f7c948" stroke="${INK}" stroke-width="5"/>
  <rect x="8" y="16" width="92" height="126" rx="12" fill="#f29bb8" stroke="${INK}" stroke-width="5"/>
  <path d="M54 50 L60 66 L77 67 L64 78 L68 95 L54 86 L40 95 L44 78 L31 67 L48 66 Z" fill="#ffffff"/>
</svg>`;
const BADGE = `<svg viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#e8584a" stroke="#ffffff" stroke-width="5"/>
  <path d="M28 20 L36 16 V48" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
const POINTER = `<svg viewBox="0 0 70 90">
  <path d="M20 6 A7 7 0 0 1 34 6 V40 L54 44 A9 9 0 0 1 62 54 L58 76 A14 14 0 0 1 44 88 H28 A12 12 0 0 1 17 81 L4 58 A7 7 0 0 1 16 50 L20 55 Z"
    fill="#ffffff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const RIPPLE = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#2233e0" stroke-width="6"/></svg>`;

/** a layer on screen for this span of the clip, fading in and out */
const on = (nodeId: string, startMs: number, endMs: number, fadeInMs = 160, fadeOutMs = 220): Omit<Appearance, 'id' | 'blockId'> =>
  ({ nodeId, startMs, endMs, fadeInMs, fadeOutMs });
/** squish x and y keyed together — [ms, x, y, easing] */
const squish = (nodeId: string, keys: [number, number, number, E?][]): Track[] => [
  tr(nodeId, 'squish.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'squish.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
const xy = (nodeId: string, keys: [number, number, number, E?][]): Track[] => [
  tr(nodeId, 'flatOffset.x', keys.map(([t, x, , e]) => k(t, x, e))),
  tr(nodeId, 'flatOffset.y', keys.map(([t, , y, e]) => k(t, y, e))),
];
/** a prop in the world rather than on the mascot, so it does not ride the body's moves */
const inWorld = (x: number, y: number): Partial<RigNode> => ({ parentId: null, surface: flat(x, y) });
const arms = (): RigNode[] => [limb('arm', -1), limb('arm', 1)];
const REST_L: [number, number] = [-196, 96], REST_R: [number, number] = [196, 96];


export function appPresets(): Preset[] {
  const all: Preset[] = [
    pullToRefresh(),
    {
      // calm, then happy eyes, a hand up, a little wave, a tiny bounce, happy idle
      id: 'p_app_profile', name: 'Profile Hello', source: 'builtin', durationMs: 3000,
      tagline: 'Friendly hand wave for profile, account and welcome screens',
      layers: [limb('arm', 1)],
      appearances: [on('armR', 0, 3000, 120, 160)],
      tracks: [
        ...both('eye.openness', [k(0, 1), k(560, 1, 'linear'), k(760, 0.42, 'easeOut'), k(2600, 0.42), k(2900, 1, 'easeInOut')]),
        ...both('transform.scale.x', [k(0, 1), k(560, 1, 'linear'), k(760, 1.16, 'easeOut'), k(2600, 1.16), k(2900, 1)]),
        tr('armR', 'limb.length', [k(0, 114), k(700, 114, 'linear'), k(980, 150, 'easeOut'), k(1900, 150), k(2250, 114, 'easeInOut')]),
        ...point('armR', 'b', [[0, ...REST_R], [700, ...REST_R, 'easeInOut'], [980, 206, -86, 'overshoot'], [1160, 158, -74], [1340, 208, -88], [1520, 160, -76], [1700, 204, -86, 'easeInOut'], [2250, ...REST_R, 'easeInOut']]),
        tr('face', 'transform.rotation', [k(0, 0), k(760, 0), k(1000, 6, 'easeOut'), k(1800, 4), k(2300, 0, 'easeInOut')]),
        tr('body', 'transform.rotation', [k(0, 0), k(800, 0), k(1040, 3, 'easeOut'), k(1850, 2), k(2350, 0, 'easeInOut')]),
        tr('body', 'flatOffset.y', [k(0, 0), k(860, 0, 'easeIn'), k(1000, -14, 'easeOut'), k(1180, 0, 'easeIn'), k(3000, 0)]),
        ...squish('body', [[0, 1, 1], [860, 1.05, 0.95, 'easeOut'], [1000, 0.96, 1.05, 'easeIn'], [1180, 1.07, 0.93, 'easeOut'], [1400, 1, 1, 'easeOut'], [3000, 1, 1]]),
      ],
    },
    startSearch(),
    noSearchResults(),
    noDecksHere(),
    {
      // a dashed slot, then a deck pops into it: overshoot, settle, a little cheer
      id: 'p_app_createdeck', name: 'Create a Deck', source: 'builtin', durationMs: 2600,
      tagline: 'New card pops in · overshoot · celebrate · let\'s create',
      layers: [
        ...arms(),
        art('deckSlot', 'Deck slot', DECK_SLOT, { ...inWorld(240, 40), size: { x: 110, y: 138 }, zIndex: 29 }),
        art('newDeck', 'New deck', NEW_DECK, { ...inWorld(240, 40), size: { x: 110, y: 138 }, zIndex: 30 }),
      ],
      appearances: [on('armL', 0, 2600, 120, 160), on('armR', 0, 2600, 120, 160), on('deckSlot', 0, 820, 160, 160), on('newDeck', 600, 2600, 40, 240)],
      tracks: [
        tr('face', 'surface.yaw', [k(0, 0), k(200, 0, 'easeInOut'), k(500, 20), k(2600, 20)]),
        // anticipation, then the card lands with a 18% overshoot
        ...squish('body', [[0, 1, 1], [420, 1.08, 0.92, 'easeIn'], [600, 0.94, 1.07, 'easeOut'], [1000, 1.1, 0.9, 'easeOut'], [1180, 1, 1, 'easeOut'], [2600, 1, 1]]),
        ...uniform('newDeck', [[600, 0, 'easeOut'], [800, 1.18, 'easeInOut'], [950, 0.96, 'easeInOut'], [1100, 1, 'easeOut'], [2600, 1]]),
        tr('newDeck', 'transform.rotation', [k(600, -18, 'easeOut'), k(900, 5), k(1150, 0, 'easeOut'), k(2600, 0)]),
        tr('body', 'flatOffset.y', [k(0, 0), k(600, 0, 'easeOut'), k(820, -30, 'easeIn'), k(1000, 0, 'easeOut'), k(2600, 0)]),
        ...point('armL', 'b', [[0, ...REST_L], [640, ...REST_L, 'easeOut'], [880, -206, -54, 'overshoot'], [1500, -200, -44, 'easeInOut'], [1900, ...REST_L, 'easeInOut'], [2600, ...REST_L]]),
        ...point('armR', 'b', [[0, ...REST_R], [680, ...REST_R, 'easeOut'], [920, 206, -54, 'overshoot'], [1540, 200, -44, 'easeInOut'], [1940, ...REST_R, 'easeInOut'], [2600, ...REST_R]]),
        ...both('eye.openness', [k(0, 1), k(700, 1, 'linear'), k(880, 0.4, 'easeOut'), k(2600, 0.4)]),
        ...both('transform.scale.x', [k(0, 1), k(700, 1, 'linear'), k(880, 1.18, 'easeOut'), k(2600, 1.18)]),
      ],
    },
    noSavedDecks(),
    {
      // listening to music: sway, head bob against it, hands and weight shifting — loops
      id: 'p_app_vibe', name: 'Little Vibe', source: 'builtin', durationMs: 3600,
      tagline: 'Seamless idle loop · sway to music · hands, legs, face, squish',
      layers: [...arms(), limb('leg', -1), limb('leg', 1)],
      appearances: ['armL', 'armR', 'legL', 'legR'].map((id) => on(id, 0, 3600, 0, 0)),
      tracks: [
        // every track starts and ends on the same value, on a 900ms beat, so it loops clean
        tr('body', 'transform.rotation', [k(0, 0), k(900, -4), k(1800, 0), k(2700, 4), k(3600, 0)]),
        tr('body', 'flatOffset.y', [0, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600].map((t, i) => k(t, i % 2 ? 5 : 0))),
        ...squish('body', [0, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600].map((t, i) => [t, i % 2 ? 1.03 : 1, i % 2 ? 0.97 : 1] as [number, number, number])),
        // the face sways against the body, a beat behind
        tr('face', 'transform.rotation', [k(0, 0), k(1000, 4), k(1900, 0), k(2800, -4), k(3600, 0)]),
        tr('face', 'flatOffset.x', [k(0, 0), k(1000, -4), k(1900, 0), k(2800, 4), k(3600, 0)]),
        ...both('eye.openness', [k(0, 0.5), k(1500, 0.5, 'linear'), k(1570, 0.06, 'easeIn'), k(1660, 0.5, 'easeOut'), k(3600, 0.5)]),
        ...both('transform.scale.x', [k(0, 1.12), k(3600, 1.12)]),
        ...point('armL', 'b', [[0, ...REST_L], [900, -186, 110], [1800, ...REST_L], [2700, -206, 82], [3600, ...REST_L]]),
        ...point('armR', 'b', [[0, ...REST_R], [900, 206, 82], [1800, ...REST_R], [2700, 186, 110], [3600, ...REST_R]]),
        // weight onto one foot, then the other: the resting leg's ankle lifts a touch, and
        // both counter the bob so the feet stay on the floor
        ...point('legL', 'c', [0, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600].map((t, i) => [t, -60, 230 - (i % 2 ? 5 : 0) - (t === 2700 ? 8 : 0)] as [number, number, number])),
        ...point('legR', 'c', [0, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600].map((t, i) => [t, 60, 230 - (i % 2 ? 5 : 0) - (t === 900 ? 8 : 0)] as [number, number, number])),
      ],
    },
    {
      // a badge pops by the head: overshoot, a glance, a wiggle, back to neutral
      id: 'p_app_notification', name: 'Notification Pop', source: 'builtin', durationMs: 2200,
      tagline: 'Alert badge pops in · glance · squish · messages and updates',
      layers: [art('notifBadge', 'Badge', BADGE, { ...onMascot(122, -132), size: { x: 58, y: 58 }, zIndex: 30 })],
      appearances: [on('notifBadge', 300, 2200, 0, 220)],
      tracks: [
        ...uniform('notifBadge', [[300, 0, 'easeOut'], [480, 1.25, 'easeInOut'], [620, 0.92, 'easeInOut'], [760, 1, 'easeOut'], [2200, 1]]),
        tr('notifBadge', 'transform.rotation', [k(300, 0), k(950, 0, 'easeInOut'), k(1030, -14), k(1110, 12), k(1190, -6), k(1270, 0, 'easeOut'), k(2200, 0)]),
        ...squish('body', [[0, 1, 1], [300, 1, 1, 'easeOut'], [400, 0.93, 1.08, 'easeOut'], [560, 1.04, 0.96, 'easeInOut'], [720, 1, 1, 'easeOut'], [2200, 1, 1]]),
        tr('face', 'surface.yaw', [k(0, 0), k(380, 0, 'easeOut'), k(620, 18), k(1400, 18, 'easeInOut'), k(1750, 0), k(2200, 0)]),
        tr('face', 'surface.pitch', [k(0, 0), k(380, 0, 'easeOut'), k(620, -14), k(1400, -14, 'easeInOut'), k(1750, 0), k(2200, 0)]),
        ...both('transform.scale.x', [k(0, 1), k(380, 1, 'linear'), k(560, 1.22, 'overshoot'), k(1400, 1.2), k(1750, 1, 'easeInOut')]),
        ...both('eye.openness', [k(0, 1), k(1450, 1, 'linear'), k(1520, 0.06, 'easeIn'), k(1610, 1, 'easeOut'), k(2200, 1)]),
      ],
    },
    {
      // a pointer glides to a Start button, taps, the button squashes, the mascot cheers
      id: 'p_app_tapstart', name: 'Tap to Start', source: 'builtin', durationMs: 3000,
      tagline: 'Onboarding · tap indicator · button press · happy bounce',
      layers: [
        ...arms(),
        { ...makeShapeLayer('roundedRect', { name: 'Start button', color: { r: 34, g: 51, b: 224, a: 1 } }), id: 'startButton', ranged: true, parentId: null, surface: flat(0, 262), size: { x: 200, y: 64 }, zIndex: 28 },
        words('startLabel', 'Start', 'Start', { size: 30 }, { parentId: null, surface: flat(0, 262), color: { r: 255, g: 255, b: 255, a: 1 }, zIndex: 29 }),
        art('tapRipple', 'Tap ripple', RIPPLE, { ...inWorld(34, 268), size: { x: 90, y: 90 }, zIndex: 30 }),
        art('tapPointer', 'Pointer', POINTER, { ...inWorld(280, 430), size: { x: 56, y: 72 }, zIndex: 31 }),
      ],
      appearances: [
        on('armL', 0, 3000, 120, 160), on('armR', 0, 3000, 120, 160), on('startButton', 0, 3000, 200, 240), on('startLabel', 0, 3000, 200, 240),
        on('tapPointer', 300, 2600, 200, 300), on('tapRipple', 1300, 1800, 0, 260),
      ],
      tracks: [
        ...xy('tapPointer', [[300, 280, 430, 'easeInOut'], [1200, 40, 290, 'easeOut'], [1300, 36, 284, 'easeIn'], [1500, 40, 290, 'easeInOut'], [2000, 40, 290, 'easeIn'], [2600, 300, 420]]),
        ...uniform('tapPointer', [[300, 1], [1250, 1, 'easeIn'], [1340, 0.84, 'easeOut'], [1500, 1, 'easeOut'], [3000, 1]]),
        // the press
        ...squish('startButton', [[0, 1, 1], [1300, 1, 1, 'easeIn'], [1360, 1.06, 0.86, 'easeOut'], [1520, 0.97, 1.05, 'easeInOut'], [1660, 1, 1, 'easeOut'], [3000, 1, 1]]),
        ...squish('startLabel', [[0, 1, 1], [1300, 1, 1, 'easeIn'], [1360, 1.06, 0.86, 'easeOut'], [1520, 0.97, 1.05, 'easeInOut'], [1660, 1, 1, 'easeOut'], [3000, 1, 1]]),
        ...uniform('tapRipple', [[1300, 0.3, 'easeOut'], [1800, 1.6]]),
        tr('tapRipple', 'opacity', [k(1300, 1, 'easeIn'), k(1800, 0)]),
        // the mascot watches the pointer, then cheers
        tr('face', 'surface.pitch', [k(0, 0), k(500, 0, 'easeInOut'), k(1100, 18), k(1450, 18, 'easeOut'), k(1700, 0), k(3000, 0)]),
        tr('face', 'surface.yaw', [k(0, 0), k(400, 12, 'easeInOut'), k(1100, 4), k(1700, 0), k(3000, 0)]),
        tr('body', 'flatOffset.y', [k(0, 0), k(1500, 0, 'easeOut'), k(1700, -34, 'easeIn'), k(1900, 0, 'easeOut'), k(2050, -12, 'easeIn'), k(2200, 0, 'easeOut'), k(3000, 0)]),
        ...squish('body', [[0, 1, 1], [1420, 1.08, 0.92, 'easeOut'], [1600, 0.94, 1.07, 'easeInOut'], [1900, 1.1, 0.9, 'easeOut'], [2080, 0.98, 1.02], [2250, 1, 1, 'easeOut'], [3000, 1, 1]]),
        ...point('armL', 'b', [[0, ...REST_L], [1560, ...REST_L, 'easeOut'], [1760, -206, -50, 'overshoot'], [2200, -200, -40, 'easeInOut'], [2600, ...REST_L], [3000, ...REST_L]]),
        ...point('armR', 'b', [[0, ...REST_R], [1600, ...REST_R, 'easeOut'], [1800, 206, -50, 'overshoot'], [2240, 200, -40, 'easeInOut'], [2640, ...REST_R], [3000, ...REST_R]]),
        ...both('eye.openness', [k(0, 1), k(1450, 1, 'linear'), k(1650, 0.4, 'easeOut'), k(2600, 0.4), k(2900, 1, 'easeInOut')]),
        ...both('transform.scale.x', [k(0, 1), k(1450, 1, 'linear'), k(1650, 1.18, 'easeOut'), k(2600, 1.18), k(2900, 1, 'easeInOut')]),
      ],
    },
  ];
  return all.map(looped);
}
