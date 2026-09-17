import { uniqueName, useEditor, writeKeyframe } from '../core/store';
import { attachPresetEffects, makeTimeline, uid } from '../core/defaults';
import { namedEasing, EASING_NAMES } from '../core/easing';
import { blockAt, blocksEnd, insertBlock, relayoutBlocks } from '../core/timeline';
import { activeTrackFor, sceneAt, valueAt } from '../core/scene';
import { setProp } from '../core/props';
import { SQUISH_PRESETS, applySquish, squishPreset } from '../core/squish';
import { applyPose, findPose, POSES } from '../core/poses';
import { EFFECT_KINDS, EFFECTS, makeEffect } from '../core/effects';
import { faceOf, makeFace, laneOf, laneOfMascot, makeMascot, MASCOT_KINDS, mascotLabel, mascotOf, nextMascotName, type MascotKind } from '../core/mascot';
import { curveFromPath, curveToPath, moveAnchor, nearestOnCurve, removePoint, reverseCurve, type Curve } from '../core/curve';
import { layoutLines, TEXT_DEFAULTS } from '../core/text';
import { metricsFor } from '../core/fonts';
import { naturalOutline } from '../core/path';
import { presetTargets } from '../core/defaults';
import { activeTimeline, ANY_STATE, CAMERA_ID, MODIFIER_KINDS, MODIFIERS, switchTimeline } from '../core/types';
import { defaultValueFor, directTransition, machineOf, OPERATORS } from '../core/stateMachine';
import { libraryOutline, shapeById, SHAPE_LIBRARY } from '../core/emitters';
import { NUMERIC_PROPS, PROPS, resolveProp } from '../core/props';
import {
  addMascot, duplicateLayer, isInside, layerOrder, makeCurveLayer, makeGroup, makeLimb, makeShapeLayer, makeSvgLayer, makeTextLayer,
  limbParent, nextName, ownLayer, pinLimbPoint, rolesFor, setRole, showLayerIn, pinLimb, placeUnder, removeLayer, reorderLayer, setAppearance, setAttachment, setFaceRole, setMorph, textName, topZ, writeValue,
  type AppearanceRange,
} from '../core/layers';
import { looksLikeSvg } from '../core/svg';
import { COMP_MAX, COMP_MIN, COMP_PRESETS, compOf } from '../core/comp';
import { MORPH_MODE_NAMES, type MorphMode } from '../core/easing';
import { parseHex } from '../core/color';
import type { BlendMode, EffectKind, ColorStop, ConditionOp, EasingCurve, InputType, InputValue, KeyValue, LineCap, LineJoin, ModifierKind, Project, RigNode, SmCondition, Vec2 } from '../core/types';

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
  // several mascots, text, curves — see TOOL_DOCS
  'add_mascot', 'remove_mascot', 'duplicate_mascot', 'rename_mascot', 'set_mascot_transform', 'set_mascot_shape', 'set_mascot_parent',
  'add_text', 'set_text', 'set_text_font', 'set_text_style', 'set_text_size', 'set_text_weight', 'set_text_color', 'set_text_stroke',
  'set_text_curve', 'set_text_path', 'set_text_path_offset', 'animate_text',
  'add_curve', 'add_curve_point', 'move_curve_point', 'remove_curve_point', 'close_curve', 'reverse_curve',
  'set_layer_parent', 'set_layer_order',
  // faces, planted feet, squish presets, any-state rules — see TOOL_DOCS
  'set_face', 'add_face', 'pin_limb', 'apply_squish_preset', 'add_rule', 'show_layer_in_state', 'set_role', 'set_pose',
  // effect stack, compositing, gradients
  'set_layer_effect', 'set_layer_style',
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
add_timeline          { name, copyLayers? }                    // a new timeline = a new exported Lottie state. Every state has its OWN layers: copyLayers (default true) starts it with a copy of the current state's layers (not its animation); false = a blank canvas
set_camera            { property: "perspective"|"distance", value }  // perspective is the field-of-view angle

remove_keyframe       { nodeId, property, atMs }               // atMs must match a keyframe listed under "Keyframes"
move_keyframe         { nodeId, property, fromMs, toMs }       // retime one keyframe; fromMs must match an existing one
edit_preset           { preset, name?, durationMs?, tracks? }  // tracks REPLACE the preset's tracks; clips already on
                      // the strip keep the copy they were added with, so re-add to see the change
To change a keyframe's VALUE or easing, call add_keyframe at the same atMs \u2014 it overwrites in place.

add_emitter           { name, glyphs, path?, fromNode?, fromX?, fromY?, toNode?, toX?, toY?,
                        color?, colorTo?, size?, bow?, rateMs?, lifeMs?, count?, fadeStart?, spin?,
                        wobble?, radiusX?, radiusY?, startMs?, endMs?, parts?,
                        velocity?, velocityJitter?, angle?, spread?, drag?, gravity?, turbulence?,
                        attract?: { node, startMs, durationMs, fill? } }
                      // path "burst": EVERY particle (count, up to 2000) is born at startMs and explodes out at
                      // velocity (units/s) in angle ± spread/2 (deg, -90 up), slowing by drag, pulled by gravity,
                      // stirred by turbulence; lifeMs is how long they last. attract: from its startMs (clip time)
                      // each flies to a point on that layer's outline (fill: over its area) — an assembly,
                      // even onto a layer that is still invisible. colorTo lerps the colour over the life.
                      // Give glyphs [] and parts [{ shape: "dot" }] for plain dots.
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
set_composition       { width?, height?, preset?: ${COMP_PRESETS.map((c) => `"${c.width}x${c.height}"`).join('|')} }

MASCOTS — a project can hold several. Each is a body with its own eyes (and limbs), its own clips
and its own animation. \`mascot\` takes a mascot's name, its label ("Mascot 2") or its number in the
Mascots list; the first mascot's body id is "body". Its parts are layers like any other: "Mascot 2"'s
left eye is listed under Layers with its own id.
add_mascot            { kind?: ${(Object.keys(MASCOT_KINDS) as MascotKind[]).map((k) => `"${k}"`).join('|')}, name?, x?, y? }
                      // x/y px from the composition centre; left out, it goes in the widest free gap
remove_mascot         { mascot }                               // its parts and clips go; things hung on it stay, in the world
duplicate_mascot      { mascot }                               // a copy beside it, with its own lane of the same clips
rename_mascot         { mascot, name }
set_mascot_transform  { mascot, x?, y?, scale?, rotation?, yaw?, pitch?, atMs? }
                      // x/y its position (px from the centre, or from its leader when it follows one);
                      // scale 1 is its authored size; yaw/pitch turn its HEAD. With atMs, keyframes.
set_mascot_shape      { mascot, shape, atMs? }                 // pebble, capsule, roundedRect, blob, octopus, circle…
                      // with atMs it MORPHS from the shape it has to this one, finishing at atMs
set_mascot_parent     { mascot, follows? }                     // it follows that mascot's moves, turns and scale;
                      // follows null/omitted stands it on its own. A loop (A follows B follows A) is refused.
add_preset_to_timeline also takes { mascot }: the clip goes in THAT mascot's lane and animates THAT
mascot — "make the second mascot wave" is add_preset_to_timeline { preset: "Wave", mascot: "Mascot 2" }.
Each mascot's lane of clips plays alongside the others.

TEXT — real, editable text layers in Google Fonts, never pictures of text.
add_text              { content, x?, y?, font?, weight?, size?, color?, attach? }
                      // x/y px from the composition centre (or from the mascot when attach names one).
                      // font is a Google Fonts family: "Inter", "Poppins", "Playfair Display"…
set_text              { nodeId, content, atMs? }               // with atMs the words switch at that keyframe
set_text_font         { nodeId, family, weight?, italic? }
set_text_style        { nodeId, align?: "left"|"center"|"right", valign?: "top"|"middle"|"bottom",
                        lineHeight?, letterSpacing?, width?, atMs? }   // width px wraps lines; 0 = no wrap
set_text_size         { nodeId, size, atMs? }                  // px
set_text_weight       { nodeId, weight, atMs? }                // 100-900: 400 regular, 700 bold
set_text_color        { nodeId, color, opacity?, atMs? }
set_text_stroke       { nodeId, color?, width?, opacity?, enabled?, atMs? }
set_text_curve        { nodeId, mode: "straight"|"arc", amount?, radius?, start?, end?, underneath? }
                      // arc: amount 0-1 bends the words that fraction of a full circle (0.3 is a gentle arc),
                      // or give radius px with start/end degrees clockwise from 12 o'clock.
                      // underneath: true makes it a smile — words sitting in the bowl of the arc.
set_text_path         { nodeId, path, offset?, baseline?, reverse?, flip? }
                      // the words run along another layer's outline, live: a curve, any shape, or a MASCOT
                      // ("put HELLO around the mascot" is path: "body", baseline ~20). path null = straight again.
                      // offset px along the path; baseline px off it; reverse runs it from the other end;
                      // flip turns the letters over — for text round the bottom of a loop.
set_text_path_offset  { nodeId, offset, atMs? }                // keyframe it to make the words travel along the path
animate_text          { nodeId, effect: "typewriter"|"pop"|"fade"|"drop"|"rise"|"scatter"|"wave",
                        startMs?, durationMs?, stagger? }
                      // letters arriving: typewriter types them out; pop/fade/drop/rise/scatter bring each
                      // letter in (stagger 0 all together, 1 one after another); wave keeps them bobbing.

CURVES — a drawn path, a layer like any other, that text can follow and that can animate.
Points are px from the composition centre, +y DOWN.
add_curve             { points: [[x,y], …], closed?, type?: "smooth"|"polyline"|"bezier", guide?, name?, attach? }
                      // at least two points; smooth (the default) flows through every one. guide: true
                      // shows it in the editor only and leaves it out of every export — a path for text.
add_curve_point       { nodeId, x, y }                         // joins the curve at the segment nearest (x, y)
move_curve_point      { nodeId, index, x, y, atMs? }           // index into its points, from 0. With atMs it is a
                      // PATH KEYFRAME: key two positions of a point and the curve animates — text on it follows.
remove_curve_point    { nodeId, index }                        // a curve keeps at least two points
close_curve           { nodeId, closed }
reverse_curve         { nodeId }                               // runs it the other way; text on it starts from the other end

set_layer_parent      { nodeId, parent }                       // a layer or a mascot to ride; null = the world.
                      // Keeps its place on screen. Mascots may only follow mascots.
set_layer_order       { nodeId, above?, below?, to?: "front"|"back" }
                      // above/below another layer or MASCOT — a mascot moves as one, parts and all

FACE, FEET, SQUISH, RULES
set_face              { nodeId, face: true|false }             // make a shape or group the mascot's FACE: the eyes
                      // (and hands) move onto it, nothing jumps. A face moves, rolls, scales and LOOKS
                      // (its surface.yaw / surface.pitch) apart from the body. false gives them back.
add_face              { mascot? }                              // a face group for a mascot whose face was deleted
pin_limb              { nodeId, pinned: true|false, point? }   // point: "hip"|"knee"|"ankle"|"shoulder"|"elbow"|"hand" (default the end).
                      // A pinned point stays where it is in the world; the limb stretches to reach it, never below its length.
                      // Plant a leg's foot on the ground where it is now:
                      // the body can move, roll, squash and scale and the foot stays. false lifts it, no jump.
apply_squish_preset   { nodeId, preset, atMs? }                // writes squish.x/squish.y keyframes starting at atMs
                      // (default: the playhead). preset: ${SQUISH_PRESETS.map((x) => `"${x.name}"`).join(', ')}.
                      // Plain keyframes afterwards. anchor.y = the body's radius squashes from the feet.
add_rule              { input, operator?, value?, state, durationMs?, easing? }
                      // "when <input> <operator> <value>, play <state>" FROM WHATEVER STATE IS CURRENT —
                      // one rule, never an edge per state. mood == 2 → Dance is add_rule { input: "mood",
                      // value: 2, state: "Dance" }. add_input first when the input does not exist.
show_layer_in_state   { nodeId, everywhere? }                  // a layer made in ANOTHER state is not on screen here
                      // (layers belong to the state they were made in). This brings it into this state,
                      // or with everywhere: true into every state. Layers listed "not on screen in this state".
set_role              { nodeId, role: ""|"face"|"eyeL"|"eyeR"|"armL"|"armR"|"legL"|"legR"|"body" }
                      // the part a layer plays; a hand made a leg gains a knee, a world shape made "body" is a mascot
set_pose              { mascot?, pose, atMs? }                 // move every hand and foot of a mascot into a named pose:
                      // ${POSES.map((x) => `"${x.name}"`).join(', ')}. With atMs it is keyframes.
set_layer_effect      { nodeId, kind, params?: { … }, color?, enabled?, remove? }
                      // adds or updates ONE effect of a kind on a layer. kind: ${EFFECT_KINDS.join(', ')}.
                      // params by kind: ${EFFECT_KINDS.map((k) => `${k}(${Object.keys(EFFECTS[k].params).join(',')})`).join(' ')}.
                      // Each param then keys as effect.<kind>.<param> with add_keyframe. goo on a mascot or group melts
                      // it and the shapes inside it together; echo draws fading trails (motion blur at delay 20-40).
set_layer_style       { nodeId, blend?, mask?: { node, invert? } | null, gradient?: { type, angle, stops: [[r,g,b], …] } | null, charOrient? }
                      // blend: normal|screen|add|multiply|overlay|difference. mask clips the layer (and all it holds) to
                      // another layer's outline as drawn — hide the mask layer to make it a pure cutter. charOrient on text
                      // turns letters to face the way their text.char.<i>.x/y offsets move them.
The camera: add_modifier { nodeId: "camera", kind: "shake" } shakes the view; camera.zoom and camera.offset.x/y
key through add_keyframe with nodeId "${CAMERA_ID}". Layers in the world have depth.z (parallax) and depth.rotateX/Y.
Also animatable through set_property / add_keyframe: anchor.x/anchor.y (the pivot), squish.x/squish.y,
trim.start/trim.end (how much of a curve's line is drawn — key trim.end 0 → 1 to draw it on).`.trim()

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
  const track = activeTrackFor(activeTimeline(p), String(nodeId), String(property), t, p.rig);
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

/** The mascots in the order the prompt numbers them: the first one, then the rest as made. */
export const mascotRoster = (p: Project): RigNode[] => {
  const root = p.rig.nodes[p.rig.rootId];
  return [...(root ? [root] : []), ...Object.values(p.rig.nodes).filter((n) => n.kind === 'body' && n.id !== p.rig.rootId)];
};

/** A mascot by body id, name, label ("Mascot 2"), its number in the list, or any part of it. */
function mascotRef(p: Project, ref: unknown): RigNode | undefined {
  if (ref === undefined || ref === null || ref === '') return undefined;
  const roster = mascotRoster(p);
  if (typeof ref === 'number' && Number.isInteger(ref)) return roster[ref - 1];
  const s = String(ref).trim();
  const byId = p.rig.nodes[s];
  if (byId) return mascotOf(p.rig, byId.id);
  const lower = s.toLowerCase();
  const named = roster.find((m) => m.name.toLowerCase() === lower || mascotLabel(p.rig, m).toLowerCase() === lower);
  if (named) return named;
  const n = /^(?:mascot\s*)?#?(\d+)$/.exec(lower);
  return n ? roster[Number(n[1]) - 1] : undefined;
}
const noMascot = (p: Project, ref: unknown) =>
  `no mascot "${String(ref)}" — the mascots are ${mascotRoster(p).map((m, i) => `${i + 1}. ${mascotLabel(p.rig, m)}`).join(', ')}`;

/** A text layer, or why not. */
function textCheck(p: Project, ref: unknown): string | null {
  const n = layerOf(p, ref);
  if (!n) return `no layer "${String(ref)}"`;
  return n.text ? null : `"${n.name}" is not a text layer — add one with add_text`;
}
/** A drawn curve, or why not. */
function curveCheck(p: Project, ref: unknown): string | null {
  const n = layerOf(p, ref);
  if (!n) return `no layer "${String(ref)}"`;
  return n.curve && n.shapePath ? null : `"${n.name}" is not a curve — draw one with add_curve`;
}
/** Layers text can run along: anything with an outline, a mascot included. */
const followable = (n: RigNode) => n.kind === 'primitive' || n.kind === 'eye' || n.kind === 'body' || n.kind === 'limb' || (n.kind === 'svgLayer' && !!n.svg?.paths?.length);

/** A curve as it stands at `t`, its points in composition px from the centre — and back. */
function curveAt(p: Project, id: string, t: number) {
  const n = p.rig.nodes[id];
  const shown = valueAt(p, id, 'shape.path', t);
  const c = curveFromPath(typeof shown === 'string' ? shown : n?.shapePath);
  const item = sceneAt(p, t, compOf(p)).find((s) => s.id === id);
  if (!n || !c) return null;
  // the curve's own box on screen; a hidden one has none, so fall back to its stored place
  const view = compOf(p);
  const box = item ?? { cx: view.width / 2 + (n.surface.flatOffset?.x ?? 0), cy: view.height / 2 + (n.surface.flatOffset?.y ?? 0), w: n.size.x, h: n.size.y, rotation: n.transform.rotation };
  const a = (box.rotation * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const w = Math.max(Math.abs(box.w), 1e-3), h = Math.max(Math.abs(box.h), 1e-3);
  const toLocal = (x: number, y: number) => {
    const dx = view.width / 2 + x - box.cx, dy = view.height / 2 + y - box.cy;
    return { x: (dx * cos + dy * sin) / w, y: (-dx * sin + dy * cos) / h };
  };
  return { c, type: n.curve?.type ?? 'bezier', toLocal };
}

/** How wide a text's first line is, px — what an arc's "amount" is measured against. */
function textWidth(n: RigNode): number {
  const t = n.text!;
  return layoutLines({ ...t, width: undefined }, metricsFor(t.font, t.size))[0]?.width ?? t.size * 3;
}

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
  else if (typeof a.nodeId === 'string' && a.nodeId.includes('.')) {
    // "body.transform.scale.x" — a layer and a property written as one path, the way the
    // Keyframes list prints them. Split at the first dot that leaves a real layer and a
    // real property.
    const s = a.nodeId;
    for (let i = s.indexOf('.'); i > 0; i = s.indexOf('.', i + 1)) {
      const node = findNode(p, s.slice(0, i)), path = resolveProp(s.slice(i + 1));
      if (node && path && (a.property === undefined || resolveProp(a.property) === path)) { a.nodeId = node; a.property = path; break; }
    }
  }
  // a mascot by label or number becomes its body id; "follows" names one too
  for (const k of ['mascot', 'follows'] as const) {
    const m = typeof a[k] === 'string' || typeof a[k] === 'number' ? mascotRef(p, a[k]) : undefined;
    if (m) a[k] = m.id;
  }
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
      if (id && !activeTrackFor(tl, id, 'shape.path', num(a.atMs)!, view.rig)) {
        tl.tracks.push({ id: `__planned_${id}`, nodeId: id, property: 'shape.path', blockId: blockAt(tl, num(a.atMs)!, laneOf(view.rig, tl, id))?.id,
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
  if (call.name === 'add_mascot') {
    const kind = (str(a.kind) && str(a.kind)! in MASCOT_KINDS ? str(a.kind) : 'default') as MascotKind;
    return makeMascot(kind, { name: str(a.name) ?? nextMascotName(p.rig), x: num(a.x), y: num(a.y) });
  }
  if (call.name === 'add_text') {
    const node = makeTextLayer(String(a.content ?? 'Text'), {
      surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: num(a.x) ?? 0, y: num(a.y) ?? -240 } },
      ...(colorOf(a.color) ? { color: colorOf(a.color)! } : {}),
    }, {
      ...(num(a.size) !== undefined ? { size: Math.max(4, num(a.size)!) } : {}),
      font: { ...TEXT_DEFAULTS.font, ...(str(a.font) ? { family: str(a.font)! } : {}), ...(num(a.weight) !== undefined ? { weight: num(a.weight)! } : {}) },
    });
    return [node];
  }
  if (call.name === 'add_curve') {
    const pts = Array.isArray(a.points) ? (a.points as unknown[]).map(ptOf).filter((q): q is Vec2 => !!q) : [];
    const cam = p.rig.camera.offset;
    const node = makeCurveLayer(pts.map((q) => ({ x: q.x - cam.x, y: q.y - cam.y })), {
      closed: a.closed === true, type: (['smooth', 'polyline', 'bezier'] as const).find((t) => t === a.type),
      guide: a.guide === true, name: str(a.name) ?? nextName(p.rig, 'Curve'),
    });
    return node ? [node] : [];
  }
  if (call.name === 'add_svg') {
    const made = makeSvgLayer(String(a.markup ?? ''), str(a.name));
    return made ? [placed(p, made.node, a)] : [];
  }
  if (call.name !== 'add_layer') return [];
  const type = String(a.type ?? 'shape');
  const root = p.rig.rootId;
  if (type === 'hand' || type === 'leg') {
    const sides: (-1 | 1)[] = a.side === 'left' ? [-1] : a.side === 'right' ? [1] : [-1, 1];
    return sides.map((s) => makeLimb(type === 'hand' ? 'arm' : 'leg', s, limbParent(p.rig, root, type === 'hand' ? 'arm' : 'leg'), str(a.name) && sides.length === 1 ? { name: str(a.name)! } : {}));
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
      if (findKeyframe(p, a.nodeId, a.property, at)) return null;
      // say where the keys ARE now: after a few edits the list in the prompt is out of date
      const times = activeTimeline(p).tracks.filter((t) => t.nodeId === String(a.nodeId) && t.property === String(a.property))
        .flatMap((t) => t.keyframes.map((k) => Math.round(k.time)));
      return `no keyframe on ${String(a.nodeId)} ${String(a.property)} at ${String(at)}ms \u2014 ${times.length ? `its keys are at ${times.join(', ')}ms` : 'that property has no keys; use add_keyframe'}`;
    }
    case 'add_preset_to_timeline':
      return findPreset(p, a.preset) ? null : `no preset "${String(a.preset)}"`;
    case 'add_modifier': {
      // the camera shakes and floats like a layer
      const bad = a.nodeId === CAMERA_ID || a.nodeId === 'camera' ? null : node(a.nodeId);
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
      if (!Array.isArray(a.glyphs) || (!a.glyphs.length && !Array.isArray(a.parts))) return 'add_emitter needs a non-empty glyphs array, e.g. ["z","z","Z"], or parts';
      if (a.path !== undefined && !['arc', 'orbit', 'fall', 'burst'].includes(String(a.path))) return 'path must be arc, orbit, fall or burst';
      const att = a.attract as Record<string, unknown> | undefined;
      if (att && !findNode(p, att.node ?? att.nodeId)) return `no layer "${String(att.node ?? att.nodeId)}" to attract to`;
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
    case 'set_text_stroke':
    case 'set_svg_stroke_width': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (n.kind === 'group') return `"${n.name}" is a group and has no paint`;
      if (a.color !== undefined && !colorOf(a.color)) return 'color must be [r,g,b] or "#rrggbb"';
      if (call.name === 'set_svg_stroke_width') return num(a.width) !== undefined && num(a.width)! >= 0 ? null : 'width must be a number >= 0';
      if (a.cap !== undefined && !CAPS.includes(a.cap as LineCap)) return `cap must be one of ${CAPS.join(', ')}`;
      if (a.join !== undefined && !JOINS.includes(a.join as LineJoin)) return `join must be one of ${JOINS.join(', ')}`;
      if (call.name === 'set_text_stroke' && !n.text) return `"${n.name}" is not a text layer — use set_svg_stroke`;
      const any = ['color', 'opacity', 'enabled', 'width', 'cap', 'join'].some((k) => a[k] !== undefined);
      return any ? null : `${call.name} needs at least one of color, opacity, enabled${call.name !== 'set_svg_fill' ? ', width, cap, join' : ''}`;
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

    // --- mascots ---
    case 'add_mascot':
      if (a.kind !== undefined && !(String(a.kind) in MASCOT_KINDS)) return `kind must be one of ${Object.keys(MASCOT_KINDS).join(', ')}`;
      for (const k of ['x', 'y'] as const) if (a[k] !== undefined && num(a[k]) === undefined) return `${k} must be a number`;
      return null;
    case 'remove_mascot':
    case 'duplicate_mascot':
    case 'rename_mascot':
    case 'set_mascot_transform':
    case 'set_mascot_shape':
    case 'set_mascot_parent': {
      const m = mascotRef(p, a.mascot);
      if (!m) return noMascot(p, a.mascot);
      if (call.name === 'remove_mascot' && m.id === p.rig.rootId) return 'the first mascot cannot be removed — hide it, or remove another';
      if (call.name === 'rename_mascot' && !str(a.name)) return 'rename_mascot needs a name';
      if (call.name === 'set_mascot_transform') {
        const keys = ['x', 'y', 'scale', 'rotation', 'yaw', 'pitch'].filter((k) => a[k] !== undefined);
        if (!keys.length) return 'give at least one of x, y, scale, rotation, yaw, pitch';
        return keys.every((k) => num(a[k]) !== undefined) ? null : `${keys.join(', ')} must be numbers`;
      }
      if (call.name === 'set_mascot_shape') return libraryOutline(String(a.shape)) ? null : `shape must be a shape library id: ${SHAPE_LIBRARY.filter((s) => s.outline).map((s) => s.id).join(', ')}`;
      if (call.name === 'set_mascot_parent' && a.follows !== undefined && a.follows !== null && a.follows !== '') {
        const leader = mascotRef(p, a.follows);
        if (!leader) return noMascot(p, a.follows);
        if (leader.id === m.id) return 'a mascot cannot follow itself';
        if (isInside(p.rig, leader.id, m.id)) return `${mascotLabel(p.rig, leader)} already follows ${mascotLabel(p.rig, m)} — that would make a loop`;
      }
      return null;
    }

    // --- text ---
    case 'add_text':
      if (typeof a.content !== 'string' || !a.content.trim()) return 'add_text needs content';
      if (a.color !== undefined && !colorOf(a.color)) return 'color must be [r,g,b] or "#rrggbb"';
      if (a.attach !== undefined && !mascotRef(p, a.attach)) return noMascot(p, a.attach);
      return null;
    case 'set_text':
      return textCheck(p, a.nodeId) ?? (typeof a.content === 'string' ? null : 'set_text needs content');
    case 'set_text_font':
      return textCheck(p, a.nodeId) ?? (str(a.family) ? null : 'set_text_font needs a family, e.g. "Poppins"');
    case 'set_text_style': {
      const bad = textCheck(p, a.nodeId);
      if (bad) return bad;
      if (a.align !== undefined && !['left', 'center', 'right'].includes(String(a.align))) return 'align must be left, center or right';
      if (a.valign !== undefined && !['top', 'middle', 'bottom'].includes(String(a.valign))) return 'valign must be top, middle or bottom';
      const nums = ['lineHeight', 'letterSpacing', 'width'].filter((k) => a[k] !== undefined);
      if (!nums.length && a.align === undefined && a.valign === undefined) return 'give at least one of align, valign, lineHeight, letterSpacing, width';
      return nums.every((k) => num(a[k]) !== undefined) ? null : `${nums.join(', ')} must be numbers`;
    }
    case 'set_text_size':
    case 'set_text_weight': {
      const bad = textCheck(p, a.nodeId);
      const k = call.name === 'set_text_size' ? 'size' : 'weight';
      return bad ?? (num(a[k]) !== undefined ? null : `${k} must be a number`);
    }
    case 'set_text_color':
      return textCheck(p, a.nodeId) ?? (colorOf(a.color) ? null : 'color must be [r,g,b] or "#rrggbb"');
    case 'set_text_curve': {
      const bad = textCheck(p, a.nodeId);
      if (bad) return bad;
      if (a.mode !== 'straight' && a.mode !== 'arc') return 'mode must be "straight" or "arc" — to follow a curve use set_text_path';
      for (const k of ['amount', 'radius', 'start', 'end'] as const) if (a[k] !== undefined && num(a[k]) === undefined) return `${k} must be a number`;
      return null;
    }
    case 'set_text_path': {
      const bad = textCheck(p, a.nodeId);
      if (bad) return bad;
      if (a.path === null || a.path === undefined || a.path === 'none') return null;
      const target = layerOf(p, a.path) ?? mascotRef(p, a.path);
      if (!target) return `no layer "${String(a.path)}" to follow`;
      if (target.id === findNode(p, a.nodeId)) return 'text cannot follow itself';
      return followable(target) ? null : `"${target.name}" has no outline to follow — use a curve, a shape or a mascot`;
    }
    case 'set_text_path_offset':
      return textCheck(p, a.nodeId) ?? (num(a.offset) !== undefined ? null : 'offset must be a number');
    case 'animate_text':
      return textCheck(p, a.nodeId) ?? (['typewriter', 'pop', 'fade', 'drop', 'rise', 'scatter', 'wave'].includes(String(a.effect)) ? null : 'effect must be typewriter, pop, fade, drop, rise, scatter or wave');

    // --- curves ---
    case 'add_curve': {
      const pts = Array.isArray(a.points) ? (a.points as unknown[]).map(ptOf) : [];
      if (pts.length < 2 || pts.some((q) => !q)) return 'points must be at least two [x, y] pairs';
      if (a.type !== undefined && !['smooth', 'polyline', 'bezier'].includes(String(a.type))) return 'type must be smooth, polyline or bezier';
      if (a.attach !== undefined && !mascotRef(p, a.attach) && !layerOf(p, a.attach)) return `no mascot or layer "${String(a.attach)}" to attach to`;
      return null;
    }
    case 'add_curve_point':
      return curveCheck(p, a.nodeId) ?? (num(a.x) !== undefined && num(a.y) !== undefined ? null : 'x and y must be numbers');
    case 'move_curve_point':
    case 'remove_curve_point': {
      const bad = curveCheck(p, a.nodeId);
      if (bad) return bad;
      const c = curveFromPath(layerOf(p, a.nodeId)!.shapePath)!;
      const i = num(a.index);
      if (i === undefined || !Number.isInteger(i) || i < 0 || i >= c.points.length) return `index must be 0-${c.points.length - 1}`;
      if (call.name === 'remove_curve_point') return c.points.length > 2 ? null : 'a curve keeps at least two points';
      return num(a.x) !== undefined && num(a.y) !== undefined ? null : 'x and y must be numbers';
    }
    case 'close_curve':
      return curveCheck(p, a.nodeId) ?? (typeof a.closed === 'boolean' ? null : 'closed must be true or false');
    case 'reverse_curve':
      return curveCheck(p, a.nodeId);

    // --- hierarchy and order ---
    case 'set_layer_parent': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      if (a.parent === null || a.parent === undefined || a.parent === 'world') return n.id === p.rig.rootId ? null : null;
      const parent = layerOf(p, a.parent) ?? mascotRef(p, a.parent);
      if (!parent) return `no layer or mascot "${String(a.parent)}"`;
      if (parent.id === n.id) return 'a layer cannot ride itself';
      if (isInside(p.rig, parent.id, n.id)) return `"${parent.name}" is inside "${n.name}" — that would make a loop`;
      if (n.kind === 'body' && parent.kind !== 'body') return 'a mascot can only follow another mascot';
      return null;
    }
    case 'set_layer_order': {
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      const ref = a.above ?? a.below;
      if (ref !== undefined) return layerOf(p, ref) || mascotRef(p, ref) ? null : `no layer or mascot "${String(ref)}"`;
      return a.to === 'front' || a.to === 'back' ? null : 'give above, below, or to: "front" | "back"';
    }
    case 'set_face': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      return ['primitive', 'group', 'svgLayer'].includes(n.kind) ? null : `${n.name} is a ${n.kind} — only a shape, SVG or group can be a face`;
    }
    case 'add_face': return a.mascot === undefined || mascotRef(p, a.mascot) ? null : noMascot(p, a.mascot);
    case 'pin_limb': return layerOf(p, a.nodeId)?.limb ? null : `"${String(a.nodeId)}" is not a hand or a leg`;
    case 'apply_squish_preset':
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      return squishPreset(String(a.preset ?? '')) ? null : `no squish preset "${String(a.preset)}" — one of ${SQUISH_PRESETS.map((x) => x.name).join(', ')}`;
    case 'show_layer_in_state': return layerOf(p, a.nodeId) ? null : `no layer "${String(a.nodeId)}"`;
    case 'set_layer_effect':
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      return EFFECT_KINDS.includes(a.kind as EffectKind) ? null : `effect kind must be one of ${EFFECT_KINDS.join(', ')}`;
    case 'set_layer_style': {
      if (!layerOf(p, a.nodeId)) return `no layer "${String(a.nodeId)}"`;
      if (a.blend !== undefined && !['normal', 'screen', 'add', 'multiply', 'overlay', 'difference'].includes(String(a.blend))) return 'blend must be normal, screen, add, multiply, overlay or difference';
      const mk = a.mask as Record<string, unknown> | null | undefined;
      if (mk && !findNode(p, mk.node ?? mk.nodeId)) return `no layer "${String(mk.node ?? mk.nodeId)}" to mask with`;
      return null;
    }
    case 'set_role': {
      const n = layerOf(p, a.nodeId);
      if (!n) return `no layer "${String(a.nodeId)}"`;
      return rolesFor(n).includes(String(a.role ?? '')) ? null : `${n.name} cannot play "${String(a.role)}" — it can be ${rolesFor(n).map((r) => `"${r}"`).join(', ')}`;
    }
    case 'set_pose':
      if (a.mascot !== undefined && !mascotRef(p, a.mascot)) return noMascot(p, a.mascot);
      return findPose(String(a.pose ?? '')) ? null : `no pose "${String(a.pose)}" — one of ${POSES.map((x) => x.name).join(', ')}`;
    case 'add_rule': {
      if (!findState(p, a.state)) return `no state "${String(a.state)}" — add_timeline first`;
      const c = conditionOf(p, { input: a.input, operator: a.operator ?? '==', value: a.value });
      return typeof c === 'string' ? c : null;
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
    case 'add_mascot': return `Add a ${MASCOT_KINDS[(String(a.kind ?? 'default')) as MascotKind]?.label.toLowerCase() ?? 'new'} mascot${a.name ? ` called "${a.name}"` : ''}`;
    case 'remove_mascot': return `Remove ${mascotName(p, a.mascot)} and its clips (anything hung on it stays)`;
    case 'duplicate_mascot': return `Duplicate ${mascotName(p, a.mascot)}, clips and all`;
    case 'rename_mascot': return `Rename ${mascotName(p, a.mascot)} to "${a.name}"`;
    case 'set_mascot_transform': {
      const bits = ['x', 'y', 'scale', 'rotation', 'yaw', 'pitch'].filter((k) => num(a[k]) !== undefined).map((k) => `${k} ${a[k]}`);
      return `${mascotName(p, a.mascot)}: ${bits.join(', ')}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    }
    case 'set_mascot_shape': return `Make ${mascotName(p, a.mascot)} a ${shapeById(String(a.shape))?.name ?? a.shape}${a.atMs !== undefined ? `, morphing by ${at(a.atMs)}` : ''}`;
    case 'set_mascot_parent': return a.follows ? `${mascotName(p, a.mascot)} follows ${mascotName(p, a.follows)}` : `${mascotName(p, a.mascot)} stands on its own`;
    case 'add_text': return `Add text “${String(a.content ?? '')}”${a.font ? ` in ${a.font}` : ''}${a.attach ? ` on ${mascotName(p, a.attach)}` : ''}`;
    case 'set_text': return `${name(a.nodeId)} says “${String(a.content)}”${a.atMs !== undefined ? ` from ${at(a.atMs)}` : ''}`;
    case 'set_text_font': return `${name(a.nodeId)} in ${a.family}${a.weight ? ` ${a.weight}` : ''}${a.italic ? ' italic' : ''}`;
    case 'set_text_style': {
      const bits = ['align', 'valign', 'lineHeight', 'letterSpacing', 'width'].filter((k) => a[k] !== undefined).map((k) => `${k} ${a[k]}`);
      return `${name(a.nodeId)}: ${bits.join(', ')}`;
    }
    case 'set_text_size': return `${name(a.nodeId)} at ${a.size}px${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_text_weight': return `${name(a.nodeId)} weight ${a.weight}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_text_color': return `${name(a.nodeId)} coloured ${colorName(a.color)}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'set_text_stroke': return `${name(a.nodeId)} outlined${a.color !== undefined ? ` ${colorName(a.color)}` : ''}${a.width !== undefined ? ` ${a.width}px` : ''}${a.enabled === false ? ' — off' : ''}`;
    case 'set_text_curve': return a.mode === 'arc' ? `Bend ${name(a.nodeId)} round an arc${a.underneath ? ', underneath' : ''}` : `Straighten ${name(a.nodeId)}`;
    case 'set_text_path': return a.path === null || a.path === undefined || a.path === 'none'
      ? `${name(a.nodeId)} back on a straight line`
      : `${name(a.nodeId)} runs along ${name(findNode(p, a.path) ?? mascotRef(p, a.path)?.id ?? a.path)}`;
    case 'set_text_path_offset': return `Slide ${name(a.nodeId)} ${a.offset}px along its path${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'animate_text': return `${name(a.nodeId)}: ${a.effect}${a.startMs !== undefined ? ` from ${at(a.startMs)}` : ''}${a.durationMs !== undefined ? ` over ${a.durationMs}ms` : ''}`;
    case 'add_curve': return `Draw ${a.name ? `“${a.name}”, ` : ''}a ${a.closed ? 'closed ' : ''}${String(a.type ?? 'smooth')} curve through ${(a.points as unknown[]).length} points${a.guide ? ' (a guide)' : ''}`;
    case 'add_curve_point': return `Add a point to ${name(a.nodeId)} at ${a.x}, ${a.y}`;
    case 'move_curve_point': return `Move point ${a.index} of ${name(a.nodeId)} to ${a.x}, ${a.y}${a.atMs !== undefined ? ` at ${at(a.atMs)} — the curve animates` : ''}`;
    case 'remove_curve_point': return `Remove point ${a.index} of ${name(a.nodeId)}`;
    case 'close_curve': return `${a.closed ? 'Close' : 'Open'} ${name(a.nodeId)}`;
    case 'reverse_curve': return `Reverse ${name(a.nodeId)}`;
    case 'set_layer_parent': return a.parent === null || a.parent === undefined || a.parent === 'world'
      ? `${name(a.nodeId)} into the world, where it is now`
      : `${name(a.nodeId)} rides ${name(findNode(p, a.parent) ?? mascotRef(p, a.parent)?.id ?? a.parent)}, staying where it is`;
    case 'set_layer_order': return a.above !== undefined ? `${name(a.nodeId)} in front of ${name(findNode(p, a.above) ?? a.above)}`
      : a.below !== undefined ? `${name(a.nodeId)} behind ${name(findNode(p, a.below) ?? a.below)}` : `${name(a.nodeId)} to the ${a.to}`;
    case 'set_face': return a.face === false ? `Make ${name(a.nodeId)} an ordinary layer again` : `Make ${name(a.nodeId)} the face — the eyes ride it`;
    case 'add_face': return `Give ${a.mascot !== undefined ? `mascot ${String(a.mascot)}` : 'the mascot'} a face`;
    case 'pin_limb': return a.pinned === false ? `Unpin ${name(a.nodeId)}` : `Pin ${name(a.nodeId)} to the ground`;
    case 'apply_squish_preset': return `${squishPreset(String(a.preset))?.name ?? a.preset} on ${name(a.nodeId)}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ' at the playhead'}`;
    case 'set_layer_effect': return a.remove ? `Remove ${String(a.kind)} from ${name(a.nodeId)}` : `${EFFECTS[a.kind as EffectKind]?.label ?? a.kind} on ${name(a.nodeId)}`;
    case 'set_layer_style': return `Style ${name(a.nodeId)}: ${Object.keys(a).filter((k) => k !== 'nodeId').join(', ')}`;
    case 'show_layer_in_state': return `Show ${name(a.nodeId)} ${a.everywhere ? 'in every state' : 'in this state'}`;
    case 'set_role': return `Make ${name(a.nodeId)} the ${String(a.role) || 'ordinary layer'}`;
    case 'set_pose': return `Pose ${a.mascot !== undefined ? `mascot ${String(a.mascot)}` : 'the mascot'}: ${findPose(String(a.pose))?.name ?? a.pose}${a.atMs !== undefined ? ` at ${at(a.atMs)}` : ''}`;
    case 'add_rule': return `When ${a.input} ${a.operator ?? '=='} ${a.value ?? ''} → play ${String(a.state)}, from any state`;
    default: return call.name;
  }
}

const colorName = (v: unknown) => { const c = colorOf(v); return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : String(v); };
const mascotName = (p: Project, ref: unknown) => { const m = mascotRef(p, ref); return m ? mascotLabel(p.rig, m) : String(ref); };

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
            ownLayer(p, n.id);
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
        case 'set_text_stroke':
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
          // an arm with an elbow has three points: shoulder, elbow, hand
          const map = (call.name === 'set_hand_points'
            ? (p.rig.nodes[id]?.limb?.c ? { shoulder: 'a', elbow: 'b', hand: 'c' } : LIMB_POINTS.arm)
            : LIMB_POINTS.leg) as Record<string, string>;
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
        case 'set_state': switchTimeline(p, findState(p, a.state)!.id); break;
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
          // on a named mascot the clip goes in that mascot's lane and animates it
          const m = a.mascot !== undefined ? mascotRef(p, a.mascot) : undefined;
          const lane = m && laneOfMascot(p.rig, m.id) ? m.id : undefined;
          const to = presetTargets(p.rig, preset, lane);
          const start = insertBlock(tl, { id: blockId, presetId: preset.id, name: preset.name, durationMs: preset.durationMs, ...(lane ? { mascotId: lane } : {}) }, index);
          for (const t of preset.tracks) {
            tl.tracks.push({
              id: uid('t'), nodeId: to(t.nodeId), property: t.property, blockId,
              keyframes: t.keyframes.map((k) => ({ ...k, id: uid('k'), time: k.time + start })),
            });
          }
          // a preset's effects and emitters come with it — "Sleepy" without the zzz is
          // not sleepy, and the copilot placing one must get the same clip the panel does
          attachPresetEffects(tl, preset, blockId, p.rig, lane);
          break;
        }

        // --- mascots ---
        case 'add_mascot': {
          const kind = (str(a.kind) && str(a.kind)! in MASCOT_KINDS ? str(a.kind) : 'default') as MascotKind;
          addMascot(p, kind, { name: str(a.name), x: num(a.x), y: num(a.y) });
          break;
        }
        case 'remove_mascot': removeLayer(p, mascotRef(p, a.mascot)!.id, playhead); break;
        case 'duplicate_mascot': duplicateLayer(p, mascotRef(p, a.mascot)!.id); break;
        case 'rename_mascot': mascotRef(p, a.mascot)!.name = str(a.name)!; break;
        case 'set_mascot_transform': {
          const id = mascotRef(p, a.mascot)!.id;
          const map: Record<string, string[]> = {
            x: ['flatOffset.x'], y: ['flatOffset.y'], scale: ['transform.scale.x', 'transform.scale.y'],
            rotation: ['transform.rotation'], yaw: ['surface.yaw'], pitch: ['surface.pitch'],
          };
          for (const [k, props] of Object.entries(map)) if (num(a[k]) !== undefined) for (const pr of props) put(id, pr, num(a[k])!, a);
          break;
        }
        case 'set_mascot_shape': {
          const m = mascotRef(p, a.mascot)!;
          const d = libraryOutline(String(a.shape))!;
          const t = num(a.atMs);
          if (t === undefined) { writeValue(p, m.id, 'shape.path', d, playhead); m.shape = { kind: String(a.shape) }; break; }
          // a morph finishing at atMs: from the outline it has, a beat before
          if (!activeTrackFor(activeTimeline(p), m.id, 'shape.path', t, p.rig)) {
            const from = valueAt(p, m.id, 'shape.path', Math.max(0, t - 450));
            writeKeyframe(p, m.id, 'shape.path', Math.max(0, t - 450), typeof from === 'string' ? from : naturalOutline(m), easingOf('easeInOut'));
          }
          writeKeyframe(p, m.id, 'shape.path', t, d, easingOf(a.easing));
          break;
        }
        case 'set_mascot_parent': {
          const m = mascotRef(p, a.mascot)!;
          const leader = a.follows ? mascotRef(p, a.follows) : undefined;
          placeUnder(p, m.id, leader?.id ?? null, playhead);
          break;
        }

        // --- text ---
        case 'add_text': {
          const [node] = plannedLayers(p, call);
          node.zIndex = topZ(p.rig);
          p.rig.nodes[node.id] = node;
          ownLayer(p, node.id);
          const m = a.attach !== undefined ? mascotRef(p, a.attach) : undefined;
          if (m) {
            // x/y were meant from the mascot, not the canvas centre
            node.parentId = m.id;
            node.surface = { ...node.surface, flatOffset: { x: num(a.x) ?? 0, y: num(a.y) ?? -m.size.y * 1.4 } };
          }
          break;
        }
        case 'set_text': {
          const id = nid(a.nodeId);
          const n = p.rig.nodes[id];
          // a name that tracked the words follows them — not a switch keyed for later
          if (n?.text && a.atMs === undefined && n.name === textName(n.text.content)) n.name = textName(String(a.content));
          put(id, 'text.content', String(a.content), a);
          break;
        }
        case 'set_text_font': {
          const id = nid(a.nodeId);
          put(id, 'text.font.family', str(a.family)!, a);
          if (num(a.weight) !== undefined) put(id, 'text.font.weight', num(a.weight)!, a);
          const t = p.rig.nodes[id]?.text;
          if (t && typeof a.italic === 'boolean') t.font = { ...t.font, style: a.italic ? 'italic' : 'normal' };
          break;
        }
        case 'set_text_style': {
          const id = nid(a.nodeId);
          const t = p.rig.nodes[id]?.text;
          if (t && a.align !== undefined) t.align = a.align as 'left';
          if (t && a.valign !== undefined) t.valign = a.valign as 'top';
          for (const [k, prop] of [['lineHeight', 'text.lineHeight'], ['letterSpacing', 'text.letterSpacing'], ['width', 'text.width']] as const) {
            if (num(a[k]) !== undefined) put(id, prop, num(a[k])!, a);
          }
          break;
        }
        case 'set_text_size': put(nid(a.nodeId), 'text.size', Math.max(1, num(a.size)!), a); break;
        case 'set_text_weight': put(nid(a.nodeId), 'text.font.weight', Math.min(900, Math.max(100, num(a.weight)!)), a); break;
        case 'set_text_color': {
          const id = nid(a.nodeId);
          put(id, 'color', colorOf(a.color)!, a);
          if (num(a.opacity) !== undefined) put(id, 'fill.opacity', Math.min(1, Math.max(0, num(a.opacity)!)), a);
          break;
        }
        case 'set_text_curve': {
          const id = nid(a.nodeId);
          const n = p.rig.nodes[id];
          if (!n?.text) break;
          if (a.mode === 'straight') { n.text.path = { ...n.text.path, mode: 'straight' }; break; }
          // "bend it 30%": the words span that share of a full circle
          const amount = num(a.amount);
          const span = amount !== undefined ? Math.min(0.95, Math.max(0.02, Math.abs(amount))) * 360 : undefined;
          const radius = num(a.radius) ?? (span ? textWidth(n) / ((span * Math.PI) / 180) : n.text.path?.radius ?? TEXT_DEFAULTS.arc.radius);
          n.text.path = { ...n.text.path, mode: 'arc', reverse: a.underneath === true };
          // through put, so an arc already keyframed is changed where it is keyed
          put(id, 'text.arc.radius', Math.round(radius), a);
          const start = num(a.start) ?? (span ? -span / 2 - 6 : undefined);
          const end = num(a.end) ?? (span ? span / 2 + 6 : undefined);
          if (start !== undefined) put(id, 'text.arc.start', start, a);
          if (end !== undefined) put(id, 'text.arc.end', end, a);
          break;
        }
        case 'set_text_path': {
          const id = nid(a.nodeId);
          const n = p.rig.nodes[id];
          if (!n?.text) break;
          if (a.path === null || a.path === undefined || a.path === 'none') { n.text.path = { ...n.text.path, mode: 'straight', nodeId: undefined }; break; }
          const target = layerOf(p, a.path) ?? mascotRef(p, a.path)!;
          n.text.path = {
            ...n.text.path, mode: 'path', nodeId: target.id,
            ...(typeof a.reverse === 'boolean' ? { reverse: a.reverse } : {}),
            ...(typeof a.flip === 'boolean' ? { flip: a.flip } : {}),
          };
          if (num(a.offset) !== undefined) put(id, 'text.path.offset', num(a.offset)!, a);
          if (num(a.baseline) !== undefined) put(id, 'text.path.baseline', num(a.baseline)!, a);
          break;
        }
        case 'set_text_path_offset': put(nid(a.nodeId), 'text.path.offset', num(a.offset)!, a); break;
        case 'animate_text': {
          const id = nid(a.nodeId);
          const n = p.rig.nodes[id];
          if (!n?.text) break;
          const from = num(a.startMs) ?? playhead;
          const letters = [...n.text.content.replace(/\n/g, '')].length;
          const ease = easingOf(a.easing ?? 'easeOut');
          if (a.effect === 'typewriter') {
            const ms = num(a.durationMs) ?? Math.max(200, letters * 45);
            writeKeyframe(p, id, 'text.reveal.end', from, 0, { type: 'linear' });
            writeKeyframe(p, id, 'text.reveal.end', from + ms, letters, ease);
            break;
          }
          n.text.chars = { kind: a.effect as 'pop', progress: 1, stagger: num(a.stagger) ?? (a.effect === 'wave' ? 0.4 : 0.6) };
          const ms = num(a.durationMs) ?? (a.effect === 'wave' ? 1600 : Math.max(400, letters * 70));
          writeKeyframe(p, id, 'text.chars.progress', from, 0, { type: 'linear' });
          writeKeyframe(p, id, 'text.chars.progress', from + ms, a.effect === 'wave' ? 2 : 1, a.effect === 'wave' ? { type: 'linear' } : ease);
          break;
        }

        // --- curves ---
        case 'add_curve': {
          const [node] = plannedLayers(p, call);
          if (!node) break;
          node.zIndex = topZ(p.rig);
          p.rig.nodes[node.id] = node;
          ownLayer(p, node.id);
          const target = a.attach !== undefined ? (mascotRef(p, a.attach) ?? layerOf(p, a.attach)) : undefined;
          if (target) placeUnder(p, node.id, target.id, playhead, false);
          break;
        }
        case 'add_curve_point':
        case 'move_curve_point':
        case 'remove_curve_point':
        case 'close_curve':
        case 'reverse_curve': {
          const id = nid(a.nodeId);
          const got = curveAt(p, id, num(a.atMs) ?? playhead);
          if (!got) break;
          const { c, type, toLocal } = got;
          let next: Curve | null = c;
          if (call.name === 'add_curve_point') {
            const q = toLocal(num(a.x)!, num(a.y)!);
            const at2 = nearestOnCurve(c, type, q);
            next = { closed: c.closed, points: [...c.points] };
            next.points.splice((at2?.seg ?? c.points.length - 1) + 1, 0, q);
          } else if (call.name === 'move_curve_point') next = moveAnchor(c, num(a.index)!, toLocal(num(a.x)!, num(a.y)!));
          else if (call.name === 'remove_curve_point') next = removePoint(c, num(a.index)!);
          else if (call.name === 'close_curve') next = { ...c, closed: a.closed === true && c.points.length > 2 };
          else next = reverseCurve(c);
          const d = next && curveToPath(next, type);
          if (d) put(id, 'shape.path', d, a);
          break;
        }

        // --- hierarchy and order ---
        case 'set_layer_parent': {
          const id = nid(a.nodeId);
          const parent = a.parent === null || a.parent === undefined || a.parent === 'world' ? null : (layerOf(p, a.parent) ?? mascotRef(p, a.parent))!.id;
          placeUnder(p, id, parent, playhead);
          break;
        }
        case 'set_layer_order': {
          const id = nid(a.nodeId);
          const ref = a.above ?? a.below;
          if (ref === undefined) { reorderLayer(p, id, a.to as 'front'); break; }
          const target = layerOf(p, ref) ?? mascotRef(p, ref)!;
          const node = p.rig.nodes[id];
          // counted among the layers the move does not carry — a mascot carries its parts
          const carried = (n: RigNode) => n.id === id || (node.kind === 'body' && isInside(p.rig, n.id, id));
          const rest = layerOrder(p.rig).filter((n) => !carried(n));
          // a mascot target is its whole group: in front of all of it, or behind all of it
          const inTarget = rest.map((n, i) => ({ n, i })).filter(({ n }) => n.id === target.id || (target.kind === 'body' && isInside(p.rig, n.id, target.id)));
          if (!inTarget.length) break;
          reorderLayer(p, id, a.above !== undefined ? inTarget[inTarget.length - 1].i + 1 : inTarget[0].i);
          break;
        }
        case 'add_modifier':
          activeTimeline(p).modifiers.push({
            id: uid('m'), nodeId: a.nodeId === 'camera' ? CAMERA_ID : String(a.nodeId), kind: a.kind as 'shake',
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
            path: (a.path as 'arc' | 'orbit' | 'fall' | 'burst') ?? 'arc',
            ...(colorOf(a.colorTo) ? { colorTo: colorOf(a.colorTo) } : {}),
            ...Object.fromEntries((['velocity', 'velocityJitter', 'angle', 'spread', 'drag', 'gravity', 'turbulence'] as const)
              .filter((k) => num(a[k]) !== undefined).map((k) => [k, num(a[k])])),
            ...(a.attract && typeof a.attract === 'object' ? { attract: {
              nodeId: findNode(p, (a.attract as Record<string, unknown>).node ?? (a.attract as Record<string, unknown>).nodeId)!,
              startMs: num((a.attract as Record<string, unknown>).startMs) ?? 1000,
              durationMs: Math.max(50, num((a.attract as Record<string, unknown>).durationMs) ?? 1200),
              fill: (a.attract as Record<string, unknown>).fill !== false,
            } } : {}),
            ...(Array.isArray(a.parts) ? { parts: (a.parts as Record<string, unknown>[]).map((pt, i) => ({ id: `pt${i}`, shapeId: String(pt.shape ?? 'dot'), weight: 1, speed: 1, sizeScale: num(pt.size) ?? 1, spin: num(pt.spin) ?? 0, ...(colorOf(pt.color) ? { color: colorOf(pt.color) } : {}) })) } : {}),
            from: { nodeId: findNode(p, a.fromNode), x: num(a.fromX) ?? 40, y: num(a.fromY) ?? -34 },
            to: { nodeId: findNode(p, a.toNode), x: num(a.toX) ?? 110, y: num(a.toY) ?? -150 },
            bow: num(a.bow) ?? 20,
            ...(num(a.radiusX) !== undefined ? { radiusX: num(a.radiusX) } : {}),
            ...(num(a.radiusY) !== undefined ? { radiusY: num(a.radiusY) } : {}),
            rateMs: Math.max(40, num(a.rateMs) ?? 600),
            lifeMs: Math.max(120, num(a.lifeMs) ?? 1800),
            count: Math.max(1, Math.min(2000, Math.round(num(a.count) ?? 3))),
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
          // a state for the same mascot is what "add a Happy state" means — blank only when asked
          if (a.copyLayers !== false) tl.rig = structuredClone(p.rig);
          p.timelines.push(tl);
          // anything the model emits after this belongs to the state it just made
          switchTimeline(p, tl.id);
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
        case 'set_face': setFaceRole(p, nid(a.nodeId), a.face !== false, playhead); break;
        case 'add_face': {
          const m = a.mascot !== undefined ? mascotRef(p, a.mascot) : p.rig.nodes[p.rig.rootId];
          if (!m || faceOf(p.rig, m.id)) break;
          const id = p.rig.nodes[`${m.id}.face`] ? uid('face') : `${m.id}.face`;
          const face = makeFace(id, m.id);
          delete face.role;
          p.rig.nodes[id] = face;
          setFaceRole(p, id, true, playhead);
          break;
        }
        case 'set_layer_effect': {
          const n = p.rig.nodes[nid(a.nodeId)];
          const kind = a.kind as EffectKind;
          if (!n) break;
          if (a.remove) { n.effects = n.effects?.filter((e) => e.kind !== kind); if (!n.effects?.length) delete n.effects; break; }
          let fx = n.effects?.find((e) => e.kind === kind);
          if (!fx) { fx = makeEffect(kind); n.effects = [...(n.effects ?? []), fx]; }
          if (a.params && typeof a.params === 'object') {
            for (const [k, v] of Object.entries(a.params as Record<string, unknown>)) if (k in EFFECTS[kind].params && num(v) !== undefined) fx.params[k] = num(v)!;
          }
          if (colorOf(a.color)) fx.color = colorOf(a.color);
          if (typeof a.enabled === 'boolean') fx.enabled = a.enabled;
          break;
        }
        case 'set_layer_style': {
          const n = p.rig.nodes[nid(a.nodeId)];
          if (!n) break;
          if (a.blend !== undefined) { if (a.blend === 'normal') delete n.blend; else n.blend = a.blend as BlendMode; }
          if (a.mask === null) delete n.mask;
          else if (a.mask && typeof a.mask === 'object') {
            const mk = a.mask as Record<string, unknown>;
            n.mask = { nodeId: findNode(p, mk.node ?? mk.nodeId)!, ...(mk.invert ? { invert: true } : {}) };
          }
          if (a.gradient === null) delete n.gradient;
          else if (a.gradient && typeof a.gradient === 'object') {
            const g = a.gradient as Record<string, unknown>;
            const cols = (Array.isArray(g.stops) ? g.stops : []).map(colorOf).filter((c): c is ColorStop => !!c);
            if (cols.length >= 2) n.gradient = { type: g.type === 'radial' ? 'radial' : 'linear', angle: num(g.angle) ?? 90, stops: cols.map((color, i) => ({ at: i / (cols.length - 1), color })) };
          }
          if (typeof a.charOrient === 'boolean' && n.text) n.text.charOrient = a.charOrient;
          break;
        }
        case 'show_layer_in_state': showLayerIn(p, nid(a.nodeId), a.everywhere === true ? 'everywhere' : 'here'); break;
        case 'set_role': setRole(p, nid(a.nodeId), String(a.role ?? ''), playhead); break;
        case 'set_pose': {
          const m = a.mascot !== undefined ? mascotRef(p, a.mascot) : p.rig.nodes[p.rig.rootId];
          if (m) applyPose(p, m.id, String(a.pose), num(a.atMs) ?? playhead, num(a.atMs) !== undefined);
          break;
        }
        case 'pin_limb': {
          const id = nid(a.nodeId);
          const word = String(a.point ?? '').toLowerCase();
          const l = p.rig.nodes[id]?.limb;
          const key = ({ hip: 'a', shoulder: 'a', knee: 'b', elbow: 'b', ankle: l?.c ? 'c' : 'b', hand: l?.c ? 'c' : 'b', foot: l?.c ? 'c' : 'b' } as Record<string, 'a' | 'b' | 'c'>)[word];
          if (key) pinLimbPoint(p, id, key, a.pinned !== false, playhead);
          else pinLimb(p, id, a.pinned !== false, playhead);
          break;
        }
        case 'apply_squish_preset': applySquish(p, nid(a.nodeId), String(a.preset), num(a.atMs) ?? playhead); break;
        case 'add_rule': {
          const m = (p.stateMachine ??= machineOf(p));
          const to = findState(p, a.state)!;
          const c = conditionOf(p, { input: a.input, operator: a.operator ?? '==', value: a.value }) as SmCondition;
          if (m.transitions.some((t) => t.from === ANY_STATE && t.to === to.id && JSON.stringify(t.conditions) === JSON.stringify([c]))) break;
          m.transitions.push({
            id: uid('sm'), from: ANY_STATE, to: to.id, conditions: [c], logic: 'AND',
            durationMs: num(a.durationMs) ?? to.transitionMs ?? 300, easing: easingOf(a.easing),
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
