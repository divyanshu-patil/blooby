// One ESM file for Vercel: Vercel's Node builder runs plain node, which can't load the studio's
// `?raw` imports (src/loaders/raw.mjs answers them under tsx), so they are inlined here.
// The API's own dependencies stay external (Prisma and resvg ship native binaries Vercel traces);
// the studio and its deps are bundled, because pnpm doesn't hoist them next to apps/api.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: [new URL('../src/serverless.ts', import.meta.url).pathname],
  outfile: new URL('../index.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(pkg.dependencies).filter((d) => d !== '@blooby/studio'),
  // CommonJS deps bundled into ESM still call require()
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [{
    name: 'raw',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, async (a) => {
        const r = await b.resolve(a.path.slice(0, -4), { resolveDir: a.resolveDir, kind: a.kind });
        return { path: r.path, namespace: 'raw' };
      });
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }));
    },
  }],
});
