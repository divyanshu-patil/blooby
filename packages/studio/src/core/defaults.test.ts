import { it } from 'vitest';
import { check } from './testkit';
import { builtinPresets, defaultProject } from './defaults';
import { type ToolCall } from '../copilot/tools';
import { closes, critique } from '../copilot/critique';

// --- the built-in presets, held to the same rules the copilot is -----------------
{
  const presets = builtinPresets();

  // every clip must end on the pose it opened with, or it cannot loop and cannot be
  // followed. Checked structurally across all of them rather than by eye.
  const drifting: string[] = [];
  for (const p of presets) {
    for (const t of p.tracks) {
      const a = t.keyframes[0]?.value, b = t.keyframes[t.keyframes.length - 1]?.value;
      if (a === undefined || b === undefined) continue;
      // angles compare modulo 360, so Spin ending on 360 is the pose it opened on
      const same = typeof a === 'number' && typeof b === 'number'
        ? closes(t.property, a, b)
        : JSON.stringify(a) === JSON.stringify(b);
      if (!same) drifting.push(`${p.name}.${t.nodeId}.${t.property}`);
    }
  }
  it('every builtin returns to the pose it opened on', check(drifting.length === 0, drifting.join(', ')));

  // and the copilot's own critic must approve them. If it does not, one of the two is
  // wrong — a critic that rejects the hand-authored work is not a usable critic.
  const proj = defaultProject();
  const complaints: string[] = [];
  for (const p of presets) {
    if (!p.tracks.length) continue;
    const calls: ToolCall[] = [{ name: 'create_preset', args: { name: p.name, durationMs: p.durationMs, tracks: p.tracks.map((t) => ({
      nodeId: t.nodeId, property: t.property, keyframes: t.keyframes.map((k) => ({ time: k.time, value: k.value })),
    })) } }];
    for (const c of critique(proj, calls, '')) complaints.push(`${p.name}: ${c}`);
  }
  it('the critic approves every hand-authored builtin', check(complaints.length === 0, complaints.join('\n    ')));

  // the renamed one, and the new one that took its place
  it('Notify was renamed to Decline', check(presets.some((p) => p.id === 'p_decline' && p.name === 'Decline')));
  it('and the new Notify announces rather than refuses', check(presets.find((p) => p.id === 'p_notify')?.emitters?.length === 1
      && !presets.find((p) => p.id === 'p_notify')!.tracks.some((t) => t.property === 'surface.yaw')));
}

// --- attaching presets: no rig, other parents, missing things ---------------------------------------
import { addPresetLayers, appendPreset, attachPresetEffects, effectPreviewProject, makeTimeline, presetPreviewProject } from './defaults';
import { makeLimb, makeShapeLayer } from './layers';
import type { Preset } from './types';
{
  const p = defaultProject();
  const bare = (over: Record<string, unknown> = {}) => ({ id: 'px', name: 'px', durationMs: 1000, tracks: [], ...over }) as unknown as Preset;

  // without a rig the ids stay as written, and a pinned anchor keeps its node
  const tl = makeTimeline('t');
  attachPresetEffects(tl, bare({
    modifiers: [{ id: 'm', nodeId: 'body', kind: 'float' }],
    emitters: [{ id: 'e', from: { nodeId: 'eyeL', x: 0, y: 0 }, to: { x: 5, y: 5 } }],
  }), 'blk');
  it('with no rig a preset\'s modifiers and emitters go in as written', check(tl.modifiers[0].nodeId === 'body' && tl.emitters![0].from.nodeId === 'eyeL' && tl.emitters![0].to.nodeId === undefined));

  // looks on a layer that is not there, a layer whose parent is not there, an arm not on the body
  const rig = structuredClone(p.rig);
  const arm = makeLimb('arm', 1, 'body', { id: 'armX' });
  const handOnFace = makeLimb('arm', -1, 'face', { id: 'armY' });
  const orphan = makeShapeLayer('rect', { id: 'orphan', parentId: 'ghost' } as never);
  addPresetLayers(rig, bare({ looks: [{ nodeId: 'nope', effects: ['glow'] }], layers: [arm, handOnFace, orphan] }));
  it('a look on a missing layer is skipped; an arm goes on the face; an orphan falls back to the body', check(
    !!rig.nodes.armX && rig.nodes.armY.parentId === 'face' && rig.nodes.armX.parentId !== 'body' && rig.nodes.orphan.parentId === rig.rootId,
  ));

  // previews
  const lost = { ...p, activeTimelineId: 'gone' };
  it('a preview with a lost active timeline uses the first', check(presetPreviewProject(lost, bare()).activeTimelineId === lost.timelines[0].id));
  const noAppearances = { ...p, timelines: [{ ...p.timelines[0], appearances: undefined }] };
  const eff = effectPreviewProject(noAppearances, { emitter: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } as never });
  it('an effect preview with only an emitter, on a state with no ranges', check(eff.timelines[0].emitters!.length === 1 && eff.timelines[0].modifiers.length === 0));
  // a state's own timeline-wide range survives a preview unless the preset ranges the same node
  const own = { ...p, timelines: [{ ...p.timelines[0], appearances: [{ id: 'a', nodeId: 'x', startMs: 0, endMs: 1 }, { id: 'b', nodeId: 'y', startMs: 0, endMs: 1 }] }] } as never as typeof p;
  const kept = presetPreviewProject(own, bare({ appearances: [{ id: 'z', nodeId: 'y', startMs: 0, endMs: 1 }] as never })).timelines[0].appearances!;
  it('a preview keeps the state\'s own ranges except those the preset replaces', check(kept.length === 2 && kept[0].nodeId === 'x' && kept[1].id === 'pa0'));
  const before = p.timelines[0].blocks.length;
  appendPreset(p, 'no-such-preset');
  it('an unknown preset appends nothing', check(p.timelines[0].blocks.length === before));
}
{
  // a hand on a body with no face stays on the body; a free anchor goes to the mascot the preset lands on
  const p = defaultProject();
  const faceless = structuredClone(p.rig);
  for (const [id, n] of Object.entries(faceless.nodes)) if (n.role === 'face' || id === 'face') delete faceless.nodes[id];
  for (const n of Object.values(faceless.nodes)) if (n.parentId === 'face') n.parentId = 'body';
  const arm = makeLimb('arm', 1, 'body', { id: 'armZ' });
  addPresetLayers(faceless, { id: 'q', name: 'q', durationMs: 1, tracks: [], layers: [arm] } as unknown as Preset);
  it('a hand stays on the body when there is no face to put it on', check(faceless.nodes.armZ.parentId === 'body'));

  const two = structuredClone(p.rig);
  const m2 = makeMascot('cute', { name: 'Two', id: 'm2' });
  for (const n of m2) two.nodes[n.id] = n;
  const tl = makeTimeline('t');
  attachPresetEffects(tl, { id: 'q', name: 'q', durationMs: 1, tracks: [], emitters: [{ id: 'e', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] } as unknown as Preset, 'b', two, 'm2');
  it('a free anchor is measured from the mascot the preset was placed on', check(tl.emitters![0].from.nodeId === 'm2' && tl.emitters![0].to.nodeId === 'm2'));
}
import { makeMascot } from './mascot';
