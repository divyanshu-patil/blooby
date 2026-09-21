/**
 * Everything in apps/*\/public that is an icon, rebuilt from brand/.
 *
 *   pnpm icons
 *
 * The masters in brand/ are the only hand-written files; every favicon, touch icon and
 * launcher icon below is generated from them. That is the point: the mark is a circle and
 * two pills tilted 21° at two different sizes (brand/geometry.txt), and an approximation
 * redrawn at 16px loses exactly the things that make it recognisable.
 *
 * Nothing here runs in CI or at build time. It is a once-per-icon-change command, and its
 * output is committed — a build step would mean every deploy rasterising files that only
 * change when a person changes them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const brand = new URL('../brand/', import.meta.url);
const app = (name) => new URL(`../apps/${name}/public/`, import.meta.url);

const render = (file, size) =>
  Buffer.from(new Resvg(readFileSync(new URL(file, brand), 'utf8'), {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  }).render().asPng());

/**
 * An .ico is a 6-byte header, a 16-byte directory entry per image, then the images — and
 * a PNG is a legal payload for an entry on anything that still asks for /favicon.ico. No
 * library for it: this is the whole format.
 */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);                     // 1 = icon (0,4 stay zero)
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
const put = (dir, name, bytes) => {
  writeFileSync(new URL(name, dir), bytes);
  wrote.push(`${new URL('.', dir).pathname.split('/apps/')[1] ?? 'brand/'}${name}`);
};

for (const name of ['web', 'admin']) {
  const dir = app(name);
  mkdirSync(dir, { recursive: true });

  // the adaptive svg is the primary favicon — it carries its own prefers-color-scheme
  put(dir, 'favicon.svg', readFileSync(new URL('favicon.svg', brand)));
  put(dir, 'favicon-96.png', render('blooby-icon-dark.svg', 96));
  put(dir, 'apple-touch-icon.png', render('apple-touch-icon.svg', 180));

  // a bare /favicon.ico request carries no theme, and tab strips are light by default
  // nearly everywhere, so it is the dark mark
  put(dir, 'favicon.ico', ico([16, 32, 48].map((size) => ({ size, png: render('blooby-icon-dark.svg', size) }))));

  // only the app is installable; nobody adds the admin panel to a home screen
  if (name === 'web') {
    put(dir, 'icon-192.png', render('blooby-icon-maskable.svg', 192));
    put(dir, 'icon-512.png', render('blooby-icon-maskable.svg', 512));
  }
}

// for the README: GitHub does not render a relative-path SVG reliably, so the one place
// the mark is shown as a picture gets rasters
const exports_ = new URL('exports/', brand);
put(exports_, 'mark-dark-160.png', render('blooby-icon-dark.svg', 160));
put(exports_, 'mark-light-160.png', render('blooby-icon-light.svg', 160));

console.log(`icons rebuilt from brand/\n  ${wrote.join('\n  ')}`);
