import { blockStarts, fmtSec } from '../core/timeline';
import { TOOL_DOCS } from './tools';
import { ANIMATION_CRAFT } from './craft';
import { activeTimeline } from '../core/types';
import { NUMERIC_PROPS, PROPS } from '../core/props';
import type { Project } from '../core/types';

/**
 * The property reference the model gets, generated from the one PROPS table.
 *
 * Hand-written, this list went stale the first time a property was added — which is how
 * the copilot ended up being told about properties it could not set and not told about
 * ones it could. See COPILOT.md.
 */
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

  return `Clips on the strip (index: name, span):
${strip}

Keyframes on this timeline, as "<layer>.<property> [clip]: <ms>=<value> \u2026". These are the
exact times remove_keyframe and move_keyframe take, and add_keyframe at one of them
overwrites that keyframe in place rather than adding a second one:
${lines.length ? lines.join('\n') : '  (nothing animated yet)'}`;
}

/** Compact enough to fit any context window, complete enough to act on. */
export function systemPrompt(p: Project): string {
  const tl = activeTimeline(p);
  // built-in preset contents are not worth the tokens; the ones a user asks to edit are
  const custom = p.presets.filter((x) => x.source === 'custom');
  const nodes = Object.values(p.rig.nodes)
    .map((n) => `  ${n.id} "${n.name}" (${n.kind}${n.eye ? `, openness ${n.eye.openness}, distance ${n.eye.distanceFromCenter}°` : ''})`)
    .join('\n');
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

Layers:
${nodes}
Expressions: ${p.expressions.map((e) => `${e.name}`).join(', ') || 'none'}
Presets: ${p.presets.map((e) => `${e.name} (${fmtSec(e.durationMs)}, ${e.tracks.length} tracks)`).join(', ')}
Active timeline: "${tl.name}" — ${fmtSec(tl.timelineDurationMs)} at ${p.fps} fps, ${tl.blocks.length} blocks${tl.loop ? ', loops' : ''}.
${p.timelines.length > 1 ? `Other timelines (separate states, not shown here): ${p.timelines.filter((t) => t.id !== tl.id).map((t) => t.name).join(', ')}.` : ''}

${timelineDump(p)}
${custom.length ? `\nPresets you or the user authored, in full — edit_preset replaces these tracks wholesale,
so carry over anything you are not deliberately changing:\n${custom.map((x) => `  "${x.name}" (${fmtSec(x.durationMs)})\n${x.tracks.map((t) => `    ${t.nodeId}.${t.property}: ${keys(t)}`).join('\n')}`).join('\n')}` : ''}

Answer with one JSON object and nothing else — no prose, no markdown fence:
  { "reply": "<one or two sentences>", "calls": [ { "name": "<tool>", "args": { ... } } ] }

Tools:
${TOOL_DOCS}

${ANIMATION_CRAFT}

Rules:
- Refer to layers by the ids above (body, eyeL, eyeR), not by their display names.
- A preset track's "property" is a full path from the list above: "eye.openness", not
  "openness". The short names in set_eye_params are that one tool's own shorthand.
- Prefer existing presets for common beats (Blink, Talk, Happy, Surprised, Thinking, Notify).
- Times are milliseconds from the start of the timeline, and the ones under "Keyframes"
  are absolute — a clip starting at 2400ms has its first keyframe at 2400, not at 0.
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
- Say it in one sentence. A long "reply" is the one thing that can get your answer cut
  off before the "calls" array is written, which loses all of the work.`;
}
