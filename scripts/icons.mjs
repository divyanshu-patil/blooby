/**
 * Every icon in the repo, rebuilt from what Icon Composer exported.
 *
 *   pnpm icons
 *
 * The masters are `brand/exports/blooby-icon-*.png` — the real icon, with the gradient,
 * the sheen and the soft shadow Icon Composer bakes in. Those effects are why the icon is
 * a raster here and not a vector: they are a rendering, not a shape, and a hand-written
 * SVG of the same three shapes is a different (flatter) icon wearing its silhouette.
 *
 * `brand/*.svg` keeps that flat geometry, because a few things genuinely need a shape
 * rather than a picture — brand/geometry.txt says which and why.
 *
 * Two colourways. The rule is contrast, and it is stated once here:
 *   dark mark  → LIGHT backgrounds
 *   light mark → DARK backgrounds
 *
 * Nothing here runs in CI or at build time. It is a once-per-icon-change command whose
 * output is committed; a build step would rasterise on every deploy files that only change
 * when a person changes them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const brand = new URL('../brand/', import.meta.url);

/**
 * The biggest export of each colourway. The dark one comes at 2176 and the light at 1088,
 * which is more than every size below needs — downscaling a rendering is safe, and
 * upscaling one is what makes an icon look printed on a t-shirt.
 */
const MASTER = {
  dark: 'exports/blooby-icon-2176-dark.png',
  light: 'exports/blooby-icon-1088.png',
};

const encoded = {};
const dataUri = (tone) => (encoded[tone] ??=
  `data:image/png;base64,${readFileSync(new URL(MASTER[tone], brand)).toString('base64')}`);

/**
 * One size of the icon.
 *
 * `plate` fills the square behind it — iOS does not composite transparency (an alpha
 * channel comes out black) and an Android launcher crops to its own shape, so both want an
 * opaque one. `inset` shrinks the artwork inside the square to leave room for that crop:
 * Android's maskable safe zone is the middle 80%, and the exported circle already sits a
 * little inside its own frame, so 0.84 lands the visible disc just within it.
 */
function raster(tone, size, { plate = null, inset = 1 } = {}) {
  const drawn = size * inset;
  const offset = (size - drawn) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + (plate ? `<rect width="${size}" height="${size}" fill="${plate}"/>` : '')
    + `<image href="${dataUri(tone)}" x="${offset}" y="${offset}" width="${drawn}" height="${drawn}"/>`
    + `</svg>`;
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng(),
  );
}

/**
 * An .ico is a 6-byte header, a 16-byte directory entry per image, then the images — and
 * a PNG is a legal payload for an entry on anything that still asks for /favicon.ico. No
 * library for it: this is the whole format.
 */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);                     // 1 = icon (bytes 0 and 4 stay zero)
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);      // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);                        // colour planes
    e.writeUInt16LE(32, 6);                       // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

const wrote = [];
const put = (url, bytes) => {
  mkdirSync(new URL('.', url), { recursive: true });
  writeFileSync(url, bytes);
  wrote.push(decodeURIComponent(url.pathname).split('/blooby/')[1]);
};

const PLATE = '#fafafa';

for (const app of ['web', 'admin']) {
  const dir = new URL(`../apps/${app}/public/`, import.meta.url);

  // Tab strip, one file per colourway. A PNG cannot answer prefers-color-scheme the way
  // the flat SVG favicon could, so index.html picks between them with a media attribute —
  // and the .ico below is what Safari and every crawler fall back to.
  put(new URL('favicon-dark-32.png', dir), raster('dark', 32));
  put(new URL('favicon-dark-96.png', dir), raster('dark', 96));
  put(new URL('favicon-light-32.png', dir), raster('light', 32));
  put(new URL('favicon-light-96.png', dir), raster('light', 96));

  // a bare /favicon.ico request carries no theme, and tab strips are light by default
  // nearly everywhere, so it is the dark mark
  put(new URL('favicon.ico', dir), ico([16, 32, 48].map((size) => ({ size, png: raster('dark', size) }))));

  put(new URL('apple-touch-icon.png', dir), raster('dark', 180, { plate: PLATE, inset: 0.84 }));
  put(new URL('icon-192.png', dir), raster('dark', 192, { plate: PLATE, inset: 0.84 }));
  put(new URL('icon-512.png', dir), raster('dark', 512, { plate: PLATE, inset: 0.84 }));
}

// the README shows the mark as a picture, and GitHub swaps the two by theme
put(new URL('exports/mark-dark-256.png', brand), raster('dark', 256));
put(new URL('exports/mark-light-256.png', brand), raster('light', 256));

// the app's own mark, imported by packages/studio/src/kit — 64 is ample for a 20px glyph
// on a 3x screen, and it is committed so nothing has to build it
put(new URL('../packages/studio/src/kit/blooby-mark.png', import.meta.url), raster('dark', 64));

/**
 * The API renders share cards, and it needs the mark without reaching across the repo for
 * it — a relative path out of apps/api breaks the moment the server is built rather than
 * run from source. So it gets the bytes as a module.
 */
put(
  new URL('../apps/api/src/services/brandMark.ts', import.meta.url),
  Buffer.from(
    '// GENERATED by scripts/icons.mjs from brand/exports — do not edit. Run `pnpm icons`.\n'
    + '\n'
    + "/** The official mark (dark, for light backgrounds) as a data URI, for the share cards. */\n"
    + `export const BRAND_MARK_PNG = '${raster('dark', 96).toString('base64').replace(/^/, 'data:image/png;base64,')}';\n`,
  ),
);

console.log(`icons rebuilt from brand/exports\n  ${wrote.join('\n  ')}`);
