import { expect, it } from 'vitest';
import { defaultProject } from '@blooby/studio/engine';
import { OG_HEIGHT, OG_WIDTH, ogService, readable } from './og.service.js';

/** Built once: ~90ms each, and rastering the cards below is slow enough already. */
let blank: ReturnType<typeof defaultProject> | null = null;
const project = () => (blank ??= defaultProject());

/** PNG's magic number, then the IHDR width and height as big-endian 32-bit ints. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

it('rasters a card at the size every unfurler expects', () => {
  expect(pngSize(ogService.project(project(), 'My mascot', 'Made with blooby')))
    .toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
});

/**
 * A card is a URL a stranger's server fetches, and the name in it is whatever someone
 * typed. Asserted on the SVG rather than the PNG: escaping is a markup question, and
 * rastering four more 1200px images to ask it is a slow way to learn nothing extra.
 */
it('escapes a name that would otherwise break the markup', () => {
  const svg = ogService.projectSvg(project(), '<script>alert("x")</script> & co', 'c');
  expect(svg).not.toContain('<script');
  expect(svg.split('<text').length - 1).toBeGreaterThan(1);
  // still one well-formed document, whatever went in
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
});

it('wraps a long name and elides the rest rather than running off the card', () => {
  const svg = ogService.projectSvg(project(), 'A really quite long project name that just keeps on going', 'c');
  expect(svg).toContain('\u2026');
  // the title is at most two lines, plus the wordmark and the caption
  expect(svg.split('<text').length - 1).toBeLessThanOrEqual(4);
});

it('renders an empty name without producing an empty card', () => {
  expect(ogService.projectSvg(project(), '', 'c')).toContain('Untitled');
});

/**
 * A brand-new project's stored file is `{}` — it has no rig yet, and that is a generic
 * card rather than an error. Anything migrate can repair into a real document is drawable;
 * whatever slips through is caught at the route, which falls back rather than 500ing an
 * image somebody else's unfurler is waiting on.
 */
it('says a document with nothing to draw is not drawable, rather than throwing', () => {
  expect(readable({})).toBeNull();
  expect(readable(null)).toBeNull();
  expect(readable('nope')).toBeNull();
  expect(readable(42)).toBeNull();
  expect(readable(project())).not.toBeNull();
});
