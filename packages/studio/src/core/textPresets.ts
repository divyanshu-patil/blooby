import { both, flat, guideCurve, k, looped, shape, squash, tr, uniform, words, type E } from './showcase';
import type { Preset, RigNode, TextCharAnim, Track } from './types';

/**
 * Presets for words: ten ways for letters to arrive (§29) and five pieces of curved text
 * (§30). Each brings its own text layer — and a guide curve where the words need one — so
 * it plays on a bare project. The straight ones play on a text of the user's instead when
 * one is selected (`textPresetOnto`); they animate letters, never a text's position or its
 * words, so they can.
 */

/** the caption every straight text preset shares, so placing two animates one caption */
const caption = (content = 'HELLO!') => words('caption', 'Caption', content, { size: 56 }, { surface: flat(0, -250) });
const shown = (nodeId: string, startMs: number, endMs: number, fadeOutMs = 180) => ({ nodeId, startMs, endMs, fadeOutMs });
/** letters arriving: which motion, its stagger, and 0 → 1 between `from` and `to` */
const letters = (id: string, kind: TextCharAnim, from: number, to: number, stagger: number, e: E = 'easeOut'): Track[] => [
  tr(id, 'text.chars.kind', [k(0, kind, 'hold')]),
  tr(id, 'text.chars.stagger', [k(0, stagger, 'hold')]),
  tr(id, 'text.chars.progress', [k(from, 0, e), k(to, 1)]),
];

export function textPresets(): Preset[] {
  const follow = guideCurve('followPath', 'Follow path', [[-320, -110], [-160, -220], [0, -250], [160, -220], [320, -110]]);
  const look = guideCurve('lookPath', 'Look path',
    [[-170, -240], [-60, -290], [60, -210], [170, -260]],
    [[-170, -240], [-60, -210], [60, -290], [170, -260]]);
  const soon = guideCurve('soonPath', 'Soon path', [[-340, 210], [-170, 150], [0, 210], [170, 270], [340, 210]]);
  const lookUp = (end: number) => tr('body', 'surface.pitch', [k(0, 0), k(300, -10, 'easeOut'), k(end - 300, -10), k(end, 0)]);
  const watch = (end: number) => tr('body', 'surface.yaw', [k(0, 0), k(300, -22, 'easeOut'), k(end - 300, 22), k(end, 0)]);
  const all: Preset[] = [
    // --- letters arriving (§29) ------------------------------------------------------------
    {
      id: 'p_txt_pop', name: 'Pop In', source: 'builtin', durationMs: 1400, tagline: 'Text: Letters Pop',
      layers: [caption()], appearances: [shown('caption', 0, 1400)],
      tracks: letters('caption', 'pop', 0, 800, 0.6),
    },
    {
      // reveal.end counts characters; textPresetOnto scales it to the text it lands on
      id: 'p_txt_type', name: 'Typewriter', source: 'builtin', durationMs: 1600, tagline: 'Text: Typed Out',
      layers: [caption()], appearances: [shown('caption', 0, 1600)],
      tracks: [tr('caption', 'text.reveal.end', [k(0, 0, 'linear'), k(1000, 6)])],
    },
    {
      id: 'p_txt_bounce', name: 'Bounce In', source: 'builtin', durationMs: 1500, tagline: 'Text: Letters Drop + Bounce',
      layers: [caption()], appearances: [shown('caption', 0, 1500)],
      tracks: letters('caption', 'drop', 0, 900, 0.55, 'linear'),
    },
    {
      id: 'p_txt_fadeslide', name: 'Fade + Slide', source: 'builtin', durationMs: 1400, tagline: 'Text: Letters Rise + Fade',
      layers: [caption()], appearances: [shown('caption', 0, 1400)],
      tracks: letters('caption', 'rise', 0, 800, 0.45),
    },
    {
      // the line starts all but straight and curls up as its letters fade in
      id: 'p_txt_curved', name: 'Curved Reveal', source: 'builtin', durationMs: 1800, tagline: 'Text: Arc + Fade',
      layers: [words('curvedCaption', 'Curved', 'CURVED REVEAL', { size: 34, path: { mode: 'arc', radius: 1400, start: -60, end: 60 } }, { surface: flat(0, -240) })],
      appearances: [shown('curvedCaption', 0, 1800)],
      tracks: [tr('curvedCaption', 'text.arc.radius', [k(0, 1400, 'easeOut'), k(900, 240)]), ...letters('curvedCaption', 'fade', 0, 900, 0.7)],
    },
    {
      // in from everywhere, a beat, and away again
      id: 'p_txt_scatter', name: 'Letter Scatter', source: 'builtin', durationMs: 2000, tagline: 'Text: Letters Scatter',
      layers: [caption()], appearances: [shown('caption', 0, 2000, 100)],
      tracks: [
        tr('caption', 'text.chars.kind', [k(0, 'scatter', 'hold')]),
        tr('caption', 'text.chars.stagger', [k(0, 0.3, 'hold')]),
        tr('caption', 'text.chars.progress', [k(0, 0, 'easeOut'), k(800, 1), k(1300, 1, 'easeIn'), k(2000, 0)]),
      ],
    },
    {
      id: 'p_txt_path', name: 'Path Follow', source: 'builtin', durationMs: 2600, tagline: 'Text: Travels Along a Curve',
      layers: [follow.node, words('followCaption', 'Follow', 'FOLLOW ME', { size: 32, path: { mode: 'path', nodeId: 'followPath', baseline: 6 } })],
      appearances: [shown('followPath', 0, 2600), shown('followCaption', 0, 2600)],
      tracks: [tr('followCaption', 'text.path.offset', [k(0, -250, 'linear'), k(2600, 250)]), watch(2600), lookUp(2600)],
    },
    {
      id: 'p_txt_wavy', name: 'Wavy Text', source: 'builtin', durationMs: 2400, tagline: 'Text: Letters Wave',
      layers: [caption()], appearances: [shown('caption', 0, 2400)],
      tracks: [
        tr('caption', 'text.chars.kind', [k(0, 'wave', 'hold')]),
        tr('caption', 'text.chars.stagger', [k(0, 0.5, 'hold')]),
        // a cycle, keyed per half wave like Talk: the repetition is the motion, no pose to hold
        tr('caption', 'text.chars.progress', Array.from({ length: 7 }, (_, i) => k(i * 400, i / 2, 'linear'))),
      ],
    },
    {
      // slammed down from big, with an overshoot — and the mascot flinches as it lands
      id: 'p_txt_stamp', name: 'Stamp', source: 'builtin', durationMs: 1500, tagline: 'Text: Stamped Down',
      layers: [caption()], appearances: [shown('caption', 0, 1500)],
      tracks: [
        ...uniform('caption', [[0, 2.4, 'easeIn'], [200, 0.9, 'overshoot'], [360, 1], [1500, 1]]),
        tr('caption', 'transform.rotation', [k(0, -16, 'easeIn'), k(200, -4, 'overshoot'), k(1200, -4), k(1500, 0)]),
        tr('caption', 'opacity', [k(0, 0, 'easeOut'), k(90, 1)]),
        tr('body', 'flatOffset.y', [k(0, 0), k(200, 0), k(260, 8, 'easeOut'), k(420, 0), k(1500, 0)]),
        ...squash('body', [[0, 1], [200, 1], [260, 0.9, 'easeOut'], [420, 1], [1500, 1]]),
      ],
    },
    {
      id: 'p_txt_elastic', name: 'Elastic Text', source: 'builtin', durationMs: 1600, tagline: 'Text: Elastic Spacing',
      layers: [caption()], appearances: [shown('caption', 0, 1600)],
      tracks: [
        tr('caption', 'text.letterSpacing', [k(0, 60, 'elastic'), k(1000, 0)]),
        tr('caption', 'transform.scale.x', [k(0, 1.5, 'elastic'), k(1000, 1)]),
        tr('caption', 'opacity', [k(0, 0, 'easeOut'), k(160, 1)]),
      ],
    },

    // --- curved text (§30) -----------------------------------------------------------------
    {
      id: 'p_txt_helloarc', name: 'HELLO! Arc', source: 'builtin', durationMs: 2000, tagline: 'Curved Text: Arc Over the Head',
      layers: [words('helloArc', 'Hello arc', 'HELLO!', { size: 44, path: { mode: 'arc', radius: 240, start: -34, end: 34 } }, { parentId: 'body', surface: flat(0, -160) })],
      appearances: [shown('helloArc', 0, 2000, 200)],
      tracks: [...letters('helloArc', 'pop', 0, 900, 0.7), lookUp(2000), ...both('eye.openness', [k(0, 1), k(500, 0.45, 'easeOut'), k(1600, 0.45), k(1900, 1)])],
    },
    {
      // a ring of words round the mascot, turning, while it tries a new shape
      id: 'p_txt_ring', name: 'NEW SHAPE Ring', source: 'builtin', durationMs: 3200, tagline: 'Curved Text: A Turning Circle',
      // the arc's centre is `radius` below where the layer sits: on the body's centre, clear of its rim
      layers: [words('ringText', 'Ring', 'NEW SHAPE • NEW SHAPE • NEW SHAPE • ', { size: 22, letterSpacing: 1, path: { mode: 'arc', radius: 172, start: -180, end: 180 } },
        { parentId: 'body', surface: flat(0, -172) })],
      appearances: [shown('ringText', 0, 3200, 240)],
      tracks: [
        // one full turn: the circle is 2π × 172 px round
        tr('ringText', 'text.path.offset', [k(0, 0, 'linear'), k(3200, 1081)]),
        ...letters('ringText', 'fade', 0, 600, 0.4),
        tr('body', 'shape.path', [k(0, shape('circle'), 'hold'), k(900, shape('circle'), 'overshoot'), k(1400, shape('pebble'), 'hold'),
          k(2400, shape('pebble'), 'smooth'), k(3000, shape('circle'))]),
        ...squash('body', [[0, 1], [850, 0.92], [1050, 1.06, 'easeOut'], [1300, 1], [3200, 1]]),
      ],
    },
    {
      // words on a curve that is itself moving: path keyframes on the guide under them
      id: 'p_txt_lookhere', name: 'LOOK HERE Wave', source: 'builtin', durationMs: 2600, tagline: 'Curved Text: A Waving Curve',
      layers: [look.node, words('lookText', 'Look', 'LOOK HERE', { size: 34, path: { mode: 'path', nodeId: 'lookPath', baseline: 6 } })],
      appearances: [shown('lookPath', 0, 2600), shown('lookText', 0, 2600)],
      tracks: [
        tr('lookPath', 'shape.path', [k(0, look.a), k(650, look.b), k(1300, look.a), k(1950, look.b), k(2600, look.a)]),
        ...letters('lookText', 'rise', 0, 700, 0.5),
        lookUp(2600),
      ],
    },
    {
      id: 'p_txt_soon', name: 'COMING SOON', source: 'builtin', durationMs: 3200, tagline: 'Curved Text: Travelling a Path',
      layers: [soon.node, words('soonText', 'Soon', 'COMING SOON', { size: 34, path: { mode: 'path', nodeId: 'soonPath', baseline: 6 } })],
      appearances: [shown('soonPath', 0, 3200), shown('soonText', 0, 3200)],
      tracks: [
        tr('soonText', 'text.path.offset', [k(0, -230, 'linear'), k(3200, 230)]),
        watch(3200),
        tr('body', 'surface.pitch', [k(0, 0), k(300, 10, 'easeOut'), k(2900, 10), k(3200, 0)]),
      ],
    },
    {
      // the words pop onto a smile of a curve over the mascot, one after another
      id: 'p_txt_hithere', name: 'HI THERE Pop', source: 'builtin', durationMs: 1800, tagline: 'Curved Text: Popping onto a Curve',
      layers: [words('hiThere', 'Hi there', 'HI THERE', { size: 40, path: { mode: 'arc', radius: 220, start: -36, end: 36, reverse: true } },
        { parentId: 'body', surface: flat(0, -172) })],
      appearances: [shown('hiThere', 0, 1800, 200)],
      tracks: [
        ...letters('hiThere', 'pop', 0, 900, 0.8),
        tr('body', 'flatOffset.y', [k(0, 0), k(100, 6, 'easeOut'), k(300, -14, 'easeIn'), k(480, 0), k(1800, 0)]),
        ...squash('body', [[0, 1], [100, 0.92], [300, 1.06, 'easeOut'], [480, 1], [1800, 1]]),
      ],
    },
  ];
  return all.map(looped);
}

const count = (s: string) => [...s.replace(/\n/g, '')].length;

/**
 * A text preset played on a text of the user's: that text instead of the preset's own, and
 * a typewriter that types all of it, however long it is. Null when the preset is not one
 * that can — words on a curve of its own, or words that come with another mascot.
 *
 * The user's words stay once they have arrived: the closing keys `looped` adds are there
 * so the preset's own caption can loop, unseen because it has faded out by then — on a
 * text that stays on screen they would hide it again in the last frame, so they go.
 */
export function textPresetOnto(preset: Preset, node: RigNode): Preset | null {
  const own = (preset.layers ?? []).filter((l) => l.text);
  if (!node.text || own.length !== 1 || (own[0].text!.path?.mode ?? 'straight') !== 'straight') return null;
  if ((preset.layers ?? []).some((l) => l.kind === 'body')) return null;
  const from = own[0].id, scale = count(node.text.content) / Math.max(1, count(own[0].text!.content));
  const swap = (id: string) => (id === from ? node.id : id);
  return {
    ...preset,
    layers: preset.layers?.filter((l) => l.id !== from),
    appearances: preset.appearances?.filter((a) => a.nodeId !== from),
    modifiers: preset.modifiers?.map((m) => ({ ...m, nodeId: swap(m.nodeId) })),
    tracks: preset.tracks.map((t) => {
      if (t.nodeId !== from) return t;
      const kept = t.keyframes.length > 2 ? t.keyframes.filter((f) => f.time < preset.durationMs - 1) : t.keyframes;
      const keys = kept.length ? kept : t.keyframes;
      return {
        ...t, nodeId: node.id,
        keyframes: t.property.startsWith('text.reveal.') ? keys.map((f) => ({ ...f, value: Math.round((f.value as number) * scale) })) : keys,
      };
    }),
  };
}
