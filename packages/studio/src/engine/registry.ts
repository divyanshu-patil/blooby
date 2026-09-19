import { TOOL_DOCS, TOOL_NAMES } from '../copilot/tools';
import { AGENT_TOOL_DOCS, editorFunctions } from '../copilot/agent';
import { EASING_NAMES, MORPH_MODE_NAMES } from '../core/easing';
import { EFFECT_KINDS } from '../core/effects';
import { MODIFIER_KINDS } from '../core/types';
import { SQUISH_PRESETS } from '../core/squish';
import { POSES } from '../core/poses';

/**
 * The Blooby capability registry: everything the Studio can do, as data.
 *
 * Nothing here is a second implementation. Three sources already describe the editor, and
 * this reads them rather than restating them:
 *   - the copilot's edit tools (`TOOL_NAMES` + `TOOL_DOCS`, applied by `applyCalls`)
 *   - the store's own actions (`interface Editor` in core/store.ts, via `editorFunctions`)
 *   - the agent's read tools (`AGENT_TOOL_DOCS`, answered by `runAgentTool`)
 * plus the session capabilities in `engine/session.ts` and whatever a host (the API's MCP
 * server) registers for projects, rendering and export. A new store action or edit tool is
 * therefore a new capability the moment it exists — MCP, docs and tests all list it.
 *
 * Bump CAPABILITY_VERSION's minor for additions, its major for anything that changes an
 * existing capability's arguments or meaning (and keep the old id working, `deprecated`).
 */
export const CAPABILITY_VERSION = '1.0.0';

export type Scope = 'project:read' | 'project:write' | 'preset:read' | 'preset:write' | 'render:read' | 'export:write';
export const SCOPES: Record<Scope, string> = {
  'project:read': 'See your projects: layers, keyframes, states and settings',
  'project:write': 'Create and change projects: layers, animation, text, effects, states — and save them',
  'preset:read': 'Browse presets: the built-in library, community presets and your own',
  'preset:write': 'Create, edit and publish presets in your library',
  'render:read': 'Render frames of your projects as images',
  'export:write': 'Export your projects as Lottie, dotLottie and images',
};

export type Category =
  | 'project' | 'composition' | 'layer' | 'mascot' | 'shape' | 'text' | 'path' | 'style' | 'effect'
  | 'animation' | 'keyframe' | 'timeline' | 'preset' | 'expression' | 'state' | 'playback' | 'selection'
  | 'inspector' | 'viewport' | 'history' | 'render' | 'export' | 'agent' | 'discovery' | 'job' | 'account';

export type JsonSchema = Record<string, unknown>;

export interface Capability {
  /** the MCP tool name too — `[a-z0-9_]`, stable across versions */
  id: string;
  title: string;
  description: string;
  category: Category;
  /** edit = a copilot edit tool; action = a store action; read = an agent read tool;
   *  session = engine/session.ts; server = registered by the host */
  kind: 'edit' | 'action' | 'read' | 'session' | 'server';
  mutates: boolean;
  scope: Scope;
  /** undoable through history_undo */
  reversible: boolean;
  /** what must exist first — told to an agent instead of a generic failure */
  requires: ('project' | 'layer' | 'keyframe' | 'preset' | 'selection' | 'state')[];
  /** slow enough to run as a job (see job_get) */
  async?: boolean;
  inputSchema: JsonSchema;
  examples?: Record<string, unknown>[];
  since: string;
  deprecated?: string;
}

// ---------------------------------------------------------------------------
// argument types, by the names the tool docs use

const NUMBER_ARGS = new Set([
  'x', 'y', 'width', 'height', 'size', 'weight', 'amount', 'frequency', 'amplitude', 'seed', 'phase', 'index', 'scale',
  'rotation', 'yaw', 'pitch', 'opacity', 'offset', 'baseline', 'radius', 'start', 'end', 'stagger', 'lineHeight',
  'letterSpacing', 'length', 'thickness', 'bend', 'roundness', 'taper', 'footAngle', 'footLength', 'footWidth', 'points',
  'innerRatio', 'cornerRadius', 'vertexRadius', 'count', 'fadeStart', 'spin', 'wobble', 'radiusX', 'radiusY', 'velocity',
  'velocityJitter', 'angle', 'spread', 'drag', 'gravity', 'turbulence', 'fromX', 'fromY', 'toX', 'toY', 'bow', 'fps',
  'openness', 'distanceFromCenter', 'scaleX', 'scaleY', 'limit', 'time', 'speed',
]);
const BOOL_ARGS = new Set([
  'loop', 'copyLayers', 'visible', 'locked', 'clear', 'enabled', 'closed', 'guide', 'reverse', 'flip', 'underneath',
  'pinned', 'face', 'everywhere', 'italic', 'remove', 'rubberHose', 'keyed', 'on', 'force',
]);
const ARRAY_ARGS = new Set(['tracks', 'glyphs', 'parts', 'conditions', 'keyframes', 'times', 'nodeIds', 'properties', 'ids', 'trackIds', 'eyeIds']);
const OBJECT_ARGS = new Set(['snapshot', 'attract', 'params', 'shoulder', 'hand', 'hip', 'knee', 'ankle', 'patch', 'opts']);
const COLOR_ARGS = new Set(['color', 'fill', 'colorTo']);

/** Enumerations the docs name in prose, taken from the tables that define them. */
const ENUMS: Record<string, Record<string, readonly string[]>> = {
  '*': { easing: EASING_NAMES },
  add_modifier: { kind: MODIFIER_KINDS },
  set_layer_effect: { kind: EFFECT_KINDS },
  apply_squish_preset: { preset: SQUISH_PRESETS.map((s) => s.name) },
  set_pose: { pose: POSES.map((p) => p.name) },
  set_shape_morph: { mode: MORPH_MODE_NAMES },
};

function typeFor(tool: string, name: string, hint: string): JsonSchema {
  const e = ENUMS[tool]?.[name] ?? ENUMS['*'][name];
  if (e) return { type: 'string', enum: [...e] };
  const quoted = [...hint.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (quoted.length > 1 && !/[{[]/.test(hint)) return { type: 'string', enum: quoted };
  if (/^true\|false$/.test(hint.trim()) || BOOL_ARGS.has(name)) return { type: 'boolean' };
  if (/Ms$/.test(name) || NUMBER_ARGS.has(name)) return { type: 'number' };
  if (COLOR_ARGS.has(name)) return { anyOf: [{ type: 'string', description: '#rrggbb' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4, description: '[r,g,b] 0-255' }] };
  if (hint.trim().startsWith('[') || ARRAY_ARGS.has(name)) return { type: 'array' };
  if (hint.trim().startsWith('{') || OBJECT_ARGS.has(name)) return { type: 'object' };
  if (name === 'value') return { description: 'a number for numeric properties; a colour, a word or a path for the rest' };
  if (name === 'block') return { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'clip id, name, or 0-based index' };
  if (name === 'to') return { anyOf: [{ type: 'string' }, { type: 'number' }] };
  return { type: 'string' };
}

/** `{ a, b?, c: "x"|"y", d?: {x,y} }` → top-level args, split at depth 0. */
function argsOf(braced: string): { name: string; optional: boolean; hint: string }[] {
  const inner = braced.trim().replace(/^\{/, '').replace(/\}$/, '');
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of inner) {
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const m = /^(\w+)(\?)?\s*(?::\s*([\s\S]*))?$/.exec(p);
    return m ? [{ name: m[1], optional: !!m[2], hint: m[3] ?? '' }] : [];
  });
}

/** Tool doc blocks: the `name { … }` line, its continuation lines, and the brace text alone. */
export function docBlocks(docs: string): { name: string; text: string; braced: string }[] {
  const out: { name: string; text: string }[] = [];
  let open = false;
  for (const line of docs.split('\n')) {
    const m = /^([a-z_]+)\s*\{/.exec(line);
    if (m) { out.push({ name: m[1], text: line }); open = true; }
    else if (open && /^\s/.test(line)) out[out.length - 1].text += `\n${line}`;
    else open = false;   // a section header or a prose line ends the block above it
  }
  // "add_preset_to_timeline also takes { mascot }: …" — prose that adds an argument
  const extra = new Map([...docs.matchAll(/^([a-z_]+) also takes \{([^}]*)\}/gm)].map((m) => [m[1], m[2]]));
  return out.map((b) => {
    let braced = balanced(b.text.split('\n').map((l) => l.split('//')[0]).join(' '));
    if (extra.has(b.name)) braced = `${braced.slice(0, -1).trimEnd()}, ${extra.get(b.name)!.trim()}? }`;
    return { ...b, braced };
  });
}

/** The first `{…}` in s, braces balanced. */
function balanced(s: string): string {
  const at = s.indexOf('{');
  let depth = 0;
  for (let i = at; i >= 0 && i < s.length; i++) {
    if (s[i] === '{') depth++;
    if (s[i] === '}' && --depth === 0) return s.slice(at, i + 1).replace(/\s+/g, ' ');
  }
  return '{}';
}

/** Every mutation takes these two; the session honours them. */
const MUTATION_ARGS = {
  requestId: { type: 'string', description: 'idempotency key: a retry with the same id returns the first result instead of repeating it' },
  dryRun: { type: 'boolean', description: 'report what would change without changing anything' },
  expectedRevision: { type: 'number', description: 'refuse with REVISION_CONFLICT unless the project is still at this revision (from editor_get_state or the last result)' },
};

const schemaFrom = (tool: string, braced: string, mutates: boolean): JsonSchema => {
  const args = argsOf(braced || '{}');
  const properties: Record<string, JsonSchema> = {};
  for (const a of args) properties[a.name] = typeFor(tool, a.name, a.hint);
  if (mutates) Object.assign(properties, MUTATION_ARGS);
  return { type: 'object', properties, required: args.filter((a) => !a.optional).map((a) => a.name), additionalProperties: false };
};

// ---------------------------------------------------------------------------
// categories and scopes, from the name — a rule, not a list

function categoryOf(id: string): Category {
  const rules: [RegExp, Category][] = [
    [/preset/i, 'preset'], [/expression|capture/i, 'expression'], [/text/i, 'text'], [/curve|hose/i, 'path'],
    [/mascot|face|pose|limb|leg|hand|role|squish|eye/i, 'mascot'], [/shape|morph/i, 'shape'],
    [/effect|modifier|emitter|camera/i, 'effect'], [/style|svg_fill|svg_stroke|fill|stroke/i, 'style'],
    [/keyframe|easing|tween/i, 'keyframe'], [/composition/i, 'composition'],
    [/state|transition|input|rule|machine/i, 'state'], [/block|clip|timeline|duration|lane|loop/i, 'timeline'],
    [/layer|node|group|attach|parent|order|appearance|svg|visibility|lock|move/i, 'layer'],
    [/playhead|play/i, 'playback'], [/select/i, 'selection'], [/property|value/i, 'animation'],
  ];
  return rules.find(([re]) => re.test(id))?.[1] ?? 'animation';
}

const scopeOf = (id: string, mutates: boolean): Scope =>
  /preset/i.test(id) ? (mutates ? 'preset:write' : 'preset:read') : mutates ? 'project:write' : 'project:read';

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const firstLine = (s: string) => s.split('\n')[0].replace(/^\s*\/\/\s*/, '');

// ---------------------------------------------------------------------------
// the three derived families

/** The copilot's edit tools — the same entries, the same validation, the same apply. */
function editCapabilities(): Capability[] {
  const blocks = new Map(docBlocks(TOOL_DOCS).map((b) => [b.name, b]));
  return TOOL_NAMES.map((id) => {
    const b = blocks.get(id);
    // the doc block as the copilot reads it: the signature line, then its usage notes
    const [head = '', ...rest] = b?.text.split('\n') ?? [];
    const usage = [head.split('//')[1] ?? '', ...rest.map((l) => l.replace(/^\s*(\/\/\s?)?/, ''))].map((l) => l.trim()).filter(Boolean).join('\n');
    return {
      id, title: id.replace(/_/g, ' '), kind: 'edit', mutates: true, reversible: true,
      description: `${usage || `The editor's ${id.replace(/_/g, ' ')}.`}\n\nArguments: ${b?.braced.trim() ?? '{}'}`,
      category: categoryOf(id), scope: scopeOf(id, true),
      requires: /nodeId/.test(b?.braced ?? '') ? ['project', 'layer'] : ['project'],
      inputSchema: schemaFrom(id, b?.braced ?? '{}', true), since: '1.0.0',
    } satisfies Capability;
  });
}

/**
 * Store actions that are not already an edit tool, with JSON arguments. Actions taking a
 * callback (`updateNode(id, fn)`) have an edit tool doing the same thing with data; the
 * ones below would throw the document or its history away, or only move browser UI.
 */
const NOT_ACTIONS = new Set([
  'loadProject', 'resetProject', 'commit', 'restoreProject', 'undo', 'redo', 'loadCatalog', 'setPlaying', 'setTool',
  'setEditPoints', 'setRailTab', 'toggleAutoKey', 'trackFor', 'setClipGalleryTimeline', 'addClipFrom', 'setPlayhead', 'select',
]);

/** capability id → the store action and its parameter order, for the session to call */
const ACTIONS = new Map<string, { action: string; params: { name: string; type: string; optional: boolean }[] }>();
export const actionOf = (id: string) => { capabilities(); return ACTIONS.get(id); };

function actionCapabilities(): Capability[] {
  return editorFunctions().flatMap((f) => {
    if (NOT_ACTIONS.has(f.name) || /=>/.test(f.signature.slice(f.signature.indexOf('(') + 1, f.signature.lastIndexOf(') =>')))) return [];
    const params = paramsOf(f.signature);
    const properties: Record<string, JsonSchema> = {};
    for (const p of params) properties[p.name] = tsType(p.type);
    Object.assign(properties, MUTATION_ARGS);
    const id = `editor_${snake(f.name)}`;
    ACTIONS.set(id, { action: f.name, params });
    return [{
      id, title: f.name, kind: 'action', mutates: true, reversible: true,
      description: `${f.doc || `The Studio's ${f.name} action.`}\n\nStore action: ${f.signature}`,
      category: categoryOf(f.name), scope: scopeOf(f.name, true), requires: ['project'],
      inputSchema: { type: 'object', properties, required: params.filter((p) => !p.optional).map((p) => p.name), additionalProperties: false },
      since: '1.0.0',
    } satisfies Capability];
  });
}

/** `name(a: string, b?: { x: number }) => void` → [{ name, type, optional }] */
export function paramsOf(signature: string): { name: string; type: string; optional: boolean }[] {
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(') =>');
  const inner = signature.slice(open + 1, close < 0 ? undefined : close);
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of inner) {
    if ('{[(<'.includes(ch)) depth++;
    if ('}])>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).flatMap((p) => {
    const m = /^(\w+)(\?)?\s*:\s*([\s\S]+)$/.exec(p);
    return m ? [{ name: m[1], optional: !!m[2], type: m[3].trim() }] : [];
  });
}

function tsType(t: string): JsonSchema {
  const lits = [...t.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (lits.length && /^('[^']+'\s*\|?\s*)+$/.test(t)) return { type: 'string', enum: lits };
  if (t === 'string') return { type: 'string' };
  if (t === 'number') return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (t === 'string | null') return { type: ['string', 'null'] };
  if (/\[\]$/.test(t)) return { type: 'array', description: t };
  return { description: `TypeScript: ${t}` };
}

/** The agent's read tools that make sense without a browser tab. */
const READS: Record<string, Category> = {
  search_presets: 'preset', get_preset: 'preset', inspect_project: 'project', get_layer: 'layer', get_values: 'animation',
};

function readCapabilities(): Capability[] {
  return docBlocks(AGENT_TOOL_DOCS).filter((b) => READS[b.name]).map((b) => ({
    id: b.name, title: b.name.replace(/_/g, ' '), kind: 'read', mutates: false, reversible: false,
    description: b.text.split('\n').map((l) => l.split('//')[1]?.trim()).filter(Boolean).join(' '),
    category: READS[b.name], scope: scopeOf(b.name, false), requires: ['project'],
    inputSchema: schemaFrom(b.name, b.braced, false), since: '1.0.0',
  }));
}

// ---------------------------------------------------------------------------

const registered: Capability[] = [];

/** Host capabilities (projects, rendering, export, jobs) join the same registry. */
export function registerCapabilities(list: Capability[]) {
  for (const c of list) {
    const at = registered.findIndex((r) => r.id === c.id);
    if (at >= 0) registered[at] = c; else registered.push(c);
  }
}

let derived: Capability[] | null = null;

export function capabilities(): Capability[] {
  derived ??= [...editCapabilities(), ...actionCapabilities(), ...readCapabilities()];
  const own = new Set(registered.map((c) => c.id));
  return [...derived.filter((c) => !own.has(c.id)), ...registered];
}

export const capability = (id: string) => capabilities().find((c) => c.id === id);

/** Filtered discovery: by category, read/write, scope, or words in the name and description. */
export function findCapabilities(q: { query?: string; category?: string; mutates?: boolean; scope?: string } = {}) {
  const words = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return capabilities().filter((c) =>
    (!q.category || c.category === q.category)
    && (q.mutates === undefined || c.mutates === q.mutates)
    && (!q.scope || c.scope === q.scope)
    && (!words.length || words.some((w) => `${c.id} ${c.title} ${c.description}`.toLowerCase().includes(w))));
}

export const summaryOf = (c: Capability) => ({
  id: c.id, category: c.category, mutates: c.mutates, scope: c.scope, summary: firstLine(c.description).slice(0, 160),
});
