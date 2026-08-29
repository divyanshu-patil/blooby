import { create } from 'zustand';
import { attachPresetEffects, defaultProject, makeTimeline, uid } from './defaults';
import { isEffectProp, readEffectProp, readProp, writeEffectProp, writeProp } from './props';
import { activeTrackFor, evaluateRig, lerpAngle, lerpValue, sampleTrack } from './scene';
import { blockAt, blocksEnd, blockStarts, derivedDuration, mergeTracksForClip, relayoutBlocks } from './timeline';
import { getActiveId, putEntry, setActiveId, uidGallery, type GalleryEntry } from './gallery';
import { fetchCatalog } from './catalog';
import type { Block, EasingCurve, Emitter, Expression, KeyValue, Modifier, Preset, Project, Rig, RigNode, Timeline, Track, Transition } from './types';
import { activeTimeline, CAMERA_ID } from './types';

const STORAGE_KEY = 'blooby.project.v1';
const HISTORY_LIMIT = 80;
// a state switch morphs by default (spec: "it should morph") — pass { duration: 0 } to
// opt into an instant cut instead, not the other way around.
const DEFAULT_STATE_TRANSITION_MS = 300;
const DEFAULT_STATE_EASING: EasingCurve = { type: 'preset', name: 'easeInOut' };

/** The active timeline — every editor action reads/writes through this, never `p.timelines[i]` directly. */
const at = (p: Project): Timeline => activeTimeline(p);

export interface Editor {
  project: Project;
  /** The shared library fetched from Supabase, kept separate from `project.presets` /
   *  `project.expressions` (this file's own embedded lists). Browsing reads both; using
   *  one copies it into the project so a saved file stays self-contained. */
  catalog: Preset[];
  expressionCatalog: Expression[];
  catalogError: string | null;
  selection: string[];
  selectedTrackId: string | null;
  /** the clip currently selected for editing — drives the Effects tab (and future clip
   * inspector) toward "this clip" instead of the whole timeline. Distinct from playhead
   * position: scrubbing through a clip shouldn't silently change what you're editing. */
  selectedBlockId: string | null;
  /** the emitter whose trajectory handles are on the stage, if any */
  selectedEmitterId: string | null;
  playhead: number;
  playing: boolean;
  loop: boolean;
  autoKey: boolean;
  past: Project[];
  future: Project[];
  lastLabel: string;
  lastAt: number;

  /** the timeline active immediately before the last setState/enableState switch — what
   * returnToPreviousState targets. Not undo history; switching states isn't undoable. */
  previousTimelineId: string | null;
  /** a state switch requested with `at` still in the future — checked once per playback
   * frame in App.tsx's tick and fired the instant the playhead reaches it. */
  pendingStateChange: { timelineId: string; atMs: number; durationMs: number; easing: EasingCurve } | null;
  /** an in-progress blended state switch — Stage.tsx (preview only, never export/baking)
   * blends this captured pose toward the new timeline's live animation as it plays out. */
  stateTransition: { fromRig: Rig; durationMs: number; easing: EasingCurve; startedAtMs: number } | null;

  commit: (fn: (p: Project) => void, label?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (v: boolean) => void;
  toggleAutoKey: () => void;
  setLoop: (v: boolean) => void;
  selectTrack: (id: string | null) => void;
  selectBlock: (id: string | null) => void;

  setValue: (nodeId: string, property: string, value: KeyValue, label?: string) => void;
  trackFor: (nodeId: string, property: string) => Track | undefined;
  toggleTrack: (nodeId: string, property: string) => void;
  toggleKeyframe: (nodeId: string, property: string) => void;
  addKeyframeNow: (nodeId: string, property: string) => void;
  moveKeyframe: (trackId: string, kfId: string, time: number) => void;
  /** set several keyframes (from a multi-select drag) to explicit absolute times in one
   * undo step — the caller (drag handler) computes each from its own pre-drag time plus
   * a shared delta, so this never compounds across repeated pointermove events. */
  moveKeyframes: (entries: { trackId: string; kfId: string; time: number }[]) => void;
  deleteKeyframe: (trackId: string, kfId: string) => void;
  deleteKeyframes: (ids: { trackId: string; kfId: string }[]) => void;
  setEasing: (trackId: string, kfId: string, easing: EasingCurve) => void;

  addNode: (node: RigNode) => void;
  deleteNode: (id: string) => void;
  updateNode: (id: string, fn: (n: RigNode) => void, label?: string) => void;

  loadCatalog: () => Promise<void>;
  addBlock: (presetId: string, index?: number) => void;
  /** the shared engine behind "another timeline from this project" and "a gallery
   * animation" as a clip source (§8/§12/§13) — one copy-tracks-in-as-a-block routine.
   * Only tracks whose nodeId exists in *this* project's rig are ever copied in, which is
   * always every track for a same-project timeline and a safety filter for a gallery one. */
  addClipFrom: (source: { label: string; timeline: Timeline; gallerySource?: Block['gallerySource'] }, index?: number) => void;
  setClipGalleryTimeline: (blockId: string, entry: GalleryEntry, timelineId: string) => void;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  setBlockDuration: (id: string, ms: number) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockSpeed: (id: string, speed: number) => void;
  setBlockLoop: (id: string, loop: boolean) => void;
  setBlockColor: (id: string, color: string | undefined) => void;
  moveBlock: (id: string, index: number) => void;
  setDurationMode: (m: 'custom' | 'even') => void;
  setTimelineLoop: (v: boolean) => void;
  setTimelineDuration: (ms: number) => void;

  setTransition: (afterBlockId: string, patch: Partial<Pick<Transition, 'durationMs' | 'easing'>>) => void;
  removeTransition: (afterBlockId: string) => void;

  addTimeline: (name?: string) => void;
  renameTimeline: (id: string, name: string) => void;
  deleteTimeline: (id: string) => void;
  setActiveTimeline: (id: string) => void;
  /** the authored blend into a state — what setState uses when given no duration */
  setStateTransition: (id: string, durationMs: number, easing?: EasingCurve) => void;

  /**
   * Programmatic state-machine control (spec §14) — each Timeline is a "state" (matching
   * the dotLottie export, where every timeline already becomes one exported state). The
   * intended public surface: setState for an immediate-or-scheduled switch, enableState as
   * its alias, returnToPreviousState, cancelScheduledState. Matched by name (case-
   * insensitive) or id, so `setState("happy")` reads the way the spec's own examples do.
   * Morphs by default (DEFAULT_STATE_TRANSITION_MS) — pass `{ duration: 0 }` for an
   * instant cut instead; that's the opt-in direction, not the other way around. Also
   * mirrored onto window.blooby for host-app / console use — see main.tsx — so runtime
   * control never requires reaching into editor internals.
   */
  setState: (nameOrId: string, opts?: { at?: number; duration?: number; easing?: EasingCurve }) => void;
  enableState: (nameOrId: string, opts?: { at?: number; duration?: number; easing?: EasingCurve }) => void;
  returnToPreviousState: (opts?: { duration?: number; easing?: EasingCurve }) => void;
  cancelScheduledState: () => void;
  clearStateTransition: () => void;

  addModifier: (m: Omit<Modifier, 'id'>) => void;
  updateModifier: (id: string, fn: (m: Modifier) => void) => void;
  removeModifier: (id: string) => void;

  /** Keeps an SVG with the project, so it survives a save and an emitter can point at it. */
  addSvgAsset: (name: string, markup: string, viewBox: string) => string;
  removeSvgAsset: (id: string) => void;

  selectEmitter: (id: string | null) => void;
  addEmitter: (e: Omit<Emitter, 'id'>) => void;
  updateEmitter: (id: string, fn: (e: Emitter) => void) => void;
  removeEmitter: (id: string) => void;

  captureExpression: (name: string) => void;
  renameExpression: (id: string, name: string) => void;
  applyExpression: (expressionId: string, atMs: number, easing?: EasingCurve) => void;
  morphBetween: (fromId: string, toId: string, atMs: number, durationMs: number, easing: EasingCurve) => void;
  savePreset: (name: string, trackIds: string[], durationMs: number) => void;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
  /** Overwrite the preset a clip came from with that clip's current keyframes. */
  updatePresetFromBlock: (blockId: string) => void;
  setPresetColor: (id: string, color: string | undefined) => void;

  /** `galleryId` ties this load to an existing gallery entry — omit it for a project
   * that has never been in the gallery before (an imported file, say) so it gets its
   * own fresh slot instead of overwriting whatever was open. */
  loadProject: (p: Project, galleryId?: string) => void;
  resetProject: () => void;
}

function load(): Project {
  if (!getActiveId()) setActiveId(uidGallery());
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultProject(), ...migrate(JSON.parse(raw)) };
  } catch { /* fall through to a fresh mascot */ }
  return defaultProject();
}

/** A project saved before Stage 3 (a single flat timeline) still has `tracks`/`blocks`
 * at the top level instead of `timelines[]` — lift it into one timeline on load. */
function migrate(p: Project): Project {
  const legacy = p as unknown as { tracks?: Track[]; blocks?: Block[]; modifiers?: Modifier[]; durationMode?: 'custom' | 'even'; timelineDurationMs?: number; loop?: boolean };
  if (Array.isArray(p.timelines) && p.timelines.length) return p;
  const tl = makeTimeline('Idle');
  if (legacy.tracks) tl.tracks = legacy.tracks;
  if (legacy.blocks) tl.blocks = legacy.blocks;
  if (legacy.modifiers) tl.modifiers = legacy.modifiers;
  if (legacy.durationMode) tl.durationMode = legacy.durationMode;
  if (legacy.timelineDurationMs) tl.timelineDurationMs = legacy.timelineDurationMs;
  if (legacy.loop) tl.loop = legacy.loop;
  return { ...p, timelines: [tl], activeTimelineId: tl.id };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function autosave(p: Project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota — the export button still works */ }
    // mirror into whichever gallery entry is currently open, so "New clip" always has
    // somewhere safe to come back to without a separate explicit save step
    const id = getActiveId();
    if (id) putEntry({ id, name: p.name, updatedAt: Date.now(), project: p }).catch(() => { /* IndexedDB unavailable — local/session work still stands */ });
  }, 400);
}

/** `name`, or `name 2` / `name 3` / … if it's already taken — never a silent collision
 * between two captured poses or two presets sharing a label. */
export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Snapshot values of every property that any expression could touch. */
export function snapshotKey(nodeId: string, property: string) { return `${nodeId}.${property}`; }
export function splitKey(key: string): [string, string] {
  const i = key.indexOf('.');
  return [key.slice(0, i), key.slice(i + 1)];
}


/**
 * Reading and writing a value without caring where it lives.
 *
 * A property path either addresses a rig node (or the camera) or an effect on the active
 * timeline. Everything above this line — autokey, the stopwatch, undo, the timeline lanes
 * — is written against nodeId+path and works unchanged for either, which is the whole
 * reason effects became animatable in one pass instead of growing a parallel system.
 */
const read = (p: Project, rig: Rig, nodeId: string, path: string): KeyValue | undefined =>
  isEffectProp(path) ? readEffectProp(activeTimeline(p), nodeId, path) : readProp(rig, nodeId, path);

const write = (p: Project, nodeId: string, path: string, v: KeyValue): void => {
  if (isEffectProp(path)) writeEffectProp(activeTimeline(p), nodeId, path, v as number);
  else writeProp(p.rig, nodeId, path, v);
};


/**
 * The effects that belong with a stretch of a timeline, as a preset carries them.
 *
 * A preset is "the animation", not "the keyframes": Sleepy without its zzz is a mascot
 * with its eyes shut. savePreset only ever copied tracks, so every preset a user made
 * lost its emitters and modifiers — and since publishing sends that object as-is, the
 * community queue was full of presets with nothing to preview.
 *
 * `startMs`/`endMs` are relative to the effect's own scope, so a clip-scoped one already
 * uses the origin the preset wants and a global one has to be rebased off the span.
 */
function effectsFor<T extends { blockId?: string; startMs?: number; endMs?: number }>(
  all: T[], blockIds: Set<string>, start: number, durationMs: number,
): Omit<T, 'id' | 'blockId'>[] {
  const out: Omit<T, 'id' | 'blockId'>[] = [];
  for (const fx of all) {
    if (fx.blockId) {
      if (!blockIds.has(fx.blockId)) continue;
      const { id, blockId, ...rest } = fx as T & { id?: string };
      void id; void blockId;
      out.push(rest as Omit<T, 'id' | 'blockId'>);
      continue;
    }
    // global: keep it only if it actually overlaps the span being saved, then rebase
    const from = fx.startMs ?? 0;
    const to = fx.endMs ?? Infinity;
    if (to <= start || from >= start + durationMs) continue;
    const { id, blockId, ...rest } = fx as T & { id?: string };
    void id; void blockId;
    out.push({
      ...(rest as Omit<T, 'id' | 'blockId'>),
      startMs: Math.max(0, from - start),
      ...(fx.endMs === undefined ? {} : { endMs: Math.min(durationMs, to - start) }),
    });
  }
  return out;
}

export const useEditor = create<Editor>((set, get) => ({
  project: load(),
  catalog: [],
  expressionCatalog: [],
  catalogError: null,
  selection: [],
  selectedTrackId: null,
  selectedBlockId: null,
  selectedEmitterId: null,
  playhead: 0,
  playing: false,
  loop: true,
  autoKey: false,
  past: [],
  future: [],
  lastLabel: '',
  lastAt: 0,
  previousTimelineId: null,
  pendingStateChange: null,
  stateTransition: null,

  commit(fn, label = '') {
    const { project, past, lastLabel, lastAt } = get();
    const now = Date.now();
    // a slider drag is one undo step, not two hundred
    const coalesce = label !== '' && label === lastLabel && now - lastAt < 700;
    const next = structuredClone(project);
    fn(next);
    at(next).timelineDurationMs = derivedDuration(at(next));
    autosave(next);
    set({
      project: next,
      past: coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      lastLabel: label,
      lastAt: now,
    });
  },

  undo() {
    const { past, future, project } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    autosave(prev);
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], lastLabel: '' });
  },
  redo() {
    const { past, future, project } = get();
    if (!future.length) return;
    autosave(future[0]);
    set({ project: future[0], past: [...past, project], future: future.slice(1), lastLabel: '' });
  },

  select: (selection) => set({ selection }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  toggleAutoKey: () => set({ autoKey: !get().autoKey }),
  selectTrack: (selectedTrackId) => set({ selectedTrackId }),
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),

  trackFor(nodeId, property) {
    const { project, playhead } = get();
    return activeTrackFor(at(project), nodeId, property, playhead);
  },

  setValue(nodeId, property, value, label) {
    const { autoKey, playhead } = get();
    const existing = get().trackFor(nodeId, property);
    get().commit((p) => {
      const track = existing && at(p).tracks.find((t) => t.id === existing.id);
      if (track) {
        upsertKeyframe(track, playhead, value);
      } else if (autoKey) {
        // scoped to whichever clip the playhead is in (a proper clip override, per spec
        // §15) — never a global track, or it would leak into every other clip that
        // doesn't animate this property, including a brand-new one added later.
        const t: Track = { id: uid('t'), nodeId, property, keyframes: [], blockId: blockAt(at(p), playhead)?.id };
        upsertKeyframe(t, playhead, value);
        at(p).tracks.push(t);
      } else {
        write(p, nodeId, property, value);
      }
    }, label ?? `${nodeId}.${property}${existing ? '.kf' : ''}`);
  },

  /**
   * The stopwatch: is there a keyframe at the playhead, and put one there or take it away.
   *
   * It used to mean "this property has a track at all", which stayed lit after the
   * playhead moved off the keyframe and turned an innocent-looking second click into
   * "delete every keyframe on this property". Now it means exactly what it looks like.
   */
  toggleKeyframe(nodeId, property) {
    const { playhead, project } = get();
    const track = activeTrackFor(activeTimeline(project), nodeId, property, playhead);
    // 1ms, matching writeKeyframe's own idea of "the same keyframe"
    const here = track?.keyframes.find((k) => Math.abs(k.time - playhead) < 1);
    if (!track || !here) { get().addKeyframeNow(nodeId, property); return; }

    get().commit((p) => {
      const t = at(p).tracks.find((x) => x.id === track.id);
      if (!t) return;
      t.keyframes = t.keyframes.filter((k) => k.id !== here.id);
      if (t.keyframes.length) return;
      // the last one: bake the value back down so removing a keyframe never moves the
      // mascot, then drop the empty track rather than leave a blank lane on the strip
      const v = sampleTrack(track, playhead);
      if (v !== undefined) write(p, nodeId, property, v);
      at(p).tracks = at(p).tracks.filter((x) => x.id !== t.id);
    });
  },

  toggleTrack(nodeId, property) {
    const existing = get().trackFor(nodeId, property);
    const { playhead } = get();
    get().commit((p) => {
      if (existing) {
        // bake the value at the playhead back down so the pose doesn't jump
        const v = sampleTrack(existing, playhead);
        if (v !== undefined) write(p, nodeId, property, v);
        at(p).tracks = at(p).tracks.filter((t) => t.id !== existing.id);
      } else {
        const v = read(p, p.rig, nodeId, property);
        if (v === undefined) return;
        // same clip-scoping as setValue's autoKey branch — see its comment
        at(p).tracks.push({ id: uid('t'), nodeId, property, blockId: blockAt(at(p), playhead)?.id, keyframes: [{ id: uid('k'), time: playhead, value: v, easingOut: { type: 'preset', name: 'easeInOut' } }] });
      }
    });
  },

  addKeyframeNow(nodeId, property) {
    const { playhead, project } = get();
    const v = read(project, evaluateRig(project, playhead), nodeId, property);
    if (v === undefined) return;
    // writeKeyframe rather than a hand-rolled push: it scopes the new track to whichever
    // clip the playhead is in, and that is the scope activeTrackFor — and therefore the
    // renderer, and the stopwatch — can actually see. This used to create a GLOBAL track,
    // which inside a clip is invisible: the keyframe existed and did nothing. It also
    // grabbed the first track for the property regardless of which clip owned it.
    get().commit((p) => { writeKeyframe(p, nodeId, property, playhead, v, { type: 'preset', name: 'easeInOut' }); });
  },

  moveKeyframe(trackId, kfId, time) {
    get().commit((p) => {
      const t = at(p).tracks.find((x) => x.id === trackId);
      const k = t?.keyframes.find((x) => x.id === kfId);
      if (!k || !t) return;
      k.time = Math.max(0, Math.round(time));
      t.keyframes.sort((a, b) => a.time - b.time);
    }, `move.${kfId}`);
  },

  moveKeyframes(entries) {
    if (!entries.length) return;
    get().commit((p) => {
      const tl = at(p);
      const touched = new Set<string>();
      for (const { trackId, kfId, time } of entries) {
        const t = tl.tracks.find((x) => x.id === trackId);
        const k = t?.keyframes.find((x) => x.id === kfId);
        if (k) { k.time = Math.max(0, Math.round(time)); touched.add(trackId); }
      }
      for (const trackId of touched) tl.tracks.find((x) => x.id === trackId)?.keyframes.sort((a, b) => a.time - b.time);
    }, `movemulti.${entries.map((i) => i.kfId).join(',')}`);
  },

  deleteKeyframe(trackId, kfId) {
    get().commit((p) => {
      const t = at(p).tracks.find((x) => x.id === trackId);
      if (!t) return;
      t.keyframes = t.keyframes.filter((k) => k.id !== kfId);
      if (!t.keyframes.length) at(p).tracks = at(p).tracks.filter((x) => x.id !== trackId);
    });
  },

  deleteKeyframes(ids) {
    if (!ids.length) return;
    get().commit((p) => {
      const tl = at(p);
      const byTrack = new Map<string, Set<string>>();
      for (const { trackId, kfId } of ids) {
        if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
        byTrack.get(trackId)!.add(kfId);
      }
      for (const [trackId, kfIds] of byTrack) {
        const t = tl.tracks.find((x) => x.id === trackId);
        if (!t) continue;
        t.keyframes = t.keyframes.filter((k) => !kfIds.has(k.id));
      }
      tl.tracks = tl.tracks.filter((t) => t.keyframes.length);
    });
  },

  setEasing(trackId, kfId, easing) {
    get().commit((p) => {
      const k = at(p).tracks.find((x) => x.id === trackId)?.keyframes.find((x) => x.id === kfId);
      if (k) k.easingOut = easing;
    }, `ease.${kfId}`);
  },

  addNode(node) {
    get().commit((p) => { p.rig.nodes[node.id] = node; });
    set({ selection: [node.id] });
  },

  deleteNode(id) {
    get().commit((p) => {
      if (id === p.rig.rootId) return;
      const doomed = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of Object.values(p.rig.nodes))
          if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) { doomed.add(n.id); grew = true; }
      }
      for (const d of doomed) delete p.rig.nodes[d];
      for (const n of Object.values(p.rig.nodes)) if (n.eye?.linkedToId && doomed.has(n.eye.linkedToId)) n.eye.linkedToId = null;
      for (const tl of p.timelines) {
        tl.tracks = tl.tracks.filter((t) => !doomed.has(t.nodeId));
        tl.modifiers = tl.modifiers.filter((m) => !doomed.has(m.nodeId));
      }
    });
    set({ selection: [] });
  },

  updateNode(id, fn, label) {
    get().commit((p) => { const n = p.rig.nodes[id]; if (n) fn(n); }, label);
  },

  async loadCatalog() {
    try {
      const { presets, expressions } = await fetchCatalog();
      set({ catalog: presets, expressionCatalog: expressions, catalogError: null });
    } catch (e) {
      // deliberately NOT a silent fall back to the builtins: with a backend configured,
      // a library that quietly looks empty is worse than one that says it failed
      set({ catalogError: e instanceof Error ? e.message : String(e) });
    }
  },

  addBlock(presetId, index) {
    const { project, catalog } = get();
    const own = project.presets.find((p) => p.id === presetId);
    const preset = own ?? catalog.find((p) => p.id === presetId);
    if (!preset) return;
    const blockId = uid('b');
    const at0 = index ?? at(project).blocks.length;
    get().commit((p) => {
      const tl = at(p);
      // a catalogue preset becomes part of the file the moment it is used, so the saved
      // project keeps working offline and blockSampleTime can still find its natural span
      if (!own) p.presets = [...p.presets, preset];
      const block: Block = { id: blockId, presetId, name: preset.name, durationMs: preset.durationMs };
      const next = [...tl.blocks];
      next.splice(at0, 0, block);
      // place tracks at the new block's start, then let relayout settle everything
      let start = 0;
      for (let i = 0; i < at0; i++) start += next[i].durationMs;
      for (const t of preset.tracks) {
        tl.tracks.push({
          id: uid('t'), nodeId: t.nodeId, property: t.property, blockId,
          keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + start })),
        });
      }
      attachPresetEffects(tl, preset, blockId);
      const shifted = tl.blocks.slice(at0).map((b) => b.id);
      if (shifted.length) {
        const set2 = new Set(shifted);
        for (const t of tl.tracks) if (t.blockId && set2.has(t.blockId)) for (const k of t.keyframes) k.time += preset.durationMs;
      }
      tl.blocks = next;
      tl.timelineDurationMs = derivedDuration(tl);
    });
  },

  addClipFrom(source, index) {
    const { project } = get();
    const blockId = uid('b');
    const at0 = index ?? at(project).blocks.length;
    const durationMs = Math.max(200, Math.round(source.timeline.timelineDurationMs));
    // a same-project timeline is trivially all-valid (same rig); a gallery timeline's rig
    // can differ, so this doubles as that safety filter — tracks for a node this rig
    // doesn't have just don't come along, rather than referencing nothing.
    const validIds = new Set(Object.keys(project.rig.nodes));
    get().commit((p) => {
      const tl = at(p);
      const block: Block = { id: blockId, presetId: '', name: source.label, durationMs, gallerySource: source.gallerySource };
      const next = [...tl.blocks];
      next.splice(at0, 0, block);
      let start = 0;
      for (let i = 0; i < at0; i++) start += next[i].durationMs;
      tl.tracks.push(...mergeTracksForClip(source.timeline.tracks, validIds, blockId, start, () => uid('t')));
      const shifted = tl.blocks.slice(at0).map((b) => b.id);
      if (shifted.length) {
        const set2 = new Set(shifted);
        for (const t of tl.tracks) if (t.blockId && set2.has(t.blockId)) for (const k of t.keyframes) k.time += durationMs;
      }
      tl.blocks = next;
      tl.timelineDurationMs = derivedDuration(tl);
    });
    set({ selectedBlockId: blockId });
  },

  setClipGalleryTimeline(blockId, entry, timelineId) {
    const timeline = entry.project.timelines.find((t) => t.id === timelineId);
    if (!timeline) return;
    const { project } = get();
    const validIds = new Set(Object.keys(project.rig.nodes));
    get().commit((p) => {
      const tl = at(p);
      const block = tl.blocks.find((b) => b.id === blockId);
      if (!block?.gallerySource) return;
      block.gallerySource = { ...block.gallerySource, timelineId, timelineName: timeline.name };
      // replace this clip's tracks wholesale — same "instance, not a live link" contract
      // as everything else here: re-pointing to a different source timeline re-copies it,
      // it doesn't start following that timeline's future edits.
      tl.tracks = tl.tracks.filter((t) => t.blockId !== blockId);
      const idx = tl.blocks.findIndex((b) => b.id === blockId);
      const start = blockStarts(tl)[idx];
      tl.tracks.push(...mergeTracksForClip(timeline.tracks, validIds, blockId, start, () => uid('t')));
    });
  },

  duplicateBlock(id) {
    const { project } = get();
    const tl = at(project);
    const idx = tl.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const original = tl.blocks[idx];
    const ownTracks = tl.tracks.filter((t) => t.blockId === id);
    const ownMods = tl.modifiers.filter((m) => m.blockId === id);
    const newId = uid('b');
    get().commit((p) => {
      const tl2 = at(p);
      const next = [...tl2.blocks];
      next.splice(idx + 1, 0, { ...original, id: newId });
      // open a duration-sized gap right after the original for the copy to sit in
      const shiftAfter = new Set(tl2.blocks.slice(idx + 1).map((b) => b.id));
      for (const t of tl2.tracks) if (t.blockId && shiftAfter.has(t.blockId)) for (const k of t.keyframes) k.time += original.durationMs;
      // the copy's own keyframes land exactly one clip-duration after the original's —
      // same offset-within-block, translated forward by durationMs (no window lookup
      // needed since it's landing immediately adjacent, not somewhere arbitrary)
      for (const t of ownTracks) {
        tl2.tracks.push({
          ...t, id: uid('t'), blockId: newId,
          keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + original.durationMs })),
        });
      }
      for (const m of ownMods) tl2.modifiers.push({ ...m, id: uid('m'), blockId: newId });
      tl2.blocks = next;
      tl2.timelineDurationMs = derivedDuration(tl2);
    });
    set({ selectedBlockId: newId });
  },

  removeBlock(id) {
    get().commit((p) => {
      const tl = at(p);
      tl.tracks = tl.tracks.filter((t) => t.blockId !== id);
      relayoutBlocks(tl, tl.blocks.filter((b) => b.id !== id));
    });
    if (get().selectedBlockId === id) set({ selectedBlockId: null });
  },

  setBlockDuration(id, ms) {
    get().commit((p) => {
      const tl = at(p);
      relayoutBlocks(tl, tl.blocks.map((b) => (b.id === id ? { ...b, durationMs: Math.max(60, Math.round(ms)) } : b)));
    }, `dur.${id}`);
  },

  renameBlock(id, name) {
    get().commit((p) => { const b = at(p).blocks.find((x) => x.id === id); if (b && name.trim()) b.name = name.trim(); }, `bname.${id}`);
  },

  setBlockSpeed(id, speed) {
    get().commit((p) => {
      const b = at(p).blocks.find((x) => x.id === id);
      if (b) b.speed = Math.max(0.1, Math.round(speed * 100) / 100);
    }, `speed.${id}`);
  },

  setBlockLoop(id, loop) {
    get().commit((p) => {
      const b = at(p).blocks.find((x) => x.id === id);
      if (b) b.loop = loop;
    });
  },

  setBlockColor(id, color) {
    get().commit((p) => {
      const b = at(p).blocks.find((x) => x.id === id);
      if (b) b.color = color;
    });
  },

  setTransition(afterBlockId, patch) {
    get().commit((p) => {
      const tl = at(p);
      const list = tl.transitions ?? (tl.transitions = []);
      const existing = list.find((x) => x.afterBlockId === afterBlockId);
      if (existing) Object.assign(existing, patch);
      else list.push({ id: uid('x'), afterBlockId, durationMs: 300, easing: { type: 'preset', name: 'easeInOut' }, ...patch });
    });
  },

  removeTransition(afterBlockId) {
    get().commit((p) => {
      const tl = at(p);
      if (tl.transitions) tl.transitions = tl.transitions.filter((x) => x.afterBlockId !== afterBlockId);
    });
  },

  moveBlock(id, index) {
    get().commit((p) => {
      const tl = at(p);
      const from = tl.blocks.findIndex((b) => b.id === id);
      if (from < 0) return;
      const next = [...tl.blocks];
      const [b] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, index)), 0, b);
      relayoutBlocks(tl, next);
    });
  },

  setDurationMode(m) {
    get().commit((p) => {
      const tl = at(p);
      tl.durationMode = m;
      if (m === 'even' && tl.blocks.length) {
        const even = Math.round(tl.blocks.reduce((s, b) => s + b.durationMs, 0) / tl.blocks.length);
        relayoutBlocks(tl, tl.blocks.map((b) => ({ ...b, durationMs: even })));
      }
    });
  },

  setTimelineLoop(v) {
    get().commit((p) => { at(p).loop = v; }, 'timelineloop');
  },

  setTimelineDuration(ms) {
    get().commit((p) => {
      const tl = at(p);
      // never shorter than the blocks actually tiled on the strip — they'd overlap or
      // get clipped, and block duration already has its own explicit control.
      const floor = blocksEnd(tl);
      const next = Math.max(200, floor, Math.round(ms));
      // shrinking must not silently drop animation: clamp every keyframe past the new
      // end back onto it instead (keeps the keyframe, just moves it — nothing deleted).
      for (const track of tl.tracks) {
        for (const k of track.keyframes) if (k.time > next) k.time = next;
        track.keyframes.sort((a, b) => a.time - b.time);
      }
      tl.durationOverrideMs = next;
    }, 'tldur');
  },

  addTimeline(name) {
    const { project } = get();
    const base = name?.trim() || `Timeline ${project.timelines.length + 1}`;
    const tl = makeTimeline(uniqueName(base, project.timelines.map((t) => t.name)));
    get().commit((p) => { p.timelines.push(tl); p.activeTimelineId = tl.id; });
    // the same reset switching to an existing timeline does. Without it a clip and an
    // emitter from the OLD timeline stayed selected, so the clip inspector described
    // something not on screen and a new effect got scoped to a block that is not here.
    set({ selection: [], playhead: 0, selectedBlockId: null, selectedEmitterId: null, selectedTrackId: null });
  },

  renameTimeline(id, name) {
    get().commit((p) => {
      const tl = p.timelines.find((t) => t.id === id);
      if (tl && name.trim()) tl.name = uniqueName(name.trim(), p.timelines.filter((t) => t.id !== id).map((t) => t.name));
    }, `tlname.${id}`);
  },

  deleteTimeline(id) {
    const { project } = get();
    if (project.timelines.length <= 1) return; // always at least one
    get().commit((p) => {
      p.timelines = p.timelines.filter((t) => t.id !== id);
      if (p.activeTimelineId === id) p.activeTimelineId = p.timelines[0].id;
    });
    set({ selection: [], playhead: 0, selectedBlockId: null });
  },

  setStateTransition(id, durationMs, easing) {
    get().commit((p) => {
      const tl = p.timelines.find((t) => t.id === id);
      if (!tl) return;
      tl.transitionMs = Math.max(0, durationMs);
      if (easing) tl.transitionEasing = easing;
    }, `transition.${id}`);
  },

  setActiveTimeline(id) {
    const { project } = get();
    if (!project.timelines.some((t) => t.id === id)) return;
    const prevId = project.activeTimelineId;
    get().commit((p) => { p.activeTimelineId = id; });
    // tracked here too (not just setState) so returnToPreviousState reflects a manual
    // tab click the same as a programmatic switch — "previous" means whatever was active
    // right before this one, regardless of which path changed it.
    set({ selection: [], playhead: 0, selectedBlockId: null, selectedEmitterId: null, previousTimelineId: prevId });
  },

  setState(nameOrId, opts) {
    const { project, playhead } = get();
    const target = project.timelines.find((t) => t.id === nameOrId)
      ?? project.timelines.find((t) => t.name.toLowerCase() === nameOrId.toLowerCase());
    if (!target || target.id === project.activeTimelineId) return;

    // "at" in the future schedules it — App.tsx's playback tick fires it the instant the
    // playhead reaches that point. "at" already passed (or omitted) switches right now.
    if (opts?.at !== undefined && opts.at > playhead) {
      set({ pendingStateChange: { timelineId: target.id, atMs: opts.at, durationMs: opts.duration ?? target.transitionMs ?? DEFAULT_STATE_TRANSITION_MS, easing: opts.easing ?? target.transitionEasing ?? DEFAULT_STATE_EASING } });
      return;
    }
    // an explicit duration wins, then the target state's own authored blend, then the
    // generic default — so `setState('happy')` from a host page honours how it was authored
    const durationMs = opts?.duration ?? target.transitionMs ?? DEFAULT_STATE_TRANSITION_MS;
    const easing = opts?.easing ?? target.transitionEasing ?? DEFAULT_STATE_EASING;
    // capture the *actually evaluated* outgoing pose before switching — not just its last
    // raw keyframe — same principle the clip-transition blend uses one level down.
    const fromRig = durationMs > 0 ? evaluateRig(project, playhead) : null;
    const prevId = project.activeTimelineId;
    get().commit((p) => { p.activeTimelineId = target.id; });
    set({
      selection: [], playhead: 0, selectedBlockId: null, selectedEmitterId: null, pendingStateChange: null,
      previousTimelineId: prevId,
      stateTransition: fromRig ? { fromRig, durationMs, easing, startedAtMs: performance.now() } : null,
    });
  },

  // spec's two example call shapes (setState / enableState) are the same operation here —
  // scheduling and blending are both just optional fields on the same `opts` bag.
  enableState(nameOrId, opts) { get().setState(nameOrId, opts); },

  returnToPreviousState(opts) {
    const prev = get().previousTimelineId;
    if (prev) get().setState(prev, opts);
  },

  cancelScheduledState() { set({ pendingStateChange: null }); },
  clearStateTransition() { set({ stateTransition: null }); },

  /**
   * A global effect is bounded to the strip as it stands when you add it.
   *
   * Otherwise inserting a preset afterwards silently drops it under a shake nobody asked
   * to extend over it. The range is visible and draggable, so widening it back is one
   * gesture — the default just stops being a surprise.
   */
  addModifier(m) {
    get().commit((p) => {
      const tl = at(p);
      tl.modifiers.push({ ...boundToStrip(tl, m), id: uid('m') });
    });
  },
  updateModifier(id, fn) { get().commit((p) => { const m = at(p).modifiers.find((x) => x.id === id); if (m) fn(m); }, `mod.${id}`); },
  removeModifier(id) { get().commit((p) => { at(p).modifiers = at(p).modifiers.filter((m) => m.id !== id); }); },

  // `emitters` is optional on Timeline so old projects load untouched — every write has
  // to seed the array rather than assume it
  addSvgAsset(name, markup, viewBox) {
    const id = uid('svg');
    get().commit((p) => { (p.svgAssets ??= []).push({ id, name, markup, viewBox }); });
    return id;
  },
  removeSvgAsset(id) {
    get().commit((p) => {
      if (p.svgAssets) p.svgAssets = p.svgAssets.filter((a) => a.id !== id);
      // an emitter pointing at a deleted asset would render nothing and look broken;
      // drop back to its glyphs, which it still has
      for (const tl of p.timelines) for (const e of tl.emitters ?? []) if (e.svgAssetId === id) { delete e.svgAssetId; delete e.svg; }
    });
  },

  selectEmitter(id) { set({ selectedEmitterId: id }); },
  addEmitter(e) {
    const id = uid('e');
    get().commit((p) => {
      const tl = at(p);
      (tl.emitters ??= []).push({ ...boundToStrip(tl, e), id });
    });
    // select it, so its trajectory handles are on the stage the moment it exists —
    // otherwise a new emitter is a row of numbers with nothing to aim
    set({ selectedEmitterId: id });
  },
  updateEmitter(id, fn) { get().commit((p) => { const e = at(p).emitters?.find((x) => x.id === id); if (e) fn(e); }, `emit.${id}`); },
  removeEmitter(id) {
    get().commit((p) => { const tl = at(p); if (tl.emitters) tl.emitters = tl.emitters.filter((e) => e.id !== id); });
    if (get().selectedEmitterId === id) set({ selectedEmitterId: null });
  },

  captureExpression(name) {
    const { project, playhead } = get();
    const rig = evaluateRig(project, playhead);
    const snapshot: Record<string, KeyValue> = {};
    for (const node of Object.values(rig.nodes)) {
      for (const prop of ['surface.yaw', 'surface.pitch', 'transform.scale.x', 'transform.scale.y', 'transform.rotation', 'transform.length', 'eye.openness', 'eye.distanceFromCenter', 'color']) {
        const v = readProp(rig, node.id, prop);
        if (v !== undefined) snapshot[snapshotKey(node.id, prop)] = v;
      }
    }
    for (const prop of ['camera.fov', 'camera.distance']) snapshot[snapshotKey(CAMERA_ID, prop)] = readProp(rig, CAMERA_ID, prop)!;
    get().commit((p) => {
      const unique = uniqueName(name, p.expressions.map((e) => e.name));
      p.expressions.push({ id: uid('x'), name: unique, snapshot });
    });
  },

  renameExpression(id, name) {
    get().commit((p) => {
      const x = p.expressions.find((e) => e.id === id);
      if (x && name.trim()) x.name = uniqueName(name.trim(), p.expressions.filter((e) => e.id !== id).map((e) => e.name));
    }, `xname.${id}`);
  },

  applyExpression(expressionId, atMs, easing = { type: 'preset', name: 'easeInOut' }) {
    get().commit((p) => {
      const x = p.expressions.find((e) => e.id === expressionId);
      if (!x) return;
      for (const [key, value] of Object.entries(x.snapshot)) {
        const [nodeId, property] = splitKey(key);
        if (nodeId !== CAMERA_ID && !p.rig.nodes[nodeId]) continue;
        writeKeyframe(p, nodeId, property, atMs, value, easing);
      }
    });
  },

  morphBetween(fromId, toId, atMs, durationMs, easing) {
    get().commit((p) => {
      const a = p.expressions.find((e) => e.id === fromId);
      const b = p.expressions.find((e) => e.id === toId);
      if (!a || !b) return;
      for (const [key, to] of Object.entries(b.snapshot)) {
        const from = a.snapshot[key];
        if (from === undefined) continue;
        if (JSON.stringify(from) === JSON.stringify(to)) continue; // only what actually differs
        const [nodeId, property] = splitKey(key);
        if (nodeId !== CAMERA_ID && !p.rig.nodes[nodeId]) continue;
        const isAngle = property.endsWith('rotation') || property.includes('yaw') || property.includes('pitch');
        const end = isAngle && typeof from === 'number' && typeof to === 'number'
          ? lerpAngle(from, to, 1)
          : lerpValue(from, to, 1);
        writeKeyframe(p, nodeId, property, atMs, from, easing);
        writeKeyframe(p, nodeId, property, atMs + durationMs, end, easing);
      }
    });
  },

  savePreset(name, trackIds, durationMs) {
    get().commit((p) => {
      const picked = at(p).tracks.filter((t) => trackIds.includes(t.id));
      if (!picked.length) return;
      const start = Math.min(...picked.flatMap((t) => t.keyframes.map((k) => k.time)));
      const tl = at(p);
      const blockIds = new Set(picked.map((t) => t.blockId).filter((x): x is string => !!x));
      const preset: Preset = {
        id: uid('p'), name: uniqueName(name, p.presets.map((x) => x.name)), source: 'custom', durationMs,
        tracks: picked.map((t) => ({ id: uid('t'), nodeId: t.nodeId, property: t.property, keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time - start })) })),
        modifiers: effectsFor(tl.modifiers, blockIds, start, durationMs),
        emitters: effectsFor(tl.emitters ?? [], blockIds, start, durationMs),
      };
      p.presets.push(preset);
    });
  },

  /**
   * Editing a preset, the only way that makes sense in a keyframe editor: place it as a
   * clip, tweak it on the strip where you can see it, then save the clip back over it.
   *
   * Clips already on the strip keep the copy they were added with — a preset is a
   * template, not a live link — so this changes what future placements look like.
   */
  updatePresetFromBlock(blockId) {
    get().commit((p) => {
      const tl = at(p);
      const i = tl.blocks.findIndex((b) => b.id === blockId);
      const block = tl.blocks[i];
      const preset = block?.presetId ? p.presets.find((x) => x.id === block.presetId) : undefined;
      if (!preset) return;
      const start = blockStarts(tl)[i];
      preset.durationMs = block.durationMs;
      preset.tracks = tl.tracks.filter((t) => t.blockId === blockId).map((t) => ({
        id: uid('t'), nodeId: t.nodeId, property: t.property,
        keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time - start })),
      }));
      const only = new Set([blockId]);
      preset.modifiers = effectsFor(tl.modifiers, only, start, block.durationMs);
      preset.emitters = effectsFor(tl.emitters ?? [], only, start, block.durationMs);
    });
  },

  renamePreset(id, name) {
    get().commit((p) => {
      const x = p.presets.find((e) => e.id === id);
      if (x && name.trim()) x.name = uniqueName(name.trim(), p.presets.filter((e) => e.id !== id).map((e) => e.name));
    }, `pname.${id}`);
  },

  /**
   * Clips already on the strip keep working: they hold their own copy of the keyframes,
   * and only the little `presetId` backreference goes stale. So this cannot orphan
   * animation — it removes the template, not what was made from it.
   */
  deletePreset(id) {
    get().commit((p) => { p.presets = p.presets.filter((x) => x.id !== id); });
  },

  setPresetColor(id, color) {
    get().commit((p) => { const x = p.presets.find((e) => e.id === id); if (x) x.color = color; });
  },

  loadProject(p, galleryId) {
    const next = { ...defaultProject(), ...migrate(p) };
    setActiveId(galleryId ?? uidGallery());
    autosave(next);
    set({ project: next, past: [], future: [], selection: [], playhead: 0, selectedBlockId: null, selectedEmitterId: null, selectedTrackId: null });
  },
  resetProject() { get().loadProject(defaultProject()); },
}));

function upsertKeyframe(track: Track, time: number, value: KeyValue) {
  const existing = track.keyframes.find((k) => Math.abs(k.time - time) < 1);
  if (existing) { existing.value = value; return; }
  track.keyframes.push({ id: uid('k'), time, value, easingOut: { type: 'preset', name: 'easeInOut' } });
  track.keyframes.sort((a, b) => a.time - b.time);
}

/**
 * Where a new global effect stops.
 *
 * The end of the tiled clips, not the timeline's duration: `derivedDuration` pads 200ms
 * past the last keyframe, and a clip appended afterwards starts at `blocksEnd` — inside
 * that padding. Bounding to the padded figure therefore still let the effect reach over
 * the very next clip, which is the thing this exists to prevent.
 */
function boundToStrip<T extends { blockId?: string; endMs?: number }>(tl: Timeline, e: T): T {
  if (e.blockId || e.endMs !== undefined) return e;
  return { ...e, endMs: Math.round(blocksEnd(tl) || tl.timelineDurationMs) };
}

export function writeKeyframe(p: Project, nodeId: string, property: string, time: number, value: KeyValue, easing: EasingCurve) {
  const tl = at(p);
  let track = activeTrackFor(tl, nodeId, property, time);
  if (!track) {
    // scoped to whichever clip `time` falls in (a clip override, not a global track that
    // would leak into every other clip) — undefined blockId (global) only when this
    // timeline has no blocks at all, the pre-clip free-keyframe workflow.
    const owner = blockAt(tl, time);
    track = { id: uid('t'), nodeId, property, keyframes: [], blockId: owner?.id };
    tl.tracks.push(track);
    // A brand-new track with one keyframe is constant *everywhere within its own scope*
    // (sampleTrack's length===1 case), so writing a target value at t>anchor would
    // retroactively apply it before that too. Anchor at the clip's own start (absolute 0
    // for a global track) so only the segment from `time` onward actually changes, and
    // the anchor stays inside the same clip it's anchoring.
    const anchorAt = owner ? blockStarts(tl)[tl.blocks.indexOf(owner)] : 0;
    if (time > anchorAt + 1) {
      const base = read(p, p.rig, nodeId, property);
      if (base !== undefined) track.keyframes.push({ id: uid('k'), time: anchorAt, value: base, easingOut: { type: 'linear' } });
    }
  }
  const k = track.keyframes.find((x) => Math.abs(x.time - time) < 1);
  if (k) { k.value = value; k.easingOut = easing; return; }
  track.keyframes.push({ id: uid('k'), time, value, easingOut: easing });
  track.keyframes.sort((a, b) => a.time - b.time);
}

/** All keyframe times on the given tracks, deduped — for the prev/next chevrons. */
export function keyframeTimes(tracks: Track[]): number[] {
  const s = new Set<number>();
  for (const t of tracks) for (const k of t.keyframes) s.add(Math.round(k.time));
  return [...s].sort((a, b) => a - b);
}

export { activeTimeline };
export type { Expression, Modifier, Preset, Project, Timeline, Track };
