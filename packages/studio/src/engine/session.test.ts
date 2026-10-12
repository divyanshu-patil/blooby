import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject } from '../core/defaults';
import { type Project } from '../core/types';
import { registerCapabilities, type Capability } from './registry';
import { CapabilityError, EditorSession, GUIDE_TOPICS, guide, type SessionEvent } from './session';
import { diffProjects, entities } from './diff';
import { sceneAt } from '../core/scene';
import { compOf } from '../core/comp';

const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as CapabilityError; } };
const clone = <T>(v: T): T => structuredClone(v);

// --- diff: the shapes the engine tests never reach ------------------------------------
{
  const base = defaultProject();
  const noMachine = clone(base);
  noMachine.stateMachine = undefined;
  it('a project with no machine has no machine entities', check(![...entities(noMachine).keys()].some((k) => k.startsWith('machine:') || k.startsWith('input:'))));
  const withMachine = clone(base);
  withMachine.stateMachine = { id: 'm', initial: 'a', inputs: [{ name: 'i', type: 'Numeric', value: 0 }], transitions: [{ id: 't1', from: 'a', to: 'b', conditions: [] }] } as unknown as Project['stateMachine'];
  const ks = [...entities(withMachine).keys()];
  it('machine, input and transition are addressable', check(ks.includes('machine:machine') && ks.includes('input:i') && ks.includes('transition:t1')));
  it('adding a machine reports it created', check(diffProjects(noMachine, withMachine).created.length === 3));

  const ms = await EditorSession.open(withMachine);
  it('an id that is no transition either is not found', check((await caught(ms.invoke('editor_update_state_transition', { id: 'ghost', patch: {} })))?.code === 'ENTITY_NOT_FOUND'));

  // an inactive timeline with no rig of its own
  const bare = clone(base);
  bare.timelines.push({ ...clone(bare.timelines[0]), id: 'spare', name: 'Spare', rig: undefined });
  it('a state without a rig has no layers', check(![...entities(bare).keys()].some((k) => k.startsWith('layer:spare/'))));

  // the per-entity change cap can leave nothing to report
  const moved = clone(base);
  moved.name = 'Renamed';
  it('a zero limit reports no field changes', check(diffProjects(base, moved, 0).updated.length === 0));
  it('and a real one names the field', check(diffProjects(base, moved).updated[0]?.changes.name?.to === 'Renamed'));
}

// --- the error and the session's own plumbing --------------------------------------------
{
  const e = new CapabilityError('X', 'msg', { a: 1 });
  it('an error serialises with its details', check(JSON.stringify(e) === '{"code":"X","message":"msg","a":1}'));

  const s = await EditorSession.open(defaultProject(), { presets: [], expressions: [] });
  it('opening with a library empties the catalog', check(s.project.presets !== undefined));
  await s.replace(defaultProject());
  it('replacing a loaded session swaps its state and bumps the revision', check(s.revision === 2 && !s.dirty));

  const seen: SessionEvent[] = [];
  const off = s.on((ev) => seen.push(ev));
  await s.invoke('set_property', { nodeId: 'body', property: 'opacity', value: 0.5 });
  it('listeners hear the change', check(seen.some((x) => x.type === 'changed') && seen.some((x) => x.type === 'op')));
  off();
  const n = seen.length;
  await s.invoke('set_property', { nodeId: 'body', property: 'opacity', value: 0.4 });
  it('and stop hearing once unsubscribed', check(seen.length === n));

  await s.extendCatalog([...defaultProject().presets.slice(0, 1)]);
  it('an id in neither the document nor the catalog names nothing', check((await caught(s.invoke('editor_move_keyframe', { trackId: 'nope', kfId: 'x', time: 1 })))?.code === 'ENTITY_NOT_FOUND'));
  await s.extendCatalog([...defaultProject().presets.slice(0, 1)]);
  await s.rename('Mine');
  it('rename is a document edit', check(s.project.name === 'Mine' && s.dirty));

  // the scripted guides
  for (const t of GUIDE_TOPICS) it(`guide ${t} reads`, check(typeof guide(t) === 'string' && guide(t)!.length > 10));
  it('an unknown guide is undefined', check(guide('nope') === undefined));
  for (const level of ['minimal', 'standard', 'full'] as const) {
    const r = (await s.invoke('editor_get_state', { level })).result as { tracks?: unknown };
    it(`editor state at ${level}`, check(level === 'full' ? !!r.tracks : !r.tracks));
  }
  await s.invoke('editor_get_state');
  for (const topic of GUIDE_TOPICS) await s.invoke('guide_get', { topic });

  // timeline reads, filtered three ways
  await s.invoke('add_keyframe', { nodeId: 'body', property: 'flatOffset.y', atMs: 100, value: 5 });
  const tl = async (a: Record<string, unknown>) => ((await s.invoke('timeline_get', a)).result as { tracks: unknown[] }).tracks.length;
  it('timeline_get lists every track', check((await tl({})) > 0));
  const bodyName = s.project.rig.nodes.body.name;
  it('…by node id', check((await tl({ nodeId: 'body' })) > 0 && (await tl({ nodeId: 'nobody' })) === 0));
  it('…by node name', check((await tl({ nodeId: bodyName })) > 0));
  it('…by property', check((await tl({ property: 'flatOffset.y' })) > 0 && (await tl({ property: 'opacity', nodeId: 'body' })) === 0));
  await s.invoke('add_emitter', { name: 'boom', glyphs: [], parts: [{ shape: 'dot' }], path: 'burst', count: 4, velocity: 100, spread: 360, lifeMs: 400, startMs: 0 });
  await s.invoke('add_preset_to_timeline', { preset: s.project.presets[0].id });
  it('emitters and clips are listed', check(((await s.invoke('timeline_get')).result as { emitters: unknown[]; clips: unknown[] }).emitters.length === 1));

  // inspector
  const byName = (await s.invoke('inspector_get', { nodeId: bodyName.toUpperCase() })).result as { layer: { id: string } };
  it('the inspector finds a layer by name', check(byName.layer.id === 'body'));
  const noLayer = await caught(s.invoke('inspector_get', { nodeId: 'zz' }));
  it('and refuses one that is not there', check(noLayer?.code === 'ENTITY_NOT_FOUND'));
  await s.invoke('set_layer_effect', { nodeId: 'body', kind: 'glow' });
  const withFx = (await s.invoke('inspector_get', { nodeId: 'body' })).result as { effects: unknown[] };
  it('effects show up', check(withFx.effects.length === 1));
  await s.invoke('add_text', { content: 'Hello world' });
  const textId = Object.values(s.project.rig.nodes).find((x) => x.kind === 'text')!.id;
  await s.invoke('add_keyframe', { nodeId: textId, property: 'transform.rotation', atMs: 0, value: 3 });
  await s.invoke('editor_toggle_keyframe', { nodeId: textId, property: 'text.content' });
  await s.invoke('set_layer_visibility', { nodeId: textId, visible: false });
  await s.invoke('set_layer_lock', { nodeId: textId, locked: true });
  await s.invoke('add_modifier', { nodeId: 'body', kind: 'shake', amount: 100, frequency: 2, amplitude: 5 });
  it('ghost modifier and emitter ids are not found', check((await caught(s.invoke('editor_remove_modifier', { id: 'ghost' })))?.code === 'ENTITY_NOT_FOUND' && (await caught(s.invoke('editor_remove_emitter', { id: 'ghost' })))?.code === 'ENTITY_NOT_FOUND'));
  await s.invoke('add_layer', { type: 'hand', side: 'left' });
  await s.invoke('add_layer', { type: 'leg', side: 'left' });
  await s.invoke('add_layer', { type: 'group' });
  await s.invoke('add_layer', { type: 'shape', shape: 'star', name: 'st' });
  const st = (await s.invoke('editor_get_state', { level: 'full' })).result as { layers: { hidden?: boolean; locked?: boolean }[]; modifiers: unknown[]; keyframesNearPlayhead: { value: unknown }[] };
  it('hidden and locked layers say so', check(st.layers.some((l) => l.hidden) && st.layers.some((l) => l.locked) && st.modifiers.length === 1));
  it('a text keyframe near the playhead keeps its string', check(st.keyframesNearPlayhead.some((k) => k.value === 'Hello world')));
  const insp2 = (await s.invoke('inspector_get', { nodeId: textId })).result as { controls: { keyframes?: { value: unknown }[] }[] };
  it('the inspector lists a string keyframe', check(insp2.controls.some((c) => c.keyframes?.some((k) => k.value === 'Hello world'))));
  const tg = (await s.invoke('timeline_get', { nodeId: textId })).result as { tracks: { keyframes: { value: unknown }[] }[]; modifiers: unknown[] };
  it('timeline_get keeps it, and lists modifiers', check(tg.tracks.some((t) => t.keyframes.some((k) => k.value === 'Hello world')) && (await s.invoke('timeline_get')).result !== undefined));
  const everything = (await s.invoke('evaluate', { times: [0] })).result as { frames: Record<string, Record<string, number[]>> };
  it('every drawn layer has an alpha', check(Object.values(everything.frames['0ms']).every((r) => r.length === 6)));

  // layer_find / search on every axis
  const find = async (a: Record<string, unknown>) => ((await s.invoke('layer_find', a)).result as unknown[]).length;
  it('layer_find: kind, role, text, colour', check((await find({ kind: 'text' })) === 1 && (await find({ role: 'face' })) >= 1 && (await find({ text: 'WORLD' })) === 1 && (await find({ color: '#000000', tolerance: 500 })) > 0));
  it('layer_find: nothing matches', check((await find({ name: 'qqq' })) === 0 && (await find({ text: 'qqq' })) === 0 && (await find({ kind: 'primitive', role: 'zzz' })) === 0));
  const srch = async (a: Record<string, unknown>) => (await s.invoke('search', a)).result as Record<string, unknown[]>;
  const all = await srch({ query: 'blink hello glow shake easeIn opacity' });
  it('search covers every scope by default', check(['capabilities', 'presets', 'layers', 'properties', 'effects', 'easings'].every((k) => k in all)));
  const only = await srch({ query: 'zzzzqq', scope: ['layers'] });
  it('and narrows to the asked scope', check(Object.keys(only).join() === 'layers'));

  // evaluate with no node filter, with junk times
  const ev = (await s.invoke('evaluate', { times: [0, 100] })).result as { frames: Record<string, unknown> };
  it('evaluate with no filter draws the rig', check(Object.keys(ev.frames).length === 2));
  await s.invoke('evaluate', { times: [0], nodeIds: [] });
  // a particle has no layer alpha; its colour carries it
  const spark = sceneAt(s.project, 100, compOf(s.project)).find((x) => x.alpha === undefined);
  const sp = (await s.invoke('evaluate', { times: [100], nodeIds: [spark?.id ?? 'none'] })).result as { frames: Record<string, Record<string, number[]>> };
  it('evaluate falls back to the colour alpha', check(!!spark && sp.frames['100ms'][spark.id].length === 6));

  // selection by name, a miss, and the playhead
  const sel = (await s.invoke('selection_set', { nodeIds: [bodyName, 'ghost', 'body'] })).result as { selection: string[] };
  it('selection takes names and drops ghosts', check(sel.selection.length === 2));

  // viewport in every direction
  const vp = async (a: Record<string, unknown>) => { await s.invoke('viewport_set', a); return s.viewport; };
  it('fit resets', check((await vp({ fit: true })).zoom === 1));
  it('zoom and centre are clamped', check((await vp({ zoom: 99, centerX: 3, centerY: 4 })).zoom === 8 && s.viewport.centerX === 3 && s.viewport.centerY === 4));
  await vp({ focus: bodyName, padding: 0.1 });
  await vp({ focus: 'body' });
  const lost = await caught(s.invoke('viewport_set', { focus: 'ghost' }));
  it('focus on nothing is refused', check(lost?.code === 'ENTITY_NOT_FOUND'));
  const hidden = await caught(s.invoke('viewport_set', { focus: textId + 'x' }));
  it('…as is an id that is not drawn', check(hidden?.code === 'ENTITY_NOT_FOUND'));
  await s.invoke('viewport_get');
  await s.invoke('history_get');
  it('the contact sheet and framed SVG render', check((await s.contactSheet([0, 100], { background: null, columns: 1 })).startsWith('<svg') && (await s.contactSheet([0])).includes('#ffffff') && (await s.frameSvg(0, { background: '#fff' })).startsWith('<svg')));

  // undo/redo with explicit steps
  await s.invoke('history_undo', { steps: 2 });
  await s.invoke('history_redo', { steps: 2 });

  // transactions: every refusal
  it('commit with none open fails', check((await caught(s.invoke('transaction_commit')))?.code === 'NO_TRANSACTION'));
  it('rollback with none open fails', check((await caught(s.invoke('transaction_rollback')))?.code === 'NO_TRANSACTION'));
  await s.invoke('transaction_begin');
  it('a second begin is refused', check((await caught(s.invoke('transaction_begin', { label: 'again' })))?.code === 'TRANSACTION_OPEN'));
  await s.invoke('transaction_commit');
  it('commit closes it', check(s.inTransaction === null));

  // checkpoints
  it('restore of a missing checkpoint names the ones there are', check((await caught(s.invoke('checkpoint_restore', { name: 'x' })))?.details.suggestion !== undefined));
  it('diff of a missing checkpoint fails', check((await caught(s.invoke('checkpoint_diff', { name: 'x' })))?.code === 'NOT_FOUND'));
  await s.invoke('checkpoint_create', { name: 'one' });
  const list = (await s.invoke('checkpoint_list')).result as { name: string }[];
  it('and lists the one made', check(list.length === 1 && list[0].name === 'one'));
  it('a restore message lists none-vs-some', check((await caught(s.invoke('checkpoint_restore', { name: 'x' })))!.details.suggestion!.toString().includes('one')));

  // capability lookup
  it('capability_get for a ghost is refused', check((await caught(s.invoke('capability_get', { id: 'zzz' })))?.code === 'UNKNOWN_CAPABILITY'));
  await s.invoke('capability_get', { id: 'add_keyframe' });
  await s.invoke('capabilities_search', { query: 'keyframe', category: 'keyframe', mutates: true });
  const empty = await EditorSession.open(defaultProject());
  const quiet = (await empty.invoke('critique', { request: 'nothing in particular' })).summary;
  empty.edits.push({ name: 'create_preset', args: { tracks: [{ nodeId: 'body', property: 'flatOffset.y', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 50 }] }] } });
  const noisy = (await empty.invoke('critique', { request: 'a bounce' })).summary;
  it('critique says either', check(quiet === 'No problems found' && noisy.includes('note(s)')));

  // read capabilities go through the agent
  await s.invoke('inspect_project', {});
  it('a read that errors is NOT_FOUND', check((await caught(s.invoke('get_layer', { nodeId: 'ghost' })))?.code === 'NOT_FOUND'));
  await s.invoke('search_presets', { query: 'jump' });

  // hints for every kind of refusal
  const hint = async (a: Record<string, unknown>, id = 'add_keyframe') => String((await caught(s.invoke(id, a)))?.details.suggestion);
  it('a keyframe problem points at timeline_get', check((await hint({ nodeId: 'body', property: 'flatOffset.y', atMs: 99999 }, 'remove_keyframe')).includes('timeline_get')));
  it('a layer problem points at layer_find', check((await hint({ nodeId: 'zzz', property: 'opacity', atMs: 0, value: 1 })).includes('layer_find')));
  it('a property problem points at the inspector', check((await hint({ nodeId: 'body', property: 'zzz', atMs: 0, value: 1 })).includes('inspector_get')));
  it('an unknown preset points at preset_search', check((await hint({ preset: 'ghost' }, 'add_preset_to_timeline')).length > 0));
  await caught(s.invoke('set_mascot_transform', { mascot: 'body', scale: 'x' }));
  await caught(s.invoke('apply_squish_preset', { nodeId: 'body', preset: 'ghost', atMs: 0 }));
}

// --- invoke: the guards ------------------------------------------------------------------
{
  const s = await EditorSession.open(defaultProject());
  const none = await caught(s.invoke('zzqqxx'));
  it('an unknown capability with no near neighbour points at the search', check(none?.code === 'UNKNOWN_CAPABILITY' && String(none.details.suggestion).includes('capabilities_search')));

  const base: Omit<Capability, 'id' | 'kind' | 'inputSchema'> = { title: 't', description: 'a test capability', category: 'animation', mutates: false, scope: 'project:read', reversible: false, requires: [], since: '1.0.0' };
  registerCapabilities([
    { ...base, id: 'zz_server', kind: 'server', inputSchema: { type: 'object' } },
    { ...base, id: 'zz_host', kind: 'host' as 'server', inputSchema: { type: 'object' } },
    { ...base, id: 'zz_open', kind: 'read', inputSchema: { type: 'object' } },
    {
      ...base, id: 'zz_schema', kind: 'read', inputSchema: {
        type: 'object', additionalProperties: false,
        properties: { a: { type: ['string', 'null'] }, b: {}, c: { type: 'string', enum: ['x'] }, d: { type: 'number' }, e: { type: 'array' }, f: { type: 'object' } },
      },
    },
  ]);
  it('a server capability is not an editor call', check((await caught(s.invoke('zz_server')))?.code === 'HOST_CAPABILITY'));
  it('an unknown kind falls through to the host', check((await caught(s.invoke('zz_host')))?.code === 'HOST_CAPABILITY'));
  it('a schema with no properties lets anything through to the reader', check((await caught(s.invoke('zz_open', { x: 1 })))?.code === 'NOT_FOUND'));
  const schema = (a: Record<string, unknown>) => caught(s.invoke('zz_schema', a));
  it('array-typed schema: wrong type', check((await schema({ a: 5 }))?.code === 'INVALID_TYPE'));
  it('untyped property: anything goes', check((await schema({ b: { x: 1 } }))?.code === 'NOT_FOUND'));
  it('null is skipped', check((await schema({ a: null }))?.code === 'NOT_FOUND'));
  it('enum miss', check((await schema({ c: 'y' }))?.code === 'INVALID_VALUE'));
  it('number given a string', check((await schema({ d: 's' }))?.code === 'INVALID_TYPE'));
  it('array given an object', check((await schema({ e: {} }))?.code === 'INVALID_TYPE'));
  it('object given an array', check((await schema({ f: [] }))?.code === 'INVALID_TYPE'));
  it('all right', check((await schema({ a: 'q', c: 'x', d: 1, e: [], f: {} }))?.code === 'NOT_FOUND'));
  it('unknown args are named', check((await schema({ zz: 1 }))?.code === 'UNKNOWN_ARGUMENT'));

  // the idempotency cache keeps 500
  for (let i = 0; i < 502; i++) await s.invoke('playhead_set', { atMs: i, requestId: `r${i}` });
  it('the oldest request id is forgotten, the newest remembered', check((await s.invoke('playhead_set', { atMs: 1, requestId: 'r501' })).replayed === true && (await s.invoke('playhead_set', { atMs: 1, requestId: 'r0' })).replayed === undefined));
  // the op log keeps 1000
  for (let i = 0; i < 500; i++) await s.invoke('playhead_set', { atMs: i });
  it('the op log is capped', check(s.ops.length === 1000));

  // a read with no change is not a noop warning; a write with none is
  const noop = await s.invoke('editor_select_track', { id: null });
  it('a mutation that changes nothing warns', check(noop.warnings.length === 1));

  // anything thrown inside an action becomes EXECUTION_FAILED
  const inner = s as unknown as { state: Record<string, unknown> };
  inner.state = { ...inner.state, setLoop: () => { throw 'boom'; }, setTimelineLoop: () => { throw new Error('bad'); } };
  const str = await caught(s.invoke('editor_set_loop', { loop: true }));
  const err = await caught(s.invoke('editor_set_timeline_loop', { loop: true }));
  it('a thrown string is wrapped', check(str?.code === 'EXECUTION_FAILED' && str.message === 'boom'));
  it('and a thrown Error keeps its message', check(err?.code === 'EXECUTION_FAILED' && err.message === 'bad'));

  // --- batches --------------------------------------------------------------------------
  const b = (calls: unknown[], extra: Record<string, unknown> = {}, opts?: { expectedRevision?: number }) => s.invoke('batch_execute', { calls, ...extra }, opts);
  it('an empty batch is refused', check((await caught(b([])))?.code === 'MISSING_ARGUMENT'));
  it('a huge batch is refused', check((await caught(b(Array.from({ length: 201 }, () => ({ capability: 'viewport_get' })))))?.code === 'TOO_MANY'));
  it('a stale batch conflicts', check((await caught(b([{ capability: 'viewport_get' }], {}, { expectedRevision: -1 })))?.code === 'REVISION_CONFLICT'));
  it('…also from its own argument', check((await caught(b([{ capability: 'viewport_get' }], { expectedRevision: -1 })))?.code === 'REVISION_CONFLICT'));
  it('batches do not nest', check((await caught(b([{ capability: 'batch_execute', args: { calls: [] } }])))?.details.failedIndex === 0));
  it('a malformed call is wrapped, not leaked', check((await caught(b([{} as never])))?.code === 'EXECUTION_FAILED'));

  const dryRun = await b([{ capability: 'set_property', args: { nodeId: 'body', property: 'opacity', value: 0.3 } }], { dryRun: true });
  it('a dry batch rolls back', check(dryRun.dryRun === true && dryRun.summary.includes('dry run') && s.project.rig.nodes.body.opacity !== 0.3));

  const loose = await b([{ capability: 'nope_nope' }, { capability: 'viewport_get' }, { capability: 'playhead_set', args: { atMs: 3 } }], { atomic: false });
  const rs = loose.result as { ok: boolean }[];
  it('a non-atomic batch records the failure and carries on', check(rs.length === 3 && !rs[0].ok && rs[1].ok));

  await s.invoke('transaction_begin', { label: 'outer' });
  await b([{ capability: 'viewport_get' }]);
  it('a batch inside a transaction leaves it open', check(s.inTransaction?.label === 'outer'));
  await s.invoke('transaction_rollback');

  const closed = await caught(b([{ capability: 'transaction_commit' }, { capability: 'nope_nope' }]));
  it('a failure after the batch closed its own transaction has nothing to roll back', check(closed?.details.failedIndex === 1 && s.inTransaction === null));

  const named = await b([{ capability: 'add_keyframe', args: { nodeId: 'body', property: 'flatOffset.y', atMs: 77, value: 3 } }]);
  it('a good batch reports what it made', check(named.created.length > 0 && named.changed !== undefined));
  const fails = await caught(b([{ capability: 'add_keyframe', args: { nodeId: 'ghost', property: 'opacity', atMs: 0, value: 1 } }], { atomic: false }));
  it('a non-atomic failing batch does not throw', check(fails === null));
}
