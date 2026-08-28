import type { Block, EasingCurve, Preset, Timeline, Track, Transition } from './types';

export function blockStarts(tl: Timeline): number[] {
  const out: number[] = [];
  let t = 0;
  for (const b of tl.blocks) { out.push(t); t += b.durationMs; }
  return out;
}

export function blocksEnd(tl: Timeline): number {
  return tl.blocks.reduce((s, b) => s + b.durationMs, 0);
}

/** Which clip (if any) occupies time `t` — a clip is a sealed instance: activeTrackFor
 * uses this to keep a track scoped to one block from ever winning inside another, and a
 * global (blockless) track from bleeding into a clip that simply doesn't animate that
 * property itself, which used to read as "a random earlier keyframe leaking into it." */
export function blockAt(tl: Timeline, t: number): Block | undefined {
  const starts = blockStarts(tl);
  for (let i = 0; i < tl.blocks.length; i++) {
    const b = tl.blocks[i];
    if (t >= starts[i] && t < starts[i] + b.durationMs) return b;
  }
  // past the end of the last block — including any padding where the timeline's own
  // duration runs longer than the blocks tiled on it — still belongs to that last block:
  // its tracks hold their pose (and loop-ease back to frame 0) through the tail, instead
  // of vanishing to the rig's bare defaults the moment the block durations are used up.
  const last = tl.blocks.at(-1);
  if (last && t >= starts.at(-1)!) return last;
  return undefined;
}

/**
 * Merge a source timeline's tracks into one track per (nodeId, property), offset by
 * `start` and scoped to `blockId` — the shared engine behind bringing another timeline or
 * a gallery animation in as a single clip. A multi-block source timeline (any real saved
 * project) contributes several tracks for the same property, one per its own sub-block;
 * merging them here keeps this new clip's "at most one track per property" invariant
 * intact. Without it, activeTrackFor can't tell the merged tracks apart (they'd all share
 * this one new blockId) and just picks whichever happens to be first — which is exactly
 * why a multi-clip gallery animation, brought in whole, used to render deformed: most of
 * its own sub-ranges were reading a sub-block's track that didn't actually belong there.
 * Only tracks whose nodeId is in `validIds` are kept — the rig-compatibility filter for a
 * gallery source, always a no-op for a same-project one.
 */
export function mergeTracksForClip(sourceTracks: Track[], validIds: Set<string>, blockId: string, start: number, idGen: () => string): Track[] {
  const merged = new Map<string, Track>();
  for (const t of sourceTracks) {
    if (!validIds.has(t.nodeId)) continue;
    const key = `${t.nodeId} ${t.property}`;
    let dst = merged.get(key);
    if (!dst) { dst = { id: idGen(), nodeId: t.nodeId, property: t.property, blockId, keyframes: [] }; merged.set(key, dst); }
    for (const k of t.keyframes) dst.keyframes.push({ ...k, id: idGen(), time: k.time + start });
  }
  for (const track of merged.values()) track.keyframes.sort((a, b) => a.time - b.time);
  return [...merged.values()];
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
  // an emitter is scoped the same way and orphans the same way
  if (tl.emitters) tl.emitters = tl.emitters.filter((e) => !e.blockId || newById.has(e.blockId));
  // same for a transition into a now-gone clip — nothing left for it to blend into
  if (tl.transitions) tl.transitions = tl.transitions.filter((x) => newById.has(x.afterBlockId));
  tl.timelineDurationMs = derivedDuration(tl);
}

/** The transition in effect at `t`, if any — active for its own `durationMs` starting
 * at the moment its incoming clip begins, never past into the clip after that. Every seam
 * morphs by default (an implicit `{DEFAULT_TRANSITION_MS, DEFAULT_TRANSITION_EASING}`) —
 * an explicit `durationMs: 0` entry is the only way to opt a seam out into a hard cut. */
export function activeTransitionAt(tl: Timeline, t: number): { transition: Transition; boundaryMs: number } | null {
  if (tl.blocks.length < 2) return null;
  const starts = blockStarts(tl);
  for (let i = 1; i < tl.blocks.length; i++) {
    const afterId = tl.blocks[i - 1].id;
    const explicit = explicitTransitionFor(tl, afterId);
    if (explicit?.durationMs === 0) continue; // explicit hard cut — no blend
    const transition = explicit ?? { id: `${afterId}~default`, afterBlockId: afterId, durationMs: DEFAULT_TRANSITION_MS, easing: DEFAULT_TRANSITION_EASING };
    const boundaryMs = starts[i];
    if (t >= boundaryMs && t < boundaryMs + transition.durationMs) return { transition, boundaryMs };
  }
  return null;
}

/** Every clip seam morphs by default (spec: "no direct value change") — an explicit
 * Transition entry only needed to *customize* the duration/easing, or to opt out with
 * `durationMs: 0` (an explicit hard cut, distinct from "never configured"). */
export const DEFAULT_TRANSITION_MS = 250;
export const DEFAULT_TRANSITION_EASING: EasingCurve = { type: 'preset', name: 'easeInOut' };

/** The explicit Transition stored for this seam, if any — never the implicit default.
 * Used by the UI to tell "auto" from "user-customized" from "explicitly a hard cut". */
export function explicitTransitionFor(tl: Timeline, afterBlockId: string): Transition | undefined {
  return tl.transitions?.find((x) => x.afterBlockId === afterBlockId);
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
