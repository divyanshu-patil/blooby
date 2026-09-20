import { useEditor, type Editor } from '../core/store';
import { applyCalls, describe, normaliseCall, TOOL_DOCS, validateBatch, type ToolCall } from '../copilot/tools';
import { allPresets, runAgentTool, searchPresets } from '../copilot/agent';
import { critique } from '../copilot/critique';
import { ANIMATION_CRAFT } from '../copilot/craft';
import { compOf } from '../core/comp';
import { sceneAt, valueAt } from '../core/scene';
import { getProp, PROPS } from '../core/props';
import { easingLabel, EASING_NAMES } from '../core/easing';
import { EFFECTS, EFFECT_KINDS } from '../core/effects';
import { layerOrder } from '../core/layers';
import { blockStarts } from '../core/timeline';
import { activeTimeline, MODIFIERS, MODIFIER_KINDS, type Preset, type Expression, type Project } from '../core/types';
import { parseHex } from '../core/color';
import { frameSvg, contactSheetSvg, type FrameWindow } from '../export/frame';
import { actionOf, capabilities, capability, findCapabilities, registerCapabilities, summaryOf, CAPABILITY_VERSION, type Capability, type JsonSchema } from './registry';
import { changedPaths, diffProjects, isEmptyDiff, type EntityRef, type ProjectDiff } from './diff';

/**
 * One headless Studio: a project, its undo history, a playhead, a selection and a viewport —
 * the same `useEditor` store the UI runs, so a call here is literally the editor's own code.
 *
 * The store is a module singleton, so each session keeps a snapshot of the whole store and
 * swaps it in for the duration of a call, under one process-wide lock.
 * ponytail: global lock — calls from different sessions queue behind each other. Each call is
 * milliseconds; if that ever stops being true, give each session a worker with its own module.
 */

export class CapabilityError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) { super(message); this.code = code; this.details = details; }
  toJSON() { return { code: this.code, message: this.message, ...this.details }; }
}

export interface OpResult {
  ok: true;
  operationId: string;
  capability: string;
  /** the document's revision after this call */
  revision: number;
  summary: string;
  created: EntityRef[];
  deleted: EntityRef[];
  /** "layer hat: transform.scale.x" — see checkpoint_diff for from → to */
  changed: string[];
  warnings: string[];
  result?: unknown;
  dryRun?: boolean;
  /** a retry of a requestId already applied: this is the first result, nothing ran again */
  replayed?: boolean;
}

export interface OpLog { operationId: string; capability: string; ok: boolean; at: string; ms: number; summary: string; error?: string; revision: number }
export interface Checkpoint { id: string; name: string; createdAt: string; revision: number; project: Project }
export type SessionEvent = { type: 'changed'; revision: number; op: OpLog } | { type: 'op'; op: OpLog };

let tail: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

let seq = 0;
const opId = () => `op_${Date.now().toString(36)}${(seq++).toString(36)}`;
const round = (v: number) => Math.round(v * 1000) / 1000;
const clone = <T>(v: T): T => structuredClone(v);

export class EditorSession {
  private state!: Editor;
  revision = 0;
  /** the revision last written to storage; `dirty` is the difference */
  savedRevision = 0;
  readonly checkpoints = new Map<string, Checkpoint>();
  private txn: { id: string; label: string; project: Project; past: Project[]; future: Project[]; revision: number } | null = null;
  private idem = new Map<string, OpResult>();
  readonly ops: OpLog[] = [];
  /** edit-tool calls this session applied — what `critique` judges */
  readonly edits: ToolCall[] = [];
  viewport = { zoom: 1, centerX: 0, centerY: 0 };
  private listeners = new Set<(e: SessionEvent) => void>();

  /** A session on `project`, with the shared library as its catalog. */
  static async open(project: Project, library: { presets?: Preset[]; expressions?: Expression[] } = {}) {
    const s = new EditorSession();
    await s.replace(project, library);
    return s;
  }

  /** Load a document fresh — opening, or picking up someone else's newer save. History starts over. */
  async replace(project: Project, library?: { presets?: Preset[]; expressions?: Expression[] }) {
    await exclusive(() => {
      if (this.state) useEditor.setState(this.state, true);
      const ed = useEditor.getState();
      ed.loadProject(clone(project));
      if (library) useEditor.setState({ catalog: library.presets ?? [], expressionCatalog: library.expressions ?? [] });
      this.state = useEditor.getState();
    });
    const c = compOf(this.state.project);
    this.viewport = { zoom: 1, centerX: c.width / 2, centerY: c.height / 2 };
    this.txn = null;
    this.revision++;
    this.savedRevision = this.revision;
  }

  get project(): Project { return this.state.project; }
  get dirty() { return this.revision !== this.savedRevision; }
  get inTransaction() { return this.txn ? { id: this.txn.id, label: this.txn.label } : null; }

  on(fn: (e: SessionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: SessionEvent) { for (const fn of this.listeners) fn(e); }

  /** Run `fn` with this session's store swapped in. */
  private with<T>(fn: (ed: Editor) => T | Promise<T>): Promise<T> {
    return exclusive(async () => {
      useEditor.setState(this.state, true);
      try { return await fn(useEditor.getState()); } finally { this.state = useEditor.getState(); }
    });
  }

  /** Read-only access to the store, for hosts (rendering, export). */
  read<T>(fn: (ed: Editor) => T) { return this.with(fn); }

  /** Library presets the store's own addBlock may place (a catalogue preset is copied into the file when used). */
  extendCatalog(presets: Preset[]) {
    return this.with((ed) => { useEditor.setState({ catalog: [...ed.catalog, ...presets.filter((p) => !ed.catalog.some((c) => c.id === p.id))] }); });
  }

  /** The document's own name — what the dashboard shows once saved. One undoable step. */
  rename(name: string) {
    return this.with((ed) => { ed.commit((p) => { p.name = name; }, 'Rename project'); });
  }

  // ---------------------------------------------------------------------------
  // the one entry point

  async invoke(id: string, raw: Record<string, unknown> = {}, opts: { expectedRevision?: number } = {}): Promise<OpResult> {
    const cap = capability(id);
    if (!cap) {
      const near = findCapabilities({ query: id.replace(/_/g, ' ') }).slice(0, 5).map((c) => c.id);
      throw new CapabilityError('UNKNOWN_CAPABILITY', `There is no capability "${id}".`, { suggestion: near.length ? `Did you mean ${near.join(', ')}?` : 'capabilities_search lists them.' });
    }
    if (id === 'batch_execute') return this.batch(raw, opts);
    if (cap.kind === 'server') throw new CapabilityError('HOST_CAPABILITY', `${id} is handled by the server, not an editor session.`);
    const { requestId, dryRun, expectedRevision: asked, ...args } = raw as { requestId?: string; dryRun?: boolean; expectedRevision?: number } & Record<string, unknown>;
    if (requestId && this.idem.has(requestId)) return { ...this.idem.get(requestId)!, replayed: true };
    const expected = opts.expectedRevision ?? asked;
    if (cap.mutates && expected !== undefined && expected !== this.revision) {
      throw new CapabilityError('REVISION_CONFLICT', `The project is at revision ${this.revision}, not ${expected} — it changed since you last read it.`, {
        expectedRevision: expected, revision: this.revision, suggestion: 'Read editor_get_state again, then retry against the current revision.',
      });
    }
    checkArgs(cap, args);

    const started = Date.now();
    const operationId = opId();
    let before!: Project;
    let snapshot!: Editor;
    try {
      const out = await this.with(async (ed) => {
        before = ed.project;
        snapshot = ed;
        const r = await this.execute(cap, args, ed);
        const after = useEditor.getState().project;
        const diff = diffProjects(before, after);
        if (dryRun) useEditor.setState(snapshot, true);
        return { ...r, diff };
      });
      if (out.missing?.length && isEmptyDiff(out.diff)) {
        const m = out.missing[0];
        throw new CapabilityError('ENTITY_NOT_FOUND', `Nothing has the id "${m.value}" (${m.field}), so nothing changed.`, {
          field: m.field, value: m.value, suggestion: 'timeline_get lists track, keyframe and clip ids; editor_get_state lists layers and states.',
        });
      }
      const changedDoc = !isEmptyDiff(out.diff) && !dryRun;
      if (changedDoc) this.revision++;
      if (!dryRun && out.call) this.edits.push(out.call);
      const result: OpResult = {
        ok: true, operationId, capability: id, revision: this.revision, summary: out.summary,
        created: out.diff.created.slice(0, 50), deleted: out.diff.deleted.slice(0, 50), changed: changedPaths(out.diff),
        warnings: out.warnings ?? [], ...(out.result !== undefined ? { result: out.result } : {}), ...(dryRun ? { dryRun: true } : {}),
      };
      if (cap.mutates && !out.diff.created.length && !out.diff.deleted.length && !out.diff.updated.length && !dryRun && out.warnIfNoop !== false) {
        result.warnings.push('Nothing in the document changed — check the ids and values, or read the layer back with get_layer.');
      }
      const log = this.log({ operationId, capability: id, ok: true, at: new Date(started).toISOString(), ms: Date.now() - started, summary: out.summary, revision: this.revision });
      if (changedDoc) this.emit({ type: 'changed', revision: this.revision, op: log });
      if (requestId && !dryRun) { this.idem.set(requestId, result); if (this.idem.size > 500) this.idem.delete(this.idem.keys().next().value!); }
      return result;
    } catch (e) {
      const err = e instanceof CapabilityError ? e : new CapabilityError('EXECUTION_FAILED', e instanceof Error ? e.message : String(e));
      this.log({ operationId, capability: id, ok: false, at: new Date(started).toISOString(), ms: Date.now() - started, summary: '', error: err.code, revision: this.revision });
      throw err;
    }
  }

  private log(op: OpLog) {
    this.ops.push(op);
    if (this.ops.length > 1000) this.ops.shift();
    this.emit({ type: 'op', op });
    return op;
  }

  private async execute(cap: Capability, args: Record<string, unknown>, ed: Editor):
    Promise<{ summary: string; result?: unknown; warnings?: string[]; call?: ToolCall; warnIfNoop?: boolean; missing?: { field: string; value: unknown }[] }> {
    const p = ed.project;
    switch (cap.kind) {
      case 'edit': {
        const call = normaliseCall(p, { name: cap.id, args });
        const problem = validateBatch(p, [call])[0];
        if (problem) throw new CapabilityError('INVALID_ARGUMENT', problem, { capability: cap.id, suggestion: hintFor(problem) });
        const summary = describe(p, call);
        applyCalls([call]);
        return { summary, call };
      }
      case 'action': {
        const a = actionOf(cap.id)!;
        // ids that name nothing in the document — reported only if the action then changed nothing
        // (some *Id arguments are not document entities: a squish preset, an eye action, a machine name)
        const missing = a.params.filter((prm) => typeof args[prm.name] === 'string' && /Id$|^id$/.test(prm.name)
          && !idExists(p, args[prm.name] as string) && !ed.catalog.some((c) => c.id === args[prm.name]));
        const fn = (ed as unknown as Record<string, (...x: unknown[]) => unknown>)[a.action];
        const out = fn(...a.params.map((prm) => args[prm.name]));
        return {
          summary: `${a.action}(${a.params.filter((x) => args[x.name] !== undefined).map((x) => JSON.stringify(args[x.name])).join(', ').slice(0, 120)})`, result: out ?? undefined,
          missing: missing.map((m) => ({ field: m.name, value: args[m.name] })),
        };
      }
      case 'read': {
        const out = await runAgentTool({ name: cap.id, args });
        if (out && typeof out === 'object' && 'error' in out) throw new CapabilityError('NOT_FOUND', String((out as { error: unknown }).error));
        return { summary: cap.title, result: out };
      }
      case 'session': return SESSION_HANDLERS[cap.id](this, args, ed);
      default: throw new CapabilityError('HOST_CAPABILITY', `${cap.id} is handled by the server.`);
    }
  }


  /** Batches go through invoke one by one — same validation, same history — rolled back on failure. */
  private async batch(raw: Record<string, unknown>, opts: { expectedRevision?: number }): Promise<OpResult> {
    const { calls, atomic = true, dryRun } = raw as { calls: { capability: string; args?: Record<string, unknown> }[]; atomic?: boolean; dryRun?: boolean };
    if (!Array.isArray(calls) || !calls.length) throw new CapabilityError('MISSING_ARGUMENT', 'batch_execute needs a non-empty "calls" array.', { field: 'calls' });
    if (calls.length > 200) throw new CapabilityError('TOO_MANY', 'At most 200 calls per batch.', { field: 'calls', value: calls.length });
    const expected = opts.expectedRevision ?? (raw.expectedRevision as number | undefined);
    if (expected !== undefined && expected !== this.revision) {
      throw new CapabilityError('REVISION_CONFLICT', `The project is at revision ${this.revision}, not ${expected}.`, { expectedRevision: expected, revision: this.revision });
    }
    const own = !this.inTransaction && (atomic || dryRun);
    if (own) await this.invoke('transaction_begin', { label: 'batch' });
    const results: (OpResult | { ok: false; capability: string; error: unknown })[] = [];
    try {
      for (const [i, c] of calls.entries()) {
        try {
          if (c.capability === 'batch_execute') throw new CapabilityError('INVALID_ARGUMENT', 'Batches do not nest.');
          results.push(await this.invoke(c.capability, c.args ?? {}));
        } catch (e) {
          const err = e instanceof CapabilityError ? e : new CapabilityError('EXECUTION_FAILED', String(e));
          if (!atomic) { results.push({ ok: false, capability: c.capability, error: err.toJSON() }); continue; }
          err.details = { ...err.details, failedIndex: i, failedCapability: c.capability, rolledBack: true };
          throw err;
        }
      }
      if (own) await this.invoke(dryRun ? 'transaction_rollback' : 'transaction_commit', {});
    } catch (e) {
      if (own && this.inTransaction) await this.invoke('transaction_rollback', {});
      throw e;
    }
    const done = results.filter((r): r is OpResult => r.ok);
    return {
      ok: true, operationId: opId(), capability: 'batch_execute', revision: this.revision,
      summary: `${results.length} call(s)${dryRun ? ' (dry run, rolled back)' : ''}`,
      created: done.flatMap((r) => r.created), deleted: done.flatMap((r) => r.deleted), changed: done.flatMap((r) => r.changed).slice(0, 80),
      warnings: done.flatMap((r) => r.warnings),
      result: results.map((r) => (r.ok ? { capability: r.capability, ok: true, summary: r.summary, ...(r.result !== undefined ? { result: r.result } : {}) } : r)),
      ...(dryRun ? { dryRun: true } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // helpers the host uses

  /** SVG of one moment, through the viewport when asked. */
  frameSvg(atMs: number, o: { background?: string | null; viewport?: boolean } = {}) {
    return this.read((ed) => frameSvg(ed.project, atMs, o.background ?? null, o.viewport ? this.window() : undefined));
  }

  contactSheet(times: number[], o: { background?: string | null; columns?: number } = {}) {
    return this.read((ed) => contactSheetSvg(ed.project, times, o.background ?? '#ffffff', o.columns));
  }

  window(): FrameWindow {
    const c = compOf(this.project);
    const w = c.width / this.viewport.zoom, h = c.height / this.viewport.zoom;
    return { x: this.viewport.centerX - w / 2, y: this.viewport.centerY - h / 2, width: w, height: h };
  }

  /** The history depth, the transaction and what is unsaved — the bits a host adds to state. */
  status() {
    return {
      revision: this.revision, dirty: this.dirty, undo: this.state.past.length, redo: this.state.future.length,
      transaction: this.inTransaction, checkpoints: [...this.checkpoints.values()].map((c) => c.name),
    };
  }

  // used by the session handlers below
  _txn() { return this.txn; }
  _setTxn(t: EditorSession['txn']) { this.txn = t; }
}

// ---------------------------------------------------------------------------
// argument checking, from the capability's own schema

function checkArgs(cap: Capability, args: Record<string, unknown>) {
  const s = cap.inputSchema as { properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean };
  const props = s.properties ?? {};
  for (const r of s.required ?? []) {
    if (args[r] === undefined) {
      throw new CapabilityError('MISSING_ARGUMENT', `${cap.id} needs "${r}".`, { field: r, expected: Object.keys(props), suggestion: `capability_get { id: "${cap.id}" } shows every argument with its usage.` });
    }
  }
  if (s.additionalProperties === false) {
    for (const k of Object.keys(args)) {
      if (!(k in props)) throw new CapabilityError('UNKNOWN_ARGUMENT', `${cap.id} has no argument "${k}".`, { field: k, expected: Object.keys(props).filter((x) => x !== 'requestId' && x !== 'dryRun') });
    }
  }
  for (const [k, v] of Object.entries(args)) {
    const t = props[k] as { type?: string | string[]; enum?: string[] } | undefined;
    if (!t || v === undefined || v === null) continue;
    const types = Array.isArray(t.type) ? t.type : t.type ? [t.type] : [];
    const actual = Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v;
    if (types.length && !types.includes(actual) && !(types.includes('number') && actual === 'number')) {
      throw new CapabilityError('INVALID_TYPE', `"${k}" must be ${types.join(' or ')}, not ${actual}.`, { field: k, value: v });
    }
    if (t.enum && !t.enum.includes(String(v))) {
      throw new CapabilityError('INVALID_VALUE', `"${k}" must be one of: ${t.enum.join(', ')}.`, { field: k, value: v, allowed: t.enum });
    }
  }
}

/** Point a validation message at the read that fixes it. */
function hintFor(problem: string): string {
  if (/keyframe/i.test(problem)) return 'timeline_get { nodeId, property } lists the real keyframe times.';
  if (/layer|node/i.test(problem)) return 'editor_get_state or layer_find lists layer ids and names.';
  if (/property/i.test(problem)) return 'inspector_get { nodeId } lists every property that layer has.';
  if (/preset/i.test(problem)) return 'preset_search finds presets by what they do.';
  return 'capability_get shows this capability\'s arguments and usage.';
}

/** an id — or, for the `nameOrId` style arguments, a name — of something in the document */
function idExists(p: Project, id: string): boolean {
  if (p.rig.nodes[id] || id === 'camera') return true;
  if (p.timelines.some((t) => t.name === id) || Object.values(p.rig.nodes).some((n) => n.name === id)) return true;
  for (const tl of p.timelines) {
    if (tl.id === id || tl.rig?.nodes[id]) return true;
    if (tl.blocks.some((b) => b.id === id) || tl.modifiers.some((m) => m.id === id) || (tl.emitters ?? []).some((e) => e.id === id)) return true;
    for (const t of tl.tracks) if (t.id === id || t.keyframes.some((k) => k.id === id)) return true;
  }
  return p.presets.some((x) => x.id === id) || p.expressions.some((x) => x.id === id)
    || (p.stateMachine?.transitions ?? []).some((t) => t.id === id) || (p.svgAssets ?? []).some((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// session capabilities: defined here, so their schema and their code sit together

type Handler = (s: EditorSession, a: Record<string, unknown>, ed: Editor) =>
  { summary: string; result?: unknown; warnings?: string[]; warnIfNoop?: boolean } | Promise<{ summary: string; result?: unknown; warnings?: string[]; warnIfNoop?: boolean }>;

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
const num = { type: 'number' }, str = { type: 'string' }, bool = { type: 'boolean' };
const nums = { type: 'array', items: { type: 'number' } }, strs = { type: 'array', items: { type: 'string' } };
const mutation = { requestId: { type: 'string', description: 'idempotency key' }, dryRun: { type: 'boolean', description: 'report the change without making it' }, expectedRevision: { type: 'number', description: 'refuse unless still at this revision' } };

const layerBrief = (p: Project, id: string) => {
  const n = p.rig.nodes[id];
  return { id, name: n.name, kind: n.kind, parent: n.parentId, ...(n.role ? { role: n.role } : {}), zIndex: n.zIndex, ...(n.visible === false ? { hidden: true } : {}), ...(n.locked ? { locked: true } : {}), ...(n.text ? { text: n.text.content } : {}) };
};

function editorState(s: EditorSession, ed: Editor, level: string) {
  const p = ed.project, tl = activeTimeline(p);
  const minimal = {
    capabilityVersion: CAPABILITY_VERSION, project: p.name, ...s.status(), state: { id: tl.id, name: tl.name },
    playheadMs: Math.round(ed.playhead), durationMs: tl.timelineDurationMs, selection: ed.selection,
  };
  if (level === 'minimal') return minimal;
  const near = tl.tracks.flatMap((t) => t.keyframes.filter((k) => Math.abs(k.time - ed.playhead) <= 250)
    .map((k) => ({ node: t.nodeId, property: t.property, trackId: t.id, keyframeId: k.id, atMs: Math.round(k.time), value: typeof k.value === 'number' ? round(k.value) : k.value })));
  const standard = {
    ...minimal,
    composition: { ...compOf(p), fps: p.fps }, loop: tl.loop, viewport: { ...s.viewport, window: s.window() },
    states: p.timelines.map((t) => ({ id: t.id, name: t.name, durationMs: t.timelineDurationMs, active: t.id === tl.id })),
    layers: layerOrder(p.rig).map((n) => layerBrief(p, n.id)),
    clips: tl.blocks.map((b, i) => ({ id: b.id, name: b.name, startMs: Math.round(blockStarts(tl)[i]), durationMs: b.durationMs, mascot: b.mascotId })),
    keyframesNearPlayhead: near.slice(0, 40),
    inputs: ed.inputs,
  };
  if (level === 'standard') return standard;
  return { ...standard, tracks: tl.tracks.map((t) => ({ id: t.id, node: t.nodeId, property: t.property, clip: t.blockId, keys: t.keyframes.length })), modifiers: tl.modifiers, emitters: tl.emitters ?? [], machine: p.stateMachine };
}

function inspector(ed: Editor, nodeId: string, atMs: number) {
  const p = ed.project;
  const n = p.rig.nodes[nodeId] ?? Object.values(p.rig.nodes).find((x) => x.name.toLowerCase() === nodeId.toLowerCase());
  if (!n) throw new CapabilityError('ENTITY_NOT_FOUND', `No layer "${nodeId}".`, { field: 'nodeId', value: nodeId, suggestion: 'layer_find { name } or editor_get_state lists layers.' });
  const tl = activeTimeline(p);
  const controls = Object.entries(PROPS).flatMap(([path, spec]) => {
    if (spec.on !== 'node' || path.startsWith('text.char.')) return [];
    const base = getProp(n, path);
    if (base === undefined) return [];
    const tracks = tl.tracks.filter((t) => t.nodeId === n.id && t.property === path);
    const v = valueAt(p, n.id, path, atMs);
    return [{
      property: path, label: spec.label, value: typeof v === 'number' ? round(v) : v, base: typeof base === 'number' ? round(base) : base,
      animated: tracks.some((t) => t.keyframes.length > 0), keyframable: true, numeric: !!spec.range,
      ...(spec.range ? { range: { min: spec.range[0], max: spec.range[1], step: spec.range[2], unit: spec.range[3] } } : {}),
      help: spec.help,
      ...(tracks.length ? { keyframes: tracks.flatMap((t) => t.keyframes.map((k) => ({ trackId: t.id, keyframeId: k.id, atMs: Math.round(k.time), value: typeof k.value === 'number' ? round(k.value) : k.value, easing: easingLabel(k.easingOut), clip: t.blockId }))) } : {}),
    }];
  });
  return {
    layer: layerBrief(p, n.id), atMs, controls,
    effects: (n.effects ?? []).map((e) => ({ kind: e.kind, enabled: e.enabled !== false, params: e.params })),
    set: 'set_property { nodeId, property, value } sets the resting value; add set_property atMs (or add_keyframe) to animate it.',
  };
}

const distance = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

export const MCP_WORKFLOW = `
How to build good animation in Blooby, step by step:

1. LOOK — editor_get_state { level: "standard" } for the canvas, layers and states; render_frame to SEE it.
2. LEARN — preset_search for something close to the request ("jump", "wave", "squash", "particles", "text"), then
   preset_get for its real keyframes: timing, amplitude, easing. guide_get { topic: "craft" } has the numbers that
   separate animation from interpolation — read it once per task.
3. PLAN — beats with absolute times (rest → anticipate → move → overshoot → settle → hold → return).
4. ACT — small batches of edit capabilities (add_keyframe, set_property with atMs, add_layer, add_text, add_emitter…).
   Wrap a multi-step change in transaction_begin / transaction_commit; transaction_rollback undoes it all.
   checkpoint_create before anything risky.
5. CHECK — render_frame at the key times or render_sequence for a contact sheet; evaluate for exact numbers.
   critique { request } reviews the motion like a senior animator would. Fix what it names.
6. SAVE — project_save; preset_save to keep a reusable preset; export_start for Lottie / dotLottie.

Coordinates: px, +x right, +y DOWN, from the composition centre for world layers and from the body for parts.
Times are absolute ms on the active state's timeline. Every edit is undoable (history_undo).`.trim();

const GUIDES: Record<string, () => string> = {
  workflow: () => MCP_WORKFLOW,
  craft: () => ANIMATION_CRAFT.trim(),
  tools: () => TOOL_DOCS,
  properties: () => Object.entries(PROPS).filter(([, s]) => !s.group).map(([k, s]) => `${k.padEnd(28)} ${s.label}${s.range ? ` [${s.range[0]}..${s.range[1]}${s.range[3] ? ` ${s.range[3]}` : ''}]` : ''} — ${s.help}`).join('\n'),
  effects: () => [
    ...EFFECT_KINDS.map((k) => `layer effect ${k}(${Object.keys(EFFECTS[k].params).join(', ')})`),
    ...MODIFIER_KINDS.map((k) => `modifier ${k}: ${MODIFIERS[k].help}`),
  ].join('\n'),
  easing: () => `Easing names: ${EASING_NAMES.join(', ')}.`,
};

export const GUIDE_TOPICS = Object.keys(GUIDES);
export const guide = (topic: string): string | undefined => GUIDES[topic]?.();

const SESSION: (Omit<Capability, 'kind' | 'since' | 'reversible' | 'requires'> & { handler: Handler; reversible?: boolean })[] = [
  {
    id: 'editor_get_state', title: 'Editor state', category: 'agent', mutates: false, scope: 'project:read',
    description: 'Everything about the editor right now: revision, unsaved changes, undo depth, the active state, playhead, selection, composition, layers in draw order, clips, keyframes near the playhead and the viewport. level "minimal" is a few fields; "full" adds every track, modifier, emitter and the state machine.\nUsage: call first, and again whenever you are unsure — never guess.',
    inputSchema: obj({ level: { type: 'string', enum: ['minimal', 'standard', 'full'] } }),
    examples: [{ level: 'standard' }],
    handler: (s, a, ed) => ({ summary: 'Read the editor state', result: editorState(s, ed, String(a.level ?? 'standard')) }),
  },
  {
    id: 'timeline_get', title: 'Tracks and keyframes', category: 'timeline', mutates: false, scope: 'project:read',
    description: 'The active state\'s timeline with ids: duration, fps, loop, clips, and every track with its keyframes (id, atMs, value, easing). Filter by nodeId and/or property. The ids feed editor_move_keyframe, editor_delete_keyframe and editor_set_easing; the times feed add_keyframe / move_keyframe / remove_keyframe.',
    inputSchema: obj({ nodeId: str, property: str }),
    examples: [{ nodeId: 'body', property: 'transform.scale.y' }],
    handler: (_s, a, ed) => {
      const p = ed.project, tl = activeTimeline(p);
      const starts = blockStarts(tl);
      return {
        summary: 'Read the timeline',
        result: {
          state: tl.name, durationMs: tl.timelineDurationMs, fps: p.fps, loop: tl.loop,
          clips: tl.blocks.map((b, i) => ({ id: b.id, name: b.name, startMs: Math.round(starts[i]), durationMs: b.durationMs, mascot: b.mascotId })),
          tracks: tl.tracks.filter((t) => (!a.nodeId || t.nodeId === a.nodeId || p.rig.nodes[t.nodeId]?.name === a.nodeId) && (!a.property || t.property === a.property)).map((t) => ({
            id: t.id, nodeId: t.nodeId, property: t.property, clip: t.blockId,
            keyframes: t.keyframes.map((k) => ({ id: k.id, atMs: Math.round(k.time), value: typeof k.value === 'number' ? round(k.value) : k.value, easing: easingLabel(k.easingOut) })),
          })),
          modifiers: tl.modifiers.map((m) => ({ id: m.id, kind: m.kind, node: m.nodeId, startMs: m.startMs, endMs: m.endMs })),
          emitters: (tl.emitters ?? []).map((e) => ({ id: e.id, name: e.name, path: e.path, startMs: e.startMs, endMs: e.endMs })),
        },
      };
    },
  },
  {
    id: 'inspector_get', title: 'Inspector', category: 'inspector', mutates: false, scope: 'project:read',
    description: 'The inspector for one layer as semantic controls: every property it has, its value at atMs (default the playhead), resting value, range and unit, whether it is animated, its keyframes, and what it does. Set one with set_property; animate it with set_property + atMs or add_keyframe.',
    inputSchema: obj({ nodeId: str, atMs: num }, ['nodeId']),
    examples: [{ nodeId: 'body', atMs: 1250 }],
    handler: (_s, a, ed) => ({ summary: 'Read the inspector', result: inspector(ed, String(a.nodeId), typeof a.atMs === 'number' ? a.atMs : ed.playhead) }),
  },
  {
    id: 'layer_find', title: 'Find layers', category: 'layer', mutates: false, scope: 'project:read',
    description: 'Layers by name (contains, any case), kind (body, primitive, svgLayer, limb, group, text…), role (face, eyeL, armR…), words in a text layer, or colour ("#ff0000", within tolerance 0-441, default 60 — "every red layer").',
    inputSchema: obj({ name: str, kind: str, role: str, text: str, color: str, tolerance: num }),
    examples: [{ name: 'hat' }, { color: '#ff3b30' }],
    handler: (_s, a, ed) => {
      const p = ed.project;
      const target = typeof a.color === 'string' ? parseHex(a.color) : null;
      const tol = typeof a.tolerance === 'number' ? a.tolerance : 60;
      const hits = Object.values(p.rig.nodes).filter((n) =>
        (!a.name || n.name.toLowerCase().includes(String(a.name).toLowerCase()))
        && (!a.kind || n.kind === a.kind) && (!a.role || n.role === a.role)
        && (!a.text || (n.text?.content ?? '').toLowerCase().includes(String(a.text).toLowerCase()))
        && (!target || [n.color, n.stroke?.color].some((c) => c && typeof c === 'object' && 'r' in c && distance(c, target) <= tol)));
      return { summary: `Found ${hits.length} layer(s)`, result: hits.map((n) => layerBrief(p, n.id)) };
    },
  },
  {
    id: 'search', title: 'Search everything', category: 'discovery', mutates: false, scope: 'project:read',
    description: 'One search across capabilities, presets (by what their keyframes actually do), layers, properties, effects and easings. scope narrows it.',
    inputSchema: obj({ query: str, scope: { type: 'array', items: { type: 'string', enum: ['capabilities', 'presets', 'layers', 'properties', 'effects', 'easings'] } } }, ['query']),
    examples: [{ query: 'squish', scope: ['capabilities', 'presets', 'properties'] }],
    handler: (_s, a, ed) => {
      const q = String(a.query).toLowerCase();
      const scope = new Set(Array.isArray(a.scope) && a.scope.length ? a.scope.map(String) : ['capabilities', 'presets', 'layers', 'properties', 'effects', 'easings']);
      const words = q.split(/\s+/).filter(Boolean);
      const hit = (s: string) => words.some((w) => s.toLowerCase().includes(w));
      const out: Record<string, unknown> = {};
      if (scope.has('capabilities')) out.capabilities = findCapabilities({ query: q }).slice(0, 15).map(summaryOf);
      if (scope.has('presets')) out.presets = searchPresets(allPresets(), q, 10);
      if (scope.has('layers')) out.layers = Object.values(ed.project.rig.nodes).filter((n) => hit(`${n.name} ${n.kind} ${n.role ?? ''} ${n.text?.content ?? ''}`)).map((n) => layerBrief(ed.project, n.id));
      if (scope.has('properties')) out.properties = Object.entries(PROPS).filter(([k, s]) => !s.group && hit(`${k} ${s.label} ${s.help}`)).slice(0, 20).map(([k, s]) => ({ property: k, label: s.label, help: s.help }));
      if (scope.has('effects')) out.effects = [...EFFECT_KINDS.filter((k) => hit(k)).map((k) => ({ effect: k, params: Object.keys(EFFECTS[k].params), via: 'set_layer_effect' })), ...MODIFIER_KINDS.filter((k) => hit(`${k} ${MODIFIERS[k].help}`)).map((k) => ({ modifier: k, help: MODIFIERS[k].help, via: 'add_modifier' }))];
      if (scope.has('easings')) out.easings = EASING_NAMES.filter((e) => hit(e));
      return { summary: `Searched for “${a.query}”`, result: out };
    },
  },
  {
    id: 'evaluate', title: 'Evaluate frames', category: 'animation', mutates: false, scope: 'project:read',
    description: 'Where every layer is drawn at each time: x, y, w, h, rotation, alpha in composition px. The exact-numbers counterpart of render_frame — use it to check a jump peaks where planned or a loop closes. Up to 24 times.',
    inputSchema: obj({ times: nums, nodeIds: strs }, ['times']),
    examples: [{ times: [0, 600, 1250], nodeIds: ['body'] }],
    handler: (_s, a, ed) => {
      const p = ed.project;
      const ids = Array.isArray(a.nodeIds) && a.nodeIds.length ? new Set(a.nodeIds.map(String)) : null;
      const frames: Record<string, unknown> = {};
      for (const t of (a.times as number[]).filter(Number.isFinite).slice(0, 24)) {
        const scene = sceneAt(p, t, compOf(p)).filter((it) => (ids ? ids.has(it.id) : !!p.rig.nodes[it.id]));
        frames[`${Math.round(t)}ms`] = Object.fromEntries(scene.map((it) => [it.id, [round(it.cx), round(it.cy), round(it.w), round(it.h), round(it.rotation), round(it.alpha ?? it.color.a)]]));
      }
      return { summary: 'Evaluated frames', result: { columns: 'x, y, w, h, rotation, alpha', frames } };
    },
  },
  {
    id: 'playhead_set', title: 'Move the playhead', category: 'playback', mutates: false, scope: 'project:read',
    description: 'Moves the playhead. With no atMs on set_property, values land at the playhead; render_frame without atMs renders it.',
    inputSchema: obj({ atMs: num }, ['atMs']),
    handler: (_s, a, ed) => { ed.setPlayhead(Number(a.atMs)); return { summary: `Playhead at ${Math.round(Number(a.atMs))}ms`, result: { playheadMs: Math.round(useEditor.getState().playhead) }, warnIfNoop: false }; },
  },
  {
    id: 'selection_set', title: 'Select layers', category: 'selection', mutates: false, scope: 'project:read',
    description: 'Selects layers by id or name, like clicking them in the Layers panel. Store actions that act on "the selection" use it.',
    inputSchema: obj({ nodeIds: strs }, ['nodeIds']),
    handler: (_s, a, ed) => {
      const p = ed.project;
      const ids = (a.nodeIds as string[]).map((r) => (p.rig.nodes[r] ? r : Object.values(p.rig.nodes).find((n) => n.name.toLowerCase() === String(r).toLowerCase())?.id)).filter((x): x is string => !!x);
      ed.select(ids);
      return { summary: `Selected ${ids.length}`, result: { selection: ids } };
    },
  },
  {
    id: 'viewport_get', title: 'Viewport', category: 'viewport', mutates: false, scope: 'project:read',
    description: 'The view onto the canvas: zoom and centre in composition px, and the window render_frame { viewport: true } draws.',
    inputSchema: obj({}),
    handler: (s) => ({ summary: 'Read the viewport', result: { ...s.viewport, window: s.window(), composition: compOf(s.project) } }),
  },
  {
    id: 'viewport_set', title: 'Zoom, pan and focus', category: 'viewport', mutates: false, scope: 'project:read',
    description: 'zoom (0.1-8), centerX/centerY (composition px), fit: true to show the whole composition, focus: a layer id or name to frame it (padding 0-2, default 0.4).',
    inputSchema: obj({ zoom: num, centerX: num, centerY: num, fit: bool, focus: str, padding: num }),
    examples: [{ focus: 'body' }, { fit: true }, { zoom: 2 }],
    handler: (s, a, ed) => {
      const c = compOf(ed.project);
      const v = s.viewport;
      if (a.fit) Object.assign(v, { zoom: 1, centerX: c.width / 2, centerY: c.height / 2 });
      if (typeof a.focus === 'string') {
        const p = ed.project;
        const id = p.rig.nodes[a.focus] ? a.focus : Object.values(p.rig.nodes).find((n) => n.name.toLowerCase() === String(a.focus).toLowerCase())?.id;
        const it = id ? sceneAt(p, ed.playhead, c).find((x) => x.id === id) : undefined;
        if (!it) throw new CapabilityError('ENTITY_NOT_FOUND', `"${a.focus}" is not drawn at the playhead.`, { field: 'focus' });
        const pad = 1 + (typeof a.padding === 'number' ? a.padding : 0.4);
        Object.assign(v, { centerX: it.cx, centerY: it.cy, zoom: Math.min(c.width / Math.max(8, it.w * pad), c.height / Math.max(8, it.h * pad)) });
      }
      if (typeof a.zoom === 'number') v.zoom = a.zoom;
      if (typeof a.centerX === 'number') v.centerX = a.centerX;
      if (typeof a.centerY === 'number') v.centerY = a.centerY;
      v.zoom = Math.min(8, Math.max(0.1, v.zoom));
      return { summary: `Viewport ×${round(v.zoom)}`, result: { ...v, window: s.window() } };
    },
  },
  {
    id: 'history_get', title: 'Undo history', category: 'history', mutates: false, scope: 'project:read',
    description: 'How many steps can be undone and redone, the last step\'s label, the open transaction and the checkpoints.',
    inputSchema: obj({}),
    handler: (s, _a, ed) => ({ summary: 'Read history', result: { ...s.status(), lastLabel: ed.lastLabel } }),
  },
  {
    id: 'history_undo', title: 'Undo', category: 'history', mutates: true, scope: 'project:write', reversible: true,
    description: 'Undoes the last step (or `steps` of them) — exactly the editor\'s Cmd+Z.',
    inputSchema: obj({ steps: num, ...mutation }),
    handler: (_s, a, ed) => { const n = Math.max(1, Math.min(80, Number(a.steps ?? 1))); for (let i = 0; i < n; i++) useEditor.getState().undo(); void ed; return { summary: `Undid ${n} step(s)` }; },
  },
  {
    id: 'history_redo', title: 'Redo', category: 'history', mutates: true, scope: 'project:write', reversible: true,
    description: 'Redoes what was undone (or `steps` of it).',
    inputSchema: obj({ steps: num, ...mutation }),
    handler: (_s, a) => { const n = Math.max(1, Math.min(80, Number(a.steps ?? 1))); for (let i = 0; i < n; i++) useEditor.getState().redo(); return { summary: `Redid ${n} step(s)` }; },
  },
  {
    id: 'transaction_begin', title: 'Begin a transaction', category: 'history', mutates: false, scope: 'project:write',
    description: 'Marks the start of a multi-step change. transaction_rollback puts the document AND its history back exactly as they were here; transaction_commit keeps everything. One at a time.',
    inputSchema: obj({ label: str }),
    handler: (s, a, ed) => {
      if (s._txn()) throw new CapabilityError('TRANSACTION_OPEN', `Transaction "${s._txn()!.label}" is already open.`, { suggestion: 'transaction_commit or transaction_rollback it first.' });
      const id = `tx_${Date.now().toString(36)}`;
      s._setTxn({ id, label: String(a.label ?? 'transaction'), project: ed.project, past: ed.past, future: ed.future, revision: s.revision });
      return { summary: `Transaction ${id} open`, result: { transactionId: id } };
    },
  },
  {
    id: 'transaction_commit', title: 'Commit the transaction', category: 'history', mutates: false, scope: 'project:write',
    description: 'Keeps everything since transaction_begin.',
    inputSchema: obj({}),
    handler: (s) => {
      const t = s._txn();
      if (!t) throw new CapabilityError('NO_TRANSACTION', 'No transaction is open.', { suggestion: 'transaction_begin starts one.' });
      s._setTxn(null);
      return { summary: `Committed ${t.id}`, result: { transactionId: t.id } };
    },
  },
  {
    id: 'transaction_rollback', title: 'Roll back the transaction', category: 'history', mutates: true, scope: 'project:write',
    description: 'Throws away everything since transaction_begin — the document and the undo history return to exactly that moment.',
    inputSchema: obj({}),
    handler: (s) => {
      const t = s._txn();
      if (!t) throw new CapabilityError('NO_TRANSACTION', 'No transaction is open.');
      useEditor.setState({ project: t.project, past: t.past, future: t.future });
      s._setTxn(null);
      return { summary: `Rolled back ${t.id}`, result: { transactionId: t.id } };
    },
  },
  {
    id: 'checkpoint_create', title: 'Checkpoint', category: 'history', mutates: false, scope: 'project:read',
    description: 'Saves the exact document under a name ("before redesign"), for checkpoint_restore or checkpoint_diff later in this session. Same name overwrites.',
    inputSchema: obj({ name: str }, ['name']),
    handler: (s, a, ed) => {
      const name = String(a.name);
      const cp = { id: `cp_${Date.now().toString(36)}`, name, createdAt: new Date().toISOString(), revision: s.revision, project: ed.project };
      s.checkpoints.set(name, cp);
      return { summary: `Checkpoint “${name}”`, result: { id: cp.id, name, revision: cp.revision } };
    },
  },
  {
    id: 'checkpoint_list', title: 'Checkpoints', category: 'history', mutates: false, scope: 'project:read',
    description: 'Every checkpoint in this session with its time and revision.',
    inputSchema: obj({}),
    handler: (s) => ({ summary: 'Listed checkpoints', result: [...s.checkpoints.values()].map(({ project: _p, ...c }) => c) }),
  },
  {
    id: 'checkpoint_restore', title: 'Restore a checkpoint', category: 'history', mutates: true, scope: 'project:write', reversible: true,
    description: 'Puts the document back exactly as it was at the checkpoint — not regenerated, the same data. It is one undoable step, so history_undo brings the newer version back.',
    inputSchema: obj({ name: str, ...mutation }, ['name']),
    handler: (s, a, ed) => {
      const cp = s.checkpoints.get(String(a.name));
      if (!cp) throw new CapabilityError('NOT_FOUND', `No checkpoint "${a.name}".`, { suggestion: `checkpoint_list — there are: ${[...s.checkpoints.keys()].join(', ') || 'none'}.` });
      ed.restoreProject(cp.project, `Restore “${cp.name}”`);
      return { summary: `Restored “${cp.name}”` };
    },
  },
  {
    id: 'checkpoint_diff', title: 'What changed since a checkpoint', category: 'history', mutates: false, scope: 'project:read',
    description: 'A structured diff from the checkpoint to now: entities created, deleted, and every changed field with from → to.',
    inputSchema: obj({ name: str }, ['name']),
    handler: (s, a, ed) => {
      const cp = s.checkpoints.get(String(a.name));
      if (!cp) throw new CapabilityError('NOT_FOUND', `No checkpoint "${a.name}".`);
      const d: ProjectDiff = diffProjects(cp.project, ed.project, 60);
      return { summary: `Diff since “${cp.name}”`, result: d };
    },
  },
  {
    id: 'critique', title: 'Review the motion', category: 'agent', mutates: false, scope: 'project:read',
    description: 'The copilot\'s second gate, for you: reads the tracks this session wrote and says what is wrong with them AS ANIMATION — a motion the request names that nothing animates, movement too small to see, clips that do not close on their first pose, no held poses, every layer on identical frames. Pass the user\'s request in their words. Empty = nothing to fix.',
    inputSchema: obj({ request: str }, ['request']),
    examples: [{ request: 'a cute entrance where Blooby jumps in, squashes on landing and waves' }],
    handler: (s, a, ed) => {
      const notes = critique(ed.project, s.edits, String(a.request));
      return { summary: notes.length ? `${notes.length} note(s)` : 'No problems found', result: { notes } };
    },
  },
  {
    id: 'guide_get', title: 'Guides', category: 'discovery', mutates: false, scope: 'project:read',
    description: 'The knowledge the in-app copilot works from. topic "workflow": the loop to follow. "craft": timing, easing, squash and overshoot numbers for THIS rig — read before animating. "tools": every edit tool with usage. "properties": every animatable property with range and meaning. "effects": layer effects and modifiers. "easing": easing names.',
    inputSchema: obj({ topic: { type: 'string', enum: Object.keys(GUIDES) } }, ['topic']),
    handler: (_s, a) => ({ summary: `Guide: ${a.topic}`, result: GUIDES[String(a.topic)]() }),
  },
  {
    id: 'capabilities_search', title: 'Find capabilities', category: 'discovery', mutates: false, scope: 'project:read',
    description: 'What Blooby can do, filtered: by words, category, read/write. Returns ids with one-line summaries; capability_get gives one in full.',
    inputSchema: obj({ query: str, category: str, mutates: bool }),
    examples: [{ query: 'keyframe' }, { category: 'text' }],
    handler: (_s, a) => {
      const list = findCapabilities({ query: a.query as string | undefined, category: a.category as string | undefined, mutates: a.mutates as boolean | undefined });
      return { summary: `${list.length} capabilities`, result: { capabilityVersion: CAPABILITY_VERSION, count: list.length, capabilities: list.map(summaryOf) } };
    },
  },
  {
    id: 'capability_get', title: 'One capability in full', category: 'discovery', mutates: false, scope: 'project:read',
    description: 'A capability\'s full description with usage, its argument schema, scope, what it requires and examples.',
    inputSchema: obj({ id: str }, ['id']),
    handler: (_s, a) => {
      const c = capability(String(a.id));
      if (!c) throw new CapabilityError('UNKNOWN_CAPABILITY', `No capability "${a.id}".`, { suggestion: 'capabilities_search { query }' });
      return { summary: c.id, result: c };
    },
  },
  {
    id: 'batch_execute', title: 'Run many calls', category: 'agent', mutates: true, scope: 'project:write',
    description: 'Runs capability calls in order, each validated and applied exactly as if called alone. atomic (default true): if one fails, everything in the batch is rolled back and the failing call is named. Up to 200 calls.',
    inputSchema: obj({ calls: { type: 'array', items: { type: 'object', properties: { capability: str, args: { type: 'object' } }, required: ['capability'] } }, atomic: bool, ...mutation }, ['calls']),
    examples: [{ calls: [{ capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 0, value: 0 } }, { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 400, value: -80, easing: 'easeOut' } }] }],
    handler: () => { throw new CapabilityError('HOST_CAPABILITY', 'batch_execute is run by EditorSession.batch'); },
  },
];

const SESSION_HANDLERS: Record<string, Handler> = Object.fromEntries(SESSION.map((c) => [c.id, c.handler]));

/** Discovery and the guides answer before a project is open — a host may run them on a scratch document. */
const WITHOUT_PROJECT = new Set(['capabilities_search', 'capability_get', 'guide_get', 'search']);

registerCapabilities(SESSION.map(({ handler: _h, ...c }) => ({
  ...c, kind: 'session', since: '1.0.0', reversible: c.reversible ?? false,
  requires: WITHOUT_PROJECT.has(c.id) ? [] : ['project'],
})));

export { capabilities };
