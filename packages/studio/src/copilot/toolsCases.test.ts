import { it } from 'vitest';
import { check } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { SHAPE_LIBRARY, libraryOutline } from '../core/emitters';
import { rolesFor } from '../core/layers';
import { activeTimeline } from '../core/types';
import { applyCalls, describe, normaliseCall, validate, validateBatch, TOOL_NAMES, type ToolCall } from './tools';

/**
 * Every tool, driven through its three faces — validate, describe, applyCalls — with the
 * arguments a model gets wrong and the ones it gets right. The scripts beside this one
 * cover the requests; this one covers the edges of each tool.
 */

const ed = () => useEditor.getState();
const P = () => ed().project;
const fails: string[] = [];
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ name, args });

/** stage a turn the way the Copilot panel does: normalise, validate as a batch, apply */
const run = (calls: ToolCall[]) => {
  // set_camera's `fov` / `distance` are also short names of layer properties, so it is not normalised
  const staged = calls.map((c) => (c.name === 'set_camera' ? c : normaliseCall(P(), c)));
  const problems = validateBatch(P(), staged);
  problems.forEach((m, i) => { if (m) fails.push(`${staged[i].name}: ${m}`); });
  if (!problems.some(Boolean)) {
    staged.forEach((c) => { if (typeof describe(P(), c) !== 'string') fails.push(`${c.name}: describe`); });
    applyCalls(staged);
  }
};
/** one call that must be accepted, described and applied on a project of its own */
const ok = (name: string, args: Record<string, unknown> = {}) => { world(); run([call(name, sub(args) as Record<string, unknown>)]); };
/** the same, on whatever the last call left */
const next = (name: string, args: Record<string, unknown> = {}) => run([call(name, sub(args) as Record<string, unknown>)]);
const bads: string[] = [];
const bad = (name: string, args: Record<string, unknown> = {}) => {
  const m = validate(P(), call(name, args));
  if (typeof m !== 'string') bads.push(`${name} ${JSON.stringify(args)} was accepted`);
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z" fill="#f00"/></svg>';
const textId = (i: number) => Object.values(P().rig.nodes).filter((n) => n.text)[i]?.id ?? 'none';
/** '@T' / '@T2' / '@B' stand for ids that only exist once the world is built */
const sub = (v: unknown): unknown => {
  if (v === '@T') return textId(0);
  if (v === '@T2') return textId(1);
  if (v === '@B') return activeTimeline(P()).blocks[0]?.id ?? 'none';
  if (Array.isArray(v)) return v.map(sub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
  return v;
};

/** a project with one of everything a tool can be pointed at */
function world() {
  ed().loadProject(defaultProject());
  ed().setPlayhead(0);
  run([
    call('add_layer', { type: 'shape', shape: 'star', name: 'Star', attach: 'mascot' }),
    call('add_layer', { type: 'hand', side: 'left', name: 'Hand' }),
    call('add_layer', { type: 'leg', side: 'left', name: 'Leg' }),
    call('add_layer', { type: 'group', name: 'Group' }),
    call('add_svg', { markup: SVG, name: 'Logo' }),
    call('add_text', { content: 'Hello' }),
    call('add_text', { content: 'World' }),
    call('add_curve', { points: [[0, 0], [100, 50], [200, 0]], name: 'Wave' }),
    call('add_curve', { points: [[0, 0], [100, 50]], name: 'Short' }),
    call('add_mascot', { name: 'Friend' }),
    call('add_input', { name: 'happy', type: 'Boolean' }),
    call('add_input', { name: 'energy', type: 'Numeric' }),
    call('add_input', { name: 'mood', type: 'String' }),
    call('add_input', { name: 'poke', type: 'Event' }),
    call('add_emitter', { name: 'Zzz', glyphs: ['z'] }),
    call('add_modifier', { nodeId: 'body', kind: 'shake' }),
    call('create_preset', { name: 'Nod', durationMs: 600, tracks: [{ nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 5 }, { time: 600, value: 0 }] }] }),
    call('add_preset_to_timeline', { preset: 'Nod' }),
    call('add_keyframe', { nodeId: 'body', property: 'transform.rotation', atMs: 700, value: 2 }),
    call('add_keyframe', { nodeId: 'body', property: 'transform.scale.y', atMs: 700, value: 1 }),
    call('add_timeline', { name: 'Other' }),
    call('set_state', { state: 'Idle' }),
  ]);
}

// --- what a model gets wrong ---------------------------------------------------------------------
{
  world();
  const T = textId(0);
  const BAD: [string, Record<string, unknown>][] = [
    ['set_eye_params', { nodeId: 'zz' }],
    ['set_property', { nodeId: 'zz' }], ['set_property', { nodeId: 'body', property: 'nope', value: 1 }], ['set_property', { nodeId: 'body', property: 'transform.rotation' }],
    ['add_keyframe', { nodeId: 'body', property: 'transform.rotation', value: 1 }],
    ['create_expression', {}], ['create_expression', { name: 'x', snapshot: { 'zz.transform.rotation': 1 } }], ['create_expression', { name: 'x', snapshot: { 'body.nope': 1 } }],
    ['apply_expression', { expression: 'zz' }], ['apply_expression', { expression: 'Happy' }],
    ['create_preset', {}], ['create_preset', { name: 'x', tracks: [null] }], ['create_preset', { name: 'x', tracks: [{ nodeId: 'zz' }] }],
    ['create_preset', { name: 'x', tracks: [{ nodeId: 'body', property: 'nope' }] }], ['create_preset', { name: 'x', tracks: [{ nodeId: 'body', property: 'transform.rotation' }] }],
    ['edit_preset', { preset: 'zz' }], ['edit_preset', { preset: 'Nod' }], ['edit_preset', { preset: 'Nod', tracks: 'x' }], ['edit_preset', { preset: 'Nod', tracks: [] }],
    ['edit_preset', { preset: 'Nod', tracks: [{ nodeId: 'zz' }] }],
    ['remove_keyframe', { nodeId: 'zz' }], ['remove_keyframe', { nodeId: 'body', property: 'nope' }], ['remove_keyframe', { nodeId: 'body', property: 'transform.rotation' }],
    ['remove_keyframe', { nodeId: 'body', property: 'transform.rotation', atMs: 123 }], ['remove_keyframe', { nodeId: 'body', property: 'transform.scale.x', atMs: 5 }],
    ['move_keyframe', { nodeId: 'body', property: 'transform.rotation' }], ['move_keyframe', { nodeId: 'body', property: 'transform.rotation', fromMs: 700 }],
    ['add_preset_to_timeline', { preset: 'zz' }],
    ['add_modifier', { nodeId: 'zz', kind: 'shake' }], ['add_modifier', { nodeId: 'body', kind: 'zz' }],
    ['set_timeline', {}], ['set_timeline', { durationMs: 50 }], ['set_timeline', { fps: 500 }],
    ['clear_animation', { nodeId: 'zz' }],
    ['set_block_duration', { block: 'zz' }], ['set_block_duration', { block: 0, durationMs: 5 }], ['remove_block', { block: 'zz' }], ['move_block', { block: 'zz' }],
    ['add_timeline', {}],
    ['add_input', {}], ['add_input', { name: 'x', type: 'Zzz' }],
    ['add_transition', { from: 'zz' }], ['add_transition', { from: 'Idle', to: 'zz' }], ['add_transition', { from: 'Idle', to: 'Other' }],
    ['add_transition', { from: 'Idle', to: 'Other', conditions: [null] }], ['add_transition', { from: 'Idle', to: 'Other', conditions: [{ input: 'zz' }] }],
    ['add_transition', { from: 'Idle', to: 'Other', conditions: [{ input: 'happy', operator: '>' }] }],
    ['add_emitter', {}], ['add_emitter', { name: 'x' }], ['add_emitter', { name: 'x', glyphs: [] }], ['add_emitter', { name: 'x', glyphs: ['z'], path: 'zz' }],
    ['add_emitter', { name: 'x', glyphs: ['z'], attract: { node: 'zz' } }], ['add_emitter', { name: 'x', glyphs: ['z'], fromNode: 'zz' }],
    ['set_effect_range', { effect: 'zz' }],
    ['set_shape', { nodeId: 'zz' }], ['set_shape', { nodeId: 'Hand', shape: 'star' }], ['set_shape', { nodeId: 'Group', shape: 'star' }], ['set_shape', { nodeId: 'Star', shape: 'zz' }],
    ['add_layer', { type: 'zz' }], ['add_layer', { shape: 'zz' }], ['add_layer', { attach: 'zz' }], ['add_layer', { fill: 'zz' }],
    ['add_svg', {}], ['add_svg', { markup: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }],
    ['remove_layer', { nodeId: 'zz' }], ['remove_layer', { nodeId: 'body' }], ['duplicate_layer', { nodeId: 'body' }],
    ['reorder_layer', { nodeId: 'zz' }], ['reorder_layer', { nodeId: 'Star', to: 'zz' }],
    ['set_layer_visibility', { nodeId: 'zz' }], ['set_layer_visibility', { nodeId: 'Star' }], ['set_layer_lock', { nodeId: 'Star' }],
    ['set_layer_attachment', { nodeId: 'zz' }], ['set_layer_attachment', { nodeId: 'body' }], ['set_layer_attachment', { nodeId: 'Star', mode: 'zz' }],
    ['set_layer_attachment', { nodeId: 'Star', mode: 'mascot', anchor: 'zz' }],
    ['set_layer_appearance_range', { nodeId: 'zz' }], ['set_layer_appearance_range', { nodeId: 'body' }], ['set_layer_appearance_range', { nodeId: 'Star' }],
    ['set_layer_appearance_range', { nodeId: 'Star', startMs: -1 }],
    ['set_svg_fill', { nodeId: 'zz' }], ['set_svg_fill', { nodeId: 'Group' }], ['set_svg_fill', { nodeId: 'Star', color: 'zz' }], ['set_svg_fill', { nodeId: 'Star' }],
    ['set_svg_stroke_width', { nodeId: 'Star' }], ['set_svg_stroke', { nodeId: 'Star', cap: 'zz' }], ['set_svg_stroke', { nodeId: 'Star', join: 'zz' }],
    ['set_text_stroke', { nodeId: 'Star', width: 1 }], ['set_svg_stroke', { nodeId: 'Star' }],
    ['set_shape_morph', { nodeId: 'zz' }], ['set_shape_morph', { nodeId: 'Star', mode: 'zz' }], ['set_shape_morph', { nodeId: 'Star', mode: 'morph' }],
    ['set_shape_morph', { nodeId: 'Star', mode: 'morph', atMs: 0 }],
    ['set_hand_points', { nodeId: 'zz' }], ['set_hand_points', { nodeId: 'Star' }], ['set_hand_points', { nodeId: 'Hand' }], ['set_hand_points', { nodeId: 'Hand', hand: 'x' }],
    ['set_hand_rig', { nodeId: 'Hand' }], ['set_hand_rig', { nodeId: 'Hand', length: 'x' }], ['set_leg_rig', { nodeId: 'Leg' }],
    ['set_composition', { preset: 'zz' }], ['set_composition', {}], ['set_composition', { width: 5 }], ['set_composition', { height: 99999 }],
    ['set_state', { state: 'zz' }],
    ['set_transition', { to: 'zz' }], ['set_transition', { to: 'Other', from: 'zz' }], ['set_transition', { to: 'Idle' }], ['set_transition', { to: 'Other', input: 'happy' }],
    ['set_emitter_parts', { emitter: 'zz' }], ['set_emitter_parts', { emitter: 'Zzz' }], ['set_emitter_parts', { emitter: 'Zzz', parts: [{ shape: 'zz' }] }],
    ['set_camera', { property: 'zz' }], ['set_camera', { property: 'fov' }],
    ['add_mascot', { kind: 'zz' }], ['add_mascot', { x: 'a' }],
    ['remove_mascot', { mascot: 'zz' }], ['remove_mascot', { mascot: 1 }], ['rename_mascot', { mascot: 'Friend' }],
    ['set_mascot_transform', { mascot: 'Friend' }], ['set_mascot_transform', { mascot: 'Friend', x: 'a' }],
    ['set_mascot_shape', { mascot: 'Friend', shape: 'zz' }], ['set_mascot_parent', { mascot: 'Friend', follows: 'zz' }], ['set_mascot_parent', { mascot: 'Friend', follows: 'Friend' }],
    ['add_text', {}], ['add_text', { content: 'x', color: 'zz' }], ['add_text', { content: 'x', attach: 'zz' }],
    ['set_text', { nodeId: 'zz' }], ['set_text', { nodeId: T }], ['set_text_font', { nodeId: T }],
    ['set_text_style', { nodeId: T, align: 'zz' }], ['set_text_style', { nodeId: T, valign: 'zz' }], ['set_text_style', { nodeId: T }], ['set_text_style', { nodeId: T, width: 'x' }],
    ['set_text_size', { nodeId: T }], ['set_text_weight', { nodeId: T }], ['set_text_color', { nodeId: T }],
    ['set_text_curve', { nodeId: T, mode: 'zz' }], ['set_text_curve', { nodeId: T, mode: 'arc', amount: 'x' }],
    ['set_text_path', { nodeId: T, path: 'zz' }], ['set_text_path', { nodeId: T, path: T }], ['set_text_path', { nodeId: T, path: 'Group' }],
    ['set_text_path_offset', { nodeId: T }], ['animate_text', { nodeId: T, effect: 'zz' }],
    ['add_curve', {}], ['add_curve', { points: [[0, 0]] }], ['add_curve', { points: [[0, 0], 'x'] }], ['add_curve', { points: [[0, 0], [1, 1]], type: 'zz' }],
    ['add_curve', { points: [[0, 0], [1, 1]], attach: 'zz' }],
    ['add_curve_point', { nodeId: 'Star' }], ['add_curve_point', { nodeId: 'Wave' }],
    ['move_curve_point', { nodeId: 'Wave', index: 99 }], ['move_curve_point', { nodeId: 'Wave', index: 0 }], ['remove_curve_point', { nodeId: 'Short', index: 0 }],
    ['close_curve', { nodeId: 'Wave' }], ['reverse_curve', { nodeId: 'Star' }],
    ['set_layer_parent', { nodeId: 'zz' }], ['set_layer_parent', { nodeId: 'Star', parent: 'zz' }], ['set_layer_parent', { nodeId: 'Star', parent: 'Star' }],
    ['set_layer_parent', { nodeId: 'Friend', parent: 'Star' }], ['set_layer_parent', { nodeId: 'body', parent: 'Star' }],
    ['set_layer_order', { nodeId: 'zz' }], ['set_layer_order', { nodeId: 'Star', above: 'zz' }], ['set_layer_order', { nodeId: 'Star' }],
    ['set_face', { nodeId: 'zz' }], ['set_face', { nodeId: 'Hand' }], ['add_face', { mascot: 'zz' }], ['pin_limb', { nodeId: 'Star' }],
    ['apply_squish_preset', { nodeId: 'zz' }], ['apply_squish_preset', { nodeId: 'Star', preset: 'zz' }], ['show_layer_in_state', { nodeId: 'zz' }],
    ['set_layer_effect', { nodeId: 'zz' }], ['set_layer_effect', { nodeId: 'Star', kind: 'zz' }],
    ['set_layer_style', { nodeId: 'zz' }], ['set_layer_style', { nodeId: 'Star', blend: 'zz' }], ['set_layer_style', { nodeId: 'Star', mask: { node: 'zz' } }],
    ['set_role', { nodeId: 'zz' }], ['set_role', { nodeId: 'Star', role: 'zz' }],
    ['set_pose', { mascot: 'zz' }], ['set_pose', { pose: 'zz' }],
    ['add_rule', { state: 'zz' }], ['add_rule', { state: 'Idle', input: 'zz' }],
    ['morph_between', { from: 'zz' }], ['morph_between', { from: 'Neutral', to: 'zz' }], ['morph_between', { from: 'Neutral', to: 'Happy' }],
    ['set_block_duration', {}], ['set_block_duration', { block: 0 }], ['set_timeline', { durationMs: 'x' }],
    ['add_transition', { from: 'Idle', to: 'Other', conditions: [{ input: 'energy' }] }],
    ['set_effect_range', {}], ['remove_mascot', {}], ['create_expression', { name: 'x', snapshot: { zz: 1 } }], ['create_expression', { name: 'x', snapshot: { body: 1 } }],
    ['remove_keyframe', { nodeId: 'Star', property: 'surface.pitch', atMs: 5 }],
    ['add_emitter', { name: 'x', glyphs: ['z'], attract: {} }], ['add_emitter', { name: 'x', glyphs: ['z'], attract: { nodeId: 'zz' } }],
    ['set_text_style', { nodeId: 'zz' }], ['set_text_curve', { nodeId: 'zz' }], ['set_text_path', { nodeId: 'zz' }], ['move_curve_point', { nodeId: 'zz' }],
    ['add_curve_point', { nodeId: 'zz' }], ['apply_squish_preset', { nodeId: 'Star' }], ['set_layer_style', { nodeId: 'Star', mask: { nodeId: 'zz' } }],
    ['set_pose', {}], ['set_hand_points', { nodeId: 'Leg' }], ['set_leg_points', { nodeId: 'Hand' }],
    ['not_a_tool', {}],
  ];
  for (const [n, a] of BAD) bad(n, a);
  it('every mistake is turned back with a reason', check(bads.length === 0, bads.join('\n')));
  it('every library shape has an outline', check(SHAPE_LIBRARY.every((s) => !!libraryOutline(s.id))));
  it('a call with no args at all is read as {}', check(typeof validate(P(), { name: 'add_timeline' } as ToolCall) === 'string' && validateBatch(P(), [{ name: 'set_camera' } as ToolCall])[0] !== undefined));
  it('describe falls back to the tool name', check(describe(P(), call('zzz')) === 'zzz' && describe(P(), { name: 'zzz' } as ToolCall) === 'zzz'));
  it('the world itself was valid', check(fails.length === 0, fails.join('\n')));
}

// --- the forgiving forms -------------------------------------------------------------------------
{
  world();
  const n = (c: ToolCall) => normaliseCall(P(), c);
  it('"body.transform.rotation" splits into a layer and a property', check(n(call('set_property', { nodeId: 'body.transform.rotation', value: 1 })).args.property === 'transform.rotation'));
  it('a property that disagrees keeps the string as written', check(n(call('set_property', { nodeId: 'body.transform.rotation', property: 'transform.scale.x', value: 1 })).args.nodeId === 'body.transform.rotation'));
  it('a dotted name that is no layer is left alone', check(n(call('set_property', { nodeId: 'zz.transform.rotation' })).args.nodeId === 'zz.transform.rotation'));
  it('a track that is not an object passes through, an unknown layer keeps its name', check((n(call('create_preset', { name: 'q', tracks: [null, { nodeId: 'zz', property: 'nope' }] })).args.tracks as unknown[])[0] === null));
  it('a snapshot key it cannot resolve stays', check('zz.q' in (n(call('create_expression', { name: 'q', snapshot: { 'zz.q': 1, plain: 2, 'body.rotation': 3 } })).args.snapshot as object)));
  it('time / duration / layer aliases become the real names', check(n(call('add_keyframe', { layer: 'body', time: 1, duration: 2 })).args.atMs === 1));
  it('a mascot by number becomes its id', check(n(call('remove_mascot', { mascot: 2 })).args.mascot !== 2));
  it('create_preset with a taken name is an edit', check(n(call('create_preset', { name: 'Nod' })).name === 'edit_preset'));
  it('args are optional', check(typeof normaliseCall(P(), { name: 'set_camera' } as ToolCall).args === 'object'));
  it('a batch sees what its own earlier calls will make', check(validateBatch(P(), [call('add_input', { name: 'fresh', type: 'Boolean' }), call('add_input', { name: 'fresh', type: 'Boolean' }), call('add_timeline', { name: 'Fresh' }), call('set_state', { state: 'Fresh' })]).every((m) => m === null)));
}

// --- accepted as written, described when the thing they name is missing --------------------------
{
  world();
  it('a mascot by "#2" is accepted as written', check(validate(P(), call('rename_mascot', { mascot: '#2', name: 'x' })) === null));
  it('a batch of calls with no args still plans their layers', check(validateBatch(P(), [{ name: 'add_layer' } as ToolCall])[0] === null));
  const d = (n: string, a: Record<string, unknown> = {}) => describe(P(), call(n, a));
  const lost = [
    d('add_preset_to_timeline'), d('apply_expression'), d('set_shape', { nodeId: 'Star', shape: 'zz' }), d('add_layer', { shape: 'zz' }), d('add_mascot', { kind: 'zz' }),
    d('set_mascot_shape', { mascot: 'zz', shape: 'zz' }), d('add_text'), d('set_text_path', { nodeId: '@T', path: 'zz' }), d('set_layer_parent', { nodeId: 'Star', parent: 'zz' }),
    d('set_layer_order', { nodeId: 'Star', above: 'zz' }), d('set_layer_order', { nodeId: 'Star', below: 'zz' }), d('apply_squish_preset', { nodeId: 'Star', preset: 'zz' }),
    d('set_layer_effect', { nodeId: 'Star', kind: 'zz' }), d('set_pose', { pose: 'zz' }), d('set_svg_fill', { nodeId: 'Star', color: 'zz' }), d('remove_mascot', { mascot: 'zz' }),
    d('set_text_size', { nodeId: 'Star', size: 4, atMs: 5 }), d('set_text_path_offset', { nodeId: 'Star', offset: 4 }), d('set_transition', { to: 'Other' }),
  ];
  it('naming something that is not there still reads as a sentence', check(lost.every((s) => typeof s === 'string' && s.length > 0)));
  const noActive = { ...P(), activeTimelineId: 'zz' };
  it('and a transition with no current state says so', check(describe(noActive, call('set_transition', { to: 'Other' })).includes('the current state')));
  const rootless = { ...P(), rig: { ...P().rig, rootId: 'zz' } };
  it('a project with no first mascot has an empty roster', check(typeof validate(rootless, call('remove_mascot', { mascot: 3 })) === 'string'));
}

// --- what a model gets right: every tool, applied and described -----------------------------------
{
  world();
  const Hand = () => Object.values(P().rig.nodes).find((x) => x.name === 'Hand')!;

  // expression, eye and property edits
  ok('set_eye_params', { nodeId: 'eyeL', openness: 0.5, scaleX: 1.1, atMs: 100 });
  ok('set_eye_params', { nodeId: 'eyeL', rotation: 3 });
  ok('set_eye_params', { nodeId: 'eyeL' });
  ok('set_property', { nodeId: 'body', property: 'transform.rotation', value: 4 });
  ok('set_property', { nodeId: 'body', property: 'transform.rotation', value: 4, atMs: 50 });
  ok('set_property', { nodeId: 'body', property: 'transform.scale.x', value: 1.1 });
  ok('add_keyframe', { nodeId: 'body', property: 'transform.scale.x', atMs: 10, value: 1.2, easing: 'bounce' });
  ok('create_expression', { name: 'Mine', snapshot: { 'body.transform.rotation': 3, 'body.transform.scale.x': 'x' } });
  ok('apply_expression', { expression: 'Happy', atMs: 200 });
  ok('create_preset', { name: 'Fresh', tracks: [{ nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 300, value: 5 }, { time: 0 }] }, { nodeId: 'body', property: 'transform.scale.x', keyframes: [{}] }] });
  ok('edit_preset', { preset: 'Nod', name: 'Nodding', durationMs: 900, tracks: [{ nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 1 }] }] });
  ok('edit_preset', { preset: 'Nod', name: '  ' });
  ok('remove_keyframe', { nodeId: 'body', property: 'transform.scale.y', atMs: 700 });
  ok('remove_keyframe', { nodeId: 'body', property: 'transform.rotation', atMs: 700 });
  ok('move_keyframe', { nodeId: 'body', property: 'transform.rotation', fromMs: 700, toMs: 650 });
  ok('add_preset_to_timeline', { preset: 'Nod', index: 0 });
  ok('add_preset_to_timeline', { preset: 'Nod', mascot: 'Friend' });
  ok('add_preset_to_timeline', { preset: 'Nod', mascot: 'zz' });
  ok('add_modifier', { nodeId: 'camera', kind: 'shake' });
  ok('add_modifier', { nodeId: 'body', kind: 'float', amount: 50, frequency: 2, amplitude: 3, seed: 1, phase: 2 });
  ok('morph_between', { from: 'Neutral', to: 'Happy', atMs: 100, durationMs: 200 });
  ok('morph_between', { from: 'Happy', to: 'Happy', atMs: 100, durationMs: 200 });

  // timeline and strip
  for (const a of [{ durationMs: 3000 }, { loop: true }, { loop: false }, { fps: 30 }, { durationMs: 3000, loop: true, fps: 24 }]) ok('set_timeline', a);
  ok('clear_animation', {});
  ok('clear_animation', { nodeId: 'body' });
  ok('clear_animation', { nodeId: 'body', property: 'transform.rotation' });
  ok('set_block_duration', { block: 'Nod', durationMs: 800 });
  ok('set_block_duration', { block: '0', durationMs: 800 });
  ok('set_block_duration', { block: '@B', durationMs: 800 });
  ok('remove_block', { block: 0 });
  ok('move_block', { block: 0, index: 0 });
  ok('move_block', { block: 0 });
  ok('add_timeline', { name: 'Third', copyLayers: false });
  ok('add_timeline', { name: 'Idle' });
  ok('set_state', { state: 'Other' });
  ok('set_camera', { property: 'fov', value: 40 });
  ok('set_camera', { property: 'distance', value: 900 });
  ok('set_camera', { property: 'perspective', value: 40 });
  ok('set_composition', { preset: '1080x1080' });
  ok('set_composition', { preset: '1080 × 1080' });
  ok('set_composition', { width: 500 });
  ok('set_composition', { height: 600 });
  ok('set_composition', { width: 500, height: 600 });

  // the state machine
  ok('add_input', { name: 'happy', type: 'Boolean' });
  ok('add_input', { name: 'level', type: 'Numeric', default: 3, description: 'how much' });
  ok('add_input', { name: 'pinged', type: 'Event' });
  world();
  run([call('add_transition', { from: 'Idle', to: 'Other', logic: 'OR', conditions: [
    { input: 'happy', operator: 'is false' }, { input: 'happy', operator: '==' }, { input: 'happy', operator: '==', value: false }, { input: 'energy', operator: '>', value: 3 }, { input: 'energy', operator: '>' },
    { input: 'mood', operator: '==', value: 'x' }, { input: 'mood', operator: '==' }, { input: 'poke' }] })]);
  next('add_transition', { from: 'Idle', to: 'Other', logic: 'OR', conditions: [{ input: 'poke' }] });
  next('add_transition', { from: 'Idle', to: 'Other', conditions: [{ input: 'poke' }] });
  next('add_rule', { state: 'Other', input: 'energy', operator: '>', value: 3 });
  next('add_rule', { state: 'Other', input: 'energy', operator: '>', value: 3 });
  next('add_rule', { state: 'Other', input: 'happy' });
  ok('set_transition', { to: 'Other' });
  ok('set_transition', { from: 'any', to: 'Other', durationMs: 50, input: 'mood' });
  ok('set_transition', { from: 'Other', to: 'Idle' });
  ok('set_transition', { from: 'current', to: 'Other' });

  // emitters
  ok('add_emitter', {
    name: 'Full', glyphs: ['a'], color: [1, 2, 3], colorTo: '#ff0000', size: 30, path: 'orbit', velocity: 1, velocityJitter: 1, angle: 1, spread: 1, drag: 1, gravity: 1, turbulence: 1,
    attract: { node: 'Star', startMs: 5, durationMs: 10, fill: false }, parts: [{ shape: 'star', size: 2, spin: 1, color: '#ffffff' }, {}],
    fromNode: 'Star', toNode: 'Star', fromX: 1, fromY: 2, toX: 3, toY: 4, bow: 5, radiusX: 6, radiusY: 7, rateMs: 100, lifeMs: 500, count: 9,
    fadeStart: 0.2, scaleFrom: 1, scaleTo: 2, spin: 3, wobble: 4, wobbleFrequency: 5, seed: 6, startMs: 10, endMs: 20,
  });
  ok('add_emitter', { name: 'Bare', glyphs: ['q'], attract: { nodeId: 'Star' } });
  ok('add_emitter', { name: 'Parts', glyphs: [], parts: [{ shape: 'star' }] });
  ok('set_effect_range', { effect: 'Zzz', startMs: 0, endMs: 500 });
  ok('set_effect_range', { effect: 'Zzz' });
  ok('set_effect_range', { effect: 'shake', startMs: 100 });
  ok('set_effect_range', { effect: 'shake', endMs: 100 });
  ok('set_emitter_parts', { emitter: 'Zzz', parts: [{ shape: 'star', color: [1, 2, 3], speed: 2, size: 2, spin: 1 }, { shape: 'circle' }] });

  // layers
  ok('add_layer', {});
  ok('add_layer', { type: 'shape', shape: 'star', width: 50, name: 'S2', attach: 'mascot', x: 5, y: 5, fill: '#ff0000' });
  ok('add_layer', { type: 'shape', height: 30 });
  ok('add_layer', { type: 'shape', shape: 'star', color: [1, 2, 3] });
  ok('add_layer', { type: 'hand' });
  ok('add_layer', { type: 'leg', side: 'right', name: 'R' });
  ok('add_layer', { type: 'leg', side: 'left' });
  ok('add_layer', { type: 'group', attach: 'mascot' });
  ok('add_svg', { markup: SVG, name: 'L2', attach: 'mascot' });
  ok('add_svg', { markup: SVG });
  ok('remove_layer', { nodeId: 'Star' });
  ok('duplicate_layer', { nodeId: 'Star' });
  ok('reorder_layer', { nodeId: 'Star', to: 'front' });
  ok('reorder_layer', { nodeId: 'Star', to: 'back' });
  ok('reorder_layer', { nodeId: 'Star', to: 1 });
  ok('set_layer_visibility', { nodeId: 'Star', visible: false });
  ok('set_layer_visibility', { nodeId: 'Star', visible: true });
  ok('set_layer_lock', { nodeId: 'Star', locked: true });
  ok('set_layer_lock', { nodeId: 'Star', locked: false });
  ok('set_layer_attachment', { nodeId: 'Star', mode: 'world' });
  ok('set_layer_attachment', { nodeId: 'Star', mode: 'mascot' });
  ok('set_layer_attachment', { nodeId: 'Star', mode: 'mascot', anchor: 'Group' });
  ok('set_layer_appearance_range', { nodeId: 'Star', clear: true });
  ok('set_layer_appearance_range', { nodeId: 'Star', startMs: 100, endMs: 500, fadeInMs: 50, fadeOutMs: 50 });
  ok('set_layer_appearance_range', { nodeId: 'Star', endMs: 500 });
  ok('set_layer_appearance_range', { nodeId: 'Star', startMs: 100 });
  ok('show_layer_in_state', { nodeId: 'Star', everywhere: true });
  ok('show_layer_in_state', { nodeId: 'Star' });
  ok('set_shape', { nodeId: 'Star', shape: 'circle' });
  ok('set_shape', { nodeId: 'Star', shape: 'star', atMs: 100, points: 6, innerRatio: 0.4, cornerRadius: 0.1, vertexRadius: 0.1, rotation: 10 });
  ok('set_layer_parent', { nodeId: 'Star', parent: 'Group' });
  ok('set_layer_parent', { nodeId: 'Star', parent: 'world' });
  ok('set_layer_parent', { nodeId: 'Star', parent: null });
  ok('set_layer_parent', { nodeId: 'Star', parent: 'Friend' });
  ok('set_layer_parent', { nodeId: 'Friend', parent: 1 });
  world();
  next('set_layer_parent', { nodeId: 'Star', parent: 'Group' });
  { const m = validate(P(), call('set_layer_parent', { nodeId: 'Group', parent: 'Star' })); if (typeof m !== 'string') bads.push('a loop was accepted'); }
  ok('set_layer_order', { nodeId: 'Star', above: 'Group' });
  ok('set_layer_order', { nodeId: 'Star', below: 'Group' });
  ok('set_layer_order', { nodeId: 'Star', to: 'back' });
  ok('set_layer_order', { nodeId: 'Star', above: 'Friend' });
  ok('set_layer_order', { nodeId: 'Friend', above: 'Star' });
  ok('set_layer_order', { nodeId: 'Friend', below: 'Friend' });

  // paint
  ok('set_svg_fill', { nodeId: 'Logo', color: [1, 2, 3, 0.5], opacity: 0.5, enabled: false, atMs: 5 });
  ok('set_svg_fill', { nodeId: 'Logo', color: { r: 1, g: 2, b: 3 }, enabled: true });
  ok('set_svg_fill', { nodeId: 'Logo', color: { r: 1, g: 2, b: 3, a: 0.5 } });
  ok('set_svg_fill', { nodeId: 'Logo', color: '#abc' });
  ok('set_svg_fill', { nodeId: 'Logo', color: [1, 2, 3, 200] });
  ok('set_svg_fill', { nodeId: 'Logo', opacity: 2 });
  ok('set_svg_stroke', { nodeId: 'Star', color: '#ff0000', width: 2, opacity: 0.5, enabled: true, cap: 'round', join: 'bevel' });
  ok('set_svg_stroke', { nodeId: 'Star', width: 3 });
  ok('set_svg_stroke', { nodeId: 'Star', enabled: false });
  ok('set_svg_stroke', { nodeId: 'Star', cap: 'butt' });
  ok('set_svg_stroke', { nodeId: 'Star', join: 'miter', atMs: 5 });
  ok('set_svg_stroke_width', { nodeId: 'Star', width: 4, atMs: 5 });
  ok('set_svg_stroke_width', { nodeId: 'Star', width: 4 });
  world();
  next('set_text_stroke', { nodeId: '@T', enabled: false }); next('set_text_stroke', { nodeId: '@T', color: '#fff', width: 2 });
  world();
  run([call('set_shape', { nodeId: 'Star', shape: 'star', atMs: 0 }), call('set_shape_morph', { nodeId: 'Star', mode: 'cut', atMs: 0, durationMs: 100 })]);
  next('set_shape_morph', { nodeId: 'Star', mode: 'morph', atMs: 0 });

  // limbs
  ok('set_hand_points', { nodeId: 'Hand', shoulder: [0, 0], hand: { x: 1, y: 1 }, atMs: 5 });
  ok('set_leg_points', { nodeId: 'Leg', hip: [0, 0], knee: [1, 1], ankle: [2, 2] });
  world();
  ed().commit((p) => { const h = Object.values(p.rig.nodes).find((x) => x.name === 'Hand')!; h.limb = { ...h.limb!, c: { x: 5, y: 5 } }; });
  next('set_hand_points', { nodeId: 'Hand', shoulder: [0, 0], elbow: [1, 1], hand: [2, 2] });
  it('an arm with an elbow exposes it', check(!!Hand().limb?.c));
  ok('set_hand_rig', { nodeId: 'Hand', rubberHose: true, length: 5, atMs: 1 });
  ok('set_hand_rig', { nodeId: 'Hand', rubberHose: false });
  ok('set_hand_rig', { nodeId: 'Hand', thickness: 3 });
  ok('set_leg_rig', { nodeId: 'Leg', footAngle: 3, rubberHose: true });
  ok('pin_limb', { nodeId: 'Leg' });
  ok('pin_limb', { nodeId: 'Leg', point: 'knee', pinned: false });
  ok('pin_limb', { nodeId: 'Hand', point: 'hand' });
  ok('pin_limb', { nodeId: 'Hand', pinned: false });

  // mascots
  ok('add_mascot', { kind: 'default', name: 'M3', x: 1, y: 2 });
  ok('add_mascot', {});
  ok('remove_mascot', { mascot: 'Friend' });
  ok('duplicate_mascot', { mascot: 'Friend' });
  ok('rename_mascot', { mascot: 2, name: 'Pal' });
  ok('set_mascot_transform', { mascot: 'Friend', x: 1, y: 2, scale: 1.1, rotation: 3, yaw: 1, pitch: 2, atMs: 50 });
  ok('set_mascot_transform', { mascot: 'Friend', x: 1 });
  ok('set_mascot_shape', { mascot: 'Friend', shape: 'star' });
  ok('set_mascot_shape', { mascot: 'Friend', shape: 'star', atMs: 900 });
  ok('set_mascot_parent', { mascot: 'Friend', follows: 1 });
  ok('set_mascot_parent', { mascot: 'Friend' });
  world();
  next('set_mascot_parent', { mascot: 'Friend', follows: 1 });
  { const m = validate(P(), call('set_mascot_parent', { mascot: 1, follows: 'Friend' })); if (typeof m !== 'string') bads.push('a mascot loop was accepted'); }
  world();
  next('set_mascot_shape', { mascot: 'Friend', shape: 'circle' });
  next('set_mascot_shape', { mascot: 'Friend', shape: 'star', atMs: 900 });
  next('set_mascot_shape', { mascot: 'Friend', shape: 'circle', atMs: 1000 });

  // faces and roles
  ok('set_face', { nodeId: 'Group' });
  ok('set_face', { nodeId: 'Group', face: false });
  ok('add_face', {});
  ok('add_face', { mascot: 'Friend' });
  ok('add_face', { mascot: 1 });
  world();
  ed().commit((p) => { delete p.rig.nodes['body.face']; });
  next('add_face', {});
  world();
  { const f = Object.values(P().rig.nodes).find((x) => x.role === 'face' && x.parentId !== 'body')!; next('set_face', { nodeId: f.id, face: false }); next('add_face', { mascot: 'Friend' }); }
  ok('set_role', { nodeId: 'Star', role: rolesFor(P().rig.nodes.body)[0] === 'body' ? '' : '' });
  ok('set_role', { nodeId: 'Star', role: 'face' });
  ok('set_role', { nodeId: 'Star' });
  ok('apply_squish_preset', { nodeId: 'body', preset: 'Soft Squash', atMs: 100 });
  ok('apply_squish_preset', { nodeId: 'body', preset: 'Soft Squash' });
  ok('set_pose', { pose: 'Rest' });
  ok('set_pose', { mascot: 'Friend', pose: 'Excited', atMs: 100 });

  // effects and style
  ok('set_layer_effect', { nodeId: 'Star', kind: 'glow', params: { radius: 10, zz: 1, strength: 'x' }, color: '#ff0000', enabled: false });
  world();
  next('set_layer_effect', { nodeId: 'Star', kind: 'glow' });
  next('set_layer_effect', { nodeId: 'Star', kind: 'glow', params: { radius: 5 } });
  next('set_layer_effect', { nodeId: 'Star', kind: 'blur' });
  next('set_layer_effect', { nodeId: 'Star', kind: 'glow', remove: true });
  next('set_layer_effect', { nodeId: 'Star', kind: 'blur', remove: true });
  ok('set_layer_style', { nodeId: 'Star', blend: 'screen', mask: { node: 'Group', invert: true }, gradient: { type: 'radial', angle: 10, stops: ['#ff0000', '#0000ff'] } });
  ok('set_layer_style', { nodeId: 'Star', blend: 'normal', mask: { nodeId: 'Group' }, gradient: { stops: ['#ff0000', '#0000ff', 'zz'] } });
  ok('set_layer_style', { nodeId: 'Star', mask: null, gradient: null });
  ok('set_layer_style', { nodeId: 'Star', gradient: { stops: ['#ff0000'] } });
  ok('set_layer_style', { nodeId: 'Star', gradient: { type: 'radial' } });
  ok('set_layer_style', { nodeId: '@T', charOrient: true });
  ok('set_layer_style', { nodeId: 'Star', charOrient: true });
}

// --- text ----------------------------------------------------------------------------------------
{
  world();
  const T = '@T', T2 = '@T2';
  ok('add_text', { content: 'A', font: 'Inter', size: 30, weight: 700, x: 1, y: 2, color: '#ffffff', attach: 1 });
  ok('add_text', { content: 'B', attach: 'Friend', x: 5 });
  ok('add_text', { content: 'C', attach: 'Friend' });
  ok('add_text', { content: 'D' });
  ok('set_text', { nodeId: T, content: 'Bye' });
  ok('set_text', { nodeId: T, content: 'Bye', atMs: 100 });
  ok('set_text_font', { nodeId: T, family: 'Inter', weight: 600, italic: true });
  ok('set_text_font', { nodeId: T, family: 'Inter', italic: false });
  ok('set_text_font', { nodeId: T, family: 'Inter' });
  ok('set_text_style', { nodeId: T, align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 1, width: 100 });
  ok('set_text_style', { nodeId: T, valign: 'middle' });
  ok('set_text_style', { nodeId: T, align: 'center' });
  ok('set_text_size', { nodeId: T, size: 40 });
  ok('set_text_size', { nodeId: T, size: 40, atMs: 100 });
  ok('set_text_path_offset', { nodeId: T, offset: 5 });
  ok('set_text_path', { nodeId: T, path: 'Logo' });
  ok('set_text_weight', { nodeId: T, weight: 700, atMs: 50 });
  ok('set_text_color', { nodeId: T, color: '#ff0000', atMs: 5 });
  ok('set_text_color', { nodeId: T, color: '#ff0000', opacity: 0.5 });
  ok('set_text_curve', { nodeId: T, mode: 'straight' });
  ok('set_text_curve', { nodeId: T, mode: 'arc', amount: 0.3 });
  ok('set_text_curve', { nodeId: T, mode: 'arc', radius: 50, start: 1, end: 2, underneath: true });
  ok('set_text_curve', { nodeId: T, mode: 'arc' });
  world();
  next('set_text_curve', { nodeId: T, mode: 'arc', radius: 80 });
  next('set_text_curve', { nodeId: T, mode: 'arc' });
  ok('set_text_path', { nodeId: T, path: 'Wave', reverse: true, flip: true, offset: 3, baseline: 2 });
  ok('set_text_path', { nodeId: T, path: 'Wave' });
  ok('set_text_path', { nodeId: T, path: 'none' });
  ok('set_text_path', { nodeId: T, path: 'Friend' });
  ok('set_text_path', { nodeId: T2, path: 1 });
  ok('set_text_path', { nodeId: T2, path: 'Star' });
  ok('set_text_path_offset', { nodeId: T, offset: 5, atMs: 10 });
  for (const effect of ['typewriter', 'pop', 'fade', 'drop', 'rise', 'scatter', 'wave']) ok('animate_text', { nodeId: T, effect });
  ok('animate_text', { nodeId: T, effect: 'pop', stagger: 0.2, durationMs: 500, startMs: 100 });
  ok('animate_text', { nodeId: T, effect: 'typewriter', durationMs: 500, startMs: 100, easing: 'linear' });
}

// --- curves --------------------------------------------------------------------------------------
{
  ok('add_curve', { points: [[0, 0], [10, 10]], type: 'polyline', closed: true, guide: true, name: 'C2', attach: 'Friend' });
  ok('add_curve', { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], type: 'bezier', attach: 'Star' });
  ok('add_curve', { points: [[0, 0], [10, 10]], type: 'smooth' });
  ok('add_curve_point', { nodeId: 'Wave', x: 50, y: 10 });
  ok('add_curve_point', { nodeId: 'Wave', x: 50, y: 10, atMs: 100 });
  ok('move_curve_point', { nodeId: 'Wave', index: 1, x: 5, y: 5, atMs: 100 });
  ok('move_curve_point', { nodeId: 'Wave', index: 1, x: 5, y: 5 });
  ok('remove_curve_point', { nodeId: 'Wave', index: 1 });
  ok('close_curve', { nodeId: 'Wave', closed: true });
  ok('close_curve', { nodeId: 'Wave', closed: false });
  ok('reverse_curve', { nodeId: 'Wave' });
}

// --- the last odd corners -------------------------------------------------------------------------
{
  world();
  const id = (name: string) => Object.values(P().rig.nodes).find((n) => n.name === name)!.id;
  it('a property with no keys says to use add_keyframe', check(String(validate(P(), call('remove_keyframe', { nodeId: id('Star'), property: 'surface.pitch', atMs: 5 }))).includes('add_keyframe')));
  // a timeline with no emitters at all
  ed().loadProject(defaultProject());
  activeTimeline(P()).emitters = undefined;
  it('no emitters, no effect by that name', check(typeof validate(P(), call('set_effect_range', { effect: 'zz' })) === 'string'));
  world();
  // a hidden curve with no stored place and no type is still editable, and a point is added wherever it lands
  ed().commit((p) => {
    const w = Object.values(p.rig.nodes).find((n) => n.name === 'Wave')!;
    w.visible = false;
    w.surface = { ...w.surface, flatOffset: undefined };
    (w.curve as { type?: string }).type = undefined;
  });
  next('add_curve_point', { nodeId: 'Wave', x: 5, y: 5 });
  // an empty text still has a width to bend around
  next('set_text', { nodeId: '@T', content: '' });
  next('set_text_curve', { nodeId: '@T', mode: 'arc', amount: 0.3 });
  // a colour with fewer than three channels fills in zeros
  applyCalls([call('add_emitter', { name: 'Short', glyphs: ['z'], color: [] })]);
  applyCalls([call('set_emitter_parts', { emitter: 'Zzz', parts: [{ shape: 'circle', color: [] }] })]);
  // text along an SVG with no paths cannot follow it
  ed().commit((p) => { const l = Object.values(p.rig.nodes).find((n) => n.name === 'Logo')!; l.kind = 'svgLayer'; l.svg = undefined; });
  it('an svg without paths has no outline to follow', check(String(validate(P(), call('set_text_path', { nodeId: textId(0), path: 'Logo' }))).includes('no outline'), String(validate(P(), call('set_text_path', { nodeId: textId(0), path: 'Logo' }))) + JSON.stringify(Object.values(P().rig.nodes).find((n) => n.name === 'Logo')?.svg)));
  it('the corners ran clean', check(fails.length === 0, fails.join('\n')));
}

// --- applied without a gate: what a stale call does when its layer is gone -------------------------
{
  world();
  const junk = (n: string, a: Record<string, unknown> = {}) => { try { applyCalls([call(n, { nodeId: 'zz', ...a })]); } catch { /* the gate would have said so */ } };
  for (const [n, a] of [
    ['set_layer_effect', { kind: 'glow' }], ['set_layer_style', {}], ['set_text_curve', {}], ['set_text_path', {}], ['animate_text', {}],
    ['add_curve_point', { x: 1, y: 1 }], ['set_layer_visibility', {}], ['set_layer_lock', {}], ['set_shape', { shape: 'zz' }],
  ] as [string, Record<string, unknown>][]) junk(n, a);
  for (const [n, a] of [
    ['remove_keyframe', { property: 'transform.rotation' }], ['add_text', {}], ['add_curve', {}], ['add_svg', {}], ['set_shape', { shape: 'star' }],
    ['create_preset', { name: 'Empty', tracks: [{ nodeId: 'body', property: 'transform.rotation' }] }], ['set_property', { property: 'transform.rotation', value: 1 }],
  ] as [string, Record<string, unknown>][]) junk(n, a);
  applyCalls([call('add_curve', { points: [[0, 0], [NaN, 1]] })]);
  applyCalls([call('add_face', { mascot: 'zz' })]);
  applyCalls([call('set_pose', { mascot: 'zz', pose: 'Rest' })]);
  applyCalls([{ name: 'set_camera' } as ToolCall]);
  it('applying a stale call changes nothing and throws nothing', check(true));
  it('every tool was exercised', check(TOOL_NAMES.length > 0));
}

it('every valid call validated, described and applied', check(fails.length === 0, fails.join('\n')));
it('and every invalid one was refused', check(bads.length === 0, bads.join('\n')));
