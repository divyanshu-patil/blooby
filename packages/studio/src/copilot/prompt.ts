import { blockStarts, blocksEnd, fmtSec } from '../core/timeline';
import { TOOL_DOCS } from './tools';
import { ANIMATION_CRAFT } from './craft';
import { activeTimeline } from '../core/types';
import { NUMERIC_PROPS, PROPS } from '../core/props';
import { conditionText, machineOf } from '../core/stateMachine';
import { appearanceSpans } from '../core/scene';
import { shapeById, shapeIdOf } from '../core/emitters';
import { layerOrder } from '../core/layers';
import { limbPoints } from '../core/limb';
import { compOf } from '../core/comp';
import type { Project, RigNode } from '../core/types';

const POINT_NAME = { arm: { a: 'shoulder', b: 'hand', c: '' }, leg: { a: 'hip', b: 'knee', c: 'ankle' } } as const;

/**
 * One layer, as the model needs to know it to EDIT it rather than add a second one: what
 * it is, where it lives (world, on the mascot, on its surface), what shape it is, when it
 * is on screen, and — for a limb — where its points are.
 */
function layerLine(p: Project, n: RigNode, z: number): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  const tl = activeTimeline(p);
  const bits: string[] = [n.kind === 'svgLayer' ? 'svg' : n.kind];
  if (n.id !== p.rig.rootId) {
    if (n.parentId === null) bits.push(`world at ${r(n.surface.flatOffset?.x ?? 0)},${r(n.surface.flatOffset?.y ?? 0)}`);
    else if (n.parentId === p.rig.rootId) {
      bits.push(n.surface.mapped ? `on the mascot's surface, yaw ${r(n.surface.yaw)} pitch ${r(n.surface.pitch)}` : 'on the mascot');
    } else bits.push(`attached to "${p.rig.nodes[n.parentId]?.name ?? n.parentId}"`);
  }
  const shape = n.shapePath ? shapeById(shapeIdOf(n.shapePath) ?? '')?.id ?? 'custom outline' : undefined;
  if (shape) bits.push(`shape ${shape}`);
  if (n.limb) {
    const names = POINT_NAME[n.limb.type];
    bits.push(limbPoints(n.limb).map((k) => `${names[k]} ${r(n.limb![k]!.x)},${r(n.limb![k]!.y)}`).join(' '));
    bits.push(`rubber hose ${n.limb.hose >= 0.5 ? 'on' : 'off'}, length ${n.limb.length}, bend ${n.limb.bend}, thickness ${n.limb.thickness}`);
  }
  if (n.eye) bits.push(`openness ${n.eye.openness}, distance ${n.eye.distanceFromCenter}°`);
  const spans = appearanceSpans(tl, n.id);
  if (spans.length) bits.push(`on screen ${spans.map((s) => `${Math.round(s.from)}-${Math.round(s.to)}ms`).join(', ')}`);
  else if (n.ranged) bits.push('not on screen in this state');
  if (!n.visible) bits.push('hidden');
  if (n.locked) bits.push('locked');
  bits.push(`z ${z}`);
  return `  ${n.id} "${n.name}" (${bits.join(', ')})`;
}

/**
 * The property reference the model gets, generated from the one PROPS table.
 *
 * Hand-written, this list went stale the first time a property was added — which is how
 * the copilot ended up being told about properties it could not set and not told about
 * ones it could. See COPILOT.md.
 */
const EFFECT_PROPERTY_DOCS = NUMERIC_PROPS
  .filter((path) => PROPS[path].on === 'effect')
  .map((path) => {
    const [min, max, , unit] = PROPS[path].range!;
    return `  ${path.padEnd(18)} ${min}..${max}${unit ? ` ${unit}` : ''}  ${PROPS[path].help}`;
  })
  .join('\n');

const PROPERTY_DOCS = NUMERIC_PROPS
  .filter((path) => PROPS[path].on === 'node')
  .map((path) => {
    const [min, max, , unit] = PROPS[path].range!;
    return `  ${path.padEnd(24)} ${min}..${max}${unit ? ` ${unit}` : ''}  ${PROPS[path].help}`;
  })
  .join('\n');

const round = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));

/** `0=1 1700=1 1790=0.06` — every keyframe of one track, as ms=value. */
const keys = (t: { keyframes: { time: number; value: unknown }[] }) =>
  t.keyframes.map((k) => `${Math.round(k.time)}=${round(k.value)}`).join(' ');

/**
 * Everything already on the timeline, at the exact coordinates the editing tools take.
 *
 * Without this the copilot could only ever append: it was told the timeline's length and
 * how many clips were on it, and nothing about what was in them, so "make the blink
 * slower" or "delete that keyframe" had nothing to refer to. Budgeted rather than
 * unbounded — a heavily animated project would otherwise crowd out the tools.
 */
/**
 * Where anything new should begin, in ms.
 *
 * Left to itself the model writes its first keyframe at 0 and overwrites whatever is
 * already on the strip, or picks an arbitrary offset. So compute it here: after
 * everything already tiled on the strip, and never more than START_CEILING into an empty
 * timeline — a clip whose motion begins three seconds in reads as broken, not as patient.
 */
const START_CEILING = 1500;
export function suggestedStart(p: Project): number {
  const tl = activeTimeline(p);
  const end = blocksEnd(tl);
  return end > 0 ? Math.round(end) : Math.min(START_CEILING, Math.round(tl.timelineDurationMs * 0.15));
}

function timelineDump(p: Project, budget = 4000): string {
  const tl = activeTimeline(p);
  const starts = blockStarts(tl);
  const clipOf = new Map(tl.blocks.map((b, i) => [b.id, `${b.name}@${Math.round(starts[i])}`]));

  const strip = tl.blocks.length
    ? tl.blocks.map((b, i) => `  ${i}: "${b.name}" ${Math.round(starts[i])}-${Math.round(starts[i] + b.durationMs)}ms${b.loop ? ' (loops)' : ''}`).join('\n')
    : '  (empty strip — keyframes here are global rather than owned by a clip)';

  const lines: string[] = [];
  let used = 0, dropped = 0;
  for (const t of tl.tracks) {
    const line = `  ${t.nodeId}.${t.property}${t.blockId ? ` [${clipOf.get(t.blockId) ?? '?'}]` : ''}: ${keys(t)}`;
    if (used + line.length > budget) { dropped++; continue; }
    used += line.length;
    lines.push(line);
  }
  if (dropped) lines.push(`  \u2026and ${dropped} more tracks, not shown. Ask which layer to work on rather than guessing.`);

  return `WHERE NEW ANIMATION GOES. Two kinds of time, do not mix them up:

  create_preset — the times inside a preset are relative to the PRESET, so its first
  keyframe is at 0. add_preset_to_timeline then places the whole clip after everything
  already on the strip and stretches the timeline to fit. This is the route to prefer.

  add_keyframe / move_keyframe / remove_keyframe — times are ABSOLUTE on this timeline.
  New work there starts at ${suggestedStart(p)}ms, which is past everything already on
  the strip. Do not write to 0 unless that number is 0 — you would be editing existing
  clips. Then check it fits: the last keyframe must land inside the timeline with a
  little air after it, or call set_timeline with a durationMs that does.

Either way the first keyframe is the resting pose and the first movement comes 300-1500ms
after the clip's own start, never more than 2000ms.

Clips on the strip (index: name, span):
${strip}

Keyframes on this timeline, as "<layer>.<property> [clip]: <ms>=<value> \u2026". These are the
exact times remove_keyframe and move_keyframe take, and add_keyframe at one of them
overwrites that keyframe in place rather than adding a second one:
${lines.length ? lines.join('\n') : '  (nothing animated yet)'}`;
}

/**
 * @param made names of presets and clips this conversation has already created, newest
 *   last. Without it a follow-up like "make it scale more" reads as a fresh request and
 *   the copilot builds a second clip beside the first instead of changing it.
 */
export function systemPrompt(p: Project, made: string[] = [], playhead = 0): string {
  const tl = activeTimeline(p);
  // built-in preset contents are not worth the tokens; the ones a user asks to edit are
  const custom = p.presets.filter((x) => x.source === 'custom');
  // back to front — the draw order reorder_layer changes
  const nodes = layerOrder(p.rig).map((n, z) => layerLine(p, n, z)).join('\n');
  const comp = compOf(p);
  return `You are the animation copilot inside blooby, a mascot studio.

The mascot is a sphere (the body) with features mapped onto its surface. Mapped features
are NOT positioned in pixels — they use two angles:
  surface.yaw   left(-) / right(+), degrees, around the sphere
  surface.pitch up(-) / down(+), degrees
A feature near the rim foreshortens automatically; past ~90° it hides behind the silhouette.
Roll (transform.rotation) is ordinary in-plane 2D rotation.

Animatable properties — these exact paths, nothing else. Every keyframe, every preset
track and every expression snapshot key uses the full path, never the short name:
${PROPERTY_DOCS}

Canvas: ${comp.width}×${comp.height} px at ${p.fps} fps. The playhead is at ${Math.round(playhead)}ms — "here", "now" and
"at this point" mean that time.

Layers, back to front (the draw order). EDIT these by name rather than adding a second one:
${nodes}
Expressions: ${p.expressions.map((e) => `${e.name}`).join(', ') || 'none'}
Presets: ${p.presets.map((e) => `${e.name} (${fmtSec(e.durationMs)}, ${e.tracks.length} tracks)`).join(', ')}
Shapes: ${Object.values(p.rig.nodes).filter((n) => n.shapePath).map((n) => `${n.id} is a ${n.shape?.kind ?? 'custom outline'}`).join(', ') || 'every layer is its natural shape'}
Effects and emitters running now (the id is what add_keyframe takes in place of a layer):
${[
    ...tl.modifiers.map((m) => `  ${m.id} — ${m.kind} on ${m.nodeId}`),
    ...(tl.emitters ?? []).map((e) => `  ${e.id} — "${e.name}" (${e.glyphs.join('')}, ${e.path})`),
  ].join('\n') || '  none'}

An effect's own properties are animatable exactly like a layer's: pass the EFFECT's id as
nodeId and one of these as property. Use them to make a stream speed up, a ring widen, or
a shake die away — things no keyframe on the rig can do:
${EFFECT_PROPERTY_DOCS}
Active timeline: "${tl.name}" — ${fmtSec(tl.timelineDurationMs)} at ${p.fps} fps, ${tl.blocks.length} blocks${tl.loop ? ', loops' : ''}.
${p.timelines.length > 1 ? `Other timelines (separate states, not shown here): ${p.timelines.filter((t) => t.id !== tl.id).map((t) => t.name).join(', ')}.` : ''}

Current state: "${tl.name}" — the active timeline, and the state "whatever state I'm in" means.
States: ${p.timelines.map((t) => `"${t.name}"`).join(', ')}.
State machine — states are the timelines above. REUSE these, never redeclare them:
  Inputs: ${machineOf(p).inputs.map((i) => `${i.name} (${i.type}, default ${JSON.stringify(i.value)})`).join(', ') || 'none yet'}
  Transitions: ${machineOf(p).transitions.map((t) => {
    const name = (id: string) => p.timelines.find((x) => x.id === id)?.name ?? '?';
    return `${name(t.from)} -> ${name(t.to)} when ${t.conditions.map((c) => conditionText(c, machineOf(p).inputs)).join(t.logic === 'OR' ? ' or ' : ' and ')}`;
  }).join('; ') || 'none yet'}
When the user describes BEHAVIOUR ("look at me when I'm typing", "get excited above 80
energy"), author it as inputs plus transitions — not as keyframes and not by playing an
animation. The state machine decides which state is active at runtime.

${timelineDump(p)}
${custom.length ? `\nPresets you or the user authored, in full — edit_preset replaces these tracks wholesale,
so carry over anything you are not deliberately changing:\n${custom.map((x) => `  "${x.name}" (${fmtSec(x.durationMs)})\n${x.tracks.map((t) => `    ${t.nodeId}.${t.property}: ${keys(t)}`).join('\n')}`).join('\n')}` : ''}

Answer with one JSON object and nothing else — no prose, no markdown fence. Fill the keys
in this order, because each one depends on the one before it:
  {
    "plan": "<what the request means, which of the recipes below it matches, what is
             already on the timeline that matters, and the beats you are about to write
             with their times. Work it out here before you write a single call.>",
    "reply": "<one or two sentences for the user>",
    "calls": [ { "name": "<tool>", "args": { ... } } ]
  }

Tools:
${TOOL_DOCS}

${ANIMATION_CRAFT}

${made.length ? `You made these in this conversation, newest last: ${made.join(', ')}.
"it", "the animation", "that clip" and anything else the user says without naming
something refers to the newest of them.

` : ''}FOLLOW-UPS. A message that refines what you just did — "bigger", "slower", "more
rotation", "now make it blink at the end" — is an EDIT of that work, not a new clip.
- To change what the user is LOOKING AT, edit the keyframes on the strip. add_keyframe at
  a time already listed under "Keyframes" overwrites that keyframe in place;
  move_keyframe retimes one; remove_keyframe deletes one. This is what actually changes
  the animation.
- edit_preset changes the saved template ONLY. A clip already on the strip keeps the copy
  it was added with, so editing the preset alone changes nothing on screen. When the user
  is refining a clip that came from a preset you made, edit the clip's keyframes, and
  edit_preset as well if they want the saved version to match.
- Build a second preset only when asked for one in so many words — "add another",
  "also make a", "a second". If you cannot tell whether a message refines or adds, refine:
  an unwanted extra clip is more annoying to undo than a value pushed further.

Rules:
- Work through "plan" first: read the request, match it to a recipe, read the keyframes
  already on the timeline, then decide the beats and their times. Every call must follow
  from something you said there.
- Refer to layers by the ids above (body, eyeL, eyeR), not by their display names.
- A preset track's "property" is a full path from the list above: "eye.openness", not
  "openness". The short names in set_eye_params are that one tool's own shorthand.
- Prefer existing presets for common beats (Blink, Talk, Happy, Surprised, Thinking, Notify).
- Times are milliseconds. The ones under "Keyframes" are absolute — a clip starting at
  2400ms has its first keyframe at 2400, not at 0. The ones inside create_preset are not:
  they are relative to the preset and start at 0.
- To retime or delete existing animation, use move_keyframe / remove_keyframe with a time
  taken from the list above. To change a value or an easing, call add_keyframe at that
  same time. Do not clear a track and rebuild it to change one keyframe.
- Keep "reply" to one or two sentences. Put every change in "calls" — never describe a change you did not emit.
- Emit an empty "calls" array when the user is only asking a question.
- "reply" is required, even when "calls" is empty.
- To build a named effect ("a big-eye look", "a wave"), emit create_preset with every
  track it needs, then add_preset_to_timeline with the same name. That makes it reusable
  and puts it on the strip in one turn.
- A preset track needs nodeId, property and at least two keyframes, and should start and
  end on the resting value so it can sit anywhere on the strip.
- Reach for set_timeline, clear_animation, set_block_duration, move_block, remove_block,
  add_timeline and set_camera for everything else — you can drive the whole editor.
- For anything leaving the mascot — zzz above a sleeper, ♪ for singing, tears, confetti,
  objects orbiting overhead — use add_emitter rather than trying to keyframe it. Pin an
  endpoint to a layer with fromNode/toNode when it should come from that layer.
- add_modifier "pendulum" swings one axis; set_effect_range narrows when any effect or
  emitter runs, in ms from the start of its own scope.
- set_shape gives a layer an outline, and two shape keyframes MORPH between them — that is
  how an eye becomes a star. Start from the layer's natural shape (the body is a circle,
  an eye is a pill) or the first frame pops.
- set_emitter_parts decides what an emitter throws. Several parts at different speeds,
  sizes and colours is what makes a burst read; one shape repeated does not.
- "visible" is a plain 0-1 property that fades AND shrinks — keyframe it to 0 to retire a
  feature into the next clip rather than blinking it off. "opacity" fades without shrinking.
- Freeform layers. Look for the layer in the list above before adding one — "the hat", "the
  star", "the left leg" name a layer that is already there.
  · "make the hat follow the head" → set_layer_attachment { nodeId: the hat, mode: "mascot" }.
  · "make it appear from 500ms to 1200ms" → set_layer_appearance_range { startMs: 500, endMs: 1200 }.
  · "add a blue SVG star" → add_layer { type: "shape", shape: "star", fill: [r,g,b] }; given
    actual <svg> markup, add_svg with it.
  · "change the (current) shape to octopus" → set_shape on body, or with atMs at the playhead
    when the body's shape is already keyframed, so it becomes a morph.
  · Limbs keep their length, like Cavalry's rubber hose: the points are where the shoulder
    and hand sit, and the limb bends to fit its length between them. "make the hand longer"
    → set_hand_rig { length } ~30% above the length listed. "bend the left leg more" →
    set_leg_rig { length } longer too (it bends more between the same points), or its
    ankle closer with set_leg_points. bend flips the side (sign) and rounds the bend (±1).
    Hands have two points (shoulder, hand), legs three (hip, knee, ankle), body px, +y down.
  · fill and stroke are separate: set_svg_fill and set_svg_stroke, each with atMs to keyframe.
- States. "transition from whatever state I'm in to happy" → set_transition { to: "Happy" }
  (from defaults to the current state). ONE direct edge — never route through other states.
  "make the current state angry": if a state called Angry exists, set_state it; otherwise
  give the current state an angry look with keyframes or the Angry preset.
- Say it in one sentence. A long "reply" is the one thing that can get your answer cut
  off before the "calls" array is written, which loses all of the work.`;
}
