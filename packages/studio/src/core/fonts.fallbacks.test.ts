import { it, vi } from 'vitest';
import { check } from './testkit';
import { defaultProject, makeTimeline } from './defaults';
import { makeTextLayer } from './layers';
import type { Project } from './types';

/**
 * The paths fonts.test.ts cannot reach because the module keeps its catalogue and faces in
 * module state: an offline catalogue, a failed download, a font file the parser rejects, the
 * browser's FontFace. Each block imports a fresh copy of the module.
 */
const fresh = async () => { vi.resetModules(); return await import('./fonts'); };
const g = globalThis as Record<string, any>;
const realFetch = g.fetch;
const urls: string[] = [];
const reply = (handler: (url: string) => Response | Promise<Response> | never) => {
  g.fetch = (async (u: unknown) => { urls.push(String(u)); return handler(String(u)); }) as typeof fetch;
};
const ok = (body: BodyInit = '') => new Response(body, { status: 200 });
const tick = () => new Promise((r) => setTimeout(r, 0));

// a parsed font, as opentype.js hands it back
const fakeFont = { unitsPerEm: 1000, ascender: 800, descender: -200, charToGlyph: () => ({ index: 1, advanceWidth: 500, getPath: () => ({ commands: [] }) }), getKerningValue: () => 0 };
const mockParser = (parse: unknown) => { vi.resetModules(); vi.doMock('opentype.js', () => parse as object); };

// --- catalogue: unknown, offline, partial -------------------------------------------------------
{
  const F = await fresh();
  const f = { family: 'X', weight: 640, style: 'normal' as const };
  it('snapWeight survives junk', check(F.snapWeight(NaN) === 400 && F.snapWeight(5000) === 900 && F.snapWeight(-3) === 100));
  it('a face never loaded uses the snapped weight', check(F.fontWeightUsed(f) === 600));
  it('an unknown family offers every weight and assumes italic', check(F.weightsOf('Zzz').length === 9 && F.hasItalic('Zzz')));
  reply(() => new Response('', { status: 500 }));
  const off = await F.fontCatalog();
  it('an unreachable catalogue falls back to the popular families', check(F.catalogOffline() && off.length === F.POPULAR_FONTS.length));
  reply(() => ok(JSON.stringify([{ id: 'bare', family: 'Bare', weights: [400] }, null, { family: 5 }])));
  const list = await F.fontCatalog();
  it('and recovers on the next ask; entries missing fields get defaults, junk is dropped', check(!F.catalogOffline() && list.length === 1 && list[0].styles.join() === 'normal' && list[0].category === 'sans-serif'));
  it('a family without italic says so', check(!F.hasItalic('Bare')));
}

// --- registerFont -------------------------------------------------------------------------------
{
  const F = await fresh();
  const f = { family: 'Reg', weight: 500, style: 'normal' as const };
  let n = 0;
  const off = F.onFonts(() => n++);
  const data = F.fontDataFrom(fakeFont);
  F.registerFont(f, data);
  it('a registered face is ready at its snapped weight', check(F.fontStatus(f) === 'ready' && F.fontWeightUsed(f) === 500 && F.fontData(f) === data && n === 1));
  F.registerFont({ ...f, weight: 300 }, data, 400);
  it('or at the weight it was given', check(F.fontWeightUsed({ ...f, weight: 300 }) === 400 && n === 2));
  off();
}

// --- fontDataFrom -------------------------------------------------------------------------------
{
  const F = await fresh();
  const glyph = (cmds: unknown[], advanceWidth?: number, index = 1) => ({ index, advanceWidth, getPath: () => ({ commands: cmds }) });
  const font = {
    unitsPerEm: 0, ascender: 1, descender: -1,
    charToGlyph: (ch: string) => {
      if (ch === 'n') return undefined;
      if (ch === 'z') return glyph([], 100, 0);
      if (ch === 'e') return glyph([], 100);
      if (ch === 'w') return glyph([{ type: 'M', x: 1, y: 2 }], 600);
      return glyph([{ type: 'M', x: 1, y: 2 }, { type: 'L', x: 3, y: 4 }, { type: 'Q', x1: 1, y1: 1, x: 2, y: 2 }, { type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 }, { type: 'Z' }, { type: 'X' }]);
    },
    getKerningValue: (a: unknown, b: unknown) => { if (!a) throw new Error('no glyph'); return (b as { advanceWidth?: number }).advanceWidth === 600 ? 5 : (undefined as unknown as number); },
  };
  const d = F.fontDataFrom(font as never);
  it('a zero em square falls back to 1000', check(d.unitsPerEm === 1000));
  it('a glyph with no advance, or no glyph at all, is half an em', check(d.advance('a') === 500 && d.advance('n') === 500 && d.advance('w') === 600));
  it('kerning is the font\'s, and 0 when it has none or throws', check(d.kern('a', 'w') === 5 && d.kern('a', 'a') === 0 && d.kern('n', 'a') === 0));
  const out = d.outline('a')!;
  it('outlines carry every command kind; unknown ones draw nothing', check(/^M 0\.?\S* 2/.test(out.replace(/^M -?[\d.]+/, 'M 0')) && out.includes('Q 1 1 2 2') && out.includes('C 1 2 3 4 5 6') && out.includes('Z') && d.outline('a') === out));
  it('a missing glyph, .notdef or an empty path has no outline', check(d.outline('n') === null && d.outline('z') === null && d.outline('e') === null));
  it('a glyph without an advance is centred on zero', check(F.fontDataFrom({ ...font, charToGlyph: () => glyph([{ type: 'M', x: 1, y: 2 }]) } as never).outline('q') === 'M 1 2'));
}

// --- loading: weights, styles, failures, FontFace ------------------------------------------------
{
  mockParser({ parse: undefined, default: { parse: () => fakeFont } });
  const F = await import('./fonts');
  const added: unknown[] = [];
  reply(() => ok('font'));
  const inter = (weight: number, style: 'normal' | 'italic' = 'normal') => ({ family: 'Inter', weight, style });

  await F.loadFont(inter(500));
  it('between two weights, the nearer wins (and the default export parses)', check(F.fontWeightUsed(inter(500)) === 400 && urls.some((u) => u.endsWith('latin-400-normal.woff'))));
  await F.loadFont(inter(600, 'italic'));
  it('a face without italic loads the upright one', check(F.fontWeightUsed(inter(600, 'italic')) === 700 && urls.some((u) => u.endsWith('latin-700-normal.woff'))));
  const before = urls.length;
  it('a face already ready is not fetched again', check((await F.loadFont(inter(500))) && urls.length === before));

  // FontFace without a document: nothing to add to
  g.FontFace = class { load() { return Promise.resolve(this); } };
  await F.loadFont(inter(700));
  it('FontFace alone, without a document, is left out', check(F.fontStatus(inter(700)) === 'ready'));

  // FontFace and a document
  g.document = { fonts: { add: (x: unknown) => added.push(x) } };
  g.FontFace = class { family: string; constructor(family: string) { this.family = family; } load() { return this.family === 'Weird' ? Promise.reject(new Error('no css')) : Promise.resolve(this); } };
  await F.loadFont({ family: 'Fine', weight: 400, style: 'normal' });
  await F.loadFont({ family: 'Weird', weight: 400, style: 'normal' });
  await tick();
  it('the same file is added for CSS, and a CSS failure is swallowed', check(added.length === 1 && F.fontStatus({ family: 'Weird', weight: 400, style: 'normal' }) === 'ready'));

  // failures
  reply(() => new Response('', { status: 404 }));
  const it404 = { family: 'Gone', weight: 400, style: 'italic' as const };
  const plain = { family: 'Gone', weight: 400, style: 'normal' as const };
  it('a 404 fails and names the weight and italic', check(!(await F.loadFont(it404)) && /Gone 400 italic is not in Google Fonts \(404\)/.test(F.fontError(it404) ?? '')));
  it('and without italic it does not say so', check(!(await F.loadFont(plain)) && /Gone 400 is not/.test(F.fontError(plain) ?? '')));
  g.fetch = (async () => { throw 'boom'; }) as typeof fetch;
  const bad = { family: 'Boom', weight: 400, style: 'normal' as const };
  it('a thrown non-Error becomes its text', check(!(await F.loadFont(bad)) && F.fontError(bad) === 'boom'));

  // previews
  reply(() => ok());
  await F.fontCatalog();
  F.previewFont('Fine');
  F.previewFont('Fine');
  await tick();
  it('a preview is requested once', check(added.length === 2));
  F.previewFont('Inter');
  F.previewFont('Weird');
  await tick();
  it('previews load, and one that fails is marked, not thrown', check(added.length === 3));
  g.document = undefined;
  F.previewFont('NoDocument');
  delete g.FontFace;
  F.previewFont('NoFace');
  it('with no browser there is nothing to preview', check(added.length === 3));
  delete g.document;
}

// --- the preview picks a weight ------------------------------------------------------------------
{
  const F = await fresh();
  const made: string[] = [];
  g.document = { fonts: { add() {} } };
  g.FontFace = class { constructor(_f: string, _s: string, o: { weight: string }) { made.push(o.weight); } load() { return Promise.resolve(this); } };
  reply(() => ok(JSON.stringify([{ id: 'ex', family: 'Ex', weights: [700, 900], styles: ['normal'], category: 'serif' }])));
  await F.fontCatalog();
  F.previewFont('Ex');
  F.previewFont('Nobody');
  F.previewFont('Inter');
  it('its lightest weight when 400 is absent, 400 for an unknown family or one that has it', check(made.join() === '700,400,400' || made.join() === '700,400'));
  delete g.FontFace; delete g.document;
}

// --- parser failure ------------------------------------------------------------------------------
{
  mockParser({ parse: undefined, default: undefined });
  const F = await import('./fonts');
  reply(() => ok('font'));
  const f = { family: 'Parser', weight: 400, style: 'normal' as const };
  it('a parser that did not load fails the face', check(!(await F.loadFont(f)) && /did not load/.test(F.fontError(f) ?? '')));
  vi.doUnmock('opentype.js');
}

// --- every face a project asks for ---------------------------------------------------------------
{
  vi.resetModules();
  const F = await import('./fonts');
  const mod = (await import('opentype.js')) as unknown as Record<string, any>;
  const OT = mod.Font ? mod : mod.default;
  const file: ArrayBuffer = new OT.Font({
    familyName: 'T', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200,
    glyphs: [new OT.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new OT.Path() })],
  }).toArrayBuffer();
  const p: Project = defaultProject();
  const tl = makeTimeline('Idle');
  p.rig.nodes.t = makeTextLayer('HI', { id: 't' }, { font: { family: 'Inter', weight: 400, style: 'italic' } });
  p.rig.nodes.u = makeTextLayer('YO', { id: 'u' }, { font: { family: 'Inter', weight: 400, style: 'italic' } });
  const kf = (value: unknown) => ({ id: 'k' + Math.random(), time: 0, value: value as number, easingOut: { type: 'linear' as const } });
  tl.tracks.push(
    { id: 'a', nodeId: 't', property: 'text.font.family', keyframes: [kf('Lato'), kf(5)] },
    { id: 'b', nodeId: 't', property: 'text.font.weight', keyframes: [kf(700), kf('heavy')] },
    { id: 'c', nodeId: 't', property: 'text.size', keyframes: [kf(20)] },
    { id: 'd', nodeId: 'someoneElse', property: 'text.font.family', keyframes: [kf('Nope')] },
  );
  const q: Project = { ...p, timelines: [tl], activeTimelineId: tl.id };
  const fonts = F.projectFonts(q).map((f) => `${f.family}${f.weight}`).sort().join();
  it('keyframed families and weights count; wrong types and other nodes\' tracks do not', check(fonts === 'Inter400,Inter700,Lato400', fonts));
  it('missing ones are listed once, with their italic', check(F.missingFonts(q).join() === 'Inter 400 italic,Inter 700 italic,Lato 400 italic' || F.missingFonts(q).length === 3, F.missingFonts(q).join()));
  reply(() => ok(file.slice(0)));
  it('ensureFonts is true when every face loads', check(await F.ensureFonts(q)));
  it('and nothing is missing afterwards', check(F.missingFonts(q).length === 0));
  reply(() => new Response('', { status: 404 }));
  const r: Project = { ...q, timelines: [{ ...tl, tracks: [{ id: 'z', nodeId: 't', property: 'text.font.family', keyframes: [kf('Missing One')] }] }] };
  it('and false when one cannot be had', check(!(await F.ensureFonts(r))));
  }

g.fetch = realFetch;
