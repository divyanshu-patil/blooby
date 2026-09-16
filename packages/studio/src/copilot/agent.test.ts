import { it, vi } from 'vitest';
import { check } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { valueAt } from '../core/scene';
import { activeTimeline } from '../core/types';
import { DEFAULT_CLOUD_MODEL, type CopilotSettings } from './pool';

// the model, scripted: each call to chatJson returns the next reply
const script: string[] = [];
const sent: number[] = [];
vi.mock('./client', () => ({
  chatJson: async (_s: unknown, messages: { content: string }[]) => {
    sent.push(messages.length);
    const content = script.shift() ?? JSON.stringify({ plan: '', status: 'Nothing left', calls: [{ name: 'finish', args: { summary: 'ok' } }], done: true });
    return { content, usage: { input: 1000, output: 200 } };
  },
}));

const { runAgent, runAgentTool, searchPresets, allPresets, editorFunctions, presetData } = await import('./agent');

const settings: CopilotSettings = { endpoint: 'cloud', customUrl: '', model: DEFAULT_CLOUD_MODEL, keys: [] };
const step = (status: string, calls: { name: string; args: Record<string, unknown> }[], done = false) =>
  JSON.stringify({ plan: 'private', status, calls, done });
const ed = () => useEditor.getState();

// --- discovery: the editor's real functions ---------------------------------------------
{
  ed().loadProject(defaultProject());
  const fns = editorFunctions().map((f) => f.name);
  it('find_functions reads the store\'s own actions', check(['setValue', 'addKeyframeNow', 'setFaceRole', 'pinLimb', 'applySquishPreset', 'setPlayhead', 'select'].every((n) => fns.includes(n)), fns.join()));
  it('only ones that really exist on the store', check(fns.every((n) => typeof (ed() as unknown as Record<string, unknown>)[n] === 'function')));
  const found = String(await runAgentTool({ name: 'find_functions', args: { query: 'squish' } }));
  it('and the edit tools, filtered by a word', check(found.includes('apply_squish_preset') && found.includes('applySquishPreset'), found.slice(0, 300)));
  const refused = await runAgentTool({ name: 'call_editor', args: { action: 'resetProject' } }) as { error?: string };
  it('call_editor refuses what would throw the document away', check(!!refused.error));
  await runAgentTool({ name: 'call_editor', args: { action: 'setPlayhead', args: [1234] } });
  it('call_editor runs a real editor action', check(ed().playhead === 1234));
}

// --- presets as data ------------------------------------------------------------------
{
  ed().loadProject(defaultProject());
  const names = (q: string) => searchPresets(allPresets(), q, 20).map((x) => x.name);
  it('"squash" finds presets that squash', check(names('squash').length >= 3, names('squash').join()));
  it('"hand" finds the waving preset by its arm track', check(names('hand animation').includes('Hii!'), names('hand animation').join()));
  it('"multiple mascots" finds Two Friends by its layers', check(names('multiple mascots').includes('Two Friends'), names('multiple mascots').join()));
  it('"curved text" finds an arc text preset', check(names('curved text').some((n) => /arc|curved|ring/i.test(n)), names('curved text').join()));
  const hii = presetData(allPresets().find((p) => p.name === 'Hii!')!);
  it('get_preset returns real keyframes [ms, value, easing]', check(hii.tracks.some((t) => t.prop === 'limb.length' && t.keys.length > 2 && typeof t.keys[1][1] === 'number' && typeof t.keys[1][2] === 'string')));
  it('and its layers', check(hii.layers.some((l) => l.kind === 'limb')));
}

// --- the loop: inspect → act → observe → adjust → finish -------------------------------
{
  ed().loadProject(defaultProject());
  const before = ed().project;
  script.push(
    step('Inspecting the project and squash presets', [
      { name: 'inspect_project', args: {} },
      { name: 'search_presets', args: { query: 'squash bounce' } },
    ]),
    step('Adding a squash at 1.2s', [
      { name: 'set_playhead', args: { atMs: 1200 } },
      { name: 'select_layers', args: { nodeIds: ['body'] } },
      { name: 'apply_squish_preset', args: { nodeId: 'body', preset: 'Landing Squash' } },
      { name: 'add_keyframe', args: { nodeId: 'face', property: 'transform.rotation', atMs: 1500, value: 6 } },
      { name: 'add_keyframe', args: { nodeId: 'nope', property: 'transform.rotation', atMs: 1500, value: 6 } },
    ]),
    step('Previewing', [{ name: 'preview', args: { times: [1200, 1300], nodeIds: ['body'] } }, { name: 'get_values', args: { nodeId: 'body', properties: ['squish.x'], atMs: 1300 } }]),
    step('Done', [{ name: 'finish', args: { summary: 'Added a landing squash and a face tilt.' } }], true),
  );
  const events: { kind: string; text: string }[] = [];
  let lastUsage = { input: 0, output: 0 }, lastSteps = 0;
  const r = await runAgent({
    settings, request: 'add a squash', history: [], made: [], signal: new AbortController().signal, markKey: () => {},
    onEvent: (e) => events.push(e), onUsage: (u, s) => { lastUsage = u; lastSteps = s; },
  });
  const after = ed().project;
  it('the run finishes with the model\'s summary', check(r.ended === 'done' && r.reply.startsWith('Added'), JSON.stringify(r)));
  it('it took four steps', check(r.steps === 4 && lastSteps === 4));
  it('tokens are counted across every step', check(lastUsage.input === 4000 && lastUsage.output === 800));
  it('statuses are reported live', check(events.filter((e) => e.kind === 'status').map((e) => e.text).join('|').startsWith('Inspecting')));
  it('reads and UI moves are reported as actions', check(events.some((e) => e.kind === 'read' && e.text.startsWith('Searching presets')) && events.some((e) => e.kind === 'ui' && e.text.startsWith('Moving playhead'))));
  it('edits land in the real editor', check(Math.abs((valueAt(after, 'body', 'squish.x', 1300) as number) - 1.18) < 1e-6));
  it('at the playhead the agent moved to', check(activeTimeline(after).tracks.some((t) => t.property === 'squish.x' && t.keyframes.some((k) => Math.abs(k.time - 1200) < 1))));
  it('the face is animated on its own', check(activeTimeline(after).tracks.some((t) => t.nodeId === 'face' && t.property === 'transform.rotation')));
  it('a bad call is reported back, not applied', check(events.some((e) => e.kind === 'error' && e.text.includes('add_keyframe')) && r.edits.length === 2));
  it('the selection moved as asked', check(ed().selection[0] === 'body'));
  it('each step sends more context than the last', check(sent.length >= 4 && sent[3] > sent[0]));

  // checkpoint: revert and reapply are the recorded documents
  ed().restoreProject(before, 'agent.revert');
  it('revert removes every change the run made', check(!activeTimeline(ed().project).tracks.some((t) => t.property === 'squish.x' || t.nodeId === 'face')));
  ed().restoreProject(after, 'agent.reapply');
  it('reapply restores exactly what it left', check(ed().project === after && Math.abs((valueAt(ed().project, 'body', 'squish.x', 1300) as number) - 1.18) < 1e-6));
  ed().undo();
  it('and each is one undo step', check(ed().project === before));
}

// --- limits and stopping ---------------------------------------------------------------
{
  ed().loadProject(defaultProject());
  script.length = 0;
  for (let i = 0; i < 10; i++) script.push(step('Looking', [{ name: 'get_editor_state', args: {} }]));
  let used = 0;
  const r = await runAgent({
    settings: { ...settings, maxSteps: 8 }, request: 'loop', history: [], made: [], signal: new AbortController().signal,
    markKey: () => {}, onEvent: () => {}, onUsage: (u) => { used = u.input + u.output; },
  });
  it('tokens are never a limit — a run far past any budget keeps going', check(r.steps === 8 && used === 8 * 1200, JSON.stringify(r)));

  script.length = 0;
  for (let i = 0; i < 10; i++) script.push(step('Looking', [{ name: 'get_editor_state', args: {} }]));
  const s = await runAgent({
    settings: { ...settings, maxSteps: 2 }, request: 'loop', history: [], made: [], signal: new AbortController().signal,
    markKey: () => {}, onEvent: () => {}, onUsage: () => {},
  });
  it('and at its step limit', check(s.ended === 'steps' && s.steps === 2));

  script.length = 0;
  const ac = new AbortController();
  ac.abort();
  const stopped = await runAgent({ settings, request: 'x', history: [], made: [], signal: ac.signal, markKey: () => {}, onEvent: () => {}, onUsage: () => {} })
    .then(() => 'ran', (e: Error) => e.name);
  it('Stop aborts the run', check(stopped === 'AbortError'));

  script.length = 0;
  script.push('not json at all', step('Done', [{ name: 'finish', args: { summary: 'fine' } }], true));
  const bad = await runAgent({ settings, request: 'x', history: [], made: [], signal: new AbortController().signal, markKey: () => {}, onEvent: () => {}, onUsage: () => {} });
  it('an unreadable reply is asked again, not fatal', check(bad.ended === 'done' && bad.reply === 'fine'));
}
