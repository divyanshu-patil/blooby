import { uniqueName, useEditor, writeKeyframe } from '../core/store';
import { attachPresetEffects, makeTimeline, uid } from '../core/defaults';
import { namedEasing, EASING_NAMES } from '../core/easing';
import { blockAt, blocksEnd, relayoutBlocks } from '../core/timeline';
import { activeTrackFor } from '../core/scene';
import { setProp } from '../core/props';
import { activeTimeline, MODIFIER_KINDS, MODIFIERS } from '../core/types';
import { defaultValueFor, directTransition, machineOf, OPERATORS } from '../core/stateMachine';
import { libraryOutline, shapeById, SHAPE_LIBRARY } from '../core/emitters';
import { NUMERIC_PROPS, PROPS, resolveProp } from '../core/props';
import {
  duplicateLayer, makeGroup, makeLimb, makeShapeLayer, makeSvgLayer, removeLayer, reorderLayer,
  setAppearance, setAttachment, setMorph, topZ, writeValue, type AppearanceRange,
} from '../core/layers';
import { looksLikeSvg } from '../core/svg';
import { COMP_MAX, COMP_MIN, COMP_PRESETS, compOf } from '../core/comp';
import { MORPH_MODE_NAMES, type MorphMode } from '../core/easing';
import { parseHex } from '../core/color';
import type { ColorStop, ConditionOp, EasingCurve, InputType, InputValue, KeyValue, LineCap, LineJoin, ModifierKind, Project, RigNode, SmCondition, Vec2 } from '../core/types';

export type ToolCall = { name: string; args: Record<string, unknown> };

/** Every tool the copilot can call. The schema, the parser and `validate` all read this. */
export const TOOL_NAMES = [
  'set_eye_params', 'set_property', 'add_keyframe', 'create_expression', 'apply_expression',
  'create_preset', 'add_preset_to_timeline', 'add_modifier', 'morph_between',
  'set_timeline', 'clear_animation', 'set_block_duration', 'remove_block', 'move_block',
  'add_timeline', 'set_camera', 'remove_keyframe', 'move_keyframe', 'edit_preset',
  'add_emitter', 'set_effect_range', 'set_shape', 'set_emitter_parts',
  'add_input', 'add_transition',
  // freeform layers, paint, shape morphs, limbs, the canvas and states — see TOOL_DOCS
  'add_layer', 'add_svg', 'remove_layer', 'duplicate_layer', 'reorder_layer',
  'set_layer_visibility', 'set_layer_lock', 'set_layer_attachment', 'set_layer_appearance_range',
  'set_svg_fill', 'set_svg_stroke', 'set_svg_stroke_width', 'set_shape_morph',
  'set_hand_points', 'set_hand_rig', 'set_leg_points', 'set_leg_rig',
  'set_composition', 'set_state', 'set_transition',
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
                      // scope \u2014 the clip it belongs to, or the timeline. Omit both to run always.

set_shape             { nodeId, shape, points?, innerRatio?, cornerRadius?, vertexRadius?, rotation?, atMs? }
                      // shape is any id from the shape library: ${SHAPE_LIBRARY.filter((s) => s.outline).map((s) => s.id).join(', ')},
                      // or any artwork id listed under set_emitter_parts. On the body this changes
                      // the MASCOT's shape \u2014 pebble, capsule (the pill), roundedRect, blob, octopus.
                      // gives a layer an outline. With atMs it is a keyframe, and two keyframes
                      // holding different shapes MORPH \u2014 that is how an eye becomes a star.
                      // points: sides, or a star's points. innerRatio: a star's waist, 0.05-0.9.
                      // vertexRadius: rounds the points, 0-1. cornerRadius: a rect's corners.
                      // The body is naturally a circle and an eye a pill \u2014 start a morph from
                      // that shape, or the first frame pops.
set_emitter_parts     { emitter, parts: [{ shape, color?, speed?, size?, spin? }] }
                      // what an emitter throws. shape is one of:
                      // ${SHAPE_LIBRARY.map((s) => s.id).join(', ')}
                      // Several parts at different speeds, sizes and colours is what makes a
                      // burst read \u2014 one shape repeated does not.

add_input             { name, type: "Boolean"|"Numeric"|"String"|"Event", default?, description? }
                      // a STATE MACHINE input the app sets at runtime. A name that already exists
                      // is REUSED, never duplicated \u2014 so always add_input before referring to one.
add_transition        { from, to, conditions: [{ input, operator, value? }], logic?, durationMs?, easing? }
                      // from/to are STATE names (timelines). operator is one of:
                      //   Boolean: "is true" | "is false"
                      //   Numeric: "==" "!=" ">" ">=" "<" "<="
                      //   String:  "==" "!="
                      //   Event:   "fired"
                      // logic is "AND" (default) or "OR" across several conditions.
                      // This is how behaviour is authored: "look at me when I'm typing" is an
                      // isTyping Boolean plus watching -> observing when it is true, NEVER a call
                      // that plays an animation. The machine decides which state is active.
set_state             { state }                                // make that state (timeline) the active one
set_transition        { to, from?: "current"|"any"|<state>, durationMs?, easing?, input? }
                      // CURRENT -> TARGET as ONE direct edge, on a String input "state" set to the
                      // target's name (created if missing). from defaults to "current" — the active
                      // state. "any" adds one direct edge from every other state. Never chain
                      // through states in between: Excited -> Angry is one call, not three.

LAYERS — every object is a real animation layer. nodeId takes a layer's id or its name.
Positions are px, +x right, +y DOWN: from the composition centre for a WORLD layer, from the
body centre for one attached to the MASCOT.
add_layer             { type: "shape"|"hand"|"leg"|"group", shape?, name?, x?, y?, width?, height?,
                        fill?, attach?: "world"|"mascot", side?: "left"|"right"|"both" }
                      // shape: a shape library id (see set_shape). fill: [r,g,b] or "#rrggbb".
                      // "hand" / "leg" add rubber-hose limbs to the body, both sides by default.
add_svg               { markup, name?, x?, y?, attach? }       // a whole <svg>…</svg>; becomes vector paths
remove_layer          { nodeId }
duplicate_layer       { nodeId }
reorder_layer         { nodeId, to: "front"|"back"|"forward"|"backward" }  // the one draw order
set_layer_visibility  { nodeId, visible }                      // the layer list's eye, not animated
set_layer_lock        { nodeId, locked }
set_layer_attachment  { nodeId, mode: "world"|"mascot", anchor? }
                      // "mascot" makes it follow the head (anchor defaults to the body); it lands ON
                      // the sphere, so surface.yaw / surface.pitch then carry it round the head.
                      // Either way it keeps its place on screen.
set_layer_appearance_range { nodeId, startMs?, endMs?, fadeInMs?, fadeOutMs?, clear? }
                      // absolute ms: when the layer EXISTS. Keyframe "opacity" for how it looks.
set_svg_fill          { nodeId, color?, opacity?, enabled?, atMs? }
set_svg_stroke        { nodeId, color?, width?, opacity?, enabled?, cap?, join?, atMs? }
set_svg_stroke_width  { nodeId, width, atMs? }
                      // fill and stroke are separate tracks: with atMs each writes a keyframe, so
                      // "fill blue -> pink while the stroke goes black -> white" is four calls.
set_shape_morph       { nodeId, atMs, mode: ${MORPH_MODE_NAMES.map((m) => `"${m}"`).join('|')}, durationMs? }
                      // how the shape keyframe at atMs becomes the next one; durationMs moves the next
set_hand_points       { nodeId, shoulder?: {x,y}, hand?: {x,y}, atMs? }       // body px, +y down
set_hand_rig          { nodeId, rubberHose?, length?, thickness?, bend?, roundness?, taper?, atMs? }
set_leg_points        { nodeId, hip?: {x,y}, knee?: {x,y}, ankle?: {x,y}, atMs? }
set_leg_rig           { nodeId, rubberHose?, length?, thickness?, bend?, roundness?, taper?,
                        footAngle?, footLength?, footWidth?, atMs? }
                      // a hand has exactly two points and a leg three. length is the hose's own
                      // length in px and it is KEPT (Cavalry-style): points closer than it make
                      // the limb bend, further and it straightens without stretching. So "longer"
                      // and "bend more" are both a longer length (~+30%), or the points closer.
                      // bend: its sign flips the side, ±1 a smooth arc, 0 a sharp elbow.
set_composition       { width?, height?, preset?: ${COMP_PRESETS.map((c) => `"${c.width}x${c.height}"`).join('|')} }`.trim()

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

/** A state by name (or id) — the machine's states are the project's timelines. */
function findState(p: Project, ref: unknown) {
  const s = str(ref)?.toLowerCase();
  return p.timelines.find((t) => t.id === ref || t.name.toLowerCase() === s);
}

/**
 * The operator vocabulary the model writes in — `>`, `is true` — mapped onto dotLottie's
 * own `conditionType`. Models reach for the symbols the spec's own examples use, and a
 * tool that only accepted "GreaterThanOrEqual" would be wrong most of the time.
 */
const OPERATOR_WORDS: Record<string, ConditionOp> = {
  '==': 'Equal', '=': 'Equal', 'equal': 'Equal', 'equals': 'Equal',
  '!=': 'NotEqual', '<>': 'NotEqual', 'notequal': 'NotEqual',
  '>': 'GreaterThan', 'greaterthan': 'GreaterThan',
  '>=': 'GreaterThanOrEqual', 'greaterthanorequal': 'GreaterThanOrEqual',
  '<': 'LessThan', 'lessthan': 'LessThan',
  '<=': 'LessThanOrEqual', 'lessthanorequal': 'LessThanOrEqual',
  'is true': 'Equal', 'istrue': 'Equal', 'true': 'Equal',
  'is false': 'Equal', 'isfalse': 'Equal', 'false': 'Equal',
  'fired': 'Fired', 'fires': 'Fired',
};
const opWord = (v: unknown) => OPERATOR_WORDS[String(v ?? '').trim().toLowerCase()];
/** "is false" carries its value in the operator, which is the only place it can live. */
const opNegates = (v: unknown) => /^(is\s*)?false$/i.test(String(v ?? '').trim());

const INPUT_TYPES = ['Boolean', 'Numeric', 'String', 'Event'] as const;

/** One `{ input, operator, value }` from the model, checked against the input it names. */
function conditionOf(p: Project, raw: unknown): SmCondition | string {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') return 'a condition is not an object';
  const name = str(c.input);
  const input = machineOf(p).inputs.find((i) => i.name === name);
  if (!input) return `no input "${String(c.input)}" — call add_input first`;
  if (input.type === 'Event') return { input: input.name, operator: 'Fired' };
  const op = opWord(c.operator);
  if (!op || !OPERATORS[input.type].includes(op)) {
    return `"${String(c.operator)}" cannot be used on the ${input.type} input "${input.name}"`;
  }
  const value: InputValue = input.type === 'Boolean'
    ? (c.value !== undefined ? c.value === true : !opNegates(c.operator))
    : input.type === 'Numeric'
      ? (num(c.value) ?? 0)
      : String(c.value ?? '');
  return { input: input.name, operator: op, value };
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

/** A layer by id or name — `findNode`, returning the node itself. */
const layerOf = (p: Project, ref: unknown): RigNode | undefined => {
  const id = findNode(p, ref);
  return id ? p.rig.nodes[id] : undefined;
};

/** [r,g,b], "#rrggbb" or {r,g,b} — however a model writes a colour. */
function colorOf(v: unknown): ColorStop | undefined {
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const [r, g, b, a] = v as number[];
    const c = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
    return { r: c(r), g: c(g), b: c(b), a: typeof a === 'number' ? Math.min(1, Math.max(0, a > 1 ? a / 255 : a)) : 1 };
  }
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$|^#?[0-9a-f]{3}$/i.test(v.trim())) return parseHex(v.trim());
  if (v && typeof v === 'object' && 'r' in v) return colorOf([(v as ColorStop).r, (v as ColorStop).g, (v as ColorStop).b, (v as ColorStop).a ?? 1]);
  return undefined;
}

/** {x,y} or [x,y]. */
function ptOf(v: unknown): Vec2 | undefined {
  if (Array.isArray(v) && num(v[0]) !== undefined && num(v[1]) !== undefined) return { x: v[0], y: v[1] };
  if (v && typeof v === 'object' && num((v as Vec2).x) !== undefined && num((v as Vec2).y) !== undefined) return { x: (v as Vec2).x, y: (v as Vec2).y };
  return undefined;
}

const LIMB_POINTS = { arm: { shoulder: 'a', hand: 'b' }, leg: { hip: 'a', knee: 'b', ankle: 'c' } } as const;
const LIMB_DIALS: Record<string, string> = {
  length: 'limb.length', thickness: 'limb.thickness', bend: 'limb.bend', roundness: 'limb.roundness', taper: 'limb.taper',
  footAngle: 'limb.foot.angle', footLength: 'limb.foot.length', footWidth: 'limb.foot.width',
};
const CAPS: LineCap[] = ['butt', 'round', 'square'];
const JOINS: LineJoin[] = ['miter', 'round', 'bevel'];
const ADD_TYPES = ['shape', 'hand', 'leg', 'group'] as const;
const REORDER = ['front', 'back', 'forward', 'backward'] as const;

/** A limb of the given type, found by id or name — or why not. */
function limbCheck(p: Project, ref: unknown, type: 'arm' | 'leg'): string | null {
  const n = layerOf(p, ref);
  if (!n) return `no layer "${String(ref)}"`;
  if (n.limb?.type !== type) return `"${n.name}" is not a ${type === 'arm' ? 'hand' : 'leg'} — add one with add_layer { type: "${type === 'arm' ? 'hand' : 'leg'}" }`;
  return null;
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
  const view: Project = {
    ...p,
    rig: { ...p.rig, nodes: { ...p.rig.nodes } },
    presets: [...p.presets],
    expressions: [...p.expressions],
    // tracks copied per timeline, so a stand-in track below never lands in the real project
    timelines: p.timelines.map((t) => ({ ...t, tracks: [...t.tracks] })),
    stateMachine: { ...machineOf(p), inputs: [...machineOf(p).inputs] },
  };
  return calls.map((call) => {
    const problem = validate(view, call);
    if (problem) return problem;
    const a = call.args ?? {};
    // "add a star, then make it fade in" names a layer the first call has not made yet
    for (const n of plannedLayers(view, call)) view.rig.nodes[n.id] = n;
    // and "key a shape, then say how it morphs" names a keyframe it has not made yet
    if (call.name === 'set_shape' && num(a.atMs) !== undefined) {
      const id = findNode(view, a.nodeId), tl = activeTimeline(view);
      if (id && !activeTrackFor(tl, id, 'shape.path', num(a.atMs)!)) {
        tl.tracks.push({ id: `__planned_${id}`, nodeId: id, property: 'shape.path', blockId: blockAt(tl, num(a.atMs)!)?.id,
          keyframes: [{ id: '__k', time: num(a.atMs)!, value: '', easingOut: { type: 'linear' } }] });
      }
    }
    if (call.name === 'create_preset') view.presets.push({ id: uid('p'), name: String(a.name), source: 'custom', durationMs: 0, tracks: [] });
    if (call.name === 'create_expression') view.expressions.push({ id: uid('x'), name: String(a.name), snapshot: {} });
    // a batch that adds a state (or an input) and then references it is the normal shape
    // of "make Blooby look at me when I'm typing" — the view has to see its own earlier calls
    if (call.name === 'add_timeline') view.timelines.push(makeTimeline(String(a.name).trim()));
    if (call.name === 'add_input' && !view.stateMachine!.inputs.some((i) => i.name === str(a.name))) {
      const type = String(a.type) as InputType;
      view.stateMachine!.inputs.push({ name: str(a.name)!, type, value: (a.default as InputValue | undefined) ?? defaultValueFor(type) });
    }
    return null;
  });
}

/**
 * The layers an add_layer / add_svg call will create, exactly as applyCalls builds them —
 * names included, so a later call in the same batch can find them by name.
 */
function plannedLayers(p: Project, call: ToolCall): RigNode[] {
  const a = call.args ?? {};
  if (call.name === 'add_svg') {
    const made = makeSvgLayer(String(a.markup ?? ''), str(a.name));
    return made ? [placed(p, made.node, a)] : [];
  }
  if (call.name !== 'add_layer') return [];
  const type = String(a.type ?? 'shape');
  const root = p.rig.rootId;
  if (type === 'hand' || type === 'leg') {
    const sides: (-1 | 1)[] = a.side === 'left' ? [-1] : a.side === 'right' ? [1] : [-1, 1];
    return sides.map((s) => makeLimb(type === 'hand' ? 'arm' : 'leg', s, root, str(a.name) && sides.length === 1 ? { name: str(a.name)! } : {}));
  }
  if (type === 'group') return [placed(p, makeGroup(null, { name: str(a.name) ?? 'Group' }), a)];
  const shape = str(a.shape) && shapeById(str(a.shape)!) ? str(a.shape)! : 'circle';
  const node = makeShapeLayer('circle', { name: str(a.name) ?? shapeById(shape)?.name ?? 'Shape', shape: { kind: shape } });
  node.shapePath = libraryOutline(shape) ?? node.shapePath;
  const w = num(a.width), h = num(a.height);
  if (w || h) node.size = { x: Math.max(1, w ?? h ?? 96), y: Math.max(1, h ?? w ?? 96) };
  const fill = colorOf(a.fill ?? a.color);
  if (fill) node.color = fill;
  return [placed(p, node, a)];
}

/** Where a new layer goes: world by default, or on the mascot; x/y from that frame's centre. */
function placed(p: Project, node: RigNode, a: Record<string, unknown>): RigNode {
  const onMascot = a.attach === 'mascot';
  return {
    ...node,
    parentId: onMascot ? p.rig.rootId : null,
    surface: { ...node.surface, mapped: false, flatOffset: { x: num(a.x) ?? node.surface.flatOffset?.x ?? 0, y: num(a.y) ?? node.surface.flatOffset?.y ?? 0 } },
  };
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
    case 'add_input': {
      if (!str(a.name)) return 'add_input needs a name';
      if (!(INPUT_TYPES as readonly string[]).includes(String(a.type))) return `add_input type must be one of ${INPUT_TYPES.join(', ')}`;
      return null;
    }
    case 'add_transition': {
      if (!findState(p, a.from)) return `no state "${String(a.from)}" — add_timeline first`;
      if (!findState(p, a.to)) return `no state "${String(a.to)}" — add_timeline first`;
      if (!Array.isArray(a.conditions) || !a.conditions.length) return 'add_transition needs at least one condition';
      for (const raw of a.conditions) {
        const c = conditionOf(p, raw);
        if (typeof c === 'string') return c;
      }
      return null;
    }
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
    case 'set_shape': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (n.kind === 'limb' || n.kind === 'group') return `"${n.name}" is a ${n.kind} and has no outline to set`;
      return shapeById(String(a.shape)) ? null : `shape must be a shape library id: ${SHAPE_LIBRARY.map((s) => s.id).join(', ')}`;
    }
    case 'add_layer': {
      if (!(ADD_TYPES as readonly string[]).includes(String(a.type ?? 'shape'))) return `type must be one of ${ADD_TYPES.join(', ')}`;
      if (a.shape !== undefined && !shapeById(String(a.shape))) return `no shape "${String(a.shape)}" — use a shape library id: ${SHAPE_LIBRARY.map((s) => s.id).join(', ')}`;
      if (a.attach !== undefined && a.attach !== 'world' && a.attach !== 'mascot') return 'attach must be "world" or "mascot"';
      if ((a.fill ?? a.color) !== undefined && !colorOf(a.fill ?? a.color)) return 'fill must be [r,g,b] or "#rrggbb"';
      return null;
    }
    case 'add_svg':
      if (!looksLikeSvg(String(a.markup ?? ''))) return 'markup must be a whole <svg>…</svg>';
      return makeSvgLayer(String(a.markup)) ? null : 'that SVG could not be read';
    case 'remove_layer':
    case 'duplicate_layer': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      return n.id === p.rig.rootId ? `the body cannot be ${call.name === 'remove_layer' ? 'removed' : 'duplicated'}` : null;
    }
    case 'reorder_layer':
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      return (REORDER as readonly string[]).includes(String(a.to)) || num(a.to) !== undefined ? null : `to must be one of ${REORDER.join(', ')}`;
    case 'set_layer_visibility':
    case 'set_layer_lock': {
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      const flag = call.name === 'set_layer_lock' ? a.locked : a.visible;
      return typeof flag === 'boolean' ? null : `${call.name === 'set_layer_lock' ? 'locked' : 'visible'} must be true or false`;
    }
    case 'set_layer_attachment': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (n.id === p.rig.rootId) return 'the body is the mascot — it cannot be attached to itself';
      if (a.mode !== 'world' && a.mode !== 'mascot') return 'mode must be "world" or "mascot"';
      if (a.anchor !== undefined && !layerOf(p, a.anchor)) return `no layer "${String(a.anchor)}" to anchor to`;
      return null;
    }
    case 'set_layer_appearance_range': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (n.id === p.rig.rootId) return 'the body is always on screen';
      const keys = ['startMs', 'endMs', 'fadeInMs', 'fadeOutMs'].filter((k) => a[k] !== undefined);
      if (!keys.length && a.clear !== true) return 'give startMs/endMs (and optionally fadeInMs/fadeOutMs), or clear: true';
      return keys.every((k) => num(a[k]) !== undefined && num(a[k])! >= 0) ? null : `${keys.join(', ')} must be numbers >= 0`;
    }
    case 'set_svg_fill':
    case 'set_svg_stroke':
    case 'set_svg_stroke_width': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (n.kind === 'group') return `"${n.name}" is a group and has no paint`;
      if (a.color !== undefined && !colorOf(a.color)) return 'color must be [r,g,b] or "#rrggbb"';
      if (call.name === 'set_svg_stroke_width') return num(a.width) !== undefined && num(a.width)! >= 0 ? null : 'width must be a number >= 0';
      if (a.cap !== undefined && !CAPS.includes(a.cap as LineCap)) return `cap must be one of ${CAPS.join(', ')}`;
      if (a.join !== undefined && !JOINS.includes(a.join as LineJoin)) return `join must be one of ${JOINS.join(', ')}`;
      const any = ['color', 'opacity', 'enabled', 'width', 'cap', 'join'].some((k) => a[k] !== undefined);
      return any ? null : `${call.name} needs at least one of color, opacity, enabled${call.name === 'set_svg_stroke' ? ', width, cap, join' : ''}`;
    }
    case 'set_shape_morph': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (!MORPH_MODE_NAMES.includes(a.mode as MorphMode)) return `mode must be one of ${MORPH_MODE_NAMES.join(', ')}`;
      if (num(a.atMs) === undefined) return 'atMs must be a number — the time of a shape keyframe';
      return activeTrackFor(activeTimeline(p), n.id, 'shape.path', num(a.atMs)!) ? null : `"${n.name}" has no shape keyframes — set_shape with atMs first`;
    }
    case 'set_hand_points':
    case 'set_leg_points': {
      const type = call.name === 'set_hand_points' ? 'arm' : 'leg';
      const bad = limbCheck(p, a.nodeId, type);
      if (bad) return bad;
      const names = Object.keys(LIMB_POINTS[type]);
      const given = names.filter((k) => a[k] !== undefined);
      if (!given.length) return `give at least one of ${names.join(', ')} as {x, y}`;
      return given.every((k) => ptOf(a[k])) ? null : `${given.join(', ')} must each be {x, y}`;
    }
    case 'set_hand_rig':
    case 'set_leg_rig': {
      const type = call.name === 'set_hand_rig' ? 'arm' : 'leg';
      const bad = limbCheck(p, a.nodeId, type);
      if (bad) return bad;
      const dials = Object.keys(LIMB_DIALS).filter((k) => type === 'leg' || !k.startsWith('foot'));
      const given = dials.filter((k) => a[k] !== undefined);
      if (!given.length && a.rubberHose === undefined) return `give at least one of rubberHose, ${dials.join(', ')}`;
      return given.every((k) => num(a[k]) !== undefined) ? null : `${given.join(', ')} must be numbers`;
    }
    case 'set_composition': {
      if (a.preset !== undefined && !COMP_PRESETS.some((c) => `${c.width}x${c.height}` === String(a.preset).replace(/\s|×/g, 'x').replace(/x+/g, 'x'))) return `preset must be one of ${COMP_PRESETS.map((c) => `${c.width}x${c.height}`).join(', ')}`;
      if (a.preset === undefined && a.width === undefined && a.height === undefined) return 'set_composition needs width, height or a preset';
      for (const k of ['width', 'height'] as const) {
        if (a[k] !== undefined && !(num(a[k])! >= COMP_MIN && num(a[k])! <= COMP_MAX)) return `${k} must be ${COMP_MIN}-${COMP_MAX}`;
      }
      return null;
    }
    case 'set_state':
      return findState(p, a.state) ? null : `no state "${String(a.state)}" — the states are ${p.timelines.map((t) => t.name).join(', ')}`;
    case 'set_transition': {
      const to = findState(p, a.to);
      if (!to) return `no state "${String(a.to)}"`;
      const from = a.from === undefined || a.from === 'current' || a.from === 'any' ? null : findState(p, a.from);
      if (a.from !== undefined && a.from !== 'current' && a.from !== 'any' && !from) return `no state "${String(a.from)}"`;
      if ((from?.id ?? p.activeTimelineId) === to.id && a.from !== 'any') return `already in "${to.name}" — say which state to come from`;
      const input = str(a.input) && machineOf(p).inputs.find((i) => i.name === str(a.input));
      if (input && (input.type === 'Boolean' || input.type === 'Event')) return `"${input.name}" is ${input.type}; a direct transition needs a String or Numeric input`;
      return null;
    }
    case 'set_emitter_parts': {
      const hit = findEffect(p, a.emitter);
      if (!hit || hit.kind !== 'emitter') return `no emitter called "${String(a.emitter)}"`;
      if (!Array.isArray(a.parts) || !a.parts.length) return 'set_emitter_parts needs at least one part';
      for (const pt of a.parts as Record<string, unknown>[]) {
        if (!shapeById(String(pt?.shape))) return `no shape "${String(pt?.shape)}" — use one of ${SHAPE_LIBRARY.map((x) => x.id).join(', ')}`;
      }
      return null;
    }
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
    case 'add_input': return machineOf(p).inputs.some((i) => i.name === str(a.name))
      ? `Reuse the existing ${a.type} input "${a.name}"`
      : `Add a ${a.type} state-machine input "${a.name}"`;
    case 'add_transition': {
      const conds = (a.conditions as Record<string, unknown>[]).map((c) => `${c.input} ${c.operator ?? ''} ${c.value ?? ''}`.trim());
      return `${a.from} → ${a.to} when ${conds.join(a.logic === 'OR' ? ' or ' : ' and ')}`;
    }
    case 'set_camera': return `Set camera ${a.property} to ${a.value}`;
    case 'add_emitter': {
      const where = a.fromNode ? ` from ${name(a.fromNode)}` : '';
      return `Emit ${(a.glyphs as string[]).slice(0, 4).join(' ')} on a ${a.path ?? 'arc'} path${where} — "${a.name}"`;
    }
    case 'set_shape':
      return `Make ${name(a.nodeId)} a ${shapeById(String(a.shape))?.name ?? a.shape}${a.atMs !== undefined ? ` at ${at(a.atMs)} — morphs from whatever it was` : ''}`;
    case 'add_layer': {
      const type = String(a.type ?? 'shape');
      if (type === 'hand' || type === 'leg') return `Add ${a.side === 'left' || a.side === 'right' ? `a ${a.side}` : 'both'} rubber-hose ${type === 'hand' ? 'hand' : 'leg'}${a.side === 'left' || a.side === 'right' ? '' : 's'}`;
      if (type === 'group') return `Add a group${a.name ? ` "${a.name}"` : ''}`;
      return `Add a ${shapeById(String(a.shape ?? 'circle'))?.name.toLowerCase() ?? 'shape'} layer${a.name ? ` "${a.name}"` : ''}${a.attach === 'mascot' ? ' on the mascot' : ''}`;
    }
    case 'add_svg': return `Add an SVG layer${a.name ? ` "${a.name}"` : ''}${a.attach === 'mascot' ? ' on the mascot' : ''}`;
    case 'remove_layer': return `Remove ${name(a.nodeId)}`;
    case 'duplicate_layer': return `Duplicate ${name(a.nodeId)}`;
    case 'reorder_layer': return `Move ${name(a.nodeId)} ${a.to === 'front' || a.to === 'back' ? `to the ${a.to}` : a.to}`;
    case 'set_layer_visibility': return `${a.visible ? 'Show' : 'Hide'} ${name(a.nodeId)}`;
    case 'set_layer_lock': return `${a.locked ? 'Lock' : 'Unlock'} ${name(a.nodeId)}`;
    case 'set_layer_attachment': return a.mode === 'world'
      ? `Detach ${name(a.nodeId)} into world space, where it is now`
      : `Attach ${name(a.nodeId)} to ${a.anchor ? name(a.anchor) : 'the mascot'}, so it follows it`;
    case 'set_layer_appearance_range': return a.clear
      ? `Show ${name(a.nodeId)} for the whole timeline`
      : `Show ${name(a.nodeId)} ${a.startMs !== undefined ? `from ${at(a.startMs)} ` : ''}${a.endMs !== undefined ? `to ${at(a.endMs)}` : ''}${a.fadeInMs ? `, fading in ${a.fadeInMs}ms` : ''}${a.fadeOutMs ? `, out ${a.fadeOutMs}ms` : ''}`.trim();
    case 'set_svg_fill': return `${name(a.nodeId)} fill${a.color !== undefined ? ` ${colorName(a.color)}` : ''}${a.opacity !== undefined ? ` at ${a.opacity} opacity` : ''}${a.enabled === false ? ' off' : ''}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_svg_stroke': return `${name(a.nodeId)} stroke${a.color !== undefined ? ` ${colorName(a.color)}` : ''}${a.width !== undefined ? ` ${a.width}px` : ''}${a.enabled === false ? ' off' : ''}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_svg_stroke_width': return `${name(a.nodeId)} stroke width ${a.width}px${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_shape_morph': return `Morph ${name(a.nodeId)}'s shape at ${at(a.atMs)} with ${String(a.mode)}${a.durationMs !== undefined ? ` over ${a.durationMs}ms` : ''}`;
    case 'set_hand_points':
    case 'set_leg_points': {
      const keys = Object.keys(LIMB_POINTS[call.name === 'set_hand_points' ? 'arm' : 'leg']).filter((k) => ptOf(a[k]));
      return `Move ${name(a.nodeId)}'s ${keys.map((k) => `${k} to ${ptOf(a[k])!.x},${ptOf(a[k])!.y}`).join(', ')}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    }
    case 'set_hand_rig':
    case 'set_leg_rig': {
      const bits = [
        a.rubberHose !== undefined ? `rubber hose ${a.rubberHose ? 'on' : 'off'}` : null,
        ...Object.keys(LIMB_DIALS).filter((k) => num(a[k]) !== undefined).map((k) => `${k} ${a[k]}`),
      ].filter(Boolean);
      return `${name(a.nodeId)}: ${bits.join(', ')}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    }
    case 'set_composition': return `Canvas ${a.preset ?? `${a.width ?? compOf(p).width}×${a.height ?? compOf(p).height}`}`;
    case 'set_state': return `Switch to the "${named(findState(p, a.state), a.state)}" state`;
    case 'set_transition': {
      const from = a.from === 'any' ? 'any state' : a.from && a.from !== 'current' ? named(findState(p, a.from), a.from) : `${p.timelines.find((t) => t.id === p.activeTimelineId)?.name ?? 'the current state'} (current)`;
      return `${from} → ${named(findState(p, a.to), a.to)} directly${a.durationMs !== undefined ? `, ${a.durationMs}ms` : ''}`;
    }
    case 'set_emitter_parts':
      return `"${a.emitter}" throws ${(a.parts as { shape: string }[]).map((x) => x.shape).join(', ')}`;
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

const colorName = (v: unknown) => { const c = colorOf(v); return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : String(v); };

const EYE_MAP: Record<string, string> = {
  openness: 'eye.openness', distanceFromCenter: 'eye.distanceFromCenter', length: 'transform.length',
  scaleX: 'transform.scale.x', scaleY: 'transform.scale.y', rotation: 'transform.rotation',
};

/** Applies a validated batch as ONE undo step. */
export function applyCalls(calls: ToolCall[]) {
  const store = useEditor.getState();
  const playhead = store.playhead;
  store.commit((p) => {
    // a value at atMs is a keyframe; with no atMs it lands where it will show at the
    // playhead — into the track driving it there, or onto the resting pose
    const put = (nodeId: string, prop: string, v: KeyValue, a: Record<string, unknown>) => {
      if (num(a.atMs) !== undefined) writeKeyframe(p, nodeId, prop, num(a.atMs)!, v, easingOf(a.easing));
      else writeValue(p, nodeId, prop, v, playhead);
    };
    // names resolve at apply time too: a layer made earlier in this batch has an id now
    const nid = (ref: unknown) => findNode(p, ref) ?? String(ref);
    for (const call of calls) {
      const a = call.args ?? {};
      switch (call.name) {
        case 'add_layer':
        case 'add_svg': {
          for (const n of plannedLayers(p, call)) {
            if (n.kind !== 'limb') n.zIndex = topZ(p.rig);
            p.rig.nodes[n.id] = n;
          }
          break;
        }
        case 'remove_layer': removeLayer(p, nid(a.nodeId)); break;
        case 'duplicate_layer': duplicateLayer(p, nid(a.nodeId)); break;
        case 'reorder_layer': reorderLayer(p, nid(a.nodeId), num(a.to) ?? (a.to as 'front')); break;
        case 'set_layer_visibility': { const n = p.rig.nodes[nid(a.nodeId)]; if (n) n.visible = a.visible === true; break; }
        case 'set_layer_lock': { const n = p.rig.nodes[nid(a.nodeId)]; if (n) n.locked = a.locked === true; break; }
        case 'set_layer_attachment':
          setAttachment(p, nid(a.nodeId), a.mode as 'world' | 'mascot', a.anchor === undefined ? undefined : nid(a.anchor), playhead);
          break;
        case 'set_layer_appearance_range': {
          if (a.clear === true) { setAppearance(p, nid(a.nodeId), null, playhead); break; }
          const range: AppearanceRange = {};
          for (const k of ['startMs', 'endMs', 'fadeInMs', 'fadeOutMs'] as const) if (num(a[k]) !== undefined) range[k] = num(a[k]);
          setAppearance(p, nid(a.nodeId), range, num(a.startMs) ?? playhead);
          break;
        }
        case 'set_svg_fill': {
          const id = nid(a.nodeId);
          const c = colorOf(a.color);
          if (c) put(id, 'color', c, a);
          if (num(a.opacity) !== undefined) put(id, 'fill.opacity', Math.min(1, Math.max(0, num(a.opacity)!)), a);
          if (typeof a.enabled === 'boolean') put(id, 'fill.enabled', a.enabled ? 1 : 0, a);
          break;
        }
        case 'set_svg_stroke':
        case 'set_svg_stroke_width': {
          const id = nid(a.nodeId);
          const c = colorOf(a.color);
          // asking for a stroke's colour or width is asking for a stroke
          if (typeof a.enabled === 'boolean') put(id, 'stroke.enabled', a.enabled ? 1 : 0, a);
          else if (c || num(a.width) !== undefined) put(id, 'stroke.enabled', 1, a);
          if (c) put(id, 'stroke.color', c, a);
          if (num(a.width) !== undefined) put(id, 'stroke.width', Math.max(0, num(a.width)!), a);
          if (num(a.opacity) !== undefined) put(id, 'stroke.opacity', Math.min(1, Math.max(0, num(a.opacity)!)), a);
          const n = p.rig.nodes[id];
          if (n && (a.cap || a.join)) n.stroke = { ...n.stroke, ...(a.cap ? { lineCap: a.cap as LineCap } : {}), ...(a.join ? { lineJoin: a.join as LineJoin } : {}) };
          break;
        }
        case 'set_shape_morph':
          setMorph(p, nid(a.nodeId), num(a.atMs)!, a.mode as MorphMode, num(a.durationMs));
          break;
        case 'set_hand_points':
        case 'set_leg_points': {
          const id = nid(a.nodeId);
          const map = LIMB_POINTS[call.name === 'set_hand_points' ? 'arm' : 'leg'] as Record<string, string>;
          for (const [word, key] of Object.entries(map)) {
            const pt = ptOf(a[word]);
            if (!pt) continue;
            put(id, `limb.${key}.x`, pt.x, a);
            put(id, `limb.${key}.y`, pt.y, a);
          }
          break;
        }
        case 'set_hand_rig':
        case 'set_leg_rig': {
          const id = nid(a.nodeId);
          if (a.rubberHose !== undefined) put(id, 'limb.hose', a.rubberHose ? 1 : 0, a);
          for (const [k, prop] of Object.entries(LIMB_DIALS)) if (num(a[k]) !== undefined) put(id, prop, num(a[k])!, a);
          break;
        }
        case 'set_composition': {
          const preset = COMP_PRESETS.find((c) => `${c.width}x${c.height}` === String(a.preset ?? '').replace(/\s|×/g, 'x').replace(/x+/g, 'x'));
          const cur = compOf(p);
          p.composition = compOf({ composition: { width: preset?.width ?? num(a.width) ?? cur.width, height: preset?.height ?? num(a.height) ?? cur.height } });
          break;
        }
        case 'set_state': p.activeTimelineId = findState(p, a.state)!.id; break;
        case 'set_transition': {
          const to = findState(p, a.to)!;
          const from = a.from && a.from !== 'current' && a.from !== 'any' ? findState(p, a.from)!.id : p.activeTimelineId;
          directTransition(p, from, to.id, {
            durationMs: num(a.durationMs) ?? to.transitionMs ?? 300, easing: easingOf(a.easing),
            fromAny: a.from === 'any', ...(str(a.input) ? { input: str(a.input) } : {}),
          });
          break;
        }
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
        case 'set_shape': {
          const params = {
            points: num(a.points), innerRatio: num(a.innerRatio),
            cornerRadius: num(a.cornerRadius), vertexRadius: num(a.vertexRadius), rotation: num(a.rotation),
          };
          // any library entry — a generated outline with its dials, or drawn artwork
          const d = libraryOutline(String(a.shape), params);
          const nodeId = nid(a.nodeId);
          if (!d) break;
          if (num(a.atMs) !== undefined) writeKeyframe(p, nodeId, 'shape.path', num(a.atMs)!, d, easingOf(a.easing));
          else {
            writeValue(p, nodeId, 'shape.path', d, playhead);
            const n2 = p.rig.nodes[nodeId];
            if (n2) n2.shape = { kind: String(a.shape), ...params };
          }
          break;
        }
        case 'set_emitter_parts': {
          const hit = findEffect(p, a.emitter)!;
          const em = activeTimeline(p).emitters!.find((x) => x.id === hit.id)!;
          em.parts = (a.parts as Record<string, unknown>[]).map((pt, i) => {
            const rgb = Array.isArray(pt.color) ? (pt.color as number[]) : null;
            return {
              id: uid(`pt${i}`), shapeId: String(pt.shape),
              ...(rgb ? { color: { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0, a: 1 } } : {}),
              weight: 1, speed: num(pt.speed) ?? 1, sizeScale: num(pt.size) ?? 1, spin: num(pt.spin) ?? 0,
            };
          });
          em.glyphs = [];
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
        case 'add_input': {
          const m = (p.stateMachine ??= machineOf(p));
          const name = String(a.name).trim();
          // §4/§17: the same name is the same input. Two declarations would export twice
          // and leave half the transitions testing the one the engine dropped.
          if (m.inputs.some((i) => i.name === name)) break;
          const type = String(a.type) as InputType;
          m.inputs.push({
            name, type,
            ...(type === 'Event' ? {} : { value: (a.default as InputValue | undefined) ?? defaultValueFor(type) }),
            ...(str(a.description) ? { description: str(a.description) } : {}),
          });
          break;
        }
        case 'add_transition': {
          const m = (p.stateMachine ??= machineOf(p));
          const from = findState(p, a.from)!;
          const to = findState(p, a.to)!;
          const conditions = (a.conditions as unknown[])
            .map((raw) => conditionOf(p, raw))
            .filter((c): c is SmCondition => typeof c !== 'string');
          const key = (t: { from: string; to: string; conditions: SmCondition[] }) =>
            `${t.from}>${t.to}|${t.conditions.map((c) => `${c.input}${c.operator}${String(c.value)}`).join(',')}`;
          const next = { id: uid('sm'), from: from.id, to: to.id, conditions };
          // the same edge asked for twice is one edge — "reuse, don't duplicate" (§17)
          if (m.transitions.some((t) => key(t) === key(next))) break;
          m.transitions.push({
            ...next,
            logic: a.logic === 'OR' ? 'OR' : 'AND',
            durationMs: num(a.durationMs) ?? to.transitionMs ?? 300,
            easing: easingOf(a.easing),
          });
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
