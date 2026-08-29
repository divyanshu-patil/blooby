import { it } from 'vitest';
import { check } from './testkit';
import { outlinesOf } from './emitters';
import { parseSvg } from './svg';

// --- pasted artwork keeps its paint, and can be recoloured ----------------------
{
  // the exact shape of an icon-set export: paint on the <svg> root, none on the paths.
  // Keeping only the inside threw the fill away, the paths fell back to SVG's default
  // black, and changing the emitter colour then did nothing at all.
  const icon = '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512">'
    + '<path d="M312 155h91c2.8 0 5-2.2 5-5 0-8.9-3.9-17.3-10.7-22.9Z"></path>'
    + '<path d="M267 136V56H136c-17.6 0-32 14.4-32 32v336Z"></path></svg>';
  const parsed = parseSvg(icon);
  it('a pasted SVG parses', check(!!parsed && parsed.viewBox === '0 0 512 512'));
  it('and its root paint comes with it', check(!!parsed && /fill="currentColor"/.test(parsed.markup), parsed?.markup.slice(0, 60)));

  // the exporter has to see the same colour the renderer inherits
  const paths = outlinesOf(parsed!.markup);
  it('the exporter reads that inherited fill too', check(paths.length === 2 && paths.every((x) => x.fill === 'currentColor'), paths.map((x) => x.fill).join()));

  // anything that could execute is dropped: this markup goes through innerHTML
  const nasty = parseSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script><path d="M0 0h10v10H0Z" onclick="alert(2)"/></svg>');
  it('and nothing executable survives the import', check(!!nasty && !/script/i.test(nasty.markup) && !/onclick/i.test(nasty.markup), nasty?.markup));

  it('a viewBox-less SVG still gets one', check(parseSvg('<svg width="40" height="20"><path d="M0 0h1v1H0Z"/></svg>')?.viewBox === '0 0 40 20'));
  it('and something that is not an SVG is refused', check(parseSvg('hello') === null));
}
