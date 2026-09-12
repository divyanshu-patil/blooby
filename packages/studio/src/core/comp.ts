import type { Project } from './types';

/**
 * The composition size every project had before it was configurable, and still the
 * default. Read a project's own through `compOf` — this constant is only right for a
 * project that never set one.
 */
export const COMP = { width: 720, height: 720 };

/** Sensible bounds: a 16px canvas cannot hold the mascot, and 8K is past any player. */
export const COMP_MIN = 64;
export const COMP_MAX = 4096;

export const COMP_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '720 × 720', width: 720, height: 720 },
  { label: '1080 × 1080', width: 1080, height: 1080 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '1080 × 1920', width: 1080, height: 1920 },
];

const clampDim = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(COMP_MAX, Math.max(COMP_MIN, Math.round(v))) : fallback;

/** The canvas this project renders and exports at. Total, so a hand-edited file with a
 *  nonsense size still opens at something drawable. */
export function compOf(p: Pick<Project, 'composition'> | null | undefined): { width: number; height: number } {
  const c = p?.composition;
  if (!c) return COMP;
  return { width: clampDim(c.width, COMP.width), height: clampDim(c.height, COMP.height) };
}
