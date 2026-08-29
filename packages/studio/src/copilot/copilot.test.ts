import { it } from 'vitest';
import { check } from '../core/testkit';
import { buildScene, emitterItems, evaluateRig, valueAt } from '../core/scene';
import { defaultProject, makeTimeline } from '../core/defaults';
import { SHAPE_LIBRARY } from '../core/emitters';
import { blocksEnd, blockStarts } from '../core/timeline';
import { useEditor } from '../core/store';
import { MODIFIER_KINDS } from '../core/types';
import { applyCalls, describe, normaliseCall, RESPONSE_SCHEMA, TOOL_DOCS, validate, validateBatch, type ToolCall } from './tools';
import { parseTurn } from './parse';
import { suggestedStart, systemPrompt } from './prompt';
import { critique } from './critique';
import { baseUrl, CLOUD_CATALOGUE, LOCAL_URL, needsKey, resolveModel, usesBackend } from './pool';
import { listModels } from './client';
import { activeTimeline } from '../core/types';

// --- copilot: parsing what models actually send back ---------------------------
{
  // verbatim replies from gpt-oss:120b via Ollama Cloud, where `format` is not enforced
  const cloudA = '```json\n[\n  { "add_preset_to_timeline": { "preset": "Blink", "index": 0 } },\n  { "add_preset_to_timeline": { "preset": "Blink", "index": 1 } },\n  { "apply_expression": { "expression": "Surprised", "atMs": 2500 } }\n]\n```';
  const cloudB = '```json\n{\n  "calls": [\n    { "add_preset_to_timeline": { "preset": "Thinking", "index": 0 } },\n    { "add_modifier": { "nodeId": "Body", "kind": "float", "amount": 10, "frequency": 0.2, "amplitude": 5 } }\n  ]\n}\n```';

  const a = parseTurn(cloudA);
  it('fenced bare array parses', check(a.calls.length === 3, JSON.stringify(a.calls)));
  it('{tool: args} becomes {name, args}', check(a.calls[0].name === 'add_preset_to_timeline' && a.calls[0].args.preset === 'Blink'));
  it('blink twice then surprised', check(a.calls.filter((c) => c.args.preset === 'Blink').length === 2
      && a.calls[2].name === 'apply_expression' && a.calls[2].args.expression === 'Surprised'));

  const b = parseTurn(cloudB);
  it('fenced {calls:[...]} parses', check(b.calls.length === 2));
  it('missing reply is tolerated', check(b.reply === ''));

  // the strict shape must still work
  const strict = parseTurn('{"reply":"done","calls":[{"name":"add_modifier","args":{"nodeId":"body","kind":"shake","amount":50,"frequency":8,"amplitude":4}}]}');
  it('documented shape parses', check(strict.reply === 'done' && strict.calls[0].name === 'add_modifier'));
  // and the awkward ones
  it('prose before the json', check(parseTurn('Sure! Here you go:\n{"reply":"hi","calls":[]}').reply === 'hi'));
  it('tool_calls alias', check(parseTurn('{"tool_calls":[{"tool":"add_keyframe","arguments":{"nodeId":"body","property":"surface.yaw","atMs":100,"value":10}}]}').calls.length === 1));
  it('a single unwrapped call', check(parseTurn('{"name":"apply_expression","args":{"expression":"Happy","atMs":0}}').calls.length === 1));
  it('junk is rejected, not guessed', check((() => { try { parseTurn('I cannot do that'); return false; } catch { return true; } })()));
  it('unknown tools are dropped', check(parseTurn('{"calls":[{"name":"drop_database","args":{}}]}').calls.length === 0));

  // what actually broke "create a big eye effect": the JSON itself was fine, but the
  // model kept talking past the closing brace and the whole blob went to JSON.parse
  it('prose AFTER the json', check(parseTurn('{"reply":"hi","calls":[]}\n\nHope that helps!').reply === 'hi'));
  it('an unclosed fence still parses', check(parseTurn('```json\n{"reply":"hi","calls":[]}').reply === 'hi'));
  it('prose is reported as no JSON, not as a cut-off', check((() => {
      try { parseTurn('I cannot do that'); return false; } catch (e) { return /did not return JSON/.test((e as Error).message); }
    })()));

  // and when a reply genuinely runs out of budget, keep the calls it did manage to emit
  const cut = '{"reply":"Here is a BigEye preset.","calls":[{"name":"add_preset_to_timeline","args":{"preset":"Blink"}},{"name":"set_eye_par';
  const salvaged = parseTurn(cut);
  it('a truncated response keeps its complete calls', check(salvaged.calls.length === 1 && salvaged.reply.startsWith('Here is'), JSON.stringify(salvaged)));
  it('a truncated reply-only string still yields the reply', check(parseTurn('{"reply":"half a sen').reply === 'half a sen'));
  it('the new tool names survive the parser', check(parseTurn('{"calls":[{"name":"set_camera","args":{"property":"distance","value":3}},{"move_block":{"block":0,"index":1}}]}').calls.length === 2));

  // normalisation: layer names and argument aliases become the real thing
  const proj = defaultProject();
  const n1 = normaliseCall(proj, { name: 'add_modifier', args: { nodeId: 'Body', kind: 'float', amount: 10, frequency: 0.2, amplitude: 5 } });
  it('a layer name resolves to its id', check(n1.args.nodeId === 'body', String(n1.args.nodeId)));
  it('and then validates', check(validate(proj, n1) === null, String(validate(proj, n1))));
  const n2 = normaliseCall(proj, { name: 'apply_expression', args: { expression: 'Surprised', time: 900 } });
  it('time becomes atMs', check(n2.args.atMs === 900 && validate(proj, n2) === null));
  const n3 = normaliseCall(proj, { name: 'set_eye_params', args: { layer: 'Left eye', openness: 0.2 } });
  it('layer alias resolves', check(n3.args.nodeId === 'eyeL' && validate(proj, n3) === null));
  it('an unresolvable layer still fails', check(validate(proj, normaliseCall(proj, { name: 'set_eye_params', args: { nodeId: 'Nose' } })) !== null));

  // the whole cloud reply, end to end
  const applied = a.calls.map((c) => normaliseCall(proj, c));
  it('the cloud reply validates end to end', check(applied.every((c) => validate(proj, c) === null), applied.map((c) => validate(proj, c)).join('|')));
}

// --- endpoint routing ----------------------------------------------------------
{
  const base = { customUrl: '', model: 'gpt-oss:120b', keys: [] };
  it('cloud is routed through the local daemon', check(baseUrl({ ...base, endpoint: 'cloud' }) === LOCAL_URL));
  it('cloud models take the -cloud suffix', check(resolveModel({ ...base, endpoint: 'cloud' }, 'gpt-oss:120b') === 'gpt-oss:120b-cloud'));
  it('the suffix is not doubled', check(resolveModel({ ...base, endpoint: 'cloud' }, 'gpt-oss:120b-cloud') === 'gpt-oss:120b-cloud'));
  it('local models are untouched', check(resolveModel({ ...base, endpoint: 'local' }, 'llama3') === 'llama3'));
  it('only a custom endpoint needs a key', check(!needsKey({ ...base, endpoint: 'cloud' }) && !needsKey({ ...base, endpoint: 'local' }) && needsKey({ ...base, endpoint: 'custom' })));
  it('custom urls lose their trailing slash', check(baseUrl({ ...base, endpoint: 'custom', customUrl: 'https://proxy.example/' }) === 'https://proxy.example'));

  // the cloud tier has two completely different routes, decided by whether keys exist
  const daemon = { ...base, endpoint: 'cloud' as const };
  const backend = { ...daemon, keys: [{ id: 'k', value: 'sk-test', status: 'ok' as const }] };
  it('your own keys switch cloud onto the backend', check(usesBackend(backend) && needsKey(backend)));
  it('and no keys leaves it on the local daemon', check(!usesBackend(daemon)));

  // the proxy marker is an instruction TO the daemon; straight to ollama.com it is wrong
  it('the backend addresses the plain model name', check(resolveModel(backend, 'gpt-oss:120b') === 'gpt-oss:120b'
      && resolveModel(backend, 'gpt-oss:120b-cloud') === 'gpt-oss:120b'
      && resolveModel(backend, 'glm-5.2:cloud') === 'glm-5.2'));
  it('a tagged model takes -cloud on its tag', check(resolveModel(daemon, 'qwen3.5:397b') === 'qwen3.5:397b-cloud'));
  it('an untagged one takes :cloud AS the tag — "glm-5.2-cloud" is a 404', check(resolveModel(daemon, 'glm-5.2') === 'glm-5.2:cloud'));

  // listing must not touch a daemon this route never uses: with no Ollama installed at
  // all, asking localhost reported "not reachable" for a copilot that worked fine
  it('the backend route lists the catalogue without a network call', check((await listModels(backend, () => {})).join() === CLOUD_CATALOGUE.join()));
}

// --- copilot: the tools that give it the rest of the editor ---------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());

  // every clip-owned keyframe must stay inside its clip's span after any strip edit —
  // that is the invariant relayoutBlocks exists to hold, and the one a copilot tool that
  // edits tl.blocks directly would quietly break
  const glued = () => {
    const starts = blockStarts(PT());
    const span = new Map(PT().blocks.map((b, i) => [b.id, [starts[i], starts[i] + b.durationMs]] as const));
    return PT().tracks.filter((t) => t.blockId).every((t) => {
      const s = span.get(t.blockId!);
      return !!s && t.keyframes.every((k) => k.time >= s[0] - 1 && k.time <= s[1] + 1);
    });
  };

  const names = () => PT().blocks.map((b) => b.name).join(',');
  it('a fresh file opens on the four-beat strip', check(names() === 'Idle,Blink,Talk,Happy', names()));

  // a clip is addressable by name, by id and by index — models reach for all three
  applyCalls([{ name: 'set_block_duration', args: { block: 'Blink', durationMs: 900 } }]);
  it('set_block_duration resizes the clip', check(PT().blocks[1].durationMs === 900, String(PT().blocks[1].durationMs)));
  it('and drags every clip-owned keyframe with it', check(glued()));

  applyCalls([{ name: 'move_block', args: { block: 3, index: 0 } }]);
  it('move_block reorders the strip', check(names() === 'Happy,Idle,Blink,Talk', names()));
  it('reordering keeps the keyframes glued', check(glued()));

  const doomed = PT().blocks.find((b) => b.name === 'Blink')!.id;
  applyCalls([{ name: 'remove_block', args: { block: 'Blink' } }]);
  it('remove_block drops the clip and its tracks', check(names() === 'Happy,Idle,Talk' && !PT().tracks.some((t) => t.blockId === doomed)));
  it('removing keeps the keyframes glued', check(glued()));

  const before = P().timelines.length;
  applyCalls([
    { name: 'add_timeline', args: { name: 'Wave' } },
    { name: 'set_timeline', args: { durationMs: 2400, loop: true, fps: 24 } },
    { name: 'set_camera', args: { property: 'perspective', value: 42 } },
  ]);
  it('add_timeline makes a new state and switches to it', check(P().timelines.length === before + 1 && PT().name === 'Wave', PT().name));
  it('the rest of the batch lands on the timeline it just made', check(PT().timelineDurationMs === 2400 && PT().loop === true && P().fps === 24));
  it('set_camera maps the inspector label "perspective" onto fov', check(P().rig.camera.fov === 42));

  applyCalls([{ name: 'add_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: 400, value: 0.2 } }]);
  applyCalls([{ name: 'clear_animation', args: { nodeId: 'eyeL', property: 'eye.openness' } }]);
  it('clear_animation drops the track it names', check(!PT().tracks.some((t) => t.nodeId === 'eyeL' && t.property === 'eye.openness')));

  it('one undo reverses a whole tool batch', check((() => {
      const n = P().timelines.length;
      applyCalls([{ name: 'add_timeline', args: { name: 'Scratch' } }]);
      useEditor.getState().undo();
      return P().timelines.length === n;
    })()));
}

// --- copilot: one natural-language turn becomes a working animation -------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // the exact request that used to fail: a new preset built from scratch, then staged
  const turn = parseTurn(JSON.stringify({
    reply: 'Made a BigEye preset and put it on the strip.',
    calls: [
      { name: 'create_preset', args: { name: 'BigEye', durationMs: 1200, tracks: [
        { nodeId: 'Left eye', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 1.6 }, { time: 1200, value: 1 }] },
        { nodeId: 'eyeR', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 1.6 }, { time: 1200, value: 1 }] },
        { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 400, value: 0 }, { time: 800, value: 8 }, { time: 1200, value: 0 }] },
      ] } },
      { name: 'add_preset_to_timeline', args: { preset: 'BigEye' } },
    ],
  }));
  const staged = turn.calls.map((c) => normaliseCall(P(), c));
  it('the whole turn parses', check(staged.length === 2 && turn.reply.startsWith('Made')));
  it('create_preset validates', check(validate(P(), staged[0]) === null, String(validate(P(), staged[0]))));

  applyCalls(staged);
  const made = P().presets.find((x) => x.name === 'BigEye');
  it('the preset exists with all three tracks', check(!!made && made.tracks.length === 3, String(made?.tracks.length)));
  it('and is on the strip', check(activeTimeline(P()).blocks.some((b) => b.name === 'BigEye')));
  const start = blockStarts(activeTimeline(P())).at(-1)!;
  it('the eyes actually grow mid-clip', check((valueAt(P(), 'eyeL', 'transform.scale.x', start + 400) as number) > 1.5, String(valueAt(P(), 'eyeL', 'transform.scale.x', start + 400))));
  it('the body actually rotates mid-clip', check(Math.abs(valueAt(P(), 'body', 'transform.rotation', start + 800) as number) > 5));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: the two ways the "big eye" turn actually failed -------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // 1. the model wrote the short name inside a preset track, because that is what
  //    set_eye_params documents. Rejected as `"openness" is not an animatable property`.
  const short = normaliseCall(P(), { name: 'create_preset', args: { name: 'CatEyes', durationMs: 900, tracks: [
    { nodeId: 'Left eye', property: 'openness', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 0.2 }] },
    { nodeId: 'body', property: 'rotation', keyframes: [{ time: 0, value: 0 }, { time: 400, value: 8 }] },
  ] } });
  const tracks = short.args.tracks as Record<string, string>[];
  it('a short property name inside a preset track is resolved', check(tracks[0].property === 'eye.openness' && tracks[0].nodeId === 'eyeL' && tracks[1].property === 'transform.rotation', JSON.stringify(tracks.map((t) => `${t.nodeId}.${t.property}`))));
  it('and then validates', check(validate(P(), short) === null, String(validate(P(), short))));

  // and the same in an expression snapshot
  const snap = normaliseCall(P(), { name: 'create_expression', args: { name: 'Wide', snapshot: { 'Left eye.openness': 1, 'body.rotation': 4 } } });
  it('a snapshot key is resolved on both halves', check(Object.keys(snap.args.snapshot as object).join() === 'eyeL.eye.openness,body.transform.rotation', Object.keys(snap.args.snapshot as object).join()));
  it('and validates', check(validate(P(), snap) === null, String(validate(P(), snap))));

  // 2. create_preset then add_preset_to_timeline in ONE turn: the second call named a
  //    preset the first had not made yet, so it was rejected as `no preset "cat eyes"`
  const batch = [
    { name: 'create_preset', args: { name: 'cat eyes', durationMs: 900, tracks: [
      { nodeId: 'eyeL', property: 'eye.openness', keyframes: [{ time: 0, value: 1 }, { time: 400, value: 0.2 }] },
    ] } },
    { name: 'add_preset_to_timeline', args: { preset: 'cat eyes' } },
  ].map((c) => normaliseCall(P(), c as ToolCall));
  it('call-by-call validation rejects the correct batch', check(validate(P(), batch[1]) !== null));
  it('batch validation accepts it', check(validateBatch(P(), batch).every((x) => x === null), validateBatch(P(), batch).join('|')));
  applyCalls(batch);
  it('and it applies: the preset exists and is on the strip', check(P().presets.some((x) => x.name === 'cat eyes')
      && activeTimeline(P()).blocks.some((b) => b.name === 'cat eyes')));

  // a batch must still reject a preset nobody ever creates
  it('a preset that is never created is still rejected', check(validateBatch(P(), [{ name: 'add_preset_to_timeline', args: { preset: 'nope' } }])[0] !== null));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: editing what is already on the timeline ---------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const openness = () => PT().tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'eye.openness' && t.blockId === PT().blocks[1].id)!;

  // The prompt must name the exact coordinates the editing tools take, or the copilot can
  // only ever append. Blink is the second clip, so its keys are absolute, not clip-local.
  const prompt = systemPrompt(P());
  const blinkStart = blockStarts(PT())[1];
  it('the prompt lists the clips and their spans', check(prompt.includes(`"Blink" ${Math.round(blinkStart)}-`), 'no clip span'));
  it('the prompt lists real keyframes at absolute times', check(prompt.includes(`eyeL.eye.openness [Blink@${Math.round(blinkStart)}]: ${Math.round(blinkStart)}=1`), 'no keyframe line'));
  it('and the times it prints are the times the tools accept', check(openness().keyframes.every((k) => prompt.includes(`${Math.round(k.time)}=`))));

  const shut = openness().keyframes[1];
  it('a keyframe the prompt lists validates for editing', check(validate(P(), { name: 'move_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', fromMs: shut.time, toMs: shut.time + 60 } }) === null));
  it('a time nothing sits on is refused, and says where to look', check(/Keyframes/.test(validate(P(), { name: 'remove_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: shut.time + 7000 } }) ?? '')));

  applyCalls([{ name: 'move_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', fromMs: shut.time, toMs: shut.time + 60 } }]);
  it('move_keyframe retimes it and keeps the track sorted', check(openness().keyframes.some((k) => Math.round(k.time) === Math.round(shut.time + 60))
      && openness().keyframes.every((k, i, arr) => i === 0 || arr[i - 1].time <= k.time)));

  // a short name and a rounded time still land, the way a model writes them
  applyCalls([normaliseCall(P(), { name: 'add_keyframe', args: { nodeId: 'Left eye', property: 'openness', atMs: shut.time + 60, value: 0.5 } })]);
  it('add_keyframe at a listed time overwrites rather than adding a second key', check(openness().keyframes.filter((k) => Math.abs(k.time - (shut.time + 60)) < 8).length === 1
      && (valueAt(P(), 'eyeL', 'eye.openness', shut.time + 60) as number) === 0.5));

  const before = openness().keyframes.length;
  applyCalls([{ name: 'remove_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: shut.time + 60 } }]);
  it('remove_keyframe deletes exactly one', check(openness().keyframes.length === before - 1));

  // emptying a track must not leave a lane on the strip with nothing in it
  const tiny = PT().tracks.find((t) => t.blockId === PT().blocks[1].id)!;
  const id = tiny.id;
  for (const k of [...tiny.keyframes]) {
    applyCalls([{ name: 'remove_keyframe', args: { nodeId: tiny.nodeId, property: tiny.property, atMs: k.time } }]);
  }
  it('an emptied track is dropped, not left as a blank lane', check(!PT().tracks.some((t) => t.id === id)));

  useEditor.getState().loadProject(defaultProject());
}

// --- editing a preset, from the copilot and from a clip -------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const blink = () => P().presets.find((x) => x.name === 'Blink')!;

  it('edit_preset needs something to change', check(validate(P(), { name: 'edit_preset', args: { preset: 'Blink' } }) !== null));
  it('and a preset that exists', check(validate(P(), { name: 'edit_preset', args: { preset: 'nope', durationMs: 500 } }) !== null));
  it('a bad layer in replacement tracks is caught, not silently built', check(validate(P(), { name: 'edit_preset', args: { preset: 'Blink', tracks: [{ nodeId: 'nose', property: 'eye.openness', keyframes: [{ time: 0, value: 1 }] }] } }) !== null));

  const wasDuration = blink().durationMs;
  applyCalls([normaliseCall(P(), { name: 'edit_preset', args: { preset: 'Blink', durationMs: 400, tracks: [
    { nodeId: 'Left eye', property: 'openness', keyframes: [{ time: 0, value: 1 }, { time: 200, value: 0 }, { time: 400, value: 1 }] },
  ] } })]);
  it('edit_preset rewrites duration and tracks, with names resolved', check(blink().durationMs === 400 && wasDuration !== 400
      && blink().tracks.length === 1 && blink().tracks[0].nodeId === 'eyeL' && blink().tracks[0].property === 'eye.openness'));

  // the UI route: place a clip, change it on the strip, save it back over the preset
  useEditor.getState().loadProject(defaultProject());
  const ed = () => useEditor.getState();
  const clip = activeTimeline(P()).blocks[1];
  const start = blockStarts(activeTimeline(P()))[1];
  ed().commit((p) => {
    const tl = activeTimeline(p);
    const t = tl.tracks.find((x) => x.blockId === clip.id)!;
    t.keyframes[1].value = 0.9;
  });
  ed().updatePresetFromBlock(clip.id);
  const saved = P().presets.find((x) => x.id === clip.presetId)!;
  it('save-to-preset picks up the edit', check(saved.tracks.some((t) => t.keyframes.some((k) => k.value === 0.9))));
  it('and rebases its times to the clip start, so it can be placed anywhere', check(start > 0 && saved.tracks.every((t) => t.keyframes[0].time === 0)));
  it('while the clip already on the strip keeps its own copy', check(activeTimeline(P()).tracks.filter((t) => t.blockId === clip.id).length > 0));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: where new animation lands, and the plan that precedes it ----------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  // a fresh file already has four clips, so "start at 0" would overwrite them
  const end = blocksEnd(activeTimeline(P()));
  it('new work starts after everything on the strip', check(suggestedStart(P()) === Math.round(end), String(suggestedStart(P()))));
  it('and the prompt says so in absolute terms', check(systemPrompt(P()).includes(`starts at ${Math.round(end)}ms`)));

  // on an empty strip it must not be 0 either — a clip that opens mid-move reads clipped —
  // but it must not sit three seconds in doing nothing
  useEditor.getState().loadProject({ ...defaultProject(), timelines: [makeTimeline('Empty')] } as never);
  useEditor.getState().addTimeline('Blank');
  const blank = suggestedStart(P());
  it('an empty timeline starts inside the 1.5s ceiling', check(blank >= 0 && blank <= 1500, String(blank)));
  it('and the prompt keeps the two kinds of time apart', check(/times inside a preset are relative/i.test(systemPrompt(P())) && /ABSOLUTE on this timeline/.test(systemPrompt(P()))));

  // the plan comes first in the schema, so the model reasons before it emits calls
  const schema = RESPONSE_SCHEMA as unknown as { properties: Record<string, unknown>; required: readonly string[] };
  const props = Object.keys(schema.properties);
  it('plan is the first key the model fills', check(props[0] === 'plan', props.join()));
  it('and it is required', check(schema.required.includes('plan')));

  const turn = parseTurn('{"plan":"Four beats: rest, grow, hold, blink out.","reply":"Done.","calls":[]}');
  it('the plan is parsed off the turn', check(!!turn.plan?.startsWith('Four beats') && turn.reply === 'Done.'));
  it('a model that calls it reasoning is understood too', check(parseTurn('{"reasoning":"same thing","reply":"ok","calls":[]}').plan === 'same thing'));
  it('and a turn without one still parses', check(parseTurn('{"reply":"ok","calls":[]}').plan === undefined));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: a follow-up edits, it does not build a second clip -----------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  const bare = systemPrompt(P());
  it('with nothing made yet, no conversation line is claimed', check(!/in this conversation/.test(bare)));

  const withHistory = systemPrompt(P(), ['BigEye']);
  it('once something is made, the prompt names it', check(/You made these in this conversation, newest last: BigEye/.test(withHistory)));
  it('and says a bare "it" refers to the newest of them', check(/"it", "the animation"/.test(withHistory)));

  // the trap this rule exists for: edit_preset changes the template, and a clip already
  // placed keeps its own copy — so editing only the preset changes nothing on screen
  it('the prompt warns that editing a preset alone is invisible', check(/editing the preset alone changes nothing on screen/.test(withHistory)));
  it('and points refinements at the strip keyframes', check(/overwrites that keyframe in place/.test(withHistory)));
  it('while still allowing an explicit second preset', check(/only when asked for one in so many words/.test(withHistory)));

  // that warning has to be TRUE: prove a placed clip ignores a later edit_preset
  applyCalls([
    { name: 'create_preset', args: { name: 'Follow', durationMs: 600, tracks: [
      { nodeId: 'body', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 300, value: 1.2 }] },
    ] } },
    { name: 'add_preset_to_timeline', args: { preset: 'Follow' } },
  ]);
  const clipStart = blockStarts(activeTimeline(P())).at(-1)!;
  const before = valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number;

  applyCalls([{ name: 'edit_preset', args: { preset: 'Follow', tracks: [
    { nodeId: 'body', property: 'transform.scale.x', keyframes: [{ time: 0, value: 1 }, { time: 300, value: 1.8 }] },
  ] } }]);
  it('editing the preset really does leave the placed clip alone', check((valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number) === before, String(before)));

  // and that the route the prompt points at DOES change it
  applyCalls([{ name: 'add_keyframe', args: { nodeId: 'body', property: 'transform.scale.x', atMs: clipStart + 300, value: 1.8 } }]);
  it('while add_keyframe at the listed time is what the user actually sees change', check((valueAt(P(), 'body', 'transform.scale.x', clipStart + 300) as number) === 1.8));

  useEditor.getState().loadProject(defaultProject());
}

// --- copilot: judging the animation, not just the JSON --------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const ASK = 'make the mascot scale and rotate and make his eyes wide, then rest';

  const track = (nodeId: string, property: string, keys: [number, number][]) =>
    ({ nodeId, property, keyframes: keys.map(([time, value]) => ({ time, value })) });
  const preset = (tracks: unknown[]) =>
    [{ name: 'create_preset', args: { name: 'X', durationMs: 1400, tracks } }] as ToolCall[];

  // the exact failure the user reported: a body that "scales" by 1.03
  const timid = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.03], [900, 1.03], [1400, 1]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [900, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  it('a body that scales by 0.03 is called out', check(timid.some((n) => /invisible/.test(n)), timid.join(' | ')));

  // a motion the user named with nothing animating it at all
  const missing = critique(P(), preset([
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  it('rotation asked for and never animated is called out', check(missing.some((n) => /rotation/.test(n) && /no track animates it/.test(n)), missing.join(' | ')));

  // a clip that ends somewhere else cannot loop or be followed
  const drifts = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.2], [900, 1.2], [1400, 1.2]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [900, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [900, 1.7], [1400, 1]]),
  ]), ASK);
  it('a track that does not close back is called out', check(drifts.some((n) => /cannot loop or be followed/.test(n)), drifts.join(' | ')));

  // no hold: every pose passed straight through
  const rushed = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [400, 1.2], [800, 1]]),
    track('body', 'transform.rotation', [[0, 0], [400, 8], [800, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [400, 1.7], [800, 1]]),
  ]), ASK);
  it('nothing held is called out', check(rushed.some((n) => /No pose is held/.test(n)), rushed.join(' | ')));
  it('and identical timing across every layer too', check(rushed.some((n) => /same frames/.test(n)), rushed.join(' | ')));

  // and the one that matters most: good work must pass silently
  const good = critique(P(), preset([
    track('body', 'transform.scale.x', [[0, 1], [380, 1.18], [900, 1.18], [1400, 1]]),
    track('body', 'transform.scale.y', [[0, 1], [420, 1.06], [940, 1.06], [1400, 1]]),
    track('body', 'transform.rotation', [[0, 0], [450, 8], [960, 8], [1400, 0]]),
    track('eyeL', 'transform.length', [[0, 1], [340, 1.7], [880, 1.7], [1400, 1]]),
  ]), ASK);
  it('a well-made clip draws no complaints', check(good.length === 0, good.join(' | ')));

  // a request that names nothing must not be nitpicked on magnitude
  const quiet = critique(P(), preset([
    track('body', 'flatOffset.y', [[0, 0], [500, -4], [1000, -4], [1400, 0]]),
  ]), 'add a gentle idle');
  it('a subtle animation nobody asked to be big is left alone', check(!quiet.some((n) => /invisible/.test(n)), quiet.join(' | ')));

  it('at most three complaints, so the model can act on them', check(timid.length <= 3 && rushed.length <= 3));
}

// --- copilot: a same-name create is an edit -------------------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  applyCalls([{ name: 'create_preset', args: { name: 'Wave', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 8 }] },
  ] } }]);
  const count = P().presets.length;

  // "make it rotate more" comes back as create_preset with the same name constantly
  const again = normaliseCall(P(), { name: 'create_preset', args: { name: 'Wave', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 20 }] },
  ] } });
  it('a create naming an existing preset becomes an edit', check(again.name === 'edit_preset', again.name));
  it('and carries the name across as the target', check(again.args.preset === 'Wave' && again.args.name === undefined));

  applyCalls([again]);
  it('so no second preset appears', check(P().presets.length === count, `${P().presets.length} vs ${count}`));
  it('and the edit landed', check(P().presets.find((x) => x.name === 'Wave')!.tracks[0].keyframes[1].value === 20));

  // a genuinely new name still creates
  const fresh = normaliseCall(P(), { name: 'create_preset', args: { name: 'Wave Two', durationMs: 600, tracks: [
    { nodeId: 'body', property: 'transform.rotation', keyframes: [{ time: 0, value: 0 }, { time: 300, value: 8 }] },
  ] } });
  it('a new name still creates', check(fresh.name === 'create_preset'));

  // describe must not print "undefined" for something the same batch is about to make
  const line = describe(P(), { name: 'add_preset_to_timeline', args: { preset: 'NotYetMade' } });
  it('describe falls back to what the model wrote', check(line.includes('NotYetMade'), line));

  useEditor.getState().loadProject(defaultProject());
}

// --- the copilot can do what the editor can do ----------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };

  // COPILOT.md's rule: if the editor can do it, the copilot must be able to, with a
  // description. Emitters and the pendulum are new, so they have to be reachable.
  it('every effect the renderer implements is offerable to the copilot', check(MODIFIER_KINDS.every((k) => validate(P(), { name: 'add_modifier', args: { nodeId: 'body', kind: k, amount: 100, frequency: 1, amplitude: 6 } }) === null)));
  it('and the tool docs describe emitters', check(/add_emitter/.test(TOOL_DOCS) && /orbit/.test(TOOL_DOCS)));

  const call: ToolCall = { name: 'add_emitter', args: {
    name: 'zzz', glyphs: ['z', 'z', 'Z'], path: 'arc',
    fromNode: 'Right eye', fromX: 40, fromY: -30, toX: 120, toY: -150,
    color: [90, 90, 110], rateMs: 500, lifeMs: 1600, count: 3, startMs: 200, endMs: 1800,
  } };
  const staged = normaliseCall(P(), call);
  it('add_emitter validates', check(validate(P(), staged) === null, String(validate(P(), staged))));
  it('and describes itself readably', check(/Emit z z Z/.test(describe(P(), staged)), describe(P(), staged)));
  it('a layer that does not exist is refused', check(validate(P(), { name: 'add_emitter', args: { name: 'x', glyphs: ['z'], fromNode: 'elbow' } }) !== null));
  it('and so is an empty glyph list', check(validate(P(), { name: 'add_emitter', args: { name: 'x', glyphs: [] } }) !== null));

  applyCalls([staged]);
  const made = (activeTimeline(P()).emitters ?? []).at(-1);
  it('the emitter is created, with its layer name resolved to an id', check(made?.from.nodeId === 'eyeR' && made.glyphs.join('') === 'zzZ', JSON.stringify(made?.from)));
  const glyphs = (t: number) => {
    const rig = evaluateRig(P(), t);
    return emitterItems(activeTimeline(P()), rig, buildScene(rig, VIEW), t, VIEW);
  };
  it('and it actually renders inside the range it was given', check(glyphs(100).length === 0 && glyphs(900).length > 0 && glyphs(1900).length === 0));
  it('fading out over the last of it rather than vanishing', check(Math.max(...glyphs(1750).map((g) => g.color.a)) < Math.max(...glyphs(1200).map((g) => g.color.a)), `${Math.max(...glyphs(1200).map((g) => g.color.a)).toFixed(2)} -> ${Math.max(...glyphs(1750).map((g) => g.color.a)).toFixed(2)}`));

  // and the range is adjustable by name afterwards, which is what a follow-up asks for
  applyCalls([{ name: 'set_effect_range', args: { effect: 'zzz', startMs: 1200, endMs: 1500 } }]);
  it('set_effect_range moves it', check(glyphs(900).length === 0 && glyphs(1300).length > 0));
  applyCalls([{ name: 'set_effect_range', args: { effect: 'zzz' } }]);
  it('and clearing it runs the whole scope again', check(glyphs(100).length > 0));
  it('an effect nobody made is refused', check(validate(P(), { name: 'set_effect_range', args: { effect: 'nope', startMs: 0 } }) !== null));

  // a modifier is nameable by its kind, which is what a user would say
  applyCalls([{ name: 'add_modifier', args: { nodeId: 'body', kind: 'pendulum', amount: 100, frequency: 1, amplitude: 10 } }]);
  it('an effect can be ranged by its kind name', check(validate(P(), { name: 'set_effect_range', args: { effect: 'pendulum', startMs: 100, endMs: 400 } }) === null));

  ed().loadProject(defaultProject());
}

// --- the copilot reaches everything the editor gained ----------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  it('the tool docs describe shapes and parts', check(/set_shape/.test(TOOL_DOCS) && /set_emitter_parts/.test(TOOL_DOCS)));
  it('and list the shapes it may ask for', check(SHAPE_LIBRARY.every((x) => TOOL_DOCS.includes(x.id))));

  // a shape keyframe, which is the morph
  const mk: ToolCall = { name: 'set_shape', args: { nodeId: 'Left eye', shape: 'star', points: 5, atMs: 0 } };
  const staged = normaliseCall(P(), mk);
  it('set_shape validates', check(validate(P(), staged) === null, String(validate(P(), staged))));
  it('a shape nobody has is refused', check(validate(P(), { name: 'set_shape', args: { nodeId: 'eyeL', shape: 'blob' } }) !== null));
  ed().addTimeline('CopilotShapes');
  applyCalls([{ name: 'set_shape', args: { nodeId: 'eyeL', shape: 'pill', atMs: 0 } },
              { name: 'set_shape', args: { nodeId: 'eyeL', shape: 'star', points: 5, atMs: 600 } }]);
  const pathAt = (t: number) => buildScene(evaluateRig(P(), t), { width: 720, height: 720 }).find((i) => i.id === 'eyeL')?.path;
  it('two shape keyframes morph', check(!!pathAt(300) && pathAt(300) !== pathAt(0) && pathAt(300) !== pathAt(600)));

  // and what an emitter throws
  ed().loadProject(defaultProject());
  ed().addEmitter({
    name: 'sparks', glyphs: [], color: { r: 0, g: 0, b: 0, a: 1 }, size: 20, path: 'arc',
    from: { nodeId: 'body', x: 0, y: -40 }, to: { nodeId: 'body', x: 60, y: -140 }, bow: 10,
    rateMs: 300, lifeMs: 900, count: 3, fadeStart: 0.6,
    scaleFrom: 1, scaleTo: 1, spin: 0, wobble: 0, wobbleFrequency: 1,
  });
  it('an unknown shape id is refused, and says what is available', check(/spark/.test(validate(P(), { name: 'set_emitter_parts', args: { emitter: 'sparks', parts: [{ shape: 'nope' }] } }) ?? '')));
  applyCalls([{ name: 'set_emitter_parts', args: { emitter: 'sparks', parts: [
    { shape: 'spark', speed: 1.2, size: 0.8 }, { shape: 'star', color: [240, 200, 60] },
  ] } }]);
  const em = activeTimeline(P()).emitters!.at(-1)!;
  it('set_emitter_parts replaces what it throws', check((em.parts ?? []).length === 2 && em.parts![0].shapeId === 'spark' && em.parts![1].color?.r === 240));
  it('and clears the old glyph line so nothing is thrown twice', check(em.glyphs.length === 0));

  ed().loadProject(defaultProject());
}
