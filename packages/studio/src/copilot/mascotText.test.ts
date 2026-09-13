import { it } from 'vitest';
import { check, near } from '../core/testkit';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { applyCalls, describe, normaliseCall, validateBatch, type ToolCall } from './tools';
import { systemPrompt } from './prompt';
import { sceneAt, valueAt } from '../core/scene';
import { compOf } from '../core/comp';
import { mascotOf } from '../core/mascot';
import { curveFromPath } from '../core/curve';
import { activeTimeline } from '../core/types';
import type { Project, RigNode } from '../core/types';

const ed = () => useEditor.getState();
const P = (): Project => ed().project;
const byName = (name: string) => Object.values(P().rig.nodes).find((n) => n.name === name);
const bodies = () => Object.values(P().rig.nodes).filter((n) => n.kind === 'body');
const partsOf = (m: RigNode) => Object.values(P().rig.nodes).filter((n) => n.id !== m.id && mascotOf(P().rig, n.id)?.id === m.id);
const item = (id: string, t = 0) => sceneAt(P(), t, compOf(P())).find((s) => s.id === id);
/** stage a turn the way the Copilot panel does: normalise, validate as a batch, apply */
const run = (calls: ToolCall[]) => {
  const staged = calls.map((c) => normaliseCall(P(), c));
  const problems = validateBatch(P(), staged).filter(Boolean);
  if (!problems.length) applyCalls(staged);
  return problems as string[];
};

ed().loadProject(defaultProject());
ed().setPlayhead(0);
const root = P().rig.nodes[P().rig.rootId];

// --- several mascots -------------------------------------------------------------------
{
  const made = run([{ name: 'add_mascot', args: { name: 'Pip' } }]);
  it('"add a second mascot" validates', check(!made.length, made.join(' | ')));
  const pip = byName('Pip')!;
  it('and makes a mascot with eyes of its own', check(!!pip && bodies().length === 2 && partsOf(pip).filter((n) => n.kind === 'eye').length === 2));
  it('beside the first, not on top of it', check(Math.abs((item(pip.id)?.cx ?? 0) - (item(root.id)?.cx ?? 0)) > 150));

  // "make the second mascot blink" — the clip lands in Pip's lane and moves Pip's eyes
  const blink = run([{ name: 'add_preset_to_timeline', args: { preset: 'Blink', mascot: 2 } }]);
  it('a preset on "mascot 2" validates', check(!blink.length, blink.join(' | ')));
  const tl = activeTimeline(P());
  const block = tl.blocks.find((b) => b.mascotId === pip.id);
  const owned = tl.tracks.filter((t) => t.blockId === block?.id);
  it('goes in that mascot\'s lane', check(!!block && block.presetId !== undefined));
  it('and animates that mascot, not the first', check(owned.length > 0 && owned.every((t) => mascotOf(P().rig, t.nodeId)?.id === pip.id), owned.map((t) => t.nodeId).join(', ')));

  run([{ name: 'rename_mascot', args: { mascot: 'Pip', name: 'Pippa' } }]);
  it('rename_mascot', check(pip.id === byName('Pippa')?.id));
  run([{ name: 'set_mascot_transform', args: { mascot: 'Pippa', scale: 1.4 } }]);
  it('set_mascot_transform scales it', check(valueAt(P(), pip.id, 'transform.scale.x', 0) === 1.4));
  run([{ name: 'set_mascot_shape', args: { mascot: 'Pippa', shape: 'octopus', atMs: 1500 } }]);
  const shapeKeys = activeTimeline(P()).tracks.filter((t) => t.nodeId === pip.id && t.property === 'shape.path').flatMap((t) => t.keyframes);
  it('set_mascot_shape with atMs is a morph: two keys', check(shapeKeys.length >= 2, String(shapeKeys.length)));

  const follow = run([{ name: 'set_mascot_parent', args: { mascot: 'Pippa', follows: 1 } }]);
  it('"Pippa follows mascot 1"', check(!follow.length && P().rig.nodes[pip.id].parentId === root.id, follow.join(' | ')));
  const loop = run([{ name: 'set_mascot_parent', args: { mascot: 1, follows: 'Pippa' } }]);
  it('and the loop back is refused', check(loop.length === 1 && /loop/.test(loop[0]), loop.join(' | ')));
  it('removing the first mascot is refused', check(run([{ name: 'remove_mascot', args: { mascot: 1 } }]).length === 1));

  run([{ name: 'duplicate_mascot', args: { mascot: 'Pippa' } }]);
  it('duplicate_mascot makes a third', check(bodies().length === 3));
}

// --- text --------------------------------------------------------------------------------
let textId = '';
{
  const made = run([{ name: 'add_text', args: { content: 'HELLO!', font: 'Poppins', weight: 700, size: 64, y: -260 } }]);
  it('add_text validates', check(!made.length, made.join(' | ')));
  const t = byName('HELLO!')!;
  textId = t?.id;
  it('a real text layer in the font asked for', check(!!t?.text && t.text.font.family === 'Poppins' && t.text.font.weight === 700 && t.text.size === 64));
  it('and it is on the stage', check(!!item(textId)));
  it('a text layer refuses tools for other layers', check(run([{ name: 'set_text', args: { nodeId: 'body', content: 'x' } }]).length === 1));

  run([
    { name: 'set_text', args: { nodeId: textId, content: 'HELLO!', atMs: 0 } },
    { name: 'set_text', args: { nodeId: textId, content: 'BYE', atMs: 1000 } },
  ]);
  it('set_text with atMs switches the words at the key', check(valueAt(P(), textId, 'text.content', 500) === 'HELLO!' && valueAt(P(), textId, 'text.content', 1200) === 'BYE'));

  run([{ name: 'set_text_curve', args: { nodeId: textId, mode: 'arc', amount: 0.3 } }]);
  const arc = P().rig.nodes[textId].text!.path!;
  it('"bend it 30%" is an arc a third of a circle wide', check(arc.mode === 'arc' && near((arc.end ?? 0) - (arc.start ?? 0), 120, 0.5) && (arc.radius ?? 0) > 0, JSON.stringify(arc)));
  run([{ name: 'set_text_curve', args: { nodeId: textId, mode: 'arc', underneath: true } }]);
  it('underneath makes it a smile', check(P().rig.nodes[textId].text!.path!.reverse === true));

  run([{ name: 'animate_text', args: { nodeId: textId, effect: 'typewriter', startMs: 0, durationMs: 800 } }]);
  it('typewriter reveals nothing at the start and every letter by the end',
    check(valueAt(P(), textId, 'text.reveal.end', 0) === 0 && valueAt(P(), textId, 'text.reveal.end', 800) === 6));
  run([{ name: 'animate_text', args: { nodeId: textId, effect: 'pop' } }]);
  it('pop brings the letters in one by one', check(P().rig.nodes[textId].text!.chars?.kind === 'pop'));
  run([{ name: 'set_text_stroke', args: { nodeId: textId, color: '#000000', width: 3 } }]);
  it('set_text_stroke outlines it', check(P().rig.nodes[textId].stroke?.enabled === true && P().rig.nodes[textId].stroke?.width === 3));
}

// --- curves, and text on them ---------------------------------------------------------------
{
  const made = run([{ name: 'add_curve', args: { points: [[-200, 100], [0, 0], [200, 100]], name: 'Wave', guide: true } }]);
  it('add_curve validates', check(!made.length, made.join(' | ')));
  const wave = byName('Wave')!;
  it('an open guide curve through the points', check(!!wave?.curve && wave.guide === true && curveFromPath(wave.shapePath)?.closed === false));
  const box = item(wave.id);
  it('centred where the points are', check(!!box && near(box.cx, compOf(P()).width / 2, 1) && near(box.cy, compOf(P()).height / 2 + 50, 1)));

  const on = run([{ name: 'set_text_path', args: { nodeId: textId, path: 'Wave', baseline: 10 } }]);
  const path = P().rig.nodes[textId].text!.path!;
  it('set_text_path puts the words on the curve', check(!on.length && path.mode === 'path' && path.nodeId === wave.id && path.baseline === 10, on.join(' | ')));
  run([
    { name: 'set_text_path_offset', args: { nodeId: textId, offset: 0, atMs: 0 } },
    { name: 'set_text_path_offset', args: { nodeId: textId, offset: 120, atMs: 1000 } },
  ]);
  const mid = valueAt(P(), textId, 'text.path.offset', 500) as number;
  it('and keyframed offsets make them travel', check(mid > 0 && mid < 120, String(mid)));

  // a path keyframe: the middle point rises, the curve (and the words on it) with it
  run([
    { name: 'move_curve_point', args: { nodeId: 'Wave', index: 1, x: 0, y: 0, atMs: 0 } },
    { name: 'move_curve_point', args: { nodeId: 'Wave', index: 1, x: 0, y: -80, atMs: 1000 } },
  ]);
  const yAt = (t: number) => curveFromPath(valueAt(P(), wave.id, 'shape.path', t) as string)!.points[1].y * wave.size.y + 50;
  it('move_curve_point with atMs keys the point there', check(near(yAt(0), 0, 1) && near(yAt(1000), -80, 1), `${yAt(0)} ${yAt(1000)}`));
  it('and the curve animates between', check(yAt(500) < -1 && yAt(500) > -79, String(yAt(500))));

  run([{ name: 'add_curve', args: { points: [[-100, 0], [0, -100], [100, 0]], name: 'Loop' } }]);
  const pts = () => curveFromPath(byName('Loop')!.shapePath)!;
  run([{ name: 'add_curve_point', args: { nodeId: 'Loop', x: 60, y: -60 } }]);
  it('add_curve_point joins the nearest segment', check(pts().points.length === 4));
  run([{ name: 'remove_curve_point', args: { nodeId: 'Loop', index: 0 } }]);
  it('remove_curve_point', check(pts().points.length === 3));
  it('but a curve keeps two', check(run([
    { name: 'remove_curve_point', args: { nodeId: 'Loop', index: 0 } },
    { name: 'remove_curve_point', args: { nodeId: 'Loop', index: 0 } },
  ]).length === 0 && pts().points.length === 2 && run([{ name: 'remove_curve_point', args: { nodeId: 'Loop', index: 0 } }]).length === 1));
  run([{ name: 'add_curve_point', args: { nodeId: 'Loop', x: 0, y: 80 } }, { name: 'close_curve', args: { nodeId: 'Loop', closed: true } }]);
  it('close_curve', check(pts().closed));
  const before = pts().points;
  run([{ name: 'reverse_curve', args: { nodeId: 'Loop' } }]);
  it('reverse_curve runs it the other way', check(near(pts().points[0].x, before[before.length - 1].x, 1e-3) && near(pts().points[0].y, before[before.length - 1].y, 1e-3)));
}

// --- hierarchy and order -------------------------------------------------------------------
{
  const loop = byName('Loop')!;
  const pippa = byName('Pippa')!;
  const was = item(loop.id)!;
  run([{ name: 'set_layer_parent', args: { nodeId: 'Loop', parent: 'Pippa' } }]);
  const now = item(loop.id)!;
  it('set_layer_parent hangs it on the mascot', check(P().rig.nodes[loop.id].parentId === pippa.id));
  it('keeping its place on screen', check(near(now.cx, was.cx, 1) && near(now.cy, was.cy, 1), `${was.cx},${was.cy} → ${now.cx},${now.cy}`));
  it('a mascot cannot ride a curve', check(run([{ name: 'set_layer_parent', args: { nodeId: 'Pippa', parent: 'Wave' } }]).length === 1));

  run([{ name: 'set_layer_order', args: { nodeId: 'Wave', below: 1 } }]);
  const z = (n: RigNode) => P().rig.nodes[n.id].zIndex;
  const rootParts = [root, ...partsOf(root)];
  it('"behind mascot 1" is behind all of it', check(rootParts.every((n) => z(byName('Wave')!) < z(n))));
  run([{ name: 'set_layer_order', args: { nodeId: 'Pippa', to: 'front' } }]);
  const others = Object.values(P().rig.nodes).filter((n) => n.id !== pippa.id && mascotOf(P().rig, n.id)?.id !== pippa.id && !(n.parentId === pippa.id));
  const pippaZ = Math.min(z(pippa), ...partsOf(pippa).map(z));
  it('a mascot to the front goes as one, parts and all', check(others.every((n) => z(n) < pippaZ)));

  run([{ name: 'remove_mascot', args: { mascot: 'Pippa' } }]);
  it('remove_mascot takes its parts and its lane', check(!P().rig.nodes[pippa.id] && !activeTimeline(P()).blocks.some((b) => b.mascotId === pippa.id)));
  it('and leaves what hung on it in the world', check(P().rig.nodes[loop.id]?.parentId === null));
}

// --- the prompt knows about all of it --------------------------------------------------------
{
  const prompt = systemPrompt(P());
  // Pippa is gone; the first mascot and Pippa's duplicate are left
  it('the prompt lists the mascots', check(/Mascots \(2\)/.test(prompt) && prompt.includes('Mascot 1')));
  // the words at rest; the switch to BYE is a keyframe, listed with the others
  it('and the text, with its words and font', check(/"HELLO!" \(text, .*says "HELLO!" in Poppins 700 64px, along "Wave"/.test(prompt), prompt.split('\n').find((l) => l.includes(textId))));
  it('and the curves, with their points', check(/Wave/.test(prompt) && /points/.test(prompt)));
  it('new tools describe themselves in words', check(describe(P(), { name: 'add_text', args: { content: 'Hi' } }).includes('Hi')));
}
