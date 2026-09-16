import { it, vi } from 'vitest';
import { check } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { compOf } from '../core/comp';
import { sceneAt, valueAt, buildScene, evaluateRig, sceneFrames, WORLD } from '../core/scene';
import { makeCurveLayer, makeShapeLayer, makeLimbPair } from '../core/layers';
import { faceOf, mascotOf } from '../core/mascot';
import { ANY_STATE, activeTimeline } from '../core/types';
import { machineOf } from '../core/stateMachine';
import { DEFAULT_CLOUD_MODEL, type CopilotSettings } from './pool';

const script: string[] = [];
vi.mock('./client', () => ({
  chatJson: async () => ({ content: script.shift() ?? '{"plan":"","status":"done","calls":[{"name":"finish","args":{"summary":"ok"}}],"done":true}', usage: { input: 900, output: 150 } }),
}));
const { runAgent } = await import('./agent');
const settings: CopilotSettings = { endpoint: 'cloud', customUrl: '', model: DEFAULT_CLOUD_MODEL, keys: [] };
const step = (status: string, calls: { name: string; args: Record<string, unknown> }[], done = false) => JSON.stringify({ plan: '', status, calls, done });
const ed = () => useEditor.getState();
const P = () => ed().project;

// --- a project built through the editor's own actions -----------------------------------
ed().loadProject(defaultProject());
const m = ed().addMascot('cute');
it('a new mascot comes with a face', check(!!faceOf(P().rig, m)));

// a shape made the face of the first mascot
ed().addLayer(makeShapeLayer('pebble', { id: 'plate', parentId: 'body' }));
ed().setFaceRole('plate', true);
it('the shape is the face now', check(faceOf(P().rig, 'body') === 'plate' && P().rig.nodes.eyeL.parentId === 'plate'));

// a curve drawn on with its offsets
ed().addLayer(makeCurveLayer([{ x: -120, y: -260 }, { x: 0, y: -300 }, { x: 120, y: -260 }], { name: 'Smile' })!);
const curve = ed().selection[0];
useEditor.setState({ autoKey: true });
ed().setPlayhead(0); ed().setValue(curve, 'trim.end', 0);
ed().setPlayhead(900); ed().setValue(curve, 'trim.end', 1);

// legs, one pinned
ed().addLayer(makeLimbPair(P().rig, 'body', 'leg'));
const legs = Object.values(P().rig.nodes).filter((n) => n.limb?.type === 'leg' && mascotOf(P().rig, n.id)?.id === 'body');
ed().setPlayhead(0);
ed().pinLimb(legs[0].id, true);
const pinWorld = () => { const f = sceneFrames(evaluateRig(P(), ed().playhead), compOf(P())).get(WORLD)!; const pin = P().rig.nodes[legs[0].id].limb!.pin!; return [f.x + pin.x, f.y + pin.y]; };
const planted = pinWorld();

// the body rolls and squishes over time, and a squish preset lands at 1.2s
ed().setPlayhead(0); ed().setValue('body', 'transform.rotation', 0);
ed().setPlayhead(1000); ed().setValue('body', 'transform.rotation', 12);
ed().setPlayhead(1200); ed().applySquishPreset('body', 'bounce');
useEditor.setState({ autoKey: false });

// text, and a rule on a second state
const text = ed().addText('Hello!');
ed().addTimeline('Happy');
const happy = P().activeTimelineId;
ed().setActiveTimeline(P().timelines[0].id);
ed().addInput({ name: 'mood', type: 'Numeric', value: 0 });
ed().addStateTransition(ANY_STATE, happy, [{ input: 'mood', operator: 'Equal', value: 1 }]);

it('the curve draws on', check((valueAt(P(), curve, 'trim.end', 450) as number) > 0 && (valueAt(P(), curve, 'trim.end', 450) as number) < 1));
it('the foot stays planted while the body rolls', check(pinWorld()[0] === planted[0] && pinWorld()[1] === planted[1]));
it('the squish preset is at the playhead it was applied at', check(activeTimeline(P()).tracks.some((t) => t.property === 'squish.x' && t.keyframes.some((k) => Math.abs(k.time - 1200) < 1))));
it('everything renders together', check(['plate', 'eyeL', curve, legs[0].id, text, m].every((id) => sceneAt(P(), 600, compOf(P())).some((s) => s.id === id))));
ed().setInput('mood', 1);
it('the rule takes the machine to Happy', check(P().activeTimelineId === happy));
ed().resetInputs();
ed().setActiveTimeline(P().timelines[0].id);

// --- then the copilot: a 3-second profile animation --------------------------------------
const before = P();
const wave = Object.values(P().rig.nodes).find((n) => n.limb?.type === 'arm' && mascotOf(P().rig, n.id)?.id === 'body');
script.push(
  step('Reading the project and profile presets', [{ name: 'inspect_project', args: {} }, { name: 'search_presets', args: { query: 'profile hand wave' } }]),
  step('Inspecting Profile Hello', [{ name: 'get_preset', args: { preset: 'Profile Hello' } }]),
  step('Adding hands and happy eyes', [
    { name: 'add_layer', args: { type: 'hand', side: 'right' } },
    { name: 'add_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', atMs: 600, value: 0.45 } },
    { name: 'add_keyframe', args: { nodeId: 'eyeR', property: 'eye.openness', atMs: 600, value: 0.45 } },
  ]),
  step('Waving and squashing', [
    { name: 'apply_squish_preset', args: { nodeId: 'body', preset: 'Soft Squash', atMs: 1500 } },
    { name: 'add_keyframe', args: { nodeId: 'plate', property: 'transform.rotation', atMs: 1000, value: 5 } },
    { name: 'add_keyframe', args: { nodeId: curve, property: 'trim.end', atMs: 2400, value: 0 } },
    { name: 'add_keyframe', args: { nodeId: curve, property: 'trim.end', atMs: 3000, value: 1 } },
  ]),
  step('Previewing', [{ name: 'preview', args: { times: [600, 1500, 2700], nodeIds: ['body', 'plate'] } }]),
  step('Done', [{ name: 'finish', args: { summary: 'A 3-second profile hello.' } }], true),
);
const report = await runAgent({ settings, request: 'Create a polished 3-second profile animation', history: [], made: [], signal: new AbortController().signal, markKey: () => {}, onEvent: () => {}, onUsage: () => {} });
const after = P();
it('the agent run completes', check(report.ended === 'done' && report.edits.length >= 6, JSON.stringify(report.edits.map((e) => e.name))));
it('its hand is owned by the state it was made in', check(Object.values(after.rig.nodes).some((n) => n.limb?.type === 'arm' && n.ranged && n.id !== wave?.id)));
it('the hierarchy survives: face still carries the eyes', check(after.rig.nodes.eyeL.parentId === 'plate' && faceOf(after.rig, 'body') === 'plate'));
it('the foot is still pinned where it was', check(!!after.rig.nodes[legs[0].id].limb!.pin));
it('the rule survives', check(machineOf(after).transitions.some((t) => t.from === ANY_STATE)));
it('the curve draws itself again near the end', check((valueAt(after, curve, 'trim.end', 2700) as number) < 1));
it('it all still renders', check(buildScene(evaluateRig(after, 2000), compOf(after)).length > 5));

// revert, reapply, then "slower" edits the result rather than rebuilding it
ed().restoreProject(before, 'agent.revert');
it('revert takes every agent change away', check(P() === before && (valueAt(P(), 'eyeL', 'eye.openness', 600) as number) !== 0.45));
ed().restoreProject(after, 'agent.reapply');
it('reapply brings back the exact result', check(P() === after));

const eyeTrack = activeTimeline(after).tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'eye.openness' && t.keyframes.some((k) => k.time === 600))!;
const kf = eyeTrack.keyframes.find((k) => k.time === 600)!;
const tracksBefore = activeTimeline(after).tracks.length;
script.push(
  step('Reading what I made', [{ name: 'get_layer', args: { nodeId: 'eyeL' } }]),
  step('Slowing the happy eyes', [{ name: 'move_keyframe', args: { nodeId: 'eyeL', property: 'eye.openness', fromMs: 600, toMs: 900 } }]),
  step('Done', [{ name: 'finish', args: { summary: 'Slower.' } }], true),
);
await runAgent({ settings, request: 'Make the animation slower', history: [], made: [], signal: new AbortController().signal, markKey: () => {}, onEvent: () => {}, onUsage: () => {} });
const slow = activeTimeline(P());
it('"slower" moved the existing keyframe', check(slow.tracks.find((t) => t.id === eyeTrack.id)!.keyframes.some((k) => k.id === kf.id && k.time === 900)));
it('without rebuilding anything', check(slow.tracks.length === tracksBefore));
