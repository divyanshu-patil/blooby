import storeSource from '../core/store.ts?raw';
import { useEditor, type RailTab } from '../core/store';
import { chatJson, type ChatMessage } from './client';
import { applyCalls, describe, normaliseCall, TOOL_DOCS, TOOL_NAMES, validateBatch, type ToolCall } from './tools';
import { systemPrompt } from './prompt';
import { critique } from './critique';
import { extractJson, closeTruncated } from './parse';
import { sceneAt, valueAt } from '../core/scene';
import { compOf } from '../core/comp';
import { easingLabel } from '../core/easing';
import { resolveProp } from '../core/props';
import { layerOrder } from '../core/layers';
import { blockStarts } from '../core/timeline';
import { activeTimeline, type Preset, type Project, type RigNode } from '../core/types';
import type { CopilotSettings, KeyStatus } from './pool';

/**
 * The copilot as an agent: think → inspect → act → observe → adjust → finish.
 *
 * Every step the model sends a short status and a batch of calls. Edits go through the very
 * same `applyCalls` the one-shot copilot used — the editor's own layer and keyframe
 * functions, each a real undo step the user watches land. Reads and UI moves are answered
 * here and returned as RESULTS for the next step, so the model works from what the editor
 * actually holds rather than from what it assumed it wrote.
 *
 * Nothing the model knows about presets or editor functions is written into its prompt by
 * hand: `search_presets` / `get_preset` read the preset data itself, and `find_functions`
 * reads the store's own `Editor` interface source and the tool docs.
 */

/** A safety stop against a model that never calls finish — tokens are shown, never capped. */
export const DEFAULT_MAX_STEPS = 40;

// ---------------------------------------------------------------------------
// the agent's own tools: reading, observing and moving the UI

export const AGENT_TOOL_DOCS = `
find_functions        { query? }                               // what you can do: every edit tool's docs and every
                      // editor action (the store's real functions), filtered by a word. Call before guessing.
call_editor           { action, args?: [] }                    // run an editor action from find_functions directly,
                      // e.g. { action: "setFaceRole", args: ["plate", true] }. Prefer the edit tools when one fits.
search_presets        { query, limit? }                        // presets whose DATA matches: "squash", "hand wave",
                      // "path drawing", "curved text", "multiple mascots", "empty state"… Returns ids and tags.
get_preset            { preset }                               // one preset's actual layers, tracks and keyframes
                      // [ms, value, easing], effects and ranges — learn timing and amplitude from it.
inspect_project       { }                                      // the project NOW: layers, states, clips, tracks
get_layer             { nodeId }                               // one layer's settings and every keyframe on it
get_values            { nodeId, properties: [], atMs }         // what those properties evaluate to at that time
preview               { times: [ms…], nodeIds? }               // scrubs the playhead through the times (the user sees it)
                      // and returns where each layer is drawn: x, y, w, h, rotation, alpha. How you CHECK your work.
play                  { fromMs?, toMs? }                       // plays that span on the stage for the user (max 6s)
get_editor_state      { }                                      // playhead, selection, open tab, active state
set_playhead          { atMs }
select_layers         { nodeIds: [] }                          // selects on the stage and in the inspector
open_tab              { tab: "node"|"eyes"|"fx"|"states"|"ai"|"mcp" }// the right-hand inspector tab
finish                { summary }                              // end the run with one or two sentences for the user`.trim();

const AGENT_NAMES = ['find_functions', 'call_editor', 'search_presets', 'get_preset', 'inspect_project', 'get_layer',
  'get_values', 'preview', 'play', 'get_editor_state', 'set_playhead', 'select_layers', 'open_tab', 'finish'] as const;
const AGENT_SET = new Set<string>(AGENT_NAMES);
const UI_TOOLS = new Set(['preview', 'play', 'set_playhead', 'select_layers', 'open_tab', 'call_editor']);

export const AGENT_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string' },
    status: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string', enum: [...TOOL_NAMES, ...AGENT_NAMES] }, args: { type: 'object' } },
        required: ['name', 'args'],
      },
    },
    done: { type: 'boolean' },
  },
  required: ['plan', 'status', 'calls', 'done'],
} as const;

export function agentProtocol(steps: number): string {
  return `YOU ARE RUNNING AS AN AGENT inside the live editor, in steps. Every step, answer with ONE
JSON object and nothing else:
  {
    "plan": "<private scratch: what you know so far and what this step is for — never shown>",
    "status": "<under 12 words, shown live to the user: what this step does>",
    "calls": [ { "name": "<tool>", "args": { … } } ],
    "done": false
  }
Calls run in order and EVERY result comes back to you as RESULTS before your next step. Edit
tools change the real editor at once, each one undoable; the user watches them land.

Work like this, and never assume the first attempt is right:
  1. INSPECT — inspect_project / get_layer for what is there; search_presets then get_preset
     for how existing animation that does something similar is timed, how far it moves and
     which easing it uses. Learn from the numbers; do not copy a preset unless asked.
  2. ACT in small batches — a few tracks or layers per step, not everything at once.
  3. OBSERVE — preview at the key times (or get_values) and compare the numbers with your intent.
  4. ADJUST what is off, preview again.
  5. FINISH — call finish { summary } with "done": true once it is verified.
The Keyframes list in this prompt is a snapshot from the START of the run. Once you have edited,
keyframe times have moved: get_layer returns the current ones — read it before move_keyframe.
nodeId is a layer id ("body"), property is a path ("transform.scale.x"); never join them.
A follow-up ("slower", "bigger") EDITS what is there: inspect it, then move or rescale those
keyframes — never rebuild from nothing. A plain question is answered with finish.
Edit through the edit tools; find_functions lists the editor's actions when none fits.
Take the steps the animation needs (up to ${steps}); ask for each piece of data once.

Agent tools (reading, observing, moving the UI):
${AGENT_TOOL_DOCS}

Edit tools follow.`;
}

// ---------------------------------------------------------------------------
// discovery: the editor's real functions, from its own source

interface Fn { name: string; signature: string; doc: string }

/** Every action on the store, with its parameters and doc comment, read from `interface Editor`. */
export function editorFunctions(): Fn[] {
  const start = storeSource.indexOf('export interface Editor {');
  const body = start < 0 ? '' : storeSource.slice(start, storeSource.indexOf('\n}', start));
  const out: Fn[] = [];
  let doc = '';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('//')) {
      doc += ` ${line.replace(/^\/\*\*|\*\/$|^\*|^\/\//g, '').trim()}`;
      continue;
    }
    const m = /^(\w+)\??:\s*(\(.*)$/.exec(line);
    if (m) out.push({ name: m[1], signature: `${m[1]}${m[2].replace(/;$/, '')}`, doc: doc.trim() });
    doc = '';
  }
  const live = useEditor.getState() as unknown as Record<string, unknown>;
  return out.filter((f) => typeof live[f.name] === 'function');
}

/** The edit tools' own doc blocks, one per tool, from TOOL_DOCS. */
function toolBlocks(): { name: string; text: string }[] {
  const blocks: { name: string; text: string }[] = [];
  for (const line of TOOL_DOCS.split('\n')) {
    const m = /^([a-z_]+)\s+\{/.exec(line);
    if (m) blocks.push({ name: m[1], text: line });
    else if (blocks.length && /^\s/.test(line)) blocks[blocks.length - 1].text += `\n${line}`;
  }
  return blocks;
}

function findFunctions(query: string): string {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (s: string) => !words.length || words.some((w) => s.toLowerCase().includes(w));
  const tools = toolBlocks().filter((b) => hit(b.text)).map((b) => b.text);
  const actions = editorFunctions().filter((f) => hit(`${f.signature} ${f.doc}`)).map((f) => `${f.signature}${f.doc ? ` — ${f.doc}` : ''}`);
  return `EDIT TOOLS (${tools.length}):\n${tools.join('\n') || '(none match)'}\n\nEDITOR ACTIONS for call_editor (${actions.length}):\n${actions.join('\n') || '(none match)'}`;
}

/** Actions that would throw the document or the history away — never the agent's to call. */
const FORBIDDEN = new Set(['loadProject', 'resetProject', 'commit', 'restoreProject', 'undo', 'redo', 'loadCatalog']);

// ---------------------------------------------------------------------------
// presets as data

const DRAW_WORDS = ['draw', 'draw-on', 'path drawing', 'trim', 'reveal line'];

/** What a preset actually does, read off its tracks, layers and effects — never its name alone. */
export function presetTags(p: Preset): string[] {
  const tags = new Set<string>();
  const props = new Set(p.tracks.map((t) => t.property));
  const nodes = new Set(p.tracks.map((t) => t.nodeId));
  const layers = p.layers ?? [];
  const role = (id: string) => layers.find((l) => l.id === id)?.role ?? id;
  const span = (nodeId: string, prop: string) => {
    const vs = p.tracks.filter((t) => t.nodeId === nodeId && t.property === prop).flatMap((t) => t.keyframes.map((k) => k.value)).filter((v): v is number => typeof v === 'number');
    return vs.length ? Math.max(...vs) - Math.min(...vs) : 0;
  };
  for (const t of p.tracks) {
    const r = role(t.nodeId);
    if (/^arm|hand/i.test(r) || layers.find((l) => l.id === t.nodeId)?.limb?.type === 'arm') tags.add('hand').add('arm').add('gesture');
    if (/^leg/i.test(r) || layers.find((l) => l.id === t.nodeId)?.limb?.type === 'leg') tags.add('leg').add('feet').add('walk');
    if (/^eye/.test(r)) tags.add('eyes');
    if (t.nodeId === 'face' || r === 'face') tags.add('face');
    if (t.property === 'eye.openness' && t.keyframes.some((k) => typeof k.value === 'number' && k.value < 0.3)) tags.add('blink');
    if (t.property.startsWith('squish.')) tags.add('squish').add('squash').add('stretch');
    if (t.property.startsWith('trim.')) DRAW_WORDS.forEach((w) => tags.add(w));
    if (t.property.startsWith('text.')) tags.add('text').add('words');
    if (t.property === 'shape.path') tags.add('morph').add('shape');
    if (t.property === 'transform.rotation') tags.add('tilt').add('rotate');
    if (t.property === 'surface.yaw' || t.property === 'surface.pitch') tags.add('look').add('turn');
    if (t.property === 'visible' || t.property === 'opacity') tags.add('fade').add('appear');
  }
  for (const n of nodes) {
    if (span(n, 'transform.scale.x') > 0.04 && span(n, 'transform.scale.y') > 0.04) tags.add('squash').add('stretch');
    if (span(n, 'flatOffset.y') > 10) tags.add('bounce').add('jump').add('move');
    if (span(n, 'flatOffset.x') > 20) tags.add('slide').add('move');
  }
  if (props.has('transform.scale.x') && props.has('transform.scale.y') && [...nodes].some((n) => n !== 'body' && span(n, 'transform.scale.x') > 0.2)) tags.add('pop');
  for (const l of layers) {
    if (l.kind === 'body') tags.add('multiple mascots').add('friends').add('mascots');
    if (l.kind === 'text') { tags.add('text').add('words'); if (l.text?.path?.mode === 'arc') tags.add('curved text').add('arc'); if (l.text?.path?.mode === 'path') tags.add('text on path').add('path'); }
    if (l.curve) tags.add('curve').add('path');
    if (l.kind === 'svgLayer') tags.add('svg').add('sticker').add('icon');
    if (l.kind === 'primitive') tags.add('shape');
    if (l.kind === 'limb') tags.add(l.limb?.type === 'leg' ? 'leg' : 'hand');
  }
  for (const m of p.modifiers ?? []) tags.add(m.kind).add('effect');
  for (const e of p.emitters ?? []) tags.add('particles').add(e.name.toLowerCase());
  return [...tags];
}

const SYNONYMS: Record<string, string[]> = {
  squish: ['squash', 'stretch'], squash: ['squish', 'stretch'], wave: ['hand', 'hello', 'hi'], hand: ['arm', 'wave'],
  empty: ['no', 'nothing', 'empty state'], search: ['magnifier', 'magnifying', 'find'], cute: ['happy', 'bounce'],
  drawing: ['draw', 'trim'], draw: ['trim', 'path drawing'], mascots: ['multiple mascots', 'friends'],
};

export function allPresets(): Preset[] {
  const { project, catalog } = useEditor.getState();
  const seen = new Set<string>();
  return [...project.presets, ...catalog].filter((p) => !seen.has(p.id) && seen.add(p.id));
}

export function searchPresets(presets: Preset[], query: string, limit = 8) {
  const words = query.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 1);
  // the words asked for count fully; their synonyms count for less, so "squish" ranks squish tracks first
  const terms = new Map<string, number>();
  for (const w of words) for (const s of SYNONYMS[w] ?? []) terms.set(s, Math.max(terms.get(s) ?? 0, 0.4));
  for (const w of words) terms.set(w, 1);
  return presets.map((p) => {
    const tags = presetTags(p);
    const name = p.name.toLowerCase(), line = `${p.tagline ?? ''} ${p.id}`.toLowerCase(), tagText = tags.join(' ');
    let score = 0;
    for (const [t, wt] of terms) score += wt * ((name.includes(t) ? 3 : 0) + (line.includes(t) ? 2 : 0) + (tagText.includes(t) ? 2 : 0));
    return { p, tags, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ p, tags }) => ({ id: p.id, name: p.name, tagline: p.tagline, durationMs: p.durationMs, tracks: p.tracks.length, layers: (p.layers ?? []).length, tags }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const short = (v: unknown) => (typeof v === 'number' ? round(v) : typeof v === 'string' ? (v.length > 28 ? `${v.slice(0, 26)}…` : v) : v);

export function presetData(p: Preset) {
  return {
    id: p.id, name: p.name, tagline: p.tagline, durationMs: p.durationMs,
    layers: (p.layers ?? []).map(layerBrief),
    tracks: p.tracks.map((t) => ({ node: t.nodeId, prop: t.property, keys: t.keyframes.map((k) => [Math.round(k.time), short(k.value), easingLabel(k.easingOut)]) })),
    ...(p.modifiers?.length ? { modifiers: p.modifiers.map((m) => ({ kind: m.kind, node: m.nodeId, amount: m.amount, frequency: m.frequency, amplitude: m.amplitude, startMs: m.startMs, endMs: m.endMs })) } : {}),
    ...(p.emitters?.length ? { emitters: p.emitters.map((e) => ({ name: e.name, path: e.path, from: e.from, to: e.to, startMs: e.startMs, endMs: e.endMs })) } : {}),
    ...(p.appearances?.length ? { appearances: p.appearances.map((a) => [a.nodeId, a.startMs ?? 0, a.endMs ?? p.durationMs]) } : {}),
  };
}

function layerBrief(n: RigNode) {
  return {
    id: n.id, name: n.name, kind: n.kind, parent: n.parentId, ...(n.role ? { role: n.role } : {}),
    at: [round(n.surface.flatOffset?.x ?? 0), round(n.surface.flatOffset?.y ?? 0)],
    ...(n.surface.mapped ? { yaw: n.surface.yaw, pitch: n.surface.pitch } : {}),
    ...(n.text ? { text: n.text.content, textPath: n.text.path?.mode } : {}),
    ...(n.limb ? { limb: n.limb.type, points: { a: n.limb.a, b: n.limb.b, ...(n.limb.c ? { c: n.limb.c } : {}) }, ...(n.limb.pin ? { pinned: n.limb.pin } : {}) } : {}),
    ...(n.curve ? { curve: n.curve.type } : {}),
    ...(n.anchor ? { anchor: n.anchor } : {}),
    ...(n.squish ? { squish: n.squish } : {}),
    ...(n.trim ? { trim: n.trim } : {}),
    ...(n.ranged ? { ranged: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// answering a read or UI call

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

function inspectProject(p: Project) {
  const tl = activeTimeline(p);
  const starts = blockStarts(tl);
  return {
    composition: compOf(p), fps: p.fps,
    states: p.timelines.map((t) => ({ id: t.id, name: t.name, durationMs: t.timelineDurationMs, loop: t.loop, active: t.id === tl.id })),
    layers: layerOrder(p.rig).map(layerBrief),
    clips: tl.blocks.map((b, i) => ({ id: b.id, name: b.name, startMs: Math.round(starts[i]), durationMs: b.durationMs, mascot: b.mascotId })),
    tracks: tl.tracks.map((t) => ({ node: t.nodeId, prop: t.property, clip: t.blockId, keys: t.keyframes.length, fromMs: Math.round(t.keyframes[0]?.time ?? 0), toMs: Math.round(t.keyframes.at(-1)?.time ?? 0) })),
    machine: p.stateMachine ? { inputs: p.stateMachine.inputs, rules: p.stateMachine.transitions.map((t) => ({ from: t.from, to: t.to, when: t.conditions })) } : undefined,
  };
}

export async function runAgentTool(call: ToolCall, signal?: AbortSignal): Promise<unknown> {
  const ed = useEditor.getState();
  const a = call.args ?? {};
  const p = ed.project;
  switch (call.name) {
    case 'find_functions': return findFunctions(String(a.query ?? ''));
    case 'call_editor': {
      const action = String(a.action ?? '');
      const fn = (ed as unknown as Record<string, unknown>)[action];
      if (FORBIDDEN.has(action)) return { error: `${action} is not available to the copilot` };
      if (typeof fn !== 'function' || !editorFunctions().some((f) => f.name === action)) return { error: `no editor action "${action}" — find_functions lists them` };
      const out = (fn as (...x: unknown[]) => unknown)(...(Array.isArray(a.args) ? a.args : []));
      return { ok: true, returned: out === undefined ? null : out };
    }
    case 'search_presets': return searchPresets(allPresets(), String(a.query ?? ''), Math.min(20, Number(a.limit) || 8));
    case 'get_preset': {
      const ref = String(a.preset ?? '').toLowerCase();
      const preset = allPresets().find((x) => x.id.toLowerCase() === ref || x.name.toLowerCase() === ref);
      return preset ? presetData(preset) : { error: `no preset "${a.preset}" — search_presets first` };
    }
    case 'inspect_project': return inspectProject(p);
    case 'get_layer': {
      const n = p.rig.nodes[String(a.nodeId)] ?? Object.values(p.rig.nodes).find((x) => x.name === a.nodeId);
      if (!n) return { error: `no layer "${a.nodeId}"` };
      const tl = activeTimeline(p);
      return {
        ...layerBrief(n), size: n.size, scale: n.transform.scale, rotation: n.transform.rotation, opacity: n.opacity ?? 1, color: n.color,
        tracks: tl.tracks.filter((t) => t.nodeId === n.id).map((t) => ({ prop: t.property, clip: t.blockId, keys: t.keyframes.map((k) => [Math.round(k.time), short(k.value), easingLabel(k.easingOut)]) })),
      };
    }
    case 'get_values': {
      const at = Number(a.atMs ?? ed.playhead);
      const props = Array.isArray(a.properties) ? a.properties : [a.properties];
      return Object.fromEntries(props.map((raw) => {
        const prop = resolveProp(raw) ?? String(raw);
        return [prop, short(valueAt(p, String(a.nodeId), prop, at))];
      }));
    }
    case 'preview': {
      const times = (Array.isArray(a.times) ? a.times : [ed.playhead]).map(Number).filter(Number.isFinite).slice(0, 12);
      const ids = Array.isArray(a.nodeIds) && a.nodeIds.length ? new Set(a.nodeIds.map(String)) : null;
      const out: Record<string, unknown> = {};
      for (const t of times) {
        useEditor.getState().setPlayhead(t);
        const scene = sceneAt(p, t, compOf(p)).filter((s) => (ids ? ids.has(s.id) : !!p.rig.nodes[s.id])).slice(0, 16);
        out[`${Math.round(t)}ms`] = Object.fromEntries(scene.map((s) => [s.id, [round(s.cx), round(s.cy), round(s.w), round(s.h), round(s.rotation), round(s.alpha ?? s.color.a)]]));
        await wait(140, signal);
      }
      return { columns: 'x, y, w, h, rotation, alpha — screen px', frames: out };
    }
    case 'play': {
      const from = Math.max(0, Number(a.fromMs ?? 0));
      const to = Math.max(from + 100, Number(a.toMs ?? activeTimeline(p).timelineDurationMs));
      ed.setPlayhead(from);
      ed.setPlaying(true);
      try { await wait(Math.min(6000, to - from), signal); } finally { useEditor.getState().setPlaying(false); }
      return { played: [from, Math.min(to, from + 6000)] };
    }
    case 'get_editor_state': return {
      playheadMs: Math.round(ed.playhead), selection: ed.selection, tab: ed.railTab, playing: ed.playing,
      state: activeTimeline(p).name, durationMs: activeTimeline(p).timelineDurationMs,
    };
    case 'set_playhead': ed.setPlayhead(Number(a.atMs) || 0); return { playheadMs: Math.round(useEditor.getState().playhead) };
    case 'select_layers': {
      const ids = (Array.isArray(a.nodeIds) ? a.nodeIds : [a.nodeIds]).map(String).filter((id) => p.rig.nodes[id]);
      ed.select(ids);
      ed.setRailTab('node');
      return { selected: ids };
    }
    case 'open_tab': {
      const tab = String(a.tab) as RailTab;
      if (!['node', 'eyes', 'fx', 'states', 'ai', 'mcp'].includes(tab)) return { error: 'tab is node, eyes, fx, states, ai or mcp' };
      ed.setRailTab(tab);
      return { tab };
    }
    case 'finish': return { finished: true };
  }
  return { error: `unknown tool ${call.name}` };
}

/** What the user reads for one call, in the activity list. */
export function actionLabel(p: Project, call: ToolCall): string {
  const a = call.args ?? {};
  switch (call.name) {
    case 'find_functions': return `Looking up editor functions${a.query ? ` for “${a.query}”` : ''}`;
    case 'call_editor': return `Running ${a.action}`;
    case 'search_presets': return `Searching presets: “${a.query}”`;
    case 'get_preset': return `Inspecting “${allPresets().find((x) => x.id === a.preset || x.name === a.preset)?.name ?? a.preset}”`;
    case 'inspect_project': return 'Reading the project';
    case 'get_layer': return `Reading ${p.rig.nodes[String(a.nodeId)]?.name ?? a.nodeId}`;
    case 'get_values': return `Reading ${p.rig.nodes[String(a.nodeId)]?.name ?? a.nodeId} at ${Math.round(Number(a.atMs) || 0)}ms`;
    case 'preview': return `Previewing ${(Array.isArray(a.times) ? a.times : []).map((t) => `${(Number(t) / 1000).toFixed(2)}s`).join(', ')}`;
    case 'play': return 'Playing it back';
    case 'get_editor_state': return 'Checking the editor';
    case 'set_playhead': return `Moving playhead to ${(Number(a.atMs) / 1000).toFixed(2)}s`;
    case 'select_layers': return `Selecting ${(Array.isArray(a.nodeIds) ? a.nodeIds : [a.nodeIds]).map((id) => p.rig.nodes[String(id)]?.name ?? id).join(', ')}`;
    case 'open_tab': return `Opening the ${a.tab} tab`;
    case 'finish': return 'Done';
  }
  return describe(p, call);
}

// ---------------------------------------------------------------------------
// the loop

export interface AgentEvent { kind: 'status' | 'read' | 'ui' | 'edit' | 'error'; text: string }
export interface AgentReport { reply: string; edits: ToolCall[]; steps: number; usage: { input: number; output: number }; ended: 'done' | 'steps' }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [cut]` : s);

/** Older step exchanges shortened, so a long run does not resend every early result in full. */
function compact(messages: ChatMessage[], keepFrom: number, recent = 10): ChatMessage[] {
  const cut = Math.max(keepFrom, messages.length - recent);
  return messages.map((m, i) => (i >= keepFrom && i < cut ? { ...m, content: clip(m.content, 280) } : m));
}

export async function runAgent(o: {
  settings: CopilotSettings; request: string; history: ChatMessage[]; made: string[];
  signal: AbortSignal; onEvent: (e: AgentEvent) => void; onUsage: (u: { input: number; output: number }, steps: number) => void;
  markKey: (key: string, status: KeyStatus, note?: string) => void;
}): Promise<AgentReport> {
  const maxSteps = o.settings.maxSteps ?? DEFAULT_MAX_STEPS;
  const start = useEditor.getState();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(start.project, o.made, start.playhead, agentProtocol(maxSteps)) },
    ...o.history,
    { role: 'user', content: o.request },
  ];
  const keepFrom = messages.length;
  const usage = { input: 0, output: 0 };
  const edits: ToolCall[] = [];
  let critiqued = false;

  for (let step = 1; step <= maxSteps; step++) {
    if (o.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // live: every streamed token lands in the count as it arrives, then the step's real totals replace it
    const res = await chatJson(o.settings, compact(messages, keepFrom), AGENT_SCHEMA, o.markKey, o.signal, {
      numCtx: 32768,
      onTokens: (n) => o.onUsage({ input: usage.input, output: usage.output + n }, step),
    });
    usage.input += res.usage.input;
    usage.output += res.usage.output;
    o.onUsage({ ...usage }, step);
    messages.push({ role: 'assistant', content: clip(res.content, 4000) });

    let turn: { status?: string; calls?: ToolCall[]; done?: boolean };
    try {
      const { json, closed } = extractJson(res.content);
      turn = JSON.parse(closed ? json : closeTruncated(json));
    } catch {
      o.onEvent({ kind: 'error', text: 'Unreadable reply — asking again' });
      messages.push({ role: 'user', content: 'That was not one valid JSON object. Answer with {"plan","status","calls","done"} only.' });
      continue;
    }
    if (turn.status) o.onEvent({ kind: 'status', text: String(turn.status).slice(0, 120) });

    const results: unknown[] = [];
    let finished: string | null = null;
    for (const raw of Array.isArray(turn.calls) ? turn.calls : []) {
      if (o.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const call: ToolCall = { name: String(raw?.name ?? ''), args: raw?.args && typeof raw.args === 'object' ? raw.args : {} };
      const project = useEditor.getState().project;
      if (AGENT_SET.has(call.name)) {
        o.onEvent({ kind: UI_TOOLS.has(call.name) ? 'ui' : 'read', text: actionLabel(project, call) });
        try {
          const out = await runAgentTool(call, o.signal);
          results.push({ tool: call.name, result: out });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          results.push({ tool: call.name, error: e instanceof Error ? e.message : String(e) });
        }
        if (call.name === 'finish') finished = String(call.args.summary ?? '');
        continue;
      }
      if (!(TOOL_NAMES as readonly string[]).includes(call.name)) {
        results.push({ tool: call.name, error: 'no such tool — find_functions lists them' });
        continue;
      }
      const c = normaliseCall(project, call);
      const problem = validateBatch(project, [c])[0];
      if (problem) {
        o.onEvent({ kind: 'error', text: `${call.name}: ${problem}` });
        results.push({ tool: call.name, error: problem });
        continue;
      }
      const label = describe(project, c);
      applyCalls([c]);
      edits.push(c);
      o.onEvent({ kind: 'edit', text: label });
      results.push({ tool: call.name, ok: label });
    }

    const wantsToStop = finished !== null || (turn.done === true && !(turn.calls ?? []).length);
    if (wantsToStop) {
      // once, before letting it go: the animation checks the one-shot copilot ran
      const notes = edits.length && !critiqued ? critique(useEditor.getState().project, edits, o.request) : [];
      if (notes.length) {
        critiqued = true;
        o.onEvent({ kind: 'status', text: 'Reviewing the motion before finishing' });
        messages.push({ role: 'user', content: `RESULTS\n${clip(JSON.stringify(results), 6000)}\n\nBefore finishing, fix these: ${notes.join(' ')} Then preview and finish.` });
        continue;
      }
      return { reply: finished || 'Done.', edits, steps: step, usage, ended: 'done' };
    }
    messages.push({ role: 'user', content: `RESULTS\n${clip(JSON.stringify(results), 8000)}` });
  }
  return { reply: `Stopped after ${maxSteps} steps — what is done so far is applied.`, edits, steps: maxSteps, usage, ended: 'steps' };
}
