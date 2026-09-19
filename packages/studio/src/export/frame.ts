import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compOf } from '../core/comp';
import { sceneAt, type SceneItem, type Viewport } from '../core/scene';
import { Shapes } from '../ui/Mascot';
import type { Project } from '../core/types';

/**
 * Frames as SVG, with no browser in sight — the raster exporter, the smoke test and the
 * MCP server's renders all start here. Same <Shapes> the stage draws: one renderer, so an
 * export or an agent's screenshot can't drift from what a person sees.
 */

/** The part of the composition to draw: a window onto it, in composition px. */
export interface FrameWindow { x: number; y: number; width: number; height: number }

export function sceneToSvg(scene: SceneItem[], background: string | null, view: Viewport, window?: FrameWindow): string {
  const body = renderToStaticMarkup(createElement(Shapes, { scene }));
  const bg = background ? `<rect width="${view.width}" height="${view.height}" fill="${background}"/>` : '';
  const w = window ?? { x: 0, y: 0, width: view.width, height: view.height };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.width}" height="${w.height}" viewBox="${w.x} ${w.y} ${w.width} ${w.height}">${bg}${body}</svg>`;
}

/** One frame of the project as an SVG at its own composition size (or a window onto it). */
export const frameSvg = (project: Project, ms: number, background: string | null, window?: FrameWindow) =>
  sceneToSvg(sceneAt(project, ms, compOf(project)), background, compOf(project), window);

/**
 * Several moments on one sheet, left to right then down, each labelled with its time — how
 * an agent sees motion in a single image instead of a dozen round trips.
 */
export function contactSheetSvg(project: Project, times: number[], background: string | null, columns = 4): string {
  const comp = compOf(project);
  const cols = Math.max(1, Math.min(columns, times.length));
  const rows = Math.ceil(times.length / cols);
  const label = 28;
  const cells = times.map((t, i) => {
    const x = (i % cols) * comp.width, y = Math.floor(i / cols) * (comp.height + label);
    const inner = frameSvg(project, t, background).replace(/^<svg /, `<svg x="${x}" y="${y + label}" `);
    return `<text x="${x + 10}" y="${y + 20}" font-family="sans-serif" font-size="18" fill="#6b6b76">${(t / 1000).toFixed(2)}s</text>${inner}`
      + `<rect x="${x + 0.5}" y="${y + label + 0.5}" width="${comp.width - 1}" height="${comp.height - 1}" fill="none" stroke="#d4d4da"/>`;
  });
  const width = cols * comp.width, height = rows * (comp.height + label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fafafa"/>${cells.join('')}</svg>`;
}
