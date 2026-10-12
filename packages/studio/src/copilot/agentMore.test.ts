import { it, vi } from 'vitest';
import { check } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { activeTimeline, type Preset, type Project } from '../core/types';
import { sceneAt } from '../core/scene';
import { compOf } from '../core/comp';
import { DEFAULT_CLOUD_MODEL, type CopilotSettings } from './pool';

// the model, scripted — and it reports streamed tokens like the real client does
const script: string[] = [];
vi.mock('./client', () => ({
  chatJson: async (_s: unknown, _m: unknown, _schema: unknown, _mk: unknown, _sig: unknown, opts?: { onTokens?: (n: number) => void }) => {
    opts?.onTokens?.(5);
    return { content: script.shift() ?? '{"done":true,"calls":[{"name":"finish","args":{"summary":"ok"}}]}', usage: { input: 10, output: 5 } };
  },
}));

const { runAgent, runAgentTool, actionLabel, presetData, allPresets } = await import('./agent');

const settings: CopilotSettings = { endpoint: 'cloud', customUrl: '', model: DEFAULT_CLOUD_MODEL, keys: [] };
const ed = () => useEditor.getState();
const turn = (calls: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ calls, ...extra });
const run = (o: { request?: string; signal?: AbortSignal; maxSteps?: number; onEvent?: (e: { kind: string; text: string }) => void } = {}) => runAgent({
  settings: { ...settings, maxSteps: o.maxSteps }, request: o.request ?? 'x', history: [], made: [], signal: o.signal ?? new AbortController().signal,
  markKey: () => {}, onEvent: o.onEvent ?? (() => {}), onUsage: () => {},
});
const err = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.name);

// --- reads: the arms the scripted loop never reaches ------------------------------------------
{
  ed().loadProject(defaultProject());
  it('find_functions with no match says so', check(String(await runAgentTool({ name: 'find_functions', args: { query: 'zzqqxx' } })).includes('(none match)')));
  it('a call with no args at all is read as {}', check(typeof await runAgentTool({ name: 'find_functions' } as never) === 'string'));
  it('call_editor with no action is refused', check(!!((await runAgentTool({ name: 'call_editor', args: {} })) as { error?: string }).error));
  const copied = await runAgentTool({ name: 'call_editor', args: { action: 'copyLayers' } }) as { ok?: boolean; returned?: unknown };
  it('call_editor returns what the action returned', check(copied.ok === true && typeof copied.returned === 'string'));
  const known = allPresets()[0];
  it('get_preset finds a preset by name', check(((await runAgentTool({ name: 'get_preset', args: { preset: known.name } })) as { id?: string }).id === known.id));
  it('search_presets with no query or limit still answers', check(Array.isArray(await runAgentTool({ name: 'search_presets', args: {} }))));
  it('get_preset with nothing to look for is an error', check(!!((await runAgentTool({ name: 'get_preset', args: {} })) as { error?: string }).error));
  it('get_layer finds a layer by its name', check(!!((await runAgentTool({ name: 'get_layer', args: { nodeId: ed().project.rig.nodes.body.name } })) as { id?: string }).id));
  it('get_layer on nothing is an error', check(!!((await runAgentTool({ name: 'get_layer', args: { nodeId: 'zz' } })) as { error?: string }).error));
  const vals = await runAgentTool({ name: 'get_values', args: { nodeId: 'body', properties: 'not.a.prop' } }) as Record<string, unknown>;
  it('get_values takes one unknown property, at the playhead', check('not.a.prop' in vals));
  it('set_playhead without a time goes to 0', check(((await runAgentTool({ name: 'set_playhead', args: {} })) as { playheadMs: number }).playheadMs === 0));
  it('select_layers takes one id', check(((await runAgentTool({ name: 'select_layers', args: { nodeIds: 'body' } })) as { selected: string[] }).selected[0] === 'body'));
  it('open_tab rejects an unknown tab', check(!!((await runAgentTool({ name: 'open_tab', args: { tab: 'zz' } })) as { error?: string }).error));
  it('open_tab opens a known one', check(((await runAgentTool({ name: 'open_tab', args: { tab: 'fx' } })) as { tab: string }).tab === 'fx'));
  it('an unknown tool is an error', check(!!((await runAgentTool({ name: 'zz', args: {} })) as { error?: string }).error));

  // timed tools, on a fake clock
  vi.useFakeTimers();
  const advance = async <T,>(p: Promise<T>) => { await vi.advanceTimersByTimeAsync(10000); return p; };
  const frames = await advance(runAgentTool({ name: 'preview', args: {} })) as { frames: Record<string, unknown> };
  it('preview with no times looks at the playhead, whole scene', check(Object.keys(frames.frames).length === 1));
  const some = await advance(runAgentTool({ name: 'preview', args: { times: [0, 'x'], nodeIds: ['body'] } })) as { frames: Record<string, unknown> };
  it('preview keeps only finite times and asked-for layers', check(Object.keys(some.frames).length === 1));
  const dflt = await advance(runAgentTool({ name: 'play', args: {} })) as { played: number[] };
  it('play with no range plays the whole timeline', check(dflt.played[0] === 0 && dflt.played[1] > 0));
  const part = await advance(runAgentTool({ name: 'play', args: { fromMs: 100, toMs: 400 } })) as { played: number[] };
  it('play with a range plays that range', check(part.played.join() === '100,400'));
  vi.useRealTimers();
}

// --- labels ----------------------------------------------------------------------------------
{
  const p = ed().project;
  const L = (name: string, args?: Record<string, unknown>) => actionLabel(p, { name, args } as never);
  it('every tool has a label', check([
    L('find_functions'), L('find_functions', { query: 'q' }), L('call_editor', { action: 'a' }), L('search_presets', { query: 'q' }),
    L('get_preset', { preset: 'nope' }), L('get_preset', { preset: p.presets[0]?.name ?? 'x' }), L('inspect_project'),
    L('get_layer', { nodeId: 'body' }), L('get_layer', { nodeId: 'zz' }), L('get_values', { nodeId: 'zz' }), L('get_values', { nodeId: 'body', atMs: 5 }),
    L('preview', { times: [1000] }), L('preview'), L('play'), L('get_editor_state'), L('set_playhead', { atMs: 1000 }),
    L('select_layers', { nodeIds: ['body', 'zz'] }), L('select_layers', { nodeIds: 'body' }), L('open_tab', { tab: 'fx' }), L('finish'),
    actionLabel(p, { name: 'add_keyframe', args: { nodeId: 'body', property: 'transform.rotation', atMs: 0, value: 1 } }),
  ].every((s) => typeof s === 'string' && s.length > 0)));
  it('a call without args still labels', check(actionLabel(p, { name: 'play' } as never) === 'Playing it back'));
}

// --- presets as data, with every optional part -------------------------------------------------
{
  const full = {
    id: 'p', name: 'P', durationMs: 100,
    tracks: [{ nodeId: 'n', property: 'text.content', keyframes: [
      { time: 0, value: 'x'.repeat(40), easingOut: { type: 'linear' } }, { time: 1, value: 'short', easingOut: { type: 'linear' } }, { time: 2, value: true, easingOut: { type: 'linear' } }] }],
    modifiers: [{ kind: 'shake', nodeId: 'n' }],
    emitters: [{ name: 'Z', path: 'burst', from: 0, to: 1, startMs: 0, endMs: 1 }],
    appearances: [{ nodeId: 'n' }, { nodeId: 'm', startMs: 5, endMs: 6 }],
    layers: [{ id: 'n', name: 'N', kind: 'primitive', parentId: null, surface: {}, anchor: { x: 0, y: 0 }, squish: { x: 1, y: 1 }, trim: { start: 0, end: 1 }, ranged: true }],
  } as unknown as Preset;
  const d = presetData(full) as { tracks: { keys: unknown[][] }[]; appearances: unknown[][]; layers: Record<string, unknown>[] };
  it('long strings are cut, short ones and non-strings kept', check(String(d.tracks[0].keys[0][1]).endsWith('…') && d.tracks[0].keys[1][1] === 'short' && d.tracks[0].keys[2][1] === true));
  it('appearances default to the preset\'s own length', check(d.appearances[0][2] === 100 && d.appearances[1][1] === 5));
  it('layers carry anchor, squish, trim and ranged', check(['anchor', 'squish', 'trim', 'ranged'].every((k) => k in d.layers[0])));
  it('a preset with no layers is fine', check((presetData({ ...full, layers: undefined } as unknown as Preset) as { layers: unknown[] }).layers.length === 0));
}

// --- the loop's odd turns ----------------------------------------------------------------------
{
  ed().loadProject(defaultProject());
  const events: { kind: string; text: string }[] = [];
  const onEvent = (e: { kind: string; text: string }) => events.push(e);

  // cut off mid-reply: repaired; no status; a non-array `calls`; `done` with no calls at all
  script.push('{"calls":[{"name":"get_editor_state","args":{}}', turn('nope', { done: false }), '{"done":true}');
  const a = await run({ onEvent, maxSteps: 5 });
  it('a truncated reply still runs its calls, and done needs no calls', check(a.ended === 'done' && a.reply === 'Done.' && !events.some((e) => e.kind === 'status')));

  // null calls, non-object args, unknown tool, finish without a summary
  script.push(turn([null, { name: 'get_editor_state', args: 'x' }, { name: 'bogus', args: {} }, { name: 'finish' }]));
  const b = await run({ onEvent });
  it('bad calls are answered, finish with no summary says Done.', check(b.reply === 'Done.'));

  // tools that throw: an Error and a bare string
  const real = ed().setPlayhead;
  useEditor.setState({ setPlayhead: () => { throw new Error('boom'); } });
  script.push(turn([{ name: 'set_playhead', args: {} }]), turn([{ name: 'finish', args: { summary: 's' } }]));
  await run();
  useEditor.setState({ setPlayhead: () => { throw 'plain'; } }); // eslint-disable-line no-throw-literal
  script.push(turn([{ name: 'set_playhead', args: {} }]), turn([{ name: 'finish', args: { summary: 's' } }]));
  const c = await run();
  useEditor.setState({ setPlayhead: real });
  it('a throwing tool does not end the run', check(c.reply === 's'));

  // a stop pressed while a tool is waiting, and one pressed between calls
  const ac = new AbortController();
  script.push(turn([{ name: 'play', args: { fromMs: 0, toMs: 5000 } }]));
  const pending = err(run({ signal: ac.signal }));
  setTimeout(() => ac.abort(), 20);
  it('Stop during a tool aborts the run', check(await pending === 'AbortError'));
  const ac2 = new AbortController();
  script.push(turn([{ name: 'get_editor_state', args: {} }], { status: 'go' }));
  it('Stop between calls aborts the run', check(await err(run({ signal: ac2.signal, onEvent: () => ac2.abort() })) === 'AbortError'));

  // a weak first answer is sent back once before it is accepted
  ed().loadProject(defaultProject());
  const weak = { name: 'create_preset', args: { name: 'Tiny', durationMs: 1000, tracks: [{ nodeId: 'body', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 500, value: 1.02 }, { time: 1000, value: 1 }] }] } };
  const fin = { name: 'finish', args: { summary: 'done' } };
  script.push(turn([weak, fin], { done: true }), turn([fin], { done: true }));
  const sent: string[] = [];
  const d = await run({ request: 'make the mascot scale', onEvent: (e) => sent.push(e.text) });
  it('critique sends it back once, then lets it go', check(d.steps === 2 && sent.includes('Reviewing the motion before finishing')));

  // a long run: older exchanges are shortened
  ed().loadProject(defaultProject());
  for (let i = 0; i < 8; i++) script.push(turn([{ name: 'inspect_project', args: {} }]));
  const e = await run({ maxSteps: 8 });
  it('a run that never finishes ends on its step limit', check(e.ended === 'steps'));
}

// --- inspecting a project with every optional part ------------------------------------------------
{
  const p = defaultProject() as Project;
  activeTimeline(p).tracks.push({ id: 'empty', nodeId: 'body', property: 'transform.rotation', keyframes: [] } as never);
  p.stateMachine = undefined;
  ed().loadProject(p);
  it('no state machine, none listed', check((await runAgentTool({ name: 'inspect_project', args: {} }) as { machine?: unknown }).machine === undefined));
  p.stateMachine = { inputs: [], transitions: [{ from: 'a', to: 'b', conditions: [] }] } as never;
  ed().loadProject(p);
  const r = await runAgentTool({ name: 'inspect_project', args: {} }) as { tracks: { fromMs: number }[]; machine?: { rules: unknown[] } };
  it('an empty track reads as 0..0', check(r.tracks.some((t) => t.fromMs === 0)));
  it('the state machine is listed with its rules', check(r.machine?.rules.length === 1));

  const min = { id: 'm', name: 'M', durationMs: 10, tracks: [] } as unknown as Preset;
  const d = presetData(min) as Record<string, unknown>;
  it('a bare preset has no modifiers, emitters or appearances', check(!('modifiers' in d) && !('emitters' in d) && !('appearances' in d)));
  const rich = presetData({ ...min, layers: [
    { id: 't', name: 'T', kind: 'text', parentId: null, surface: { mapped: true, yaw: 1, pitch: 2 }, text: { content: 'hi', path: { mode: 'arc' } } },
    { id: 'l', name: 'L', kind: 'limb', parentId: null, surface: {}, limb: { type: 'arm', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 }, pin: { x: 3, y: 3 } } },
    { id: 'c', name: 'C', kind: 'primitive', parentId: null, surface: {}, curve: { type: 'bezier' } },
  ] } as unknown as Preset) as { layers: Record<string, unknown>[] };
  it('text, limbs and curves are described', check('text' in rich.layers[0] && 'pinned' in rich.layers[1] && 'curve' in rich.layers[2]));

  // a particle has no layer alpha: preview falls back to its colour
  const q = defaultProject();
  ed().loadProject(q);
  ed().addEmitter({
    name: 'zzz', glyphs: ['z'], color: { r: 90, g: 90, b: 110, a: 1 }, size: 26, path: 'arc', from: { nodeId: 'eyeR', x: 14, y: -18 }, to: { x: 90, y: -120 }, bow: 18,
    rateMs: 420, lifeMs: 1800, count: 4, fadeStart: 0.45, scaleFrom: 0.6, scaleTo: 1.25, spin: 10, wobble: 4, wobbleFrequency: 1.4, seed: 3,
  });
  const pid = sceneAt(ed().project, 900, compOf(ed().project)).find((i) => i.alpha === undefined)?.id ?? '';
  vi.useFakeTimers();
  const pv = runAgentTool({ name: 'preview', args: { times: [900], nodeIds: [pid] } });
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();
  it('preview reports a particle too', check(pid !== '' && Object.keys(((await pv) as { frames: Record<string, Record<string, unknown>> }).frames['900ms']).length === 1));
}
