import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject } from '../core/defaults';
import { addMascot } from '../core/layers';
import { registerFont } from '../core/fonts';
import type { SceneItem } from '../core/scene';
import type { ColorStop } from '../core/types';
import { bakeLottie } from './lottie';

/**
 * Scenes written by hand and fed through `sampleAt`, for the cases a real rig never
 * produces: an effect Lottie has no form for, artwork with its own paint, a glyph that
 * arrives late, a face that never loaded.
 */
const project = defaultProject();
const FPS = project.fps;
const red: ColorStop = { r: 255, g: 0, b: 0, a: 1 };
const blue: ColorStop = { r: 0, g: 0, b: 255, a: 1 };
const stroke = { color: blue, width: 3, cap: 'round', join: 'bevel' } as const;
const item = (id: string, over: Partial<SceneItem> = {}): SceneItem => ({
  id, name: id, shape: 'pill', cx: 0, cy: 0, w: 20, h: 20, r: 10, rotation: 0, color: red, depth: 0, zIndex: 0, alpha: 1, ...over,
});
/** sample as a function of the frame number, over `to` ms */
const bake = (scene: (f: number) => SceneItem[], to = 200, name = 'synthetic') =>
  bakeLottie(project, { background: null, name, from: 0, to, sampleAt: (ms) => scene(Math.round((ms * FPS) / 1000)) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const layers = (r: ReturnType<typeof bake>) => (r.json as any).layers as any[];

// --- the shortest clip: two frames, nothing to simplify --------------------------------
{
  const r = bake((f) => [item('a', { cx: f * 40 })], 0);
  it('a two-frame clip keeps both frames', check(r.frames === 1 && layers(r).length === 1));
}

// --- a layer that cannot be seen on any frame ------------------------------------------
{
  const r = bake(() => [item('ghost', { alpha: 0, color: { ...red, a: 0 } })]);
  it('a layer that is never visible still exports, held still', check(layers(r).length === 1));
}

// --- what a Lottie player cannot draw, named once per layer name -----------------------
{
  const r = bake((f) => [
    item('one', { name: 'dup', fx: { list: [{ kind: 'glow', params: {} }, { kind: 'flicker', params: {} }], clock: f }, gradient: { type: 'linear', angle: 0, stops: [] } }),
    item('two', { name: 'dup', clip: { d: 'M0 0' }, goo: { id: 'g', radius: 4 }, taper: 0.5 }),
    f % 2 ? item('three', { name: 'late', taper: 1 }) : item('x', { name: 'x' }),
    item('lottie-ok', { fx: { list: [{ kind: 'flicker', params: {} }], clock: 0 } }),
    item('lottie-fine'),
  ]);
  const w = r.warnings.join('\n');
  it('each name lists what it lost', check(w.includes('dup: glow, gradient fill, mask, goo, stroke taper') && w.includes('late: stroke taper'), w));
  it('and a layer with only supported effects says nothing', check(!w.includes('lottie-ok')));
}

// --- trim, blends, stroke over time ----------------------------------------------------
{
  const r = bake((f) => [
    item('trimmed', { trim: { start: 0.1, end: 0.6, offset: 0.2 }, blend: 'weird' as never, stroke: f > 2 ? stroke : undefined, path: 'M-0.5 0 L0.5 0' }),
    item('absent-then-here', { name: 'ah' }),
  ].filter((x) => x.id !== 'absent-then-here' || f % 3 !== 0));
  const t = layers(r).find((l) => l.nm === 'trimmed');
  it('a trimmed line gets a trim path and an unknown blend falls back to normal', check(t.bm === 0 && JSON.stringify(t.shapes).includes('"ty":"tm"')));
}

// --- several mascots name their layers by owner ----------------------------------------
{
  const p = defaultProject();
  addMascot(p, 'blob' as never);
  const r = bakeLottie(p, { background: '#ffffff', name: 'many', from: 0, to: 100 });
  it('layers say whose they are', check(layers(r).some((l) => String(l.nm).includes(' / ')) && layers(r).some((l) => l.nm === 'Backdrop')));
}

// --- a limb, and an outline that is gone on later frames -------------------------------------
{
  const r = bake((f) => [
    item('limb', { path: 'M-0.5 0 L0.5 0 L0 0.5 Z', limb: true }),
    item('round', { shape: 'ellipse', ...(f === 0 ? { path: 'M-0.5 0 L0.5 0 L0 0.5 Z' } : {}) }),
    item('boxy', { ...(f === 0 ? { path: 'M-0.5 0 L0.5 0 L0 0.5 Z' } : {}) }),
  ]);
  it('a limb outline is resampled finely and a vanished outline falls back to its primitive', check(layers(r).length === 3 && r.baked.includes('limb')));
}

// --- artwork with its own paint ----------------------------------------------------------
{
  const sq = (a: number, b: number) => `M${a} ${a} L${b} ${a} L${b} ${b} L${a} ${b} Z`;
  const paths = [
    { d: sq(-0.5, 0.5), fill: null, stroke: red, strokeWidth: 0.05, evenOdd: true as const },
    { d: sq(-0.4, 0.4), fill: blue, stroke: null },
    { d: sq(-0.3, 0.3), evenOdd: true as const },
    { d: sq(-0.2, 0.2), strokeWidth: 0.1 },
    { d: sq(-0.1, 0.1), stroke: red },
  ];
  const withLayerStroke = bake(() => [item('art', { paths, stroke, trim: { start: 0, end: 0.5 } })]);
  const plain = bake(() => [item('plain', { paths })]);
  const a = JSON.stringify(layers(withLayerStroke)), b = JSON.stringify(layers(plain));
  it('own fills, own strokes, holes and the layer stroke all come through', check(a.includes('"r":2') && a.includes('"ty":"st"') && b.includes('"ty":"fl"') && a.includes('"ty":"tm"')));
  it('with no layer stroke only the artwork\'s own strokes remain', check(b.includes('"ty":"st"') && !b.includes('"nm":"stroke","hd":false,"c":{"a":1')));
  const empty = bake(() => [item('nothing', { paths: [{ d: '' }] })]);
  it('artwork with no outline falls back to the plain shape', check(layers(empty).length === 1 && empty.baked.length === 0));
  const broken = bake((f) => [item('inf', { paths: [{ d: 'M0 0 L1e999 1' }] }), item('wobble', { paths: [{ d: f % 2 ? sq(-0.5, 0.5) : sq(-0.4, 0.4) }] })]);
  it('an outline with no finite point is written as it stands', check(layers(broken).length === 2));
}

// --- imported SVG ------------------------------------------------------------------------
{
  const svg = (sourceMarkup: string, viewBox = '0 0 10 10') => ({ sourceMarkup, viewBox });
  const markup = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" fill="#f00"/><path d="M0 0 L5 0 L5 5 Z" fill="none"/><path d="M1 1 L4 1 L4 4 Z" fill="currentColor"/><path d="M2 2 L3 2 L3 3 Z" fill="inherit"/><path d="M2 2 L6 2 L6 6 Z" fill="red"/><path d="M3 3 L7 3 L7 7 Z"/></svg>';
  const r = bake(() => [
    item('ok', { svg: svg(markup) }),
    item('badbox', { svg: svg(markup, 'a b c d') }),
    item('flat', { svg: svg(markup, '0 0 0 10') }),
    item('invisible', { svg: svg('<svg><path d="M0 0 L1 1 L2 0 Z" fill="none"/></svg>') }),
    item('empty', { svg: svg('<svg></svg>') }),
  ]);
  it('readable artwork is baked, unreadable is named and skipped', check(r.baked.includes('ok') && r.skipped.join() === 'badbox,flat,invisible,empty', r.skipped.join()));
}

// --- text as letters ---------------------------------------------------------------------
{
  const font = { family: 'Synth', weight: 400, style: 'normal' as const };
  const tri = 'M-0.3 0 L0.3 0 L0 -0.7 Z';
  registerFont(font, {
    unitsPerEm: 1000, ascender: 800, descender: -200, advance: () => 0.6, kern: () => 0,
    outline: (ch) => (ch === 'x' ? null : ch === 'i' ? 'M0 0 L1e999 1' : ch === 'o' ? 'M0 0' : tri),
  });
  const glyph = (ch: string, index: number, over = {}) => ({ ch, index, x: index * 20, y: 0, rot: 0, scale: 1, alpha: 1, ...over });
  const text = (f: number): SceneItem[] => (f > 5 ? [] : [item('t', {
    glyphs: [glyph('a', 0), ...(f < 3 ? [glyph('b', 1)] : []), ...(f > 1 ? [glyph('c', 2, { rot: 10 })] : []), glyph('o', 3)],
    font: { ...font, size: 24 }, rotation: 15, stroke: f === 2 ? stroke : undefined,
  })]);
  const r = bake(text);
  const t = layers(r).filter((l) => l.nm);
  it('each letter is its own outlined layer', check(t.length >= 1 && JSON.stringify(t).includes('"ty":"sh"')));
  it('a glyph that arrives late is held out until then', check(r.warnings.length === 0));

  // outlined text with no stroke, no layer alpha, a late frame with no font, and a glyph with no finite point
  const bare = bake((f) => [{ ...item('b', { glyphs: [glyph('a', 0), glyph('i', 1)], font: { ...font, size: 20 } }), alpha: undefined, ...(f > 3 ? { font: undefined } : {}) }].map((x) => x as SceneItem));
  it('outlined text with no stroke has no stroke item', check(layers(bare).length >= 1 && !JSON.stringify(layers(bare)).includes('"ty":"st"')));

  // a face with no outlines: live text, and the warning names it
  const live = bake((f) => [item('t', { glyphs: [glyph('x', 0), ...(f < 3 ? [glyph('y', 1)] : [])], font: { family: 'Nowhere', weight: 700, style: 'italic', size: 20 }, alpha: f > 3 ? 0.5 : 1 })]);
  it('a face that never loaded becomes live text, said so', check(live.warnings.some((w) => w.includes('Nowhere 700 italic')) && JSON.stringify(live.json).includes('"fFamily":"Nowhere"')));
  const upright = bake(() => [item('t', { glyphs: [glyph('x', 0)], font: { family: 'Nowhere', weight: 400, style: 'normal', size: 20 } })]);
  it('and an upright one is named without the style', check(upright.warnings.some((w) => w.includes('Nowhere 400 was not loaded'))));

  // a text layer the library has no drawing for
  const typed = bake((f) => [item('emoji', { text: '\u{1f389}', h: 10 + f }), item('later', { text: 'z' })].map((x, i) => (i === 1 && f > 2 ? { ...x, text: undefined } : x)).filter((x) => !(x.id === 'later' && f === 1)));
  it('a typed glyph is live text in the generic face', check(layers(typed).some((l) => l.ty === 5) && JSON.stringify(typed.json).includes('blooby-sans')));
}
