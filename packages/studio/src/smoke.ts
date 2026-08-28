/**
 * Browser-side smoke check for the export pipeline — the half selfcheck.ts cannot
 * reach from node (SVG serialisation, canvas raster, the zip writer, the GIF worker
 * asset, MediaRecorder support).
 *
 *   npm run dev, then open /?smoke and read the tab title.
 *
 * Dev only: the caller guards on import.meta.env.DEV so this never ships.
 */
import { sceneToSvg, videoMime } from './export/raster';
import { buildDotLottie } from './export/dotlottie';
import { sceneAt } from './core/scene';
import { COMP } from './core/defaults';
import { useEditor } from './core/store';

const step = (m: string) => { document.title = 'SMOKE ' + m; };

export async function smoke() {
  step('start');
  const p = useEditor.getState().project;
  step('got project');
  const svg = sceneToSvg(sceneAt(p, 500, COMP), '#17161b');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  step('svg ' + svg.length);
  await img.decode();
  step('decoded');
  const c = document.createElement('canvas');
  c.width = 200; c.height = 200;
  c.getContext('2d')!.drawImage(img, 0, 0, 200, 200);
  const png = c.toDataURL('image/png').length;
  step('png ' + png);
  const { blob, animations } = buildDotLottie(p, { background: '#17161b' });
  step('dotlottie ' + blob.size + ' anims ' + animations.length);
  const gifWorker = (await import('gif.js.optimized/dist/gif.worker.js?url')).default;
  const workerOk = (await fetch(gifWorker)).ok;
  step(`ok — svg ${svg.length}b, png ${png}b, dotlottie ${blob.size}b (${animations.length} animations), gif worker ${workerOk}, video ${videoMime()}`);
}
