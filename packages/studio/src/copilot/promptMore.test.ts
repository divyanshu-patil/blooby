import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject } from '../core/defaults';
import { SAILORS_PROJECTS, sailorsProject } from '../core/sailorsPresets';
import { systemPrompt } from './prompt';

{
  // every shipped project, through the prompt: layer kinds, text, limbs, ranges, lanes, machines
  for (const spec of SAILORS_PROJECTS) {
    const prompt = systemPrompt(sailorsProject(spec), ['A', 'B'], 500);
    it(`${spec.name} reads as a prompt`, check(prompt.includes('Layers, back to front')));
  }
  it('the default project too', check(systemPrompt(defaultProject()).includes('Active timeline')));
}

// --- one project with everything the prompt knows how to describe ---------------------------------
{
  const { activeTimeline, ANY_STATE } = await import('../core/types');
  const { libraryOutline } = await import('../core/emitters');
  const { useEditor } = await import('../core/store');
  type P = ReturnType<typeof defaultProject>;
  const p: P = defaultProject();
  const root = p.rig.rootId;
  const tpl = p.rig.nodes[Object.keys(p.rig.nodes).find((k) => p.rig.nodes[k].eye)!];
  const add = (id: string, over: Record<string, unknown>) => {
    p.rig.nodes[id] = { ...structuredClone(tpl), id, name: id, eye: undefined, parentId: root, zIndex: Object.keys(p.rig.nodes).length, ...over } as never;
    return id;
  };
  const flat = (x: number, y: number) => ({ yaw: 0, pitch: 0, mapped: false, flatOffset: { x, y } });
  add('svg1', { kind: 'svgLayer', parentId: null, surface: flat(1, 2) });
  add('mapped1', { surface: { yaw: 10, pitch: 5, mapped: true } });
  add('flat1', { surface: flat(0, 0) });
  add('mate', { kind: 'body', parentId: root });
  add('ranged1', { ranged: true, visible: false, locked: true });
  add('shape1', { primitive: undefined, shapePath: libraryOutline('star'), shape: undefined });
  add('shape2', { shapePath: 'M 0 0 L 1 1' });
  add('txtArc', { text: { content: 'hi', size: 20, font: { family: 'Inter', weight: 700, style: 'italic' }, path: { mode: 'arc', reverse: true } } });
  add('txtArc2', { text: { content: 'yo', size: 20, font: { family: 'Inter', weight: 400, style: 'normal' }, path: { mode: 'arc', radius: 90 } } });
  add('txtAlong', { text: { content: 'on', size: 20, font: { family: 'Inter', weight: 400, style: 'normal' }, path: { mode: 'path', nodeId: 'shape2', offset: 4 } } });
  add('txtLost', { text: { content: 'lost', size: 20, font: { family: 'Inter', weight: 400, style: 'normal' }, path: { mode: 'path', nodeId: 'gone' } } });
  add('arm', { limb: { type: 'arm', a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 20, y: 20 }, hose: 1, length: 40, bend: 0, thickness: 8 } });
  add('arm2', { limb: { type: 'arm', a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, hose: 0, length: 40, bend: 0, thickness: 8 } });
  add('leg', { limb: { type: 'leg', a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 20, y: 20 }, hose: 1, length: 40, bend: 0, thickness: 8 } });
  p.expressions = [];

  const tl = activeTimeline(p);
  const blk = (id: string, over: Record<string, unknown>) => ({ id, presetId: '', name: id, durationMs: 400, ...over });
  tl.blocks = [blk('b1', { loop: true }), blk('b2', {}), blk('b3', { mascotId: 'mate' }), blk('b4', { mascotId: 'ghost' })] as never;
  tl.loop = true;
  tl.modifiers = [{ id: 'm1', nodeId: root, kind: 'shake', amount: 100, frequency: 1, amplitude: 1 }] as never;
  tl.emitters = [{ id: 'e1', name: 'zzz', glyphs: ['z'], path: 'arc' }] as never;
  tl.tracks = [
    { id: 't1', nodeId: root, property: 'transform.rotation', blockId: 'b1', keyframes: [{ id: 'k', time: 0, value: 0 }] },
    { id: 't2', nodeId: root, property: 'transform.rotation', blockId: 'zz', keyframes: [{ id: 'k', time: 0, value: 0 }] },
    ...Array.from({ length: 300 }, (_, i) => ({ id: `x${i}`, nodeId: root, property: 'transform.scale.x', keyframes: [{ id: 'k', time: i, value: 1 }, { id: 'k2', time: i + 1, value: 2 }] })),
  ] as never;
  p.timelines.push({ ...structuredClone(tl), id: 'other', name: 'Other' } as never);
  p.stateMachine = { inputs: [], transitions: [
    { id: 'a', from: ANY_STATE, to: tl.id, conditions: [], logic: 'OR' },
    { id: 'b', from: 'nowhere', to: 'other', conditions: [], logic: 'AND' },
  ] } as never;
  p.presets = [...p.presets, { id: 'cust', name: 'Mine', source: 'custom', durationMs: 500, tracks: [{ id: 'c1', nodeId: root, property: 'transform.rotation', keyframes: [{ id: 'k', time: 0, value: 1 }] }] } as never];
  useEditor.getState().loadProject(p);

  const ed = useEditor.getState();
  const open = ed.addCurve([{ x: 160, y: 500 }, { x: 360, y: 420 }, { x: 560, y: 500 }])!;
  ed.addCurve([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { closed: true, guide: true });
  const flatCurve = useEditor.getState().project.rig.nodes[open];
  flatCurve.surface = { ...flatCurve.surface, flatOffset: undefined };
  const prompt = systemPrompt(useEditor.getState().project, ['Made'], 0);
  it('the rich project is described', check(prompt.includes('hidden') && prompt.includes('locked') && prompt.includes('more tracks, not shown') && prompt.includes('Mine') && prompt.includes('ANY state')));
}
