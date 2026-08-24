import { create } from 'zustand';
import { defaultProject, uid } from './defaults';
import { readProp, writeProp } from './props';
import { evaluateRig, lerpAngle, lerpValue, sampleTrack } from './scene';
import { derivedDuration, relayoutBlocks } from './timeline';
import type { Block, EasingCurve, Expression, KeyValue, Modifier, Preset, Project, RigNode, Track } from './types';
import { CAMERA_ID } from './types';

const STORAGE_KEY = 'blooby.project.v1';
const HISTORY_LIMIT = 80;

export interface Editor {
  project: Project;
  selection: string[];
  selectedTrackId: string | null;
  playhead: number;
  playing: boolean;
  loop: boolean;
  autoKey: boolean;
  past: Project[];
  future: Project[];
  lastLabel: string;
  lastAt: number;

  commit: (fn: (p: Project) => void, label?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (v: boolean) => void;
  toggleAutoKey: () => void;
  setLoop: (v: boolean) => void;
  selectTrack: (id: string | null) => void;

  setValue: (nodeId: string, property: string, value: KeyValue, label?: string) => void;
  trackFor: (nodeId: string, property: string) => Track | undefined;
  toggleTrack: (nodeId: string, property: string) => void;
  addKeyframeNow: (nodeId: string, property: string) => void;
  moveKeyframe: (trackId: string, kfId: string, time: number) => void;
  deleteKeyframe: (trackId: string, kfId: string) => void;
  setEasing: (trackId: string, kfId: string, easing: EasingCurve) => void;

  addNode: (node: RigNode) => void;
  deleteNode: (id: string) => void;
  updateNode: (id: string, fn: (n: RigNode) => void, label?: string) => void;

  addBlock: (presetId: string, index?: number) => void;
  removeBlock: (id: string) => void;
  setBlockDuration: (id: string, ms: number) => void;
  moveBlock: (id: string, index: number) => void;
  setDurationMode: (m: 'custom' | 'even') => void;

  addModifier: (m: Omit<Modifier, 'id'>) => void;
  updateModifier: (id: string, fn: (m: Modifier) => void) => void;
  removeModifier: (id: string) => void;

  captureExpression: (name: string) => void;
  applyExpression: (expressionId: string, atMs: number, easing?: EasingCurve) => void;
  morphBetween: (fromId: string, toId: string, atMs: number, durationMs: number, easing: EasingCurve) => void;
  savePreset: (name: string, trackIds: string[], durationMs: number) => void;

  loadProject: (p: Project) => void;
  resetProject: () => void;
}

function load(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultProject(), ...JSON.parse(raw) } as Project;
  } catch { /* fall through to a fresh mascot */ }
  return defaultProject();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function autosave(p: Project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota — the export button still works */ }
  }, 400);
}

/** Snapshot values of every property that any expression could touch. */
export function snapshotKey(nodeId: string, property: string) { return `${nodeId}.${property}`; }
export function splitKey(key: string): [string, string] {
  const i = key.indexOf('.');
  return [key.slice(0, i), key.slice(i + 1)];
}

export const useEditor = create<Editor>((set, get) => ({
  project: load(),
  selection: [],
  selectedTrackId: null,
  playhead: 0,
  playing: false,
  loop: true,
  autoKey: false,
  past: [],
  future: [],
  lastLabel: '',
  lastAt: 0,

  commit(fn, label = '') {
    const { project, past, lastLabel, lastAt } = get();
    const now = Date.now();
    // a slider drag is one undo step, not two hundred
    const coalesce = label !== '' && label === lastLabel && now - lastAt < 700;
    const next = structuredClone(project);
    fn(next);
    next.timelineDurationMs = derivedDuration(next);
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

  trackFor(nodeId, property) {
    return get().project.tracks.find((t) => t.nodeId === nodeId && t.property === property);
  },

  setValue(nodeId, property, value, label) {
    const { autoKey, playhead } = get();
    const existing = get().trackFor(nodeId, property);
    get().commit((p) => {
      const track = p.tracks.find((t) => t.nodeId === nodeId && t.property === property);
      if (track) {
        upsertKeyframe(track, playhead, value);
      } else if (autoKey) {
        const t: Track = { id: uid('t'), nodeId, property, keyframes: [] };
        upsertKeyframe(t, playhead, value);
        p.tracks.push(t);
      } else {
        writeProp(p.rig, nodeId, property, value);
      }
    }, label ?? `${nodeId}.${property}${existing ? '.kf' : ''}`);
  },

  toggleTrack(nodeId, property) {
    const existing = get().trackFor(nodeId, property);
    const { playhead } = get();
    get().commit((p) => {
      if (existing) {
        // bake the value at the playhead back down so the pose doesn't jump
        const v = sampleTrack(existing, playhead);
        if (v !== undefined) writeProp(p.rig, nodeId, property, v);
        p.tracks = p.tracks.filter((t) => t.id !== existing.id);
      } else {
        const v = readProp(p.rig, nodeId, property);
        if (v === undefined) return;
        p.tracks.push({ id: uid('t'), nodeId, property, keyframes: [{ id: uid('k'), time: playhead, value: v, easingOut: { type: 'preset', name: 'easeInOut' } }] });
      }
    });
  },

  addKeyframeNow(nodeId, property) {
    const { playhead, project } = get();
    const rig = evaluateRig(project, playhead);
    const v = readProp(rig, nodeId, property);
    if (v === undefined) return;
    get().commit((p) => {
      let track = p.tracks.find((t) => t.nodeId === nodeId && t.property === property);
      if (!track) { track = { id: uid('t'), nodeId, property, keyframes: [] }; p.tracks.push(track); }
      upsertKeyframe(track, playhead, v);
    });
  },

  moveKeyframe(trackId, kfId, time) {
    get().commit((p) => {
      const t = p.tracks.find((x) => x.id === trackId);
      const k = t?.keyframes.find((x) => x.id === kfId);
      if (!k || !t) return;
      k.time = Math.max(0, Math.round(time));
      t.keyframes.sort((a, b) => a.time - b.time);
    }, `move.${kfId}`);
  },

  deleteKeyframe(trackId, kfId) {
    get().commit((p) => {
      const t = p.tracks.find((x) => x.id === trackId);
      if (!t) return;
      t.keyframes = t.keyframes.filter((k) => k.id !== kfId);
      if (!t.keyframes.length) p.tracks = p.tracks.filter((x) => x.id !== trackId);
    });
  },

  setEasing(trackId, kfId, easing) {
    get().commit((p) => {
      const k = p.tracks.find((x) => x.id === trackId)?.keyframes.find((x) => x.id === kfId);
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
      p.tracks = p.tracks.filter((t) => !doomed.has(t.nodeId));
      p.modifiers = p.modifiers.filter((m) => !doomed.has(m.nodeId));
    });
    set({ selection: [] });
  },

  updateNode(id, fn, label) {
    get().commit((p) => { const n = p.rig.nodes[id]; if (n) fn(n); }, label);
  },

  addBlock(presetId, index) {
    const { project } = get();
    const preset = project.presets.find((p) => p.id === presetId);
    if (!preset) return;
    const blockId = uid('b');
    const at = index ?? project.blocks.length;
    get().commit((p) => {
      const block: Block = { id: blockId, presetId, name: preset.name, durationMs: preset.durationMs };
      const next = [...p.blocks];
      next.splice(at, 0, block);
      // place tracks at the new block's start, then let relayout settle everything
      let start = 0;
      for (let i = 0; i < at; i++) start += next[i].durationMs;
      for (const t of preset.tracks) {
        p.tracks.push({
          id: uid('t'), nodeId: t.nodeId, property: t.property, blockId,
          keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + start })),
        });
      }
      const shifted = p.blocks.slice(at).map((b) => b.id);
      if (shifted.length) {
        const set2 = new Set(shifted);
        for (const t of p.tracks) if (t.blockId && set2.has(t.blockId)) for (const k of t.keyframes) k.time += preset.durationMs;
      }
      p.blocks = next;
      p.timelineDurationMs = derivedDuration(p);
    });
  },

  removeBlock(id) {
    get().commit((p) => {
      p.tracks = p.tracks.filter((t) => t.blockId !== id);
      relayoutBlocks(p, p.blocks.filter((b) => b.id !== id));
    });
  },

  setBlockDuration(id, ms) {
    get().commit((p) => {
      relayoutBlocks(p, p.blocks.map((b) => (b.id === id ? { ...b, durationMs: Math.max(60, Math.round(ms)) } : b)));
    }, `dur.${id}`);
  },

  moveBlock(id, index) {
    get().commit((p) => {
      const from = p.blocks.findIndex((b) => b.id === id);
      if (from < 0) return;
      const next = [...p.blocks];
      const [b] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, index)), 0, b);
      relayoutBlocks(p, next);
    });
  },

  setDurationMode(m) {
    get().commit((p) => {
      p.durationMode = m;
      if (m === 'even' && p.blocks.length) {
        const even = Math.round(p.blocks.reduce((s, b) => s + b.durationMs, 0) / p.blocks.length);
        relayoutBlocks(p, p.blocks.map((b) => ({ ...b, durationMs: even })));
      }
    });
  },

  addModifier(m) { get().commit((p) => { p.modifiers.push({ ...m, id: uid('m') }); }); },
  updateModifier(id, fn) { get().commit((p) => { const m = p.modifiers.find((x) => x.id === id); if (m) fn(m); }, `mod.${id}`); },
  removeModifier(id) { get().commit((p) => { p.modifiers = p.modifiers.filter((m) => m.id !== id); }); },

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
    get().commit((p) => { p.expressions.push({ id: uid('x'), name, snapshot }); });
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
      const picked = p.tracks.filter((t) => trackIds.includes(t.id));
      if (!picked.length) return;
      const start = Math.min(...picked.flatMap((t) => t.keyframes.map((k) => k.time)));
      const preset: Preset = {
        id: uid('p'), name, source: 'custom', durationMs,
        tracks: picked.map((t) => ({ id: uid('t'), nodeId: t.nodeId, property: t.property, keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time - start })) })),
      };
      p.presets.push(preset);
    });
  },

  loadProject(p) {
    const next = { ...defaultProject(), ...p };
    autosave(next);
    set({ project: next, past: [], future: [], selection: [], playhead: 0 });
  },
  resetProject() { get().loadProject(defaultProject()); },
}));

function upsertKeyframe(track: Track, time: number, value: KeyValue) {
  const at = track.keyframes.find((k) => Math.abs(k.time - time) < 1);
  if (at) { at.value = value; return; }
  track.keyframes.push({ id: uid('k'), time, value, easingOut: { type: 'preset', name: 'easeInOut' } });
  track.keyframes.sort((a, b) => a.time - b.time);
}

export function writeKeyframe(p: Project, nodeId: string, property: string, time: number, value: KeyValue, easing: EasingCurve) {
  let track = p.tracks.find((t) => t.nodeId === nodeId && t.property === property);
  if (!track) {
    track = { id: uid('t'), nodeId, property, keyframes: [] };
    p.tracks.push(track);
    // A brand-new track with one keyframe is constant *everywhere* (sampleTrack's
    // length===1 case), so writing a target value at t>0 would retroactively apply it
    // at t=0 too. Anchor the track to the value it already had, so only the segment
    // from `time` onward actually changes.
    if (time > 1) {
      const base = readProp(p.rig, nodeId, property);
      if (base !== undefined) track.keyframes.push({ id: uid('k'), time: 0, value: base, easingOut: { type: 'linear' } });
    }
  }
  const at = track.keyframes.find((k) => Math.abs(k.time - time) < 1);
  if (at) { at.value = value; at.easingOut = easing; return; }
  track.keyframes.push({ id: uid('k'), time, value, easingOut: easing });
  track.keyframes.sort((a, b) => a.time - b.time);
}

/** All keyframe times on the given tracks, deduped — for the prev/next chevrons. */
export function keyframeTimes(tracks: Track[]): number[] {
  const s = new Set<number>();
  for (const t of tracks) for (const k of t.keyframes) s.add(Math.round(k.time));
  return [...s].sort((a, b) => a - b);
}

export type { Expression, Modifier, Preset, Project, Track };
