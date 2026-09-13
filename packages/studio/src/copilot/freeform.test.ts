import { it } from 'vitest';
import toolsSource from './tools.ts?raw';
import { check, near } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { applyCalls, describe, normaliseCall, RESPONSE_SCHEMA, TOOL_DOCS, TOOL_NAMES, validate, validateBatch, type ToolCall } from './tools';
import { systemPrompt } from './prompt';
import { parseTurn } from './parse';
import { appearanceSpans, sceneAt } from '../core/scene';
import { compOf } from '../core/comp';
import { machineOf, STATE_INPUT } from '../core/stateMachine';
import { libraryOutline, shapeIdOf } from '../core/emitters';
import { activeTimeline } from '../core/types';
import type { Project } from '../core/types';

// --- the contract COPILOT.md states, checked rather than hoped for -------------------
{
  // a tool with a validate and a describe case but no applyCalls case renders a lovely
  // card and does nothing — which is exactly what four tools once did
  const short = TOOL_NAMES.filter((n) => (toolsSource.match(new RegExp(`case '${n}'`, 'g')) ?? []).length < 3);
  it('every tool has a validate, a describe AND an applyCalls case', check(short.length === 0, short.join(', ')));
  it('and a line in TOOL_DOCS', check(TOOL_NAMES.every((n) => TOOL_DOCS.includes(n)), TOOL_NAMES.filter((n) => !TOOL_DOCS.includes(n)).join(', ')));
  it('and the JSON schema offers every one', check(TOOL_NAMES.every((n) => (RESPONSE_SCHEMA.properties.calls.items.properties.name.enum as readonly string[]).includes(n))));
  const parsed = parseTurn(JSON.stringify({ plan: 'p', reply: 'r', calls: TOOL_NAMES.map((name) => ({ name, args: {} })) }));
  it('the parser lets every new tool through', check(parsed.calls.length === TOOL_NAMES.length));
}

const ed = () => useEditor.getState();
const P = (): Project => ed().project;
const node = (name: string) => Object.values(P().rig.nodes).find((n) => n.name === name);
/** stage a turn the way the Copilot panel does: normalise, validate as a batch, apply */
const run = (calls: ToolCall[]) => {
  const staged = calls.map((c) => normaliseCall(P(), c));
  const problems = validateBatch(P(), staged).filter(Boolean);
  if (!problems.length) applyCalls(staged);
  return problems as string[];
};

// --- the requests the copilot has to understand ---------------------------------------
{
  ed().loadProject(defaultProject());
  ed().setPlayhead(0);

  // "add a blue SVG star"
  const blue = run([{ name: 'add_layer', args: { type: 'shape', shape: 'star', fill: [40, 90, 230], name: 'Blue star' } }]);
  it('"add a blue SVG star" validates', check(!blue.length, blue.join(' | ')));
  const star = node('Blue star');
  it('and makes a real star layer, in blue', check(!!star && shapeIdOf(star.shapePath) === 'star' && star.color.b === 230));
  it('described in plain words', check(/star/.test(describe(P(), { name: 'add_layer', args: { type: 'shape', shape: 'star' } }))));

  // "make the new object appear from 500ms to 1200ms"
  run([{ name: 'set_layer_appearance_range', args: { nodeId: 'Blue star', startMs: 500, endMs: 1200, fadeInMs: 80 } }]);
  const spans = appearanceSpans(activeTimeline(P()), star!.id);
  it('"appear from 500 to 1200" sets that range', check(spans.length === 1 && spans[0].from === 500 && spans[0].to === 1200, JSON.stringify(spans.map((s) => [s.from, s.to]))));
  const on = (t: number) => sceneAt(P(), t, compOf(P())).some((s) => s.id === star!.id);
  it('and the layer really is only on screen then', check(!on(300) && on(900) && !on(1400)));

  // "make the hat follow the head" — the hat made in the same turn, then attached by name
  const hat = run([
    // over the head (the silhouette is ~148px): over the rim it would attach flat instead
    { name: 'add_layer', args: { type: 'shape', shape: 'pebble', name: 'Hat', x: 0, y: -110 } },
    { name: 'set_layer_attachment', args: { nodeId: 'Hat', mode: 'mascot' } },
  ]);
  it('a layer made earlier in the batch can be attached by name in the same turn', check(!hat.length, hat.join(' | ')));
  const hatNode = node('Hat')!;
  it('"make the hat follow the head" attaches it to the mascot, on its surface', check(hatNode.parentId === P().rig.rootId && hatNode.surface.mapped));
  it('and asking again does not make a second hat', check((() => {
    run([{ name: 'set_layer_attachment', args: { nodeId: 'Hat', mode: 'mascot' } }]);
    return Object.values(P().rig.nodes).filter((n) => n.name === 'Hat').length === 1;
  })()));

  // SVG markup
  const svg = run([{ name: 'add_svg', args: { markup: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ff0000"/><rect x="1" y="1" width="3" height="3" fill="#00ff00"/></svg>', name: 'Badge' } }]);
  it('add_svg makes a vector layer from markup', check(!svg.length && node('Badge')?.svg?.paths?.length === 2));
  it('and refuses something that is not an SVG', check(validate(P(), { name: 'add_svg', args: { markup: 'hello' } }) !== null));

  // fill and stroke, keyed separately, going opposite ways
  run([
    { name: 'set_svg_fill', args: { nodeId: 'Blue star', color: '#2a55e6', atMs: 0 } },
    { name: 'set_svg_stroke', args: { nodeId: 'Blue star', color: [0, 0, 0], width: 3, atMs: 0 } },
    { name: 'set_svg_fill', args: { nodeId: 'Blue star', color: [240, 130, 190], atMs: 500 } },
    { name: 'set_svg_stroke', args: { nodeId: 'Blue star', color: [255, 255, 255], atMs: 500 } },
  ]);
  const tracks = activeTimeline(P()).tracks.filter((t) => t.nodeId === star!.id);
  it('fill and stroke land on two independent tracks', check(tracks.some((t) => t.property === 'color') && tracks.some((t) => t.property === 'stroke.color')));
  it('asking for a stroke turns one on', check(tracks.some((t) => t.property === 'stroke.enabled')));
  run([{ name: 'set_svg_stroke_width', args: { nodeId: 'Blue star', width: 6 } }]);
  it('set_svg_stroke_width sets it', check(activeTimeline(P()).tracks.some((t) => t.nodeId === star!.id && t.property === 'stroke.width') || P().rig.nodes[star!.id].stroke?.width === 6));

  // hands and legs
  const limbs = run([{ name: 'add_layer', args: { type: 'hand' } }, { name: 'add_layer', args: { type: 'leg' } }]);
  it('hands and legs are added in pairs', check(!limbs.length && !!node('Left hand') && !!node('Right hand') && !!node('Left leg') && !!node('Right leg'), limbs.join(' | ')));
  const before = node('Right hand')!.limb!.length;
  run([{ name: 'set_hand_rig', args: { nodeId: 'Right hand', length: Math.round(before * 1.3), rubberHose: true } }]);
  it('"make the hand longer" lengthens it', check(node('Right hand')!.limb!.length === Math.round(before * 1.3) && before > 50, `${before} -> ${node('Right hand')!.limb!.length}`));
  const legBefore = node('Left leg')!.limb!.length;
  run([{ name: 'set_leg_rig', args: { nodeId: 'Left leg', length: Math.round(legBefore * 1.3), bend: -1, footAngle: 20 } }]);
  it('"bend the left leg more" gives it more length to bend with, and flips the side', check(
    node('Left leg')!.limb!.length === Math.round(legBefore * 1.3) && node('Left leg')!.limb!.bend === -1 && node('Left leg')!.limb!.foot!.angle === 20));
  run([{ name: 'set_hand_points', args: { nodeId: 'Right hand', hand: { x: 210, y: -110 } } }]);
  it('set_hand_points moves the hand', check(node('Right hand')!.limb!.b.x === 210 && node('Right hand')!.limb!.b.y === -110));
  run([{ name: 'set_leg_points', args: { nodeId: 'Left leg', knee: { x: -90, y: 170 }, ankle: [-64, 232] } }]);
  it('set_leg_points moves the knee and ankle', check(node('Left leg')!.limb!.b.x === -90 && node('Left leg')!.limb!.c!.y === 232));
  it('a hand tool on a leg is refused, with guidance', check(/not a hand/.test(validate(P(), normaliseCall(P(), { name: 'set_hand_rig', args: { nodeId: 'Left leg', length: 2 } })) ?? '')));
  run([{ name: 'set_hand_points', args: { nodeId: 'Right hand', hand: { x: 150, y: -140 }, atMs: 400 } }]);
  it('limb points keyframe with atMs', check(activeTimeline(P()).tracks.some((t) => t.nodeId === node('Right hand')!.id && t.property === 'limb.b.y')));

  // "change the current shape to octopus", then a morph
  run([{ name: 'set_shape', args: { nodeId: 'body', shape: 'octopus' } }]);
  it('"change the shape to octopus" changes the mascot', check(shapeIdOf(P().rig.nodes.body.shapePath) === 'octopus'));
  ed().addTimeline('Shapes');
  run([
    { name: 'set_shape', args: { nodeId: 'body', shape: 'pebble', atMs: 0 } },
    { name: 'set_shape', args: { nodeId: 'body', shape: 'capsule', atMs: 500 } },
    { name: 'set_shape_morph', args: { nodeId: 'body', atMs: 0, mode: 'elastic', durationMs: 400 } },
  ]);
  const shapeTrack = activeTimeline(P()).tracks.find((t) => t.nodeId === 'body' && t.property === 'shape.path')!;
  it('two shape keyframes and a morph mode', check(shapeTrack.keyframes.length === 2 && shapeTrack.keyframes[1].time === 400 && shapeTrack.keyframes[1].value === libraryOutline('capsule')));
  it('set_shape_morph without a shape keyframe is refused', check(/no shape keyframes/.test(validate(P(), { name: 'set_shape_morph', args: { nodeId: 'eyeL', atMs: 0, mode: 'cut' } }) ?? '')));

  // arrange
  run([{ name: 'reorder_layer', args: { nodeId: 'Blue star', to: 'back' } }]);
  it('reorder_layer sends it to the back of the one draw order', check(Object.values(P().rig.nodes).every((n) => n.id === star!.id || n.zIndex > P().rig.nodes[star!.id].zIndex)));
  run([{ name: 'duplicate_layer', args: { nodeId: 'Badge' } }]);
  it('duplicate_layer copies it', check(!!node('Badge copy')));
  run([{ name: 'remove_layer', args: { nodeId: 'Badge copy' } }]);
  it('remove_layer removes it', check(!node('Badge copy')));
  it('the body cannot be removed', check(validate(P(), { name: 'remove_layer', args: { nodeId: 'body' } }) !== null));
  run([{ name: 'set_layer_visibility', args: { nodeId: 'Badge', visible: false } }, { name: 'set_layer_lock', args: { nodeId: 'Badge', locked: true } }]);
  it('visibility and lock are set', check(node('Badge')!.visible === false && node('Badge')!.locked === true));

  // canvas
  run([{ name: 'set_composition', args: { preset: '1920x1080' } }]);
  it('set_composition resizes the canvas', check(compOf(P()).width === 1920 && compOf(P()).height === 1080));
  it('and refuses a silly size', check(validate(P(), { name: 'set_composition', args: { width: 10 } }) !== null));

  // one undo reverses a whole batch
  const layersBefore = Object.keys(P().rig.nodes).length;
  run([{ name: 'add_layer', args: { type: 'shape', shape: 'heart' } }, { name: 'add_layer', args: { type: 'group' } }]);
  ed().undo();
  it('one undo reverses a whole freeform batch', check(Object.keys(P().rig.nodes).length === layersBefore));
}

// --- states: current → target, never a chain -----------------------------------------
{
  ed().loadProject(defaultProject());
  run([{ name: 'add_timeline', args: { name: 'Happy' } }, { name: 'add_timeline', args: { name: 'Excited' } }, { name: 'add_timeline', args: { name: 'Angry' } }]);
  run([{ name: 'set_state', args: { state: 'Excited' } }]);
  it('set_state makes that state the current one', check(activeTimeline(P()).name === 'Excited'));
  const direct = run([{ name: 'set_transition', args: { to: 'Angry', durationMs: 400, easing: 'easeOut' } }]);
  const m = machineOf(P());
  const id = (n: string) => P().timelines.find((t) => t.name === n)!.id;
  it('"from whatever state I\'m in to angry" is one direct edge', check(!direct.length && m.transitions.length === 1
    && m.transitions[0].from === id('Excited') && m.transitions[0].to === id('Angry')));
  it('on the state input', check(m.transitions[0].conditions[0].input === STATE_INPUT && m.transitions[0].conditions[0].value === 'Angry'));
  run([{ name: 'set_transition', args: { to: 'Happy', from: 'any' } }]);
  it('from "any" is one direct edge from each state, no chains', check(machineOf(P()).transitions.filter((t) => t.to === id('Happy')).length === 3));
  it('already being there is refused', check(validate(P(), { name: 'set_transition', args: { to: 'Excited' } }) !== null));
}

// --- what the model can see ----------------------------------------------------------
{
  ed().loadProject(defaultProject());
  run([
    { name: 'add_layer', args: { type: 'shape', shape: 'star', name: 'Sticker', x: 0, y: -120 } },
    { name: 'set_layer_attachment', args: { nodeId: 'Sticker', mode: 'mascot' } },
    { name: 'set_layer_appearance_range', args: { nodeId: 'Sticker', startMs: 500, endMs: 1200 } },
    { name: 'add_layer', args: { type: 'hand', side: 'right' } },
  ]);
  const prompt = systemPrompt(P(), [], 750);
  it('the prompt says where the playhead is', check(prompt.includes('The playhead is at 750ms')));
  it('and the canvas size', check(prompt.includes('Canvas: 720×720')));
  it('and the current state and the others', check(/Current state: "Idle"/.test(prompt) && prompt.includes('States: "Idle"')));
  it('and each layer\'s attachment', check(/"Sticker" \(primitive, on the mascot's surface, yaw/.test(prompt), prompt.split('\n').find((l) => l.includes('Sticker'))));
  it('and its shape by name', check(/"Sticker".*shape star/.test(prompt)));
  it('and when it is on screen', check(/"Sticker".*on screen 500-1200ms/.test(prompt)));
  it('and a hand\'s two points', check(/"Right hand".*shoulder -?\d+,\d+ hand/.test(prompt)));
  it('in draw order, with their z', check(/z \d+\)/.test(prompt)));
  it('and every new property is in the reference, with its help', check(['opacity', 'stroke.width', 'limb.bend', 'limb.foot.angle'].every((k) => prompt.includes(`  ${k}`))));
  it('and near an exact pixel for the attached sticker', check(near(1, 1)));
  ed().loadProject(defaultProject());
}
