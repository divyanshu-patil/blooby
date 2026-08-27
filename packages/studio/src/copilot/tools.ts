import { useEditor, writeKeyframe } from '../core/store';
import { uid } from '../core/defaults';
import { namedEasing, EASING_NAMES } from '../core/easing';
import { blocksEnd } from '../core/timeline';
import { setProp } from '../core/props';
import { activeTimeline, NODE_PROPS } from '../core/types';
import type { EasingCurve, Project } from '../core/types';

export type ToolCall = { name: string; args: Record<string, unknown> };

/** The JSON the model must produce. Ollama enforces this shape server-side via `format`. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: ['set_eye_params', 'set_property', 'add_keyframe', 'create_expression', 'apply_expression',
              'create_preset', 'add_preset_to_timeline', 'add_modifier', 'morph_between'],
          },
          args: { type: 'object' },
        },
        required: ['name', 'args'],
      },
    },
  },
  required: ['reply', 'calls'],
} as const;

export const TOOL_DOCS = `
set_eye_params        { nodeId, openness?, distanceFromCenter?, length?, scaleX?, scaleY?, rotation?, atMs? }
set_property          { nodeId, property, value, atMs? }        // atMs writes a keyframe, otherwise the base pose
add_keyframe          { nodeId, property, atMs, value, easing? }
create_expression     { name, snapshot: { "<nodeId>.<property>": number } }
apply_expression      { expression, atMs, easing? }             // expression = id or name
create_preset         { name, durationMs, tracks: [{ nodeId, property, keyframes: [{ time, value, easing? }] }] }
add_preset_to_timeline{ preset, index? }                        // preset = id or name; appended if index omitted
add_modifier          { nodeId, kind: "shake"|"float", amount, frequency, amplitude, seed?, phase? }
                      // amount is an intensity percentage, 0-200, where 100 is normal
                      // frequency in Hz: shake 6-20, float 0.3-1.5
                      // amplitude is the swing in degrees (or px on the body): 3-15
morph_between         { from, to, atMs, durationMs, easing? }   // from/to = expression id or name`.trim();

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function easingOf(v: unknown): EasingCurve {
  const n = str(v);
  return n && (EASING_NAMES as readonly string[]).includes(n) ? namedEasing(n) : { type: 'preset', name: 'easeInOut' };
}

function findExpression(p: Project, ref: unknown) {
  const s = str(ref)?.toLowerCase();
  return p.expressions.find((e) => e.id === ref || e.name.toLowerCase() === s);
}
function findPreset(p: Project, ref: unknown) {
  const s = str(ref)?.toLowerCase();
  return p.presets.find((e) => e.id === ref || e.name.toLowerCase() === s);
}

/** Layer id, or a layer name in any casing — models reach for the visible name. */
function findNode(p: Project, ref: unknown): string | undefined {
  const s = str(ref);
  if (!s) return undefined;
  if (p.rig.nodes[s]) return s;
  const lower = s.toLowerCase();
  return Object.values(p.rig.nodes).find((n) => n.name.toLowerCase() === lower)?.id;
}

/**
 * Rewrites the forgiving forms of a call into the exact ones before validation:
 * layer names become ids, and the aliases models reach for become the real argument
 * names. Anything it cannot resolve is left alone, so `validate` still rejects it.
 */
export function normaliseCall(p: Project, call: ToolCall): ToolCall {
  const a: Record<string, unknown> = { ...(call.args ?? {}) };
  const alias: Record<string, string> = {
    node: 'nodeId', layer: 'nodeId', target: 'nodeId',
    time: 'atMs', at: 'atMs', ms: 'atMs',
    duration: 'durationMs', expressionId: 'expression', presetId: 'preset',
    fromExpressionId: 'from', toExpressionId: 'to',
  };
  for (const [from, to] of Object.entries(alias)) {
    if (a[from] !== undefined && a[to] === undefined) { a[to] = a[from]; delete a[from]; }
  }
  const id = findNode(p, a.nodeId);
  if (id) a.nodeId = id;
  return { name: call.name, args: a };
}

/** Rejects anything that would corrupt the document. Returns null when the call is fine. */
export function validate(p: Project, call: ToolCall): string | null {
  const a = call.args ?? {};
  const node = (id: unknown) => (str(id) && p.rig.nodes[str(id)!] ? null : `no layer "${String(id)}"`);
  switch (call.name) {
    case 'set_eye_params': return node(a.nodeId);
    case 'set_property':
    case 'add_keyframe': {
      const bad = node(a.nodeId);
      if (bad) return bad;
      if (!NODE_PROPS.includes(a.property as never)) return `"${String(a.property)}" is not an animatable property`;
      if (num(a.value) === undefined) return 'value must be a number';
      if (call.name === 'add_keyframe' && num(a.atMs) === undefined) return 'atMs must be a number';
      return null;
    }
    case 'create_expression':
      return str(a.name) && a.snapshot && typeof a.snapshot === 'object' ? null : 'needs a name and a snapshot';
    case 'apply_expression':
      return findExpression(p, a.expression) ? (num(a.atMs) === undefined ? 'atMs must be a number' : null) : `no expression "${String(a.expression)}"`;
    case 'create_preset':
      return str(a.name) && Array.isArray(a.tracks) && a.tracks.length ? null : 'needs a name and at least one track';
    case 'add_preset_to_timeline':
      return findPreset(p, a.preset) ? null : `no preset "${String(a.preset)}"`;
    case 'add_modifier': {
      const bad = node(a.nodeId);
      if (bad) return bad;
      return a.kind === 'shake' || a.kind === 'float' ? null : 'kind must be shake or float';
    }
    case 'morph_between':
      if (!findExpression(p, a.from)) return `no expression "${String(a.from)}"`;
      if (!findExpression(p, a.to)) return `no expression "${String(a.to)}"`;
      return num(a.atMs) === undefined || num(a.durationMs) === undefined ? 'atMs and durationMs must be numbers' : null;
    default:
      return `unknown tool "${call.name}"`;
  }
}

/** One line of plain English per call — this is what the Apply/Reject card shows. */
export function describe(p: Project, call: ToolCall): string {
  const a = call.args ?? {};
  const name = (id: unknown) => p.rig.nodes[String(id)]?.name ?? String(id);
  const at = (v: unknown) => `${((num(v) ?? 0) / 1000).toFixed(2)}s`;
  switch (call.name) {
    case 'set_eye_params': {
      const parts = ['openness', 'distanceFromCenter', 'length', 'scaleX', 'scaleY', 'rotation']
        .filter((k) => num(a[k]) !== undefined).map((k) => `${k} ${a[k]}`);
      return `Set ${name(a.nodeId)}: ${parts.join(', ') || 'nothing'}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    }
    case 'set_property': return `Set ${name(a.nodeId)} ${a.property} to ${a.value}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'add_keyframe': return `Key ${name(a.nodeId)} ${a.property} = ${a.value} at ${at(a.atMs)}`;
    case 'create_expression': return `Create expression "${a.name}" from ${Object.keys(a.snapshot as object).length} values`;
    case 'apply_expression': return `Apply "${findExpression(p, a.expression)?.name}" at ${at(a.atMs)}`;
    case 'create_preset': return `Create preset "${a.name}" (${(a.tracks as unknown[]).length} tracks, ${at(a.durationMs)})`;
    case 'add_preset_to_timeline': return `Add "${findPreset(p, a.preset)?.name}" to the strip${a.index !== undefined ? ` at slot ${a.index}` : ''}`;
    case 'add_modifier': return `Add ${a.kind} to ${name(a.nodeId)} — amount ${a.amount ?? 100}%, ${a.frequency ?? 1} Hz`;
    case 'morph_between': return `Morph ${findExpression(p, a.from)?.name} → ${findExpression(p, a.to)?.name} at ${at(a.atMs)} over ${a.durationMs}ms`;
    default: return call.name;
  }
}

const EYE_MAP: Record<string, string> = {
  openness: 'eye.openness', distanceFromCenter: 'eye.distanceFromCenter', length: 'transform.length',
  scaleX: 'transform.scale.x', scaleY: 'transform.scale.y', rotation: 'transform.rotation',
};

/** Applies a validated batch as ONE undo step. */
export function applyCalls(calls: ToolCall[]) {
  const store = useEditor.getState();
  store.commit((p) => {
    for (const call of calls) {
      const a = call.args ?? {};
      switch (call.name) {
        case 'set_eye_params': {
          for (const [k, prop] of Object.entries(EYE_MAP)) {
            const v = num(a[k]);
            if (v === undefined) continue;
            if (num(a.atMs) !== undefined) writeKeyframe(p, String(a.nodeId), prop, num(a.atMs)!, v, easingOf(a.easing));
            else setBase(p, String(a.nodeId), prop, v);
          }
          break;
        }
        case 'set_property':
          if (num(a.atMs) !== undefined) writeKeyframe(p, String(a.nodeId), String(a.property), num(a.atMs)!, num(a.value)!, easingOf(a.easing));
          else setBase(p, String(a.nodeId), String(a.property), num(a.value)!);
          break;
        case 'add_keyframe':
          writeKeyframe(p, String(a.nodeId), String(a.property), num(a.atMs)!, num(a.value)!, easingOf(a.easing));
          break;
        case 'create_expression': {
          const snapshot: Record<string, number> = {};
          for (const [k, v] of Object.entries(a.snapshot as Record<string, unknown>)) {
            const n = num(v);
            if (n !== undefined) snapshot[k] = n;
          }
          p.expressions.push({ id: uid('x'), name: String(a.name), snapshot });
          break;
        }
        case 'apply_expression': {
          const x = findExpression(p, a.expression)!;
          for (const [key, value] of Object.entries(x.snapshot)) {
            const i = key.indexOf('.');
            writeKeyframe(p, key.slice(0, i), key.slice(i + 1), num(a.atMs)!, value, easingOf(a.easing));
          }
          break;
        }
        case 'create_preset': {
          const tracks = (a.tracks as Record<string, unknown>[]).map((t) => ({
            id: uid('t'), nodeId: String(t.nodeId), property: String(t.property),
            keyframes: ((t.keyframes ?? []) as Record<string, unknown>[])
              .map((k) => ({ id: uid('k'), time: num(k.time) ?? 0, value: num(k.value) ?? 0, easingOut: easingOf(k.easing) }))
              .sort((x, y) => x.time - y.time),
          })).filter((t) => t.keyframes.length);
          p.presets.push({ id: uid('p'), name: String(a.name), source: 'custom', durationMs: Math.max(120, num(a.durationMs) ?? 1000), tracks });
          break;
        }
        case 'add_preset_to_timeline': {
          const preset = findPreset(p, a.preset)!;
          const tl = activeTimeline(p);
          const index = num(a.index) ?? tl.blocks.length;
          const blockId = uid('b');
          const start = blocksEnd({ ...tl, blocks: tl.blocks.slice(0, index) });
          const shifted = new Set(tl.blocks.slice(index).map((b) => b.id));
          for (const t of tl.tracks) if (t.blockId && shifted.has(t.blockId)) for (const k of t.keyframes) k.time += preset.durationMs;
          for (const t of preset.tracks) {
            tl.tracks.push({
              id: uid('t'), nodeId: t.nodeId, property: t.property, blockId,
              keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + start })),
            });
          }
          tl.blocks.splice(index, 0, { id: blockId, presetId: preset.id, name: preset.name, durationMs: preset.durationMs });
          break;
        }
        case 'add_modifier':
          activeTimeline(p).modifiers.push({
            id: uid('m'), nodeId: String(a.nodeId), kind: a.kind as 'shake',
            amount: num(a.amount) ?? 100, frequency: num(a.frequency) ?? 6,
            amplitude: num(a.amplitude) ?? 6, seed: num(a.seed), phase: num(a.phase),
          });
          break;
        case 'morph_between': {
          const from = findExpression(p, a.from)!, to = findExpression(p, a.to)!;
          for (const [key, end] of Object.entries(to.snapshot)) {
            const start = from.snapshot[key];
            if (start === undefined || JSON.stringify(start) === JSON.stringify(end)) continue;
            const i = key.indexOf('.');
            writeKeyframe(p, key.slice(0, i), key.slice(i + 1), num(a.atMs)!, start, easingOf(a.easing));
            writeKeyframe(p, key.slice(0, i), key.slice(i + 1), num(a.atMs)! + num(a.durationMs)!, end, easingOf(a.easing));
          }
          break;
        }
      }
    }
  }, `copilot.${Date.now()}`);
}

/** A property with a track can't be set statically — the track would just mask it. */
function setBase(p: Project, nodeId: string, property: string, v: number) {
  const track = activeTimeline(p).tracks.find((t) => t.nodeId === nodeId && t.property === property);
  if (track) { writeKeyframe(p, nodeId, property, 0, v, { type: 'preset', name: 'easeInOut' }); return; }
  const node = p.rig.nodes[nodeId];
  if (node) setProp(node, property, v);
}
