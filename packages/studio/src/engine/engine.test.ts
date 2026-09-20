import { it } from 'vitest';
import storeSource from '../core/store.ts?raw';
import { check } from '../core/testkit';
import { defaultProject } from '../core/defaults';
import { TOOL_NAMES } from '../copilot/tools';
import { editorFunctions } from '../copilot/agent';
import { activeTimeline } from '../core/types';
import { valueAt } from '../core/scene';

const at = (prop: string, t = 0, sess: EditorSession = s) => valueAt(sess.project, 'body', prop, t);
import { capabilities, capability, docBlocks, excludedActions, findCapabilities } from './registry';
import { CapabilityError, EditorSession } from './session';
import { diffProjects } from './diff';
import { TOOL_DOCS } from '../copilot/tools';

const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as CapabilityError; } };

// --- the registry is derived, and complete -------------------------------------------
{
  const ids = new Set(capabilities().map((c) => c.id));
  const missing = TOOL_NAMES.filter((n) => !ids.has(n));
  it('every copilot edit tool is a capability', check(missing.length === 0, missing.join(', ')));
  const actions = editorFunctions().map((f) => f.name);
  const exposed = actions.filter((a) => ids.has(`editor_${a.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`));
  it('most store actions are capabilities too (the rest take callbacks or move browser UI)', check(exposed.length > 80, `${exposed.length} of ${actions.length}`));
  const excluded = new Set(excludedActions().map((e) => e.action));
  const silent = actions.filter((a) => !exposed.includes(a) && !excluded.has(a));
  it('every store action is a capability or excluded with a reason — none silently missing', check(silent.length === 0, silent.join(', ')));
  it('the store source the registry reads is the real one', check(storeSource.includes('export interface Editor {')));
  it('ids are valid MCP tool names', check(capabilities().every((c) => /^[a-z0-9_]{1,64}$/.test(c.id)), capabilities().filter((c) => !/^[a-z0-9_]{1,64}$/.test(c.id)).map((c) => c.id).join()));
  it('ids are unique', check(ids.size === capabilities().length));
  it('every capability has a description and an object schema', check(capabilities().every((c) => c.description.length > 10 && (c.inputSchema as { type: string }).type === 'object')));

  const kf = capability('add_keyframe')!.inputSchema as { properties: Record<string, { type?: string; enum?: string[] }>; required: string[] };
  it('schemas come from the tool docs: add_keyframe requires its four', check(['nodeId', 'property', 'atMs', 'value'].every((k) => kf.required.includes(k)) && !kf.required.includes('easing')));
  it('…types atMs as a number and easing as the real easing names', check(kf.properties.atMs.type === 'number' && !!kf.properties.easing.enum?.includes('easeInOut')));
  const addLayer = capability('add_layer')!.inputSchema as { properties: Record<string, { enum?: string[] }> };
  it('quoted alternatives become an enum', check(addLayer.properties.type.enum?.join() === 'shape,hand,leg,group'));
  const placed = capability('add_preset_to_timeline')!.inputSchema as { properties: Record<string, unknown> };
  it('prose "also takes { mascot }" adds the argument', check('mascot' in placed.properties));
  const blocks = docBlocks(TOOL_DOCS).map((b) => b.name);
  it('a section header ends the block above it', check(!docBlocks(TOOL_DOCS).find((b) => b.name === 'set_transition')!.text.includes('LAYERS')));
  it('doc blocks cover every tool', check(TOOL_NAMES.every((n) => blocks.includes(n))));
  it('descriptions carry the usage notes', check(capability('add_emitter')!.description.includes('burst')));
  it('discovery filters by words', check(findCapabilities({ query: 'keyframe' }).some((c) => c.id === 'add_keyframe')));
  it('and by category', check(findCapabilities({ category: 'text' }).every((c) => c.category === 'text') && findCapabilities({ category: 'text' }).length > 5));
}

// --- a session edits through the editor's own code -----------------------------------
const s = await EditorSession.open(defaultProject());
const r0 = s.revision;
const added = await s.invoke('add_keyframe', { nodeId: 'body', property: 'flatOffset.y', atMs: 400, value: -80, easing: 'easeOut' });
it('an edit reports what it created and bumps the revision', check(added.created.some((c) => c.type === 'keyframe') && added.revision === r0 + 1, JSON.stringify(added)));
it('…and the keyframe is really there', check(activeTimeline(s.project).tracks.some((t) => t.nodeId === 'body' && t.property === 'flatOffset.y' && t.keyframes.some((k) => k.time === 400 && k.value === -80))));

const again = await s.invoke('add_keyframe', { nodeId: 'body', property: 'flatOffset.y', atMs: 800, value: 0, requestId: 'r1' });
const replay = await s.invoke('add_keyframe', { nodeId: 'body', property: 'flatOffset.y', atMs: 800, value: 0, requestId: 'r1' });
it('a retried requestId replays the first result instead of running twice', check(replay.replayed === true && replay.revision === again.revision));

const bad = await caught(s.invoke('add_keyframe', { nodeId: 'body', property: 'wobbliness', atMs: 0, value: 1 }));
it('an invalid call is refused with a code and a suggestion', check(bad?.code === 'INVALID_ARGUMENT' && typeof bad.details.suggestion === 'string', bad?.message));
const missing = await caught(s.invoke('add_keyframe', { nodeId: 'body' }));
it('a missing argument names the field', check(missing?.code === 'MISSING_ARGUMENT' && missing.details.field === 'property'));
const unknown = await caught(s.invoke('add_keyfram', {}));
it('an unknown capability suggests the near ones', check(unknown?.code === 'UNKNOWN_CAPABILITY' && String(unknown.details.suggestion).includes('add_keyframe')));
const extra = await caught(s.invoke('add_keyframe', { nodeId: 'body', property: 'opacity', atMs: 0, value: 1, speed: 2 }));
it('an argument the capability does not take is refused', check(extra?.code === 'UNKNOWN_ARGUMENT'));

const stale = await caught(s.invoke('add_keyframe', { nodeId: 'body', property: 'opacity', atMs: 0, value: 1 }, { expectedRevision: 1 }));
it('a write against an old revision is a REVISION_CONFLICT, not a silent overwrite', check(stale?.code === 'REVISION_CONFLICT'));

const layers = Object.keys(s.project.rig.nodes).length;
const dry = await s.invoke('add_layer', { type: 'shape', shape: 'star', name: 'dry', dryRun: true });
it('a dry run reports the change…', check(dry.dryRun === true && dry.created.some((c) => c.type === 'layer')));
it('…and changes nothing', check(Object.keys(s.project.rig.nodes).length === layers && dry.revision === again.revision));
const refused = await caught(s.invoke('remove_layer', { nodeId: 'body', dryRun: true }));
it('a dry run still validates', check(refused?.code === 'INVALID_ARGUMENT'));

// transactions
const before = s.project;
await s.invoke('transaction_begin', { label: 'hat' });
await s.invoke('add_layer', { type: 'shape', shape: 'star', name: 'hat' });
await s.invoke('add_keyframe', { nodeId: 'hat', property: 'transform.rotation', atMs: 300, value: 20 });
const mid = Object.values(s.project.rig.nodes).some((n) => n.name === 'hat');
await s.invoke('transaction_rollback', {});
it('a transaction applies as it goes', check(mid));
it('and rolling it back restores the exact document', check(s.project === before));

// checkpoints and diffs
await s.invoke('checkpoint_create', { name: 'before' });
await s.invoke('set_property', { nodeId: 'body', property: 'transform.scale.x', value: 1.3 });
const d = await s.invoke('checkpoint_diff', { name: 'before' });
const dr = d.result as ReturnType<typeof diffProjects>;
const key = [...dr.created, ...dr.updated].find((u) => u.type === 'keyframe' || u.type === 'track');
it('a checkpoint diff names what changed', check(!!key && (dr.created.length > 0 || dr.updated.length > 0), JSON.stringify(dr).slice(0, 300)));
const kfEdit = await s.invoke('add_keyframe', { nodeId: 'body', property: 'flatOffset.y', atMs: 800, value: -12 });
it('an in-place keyframe edit reports the field from → to', check(kfEdit.changed.some((c) => c.includes('value')), kfEdit.changed.join()));
await s.invoke('checkpoint_restore', { name: 'before' });
it('restoring a checkpoint puts the value back', check(at('transform.scale.x') !== 1.3));
await s.invoke('history_undo', {});
it('and the restore is itself undoable', check(at('transform.scale.x') === 1.3));

// batches
const batch = await caught(s.invoke('batch_execute', { calls: [
  { capability: 'set_property', args: { nodeId: 'body', property: 'transform.rotation', value: 12 } },
  { capability: 'add_keyframe', args: { nodeId: 'nope', property: 'opacity', atMs: 0, value: 1 } },
] }));
it('an atomic batch that fails names the failing call…', check(batch?.details.failedIndex === 1 && batch.details.rolledBack === true));
it('…and rolls back the calls before it', check(at('transform.rotation') !== 12));
const ok = await s.invoke('batch_execute', { calls: [
  { capability: 'set_property', args: { nodeId: 'body', property: 'transform.rotation', value: 12 } },
  { capability: 'playhead_set', args: { atMs: 500 } },
] });
it('a good batch applies every call', check(ok.ok && at('transform.rotation') === 12));

// store actions, by name, with checked ids
const tr = activeTimeline(s.project).tracks.find((t) => t.property === 'flatOffset.y')!;
const moved = await s.invoke('editor_move_keyframe', { trackId: tr.id, kfId: tr.keyframes[0].id, time: 450 });
it('store actions are capabilities with named arguments', check(moved.ok && activeTimeline(s.project).tracks.find((t) => t.id === tr.id)!.keyframes.some((k) => k.time === 450)));
const ghost = await caught(s.invoke('editor_move_keyframe', { trackId: 'nope', kfId: 'x', time: 1 }));
it('an id that does not exist is ENTITY_NOT_FOUND, not a silent no-op', check(ghost?.code === 'ENTITY_NOT_FOUND'));

// reading
const state = (await s.invoke('editor_get_state', { level: 'standard' })).result as { layers: { id: string }[]; playheadMs: number; dirty: boolean };
it('editor state lists the layers and the playhead', check(state.layers.some((l) => l.id === 'body') && state.playheadMs === 500 && state.dirty));
const insp = (await s.invoke('inspector_get', { nodeId: 'body', atMs: 400 })).result as { controls: { property: string; animated: boolean; keyframable: boolean }[] };
it('the inspector exposes semantic controls, marked animated', check(insp.controls.some((c) => c.property === 'flatOffset.y' && c.animated && c.keyframable)));
const ev = (await s.invoke('evaluate', { times: [0, 450], nodeIds: ['body'] })).result as { frames: Record<string, Record<string, number[]>> };
it('evaluate returns where the body is drawn', check(Array.isArray(ev.frames['450ms'].body) && ev.frames['450ms'].body.length === 6));
const found = (await s.invoke('search', { query: 'squish', scope: ['capabilities', 'presets'] })).result as { capabilities: unknown[]; presets: unknown[] };
it('search reaches capabilities and presets', check(found.capabilities.length > 0 && found.presets.length > 0));
const guide = (await s.invoke('guide_get', { topic: 'craft' })).result as string;
it('the craft guide is the copilot\'s own', check(guide.includes('SHAPE OF A CLIP')));
await s.invoke('viewport_set', { focus: 'body' });
it('focusing a layer zooms in on it', check(s.viewport.zoom > 1));
const svg = await s.frameSvg(450, { viewport: true });
it('a frame renders to SVG through the viewport', check(svg.startsWith('<svg') && svg.includes('viewBox') && svg.length > 500));

// two sessions never see each other's documents
const other = await EditorSession.open(defaultProject());
await other.invoke('set_property', { nodeId: 'body', property: 'transform.rotation', value: -30 });
it('sessions are isolated', check(at('transform.rotation') === 12 && at('transform.rotation', 0, other) === -30));

// --- every capability runs, not just the ones above: one scripted pass through a session ----
{
  const t = await EditorSession.open(defaultProject());
  const ran: [string, true | string][] = [];
  const go = async (id: string, args: Record<string, unknown> = {}) => {
    try { await t.invoke(id, args); ran.push([id, true]); } catch (e) { ran.push([id, `${(e as CapabilityError).code}: ${(e as Error).message}`]); }
  };
  const node = (name: string) => Object.values(t.project.rig.nodes).find((n) => n.name === name)!.id;
  const tl = () => activeTimeline(t.project);

  await go('capabilities_search', { query: 'text' });
  await go('capability_get', { id: 'add_keyframe' });
  await go('checkpoint_list');
  await go('history_get');
  await go('viewport_get');
  await go('layer_find', { name: 'body' });
  await go('selection_set', { nodeIds: ['body'] });
  await go('set_property', { nodeId: 'body', property: 'opacity', value: 0.9 });
  await go('history_undo');
  await go('history_redo');
  await go('set_layer_effect', { nodeId: 'body', kind: 'glow' });
  await go('set_layer_style', { nodeId: 'body', blend: 'screen' });

  await go('add_text', { content: 'HI' });
  const text = Object.values(t.project.rig.nodes).find((n) => n.kind === 'text')!.id;
  await go('set_text_color', { nodeId: text, color: '#ff0000' });
  await go('set_text_font', { nodeId: text, family: 'Inter' });
  await go('set_text_size', { nodeId: text, size: 40 });
  await go('set_text_style', { nodeId: text, align: 'left' });
  await go('set_text_weight', { nodeId: text, weight: 700 });

  await go('add_layer', { type: 'shape', shape: 'star', name: 'a' });
  await go('add_layer', { type: 'shape', shape: 'heart', name: 'b' });
  await go('editor_group_layers', { ids: [node('a'), node('b')] });
  const group = Object.values(t.project.rig.nodes).find((n) => n.kind === 'group' && n.role !== 'face');
  if (group) await go('editor_ungroup_layer', { id: group.id });
  await go('editor_reorder_layer', { id: node('a'), to: 'front' });
  await go('editor_set_attachment', { id: node('a'), mode: 'mascot' });
  await go('editor_move_into', { nodeId: node('b'), parentId: null });
  await go('editor_set_appearance', { nodeId: node('b'), range: { startMs: 0, endMs: 500 } });
  await go('set_role', { nodeId: node('a'), role: '' });
  await go('editor_delete_node', { id: node('b') });
  await go('editor_add_svg_asset', { name: 'dot', markup: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', viewBox: '0 0 10 10' });
  const asset = t.project.svgAssets?.[0];
  if (asset) await go('editor_remove_svg_asset', { id: asset.id });
  await go('editor_tween_property', { nodeId: 'body', property: 'opacity', target: 0.5, durationMs: 300, easing: { type: 'preset', name: 'easeOut' } });

  await go('add_layer', { type: 'hand', side: 'left' });
  await go('set_pose', { pose: 'Wave' });
  const limb = Object.values(t.project.rig.nodes).find((n) => n.kind === 'limb')!.id;
  await go('pin_limb', { nodeId: limb, pinned: true });
  await go('editor_pin_limb_point', { nodeId: limb, key: 'a', on: true });
  const eye = Object.values(t.project.rig.nodes).find((n) => n.eye)!.id;
  await go('editor_apply_eye_action', { eyeIds: [eye], actionId: 'blink' });
  await go('editor_apply_squish_to', { nodeIds: ['body'], presetId: 'soft' });
  await go('editor_apply_scale_as_base', { mascotId: 'body' });
  await go('editor_save_mascot_template', { bodyId: 'body' });

  await go('create_expression', { name: 'calm', snapshot: { 'body.transform.scale.x': 1 } });
  await go('create_expression', { name: 'big', snapshot: { 'body.transform.scale.x': 1.2 } });
  await go('morph_between', { from: 'calm', to: 'big', atMs: 0, durationMs: 400 });
  const ex = t.project.expressions.find((e) => e.name === 'big')!.id;
  await go('editor_apply_expression', { expressionId: ex, atMs: 600 });
  await go('editor_rename_expression', { id: ex, name: 'bigger' });

  await go('add_modifier', { nodeId: 'body', kind: 'shake', amount: 100, frequency: 2, amplitude: 5 });
  await go('editor_remove_modifier', { id: tl().modifiers.at(-1)!.id });
  await go('editor_add_block', { presetId: t.project.presets[0].id });
  const block = tl().blocks.at(-1)!.id;
  await go('editor_rename_block', { id: block, name: 'Hello' });
  await go('editor_set_block_speed', { id: block, speed: 2 });
  await go('editor_set_block_loop', { id: block, loop: true });
  await go('editor_set_block_color', { id: block, color: '#ffcc00' });
  await go('editor_adopt_keys_into_block', { blockId: block });
  await go('editor_set_preset_color', { id: t.project.presets[0].id, color: '#ffcc00' });
  await go('editor_select_track', { id: null });
  await go('editor_select_emitter', { id: null });
  await go('editor_set_active_lane', { lane: '' });
  await go('editor_set_duration_mode', { mode: 'even' });
  await go('editor_set_loop', { loop: true });
  await go('editor_set_timeline_loop', { loop: true });
  await go('editor_set_composition', { patch: { width: 800 } });

  await go('add_input', { name: 'mood', type: 'Numeric' });
  await go('add_input', { name: 'tap', type: 'Event' });
  await go('add_timeline', { name: 'Dance' });
  await go('add_rule', { input: 'mood', value: 2, state: 'Dance' });
  const dance = t.project.timelines.find((x) => x.name === 'Dance')!.id;
  await go('editor_duplicate_timeline', { id: dance });
  await go('editor_set_initial_state', { timelineId: dance });
  await go('editor_enable_state', { nameOrId: 'Dance' });
  await go('editor_fire_input', { name: 'tap' });
  await go('editor_set_machine_id', { id: 'blooby-mascot' });
  await go('editor_set_state_node_position', { id: dance, at: { x: 10, y: 20 } });
  await go('add_transition', { from: t.project.timelines[0].name, to: 'Dance', conditions: [{ input: 'tap', operator: 'fired' }] });
  const edge = t.project.stateMachine?.transitions.at(-1);
  if (edge) await go('editor_update_state_transition', { id: edge.id, patch: { durationMs: 400 } });

  // last: removing the face takes the eyes with it
  await go('remove_layer', { nodeId: 'face' });
  await go('add_face', { mascot: 'body' });
  await go('set_face', { nodeId: node('a'), face: true });

  for (const [id, r] of ran) it(`capability ${id} runs through a session`, check(r === true, String(r)));
}

// --- docs/mcp/examples.md: the documented calls run as written ------------------------------
{
  const d = await EditorSession.open(defaultProject());
  const ran: [string, true | string][] = [];
  const go = async (id: string, args: Record<string, unknown> = {}) => {
    try { await d.invoke(id, args); ran.push([id, true]); } catch (e) { ran.push([id, `${(e as CapabilityError).code}: ${(e as Error).message}`]); }
  };
  await go('batch_execute', { calls: [
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 0, value: 260 } },
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 450, value: -40, easing: 'easeOut' } },
    { capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 700, value: 0, easing: 'easeIn' } },
    { capability: 'apply_squish_preset', args: { nodeId: 'body', preset: 'Landing Squash', atMs: 700 } },
  ] });
  await go('critique', { request: 'a bouncing entrance' });
  await go('add_layer', { type: 'hand' });
  await go('set_pose', { pose: 'Wave', atMs: 400 });
  await go('layer_find', { color: '#ff0000', tolerance: 80 });
  await go('set_mascot_transform', { mascot: 'body', scale: 0.8 });
  await go('apply_squish_preset', { nodeId: 'body', preset: 'Bounce Squash', atMs: 0 });
  await go('editor_tween_property', { nodeId: 'body', property: 'squish.y', target: 1, durationMs: 2000, easing: { type: 'preset', name: 'easeInOut' } });
  await go('add_emitter', { name: 'boom', glyphs: [], parts: [{ shape: 'dot' }, { shape: 'star', color: [255, 200, 0] }], path: 'burst', count: 400, velocity: 900, spread: 360, drag: 1.5, gravity: 600, lifeMs: 1400, startMs: 800 });
  await go('set_svg_fill', { nodeId: 'body', color: '#1b1f3a' });
  await go('checkpoint_create', { name: 'before redesign' });
  await go('checkpoint_diff', { name: 'before redesign' });
  await go('checkpoint_restore', { name: 'before redesign' });
  await go('add_layer', { type: 'shape', shape: 'star', dryRun: true });
  for (const [id, r] of ran) it(`documented example ${id} runs`, check(r === true, String(r)));
}
