import { uniqueName, useEditor, writeKeyframe } from '../core/store';
import { attachPresetEffects, makeTimeline, uid } from '../core/defaults';
import { namedEasing, EASING_NAMES } from '../core/easing';
import { blocksEnd, relayoutBlocks } from '../core/timeline';
import { activeTrackFor } from '../core/scene';
import { setProp } from '../core/props';
import { activeTimeline, MODIFIER_KINDS, MODIFIERS } from '../core/types';
import { NUMERIC_PROPS, PROPS, resolveProp } from '../core/props';
import type { EasingCurve, ModifierKind, Project } from '../core/types';

export type ToolCall = { name: string; args: Record<string, unknown> };

/** Every tool the copilot can call. The schema, the parser and `validate` all read this. */
export const TOOL_NAMES = [
  'set_eye_params', 'set_property', 'add_keyframe', 'create_expression', 'apply_expression',
  'create_preset', 'add_preset_to_timeline', 'add_modifier', 'morph_between',
  'set_timeline', 'clear_animation', 'set_block_duration', 'remove_block', 'move_block',
  'add_timeline', 'set_camera', 'remove_keyframe', 'move_keyframe', 'edit_preset',
  'add_emitter', 'set_effect_range',
] as const;

/** The JSON the model must produce. Ollama enforces this shape server-side via `format`. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    // first, so the model reasons before it emits calls rather than after
    plan: { type: 'string' },
    reply: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: TOOL_NAMES },
          args: { type: 'object' },
        },
        required: ['name', 'args'],
      },
    },
  },
  required: ['plan', 'reply', 'calls'],
} as const;

export const TOOL_DOCS = `
set_eye_params        { nodeId, openness?, distanceFromCenter?, length?, scaleX?, scaleY?, rotation?, atMs? }
set_property          { nodeId, property, value, atMs? }        // atMs writes a keyframe, otherwise the base pose
add_keyframe          { nodeId, property, atMs, value, easing? }
create_expression     { name, snapshot: { "<nodeId>.<property>": number } }
apply_expression      { expression, atMs, easing? }             // expression = id or name
create_preset         { name, durationMs, tracks: [{ nodeId, property, keyframes: [{ time, value, easing? }] }] }
add_preset_to_timeline{ preset, index? }                        // preset = id or name; appended if index omitted
add_modifier          { nodeId, kind, amount, frequency, amplitude, seed?, phase? }
                      // amount is an intensity percentage, 0-200, where 100 is normal
${MODIFIER_KINDS.map((k) => `                      // ${k}: ${MODIFIERS[k].help}`).join('\n')}
morph_between         { from, to, atMs, durationMs, easing? }   // from/to = expression id or name

set_timeline          { durationMs?, loop?, fps? }             // loop eases the last frame back onto the first
clear_animation       { nodeId?, property? }                   // drop tracks; omit both to clear the whole timeline
set_block_duration    { block, durationMs }                    // block = id, name, or 0-based index on the strip
remove_block          { block }
move_block            { block, index }
add_timeline          { name }                                 // a new timeline = a new exported Lottie state
set_camera            { property: "perspective"|"distance", value }  // perspective is the field-of-view angle

remove_keyframe       { nodeId, property, atMs }               // atMs must match a keyframe listed under "Keyframes"
move_keyframe         { nodeId, property, fromMs, toMs }       // retime one keyframe; fromMs must match an existing one
edit_preset           { preset, name?, durationMs?, tracks? }  // tracks REPLACE the preset's tracks; clips already on
                      // the strip keep the copy they were added with, so re-add to see the change
To change a keyframe's VALUE or easing, call add_keyframe at the same atMs \u2014 it overwrites in place.

add_emitter           { name, glyphs, path?, fromNode?, fromX?, fromY?, toNode?, toX?, toY?,
                        color?, size?, bow?, rateMs?, lifeMs?, count?, fadeStart?, spin?,
                        wobble?, radiusX?, radiusY?, startMs?, endMs? }
                      // little things leaving the mascot: zzz, \u266a, tears, confetti, orbiting objects.
                      // glyphs is an array cycled one per particle, e.g. ["z","z","Z"].
                      // path: "arc" drifts (zzz, notes) \u00b7 "fall" drops (tears, confetti)
                      //       \u00b7 "orbit" circles fromX/fromY on an ellipse (things overhead)
                      // fromNode/toNode PIN that end to a layer so it follows it \u2014 pin a tear's
                      // start to eyeL and the drops leave the eye wherever the head moves.
                      // x/y are offsets in rig units from that layer (or from the body centre).
                      // color is [r,g,b] 0-255. fadeStart is 0-1 of a particle's life.
set_effect_range      { effect, startMs?, endMs? }
                      // effect = an effect's or emitter's name. Times are from the start of its
                      // scope \u2014 the clip it belongs to, or the timeline. Omit both to run always.`.trim()

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A property the copilot may write: on a node, and a number. */
const numeric = (v: unknown) => { const p = resolveProp(v); return !!p && PROPS[p].on === 'node' && !!PROPS[p].range; };
const badProp = (v: unknown) =>
  `"${String(v)}" is not an animatable property. Use one of: ${NUMERIC_PROPS.filter((x) => PROPS[x].on === 'node').join(', ')}`;
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

/** A clip by id, by name, or by its position on the strip — models reach for all three. */
function findBlock(p: Project, ref: unknown) {
  const tl = activeTimeline(p);
  if (typeof ref === 'number' && Number.isInteger(ref)) return tl.blocks[ref];
  const s = str(ref);
  if (!s) return undefined;
  const byId = tl.blocks.find((b) => b.id === s);
  if (byId) return byId;
  const lower = s.toLowerCase();
  const byName = tl.blocks.find((b) => b.name.toLowerCase() === lower);
  if (byName) return byName;
  return /^\d+$/.test(s) ? tl.blocks[Number(s)] : undefined;
}

/**
 * One keyframe, by the coordinates the prompt lists it under.
 *
 * Tracks are clip-scoped, so the track holding a given time is not simply
 * "the one for this node and property" — activeTrackFor is what resolves that, and it is
 * the same lookup writeKeyframe uses, so edits and writes cannot disagree about which
 * clip's track they mean. The 8 ms window absorbs a model rounding a time it read back.
 */
function findKeyframe(p: Project, nodeId: unknown, property: unknown, atMs: unknown) {
  const t = num(atMs);
  if (t === undefined) return undefined;
  const track = activeTrackFor(activeTimeline(p), String(nodeId), String(property), t);
  const kf = track?.keyframes.find((k) => Math.abs(k.time - t) < 8);
  return track && kf ? { track, kf } : undefined;
}

/** An effect the model can name: an emitter by its name, or a modifier by its kind. */
function findEffect(p: Project, ref: unknown) {
  const s = str(ref)?.toLowerCase();
  if (!s) return undefined;
  const tl = activeTimeline(p);
  const emitter = (tl.emitters ?? []).find((e) => e.id === ref || e.name.toLowerCase() === s);
  if (emitter) return { kind: 'emitter' as const, id: emitter.id };
  const mod = tl.modifiers.find((m) => m.id === ref || m.kind.toLowerCase() === s);
  return mod ? { kind: 'modifier' as const, id: mod.id } : undefined;
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
  // "make it scale more" often comes back as create_preset with the SAME name. That is an
  // edit however it is spelled, and letting it through would leave two presets sharing a
  // name — which findPreset resolves by name, so the second would be unreachable.
  let name = call.name;
  if (name === 'create_preset' && findPreset(p, a.name)) {
    name = 'edit_preset';
    a.preset = a.name;
    delete a.name;
  }

  const id = findNode(p, a.nodeId);
  if (id) a.nodeId = id;
  // set_eye_params documents short names (`openness`), so models write them everywhere.
  // resolveProp maps any unambiguous short name back onto its full path.
  const prop = resolveProp(a.property);
  if (prop) a.property = prop;

  // a layer name and a short property name are just as likely to show up nested — models
  // write "Left eye" and "openness" inside a preset track exactly as readily as at the top
  if (Array.isArray(a.tracks)) {
    a.tracks = (a.tracks as Record<string, unknown>[]).map((t) => {
      if (!t || typeof t !== 'object') return t;
      return { ...t, nodeId: findNode(p, t.nodeId) ?? t.nodeId, property: resolveProp(t.property) ?? t.property };
    });
  }
  if (a.snapshot && typeof a.snapshot === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a.snapshot as Record<string, unknown>)) {
      const i = k.indexOf('.');
      const node = i > 0 ? findNode(p, k.slice(0, i)) : undefined;
      const path = i > 0 ? resolveProp(k.slice(i + 1)) : undefined;
      out[node && path ? `${node}.${path}` : k] = v;
    }
    a.snapshot = out;
  }
  return { name, args: a };
}

/**
 * Validate a whole turn, not each call against the project as it stands.
 *
 * A model that writes create_preset then add_preset_to_timeline in one batch is doing
 * exactly the right thing, but the second call names something that will not exist until
 * the first one runs — validating against the live project rejected it as `no preset
 * "cat eyes"`. So walk the batch against a view that includes what the earlier calls
 * will have made. Cheap because only the name lists matter here.
 */
export function validateBatch(p: Project, calls: ToolCall[]): (string | null)[] {
  const view: Project = { ...p, presets: [...p.presets], expressions: [...p.expressions] };
  return calls.map((call) => {
    const problem = validate(view, call);
    if (problem) return problem;
    const a = call.args ?? {};
    if (call.name === 'create_preset') view.presets.push({ id: uid('p'), name: String(a.name), source: 'custom', durationMs: 0, tracks: [] });
    if (call.name === 'create_expression') view.expressions.push({ id: uid('x'), name: String(a.name), snapshot: {} });
    return null;
  });
}

/** Shared by create_preset and edit_preset — an unknown layer here is silent otherwise:
 *  the track is built, and nothing ever reads it. */
function checkTracks(p: Project, tracks: unknown, label: string): string | null {
  for (const t of tracks as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') return `a track of "${label}" is not an object`;
    if (!str(t.nodeId) || !p.rig.nodes[str(t.nodeId)!]) return `no layer "${String(t.nodeId)}" in a track of "${label}"`;
    if (!numeric(t.property)) return badProp(t.property);
    if (!Array.isArray(t.keyframes) || !t.keyframes.length) return `a track of "${label}" has no keyframes`;
  }
  return null;
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
      if (!numeric(a.property)) return badProp(a.property);
      if (num(a.value) === undefined) return 'value must be a number';
      if (call.name === 'add_keyframe' && num(a.atMs) === undefined) return 'atMs must be a number';
      return null;
    }
    case 'create_expression': {
      if (!str(a.name) || !a.snapshot || typeof a.snapshot !== 'object') return 'needs a name and a snapshot';
      for (const key of Object.keys(a.snapshot as object)) {
        const i = key.indexOf('.');
        const bad = node(i > 0 ? key.slice(0, i) : key);
        if (bad) return `${bad} in the snapshot`;
        if (!numeric(key.slice(i + 1))) return badProp(key.slice(i + 1));
      }
      return null;
    }
    case 'apply_expression':
      return findExpression(p, a.expression) ? (num(a.atMs) === undefined ? 'atMs must be a number' : null) : `no expression "${String(a.expression)}"`;
    case 'create_preset':
      if (!str(a.name) || !Array.isArray(a.tracks) || !a.tracks.length) return 'needs a name and at least one track';
      return checkTracks(p, a.tracks, String(a.name));
    case 'edit_preset': {
      if (!findPreset(p, a.preset)) return `no preset "${String(a.preset)}"`;
      if (a.name === undefined && a.durationMs === undefined && a.tracks === undefined) {
        return 'edit_preset needs at least one of name, durationMs, tracks';
      }
      if (a.tracks === undefined) return null;
      if (!Array.isArray(a.tracks) || !a.tracks.length) return 'tracks must be a non-empty array';
      return checkTracks(p, a.tracks, String(a.preset));
    }
    case 'remove_keyframe':
    case 'move_keyframe': {
      const bad = node(a.nodeId);
      if (bad) return bad;
      if (!numeric(a.property)) return badProp(a.property);
      const at = call.name === 'move_keyframe' ? a.fromMs : a.atMs;
      if (num(at) === undefined) return `${call.name === 'move_keyframe' ? 'fromMs' : 'atMs'} must be a number`;
      if (call.name === 'move_keyframe' && num(a.toMs) === undefined) return 'toMs must be a number';
      return findKeyframe(p, a.nodeId, a.property, at)
        ? null
        : `no keyframe on ${String(a.nodeId)} ${String(a.property)} at ${String(at)}ms \u2014 use the times listed under "Keyframes"`;
    }
    case 'add_preset_to_timeline':
      return findPreset(p, a.preset) ? null : `no preset "${String(a.preset)}"`;
    case 'add_modifier': {
      const bad = node(a.nodeId);
      if (bad) return bad;
      return MODIFIER_KINDS.includes(a.kind as ModifierKind) ? null : `kind must be one of ${MODIFIER_KINDS.join(', ')}`;
    }
    case 'set_timeline': {
      if (a.durationMs === undefined && a.loop === undefined && a.fps === undefined) return 'set_timeline needs at least one of durationMs, loop, fps';
      if (a.durationMs !== undefined && (num(a.durationMs) ?? 0) < 100) return 'durationMs must be at least 100';
      if (a.fps !== undefined && !(num(a.fps)! >= 1 && num(a.fps)! <= 120)) return 'fps must be 1-120';
      return null;
    }
    case 'clear_animation': return a.nodeId === undefined ? null : node(a.nodeId);
    case 'set_block_duration':
      if (!findBlock(p, a.block)) return `no clip "${String(a.block)}"`;
      return (num(a.durationMs) ?? 0) >= 100 ? null : 'durationMs must be at least 100';
    case 'remove_block':
    case 'move_block':
      return findBlock(p, a.block) ? null : `no clip "${String(a.block)}"`;
    case 'add_timeline': return str(a.name) ? null : 'add_timeline needs a name';
    case 'add_emitter': {
      if (!str(a.name)) return 'add_emitter needs a name';
      if (!Array.isArray(a.glyphs) || !a.glyphs.length) return 'add_emitter needs a non-empty glyphs array, e.g. ["z","z","Z"]';
      if (a.path !== undefined && !['arc', 'orbit', 'fall'].includes(String(a.path))) return 'path must be arc, orbit or fall';
      for (const k of ['fromNode', 'toNode'] as const) {
        if (a[k] !== undefined && !findNode(p, a[k])) return `no layer "${String(a[k])}" for ${k}`;
      }
      return null;
    }
    case 'set_effect_range':
      return findEffect(p, a.effect) ? null : `no effect or emitter called "${String(a.effect)}"`;
    case 'set_camera':
      if (a.property !== 'perspective' && a.property !== 'fov' && a.property !== 'distance') return 'camera property must be perspective or distance';
      return num(a.value) !== undefined ? null : 'set_camera needs a numeric value';
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
  // describe runs against the project as it stands, but a batch that creates a preset and
  // places it in one turn names something that does not exist yet — which rendered as
  // `Add "undefined" to the strip`. Fall back to what the model actually wrote.
  const named = (found: { name: string } | undefined, ref: unknown) => found?.name ?? String(ref ?? '?');
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
    case 'apply_expression': return `Apply "${named(findExpression(p, a.expression), a.expression)}" at ${at(a.atMs)}`;
    case 'create_preset': return `Create preset "${a.name}" (${(a.tracks as unknown[]).length} tracks, ${at(a.durationMs)})`;
    case 'add_preset_to_timeline': return `Add "${named(findPreset(p, a.preset), a.preset)}" to the strip${a.index !== undefined ? ` at slot ${a.index}` : ''}`;
    case 'add_modifier': return `Add ${a.kind} to ${name(a.nodeId)} — amount ${a.amount ?? 100}%, ${a.frequency ?? 1} Hz`;
    case 'set_timeline': {
      const bits = [
        a.durationMs !== undefined ? `duration ${at(a.durationMs)}` : null,
        a.loop !== undefined ? (a.loop ? 'loop on' : 'loop off') : null,
        a.fps !== undefined ? `${a.fps} fps` : null,
      ].filter(Boolean);
      return `Timeline: ${bits.join(', ')}`;
    }
    case 'clear_animation':
      return a.nodeId === undefined
        ? 'Clear every animated track on this timeline'
        : `Clear ${name(a.nodeId)}${a.property ? ` ${a.property}` : ''} animation`;
    case 'set_block_duration': return `Set clip "${named(findBlock(p, a.block), a.block)}" to ${at(a.durationMs)}`;
    case 'remove_block': return `Remove clip "${named(findBlock(p, a.block), a.block)}"`;
    case 'move_block': return `Move clip "${named(findBlock(p, a.block), a.block)}" to slot ${a.index}`;
    case 'add_timeline': return `Add timeline "${a.name}" (a new exported state)`;
    case 'set_camera': return `Set camera ${a.property} to ${a.value}`;
    case 'add_emitter': {
      const where = a.fromNode ? ` from ${name(a.fromNode)}` : '';
      return `Emit ${(a.glyphs as string[]).slice(0, 4).join(' ')} on a ${a.path ?? 'arc'} path${where} — "${a.name}"`;
    }
    case 'set_effect_range':
      return a.startMs === undefined && a.endMs === undefined
        ? `Run "${a.effect}" for its whole scope`
        : `Run "${a.effect}" from ${at(a.startMs ?? 0)}${a.endMs !== undefined ? ` to ${at(a.endMs)}` : ' onward'}`;
    case 'remove_keyframe': return `Delete the ${name(a.nodeId)} ${a.property} key at ${at(a.atMs)}`;
    case 'move_keyframe': return `Move the ${name(a.nodeId)} ${a.property} key from ${at(a.fromMs)} to ${at(a.toMs)}`;
    case 'edit_preset': {
      const bits = [
        str(a.name) ? `rename to "${a.name}"` : null,
        a.durationMs !== undefined ? `${at(a.durationMs)} long` : null,
        Array.isArray(a.tracks) ? `replace its tracks with ${a.tracks.length}` : null,
      ].filter(Boolean);
      return `Edit preset "${named(findPreset(p, a.preset), a.preset)}": ${bits.join(', ')} (clips already on the strip keep their copy)`;
    }
    case 'morph_between': return `Morph ${named(findExpression(p, a.from), a.from)} → ${named(findExpression(p, a.to), a.to)} at ${at(a.atMs)} over ${a.durationMs}ms`;
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
        case 'create_preset':
          p.presets.push({
            id: uid('p'), name: uniqueName(String(a.name), p.presets.map((x) => x.name)), source: 'custom',
            durationMs: Math.max(120, num(a.durationMs) ?? 1000), tracks: presetTracks(a.tracks),
          });
          break;
        case 'edit_preset': {
          const x = findPreset(p, a.preset)!;
          const rename = str(a.name);
          if (rename) x.name = uniqueName(rename, p.presets.filter((y) => y.id !== x.id).map((y) => y.name));
          const d = num(a.durationMs);
          if (d !== undefined) x.durationMs = Math.max(120, d);
          // clips on the strip hold their own copy of the keyframes (add_preset_to_timeline
          // copies them), so this changes the template, not what is already placed
          if (Array.isArray(a.tracks)) x.tracks = presetTracks(a.tracks);
          break;
        }
        case 'remove_keyframe': {
          const hit = findKeyframe(p, a.nodeId, a.property, a.atMs)!;
          hit.track.keyframes = hit.track.keyframes.filter((k) => k.id !== hit.kf.id);
          // an empty track is a lane on the strip with nothing in it
          if (!hit.track.keyframes.length) {
            const tl = activeTimeline(p);
            tl.tracks = tl.tracks.filter((t) => t.id !== hit.track.id);
          }
          break;
        }
        case 'move_keyframe': {
          const hit = findKeyframe(p, a.nodeId, a.property, a.fromMs)!;
          hit.kf.time = Math.max(0, num(a.toMs)!);
          hit.track.keyframes.sort((x, y) => x.time - y.time);
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
          // a preset's effects and emitters come with it — "Sleepy" without the zzz is
          // not sleepy, and the copilot placing one must get the same clip the panel does
          attachPresetEffects(tl, preset, blockId);
          break;
        }
        case 'add_modifier':
          activeTimeline(p).modifiers.push({
            id: uid('m'), nodeId: String(a.nodeId), kind: a.kind as 'shake',
            amount: num(a.amount) ?? 100, frequency: num(a.frequency) ?? 6,
            amplitude: num(a.amplitude) ?? 6, seed: num(a.seed), phase: num(a.phase),
          });
          break;
        case 'set_timeline': {
          const tl = activeTimeline(p);
          const d = num(a.durationMs);
          // durationOverrideMs is the knob; timelineDurationMs is derived from it on every
          // commit, so writing that one directly is immediately undone
          if (d !== undefined) tl.durationOverrideMs = Math.max(200, blocksEnd(tl), Math.round(d));
          if (typeof a.loop === 'boolean') tl.loop = a.loop;
          const fps = num(a.fps);
          if (fps !== undefined) p.fps = Math.min(120, Math.max(1, Math.round(fps)));
          break;
        }
        case 'clear_animation': {
          const tl = activeTimeline(p);
          const nodeId = a.nodeId === undefined ? undefined : findNode(p, a.nodeId);
          const property = str(a.property);
          tl.tracks = tl.tracks.filter((t) =>
            !((nodeId === undefined || t.nodeId === nodeId) && (property === undefined || t.property === property)));
          break;
        }
        // relayoutBlocks is what keeps every block-owned keyframe glued to its clip —
        // reordering or resizing without it silently desynchronises the strip
        case 'set_block_duration': {
          const tl = activeTimeline(p);
          const b = findBlock(p, a.block)!;
          relayoutBlocks(tl, tl.blocks.map((x) => (x.id === b.id ? { ...x, durationMs: Math.max(60, Math.round(num(a.durationMs)!)) } : x)));
          break;
        }
        case 'remove_block': {
          const tl = activeTimeline(p);
          const b = findBlock(p, a.block)!;
          tl.tracks = tl.tracks.filter((t) => t.blockId !== b.id);
          relayoutBlocks(tl, tl.blocks.filter((x) => x.id !== b.id));
          break;
        }
        case 'move_block': {
          const tl = activeTimeline(p);
          const b = findBlock(p, a.block)!;
          const next = tl.blocks.filter((x) => x.id !== b.id);
          next.splice(Math.max(0, Math.min(next.length, num(a.index) ?? next.length)), 0, b);
          relayoutBlocks(tl, next);
          break;
        }
        case 'add_emitter': {
          const rgb = Array.isArray(a.color) ? (a.color as number[]) : null;
          const tl = activeTimeline(p);
          (tl.emitters ??= []).push({
            id: uid('e'), name: String(a.name),
            glyphs: (a.glyphs as unknown[]).map(String),
            color: rgb ? { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0, a: 1 } : { r: 108, g: 106, b: 128, a: 1 },
            size: num(a.size) ?? 26,
            path: (a.path as 'arc' | 'orbit' | 'fall') ?? 'arc',
            from: { nodeId: findNode(p, a.fromNode), x: num(a.fromX) ?? 40, y: num(a.fromY) ?? -34 },
            to: { nodeId: findNode(p, a.toNode), x: num(a.toX) ?? 110, y: num(a.toY) ?? -150 },
            bow: num(a.bow) ?? 20,
            ...(num(a.radiusX) !== undefined ? { radiusX: num(a.radiusX) } : {}),
            ...(num(a.radiusY) !== undefined ? { radiusY: num(a.radiusY) } : {}),
            rateMs: Math.max(40, num(a.rateMs) ?? 600),
            lifeMs: Math.max(120, num(a.lifeMs) ?? 1800),
            count: Math.max(1, Math.round(num(a.count) ?? 3)),
            fadeStart: Math.min(1, Math.max(0, num(a.fadeStart) ?? 0.5)),
            scaleFrom: num(a.scaleFrom) ?? 0.5, scaleTo: num(a.scaleTo) ?? 1.25,
            spin: num(a.spin) ?? 0,
            wobble: num(a.wobble) ?? 4, wobbleFrequency: num(a.wobbleFrequency) ?? 1.2,
            seed: num(a.seed) ?? 7,
            ...(num(a.startMs) !== undefined ? { startMs: num(a.startMs) } : {}),
            ...(num(a.endMs) !== undefined ? { endMs: num(a.endMs) } : {}),
          });
          break;
        }
        case 'set_effect_range': {
          const hit = findEffect(p, a.effect)!;
          const tl = activeTimeline(p);
          const target = hit.kind === 'emitter'
            ? tl.emitters!.find((e) => e.id === hit.id)!
            : tl.modifiers.find((m) => m.id === hit.id)!;
          target.startMs = num(a.startMs);
          target.endMs = num(a.endMs);
          break;
        }
        case 'add_timeline': {
          const tl = makeTimeline(uniqueName(String(a.name).trim(), p.timelines.map((t) => t.name)));
          p.timelines.push(tl);
          // anything the model emits after this belongs to the state it just made
          p.activeTimelineId = tl.id;
          break;
        }
        case 'set_camera': {
          // "perspective" is the label the inspector shows; `fov` is what it actually is
          const v = num(a.value)!;
          if (a.property === 'distance') p.rig.camera.distance = v;
          else p.rig.camera.fov = v;
          break;
        }
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
    // no coalesce label: every Apply is its own undo step. A timestamp label merged two
    // batches applied inside the same millisecond into one.
  });
}

/** The one place a tool-supplied track list becomes real tracks. */
function presetTracks(raw: unknown) {
  return (raw as Record<string, unknown>[]).map((t) => ({
    id: uid('t'), nodeId: String(t.nodeId), property: String(t.property),
    keyframes: ((t.keyframes ?? []) as Record<string, unknown>[])
      .map((k) => ({ id: uid('k'), time: num(k.time) ?? 0, value: num(k.value) ?? 0, easingOut: easingOf(k.easing) }))
      .sort((x, y) => x.time - y.time),
  })).filter((t) => t.keyframes.length);
}

/** A property with a track can't be set statically — the track would just mask it. */
function setBase(p: Project, nodeId: string, property: string, v: number) {
  const track = activeTimeline(p).tracks.find((t) => t.nodeId === nodeId && t.property === property);
  if (track) { writeKeyframe(p, nodeId, property, 0, v, { type: 'preset', name: 'easeInOut' }); return; }
  const node = p.rig.nodes[nodeId];
  if (node) setProp(node, property, v);
}
