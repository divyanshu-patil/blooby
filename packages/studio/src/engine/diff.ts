import type { Project } from '../core/types';

/**
 * What changed between two versions of a document, entity by entity — so an agent (or a
 * person reviewing what one did) reads "layer hat: transform.scale.x 1 → 1.2" instead of
 * guessing from a before/after dump.
 *
 * Entities are keyed by their own ids, which survive every commit (commit clones; it never
 * re-ids). Layers are keyed per state, because every timeline owns its layers.
 */

export interface EntityRef { type: string; id: string; name?: string; state?: string }
export interface EntityChange extends EntityRef { changes: Record<string, { from: unknown; to: unknown }> }
export interface ProjectDiff { created: EntityRef[]; deleted: EntityRef[]; updated: EntityChange[] }

type Entry = { ref: EntityRef; data: unknown };

/** Every addressable thing in a project, flat. */
export function entities(p: Project): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const put = (ref: EntityRef, data: unknown) => out.set(`${ref.type}:${ref.state ? `${ref.state}/` : ''}${ref.id}`, { ref, data });

  put({ type: 'composition', id: 'composition' }, { width: p.composition?.width, height: p.composition?.height, fps: p.fps, name: p.name });
  for (const tl of p.timelines) {
    const rig = tl.id === p.activeTimelineId ? p.rig : tl.rig;
    const { rig: _r, tracks, blocks, modifiers, emitters, ...rest } = tl as typeof tl & { rig?: unknown };
    put({ type: 'state', id: tl.id, name: tl.name }, rest);
    for (const n of Object.values(rig?.nodes ?? {})) put({ type: 'layer', id: n.id, name: n.name, state: tl.id }, n);
    for (const b of blocks) put({ type: 'clip', id: b.id, name: b.name, state: tl.id }, b);
    for (const m of modifiers) put({ type: 'modifier', id: m.id, name: m.kind, state: tl.id }, m);
    for (const e of emitters ?? []) put({ type: 'emitter', id: e.id, name: e.name, state: tl.id }, e);
    for (const t of tracks) {
      const { keyframes, ...track } = t;
      const name = `${t.nodeId}.${t.property}`;
      put({ type: 'track', id: t.id, name, state: tl.id }, track);
      for (const k of keyframes) put({ type: 'keyframe', id: k.id, name: `${name}@${Math.round(k.time)}ms`, state: tl.id }, k);
    }
  }
  for (const pr of p.presets) put({ type: 'preset', id: pr.id, name: pr.name }, pr);
  for (const e of p.expressions) put({ type: 'expression', id: e.id, name: e.name }, e);
  for (const i of p.stateMachine?.inputs ?? []) put({ type: 'input', id: i.name, name: i.name }, i);
  for (const t of p.stateMachine?.transitions ?? []) put({ type: 'transition', id: t.id }, t);
  return out;
}

/** Leaf values by dotted path, arrays kept whole — "points changed" beats forty index paths. */
function flat(v: unknown, path = '', out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v) && depth < 5) {
    for (const [k, x] of Object.entries(v)) flat(x, path ? `${path}.${k}` : k, out, depth + 1);
  } else out[path] = v;
  return out;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function diffProjects(before: Project, after: Project, limitPerEntity = 30): ProjectDiff {
  if (before === after) return { created: [], deleted: [], updated: [] };
  const a = entities(before), b = entities(after);
  const diff: ProjectDiff = { created: [], deleted: [], updated: [] };
  for (const [key, e] of b) if (!a.has(key)) diff.created.push(e.ref);
  for (const [key, e] of a) if (!b.has(key)) diff.deleted.push(e.ref);
  for (const [key, e] of b) {
    const old = a.get(key);
    if (!old || same(old.data, e.data)) continue;
    const fa = flat(old.data), fb = flat(e.data);
    const changes: EntityChange['changes'] = {};
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (!same(fa[k], fb[k]) && Object.keys(changes).length < limitPerEntity) changes[k] = { from: fa[k], to: fb[k] };
    }
    if (Object.keys(changes).length) diff.updated.push({ ...e.ref, changes });
  }
  return diff;
}

/** "layer hat.transform.scale.x" lines — the compact form for an operation's `changed`. */
export const changedPaths = (d: ProjectDiff, max = 40) =>
  d.updated.flatMap((u) => Object.keys(u.changes).map((k) => `${u.type} ${u.name ?? u.id}: ${k}`)).slice(0, max);

export const isEmptyDiff = (d: ProjectDiff) => !d.created.length && !d.deleted.length && !d.updated.length;
