import { renderToStaticMarkup } from 'react-dom/server';
import GIF from 'gif.js.optimized';
import workerUrl from 'gif.js.optimized/dist/gif.worker.js?url';
import { COMP } from '../core/defaults';
import { sceneAt, type SceneItem } from '../core/scene';
import { Shapes } from '../ui/Mascot';
import { activeTimeline } from '../core/types';
import type { Project } from '../core/types';

export interface RasterOptions {
  fps: number;
  /** multiplier on the 720×720 composition */
  scale: number;
  background: string | null;
  from?: number;
  to?: number;
}

/** Same <Shapes> the stage draws — one renderer, so an export can't drift from preview. */
export function sceneToSvg(scene: SceneItem[], background: string | null): string {
  const body = renderToStaticMarkup(Shapes({ scene }));
  const bg = background ? `<rect width="${COMP.width}" height="${COMP.height}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COMP.width}" height="${COMP.height}" viewBox="0 0 ${COMP.width} ${COMP.height}">${bg}${body}</svg>`;
}

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

function makeCanvas(scale: number) {
  const c = document.createElement('canvas');
  c.width = Math.round(COMP.width * scale);
  c.height = Math.round(COMP.height * scale);
  return c;
}

/** Walks the timeline frame by frame, handing each rendered canvas to `onFrame`. */
async function eachFrame(
  project: Project,
  o: RasterOptions,
  onFrame: (canvas: HTMLCanvasElement, index: number, total: number) => void | Promise<void>,
) {
  const from = o.from ?? 0;
  const to = o.to ?? activeTimeline(project).timelineDurationMs;
  const total = Math.max(1, Math.round(((to - from) / 1000) * o.fps));
  const canvas = makeCanvas(o.scale);
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < total; i++) {
    const img = await svgToImage(sceneToSvg(sceneAt(project, from + (i / o.fps) * 1000, COMP), o.background));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await onFrame(canvas, i, total);
  }
  return total;
}

export async function exportPng(project: Project, timeMs: number, scale = 2, background: string | null = null): Promise<Blob> {
  const canvas = makeCanvas(scale);
  const ctx = canvas.getContext('2d')!;
  const img = await svgToImage(sceneToSvg(sceneAt(project, timeMs, COMP), background));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

export async function exportGif(project: Project, o: RasterOptions, onProgress?: (p: number) => void): Promise<Blob> {
  const gif = new GIF({
    workers: Math.min(4, navigator.hardwareConcurrency || 2),
    quality: 8,
    workerScript: workerUrl,
    width: Math.round(COMP.width * o.scale),
    height: Math.round(COMP.height * o.scale),
    background: o.background ?? '#000000',
    transparent: o.background ? null : '#00000000',
    repeat: 0,
    dither: false,
  });
  const delay = Math.round(1000 / o.fps);
  await eachFrame(project, o, (canvas, i, total) => {
    gif.addFrame(canvas, { copy: true, delay });
    onProgress?.((i / total) * 0.6);
  });
  return new Promise((resolve) => {
    gif.on('progress', (p) => onProgress?.(0.6 + p * 0.4));
    gif.on('finished', resolve);
    gif.render();
  });
}

const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

export function videoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/**
 * MediaRecorder over a manually-driven captureStream. It records in wall-clock time,
 * so this takes as long as the animation lasts — the trade for not shipping a 30 MB
 * ffmpeg.wasm build and the COOP/COEP headers it needs. See ASSUMPTIONS.md.
 */
export async function exportVideo(project: Project, o: RasterOptions, onProgress?: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const mime = videoMime();
  if (!mime) throw new Error('This browser cannot record video from a canvas.');

  const canvas = makeCanvas(o.scale);
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const from = o.from ?? 0;
  const to = o.to ?? activeTimeline(project).timelineDurationMs;
  const total = Math.max(1, Math.round(((to - from) / 1000) * o.fps));
  const step = 1000 / o.fps;

  // pre-render everything first, so recorder pacing isn't fighting the rasteriser
  const images: HTMLImageElement[] = [];
  for (let i = 0; i < total; i++) {
    images.push(await svgToImage(sceneToSvg(sceneAt(project, from + i * step, COMP), o.background)));
    onProgress?.((i / total) * 0.5);
  }

  rec.start();
  const started = performance.now();
  for (let i = 0; i < total; i++) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(images[i], 0, 0, canvas.width, canvas.height);
    track.requestFrame();
    onProgress?.(0.5 + (i / total) * 0.5);
    const due = started + (i + 1) * step;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
  }
  await new Promise((r) => setTimeout(r, step * 2));
  const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime })); });
  rec.stop();
  track.stop();
  return { blob: await done, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
