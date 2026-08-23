import type { Block, Project } from './types';

export function blockStarts(p: Project): number[] {
  const out: number[] = [];
  let t = 0;
  for (const b of p.blocks) { out.push(t); t += b.durationMs; }
  return out;
}

export function blocksEnd(p: Project): number {
  return p.blocks.reduce((s, b) => s + b.durationMs, 0);
}

export function lastKeyframe(p: Project): number {
  let t = 0;
  for (const tr of p.tracks) for (const k of tr.keyframes) if (k.time > t) t = k.time;
  return t;
}

export function derivedDuration(p: Project): number {
  return Math.max(1000, blocksEnd(p), lastKeyframe(p) + 200);
}

/** Rewrite block durations and drag every block-owned keyframe along with them. */
export function relayoutBlocks(p: Project, next: Block[]): void {
  const oldStarts = blockStarts(p);
  const oldById = new Map(p.blocks.map((b, i) => [b.id, { start: oldStarts[i], dur: b.durationMs }]));
  let t = 0;
  const newById = new Map<string, { start: number; dur: number }>();
  for (const b of next) { newById.set(b.id, { start: t, dur: b.durationMs }); t += b.durationMs; }

  for (const track of p.tracks) {
    if (!track.blockId) continue;
    const o = oldById.get(track.blockId), n = newById.get(track.blockId);
    if (!o || !n) continue;
    const k = o.dur === 0 ? 1 : n.dur / o.dur;
    for (const key of track.keyframes) key.time = n.start + (key.time - o.start) * k;
  }
  p.blocks = next;
  p.tracks = p.tracks.filter((tr) => !tr.blockId || newById.has(tr.blockId));
  p.timelineDurationMs = derivedDuration(p);
}

export function evenDuration(p: Project): number {
  if (!p.blocks.length) return 1000;
  return Math.round(blocksEnd(p) / p.blocks.length);
}

export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
