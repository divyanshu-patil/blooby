import { it } from 'vitest';
import { check } from './testkit';
import {
  catalogEntry, fontCatalog, fontData, fontError, fontStatus, fontWeightUsed, glyphOutline, loadFont, metricsFor,
  missingFonts, projectFonts, searchFonts, weightsOf,
} from './fonts';
import { fallbackMetrics } from './text';
import { defaultProject, makeTimeline } from './defaults';
import { sceneAt } from './scene';
import { compOf } from './comp';
import { makeTextLayer } from './layers';
import { bakeLottie } from '../export/lottie';
import type { Project } from './types';

/**
 * A real font file, made here: a few glyphs in a face called "Testa", written out through
 * opentype.js and read back exactly as a Google font would be. Network-free, and it
 * exercises the whole path — fetch, parse, metrics, outlines, export.
 */
const mod = (await import('opentype.js')) as unknown as Record<string, any>;
const OT = mod.Font ? mod : mod.default;
const box = (x0: number, y0: number, x1: number, y1: number) => {
  const p = new OT.Path();
  p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.close();
  return p;
};
const glyphs = [
  new OT.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new OT.Path() }),
  new OT.Glyph({ name: 'H', unicode: 72, advanceWidth: 700, path: box(80, 0, 620, 700) }),
  new OT.Glyph({ name: 'I', unicode: 73, advanceWidth: 300, path: box(100, 0, 200, 700) }),
  new OT.Glyph({ name: 'space', unicode: 32, advanceWidth: 250, path: new OT.Path() }),
];
const file: ArrayBuffer = new OT.Font({ familyName: 'Testa', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs }).toArrayBuffer();

const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  if (url.includes('api.fontsource.org')) {
    return new Response(JSON.stringify([
      { id: 'zilla-slab', family: 'Zilla Slab', weights: [300, 700], styles: ['normal'], category: 'serif' },
      { id: 'poppins', family: 'Poppins', weights: [100, 400, 900], styles: ['normal', 'italic'], category: 'sans-serif' },
      { id: 'inter', family: 'Inter', weights: [400, 600, 700], styles: ['normal', 'italic'], category: 'sans-serif' },
      { id: 'testa', family: 'Testa', weights: [400], styles: ['normal'], category: 'display' },
    ]), { status: 200 });
  }
  if (url.includes('/testa@')) return new Response(file.slice(0), { status: 200 });
  return new Response('', { status: 404 });
}) as typeof fetch;

// --- the catalogue ---------------------------------------------------------------------------
{
  const list = await fontCatalog();
  it('the Google Fonts catalogue arrives, sorted by name', check(list.map((c) => c.family).join() === 'Inter,Poppins,Testa,Zilla Slab'));
  it('fetched once however often it is asked for', check((await fontCatalog()) === list && calls.filter((c) => c.includes('api.fontsource')).length === 1));
  it('with no search, the popular families come first', check(searchFonts(list, '')[0].family === 'Inter' && searchFonts(list, '')[1].family === 'Poppins'));
  it('a search finds any family, not just a hard-coded few', check(searchFonts(list, 'zil').map((c) => c.family).join() === 'Zilla Slab'));
  it('and a category narrows it', check(searchFonts(list, '', 'serif').map((c) => c.family).join() === 'Zilla Slab'));
  it('only the weights a family really has are offered', check(weightsOf('Poppins').join() === '100,400,900' && catalogEntry('inter')?.family === 'Inter'));
}

// --- loading a face ----------------------------------------------------------------------------
{
  const f = { family: 'Testa', weight: 400, style: 'normal' as const };
  it('nothing is loaded before it is needed', check(fontStatus(f) === undefined && !calls.some((c) => c.includes('/testa@'))));
  const [a, b] = await Promise.all([loadFont(f), loadFont(f)]);
  it('a face loads on demand', check(a && b && fontStatus(f) === 'ready'));
  it('from its one file, fetched once', check(calls.filter((c) => c.includes('/testa@')).length === 1 && calls.some((c) => c.endsWith('testa@latest/latin-400-normal.woff'))));
  const mt = metricsFor(f, 100);
  it('its real advance widths lay the text out', check(Math.abs(mt.advance('H') - 70) < 1e-9 && Math.abs(mt.advance('I') - 30) < 1e-9));
  it('with its real ascent and descent', check(Math.abs(mt.ascent - 80) < 1e-9 && Math.abs(mt.descent - 20) < 1e-9));
  const d = glyphOutline(f, 'H')!;
  it('and its glyphs come back as outlines, in ems, centred on their advance', check(/^M -0\.27 0 L 0\.27 0 L 0\.27 -0\.7/.test(d), d));
  it('a character the face lacks has no outline', check(glyphOutline(f, 'Z') === null));

  const heavy = { ...f, weight: 700 };
  await loadFont(heavy);
  it('a weight the family lacks loads its nearest instead', check(fontStatus(heavy) === 'ready' && fontWeightUsed(heavy) === 400));

  const nope = { family: 'Nope Sans', weight: 400, style: 'normal' as const };
  const ok = await loadFont(nope);
  it('a font that cannot be had fails, and says why', check(!ok && fontStatus(nope) === 'failed' && /Nope Sans/.test(fontError(nope) ?? '')));
  it('and its text falls back rather than vanishing', check(metricsFor(nope, 40).advance('H') === fallbackMetrics(40, 400).advance('H')));
}

// --- text in a project, and its export --------------------------------------------------------
function withText(family: string): Project {
  const p = defaultProject();
  const tl = makeTimeline('Idle');
  tl.timelineDurationMs = 500;
  p.rig.nodes.t = makeTextLayer('HI', { id: 't' }, { font: { family, weight: 400, style: 'normal' } });
  return { ...p, timelines: [tl], activeTimelineId: tl.id };
}
{
  const p = withText('Testa');
  const item = sceneAt(p, 0, compOf(p)).find((s) => s.id === 't')!;
  it('a loaded face draws the text from its outlines', check(item.glyphs?.length === 2 && !!glyphOutline(item.font!, 'H')));
  const baked = bakeLottie(p, { background: null, name: 'hi' });
  const layer = (baked.json as { layers: Record<string, any>[] }).layers.find((l) => l.nm === 'HI')!;
  const shapes = JSON.stringify(layer.shapes);
  it('it exports as vector letters — a shape layer of outlines, no font needed to play it', check(layer.ty === 4 && shapes.includes('"ty":"sh"') && !(baked.json as Record<string, unknown>).fonts));
  it('one group per letter', check(layer.shapes.length === 2 && layer.shapes.map((g: { nm: string }) => g.nm).join('') === 'HI'));
  it('with nothing to warn about', check(baked.warnings.length === 0 && missingFonts(p).length === 0));

  const q = withText('Nope Sans');
  const b2 = bakeLottie(q, { background: null, name: 'hi' });
  const live = (b2.json as { layers: Record<string, any>[] }).layers.filter((l) => l.ty === 5);
  it('a face that never loaded goes out as live text, never dropped', check(live.length === 2 && live.every((l) => l.t.d.k[0].s.f === 'Nope Sans')));
  it('naming its font for the player', check(JSON.stringify((b2.json as Record<string, unknown>).fonts).includes('Nope Sans')));
  it('and the export says so', check(b2.warnings.length === 1 && /Nope Sans/.test(b2.warnings[0]) && missingFonts(q).join() === 'Nope Sans 400'));

  q.timelines[0].tracks.push({ id: 'f', nodeId: 't', property: 'text.font.family', keyframes: [{ id: 'k', time: 0, value: 'Testa', easingOut: { type: 'linear' } }] });
  it('every face a project asks for is known, keyframed ones too', check(projectFonts(q).map((f) => f.family).sort().join() === 'Nope Sans,Testa'));
  it('and loaded ones are ready to draw', check(!!fontData({ family: 'Testa', weight: 400, style: 'normal' })));
}

globalThis.fetch = realFetch;
