import { art, both, k, limb, looped, onMascot, point, tr, uniform, words, flat, type E } from './showcase';
import { makeCurveLayer, makeShapeLayer } from './layers';
import type { Appearance, Preset, RigNode, Track } from './types';

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

const INK = '#141318';

const MAGNIFIER = `<svg viewBox="0 0 100 100">
  <circle cx="40" cy="40" r="26" fill="#dff2ff" fill-opacity="0.55" stroke="${INK}" stroke-width="9"/>
  <path d="M59 59 L86 86" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
  <path d="M28 30 A14 14 0 0 1 40 22" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>`;
const EMPTY_DECK = `<svg viewBox="0 0 120 150">
  <rect x="22" y="6" width="90" height="124" rx="12" fill="#e9e3d7" stroke="${INK}" stroke-width="5"/>
  <rect x="8" y="18" width="90" height="124" rx="12" fill="#ffffff" stroke="${INK}" stroke-width="5"/>
  <path d="M30 60 H76 M30 78 H62" stroke="#c9c1b1" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 13"/>
</svg>`;
const DECK_SLOT = `<svg viewBox="0 0 120 150">
  <rect x="8" y="8" width="104" height="134" rx="14" fill="none" stroke="#9c9486" stroke-width="5" stroke-dasharray="14 10"/>
  <path d="M60 52 V98 M37 75 H83" stroke="#9c9486" stroke-width="7" stroke-linecap="round"/>
</svg>`;
const NEW_DECK = `<svg viewBox="0 0 120 150">
  <rect x="20" y="4" width="92" height="126" rx="12" fill="#f7c948" stroke="${INK}" stroke-width="5"/>
  <rect x="8" y="16" width="92" height="126" rx="12" fill="#f29bb8" stroke="${INK}" stroke-width="5"/>
  <path d="M54 50 L60 66 L77 67 L64 78 L68 95 L54 86 L40 95 L44 78 L31 67 L48 66 Z" fill="#ffffff"/>
</svg>`;
const BOOKMARK = `<svg viewBox="0 0 80 110">
  <path d="M10 10 A8 8 0 0 1 18 2 H62 A8 8 0 0 1 70 10 V104 L40 80 L10 104 Z" fill="#8ec5ff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
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
const QUESTION = `<svg viewBox="0 0 60 90">
  <path d="M12 24 A18 18 0 1 1 38 40 C31 45 30 49 30 58" stroke="${INK}" stroke-width="10" stroke-linecap="round" fill="none"/>
  <circle cx="30" cy="78" r="6.5" fill="${INK}"/>
</svg>`;

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

/** The pull arc: three quarters of a circle over the head, drawn on as the pull grows. */
function pullArc(): RigNode {
  const pts = [-90, -10, 70, 150].map((deg) => ({ x: 30 * Math.cos((deg * Math.PI) / 180), y: -250 + 30 * Math.sin((deg * Math.PI) / 180) }));
  const c = makeCurveLayer(pts, { name: 'Refresh arc', type: 'smooth', color: { r: 20, g: 19, b: 24, a: 1 }, width: 7 })!;
  return { ...c, id: 'pullArc', ranged: true, trim: { start: 0, end: 0 } };
}

export function appPresets(): Preset[] {
  const all: Preset[] = [
    {
      // pull → stretch → release → pop → settle
      id: 'p_app_refresh', name: 'Pull to Refresh', source: 'builtin', durationMs: 2800,
      tagline: 'Pull-down gesture · stretch, pop, squash · arc drawn on',
      layers: [...arms(), pullArc()],
      appearances: [on('armL', 0, 2800, 120, 160), on('armR', 0, 2800, 120, 160), on('pullArc', 80, 1900, 120, 260)],
      tracks: [
        // tucked up and a little squashed, pulled down and stretched, flung up, landed
        tr('body', 'flatOffset.y', [k(0, 0, 'easeOut'), k(200, -26, 'easeInOut'), k(950, 34, 'easeIn'), k(1020, 36, 'easeOut'), k(1260, -58, 'easeIn'), k(1500, 0, 'easeOut'), k(2800, 0)]),
        ...squish('body', [[0, 1, 1, 'easeOut'], [200, 1.08, 0.92, 'easeInOut'], [950, 0.9, 1.12, 'easeIn'], [1020, 0.9, 1.12, 'easeOut'], [1260, 0.94, 1.08, 'easeIn'],
          [1500, 1.16, 0.84, 'easeOut'], [1680, 0.96, 1.05, 'easeInOut'], [1880, 1, 1, 'easeOut'], [2800, 1, 1]]),
        // the face trails the body by a beat: it sags on the pull and lifts on the fling
        tr('face', 'flatOffset.y', [k(0, 0), k(1000, 10, 'easeIn'), k(1300, -8, 'easeOut'), k(1600, 2), k(1900, 0, 'easeOut'), k(2800, 0)]),
        ...both('eye.openness', [k(0, 1), k(300, 1, 'linear'), k(950, 0.5, 'easeIn'), k(1060, 1, 'easeOut'), k(1900, 1), k(2150, 0.45, 'easeOut'), k(2800, 0.45)]),
        ...both('transform.scale.x', [k(0, 1), k(1060, 1, 'linear'), k(1260, 1.22, 'overshoot'), k(1700, 1.1), k(2800, 1.1)]),
        // hands brace outward as it is pulled, fly up on release
        ...point('armL', 'b', [[0, ...REST_L], [950, -236, 40, 'easeIn'], [1260, -214, -46, 'easeOut'], [1720, ...REST_L, 'easeInOut'], [2800, ...REST_L]]),
        ...point('armR', 'b', [[0, ...REST_R], [990, 236, 40, 'easeIn'], [1300, 214, -46, 'easeOut'], [1760, ...REST_R, 'easeInOut'], [2800, ...REST_R]]),
        // the arc draws itself with the pull, spins once on release, then goes
        tr('pullArc', 'trim.end', [k(100, 0, 'easeOut'), k(950, 1, 'linear'), k(2800, 1)]),
        // two half-turns: rotation takes the short way round, so one 0 → 360 key would not spin at all
        tr('pullArc', 'transform.rotation', [k(0, 0), k(1000, 0, 'easeIn'), k(1350, 170, 'linear'), k(1700, 340, 'easeOut'), k(2800, 340)]),
        ...uniform('pullArc', [[1000, 1, 'overshoot'], [1150, 1.2], [1700, 0.7, 'easeIn'], [2800, 0.7]]),
      ],
    },
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
    {
      // a magnifier drifts in, the face turns to it, it searches in little loops, settle
      id: 'p_app_search', name: 'Start Search', source: 'builtin', durationMs: 3200,
      tagline: 'Magnifying glass search · look toward it · bounce',
      layers: [art('magnifier', 'Magnifier', MAGNIFIER, { ...inWorld(420, -40), size: { x: 104, y: 104 }, zIndex: 30 })],
      appearances: [on('magnifier', 0, 3200, 200, 260)],
      tracks: [
        ...xy('magnifier', [[0, 420, -40, 'easeOut'], [800, 230, -70, 'easeInOut'], [1100, 250, -30], [1400, 206, -10], [1700, 238, -84], [2000, 214, -50, 'easeInOut'], [2600, 226, -60, 'easeOut'], [3200, 226, -60]]),
        ...uniform('magnifier', [[0, 0.6, 'easeOut'], [800, 1.08], [1000, 1, 'easeInOut'], [3200, 1]]),
        tr('magnifier', 'transform.rotation', [k(0, 30), k(800, -6, 'easeOut'), k(1100, 8), k(1400, -10), k(1700, 6), k(2000, 0, 'easeInOut'), k(3200, 0)]),
        // the face looks where the glass is, 60ms behind it
        tr('face', 'surface.yaw', [k(0, 0), k(420, 0, 'easeInOut'), k(860, 24, 'easeOut'), k(1160, 28), k(1460, 20), k(1760, 30), k(2060, 24, 'easeInOut'), k(3200, 24)]),
        tr('face', 'surface.pitch', [k(0, 0), k(860, -8, 'easeOut'), k(1760, -14), k(2060, -8), k(3200, -8)]),
        ...both('transform.scale.x', [k(0, 1), k(700, 1, 'linear'), k(900, 1.2, 'overshoot'), k(3200, 1.2)]),
        tr('body', 'transform.rotation', [k(0, 0), k(900, 4, 'easeOut'), k(2300, 3), k(3200, 3)]),
        tr('body', 'flatOffset.y', [k(0, 0), k(2240, 0, 'easeIn'), k(2400, -18, 'easeOut'), k(2580, 0, 'easeIn'), k(3200, 0)]),
        ...squish('body', [[0, 1, 1], [2240, 1.06, 0.94, 'easeOut'], [2400, 0.95, 1.06, 'easeIn'], [2580, 1.08, 0.92, 'easeOut'], [2800, 1, 1, 'easeOut'], [3200, 1, 1]]),
      ],
    },
    {
      // "oops, nothing found": looks one way, the other, a tiny shrug, the glass leaves
      id: 'p_app_noresults', name: 'No Search Results', source: 'builtin', durationMs: 3300,
      tagline: 'Empty state · nothing found · look around, confused',
      layers: [
        art('magnifier', 'Magnifier', MAGNIFIER, { ...onMascot(170, -150), size: { x: 78, y: 78 }, zIndex: 30 }),
        art('questionMark', 'Question mark', QUESTION, { ...onMascot(-120, -200), size: { x: 40, y: 60 }, zIndex: 31 }),
      ],
      appearances: [on('magnifier', 250, 2800, 140, 360), on('questionMark', 1900, 2900, 100, 240)],
      tracks: [
        ...uniform('magnifier', [[250, 0, 'easeOut'], [460, 1.15], [600, 1, 'easeInOut'], [3300, 1]]),
        // it goes where the eyes go
        ...xy('magnifier', [[600, 170, -150, 'easeInOut'], [900, -170, -150], [1300, -170, -150, 'easeInOut'], [1600, 170, -140], [2200, 170, -140, 'easeIn'], [2800, 250, -110]]),
        tr('face', 'surface.yaw', [k(0, 0), k(500, 0, 'easeInOut'), k(900, -30), k(1300, -30, 'easeInOut'), k(1700, 30), k(2000, 30, 'easeInOut'), k(2400, 0, 'easeOut'), k(3300, 0)]),
        tr('face', 'transform.rotation', [k(0, 0), k(2000, 0), k(2200, -8, 'easeOut'), k(2800, -5), k(3300, 0)]),
        ...both('eye.openness', [k(0, 1), k(2000, 1, 'linear'), k(2160, 0.72, 'easeOut'), k(3000, 0.8), k(3300, 1)]),
        ...both('transform.scale.y', [k(0, 1), k(2000, 1), k(2160, 0.86, 'easeOut'), k(3000, 0.9), k(3300, 1)]),
        tr('body', 'transform.rotation', [k(0, 0), k(2000, 0), k(2200, -5, 'easeOut'), k(2800, -3), k(3300, 0)]),
        ...uniform('questionMark', [[1900, 0, 'easeOut'], [2060, 1.2], [2200, 1, 'easeInOut'], [2900, 1]]),
        tr('questionMark', 'transform.rotation', [k(1900, -20, 'easeOut'), k(2200, 6), k(2500, -4), k(2900, 0)]),
        // a small sigh: down and wider
        ...squish('body', [[0, 1, 1], [2200, 1, 1, 'easeInOut'], [2450, 1.05, 0.95, 'easeOut'], [2900, 1.02, 0.98, 'easeInOut'], [3300, 1, 1]]),
      ],
    },
    {
      // an empty deck appears beside it, it looks, the card tilts empty, a shrug, a smile
      id: 'p_app_nodecks', name: 'No Decks Here', source: 'builtin', durationMs: 3300,
      tagline: 'Empty state · empty card list · shrug',
      layers: [...arms(), art('emptyDeck', 'Empty deck', EMPTY_DECK, { ...inWorld(240, 40), size: { x: 104, y: 130 }, zIndex: 30 })],
      appearances: [on('armL', 0, 3300, 120, 160), on('armR', 0, 3300, 120, 160), on('emptyDeck', 200, 3300, 120, 240)],
      tracks: [
        ...uniform('emptyDeck', [[200, 0, 'easeOut'], [420, 1.12], [560, 1, 'easeInOut'], [3300, 1]]),
        tr('emptyDeck', 'transform.rotation', [k(200, 0), k(1000, 0, 'easeInOut'), k(1250, -14, 'easeOut'), k(1500, 6), k(1700, 0, 'easeInOut'), k(3300, 0)]),
        tr('emptyDeck', 'flatOffset.y', [k(200, 40), k(1000, 40, 'easeOut'), k(1250, 24), k(1700, 40, 'easeInOut'), k(3300, 40)]),
        tr('face', 'surface.yaw', [k(0, 0), k(500, 0, 'easeInOut'), k(800, 22), k(1800, 22, 'easeInOut'), k(2200, 0), k(3300, 0)]),
        tr('face', 'surface.pitch', [k(0, 0), k(800, 6, 'easeOut'), k(1800, 6), k(2200, 0), k(3300, 0)]),
        // the shrug: hands up and out, body a little up, head tilted
        ...point('armL', 'b', [[0, ...REST_L], [1800, ...REST_L, 'easeOut'], [2000, -182, 16, 'easeInOut'], [2350, -182, 16, 'easeInOut'], [2600, ...REST_L]]),
        ...point('armR', 'b', [[0, ...REST_R], [1840, ...REST_R, 'easeOut'], [2040, 182, 16, 'easeInOut'], [2390, 182, 16, 'easeInOut'], [2640, ...REST_R]]),
        tr('body', 'flatOffset.y', [k(0, 0), k(1800, 0, 'easeOut'), k(2000, -10, 'easeInOut'), k(2350, -10, 'easeInOut'), k(2600, 0), k(3300, 0)]),
        tr('face', 'transform.rotation', [k(0, 0), k(1850, 0, 'easeOut'), k(2050, -9), k(2400, -9, 'easeInOut'), k(2650, 0)]),
        ...both('eye.openness', [k(0, 1), k(1800, 1, 'linear'), k(1950, 0.74, 'easeOut'), k(2400, 0.74), k(2650, 0.45, 'easeInOut'), k(3150, 0.45)]),
        ...both('transform.scale.x', [k(0, 1), k(2400, 1), k(2650, 1.14, 'easeInOut'), k(3150, 1.14)]),
      ],
    },
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
    {
      // looks around, a bookmark appears overhead, it checks it — nothing — the bookmark goes
      id: 'p_app_nosaved', name: 'No Saved Decks', source: 'builtin', durationMs: 3300,
      tagline: 'Empty state · no saved items · bookmark · gently disappointed',
      layers: [art('bookmark', 'Bookmark', BOOKMARK, { ...onMascot(0, -250), size: { x: 60, y: 82 }, zIndex: 30 })],
      appearances: [on('bookmark', 1000, 2700, 100, 320)],
      tracks: [
        tr('face', 'surface.yaw', [k(0, 0), k(250, 0, 'easeInOut'), k(600, -22), k(850, -22, 'easeInOut'), k(1150, 20), k(1350, 0, 'easeInOut'), k(3300, 0)]),
        tr('face', 'surface.pitch', [k(0, 0), k(1200, 0, 'easeOut'), k(1450, -18), k(2300, -18, 'easeInOut'), k(2600, 10), k(3000, 4), k(3300, 0)]),
        ...uniform('bookmark', [[1000, 0, 'easeOut'], [1180, 1.16], [1320, 1, 'easeInOut'], [2300, 1, 'easeIn'], [2700, 0.5]]),
        // a little wobble — "nothing in here"
        tr('bookmark', 'transform.rotation', [k(1000, 0), k(1600, 0, 'easeInOut'), k(1720, -12), k(1840, 10), k(1960, -6), k(2080, 0, 'easeOut'), k(2700, 0)]),
        tr('bookmark', 'flatOffset.y', [k(1000, -250), k(2300, -250, 'easeIn'), k(2700, -210)]),
        ...both('eye.openness', [k(0, 1), k(2150, 1, 'linear'), k(2350, 0.55, 'easeOut'), k(2900, 0.6), k(3200, 1, 'easeInOut')]),
        tr('body', 'flatOffset.y', [k(0, 0), k(2200, 0, 'easeInOut'), k(2450, 6), k(2900, 4, 'easeInOut'), k(3300, 0)]),
        ...squish('body', [[0, 1, 1], [2200, 1, 1, 'easeInOut'], [2450, 1.05, 0.95, 'easeOut'], [2900, 1.03, 0.97, 'easeInOut'], [3300, 1, 1]]),
      ],
    },
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
