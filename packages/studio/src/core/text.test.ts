import { it } from 'vitest';
import { check } from './testkit';
import { arcSampler, fallbackMetrics, layoutLines, placeGlyphs, TEXT_DEFAULTS } from './text';
import { flattenPath, mapPath, pathSampler } from './path';
import { curveFromPath, curveToPath, moveAnchor } from './curve';
import { defaultProject, makeTimeline } from './defaults';
import { sceneAt, type SceneItem } from './scene';
import { compOf } from './comp';
import { addMascot, makeCurveLayer, makeTextLayer, placeUnder, removeLayer } from './layers';
import { bakeLottie } from '../export/lottie';
import type { Keyframe, KeyValue, Project, TextStyle, Vec2 } from './types';

const style = (over: Partial<TextStyle> = {}): TextStyle => ({
  content: 'HELLO', font: { ...TEXT_DEFAULTS.font }, size: 40, lineHeight: 1.2, letterSpacing: 0,
  align: 'left', valign: 'top', ...over,
});
const m = fallbackMetrics(40, 600);
const kf = (time: number, value: KeyValue): Keyframe => ({ id: `k${time}${String(value)}`, time, value, easingOut: { type: 'linear' } });

/** A project with no clips, so a plain keyframe plays everywhere. */
function blank(): Project {
  const p = defaultProject();
  const tl = makeTimeline('Idle');
  tl.timelineDurationMs = 2000;
  return { ...p, timelines: [tl], activeTimelineId: tl.id };
}
const itemOf = (p: Project, id: string, t = 0) => sceneAt(p, t, compOf(p)).find((s) => s.id === id);

// --- lines ---------------------------------------------------------------------------------
{
  const one = layoutLines(style(), m);
  it('one line of five characters', check(one.length === 1 && one[0].chars.length === 5));
  const two = layoutLines(style({ content: 'Hello\nWorld' }), m);
  it('a line break starts a new line', check(two.length === 2 && two[1].chars[0].ch === 'W'));
  it('and is not itself a character', check(two[1].chars[0].index === 5));
  const wrapped = layoutLines(style({ content: 'the quick brown fox jumps over', width: 150 }), m);
  it('a box width wraps the words', check(wrapped.length > 2 && wrapped.every((l) => l.width <= 150 + 1e-6), wrapped.map((l) => l.width.toFixed(0)).join()));
  it('at spaces, never through a word that fits', check(wrapped.every((l) => l.chars[0].ch !== ' ')));
  const spaced = layoutLines(style({ letterSpacing: 10 }), m);
  it('letter spacing goes between the characters', check(Math.abs(spaced[0].width - one[0].width - 40) < 1e-6));
}

// --- alignment keeps its anchor ------------------------------------------------------------
{
  const edges = (g: { x: number; ch: string }[], mm = m) => ({ left: g[0].x - mm.advance(g[0].ch) / 2, right: g.at(-1)!.x + mm.advance(g.at(-1)!.ch) / 2 });
  const L = edges(placeGlyphs(style({ align: 'left' }), m).glyphs);
  const C = edges(placeGlyphs(style({ align: 'center' }), m).glyphs);
  const R = edges(placeGlyphs(style({ align: 'right' }), m).glyphs);
  it('left-aligned text starts at its anchor', check(Math.abs(L.left) < 1e-6));
  it('centred text is centred on it', check(Math.abs(C.left + C.right) < 1e-6));
  it('right-aligned text ends at it', check(Math.abs(R.right) < 1e-6));
  const small = fallbackMetrics(20, 600);
  const L2 = edges(placeGlyphs(style({ size: 20 }), small).glyphs, small);
  it('a size change keeps a left-aligned line where it starts — no jump', check(Math.abs(L2.left - L.left) < 1e-6));
  const up = placeGlyphs(style({ valign: 'bottom', content: 'A\nB' }), m).glyphs;
  it('bottom-aligned lines sit above their anchor', check(up.every((g) => g.y < 0) && up[1].y > up[0].y));
}

// --- the typewriter and per-letter motion --------------------------------------------------
{
  it('the typewriter draws only the characters in its range', check(placeGlyphs(style({ reveal: { start: 1, end: 3 } }), m).glyphs.map((g) => g.ch).join('') === 'EL'));
  it('and nothing at all from an empty one', check(placeGlyphs(style({ reveal: { start: 0, end: 0 } }), m).glyphs.length === 0));
  const at = (progress: number) => placeGlyphs(style({ chars: { kind: 'pop', progress, stagger: 1 } }), m).glyphs;
  it('letters pop in one at a time: none before, some halfway, all at the end', check(at(0).length === 0 && at(0.5).length > 0 && at(0.5).length < 5 && at(1).length === 5));
  it('landing at full size', check(at(1).every((g) => Math.abs(g.scale - 1) < 1e-6)));
  const wave = placeGlyphs(style({ chars: { kind: 'wave', progress: 0.25, stagger: 0.5 } }), m).glyphs;
  it('a wave lifts each letter by a different amount', check(new Set(wave.map((g) => Math.round(g.y))).size > 1));
  const s1 = JSON.stringify(placeGlyphs(style({ chars: { kind: 'scatter', progress: 0.3, stagger: 0 } }), m).glyphs);
  it('a scatter lands the same way every time it is drawn', check(s1 === JSON.stringify(placeGlyphs(style({ chars: { kind: 'scatter', progress: 0.3, stagger: 0 } }), m).glyphs)));
  it('and settles into plain text', check(JSON.stringify(placeGlyphs(style({ chars: { kind: 'scatter', progress: 1, stagger: 0 } }), m).glyphs) === JSON.stringify(placeGlyphs(style(), m).glyphs)));
}

// --- round an arc --------------------------------------------------------------------------
{
  const R = 200;
  const arc = (reverse = false) => placeGlyphs(style({ align: 'center', path: { mode: 'arc', radius: R, start: -60, end: 60, reverse } }), m, arcSampler(R, -60, 60, reverse)).glyphs;
  const g = arc();
  it('text on an arc sits exactly on its circle', check(g.every((x) => Math.abs(Math.hypot(x.x, x.y - R) - R) < 1e-6)));
  it('each letter turned to the curve, left to right', check(g.every((x, i) => i === 0 || x.rot > g[i - 1].rot)));
  it('centred, the middle letter stands upright at the top', check(Math.abs(g[2].rot) < 8 && g[0].x < 0 && g[4].x > 0));
  const s = arc(true);
  it('reversed, the arc is a smile: its ends rise, and it still reads left to right', check(s[0].y < s[2].y && s[4].y < s[2].y && s[0].x < s[4].x));
}

// --- along a path --------------------------------------------------------------------------
{
  const line = pathSampler('M 0 0 L 400 0')!;
  const on = (over: TextStyle['path']) => placeGlyphs(style({ path: { mode: 'path', ...over } }), m, line).glyphs;
  it('text on a line sits on it', check(on({ mode: 'path' }).every((g) => Math.abs(g.y) < 1e-6)));
  it('starting at its offset', check(Math.abs(on({ mode: 'path', offset: 20 })[0].x - (20 + m.advance('H') / 2)) < 1e-6));
  it('the baseline offset lifts it off the line', check(on({ mode: 'path', baseline: 15 }).every((g) => Math.abs(g.y + 15) < 1e-6)));
  const down = placeGlyphs(style({ path: { mode: 'path' } }), m, pathSampler('M 0 0 L 0 400')!).glyphs;
  it('down a vertical line every letter turns to follow it', check(down.every((g) => Math.abs(g.rot - 90) < 1e-6)));
  it('reversed, it starts from the far end', check(on({ mode: 'path', reverse: true })[0].x > 300));
  const flip = on({ mode: 'path', flip: true });
  it('flipped, each letter is turned over and the word runs back along the line', check(flip.every((g) => Math.abs(g.rot - 180) < 1e-6) && flip[0].x > flip[4].x));
  const ring = pathSampler('M 0 -100 C 55.2 -100 100 -55.2 100 0 C 100 55.2 55.2 100 0 100 C -55.2 100 -100 55.2 -100 0 C -100 -55.2 -55.2 -100 0 -100 Z')!;
  const loop = placeGlyphs(style({ content: 'AROUND AND AROUND', path: { mode: 'path', offset: ring.length - 30 } }), m, ring).glyphs;
  it('round a closed path, text runs past the seam and keeps going round', check(loop.every((g) => Math.abs(Math.hypot(g.x, g.y) - 100) < 1)));
}

// --- a text layer in a project ---------------------------------------------------------------
{
  const p = blank();
  p.rig.nodes.t = makeTextLayer('HI THERE', { id: 't' });
  const item = itemOf(p, 't')!;
  it('a text layer draws its letters', check(item.glyphs?.length === 7 && item.font?.family === 'Inter'));
  it('centred on where it stands', check(Math.abs(item.cx - compOf(p).width / 2) < 1 && Math.abs(item.cy - (compOf(p).height / 2 - 240)) < 1));
  p.rig.nodes.t.transform.scale = { x: 2, y: 2 };
  const big = itemOf(p, 't')!;
  it('scaling it scales the letters, never squashing them', check(Math.abs(big.w - item.w * 2) < 1e-6 && big.font!.size === item.font!.size * 2));
  p.rig.nodes.t.transform.scale = { x: 1, y: 1 };
  p.rig.nodes.t.text!.content = 'HI THERE\nFRIEND';
  it('several lines', check(itemOf(p, 't')!.glyphs!.length === 13 && itemOf(p, 't')!.h > item.h * 1.8));
}
{
  const p = blank();
  p.rig.nodes.t = makeTextLayer('Hello', { id: 't' });
  p.timelines[0].tracks.push(
    { id: 'a', nodeId: 't', property: 'text.content', keyframes: [kf(0, 'Hello'), kf(500, 'Welcome'), kf(1000, 'Let\'s go!')] },
    { id: 'b', nodeId: 't', property: 'text.size', keyframes: [kf(0, 20), kf(1000, 60)] },
  );
  const words = (t: number) => itemOf(p, 't', t)!.glyphs!.map((g) => g.ch).join('');
  it('its words change at each keyframe, never half-way between', check(words(250) === 'Hello' && words(499) === 'Hello' && words(600) === 'Welcome' && words(1000) === 'Let\'sgo!'));
  it('while its size eases between its keyframes', check(Math.abs(itemOf(p, 't', 500)!.font!.size - 40) < 1e-6));
}

// --- following a curve, live -----------------------------------------------------------------
/** A glyph's baseline point's distance from where the curve is drawn on screen. */
function offCurve(curve: SceneItem, glyphs: Vec2[]): number {
  const a = (curve.rotation * Math.PI) / 180;
  const world = flattenPath(mapPath(curve.path!, (u) => {
    const x = u.x * curve.w, y = u.y * curve.h;
    return { x: curve.cx + x * Math.cos(a) - y * Math.sin(a), y: curve.cy + x * Math.sin(a) + y * Math.cos(a) };
  }), 800);
  return Math.max(...glyphs.map((g) => Math.min(...world.map((q) => Math.hypot(q.x - g.x, q.y - g.y)))));
}
const world = (t: SceneItem) => t.glyphs!.map((g) => ({ x: t.cx + g.x, y: t.cy + g.y }));
{
  const p = blank();
  const curve = makeCurveLayer([{ x: -220, y: 40 }, { x: 0, y: -90 }, { x: 220, y: 40 }], { name: 'Hill' })!;
  p.rig.nodes[curve.id] = { ...curve, zIndex: 1 };
  p.rig.nodes.t = makeTextLayer('LOOK HERE', { id: 't', zIndex: 2 }, { path: { mode: 'path', nodeId: curve.id }, align: 'center' });
  const t0 = itemOf(p, 't')!;
  it('text follows the curve it names, letter by letter', check(offCurve(itemOf(p, curve.id)!, world(t0)) < 1, offCurve(itemOf(p, curve.id)!, world(t0)).toFixed(3)));

  // the curve animates; the text is not keyframed at all
  const moved = curveToPath(moveAnchor(curveFromPath(curve.shapePath)!, 1, { x: 0, y: 0.3 }), 'smooth');
  p.timelines[0].tracks.push({ id: 'c', nodeId: curve.id, property: 'shape.path', keyframes: [kf(0, curve.shapePath!), kf(1000, moved)] });
  const t1 = itemOf(p, 't', 1000)!, tMid = itemOf(p, 't', 500)!;
  it('when the curve animates the text follows it, keyframed or not', check(offCurve(itemOf(p, curve.id, 1000)!, world(t1)) < 1 && offCurve(itemOf(p, curve.id, 500)!, world(tMid)) < 1));
  it('and it really moved', check(Math.abs(t1.cy - t0.cy) > 20));

  p.rig.nodes[curve.id].visible = false;
  it('a hidden curve still carries its text', check(JSON.stringify(itemOf(p, 't')!.glyphs) === JSON.stringify(t0.glyphs) && !itemOf(p, curve.id)));
  p.rig.nodes[curve.id].visible = true;

  p.rig.nodes[curve.id].guide = true;
  it('a guide curve is on the stage', check(itemOf(p, curve.id)?.guide === true));
  const names = (bakeLottie(p, { background: null, name: 'g' }).json as { layers: { nm: string }[] }).layers.map((l) => l.nm);
  // no face is loaded in this file, so the text goes out as live text, a layer per letter
  it('and not in the export — the text it carries is', check(!names.includes('Hill') && names.some((n) => n.startsWith('LOOK HERE')), names.join()));

  removeLayer(p, curve.id);
  it('deleting the curve puts its text back on a straight line, not pointing at nothing', check(p.rig.nodes.t.text!.path?.mode === 'straight' && !p.rig.nodes.t.text!.path?.nodeId));
  it('and it still draws', check((itemOf(p, 't')!.glyphs ?? []).length === 8));
}
{
  // a curve on a mascot: the mascot moves, the curve with it, the words with the curve
  const p = blank();
  const m2 = addMascot(p, 'default', { x: 200 });
  const curve = makeCurveLayer([{ x: 120, y: -140 }, { x: 200, y: -200 }, { x: 280, y: -140 }], { name: 'Halo' })!;
  p.rig.nodes[curve.id] = curve;
  placeUnder(p, curve.id, m2, 0, false);
  p.rig.nodes.t = makeTextLayer('HEY', { id: 't' }, { path: { mode: 'path', nodeId: curve.id }, align: 'center', size: 28 });
  const before = itemOf(p, 't')!;
  p.rig.nodes[m2].surface.flatOffset = { x: 260, y: 30 };
  const after = itemOf(p, 't')!;
  it('text on a curve attached to a mascot rides the mascot', check(Math.abs(after.cx - before.cx - 60) < 1 && Math.abs(after.cy - before.cy - 30) < 1));
  it('staying on the curve', check(offCurve(itemOf(p, curve.id)!, world(after)) < 1));
}
{
  // round the mascot itself
  const p = blank();
  p.rig.nodes.t = makeTextLayer('HELLO WORLD', { id: 't' }, { path: { mode: 'path', nodeId: 'body', baseline: 12 }, align: 'center', size: 30 });
  const body = itemOf(p, 'body')!;
  const t = itemOf(p, 't')!;
  it('text can wrap round a mascot', check(world(t).every((g) => Math.abs(Math.hypot(g.x - body.cx, g.y - body.cy) - (body.w / 2 + 12)) < 3)));
}
