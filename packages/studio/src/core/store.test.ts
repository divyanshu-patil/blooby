import { it } from 'vitest';
import { check } from './testkit';
import { activeTrackFor, buildScene, emitterItems, evaluateRig, sampleTrack, sceneAt, valueAt } from './scene';
import { builtinPresets, defaultProject, makeTimeline, presetPreviewProject } from './defaults';
import { blockStarts } from './timeline';
import { useEditor, writeKeyframe } from './store';
import { readProp } from './props';
import { applyCalls, describe, validate, type ToolCall } from '../copilot/tools';
import { activeTimeline } from './types';
import type { Preset, Project } from './types';

// --- writeKeyframe anchors a brand-new track instead of going constant ---------
{
  const p = defaultProject();
  const ptl = activeTimeline(p);
  // pick a property with no existing track, matching a copilot add_keyframe / applyExpression call
  it('no pre-existing track on eyeL rotation', check(!ptl.tracks.some((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation')));
  const before = readProp(p.rig, 'eyeL', 'transform.rotation');
  writeKeyframe(p, 'eyeL', 'transform.rotation', 2000, 25, { type: 'linear' });
  const track = ptl.tracks.find((t) => t.nodeId === 'eyeL' && t.property === 'transform.rotation')!;
  it('an anchor keyframe was seeded at t=0', check(track.keyframes.length === 2 && track.keyframes[0].time === 0));
  it('the anchor holds the PREVIOUS value, not the new one', check(track.keyframes[0].value === before, `${track.keyframes[0].value} vs ${before}`));
  it('t=0 still reads as unchanged after the write', check(sampleTrack(track, 0) === before));
  it('the target time reads the new value', check(sampleTrack(track, 2000) === 25));
  it('halfway there interpolates, does not jump', check((sampleTrack(track, 1000) as number) > (before as number) && (sampleTrack(track, 1000) as number) < 25));
  // writing again on the SAME (now-existing) track must not re-anchor a second time —
  // stays inside Idle's own window (0–2400ms), the block this track just got scoped to;
  // a write outside it would correctly become a *different* clip's own track instead.
  writeKeyframe(p, 'eyeL', 'transform.rotation', 2200, 40, { type: 'linear' });
  it('a second write on an existing track adds one keyframe, not another anchor', check(track.keyframes.length === 3));
}

// --- duplicateBlock: an independent instance, inserted right after the original --------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const idle = PT().blocks[0];
  const trackCountBefore = PT().tracks.filter((t) => t.blockId === idle.id).length;
  const blockCountBefore = PT().blocks.length;

  useEditor.getState().duplicateBlock(idle.id);
  it('duplicate inserts a new block right after the original', check(PT().blocks.length === blockCountBefore + 1
      && PT().blocks[1].presetId === idle.presetId && PT().blocks[1].id !== idle.id));

  const dup = PT().blocks[1];
  it('duplicate gets its own copy of the tracks, not shared references', check(PT().tracks.filter((t) => t.blockId === dup.id).length === trackCountBefore
      && PT().tracks.filter((t) => t.blockId === dup.id).every((t) => !PT().tracks.some((o) => o.blockId === idle.id && o.id === t.id))));

  it('the duplicate is selected for editing', check(useEditor.getState().selectedBlockId === dup.id));

  // editing a property inside the duplicate's own window must never touch the original's
  // corresponding track — they're independent instances, not a shared reference
  const idleTrack = PT().tracks.find((t) => t.blockId === idle.id)!;
  const idleFirstKfBefore = JSON.stringify(idleTrack.keyframes[0]);
  const dupWindowMidpoint = idle.durationMs + idle.durationMs / 2; // dup sits right after idle
  useEditor.getState().setPlayhead(dupWindowMidpoint);
  useEditor.getState().setValue(idleTrack.nodeId, idleTrack.property, 999, 'test');
  it('editing the duplicate\'s track does not mutate the original clip\'s keyframes', check(JSON.stringify(PT().tracks.find((t) => t.id === idleTrack.id)!.keyframes[0]) === idleFirstKfBefore));
  it('the edit actually landed on the duplicate\'s own track', check(PT().tracks.find((t) => t.blockId === dup.id && t.nodeId === idleTrack.nodeId && t.property === idleTrack.property)!
        .keyframes.some((k) => k.value === 999)));
  useEditor.getState().undo();

  const blocksEndAfter = PT().blocks.reduce((s, b) => s + b.durationMs, 0);
  it('duplicating extends the sequence by exactly the original\'s duration', check(blocksEndAfter === PT().blocks.filter((b) => b.id !== dup.id).reduce((s, b) => s + b.durationMs, 0) + idle.durationMs));
}

// --- addClipFrom: "another timeline" and gallery animations as a clip source -----------
{
  useEditor.getState().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const blocksBefore = PT().blocks.length;

  // a same-project source timeline — every track is trivially rig-compatible
  const source = makeTimeline('Wave');
  source.tracks = [{ id: 'wt', nodeId: 'body', property: 'transform.rotation', keyframes: [{ id: 'wk1', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'wk2', time: 500, value: 20, easingOut: { type: 'linear' } }] }];
  source.timelineDurationMs = 500;
  useEditor.getState().addClipFrom({ label: 'Wave', timeline: source });
  it('addClipFrom appends a new clip built from another timeline\'s tracks', check(PT().blocks.length === blocksBefore + 1 && PT().blocks.at(-1)!.name === 'Wave'
      && PT().tracks.some((t) => t.blockId === PT().blocks.at(-1)!.id && t.nodeId === 'body' && t.property === 'transform.rotation')));
  it('the new clip is selected', check(useEditor.getState().selectedBlockId === PT().blocks.at(-1)!.id));

  // a "gallery" timeline whose rig doesn't fully match this one — one track on a real
  // node (body), one on a node this rig has no idea about (a custom layer from some
  // other mascot). Only the compatible one should ever make it into the sequence.
  const incompatible = makeTimeline('Foreign');
  incompatible.tracks = [
    { id: 'ft1', nodeId: 'body', property: 'surface.yaw', keyframes: [{ id: 'fk1', time: 0, value: 10, easingOut: { type: 'linear' } }] },
    { id: 'ft2', nodeId: 'tentacle_9', property: 'transform.rotation', keyframes: [{ id: 'fk2', time: 0, value: 5, easingOut: { type: 'linear' } }] },
  ];
  incompatible.timelineDurationMs = 300;
  const blocksBefore2 = PT().blocks.length;
  useEditor.getState().addClipFrom({
    label: 'Foreign', timeline: incompatible,
    gallerySource: { galleryId: 'g1', galleryName: 'Some Other Mascot', timelineId: incompatible.id, timelineName: 'Foreign' },
  });
  const added = PT().blocks.at(-1)!;
  it('a rig-incompatible track is silently skipped, not copied in', check(PT().blocks.length === blocksBefore2 + 1
      && !PT().tracks.some((t) => t.blockId === added.id && t.nodeId === 'tentacle_9')));
  it('a rig-compatible track from the same source still comes along', check(PT().tracks.some((t) => t.blockId === added.id && t.nodeId === 'body' && t.property === 'surface.yaw')));
  it('the clip remembers it came from a gallery item, for the inspector\'s source label', check(added.gallerySource?.galleryName === 'Some Other Mascot'));

  // a *multi-block* source timeline (any real saved project — defaultProject()'s own
  // active timeline has 4) contributes several tracks for the same property, one per its
  // own sub-block. Brought in as one clip, this used to "deform the mascot": every copied
  // track shared the new clip's single blockId, so activeTrackFor couldn't tell them
  // apart and just picked whichever sub-block's track came first, for the clip's entire
  // span. mergeTracksForClip combines same-property tracks into one before copying.
  const sourceProj = defaultProject();
  const sourceTl = activeTimeline(sourceProj);
  useEditor.getState().loadProject(defaultProject());
  useEditor.getState().addClipFrom({
    label: 'Idle (imported)', timeline: sourceTl,
    gallerySource: { galleryId: 'g2', galleryName: 'Other', timelineId: sourceTl.id, timelineName: 'Idle' },
  });
  const importedTl = activeTimeline(useEditor.getState().project);
  const imported = importedTl.blocks.at(-1)!;
  const importedStart = blockStarts(importedTl).at(-1)!;
  it('a multi-block source becomes exactly one new clip, not several', check(imported.durationMs === sourceTl.timelineDurationMs
      && importedTl.tracks.filter((t) => t.blockId === imported.id && t.nodeId === 'eyeL' && t.property === 'eye.openness').length === 1));
  let worstDiff = 0;
  for (const rel of [100, 500, 1200, 1790, 1880, 2400, 2800, 3220, 3600, 4200, 4900, 5200, 5900, 6299]) {
    const got = evaluateRig(useEditor.getState().project, importedStart + rel).nodes.eyeL.eye!.openness;
    const want = evaluateRig(sourceProj, rel).nodes.eyeL.eye!.openness;
    worstDiff = Math.max(worstDiff, Math.abs(got - want));
  }
  it('the imported clip reproduces the source\'s full animation exactly, no cross-block bleed', check(worstDiff < 1e-6, `worst diff ${worstDiff}`));
}

// --- moveBlock: reordering drags its keyframes along, in one undo step ---------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const names = () => PT().blocks.map((b) => b.name);
  it('default order', check(names().join(',') === 'Idle,Blink,Talk,Happy', names().join(',')));

  const blinkId = PT().blocks[1].id;
  const blinkTrackBefore = PT().tracks.find((t) => t.blockId === blinkId)!;
  const blinkKeysBefore = blinkTrackBefore.keyframes.map((k) => k.value);

  useEditor.getState().moveBlock(blinkId, 3); // drag Blink to the very end
  it('block moved to the end', check(names().join(',') === 'Idle,Talk,Happy,Blink', names().join(',')));
  const blinkTrackAfter = PT().tracks.find((t) => t.id === blinkTrackBefore.id)!;
  it('its keyframe VALUES are untouched by the move', check(JSON.stringify(blinkTrackAfter.keyframes.map((k) => k.value)) === JSON.stringify(blinkKeysBefore)));
  it('its keyframe TIMES shifted to its new slot', check(blinkTrackAfter.keyframes[0].time > blinkTrackBefore.keyframes[0].time));
  const starts = blockStarts(PT());
  it('blocks are contiguous with no gap after reordering', check(starts.every((s, i) => i === 0 || s === starts[i - 1] + PT().blocks[i - 1].durationMs)));

  useEditor.getState().undo();
  it('undo restores the original order', check(names().join(',') === 'Idle,Blink,Talk,Happy', names().join(',')));
}

// --- the store: block retiming, undo, tool calls -------------------------------
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const PT = () => activeTimeline(P());
  const blockTracks = (id: string) => PT().tracks.filter((t) => t.blockId === id);
  const span = (id: string) => {
    const times = blockTracks(id).flatMap((t) => t.keyframes.map((k) => k.time));
    return [Math.min(...times), Math.max(...times)];
  };

  it('default file has four blocks', check(PT().blocks.length === 4));
  const [b0, b1] = PT().blocks;
  it('first block starts at zero', check(span(b0.id)[0] === 0));
  it('second block starts where the first ends', check(Math.abs(span(b1.id)[0] - b0.durationMs) < 1));

  // stretching a block must drag everything after it along
  const beforeStart = span(b1.id)[0];
  useEditor.getState().setBlockDuration(b0.id, b0.durationMs * 2);
  it('stretching a block scales its own keys', check(Math.abs(span(b0.id)[1] - b0.durationMs * 2) < 12, `${span(b0.id)[1]} vs ${b0.durationMs * 2}`));
  it('stretching a block shifts the next one', check(Math.abs(span(b1.id)[0] - beforeStart * 2) < 12, `${span(b1.id)[0]} vs ${beforeStart * 2}`));
  it('duration follows the blocks', check(PT().timelineDurationMs >= PT().blocks.reduce((a, b) => a + b.durationMs, 0)));

  useEditor.getState().undo();
  it('undo restores the original duration', check(PT().blocks[0].durationMs === b0.durationMs));
  useEditor.getState().redo();
  it('redo reapplies it', check(PT().blocks[0].durationMs === b0.durationMs * 2));
  useEditor.getState().undo();

  const trackCount = PT().tracks.length;
  useEditor.getState().removeBlock(b0.id);
  it('removing a block drops its tracks', check(PT().tracks.length < trackCount && blockTracks(b0.id).length === 0));
  it('and closes the gap', check(span(PT().blocks[0].id)[0] === 0));
  useEditor.getState().undo();
  it('undo brings the block back', check(PT().blocks.length === 4 && PT().tracks.length === trackCount));

  // toggling a track off must not move the pose
  useEditor.getState().setPlayhead(1200);
  const yawBefore = valueAt(P(), 'body', 'surface.yaw', 1200) as number;
  useEditor.getState().toggleTrack('body', 'surface.yaw');
  it('un-animating bakes the current value', check(Math.abs((valueAt(P(), 'body', 'surface.yaw', 1200) as number) - yawBefore) < 1e-6, `${valueAt(P(), 'body', 'surface.yaw', 1200)} vs ${yawBefore}`));
  useEditor.getState().undo();

  // a clip is a sealed instance: a property toggled/edited while scrubbed into one clip
  // must stay that clip's own override, never leak into a different (especially a brand
  // new, blank) clip that doesn't animate the property itself.
  useEditor.getState().setPlayhead(500); // inside Idle (0–2400ms)
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 33, 'rot');
  it('an edit made inside one clip applies there', check(evaluateRig(P(), 500).nodes.body.transform.rotation === 33));
  useEditor.getState().addBlock('p_neutral'); // the blank builtin preset — appends at the end
  const neutral = PT().blocks.at(-1)!;
  const neutralMid = blockStarts(PT()).at(-1)! + neutral.durationMs / 2;
  it('a brand-new blank clip shows the rig\'s own rest pose, not another clip\'s edit', check(evaluateRig(P(), neutralMid).nodes.body.transform.rotation === 0, `${evaluateRig(P(), neutralMid).nodes.body.transform.rotation}`));
  useEditor.getState().undo();
  useEditor.getState().undo();
  useEditor.getState().undo();

  // expressions and morphs — both ends land inside Talk's window (3300–4900ms), so this
  // exercises "one clip's own track gets both keyframes" rather than the cross-clip case
  // covered separately below.
  useEditor.getState().morphBetween('x_neutral', 'x_surprised', 3400, 400, { type: 'preset', name: 'easeInOut' });
  const scaleTrack = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3400);
  it('morph wrote both ends', check(!!scaleTrack
      && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3400) < 1)
      && scaleTrack.keyframes.some((k) => Math.abs(k.time - 3800) < 1)));
  it('morph skips properties that match', check(!PT().tracks.some((t) => t.nodeId === 'body' && t.property === 'surface.pitch'
      && t.keyframes.some((k) => Math.abs(k.time - 3400) < 1))));
  useEditor.getState().undo();

  // a morph spanning a clip boundary writes into *each* clip's own track — a clip is a
  // sealed instance, so one keyframe can't reach across into a different clip's track.
  useEditor.getState().morphBetween('x_neutral', 'x_surprised', 3000, 400, { type: 'preset', name: 'easeInOut' }); // 3000 in Blink, 3400 in Talk
  const blinkScale = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3000);
  const talkScale = activeTrackFor(PT(), 'eyeL', 'transform.scale.x', 3400);
  it('a morph across a clip boundary lands in two independent clip-scoped tracks', check(!!blinkScale && !!talkScale && blinkScale.id !== talkScale.id
      && blinkScale.keyframes.some((k) => Math.abs(k.time - 3000) < 1)
      && talkScale.keyframes.some((k) => Math.abs(k.time - 3400) < 1)));
  useEditor.getState().undo();

  // duration: can extend past content (a trailing hold), shrinking clamps keyframes onto
  // the new end instead of dropping them, and it can never shrink below the tiled blocks.
  const blocksLen = PT().blocks.reduce((s, b) => s + b.durationMs, 0);
  useEditor.getState().setTimelineDuration(blocksLen + 5000);
  it('duration can extend past the blocks', check(Math.abs(PT().timelineDurationMs - (blocksLen + 5000)) < 1));
  useEditor.getState().setTimelineDuration(1); // coalesces with the extend above — one edit
  // the floor is blocksLen OR later (a block's own final keyframe can sit right at its
  // block's end, which the pre-existing lastKeyframe+200 padding then pushes past it) —
  // the invariant setTimelineDuration actually owns is just "never *below* the blocks".
  it('duration cannot shrink below the tiled blocks', check(PT().timelineDurationMs >= blocksLen - 1, `${PT().timelineDurationMs} vs ${blocksLen}`));
  useEditor.getState().undo();

  // a free (blockless) keyframe out past the blocks — the only kind shrinking can reach,
  // since every block-owned keyframe already lives inside its own block's window.
  useEditor.getState().commit((p) => { writeKeyframe(p, 'body', 'transform.rotation', blocksLen + 3000, 40, { type: 'linear' }); });
  useEditor.getState().setTimelineDuration(blocksLen + 500);
  it('shrinking clamps an out-of-range keyframe onto the new end instead of dropping it', check(PT().tracks.find((t) => t.nodeId === 'body' && t.property === 'transform.rotation')!
        .keyframes.some((k) => Math.abs(k.time - (blocksLen + 500)) < 1)));
  useEditor.getState().undo();
  useEditor.getState().undo();

  // --- state machine: setState/enableState, scheduling, blending, previous-state -------
  // defaultProject() ships one timeline ("Idle") with the four presets as its own blocks —
  // states are a *project's timelines*, so this needs a few more of those to test against.
  {
    useEditor.getState().loadProject(defaultProject());
    const P = () => useEditor.getState().project;
    const idleId = P().activeTimelineId;
    useEditor.getState().addTimeline('Blink state');
    useEditor.getState().addTimeline('Happy state');
    useEditor.getState().addTimeline('Talk state');
    useEditor.getState().setActiveTimeline(idleId); // addTimeline switches to each as it's made
    const blinkTl = P().timelines.find((t) => t.name === 'Blink state')!;
    const happyTl = P().timelines.find((t) => t.name === 'Happy state')!;
    const talkTl = P().timelines.find((t) => t.name === 'Talk state')!;

    useEditor.getState().setState('blink state'); // name match is case-insensitive
    it('setState switches the active timeline by name, case-insensitively', check(P().activeTimelineId === blinkTl.id));
    it('setState resets the playhead for the new state', check(useEditor.getState().playhead === 0));
    it('setState records what was active before it', check(useEditor.getState().previousTimelineId === idleId));
    it('setState morphs by default — no opts still sets up a blend to preview, not an instant cut', check(useEditor.getState().stateTransition !== null && useEditor.getState().stateTransition!.durationMs > 0));
    useEditor.getState().clearStateTransition();

    useEditor.getState().returnToPreviousState({ duration: 0 });
    it('returnToPreviousState switches back', check(P().activeTimelineId === idleId));
    it('{ duration: 0 } opts out of the morph for an instant cut', check(useEditor.getState().stateTransition === null));

    useEditor.getState().setState(happyTl.id, { duration: 250, easing: { type: 'linear' } });
    it('an explicit duration overrides the default', check(useEditor.getState().stateTransition?.durationMs === 250));
    useEditor.getState().clearStateTransition();

    useEditor.getState().setPlayhead(0);
    useEditor.getState().setState(talkTl.id, { at: 5000 });
    it('setState with a future "at" schedules instead of switching immediately', check(P().activeTimelineId === happyTl.id && useEditor.getState().pendingStateChange?.timelineId === talkTl.id));
    useEditor.getState().cancelScheduledState();
    it('cancelScheduledState clears the pending switch', check(useEditor.getState().pendingStateChange === null));

    useEditor.getState().setState('does-not-exist');
    it('setState silently ignores an unknown name/id rather than clearing the active state', check(P().activeTimelineId === happyTl.id));

    // land back on Idle — the copilot section right after this shares this scope's PT()
    useEditor.getState().setActiveTimeline(idleId);
  }

  // copilot tool calls: validated, then applied as one undo step
  const calls: ToolCall[] = [
    { name: 'add_preset_to_timeline', args: { preset: 'Blink' } },
    { name: 'set_eye_params', args: { nodeId: 'eyeL', openness: 0.3, atMs: 500 } },
    { name: 'add_modifier', args: { nodeId: 'body', kind: 'float', amount: 80, frequency: 0.5, amplitude: 6 } },
  ];
  it('valid calls pass validation', check(calls.every((c) => validate(P(), c) === null), calls.map((c) => validate(P(), c)).join('|')));
  it('a bad layer is rejected', check(validate(P(), { name: 'set_eye_params', args: { nodeId: 'nope' } }) !== null));
  it('a bad property is rejected', check(validate(P(), { name: 'set_property', args: { nodeId: 'body', property: 'hack', value: 1 } }) !== null));
  it('an unknown tool is rejected', check(validate(P(), { name: 'rm_rf', args: {} }) !== null));
  it('calls describe themselves', check(describe(P(), calls[0]).includes('Blink')));

  const blocksBefore = PT().blocks.length;
  applyCalls(calls);
  it('tool calls applied', check(PT().blocks.length === blocksBefore + 1
      && PT().modifiers.length === 1
      && (valueAt(P(), 'eyeL', 'eye.openness', 500) as number) === 0.3));
  useEditor.getState().undo();
  it('one undo reverses the whole batch', check(PT().blocks.length === blocksBefore && PT().modifiers.length === 0));
}

// --- multiple timelines: isolated tracks, correct active-timeline redirection --
{
  const ed = useEditor.getState();
  ed.loadProject(defaultProject());
  const P = () => useEditor.getState().project;

  const firstId = P().activeTimelineId;
  ed.addTimeline('Wave');
  it('a new timeline is created and becomes active', check(P().timelines.length === 2 && P().activeTimelineId !== firstId));
  it('the new timeline starts with no blocks — a genuinely fresh sequence', check(activeTimeline(P()).blocks.length === 0));

  // work done on the new (active) timeline must not leak into the first
  ed.toggleTrack('body', 'surface.yaw'); // stopwatch-on: bakes a track at the current value
  ed.setValue('body', 'surface.yaw', 33, 'wavetest');
  it('a track landed on the SECOND timeline', check(activeTimeline(P()).tracks.some((t) => t.property === 'surface.yaw' && t.nodeId === 'body')));
  // the first (Idle) timeline already has its own surface.yaw track from the Idle
  // preset — the isolation check is that it never picks up the value written on
  // the second timeline, not that the property is absent there entirely.
  const firstTl = P().timelines.find((t) => t.id === firstId)!;
  it('the first timeline is untouched', check(!firstTl.tracks.some((t) => t.property === 'surface.yaw' && t.nodeId === 'body' && t.keyframes.some((k) => k.value === 33))));

  ed.setActiveTimeline(firstId);
  it('switching back restores the first timeline\'s own content', check(activeTimeline(P()).id === firstId && activeTimeline(P()).blocks.length === 4));

  ed.renameTimeline(P().activeTimelineId, 'Idle loop');
  it('rename applies to the right timeline', check(P().timelines.find((t) => t.id === firstId)!.name === 'Idle loop'));

  const secondId = P().timelines.find((t) => t.id !== firstId)!.id;
  ed.deleteTimeline(secondId);
  it('delete removes it and falls back to a survivor', check(P().timelines.length === 1 && !P().timelines.some((t) => t.id === secondId)));
  ed.deleteTimeline(firstId);
  it('the last timeline cannot be deleted — always at least one', check(P().timelines.length === 1));
}

// --- migrate(): a project saved before Stage 3 still loads correctly -----------
{
  const legacy = defaultProject();
  const flat = legacy as unknown as Record<string, unknown>;
  const tl = activeTimeline(legacy);
  flat.tracks = tl.tracks; flat.blocks = tl.blocks; flat.modifiers = tl.modifiers;
  flat.durationMode = tl.durationMode; flat.timelineDurationMs = tl.timelineDurationMs; flat.loop = true;
  delete flat.timelines; delete flat.activeTimelineId;

  useEditor.getState().loadProject(legacy as unknown as Project);
  const p = useEditor.getState().project;
  it('a legacy flat project is lifted into exactly one timeline', check(p.timelines.length === 1));
  it('its blocks made it across', check(activeTimeline(p).blocks.length === 4));
  it('its loop flag made it across', check(activeTimeline(p).loop === true));
  useEditor.getState().loadProject(defaultProject());
}

// --- unique naming: captured poses and timelines auto-suffix on a name collision -------
{
  useEditor.getState().loadProject(defaultProject());
  const beforeCount = useEditor.getState().project.expressions.length;
  useEditor.getState().captureExpression('Neutral'); // 'Neutral' is already a builtin expression
  const names = useEditor.getState().project.expressions.map((e) => e.name);
  it('capturing a duplicate name gets a numeric suffix instead of colliding', check(names.filter((n) => n === 'Neutral').length === 1 && names.includes('Neutral 2'), names.join(', ')));
  it('exactly one new expression was added', check(useEditor.getState().project.expressions.length === beforeCount + 1));

  useEditor.getState().addTimeline('Idle'); // 'Idle' is already the default timeline's name
  const tlNames = useEditor.getState().project.timelines.map((t) => t.name);
  it('adding a timeline with a taken name gets a numeric suffix', check(tlNames.includes('Idle 2'), tlNames.join(', ')));

  useEditor.getState().loadProject(defaultProject());
}

// --- batch keyframe move/delete: a multi-select drag/delete is one undo step -----------
{
  useEditor.getState().loadProject(defaultProject());
  const tl = activeTimeline(useEditor.getState().project);
  const idleYaw = tl.tracks.find((t) => t.nodeId === 'body' && t.property === 'surface.yaw')!;
  const idleOffsetY = tl.tracks.find((t) => t.nodeId === 'body' && t.property === 'flatOffset.y')!;

  const moved = [
    { trackId: idleYaw.id, kfId: idleYaw.keyframes[1].id, time: idleYaw.keyframes[1].time + 100 },
    { trackId: idleOffsetY.id, kfId: idleOffsetY.keyframes[1].id, time: idleOffsetY.keyframes[1].time + 100 },
  ];
  const pastLen = useEditor.getState().past.length;
  useEditor.getState().moveKeyframes(moved);
  const afterMove = activeTimeline(useEditor.getState().project);
  it('moveKeyframes moves every entry across different tracks to its own explicit time', check(afterMove.tracks.find((t) => t.id === idleYaw.id)!.keyframes.some((k) => k.id === moved[0].kfId && Math.abs(k.time - moved[0].time) < 1)
      && afterMove.tracks.find((t) => t.id === idleOffsetY.id)!.keyframes.some((k) => k.id === moved[1].kfId && Math.abs(k.time - moved[1].time) < 1)));
  it('a multi-keyframe move is exactly one undo step, not one per keyframe', check(useEditor.getState().past.length === pastLen + 1));

  const doomed = [
    { trackId: idleYaw.id, kfId: idleYaw.keyframes[0].id },
    { trackId: idleOffsetY.id, kfId: idleOffsetY.keyframes[0].id },
  ];
  useEditor.getState().deleteKeyframes(doomed);
  const afterDelete = activeTimeline(useEditor.getState().project);
  it('deleteKeyframes removes every selected keyframe across different tracks in one call', check(!afterDelete.tracks.find((t) => t.id === idleYaw.id)?.keyframes.some((k) => k.id === doomed[0].kfId)
      && !afterDelete.tracks.find((t) => t.id === idleOffsetY.id)?.keyframes.some((k) => k.id === doomed[1].kfId)));

  useEditor.getState().loadProject(defaultProject());
}

// --- managing your own presets --------------------------------------------------
{
  useEditor.getState().loadProject(defaultProject());
  const ed = () => useEditor.getState();
  const P = () => useEditor.getState().project;

  ed().commit((p) => {
    p.presets.push({ id: 'p_mine', name: 'Mine', source: 'custom', durationMs: 600, tracks: [
      { id: 't1', nodeId: 'eyeL', property: 'eye.openness', keyframes: [
        { id: 'k1', time: 0, value: 1, easingOut: { type: 'preset', name: 'easeInOut' } },
        { id: 'k2', time: 300, value: 0, easingOut: { type: 'preset', name: 'easeInOut' } },
      ] },
    ] });
  });

  ed().addBlock('p_mine');
  const placed = activeTimeline(P()).blocks.at(-1)!;
  // "Edit on the strip" is place-THEN-select: addBlock does not select on its own, and
  // without the selection the clip panel — and its Save to preset — never appears
  ed().selectBlock(placed.id);
  it('the placed clip can be selected, which is what "edit" relies on', check(ed().selectedBlockId === placed.id, String(ed().selectedBlockId)));

  ed().renamePreset('p_mine', 'Renamed');
  it('rename lands', check(P().presets.find((x) => x.id === 'p_mine')?.name === 'Renamed'));

  const tracksBefore = activeTimeline(P()).tracks.filter((t) => t.blockId === placed.id).length;
  ed().deletePreset('p_mine');
  it('delete removes the preset', check(!P().presets.some((x) => x.id === 'p_mine')));
  it('but the clip made from it keeps its own keyframes', check(activeTimeline(P()).blocks.some((b) => b.id === placed.id)
      && activeTimeline(P()).tracks.filter((t) => t.blockId === placed.id).length === tracksBefore));

  useEditor.getState().loadProject(defaultProject());
}

// --- a preset carries its effects, and placing it brings them along --------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const TL = () => activeTimeline(P());
  const VIEW = { width: 720, height: 720 };

  ed().commit((p) => { p.presets = builtinPresets(); });
  const emittersBefore = TL().emitters?.length ?? 0;

  ed().addBlock('p_sleepy');
  const clip = TL().blocks.at(-1)!;
  const em = TL().emitters ?? [];
  it('placing Sleepy brings its zzz with it', check(em.length === emittersBefore + 1, String(em.length)));
  it('scoped to the clip it was placed as, not globally', check(em.at(-1)!.blockId === clip.id));

  const start = blockStarts(TL()).at(-1)!;
  const glyphs = (t: number) => {
    const rig = evaluateRig(P(), t);
    return emitterItems(TL(), rig, buildScene(rig, VIEW), t, VIEW);
  };
  it('the zzz appear once the mascot is asleep', check(glyphs(start + 1800).length > 0, String(glyphs(start + 1800).length)));
  it('and not before its range opens', check(glyphs(start + 200).length === 0));
  // authored so the tail finishes inside the clip: an emitter whose particles outlive
  // their clip is cut off mid-flight, which is the thing the fade exists to avoid
  it('and every one of them is gone by the end of its range, never past it', check(glyphs(start + 3250).length === 0 && glyphs(start + 3400).length === 0, glyphs(start + 3250).map((g) => g.color.a.toFixed(2)).join(' ')));
  // Sleepy's stream stops being born early enough that its last particles die naturally
  // inside the range, so the exit ramp never has to bite. Either way nothing pops.
  it('thinning out towards the end rather than switching off', check(Math.max(...glyphs(start + 2800).map((g) => g.color.a), 0) < Math.max(...glyphs(start + 2000).map((g) => g.color.a)), `${Math.max(...glyphs(start + 2000).map((g) => g.color.a)).toFixed(2)} -> ${Math.max(...glyphs(start + 2800).map((g) => g.color.a), 0).toFixed(2)}`));

  ed().addBlock('p_angry');
  const angry = TL().blocks.at(-1)!;
  const shake = TL().modifiers.find((m) => m.blockId === angry.id);
  it('placing Angry brings its shake, with the range it was authored with', check(!!shake && shake.startMs === 300 && shake.endMs === 1400, JSON.stringify(shake)));

  // the colour track is the point of Angry, and colour has to actually evaluate
  const angryStart = blockStarts(TL()).at(-1)!;
  const bodyColor = (t: number) => evaluateRig(P(), t).nodes.body.color;
  // bone is near-white, so "red" is not a bigger r — it is r pulling away from g and b
  const redness = (c: { r: number; g: number; b: number }) => c.r - (c.g + c.b) / 2;
  it('the body really does turn red mid-clip', check(redness(bodyColor(angryStart + 800)) > redness(bodyColor(angryStart)) + 60, `${redness(bodyColor(angryStart)).toFixed(0)} -> ${redness(bodyColor(angryStart + 800)).toFixed(0)}`));
  it('and comes back to bone by the end', check(Math.abs(redness(bodyColor(angryStart + 1800)) - redness(bodyColor(angryStart))) < 2));

  // removing a clip must take its effects with it, or they linger unreachable forever
  const before = { e: (TL().emitters ?? []).length, m: TL().modifiers.length };
  ed().removeBlock(clip.id);
  it('removing the clip removes its emitter', check((TL().emitters ?? []).length === before.e - 1));
  ed().removeBlock(angry.id);
  it('and its effects', check(TL().modifiers.length === before.m - 1));

  ed().loadProject(defaultProject());
}

// --- the stopwatch means "a keyframe HERE" ---------------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  // body.surface.pitch, because nothing in the default four-clip strip animates it —
  // transform.rotation looked free until the rebuilt Happy started using it
  const keysOn = () => activeTimeline(P()).tracks
    .filter((t) => t.nodeId === 'body' && t.property === 'surface.pitch')
    .flatMap((t) => t.keyframes.map((k) => Math.round(k.time)))
    .sort((a, b) => a - b);
  const at = (ms: number) => keysOn().some((t) => Math.abs(t - ms) < 1);
  const lit = () => {
    const track = activeTrackFor(activeTimeline(P()), 'body', 'surface.pitch', ed().playhead);
    return !!track?.keyframes.some((k) => Math.abs(k.time - ed().playhead) < 1);
  };

  ed().setPlayhead(400);
  it('an un-animated property starts unlit', check(!lit() && keysOn().length === 0, keysOn().join()));

  ed().toggleKeyframe('body', 'surface.pitch');
  it('clicking registers a keyframe here', check(lit() && at(400), keysOn().join()));

  // THE BUG: it used to stay lit anywhere on the timeline, because it meant "there is a
  // track", and the next click therefore deleted every keyframe on the property
  ed().setPlayhead(1200);
  it('moving the playhead makes it unlit again', check(!lit(), `keys ${keysOn().join()}`));

  ed().toggleKeyframe('body', 'surface.pitch');
  it('and clicking there adds a SECOND rather than wiping the first', check(lit() && at(1200) && at(400), keysOn().join()));

  ed().toggleKeyframe('body', 'surface.pitch');
  it('clicking a lit stopwatch removes only that keyframe', check(!lit() && !at(1200) && at(400), keysOn().join()));

  // the chevrons walk this property's keyframes, across whichever clips animate it
  ed().setPlayhead(3000);
  ed().toggleKeyframe('body', 'surface.pitch');   // lands in Blink, a different clip
  const times = keysOn();
  it('navigation sees keyframes from every clip, not just the one under the playhead', check(times.some((t) => t < 2400) && times.some((t) => t >= 2400), times.join()));

  // removing the LAST keyframe must not move the mascot. Done on an empty timeline: inside
  // a clip writeKeyframe anchors a second keyframe at the clip start, so there is never
  // exactly one to be the last.
  ed().addTimeline('Blank');
  ed().setPlayhead(0);
  ed().toggleKeyframe('body', 'surface.pitch');   // at 0 there is no anchor, so exactly one
  ed().setValue('body', 'surface.pitch', 17, 'probe');
  const posed = valueAt(P(), 'body', 'surface.pitch', 0) as number;
  it('the probe actually posed it', check(Math.abs(posed - 17) < 1e-6, String(posed)));
  it('and left exactly one keyframe to be the last one', check(keysOn().length === 1, keysOn().join()));
  ed().toggleKeyframe('body', 'surface.pitch');   // lit -> remove the only one
  it('removing the last keyframe bakes the pose instead of snapping back', check(Math.abs((valueAt(P(), 'body', 'surface.pitch', 0) as number) - posed) < 1e-6, `${posed} -> ${valueAt(P(), 'body', 'surface.pitch', 0)}`));
  it('and drops the empty track rather than leaving a blank lane', check(!activeTimeline(P()).tracks.some((t) => t.nodeId === 'body' && t.property === 'surface.pitch')));

  ed().loadProject(defaultProject());
}

// --- a feature can be keyframed out of the scene ---------------------------------
{
  const ed = () => useEditor.getState();
  ed().loadProject(defaultProject());
  const P = () => useEditor.getState().project;
  const VIEW = { width: 720, height: 720 };
  const eye = (t: number) => buildScene(evaluateRig(P(), t), VIEW).find((i) => i.id === 'eyeL');

  ed().addTimeline('Leave');
  ed().setPlayhead(0);
  ed().toggleKeyframe('eyeL', 'visible');
  ed().setPlayhead(600);
  ed().setValue('eyeL', 'visible', 0, 'gone');

  const full = eye(0)!;
  it('a layer starts fully present', check(Math.abs((full.color.a ?? 1) - 1) < 1e-6 && full.w > 0));

  const half = eye(300)!;
  it('halfway out it is faded', check(half.color.a < 0.9 && half.color.a > 0.1, String(half.color.a.toFixed(2))));
  it('AND smaller, which is what stops it blinking off', check(half.w < full.w * 0.9, `${half.w.toFixed(1)} vs ${full.w.toFixed(1)}`));

  it('at zero it is not drawn at all', check(!eye(600)));
  it('and the rest of the rig is untouched', check(!!buildScene(evaluateRig(P(), 600), VIEW).find((i) => i.id === 'eyeR')));

  // the copilot can drive it, since it is a plain 0-1 number
  it('the copilot can retire a feature', check(validate(P(), { name: 'add_keyframe', args: { nodeId: 'eyeL', property: 'visible', atMs: 100, value: 0 } }) === null));

  ed().loadProject(defaultProject());
}

// --- a preset carries its effects, so a published one has something to preview ----
{
  const ed5 = () => useEditor.getState();
  ed5().loadProject(defaultProject());
  ed5().commit((p) => { p.presets = builtinPresets(); });
  ed5().commit((p) => {
    const tl = activeTimeline(p);
    tl.blocks = []; tl.tracks = []; tl.emitters = []; tl.modifiers = [];
  });
  ed5().addBlock('p_sleepy');
  const tl0 = activeTimeline(ed5().project);
  it('the built-in placed its emitter on the strip', check((tl0.emitters ?? []).length === 1));

  // what someone does before publishing: save the clip back out as their own preset
  ed5().savePreset('Mine', tl0.tracks.map((t) => t.id), 4600);
  const mine = ed5().project.presets.find((x) => x.name === 'Mine')!;
  it('saving a preset keeps its emitters, not just its keyframes', check((mine.emitters ?? []).length === 1, `${mine.tracks.length} tracks, ${(mine.emitters ?? []).length} emitters`));

  /**
   * And the preview — the editor's and the admin review queue's, which are now the same
   * call — draws them. This is what "the community preview renders nothing" actually
   * was: not a broken preview, a preset that had lost half of itself on the way in.
   */
  const base2 = defaultProject();
  const drawn = (pr: Preset) => sceneAt(presetPreviewProject(base2, pr), 1500, { width: 720, height: 720 }).length;
  const builtin = builtinPresets().find((x) => x.id === 'p_sleepy')!;
  it('so the preview of a saved copy shows what the built-in shows', check(drawn(mine) === drawn(builtin) && drawn(mine) > 3, `${drawn(mine)} items vs ${drawn(builtin)}`));

  // editing a preset through the strip must not throw them away again
  ed5().addBlock(mine.id);
  const tl1 = activeTimeline(ed5().project);
  ed5().updatePresetFromBlock(tl1.blocks[tl1.blocks.length - 1].id);
  const edited = ed5().project.presets.find((x) => x.id === mine.id)!;
  it('and editing it on the strip keeps them too', check((edited.emitters ?? []).length === 1, `${(edited.emitters ?? []).length} emitters`));

  ed5().loadProject(defaultProject());
}
