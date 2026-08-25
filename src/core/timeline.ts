import type { Block, Preset, Timeline, Transition } from './types';

export function blockStarts(tl: Timeline): number[] {
  const out: number[] = [];
  let t = 0;
  for (const b of tl.blocks) { out.push(t); t += b.durationMs; }
  return out;
}

export function blocksEnd(tl: Timeline): number {
  return tl.blocks.reduce((s, b) => s + b.durationMs, 0);
}

export function lastKeyframe(tl: Timeline): number {
  let t = 0;
  for (const tr of tl.tracks) for (const k of tr.keyframes) if (k.time > t) t = k.time;
  return t;
}

export function derivedDuration(tl: Timeline): number {
  return Math.max(1000, blocksEnd(tl), lastKeyframe(tl) + 200, tl.durationOverrideMs ?? 0);
}

/** Rewrite block durations and drag every block-owned keyframe along with them. */
export function relayoutBlocks(tl: Timeline, next: Block[]): void {
  const oldStarts = blockStarts(tl);
  const oldById = new Map(tl.blocks.map((b, i) => [b.id, { start: oldStarts[i], dur: b.durationMs }]));
  let t = 0;
  const newById = new Map<string, { start: number; dur: number; loop?: boolean }>();
  for (const b of next) { newById.set(b.id, { start: t, dur: b.durationMs, loop: b.loop }); t += b.durationMs; }

  for (const track of tl.tracks) {
    if (!track.blockId) continue;
    const o = oldById.get(track.blockId), n = newById.get(track.blockId);
    if (!o || !n) continue;
    // a looping clip keeps its own natural timing when resized — evaluateRig repeats it
    // to fill whatever span the clip now occupies, rather than proportionally stretching
    // (slowing/speeding) the content itself, which is what a non-looping resize still does.
    const k = n.loop || o.dur === 0 ? 1 : n.dur / o.dur;
    for (const key of track.keyframes) key.time = n.start + (key.time - o.start) * k;
  }
  tl.blocks = next;
  tl.tracks = tl.tracks.filter((tr) => !tr.blockId || newById.has(tr.blockId));
  // a per-clip effect (Modifier.blockId) belongs to its block exactly like a block-owned
  // track does — drop it the same way when that block is gone, or it lingers with no
  // owning clip left: never evaluates again (evaluateRig skips an unresolvable window)
  // but stays in the timeline forever with no UI left to ever reach or remove it.
  tl.modifiers = tl.modifiers.filter((m) => !m.blockId || newById.has(m.blockId));
  // same for a transition into a now-gone clip — nothing left for it to blend into
  if (tl.transitions) tl.transitions = tl.transitions.filter((x) => newById.has(x.afterBlockId));
  tl.timelineDurationMs = derivedDuration(tl);
}

/** The transition in effect at `t`, if any — active for its own `durationMs` starting
 * at the moment its incoming clip begins, never past into the clip after that. */
export function activeTransitionAt(tl: Timeline, t: number): { transition: Transition; boundaryMs: number } | null {
  if (!tl.transitions?.length) return null;
  const starts = blockStarts(tl);
  for (let i = 1; i < tl.blocks.length; i++) {
    const transition = tl.transitions.find((x) => x.afterBlockId === tl.blocks[i - 1].id);
    if (!transition) continue;
    const boundaryMs = starts[i];
    if (t >= boundaryMs && t < boundaryMs + transition.durationMs) return { transition, boundaryMs };
  }
  return null;
}

export function evenDuration(tl: Timeline): number {
  if (!tl.blocks.length) return 1000;
  return Math.round(blocksEnd(tl) / tl.blocks.length);
}

export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;

/**
 * The moment a preset is most itself — the keyframe furthest from where its tracks
 * start. Sampling the midpoint instead would draw Blink with its eyes open.
 */
export function characteristicTime(preset: Preset): number {
  let best = preset.durationMs * 0.45, score = -1;
  for (const t of preset.tracks) {
    const first = t.keyframes[0]?.value;
    if (typeof first !== 'number') continue;
    for (const k of t.keyframes) {
      if (typeof k.value !== 'number') continue;
      const d = Math.abs(k.value - first) / (Math.abs(first) || 1);
      if (d > score) { score = d; best = k.time; }
    }
  }
  return best;
}
