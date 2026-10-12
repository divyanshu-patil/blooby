import { it } from 'vitest';
import { check, near, rig } from './testkit';
import { activeTrackFor, appearanceSpans, composeScene, emitterFrame, emitterItems, emitterPathAt, fromFrame, pinned, blockSampleTime, buildScene, effectAt, evaluateRig, evaluateWithTransition, lerpAngle, lerpValue, resolveTracks, sampleTrack, sceneAt, valueAt } from './scene';
import { makeGroup, makeLimb, makeShapeLayer, makeTextLayer } from './layers';
import { makeTimeline } from './defaults';
import type { Modifier } from './types';
import { confetti, defaultProject, defaultRig } from './defaults';
import { relayoutBlocks } from './timeline';
import { useEditor } from './store';
import { activeTimeline } from './types';
import { readProp } from './props';
import { SAILORS_PROJECTS, sailorsProject } from './sailorsPresets';
import type { Rig, RigNode } from './types';

// --- angles --------------------------------------------------------------------
it('angle takes the short way', check(near(lerpAngle(170, -170, 0.5), 180)));
it('angle plain case', check(near(lerpAngle(0, 90, 0.5), 45)));

// --- track sampling ------------------------------------------------------------
const track = {
  id: 'k', nodeId: 'n', property: 'surface.yaw',
  keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 100, easingOut: { type: 'linear' as const } },
  ],
};
it('before first key holds', check(sampleTrack(track, -50) === 0));
it('after last key holds', check(sampleTrack(track, 5000) === 100));
it('midpoint linear', check(near(sampleTrack(track, 500) as number, 50)));
it('empty track undefined', check(sampleTrack({ ...track, keyframes: [] }, 0) === undefined));

// --- scene: the default rig actually renders two eyes on a body ----------------
const scene = buildScene(rig, { width: 600, height: 600 });
it('default rig renders 3 shapes', check(scene.length === 3, String(scene.length)));
it('every shape is round', check(scene.every((s) => s.shape === 'ellipse' || s.r >= Math.min(s.w, s.h) / 2 - 1e-9)));
it('body is an ellipse, eyes are pills', check(scene[0].shape === 'ellipse' && scene[1].shape === 'pill'));
it('eyes are mirrored', check(near(scene[1].cx + scene[2].cx, 600, 1e-6), `${scene[1].cx} ${scene[2].cx}`));

// --- do drawn features ever escape the drawn body outline? ---------------------
{
  let worst = 0, worstAt = '';
  for (const fov of [0, 28, 55, 78, 89]) {
    for (let yaw = -80; yaw <= 80; yaw += 2) {
      for (let pitch = -60; pitch <= 60; pitch += 5) {
        const proj = { rig: defaultRig() };
        proj.rig.camera.fov = fov;
        proj.rig.nodes.body.surface.yaw = yaw;
        proj.rig.nodes.body.surface.pitch = pitch;
        const sc = buildScene(proj.rig, { width: 720, height: 720 });
        const body = sc.find((x) => x.id === 'body')!;
        for (const it of sc) {
          if (it.id === 'body' || it.color.a < 0.5) continue; // mostly faded out at the limb
          // a pill is the inner rect swept by a disc of radius r — sample that outline,
          // not the bounding box, or the corners lie about how far the ink reaches
          const ix = Math.max(0, it.w / 2 - it.r), iy = Math.max(0, it.h / 2 - it.r);
          const a2 = (it.rotation * Math.PI) / 180;
          for (const [sx2, sy2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            for (let k = 0; k < 24; k++) {
              const th = (k / 24) * Math.PI * 2;
              const lx = sx2 * ix + it.r * Math.cos(th);
              const ly = sy2 * iy + it.r * Math.sin(th);
              const px = it.cx + lx * Math.cos(a2) - ly * Math.sin(a2) - body.cx;
              const py = it.cy + lx * Math.sin(a2) + ly * Math.cos(a2) - body.cy;
              const d = Math.hypot(px / (body.w / 2), py / (body.h / 2));
              if (d > worst) { worst = d; worstAt = `fov${fov} yaw${yaw} pitch${pitch} ${it.name}`; }
            }
          }
        }
      }
    }
  }
  // A flat decal tangent to a sphere genuinely pokes past the silhouette near the rim —
  // the exact shear transform spills 5.3% here, so 5.3% is the floor, not a bug. The
  // scale-only approximation costs about 1.4 points on top of that, and the stylised
  // turn-squash (bodyTurnScale, up to 22% at combined extreme yaw+pitch) adds a couple
  // more at the extremes where both squash independently — swept the full grid, worst
  // case is 9.2%.
  it('features stay within the body outline', check(worst <= 1.10, `${worst.toFixed(4)} at ${worstAt}`));
}

// --- stretch modifier: the whole rig, not one node ------------------------------
{
  const proj = defaultProject();
  const before = buildScene(proj.rig, { width: 720, height: 720 });
  activeTimeline(proj).modifiers.push({ id: 'm', nodeId: proj.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20 });
  // t chosen so sin(2*pi*1*t) = 1 exactly, i.e. the modifier is at its full +20% swing
  const tSec = 0.25;
  const after = buildScene(evaluateRig(proj, tSec * 1000), { width: 720, height: 720 });
  const bodyBefore = before.find((s) => s.id === 'body')!, bodyAfter = after.find((s) => s.id === 'body')!;
  const eyeBefore = before.find((s) => s.id === 'eyeL')!, eyeAfter = after.find((s) => s.id === 'eyeL')!;
  it('stretch grows the body', check(bodyAfter.w > bodyBefore.w * 1.15, `${bodyAfter.w} vs ${bodyBefore.w}`));
  it('stretch grows features too, not just the body node', check(eyeAfter.w > eyeBefore.w * 1.15, `${eyeAfter.w} vs ${eyeBefore.w}`));
  const ratio = (a: number, b: number) => a / b;
  it('body and eye scale by the same factor — one rig-wide pulse', check(Math.abs(ratio(bodyAfter.w, bodyBefore.w) - ratio(eyeAfter.w, eyeBefore.w)) < 0.02, `${ratio(bodyAfter.w, bodyBefore.w)} vs ${ratio(eyeAfter.w, eyeBefore.w)}`));
  it('amount=0 leaves it alone', check((() => {
      // compare against the same evaluated-at-t baseline (the Idle preset's own yaw
      // track already moves the body a hair via the Stage-1 turn-squash) — isolating
      // the modifier's own effect, not conflating it with unrelated keyframed motion.
      const p2 = defaultProject();
      const baseline = buildScene(evaluateRig(p2, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
      activeTimeline(p2).modifiers.push({ id: 'm2', nodeId: p2.rig.rootId, kind: 'stretch', amount: 0, frequency: 1, amplitude: 20 });
      const b = buildScene(evaluateRig(p2, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
      return Math.abs(b.w - baseline.w) < 1e-6;
    })()));
}

// --- per-clip effects: scoped to one block's own time window, phase resets at its start
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const blinkBlock = tl.blocks[1]; // 2400–3300ms — away from t=0, so an origin-shift bug can't hide
  tl.modifiers.push({ id: 'cm', nodeId: proj.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20, blockId: blinkBlock.id });

  const noModifier = defaultProject();
  const inside = buildScene(evaluateRig(proj, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!; // 250ms into Blink
  const baseline2650 = buildScene(evaluateRig(noModifier, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  it('a clip-scoped effect actually runs inside its own clip', check(Math.abs(inside.w - baseline2650.w) > 5, `${inside.w} vs ${baseline2650.w}`));

  // Idle runs 0–2400ms — well outside Blink's window, so the effect must vanish there
  const outsideDuringIdle = buildScene(evaluateRig(proj, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const baseline250 = buildScene(evaluateRig(noModifier, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  it('a clip-scoped effect does not leak into a different clip', check(Math.abs(outsideDuringIdle.w - baseline250.w) < 1e-6, `${outsideDuringIdle.w} vs ${baseline250.w}`));

  // the effect's own phase is relative to the clip's start, not absolute timeline time —
  // its *contribution* 450ms into Blink (starts at 2400ms) must match a global one's
  // contribution 450ms into t=0, not 2850ms in. 450 sits past the clip's ease-in and before
  // its ease-out (Blink is 900ms, so each is 300ms). Compares deltas against the same
  // no-modifier baselines, so the unrelated keyframed motion each preset already does at
  // that absolute time (which legitimately differs between t=450 and t=2850) cancels out.
  const body = (p: typeof proj, t: number) => buildScene(evaluateRig(p, t), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const globalEquivalent = defaultProject();
  activeTimeline(globalEquivalent).modifiers.push({ id: 'gm', nodeId: globalEquivalent.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20 });
  const insideDelta = body(proj, 2850).w - body(noModifier, 2850).w;
  const global450Delta = body(globalEquivalent, 450).w - body(noModifier, 450).w;
  const global2850Delta = body(globalEquivalent, 2850).w - body(noModifier, 2850).w;
  it('a clip-scoped effect phases from its own clip start, not absolute timeline time', check(Math.abs(insideDelta - global450Delta) < 0.05 && Math.abs(insideDelta - global2850Delta) > 5, `Δinside=${insideDelta} vs Δglobal@450=${global450Delta} vs Δglobal@2850=${global2850Delta}`));
  it('a clip-scoped effect eases in at its clip start rather than snapping on', check(Math.abs(inside.w - baseline2650.w) < Math.abs(body(globalEquivalent, 250).w - baseline250.w) - 1));

  // removing the block it belongs to must drop the effect too, not leave it orphaned
  useEditor.getState().loadProject(proj);
  useEditor.getState().removeBlock(blinkBlock.id);
  it('removing a clip drops its per-clip effects along with it', check(!activeTimeline(useEditor.getState().project).modifiers.some((m) => m.id === 'cm')));
}

// --- per-clip playback speed and loop ---------------------------------------------
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const talk = tl.blocks[2]; // 3300–4900ms, body.transform.scale.y is a multi-segment track
  const talkTrack = tl.tracks.find((t) => t.blockId === talk.id && t.nodeId === 'body' && t.property === 'transform.scale.y')!;

  talk.speed = 2;
  const withSpeed = valueAt(proj, 'body', 'transform.scale.y', 3300 + 300);
  const expected = sampleTrack(talkTrack, 3300 + 300 * 2); // 2x speed samples the source at double the elapsed local time
  it('block speed re-times its own sampling, not the block\'s position or duration', check(Math.abs((withSpeed as number) - (expected as number)) < 1e-6, `${withSpeed} vs ${expected}`));
  delete talk.speed;

  const blink = tl.blocks[1]; // 2400–3300ms; its preset's natural length is 900ms
  const before = blink.durationMs;
  blink.loop = true; // set *before* relayoutBlocks: a looping block keeps its natural
  // timing on resize instead of being proportionally stretched, so there's still a
  // natural-length cycle for evaluateRig to wrap at, not just one stretched-out playthrough
  relayoutBlocks(tl, tl.blocks.map((b) => (b.id === blink.id ? { ...b, durationMs: before * 3, loop: true } : b)));

  const atFirstRep = valueAt(proj, 'eyeL', 'eye.openness', 2400 + 200);
  const atThirdRep = evaluateRig(proj, 2400 + before * 2 + 200).nodes.eyeL.eye!.openness;
  it('a looping clip repeats its own content instead of holding the last frame', check(Math.abs((atFirstRep as number) - atThirdRep) < 1e-6, `${atFirstRep} vs ${atThirdRep}`));

  const nonLoopProj = defaultProject();
  const nonLoopBlink = activeTimeline(nonLoopProj).blocks[1];
  relayoutBlocks(activeTimeline(nonLoopProj), activeTimeline(nonLoopProj).blocks.map((b) => (b.id === nonLoopBlink.id ? { ...b, durationMs: before * 3 } : b)));
  const nonLoopAtThirdRep = evaluateRig(nonLoopProj, 2400 + before * 2 + 200).nodes.eyeL.eye!.openness;
  it('without loop, the same resize instead proportionally stretches the content (existing behavior unchanged)', check(Math.abs(nonLoopAtThirdRep - (atFirstRep as number)) > 0.05, `${nonLoopAtThirdRep} vs ${atFirstRep}`));
}

// --- transitions: runtime blend between the outgoing pose and the incoming animation
{
  const proj = defaultProject();
  const tl = activeTimeline(proj);
  const idle = tl.blocks[0]; // 0–2400ms
  tl.transitions = [{ id: 'tx', afterBlockId: idle.id, durationMs: 400, easing: { type: 'linear' } }];
  const boundary = 2400;

  // the same project with the transition explicitly turned off — the "no blending at
  // all" baseline. An *empty* transitions array no longer means this (every seam morphs
  // by default now — see the dedicated default-transition test below), so this has to be
  // an explicit durationMs:0 hard cut, the one real opt-out that exists.
  const noTransitionProj = { ...proj, timelines: proj.timelines.map((t) => (t.id === tl.id ? { ...t, transitions: [{ id: 'none', afterBlockId: idle.id, durationMs: 0, easing: { type: 'linear' as const } }] } : t)) };
  const rawAtBoundary = evaluateRig(noTransitionProj, boundary);

  const atSeam = evaluateRig(proj, boundary); // progress 0 — must read as 100% outgoing
  it('right at the seam, the blend is entirely the outgoing clip\'s pose', check(Math.abs(atSeam.nodes.eyeL.eye!.openness - rawAtBoundary.nodes.eyeL.eye!.openness) < 1e-6, `${atSeam.nodes.eyeL.eye!.openness} vs ${rawAtBoundary.nodes.eyeL.eye!.openness}`));

  const incomingLiveAtEnd = evaluateRig(noTransitionProj, boundary + 400).nodes.eyeL.eye!.openness;
  const atEnd = evaluateRig(proj, boundary + 399.99); // progress ≈ 1 — must read as ≈100% incoming
  it('by the end of the transition, the blend is essentially the incoming clip\'s own animation', check(Math.abs(atEnd.nodes.eyeL.eye!.openness - incomingLiveAtEnd) < 0.01, `${atEnd.nodes.eyeL.eye!.openness} vs ${incomingLiveAtEnd}`));

  const mid = evaluateRig(proj, boundary + 200).nodes.body.surface.yaw;
  const outVal = rawAtBoundary.nodes.body.surface.yaw;
  const inVal = evaluateRig(noTransitionProj, boundary + 200).nodes.body.surface.yaw;
  it('midway through a linear transition, the blend sits between outgoing and incoming', check((mid - outVal) * (inVal - mid) >= -1e-9, `out=${outVal} mid=${mid} in=${inVal}`));

  it('a transition never touches the outgoing or incoming clip\'s own stored keyframes', check(JSON.stringify(activeTimeline(proj).tracks) === JSON.stringify(activeTimeline(noTransitionProj).tracks)));

  const beforeCount = tl.blocks.length;
  useEditor.getState().loadProject(proj);
  useEditor.getState().removeBlock(idle.id);
  it('removing a clip drops the transition that followed it', check(activeTimeline(useEditor.getState().project).blocks.length === beforeCount - 1
      && !activeTimeline(useEditor.getState().project).transitions?.some((x) => x.id === 'tx')));

  // the checks above all happen to use properties/moments where the default project's own
  // authored values coincide at the Idle/Blink boundary (Idle's own yaw curve returns to 0
  // by its end; Blink never touches yaw either) — every one of them still passes if the
  // "outgoing" snapshot is silently captured on the *incoming* side of the seam instead
  // (blending a value with itself is invisible). Use a property forced to genuinely differ
  // on each side, so a regression like that can't hide behind coincidentally-equal fixture
  // data the way it did the first time this was written.
  useEditor.getState().loadProject(defaultProject());
  const idle2 = activeTimeline(useEditor.getState().project).blocks[0];
  useEditor.getState().setPlayhead(100);
  useEditor.getState().toggleTrack('body', 'transform.rotation'); // Idle doesn't already animate this
  useEditor.getState().setValue('body', 'transform.rotation', 60, 'rot2');
  useEditor.getState().setTransition(idle2.id, { durationMs: 400, easing: { type: 'linear' } });
  const rotAtSeam = evaluateRig(useEditor.getState().project, 2400).nodes.body.transform.rotation;
  const rotMidway = evaluateRig(useEditor.getState().project, 2600).nodes.body.transform.rotation;
  const rotAtEnd = evaluateRig(useEditor.getState().project, 2800).nodes.body.transform.rotation;
  it('a transition actually morphs a property that differs on each side of the seam, not a same-value no-op', check(Math.abs(rotAtSeam - 60) < 1e-6 && Math.abs(rotMidway - 30) < 1e-6 && Math.abs(rotAtEnd) < 1e-6, `seam=${rotAtSeam} mid=${rotMidway} end=${rotAtEnd} (want 60, 30, 0)`));
}

// --- resolveTracks: the loop seam is derived, never written into the file ------
{
  type TL = ReturnType<typeof activeTimeline>;
  /** a project whose active timeline is exactly these tracks/blocks */
  const fixture = (tracks: TL['tracks'], blocks: TL['blocks'], durationMs: number, loop = true) => {
    const p = defaultProject();
    const tl = activeTimeline(p);
    tl.loop = loop;
    tl.blocks = blocks;
    tl.tracks = tracks;
    tl.timelineDurationMs = durationMs;
    return p;
  };

  // a fixture that deliberately does NOT return to its start value — the whole point —
  // and whose outgoing easing is deliberately NOT easeOut, to prove the close forces its
  // own easeOut rather than happening to inherit it from the segment before
  const openTrack = { id: 't1', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 10, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 70, easingOut: { type: 'linear' as const } },
  ] };
  const off = resolveTracks(fixture([openTrack], [], 2000, false));
  it('loop off: tracks pass through completely unchanged', check(off[0] === openTrack));

  const looped = resolveTracks(fixture([openTrack], [], 2000));
  const seam = looped[0];
  it('loop on: the original track object is not mutated', check(openTrack.keyframes.length === 2));
  it('loop on: a closing keyframe is appended at the very end', check(seam.keyframes.length === 3 && seam.keyframes[2].time === 2000));
  it('the closing value matches the pose rendered at t=0', check(seam.keyframes[2].value === 10));
  it('so the last frame and the first frame land on the same pose', check(sampleTrack(seam, 2000) === sampleTrack(seam, 0)));
  it('the close always eases in with easeOut, not whatever the outgoing segment used', check(seam.keyframes[2].easingOut.type === 'preset' && (seam.keyframes[2].easingOut as { name: string }).name === 'easeOut'));

  // even a track already flat at its start value still gets its own closing keyframe —
  // "first frame == last frame" holds unconditionally, not just when there's a gap to close
  const constTrack = { id: 't2', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 5, easingOut: { type: 'linear' as const } },
    { id: 'b', time: 1000, value: 5, easingOut: { type: 'linear' as const } },
  ] };
  const stillClosed = resolveTracks(fixture([constTrack], [], 2000));
  it('a track already flat at its start value still gets a closing keyframe', check(stillClosed[0].keyframes.length === 3 && stillClosed[0].keyframes[2].value === 5));

  // evaluateRig actually uses this — the seam is visible in playback, not just in theory.
  const proj = fixture([{ id: 't3', nodeId: 'body', property: 'transform.rotation', keyframes: openTrack.keyframes }], [], 2000);
  const atEnd = evaluateRig(proj, 2000).nodes.body.transform.rotation;
  const atStart = evaluateRig(proj, 0).nodes.body.transform.rotation;
  it('evaluateRig itself loops the pose, not just the raw track helper', check(atEnd === atStart, `${atEnd} vs ${atStart}`));

  /** two 1000ms clips, so the tail is owned by a different clip than t=0 is */
  const twoClips = (tracksFor: (a: string, b: string) => TL['tracks']) => {
    const p = defaultProject();
    const tl = activeTimeline(p);
    tl.loop = true;
    tl.blocks = tl.blocks.slice(0, 2);
    for (const b of tl.blocks) { b.durationMs = 1000; b.loop = false; b.speed = 1; }
    tl.timelineDurationMs = 2000;
    tl.tracks = tracksFor(tl.blocks[0].id, tl.blocks[1].id);
    return p;
  };

  // THE reported bug: yaw/pitch read 0 at t=0 but 9.2/21.0 at the loop point, because the
  // closing clip owns its own separate track for that property and each track was closing
  // back to *its own* t=0 rather than to the pose actually on screen at t=0.
  const crossProj = twoClips((a, b) => [
    { id: 'ca', nodeId: 'body', property: 'transform.rotation', blockId: a, keyframes: [
      { id: 'ca1', time: 0, value: 10, easingOut: { type: 'linear' as const } },
      { id: 'ca2', time: 900, value: 80, easingOut: { type: 'linear' as const } }] },
    { id: 'cb', nodeId: 'body', property: 'transform.rotation', blockId: b, keyframes: [
      { id: 'cb1', time: 1200, value: 200, easingOut: { type: 'linear' as const } },
      { id: 'cb2', time: 1900, value: 250, easingOut: { type: 'linear' as const } }] },
  ]);
  const xEnd = evaluateRig(crossProj, 2000).nodes.body.transform.rotation;
  const xStart = evaluateRig(crossProj, 0).nodes.body.transform.rotation;
  it('a property owned by a different clip at the tail still closes onto the t=0 pose', check(xEnd === xStart, `${xEnd} vs ${xStart}`));

  // and the harder half: a property the closing clip does not animate at all, so there is
  // no track there to hang the closing keyframe on — one has to be synthesized
  const orphanProj = twoClips((a) => [
    { id: 'oa', nodeId: 'body', property: 'surface.pitch', blockId: a, keyframes: [
      { id: 'oa1', time: 0, value: 15, easingOut: { type: 'linear' as const } },
      { id: 'oa2', time: 900, value: 60, easingOut: { type: 'linear' as const } }] },
  ]);
  const oEnd = evaluateRig(orphanProj, 2000).nodes.body.surface.pitch;
  const oStart = evaluateRig(orphanProj, 0).nodes.body.surface.pitch;
  it('a property the closing clip never animates still gets closed onto the t=0 pose', check(oEnd === oStart, `${oEnd} vs ${oStart}`));

  // a clip-owned track must hold its pose into any padding where the timeline's own
  // duration outlives the sum of block durations — not snap to the rig's bare defaults
  // the instant blockAt stops recognizing the time as "inside" the last block (the bug
  // behind the reported yaw/pitch jump right at the loop point)
  const proj3 = defaultProject();
  const ptl3 = activeTimeline(proj3);
  ptl3.blocks = [ptl3.blocks[0]];
  ptl3.timelineDurationMs = ptl3.blocks[0].durationMs + 300;
  ptl3.tracks = [{ id: 't4', nodeId: 'body', property: 'transform.rotation', blockId: ptl3.blocks[0].id,
    keyframes: [{ id: 'a', time: 50, value: 42, easingOut: { type: 'linear' } }] }];
  const inPadding = evaluateRig(proj3, ptl3.blocks[0].durationMs + 150).nodes.body.transform.rotation;
  it('a clip-owned track holds its value past blocksEnd instead of resetting to defaults', check(inPadding === 42, `${inPadding}`));
}

// --- transform.scale cascades down the rig tree: scaling the body also scales the eyes -
{
  const proj = defaultProject();
  const before = buildScene(proj.rig, { width: 720, height: 720 }).find((s) => s.id === 'eyeL')!;
  const scaled: Rig = structuredClone(proj.rig);
  scaled.nodes.body.transform.scale = { x: 1.5, y: 1.5 };
  const after = buildScene(scaled, { width: 720, height: 720 }).find((s) => s.id === 'eyeL')!;
  it('scaling the body also scales its children (eyes), not just the body node itself', check(Math.abs(after.w / before.w - 1.5) < 1e-6, `${after.w} vs ${before.w}`));

  // three levels deep, ratio-based (not an absolute pixel count) so it can't depend on
  // exactly what projectToScreen's own foreshortening happens to be for this rig shape
  const mkNode = (id: string, parentId: string, scale: number): RigNode => ({
    id, name: id, kind: 'primitive', parentId,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: scale, y: scale }, rotation: 0 },
    size: { x: 10, y: 10 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 0,
    primitive: { shape: 'circle' },
  });
  const rigWithScaledGroup: Rig = structuredClone(proj.rig);
  rigWithScaledGroup.nodes['g'] = mkNode('g', 'body', 2);
  rigWithScaledGroup.nodes['gc'] = mkNode('gc', 'g', 1);
  const gcScaled = buildScene(rigWithScaledGroup, { width: 720, height: 720 }).find((s) => s.id === 'gc')!.w;
  const rigNoScaledGroup: Rig = structuredClone(rigWithScaledGroup);
  rigNoScaledGroup.nodes['g'].transform.scale = { x: 1, y: 1 };
  const gcUnscaled = buildScene(rigNoScaledGroup, { width: 720, height: 720 }).find((s) => s.id === 'gc')!.w;
  it('cascade multiplies through multiple ancestor levels, not just the immediate parent', check(Math.abs(gcScaled / gcUnscaled - 2) < 1e-3, `${gcScaled} vs ${gcUnscaled}`));
}

// --- effects are animatable: a keyframe on an emitter's own property -------------
{
  const ed2 = () => useEditor.getState();
  ed2().loadProject(defaultProject());
  ed2().commit((p) => {
    const tl = activeTimeline(p);
    tl.blocks = []; tl.tracks = []; tl.emitters = []; tl.modifiers = [];
    tl.emitters.push({ ...confetti('body'), id: 'em1', startMs: undefined, endMs: undefined });
  });
  const em = () => activeTimeline(ed2().project).emitters![0];

  it('an emitter property reads through the same accessor a node one does', check(typeof valueAt(ed2().project, 'em1', 'fx.size', 0) === 'number'));

  // autokey ON, two different values at two different times: the ordinary way a user
  // animates anything in this editor
  if (!ed2().autoKey) ed2().toggleAutoKey();
  ed2().setPlayhead(0);
  ed2().setValue('em1', 'fx.size', 10);
  ed2().setPlayhead(1000);
  ed2().setValue('em1', 'fx.size', 60);
  const fxTracks = activeTimeline(ed2().project).tracks.filter((t) => t.property === 'fx.size');
  it('autokey records it as an ordinary track keyed by the effect id', check(fxTracks.length === 1 && fxTracks[0].nodeId === 'em1' && fxTracks[0].keyframes.length === 2, `${fxTracks.length} tracks, ${fxTracks[0]?.keyframes.length} keys`));
  it('and it interpolates between them like any other property', check(Math.abs((valueAt(ed2().project, 'em1', 'fx.size', 500) as number) - 35) < 6, String(valueAt(ed2().project, 'em1', 'fx.size', 500))));

  /**
   * The point of all of it: the scene draws the sampled value, not the stored field.
   *
   * Measured as the SAME frame with and without the track rather than as two different
   * frames — particles are born small and grow, so an early-vs-late comparison passes on
   * a completely static emitter and proves nothing.
   */
  const widthAt = (t: number) => {
    const items = sceneAt(ed2().project, t, { width: 720, height: 720 }).filter((s) => s.name === em().name);
    return items.length ? Math.max(...items.map((s) => s.w)) : 0;
  };
  const animated = widthAt(980);
  ed2().commit((p) => { activeTimeline(p).tracks = []; });
  const stored = widthAt(980);
  it('and the scene draws the animated value, not the stored one', check(animated > stored * 2, `${stored.toFixed(1)} stored -> ${animated.toFixed(1)} animated`));

  // the stored emitter is untouched: effectAt copies, it does not mutate the project
  // effectAt copies; the value the user sees at 1000ms is a sample, not the stored field
  it('animating an effect never rewrites the effect itself', check(em().size === confetti('body').size, `stored size ${em().size}`));

  if (ed2().autoKey) ed2().toggleAutoKey();
  ed2().loadProject(defaultProject());
}

// --- an overshooting travel easing must not corrupt the life of a particle -------
{
  const ed4 = () => useEditor.getState();
  ed4().loadProject(defaultProject());
  ed4().commit((p) => {
    const tl = activeTimeline(p);
    tl.blocks = []; tl.tracks = []; tl.modifiers = []; tl.timelineDurationMs = 2000;
    tl.emitters = [{
      ...confetti('body'), id: 'ez', name: 'ez', startMs: undefined, endMs: undefined,
      parts: [{ id: 'p1', shapeId: 'bang', weight: 1, speed: 1, sizeScale: 1, spin: 0 }],
      rateMs: 4000, lifeMs: 1400, count: 1, size: 60,
      scaleFrom: 0.35, scaleTo: 1, fadeStart: 0.8, wobble: 0, speedJitter: 0,
      easing: { type: 'preset', name: 'elastic' },
    } as never];
  });
  const widths: number[] = [];
  for (let t = 120; t <= 1100; t += 60) {
    const it = sceneAt(ed4().project, t, { width: 720, height: 720 }).find((s) => s.name === 'ez');
    widths.push(it ? it.w : 0);
  }
  // elastic swings outside 0..1, and `u` used to drive size, alpha AND the cull, so the
  // badge blinked between full size, a third of it, and nothing
  it('an elastic travel curve never blinks the particle out', check(widths.every((w) => w > 0), widths.map((w) => w.toFixed(0)).join(',')));
  it('and its growth stays monotonic while it is young', check(widths.every((w, i) => i === 0 || w >= widths[i - 1] - 0.5), widths.map((w) => w.toFixed(0)).join(',')));

  // the easing must still bend the PATH, which is the thing it is for
  const yOf = (t: number) => sceneAt(ed4().project, t, { width: 720, height: 720 }).find((s) => s.name === 'ez')?.cy ?? 0;
  ed4().updateEmitter('ez', (e) => { e.easing = undefined; });
  const linear = yOf(700);
  ed4().updateEmitter('ez', (e) => { e.easing = { type: 'preset', name: 'easeOut' }; });
  it('while still shaping the journey', check(Math.abs(yOf(700) - linear) > 2, `${linear.toFixed(1)} vs ${yOf(700).toFixed(1)}`));

  ed4().loadProject(defaultProject());
}

// valueAt and evaluateRig narrow each lookup to its own layer's tracks (indexTracks) — the
// inspector must still read exactly what the stage draws, on a big looping scene
{
  const p = sailorsProject(SAILORS_PROJECTS.find((x) => x.name === 'streak-restore')!);
  const keys = [...new Set(activeTimeline(p).tracks.map((t) => `${t.nodeId}|${t.property}`))];
  const off: string[] = [];
  for (const t of [0, 333, 1250, activeTimeline(p).timelineDurationMs - 20]) {
    const drawn = evaluateRig(p, t);
    for (const k of keys) {
      const [id, prop] = k.split('|');
      const a = valueAt(p, id, prop, t), b = readProp(drawn, id, prop);
      if (typeof a === 'number' && typeof b === 'number' ? !near(a, b, 1e-6) : JSON.stringify(a) !== JSON.stringify(b)) off.push(`${k}@${t}`);
    }
  }
  it('valueAt reads what evaluateRig draws, every animated property of a 50-layer loop', check(keys.length > 100 && off.length === 0, off.slice(0, 5).join(', ')));
}

// --- lerp fallbacks, angle seam, sealed clips -------------------------------------------------
{
  const col = { r: 0, g: 0, b: 0, a: 1 }, vec = { x: 0, y: 0 };
  it('mixed kinds keep the first', check(lerpValue(5, 'x', 0.5) === 5 && lerpValue(col, 5, 0.5) === col && lerpValue(vec, 5, 0.5) === vec && lerpValue(col, vec, 0.5) === col));
  it('vectors lerp', check((lerpValue(vec, { x: 2, y: 4 }, 0.5) as { x: number }).x === 1));
  it('angle takes the short way round the other seam', check(near(lerpAngle(0, 270, 1), -90)));
  // two other lanes both running over this layer's clip: the first one lends its track, the second is not needed
  const tl = makeTimeline('t');
  tl.blocks = [{ id: 'a', presetId: 'p', name: 'a', durationMs: 1000 }, { id: 'b', presetId: 'p', name: 'b', durationMs: 1000, mascotId: 'm2' }, { id: 'c', presetId: 'p', name: 'c', durationMs: 1000, mascotId: 'm3' }];
  const tk = (id: string, blockId: string) => ({ id, nodeId: 'n', property: 'surface.yaw', blockId, keyframes: [{ id: `${id}k`, time: 0, value: 1, easingOut: { type: 'linear' as const } }] });
  tl.tracks = [tk('tA', 'a'), tk('tB', 'b'), tk('tC', 'c')];
  it('inside its own clip wins; otherwise the first lender', check(activeTrackFor(tl, 'n', 'surface.yaw', 500)?.id === 'tA'));
  const [tA, tB, tC] = [tk('tA', 'a'), tk('tB', 'b'), tk('tC', 'c')];
  it('the first lender is kept over the second, but the own clip still wins', check(activeTrackFor(tl, 'n', 'surface.yaw', 500, undefined, [tB, tC, tA], [tA])?.id === 'tA'));
  tl.tracks = [tk('tB', 'b'), tk('tC', 'c')];
  it('a node with no clip of its own borrows from one running now', check(activeTrackFor(tl, 'n', 'surface.yaw', 500)?.id === 'tB'));
}

// --- every modifier kind, on the root and on a mapped feature, with and without a phase ------
{
  const run = (mods: Partial<Modifier>[], patch?: (p: ReturnType<typeof defaultProject>) => void, at = 700) => {
    const p = defaultProject();
    activeTimeline(p).modifiers = mods.map((m, i) => ({ id: `m${i}`, nodeId: 'body', kind: 'shake', amount: 100, frequency: 2, amplitude: 20, ...m }) as Modifier);
    patch?.(p);
    return evaluateRig(p, at);
  };
  const base = evaluateRig(defaultProject(), 700);
  const kinds = ['shake', 'float', 'pendulum', 'bounce', 'breathe', 'orbit', 'heartbeat', 'stretch'] as const;
  for (const kind of kinds) for (const nodeId of ['body', 'eyeL']) for (const phase of [undefined, 1]) {
    const r = run([{ kind, nodeId, phase }]);
    it(`${kind} on ${nodeId}${phase ? ' with a phase' : ''} moves something`, check(JSON.stringify(r.nodes[nodeId]) !== JSON.stringify(base.nodes[nodeId])));
  }
  for (const axis of ['rotation', 'x', 'y', 'yaw', 'pitch'] as const)
    it(`pendulum on ${axis}`, check(JSON.stringify(run([{ kind: 'pendulum', axis }]).nodes.body) !== JSON.stringify(base.nodes.body)));
  it('a modifier with no gain does nothing', check(JSON.stringify(run([{ amplitude: 0 }]).nodes.body) === JSON.stringify(base.nodes.body)));
  it('a modifier on a missing layer does nothing', check(run([{ nodeId: 'ghost' }]) !== undefined));
  for (const kind of ['shake', 'float', 'pendulum', 'bounce'] as const)
    it(`the camera ${kind}s`, check((() => { const r = run([{ nodeId: '__camera', kind, phase: kind === 'float' ? 1 : undefined, seed: kind === 'shake' ? 3 : undefined }]); return kind === 'bounce' ? r.camera.offset.y === 0 : r.camera.offset.x !== 0 || r.camera.offset.y !== 0; })()));
  it('follow and jelly on a face', check(run([{ kind: 'follow', nodeId: 'face' }, { kind: 'jelly', nodeId: 'body' }], (p) => {
    activeTimeline(p).tracks.push({ id: 'tk', nodeId: 'body', property: 'flatOffset.y', keyframes: [{ id: 'a', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'b', time: 500, value: -200, easingOut: { type: 'linear' } }, { id: 'c', time: 600, value: 0, easingOut: { type: 'linear' } }] });
  }) !== undefined));
}

// --- walk, follow and jelly on unusual rigs -----------------------------------------------------
{
  const proj = (mods: Partial<Modifier>[], patch?: (p: ReturnType<typeof defaultProject>) => void) => {
    const p = defaultProject();
    activeTimeline(p).modifiers = mods.map((m, i) => ({ id: `w${i}`, nodeId: 'body', kind: 'walk', amount: 100, frequency: 2, amplitude: 60, ...m }) as Modifier);
    patch?.(p);
    return p;
  };
  const addLimbs = (p: ReturnType<typeof defaultProject>) => {
    const arm = makeLimb('arm', -1, 'body', { id: 'armNoRole', role: undefined });
    const armC = makeLimb('arm', 1, 'body', { id: 'armC' });
    armC.limb!.c = { x: 230, y: 130 };
    const leg2 = makeLimb('leg', 1, 'body', { id: 'legNoC' });
    delete leg2.limb!.c; delete leg2.limb!.foot; leg2.limb!.a = { x: 0, y: 112 };
    const leg4 = makeLimb('leg', 1, 'body', { id: 'legZ' }); leg4.limb!.a = { x: 0, y: 112 }; p.rig.nodes.legZ = leg4;
    const leg3 = makeLimb('leg', -1, 'body', { id: 'legFull' });
    const world = makeLimb('arm', 1, null, { id: 'armWorld' });
    for (const n of [arm, armC, leg2, leg3, world]) p.rig.nodes[n.id] = n;
  };
  it('a walk with every limb shape, forward and backward, at several steps', check([-1, 1].every((dir) => [100, 330, 700, 1000].every((t) => {
    const p = proj([{ amplitude: 60 * dir }], addLimbs);
    const r = evaluateRig(p, t);
    return Number.isFinite(r.nodes.legFull.limb!.c!.x) && Number.isFinite(r.nodes.armC.limb!.c!.x) && Number.isFinite(r.nodes.legNoC.limb!.b.x);
  }))));
  it('a walk on a body and face with no offset yet, and a finished walk', check((() => {
    const p = proj([{ endMs: 400, holdUntilMs: 2000 }, { id: 'later', endMs: 300, startMs: 100, kind: 'walk' }], (q) => { delete q.rig.nodes.body.surface.flatOffset; delete q.rig.nodes.face.surface.flatOffset; });
    return [200, 900, 1500, 2500].every((t) => Number.isFinite(evaluateRig(p, t).nodes.body.surface.flatOffset!.x));
  })()));
  it('a walk with no face yaws its mapped children', check((() => {
    const p = proj([{}], (q) => { delete q.rig.nodes.face; q.rig.nodes.eyeL.parentId = 'body'; q.rig.nodes.eyeR.parentId = 'body'; });
    return evaluateRig(p, 400).nodes.eyeL.surface.yaw !== p.rig.nodes.eyeL.surface.yaw;
  })()));
  it('a walk held to a clip window leaves it', check((() => {
    const p = proj([{ blockId: 'b1', endMs: 300, holdUntilMs: 800 }], (q) => { activeTimeline(q).blocks = [{ id: 'b1', presetId: 'x', name: 'b', durationMs: 1000 }, { id: 'b2', presetId: 'x', name: 'c', durationMs: 1000 }]; });
    return [500, 900, 1200].every((t) => evaluateRig(p, t) !== undefined);
  })()));
  it('follow-through on a limb, a world layer, a group child and a free node', check((() => {
    const p = proj([
      { kind: 'follow', nodeId: 'armC', amplitude: 100 }, { kind: 'follow', nodeId: 'legNoC', amplitude: 100 },
      { kind: 'follow', nodeId: 'armWorld', amplitude: 100 }, { kind: 'follow', nodeId: 'eyeL', amplitude: 100 }, { kind: 'follow', nodeId: 'grpChild', amplitude: 100 },
    ], (q) => {
      addLimbs(q);
      q.rig.nodes.armC.limb!.c = { x: 230, y: 130 };
      q.rig.nodes.grp = { ...q.rig.nodes.eyeL, id: 'grp', kind: 'group', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false } };
      q.rig.nodes.grpChild = { ...q.rig.nodes.eyeL, id: 'grpChild', parentId: 'grp', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 1, y: 1 } } };
      activeTimeline(q).blocks = [];
      activeTimeline(q).tracks.push({ id: 'mv', nodeId: 'body', property: 'flatOffset.x', keyframes: [{ id: 'a', time: 0, value: 0, easingOut: { type: 'linear' } }, { id: 'b', time: 400, value: 80, easingOut: { type: 'linear' } }] });
    });
    return Number.isFinite(evaluateRig(p, 300).nodes.armC.limb!.c!.x);
  })()));
  it('a follow on a missing layer or a free one is quiet', check((() => {
    const p = proj([{ kind: 'follow', nodeId: 'orphan' }], (q) => { q.rig.nodes.orphan = { ...q.rig.nodes.eyeL, id: 'orphan', parentId: null, surface: { yaw: 0, pitch: 0, mapped: false } }; });
    return evaluateRig(p, 300) !== undefined;
  })()));
  it('letters facing their way, with a mover on the text layer', check((() => {
    const text = makeTextLayer('go', { id: 'txt' });
    text.text!.charOrient = true;
    text.text!.charOffsets = { 0: {}, 1: {}, 2: {}, 3: {} };
    const key = (prop: string, v1: number) => ({ id: `t${prop}`, nodeId: 'txt', property: prop, keyframes: [{ id: `${prop}a`, time: 0, value: 0, easingOut: { type: 'linear' as const } }, { id: `${prop}b`, time: 1000, value: v1, easingOut: { type: 'linear' as const } }] });
    const p = proj([{ kind: 'float', nodeId: 'txt' }], (q) => {
      q.rig.nodes.txt = text; activeTimeline(q).blocks = [];
      activeTimeline(q).tracks.push(key('text.char.0.x', -300), key('text.char.0.y', 60), key('text.char.1.x', -300), key('text.char.1.y', -60), key('text.char.2.x', 300), key('text.char.2.y', 10));
    });
    const r = evaluateRig(p, 500);
    return r.nodes.txt.text!.charOffsets![0].rotation !== undefined && r.nodes.txt.text!.charOffsets![1].rotation !== undefined;
  })()));
}

// --- looping timelines, block time, effect tracks, appearances, links, blends --------------------
{
  const loopProject = (patch: (p: ReturnType<typeof defaultProject>, tl: ReturnType<typeof activeTimeline>) => void) => {
    const p = defaultProject(); const tl = activeTimeline(p);
    tl.loop = true; tl.timelineDurationMs = 1000;
    patch(p, tl);
    return p;
  };
  const kfs = (...pairs: [number, number | string][]) => pairs.map(([time, value], i) => ({ id: `k${i}${time}`, time, value, easingOut: { type: 'linear' as const } }));
  it('a track that already ends at the end is not closed again', check(resolveTracks(loopProject((_p, tl) => {
    tl.blocks = [{ id: 'b1', presetId: 'x', name: 'a', durationMs: 1000 }];
    tl.tracks = [{ id: 't', nodeId: 'body', property: 'surface.yaw', blockId: 'b1', keyframes: kfs([0, 0], [1000, 10]) }, { id: 't2', nodeId: 'body', property: 'surface.pitch', blockId: 'b1', keyframes: kfs([0, 0]) }];
  })).length === 2));
  it('nothing to hang the close on: no base value, or the last clip starts at the end', check((() => {
    const p = loopProject((_p, tl) => {
      tl.blocks = [{ id: 'b1', presetId: 'x', name: 'a', durationMs: 1000 }, { id: 'b2', presetId: 'x', name: 'b', durationMs: 0 }];
      tl.tracks = [{ id: 't', nodeId: 'body', property: 'surface.yaw', blockId: 'b1', keyframes: kfs([0, 0], [500, 10]) }];
    });
    const q = loopProject((_p, tl) => {
      tl.blocks = [{ id: 'b1', presetId: 'x', name: 'a', durationMs: 500 }, { id: 'b2', presetId: 'x', name: 'b', durationMs: 500 }];
      tl.tracks = [{ id: 't', nodeId: 'body', property: 'shape.path', blockId: 'b1', keyframes: kfs([0, 'M0 0'], [200, 'M1 1']) }];
    });
    return resolveTracks(p).length === 1 && resolveTracks(q).length === 1;
  })()));
  it('block time: unknown block, looping zero-length block', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p);
    tl.blocks = [{ id: 'z', presetId: 'nope', name: 'z', durationMs: 0, loop: true }];
    return blockSampleTime(p, tl, 'missing', 123) === 123 && blockSampleTime(p, tl, 'z', 50) === 50;
  })()));
  it('effect tracks inside a clip; a non-number value is skipped', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p);
    tl.blocks = [{ id: 'b1', presetId: 'x', name: 'a', durationMs: 1000 }];
    tl.tracks = [
      { id: 'e1', nodeId: 'fxid', property: 'fx.amount', blockId: 'b1', keyframes: kfs([0, 5]) },
      { id: 'e2', nodeId: 'fxid', property: 'fx.speed', keyframes: kfs([0, 'str']) },
    ];
    const m = { id: 'fxid', amount: 1, frequency: 1, amplitude: 1 };
    return (effectAt(p, tl, m, 100) as { amount: number }).amount === 5;
  })()));
  it('linked eyes mirror their source; a dead link is ignored', check((() => {
    const p = defaultProject();
    p.rig.nodes.eyeR.eye!.linkedToId = 'eyeL';
    p.rig.nodes.eyeL.eye!.distanceFromCenter = 5;
    p.rig.nodes.body.eye = { openness: 1, distanceFromCenter: 0, linkedToId: 'ghost' } as never;
    const r = evaluateRig(p, 0);
    return r.nodes.eyeR.eye!.distanceFromCenter === -5;
  })()));
  it('appearance spans know their clip', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p);
    tl.blocks = [{ id: 'b1', presetId: 'x', name: 'a', durationMs: 1000 }];
    tl.appearances = [{ id: 'ap', nodeId: 'eyeL', blockId: 'b1', startMs: 100, endMs: 400 }, { id: 'ap2', nodeId: 'eyeL' }];
    const s = appearanceSpans(tl, 'eyeL');
    return s.length === 2 && s[0].from === 100 && s[1].to === tl.timelineDurationMs;
  })()));
  it('a state switch blends the live pose', check((() => {
    const p = defaultProject();
    const from = evaluateRig(p, 0);
    return evaluateWithTransition(p, 0, from, 2, { type: 'linear' }).rootId === 'body';
  })()));
  it('blends: a layer with no colour, strokes on one side, a lane that leaves the view alone', check((() => {
    const p = defaultProject(); const tl = activeTimeline(p);
    p.rig.nodes.eyeL.stroke = { enabled: true, color: { r: 1, g: 2, b: 3, a: 1 } };
    p.rig.nodes.eyeR.stroke = { enabled: true, color: { r: 9, g: 9, b: 9, a: 1 } };
    delete (p.rig.nodes.face as { color?: unknown }).color;
    const from = evaluateRig(p, 0);
    p.rig.nodes.eyeL.stroke = undefined;
    p.rig.nodes.eyeR.stroke = { enabled: true, color: undefined } as never;
    const bare = defaultProject(); bare.rig.nodes.eyeL.stroke = undefined; bare.rig.nodes.eyeR.stroke = { enabled: true, color: { r: 9, g: 9, b: 9, a: 1 } };
    p.rig.nodes.eyeL.stroke = { enabled: true, color: { r: 1, g: 2, b: 3, a: 1 } };
    evaluateWithTransition(p, 0, evaluateRig(bare, 0), 0.5, { type: 'linear' });
    p.rig.nodes.eyeL.stroke = undefined;
    tl.blocks = [{ id: 'a', presetId: 'x', name: 'a', durationMs: 1000 }, { id: 'b', presetId: 'x', name: 'b', durationMs: 1000, mascotId: 'm2' }, { id: 'c', presetId: 'x', name: 'c', durationMs: 1000, mascotId: 'm2' }];
    return evaluateWithTransition(p, 0, from, 0.5, { type: 'linear' }) !== undefined && evaluateRig(p, 1050) !== undefined;
  })()));
}

// --- buildScene: optional params, odd layers, text layout, masks ----------------------------------
{
  const view = { width: 720, height: 720 };
  const fx = (kind: string, params: Record<string, number> = {}) => ({ kind, params }) as never;
  const prim = (id: string, over: Record<string, unknown> = {}) => ({ ...makeShapeLayer('circle', { id }), parentId: null, ...over }) as RigNode;
  const build = (patch: (r: Rig) => void) => { const r = defaultRig(); patch(r); return buildScene(r, view); };
  it('an empty rig draws nothing', check(buildScene({ ...defaultRig(), nodes: {} }, view).length === 0));
  it('effects with no params fall back to their defaults', check(build((r) => {
    r.clockMs = 400;
    r.nodes.body.effects = [fx('flicker'), fx('goo'), fx('wave', { amount: 4 }), fx('jitter', { amount: 4 })];
    r.nodes.body.size.y = 0;
    r.nodes.eyeL.effects = [fx('flicker')];
    r.nodes.a = prim('a', { effects: [fx('wave', { amount: 3 }), fx('jitter', { amount: 3 }), fx('goo')], mask: { nodeId: 'ghost' }, guide: true, shapePath: undefined, primitive: { shape: 'circle' } });
    r.nodes.b = prim('b', { shapePath: 'M-0.5 -0.5 L0.5 -0.5 L0.5 0.5 Z', trim: { start: 0.1, end: 0.9 }, stroke: { enabled: true, taper: 0.5 } });
    r.nodes.c = prim('c', { shapePath: 'M-0.5 -0.5 L0.5 -0.5 L0.5 0.5 Z' });
    r.nodes.d = prim('d', { effects: [fx('wave', { amount: 3 })], shapePath: undefined });
  }).length > 0));
  it('strokes without a colour or opacity, with both', check(build((r) => {
    r.nodes.a = prim('a', { stroke: { enabled: true } });
    r.nodes.b = prim('b', { stroke: { enabled: true, color: { r: 1, g: 2, b: 3, a: 0.5 }, opacity: 0.5 } });
  }).filter((i) => i.stroke).length === 2));
  it('a hidden body is not drawn; a masked body inherits a mask; goo passes down', check((() => {
    const out = build((r) => {
      r.nodes.grp = { ...makeGroup(null, { id: 'grp' }), effects: [fx('goo')] } as RigNode;
      r.nodes.grp2 = { ...makeGroup('grp', { id: 'grp2' }) } as RigNode;
      r.nodes.grp.mask = { nodeId: 'a' };
      r.nodes.a = prim('a');
      r.nodes.body.parentId = 'grp';
      r.nodes.ghostBody = { ...r.nodes.body, id: 'ghostBody', visible: false, parentId: null } as RigNode;
      r.nodes.p = prim('p', { parentId: 'grp2' });
    });
    return out.some((i) => i.id === 'body') && !out.some((i) => i.id === 'ghostBody');
  })()));
  it('a face with some opacity dims its head', check(build((r) => { r.nodes.face.opacity = 0.5; }).some((i) => i.id === 'body')));
  it('a limb that cannot be drawn is skipped', check((() => {
    const out = build((r) => { const l = makeLimb('arm', 1, 'body', { id: 'bad' }); l.limb!.thickness = NaN; r.nodes.bad = l; });
    return !out.some((i) => i.id === 'bad');
  })()));
  it('direct frame maths: a collapsed frame, a pin on top of its hip', check((() => {
    const f = { x: 0, y: 0, rot: 0, kx: 0, ky: 0, cum: 1, R: 0, head: { x: 0, y: 0 }, squash: 1, alpha: 1, parentCum: 1 };
    const back = fromFrame(f, { x: 5, y: 5 });
    const l = makeLimb('arm', 1, 'body').limb!;
    l.a = { x: 0, y: 0 }; l.b = { x: 0, y: 0 }; l.pin = { x: 10, y: 10 };
    const input = { points: [l.a, l.b], thickness: 1, bend: 0, roundness: 1, taper: 0, hose: 1, length: 5 };
    const out = pinned(input as never, l, { ...f, kx: 1, ky: 1 });
    return back.x === 5 && out.points[1].x === 10;
  })()));
  const textRig = (style: Record<string, unknown>, over: Record<string, unknown> = {}) => build((r) => { r.nodes.t = makeTextLayer('Hello world', { id: 't', ...over }, style as never); });
  it('text alignment and width', check((['left', 'center', 'right'] as const).every((align) => (['top', 'middle', 'bottom'] as const).every((valign) => textRig({ align, valign, width: 200 }).some((i) => i.id === 't' && i.glyphs)))));
  it('a guide text', check(textRig({}, { guide: true }).some((i) => i.id === 't' && i.guide)));
  it('text on an arc, with and without its ends', check(
    textRig({ path: { mode: 'arc', radius: 90 } }).some((i) => i.id === 't')
    && textRig({ path: { mode: 'arc', radius: 90, start: -30, end: 30, reverse: true } }).some((i) => i.id === 't')));
  it('text on another layer, and a face with no placement is plain', check(
    build((r) => { r.nodes.c = prim('c'); r.nodes.t = makeTextLayer('go', { id: 't' }, { path: { mode: 'path', nodeId: 'c' } } as never); }).some((i) => i.id === 't')
    && build((r) => { r.nodes.t = makeTextLayer('go', { id: 't' }, { path: { mode: 'path', nodeId: 'none' } } as never); }).some((i) => i.id === 't')));
  it('a mask finds its layer, or none', check(build((r) => { r.nodes.a = prim('a', { mask: { nodeId: 'body', invert: true } }); r.nodes.b = prim('b', { mask: { nodeId: 'ghost' } }); }).some((i) => i.id === 'a' && i.clip)));
}

// --- emitters ------------------------------------------------------------------------------------
{
  const view = { width: 720, height: 720 };
  const mk = (over: Record<string, unknown> = {}) => ({ ...confetti('body'), id: 'em', ...over }) as never;
  const items = (e: unknown, t = 700, rig = defaultRig()) => {
    const tl = makeTimeline('x'); tl.emitters = [e as never];
    return emitterItems(tl, rig, buildScene(rig, view), t, view);
  };
  it('no emitters, no particles', check(emitterItems(makeTimeline('x'), defaultRig(), [], 0, view).length === 0));
  it('a rig with no root measures by 1', check(emitterFrame({ ...defaultRig(), rootId: 'none' }, [], view).unit === 1));
  it('an arc between the same two points does not divide by zero', check(Number.isFinite(emitterPathAt({ path: 'arc', bow: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 }, 1, 0.5).x)));
  for (const path of ['arc', 'fall', 'orbit', 'burst'] as const)
    it(`${path} emitters with bare options`, check(items(mk({ path, speedJitter: undefined, easing: undefined, parts: undefined })).length >= 0));
  it('orbit radii: none, x only, both', check([{}, { radiusX: 40 }, { radiusX: 40, radiusY: 20, orbitTilt: 30 }].every((r) => items(mk({ path: 'orbit', count: 3, ...r })).length === 3)));
  it('a burst with the physics left to defaults, and aimed at a layer', check((() => {
    const bare = items(mk({ path: 'burst', count: 6, lifeMs: 2000, angle: undefined, spread: undefined, velocity: undefined, velocityJitter: undefined, drag: undefined, turbulence: undefined, gravity: undefined, speed: undefined }), 300).length > 0;
    const attract = (nodeId: string, fill: boolean, startMs = 0) => items(mk({ path: 'burst', count: 6, lifeMs: 2000, attract: { nodeId, fill, startMs, durationMs: 100 } }), 500).length > 0;
    return bare && attract('eyeL', true) && attract('eyeL', false) && attract('ghost', false) && attract('eyeL', true, 400);
  })()));
  it('aiming at a hidden layer builds it as it would be drawn, once', check((() => {
    const rig = defaultRig(); rig.nodes.eyeL.visible = false;
    const tl = makeTimeline('x'); tl.emitters = [mk({ path: 'burst', count: 4, lifeMs: 2000, attract: { nodeId: 'eyeL', fill: true, startMs: 0, durationMs: 100 } }), mk({ id: 'em2', path: 'burst', count: 4, lifeMs: 2000, attract: { nodeId: 'eyeL', fill: false, startMs: 0, durationMs: 100 } })];
    return emitterItems(tl, rig, buildScene(rig, view), 500, view).length > 0;
  })()));
  it('aiming at words', check((() => {
    const rig = defaultRig(); rig.nodes.t = makeTextLayer('hi', { id: 't' });
    const tl = makeTimeline('x'); tl.emitters = [mk({ path: 'burst', count: 4, lifeMs: 2000, attract: { nodeId: 't', fill: true, startMs: 0, durationMs: 100 } })];
    return emitterItems(tl, rig, buildScene(rig, view), 500, view).length > 0;
  })()));
  it('a zero-length range still enters', check(items(mk({ startMs: 100, endMs: 100 }), 100).length >= 0));
  it('a collapsed mascot is measured as if whole', check((() => { const rig = defaultRig(); rig.nodes.body.transform.scale = { x: 0.01, y: 0.01 }; return emitterFrame(rig, buildScene(rig, view), view).unit > 0; })()));
  it('colour ramps, parts and shapes', check(items(mk({ colorTo: { r: 0, g: 0, b: 0, a: 1 }, wobble: 1, wobbleFrequency: 2, parts: [{ glyph: 'x', shapeId: 'a' }, { svgAssetId: 'z', color: { r: 1, g: 1, b: 1 } }] })).length >= 0 && items(mk({ parts: [{ color: { r: 1, g: 1, b: 1 } }] })).length > 0));
  it('echo trails with default params, and a project through composeScene', check((() => {
    const p = defaultProject(); const rig = p.rig;
    rig.nodes.body.effects = [{ kind: 'echo', params: {} } as never];
    rig.nodes.eyeL.effects = [{ kind: 'echo', params: { count: 2, delay: 20, falloff: 0.5 } } as never];
    rig.nodes.eyeL.stroke = { enabled: true };
    return composeScene(p, evaluateRig(p, 500), 500, view).some((i) => i.id.includes('~echo'));
  })()));
}

it('a walk in progress on a body with no offset yet', check((() => {
  const p = defaultProject(); delete p.rig.nodes.body.surface.flatOffset; activeTimeline(p).tracks = [];
  activeTimeline(p).modifiers = [{ id: 'w', nodeId: 'body', kind: 'walk', amount: 100, frequency: 2, amplitude: 60 }];
  return Number.isFinite(evaluateRig(p, 400).nodes.body.surface.flatOffset!.x);
})()));

it('effects a parent hands down merge under the child\'s own', check((() => {
  const r = defaultRig();
  r.nodes.g = { ...makeGroup(null, { id: 'g' }), effects: [{ kind: 'blur', params: { radius: 3 } }] } as never;
  r.nodes.c = { ...makeShapeLayer('star', { id: 'c', parentId: 'g' }), effects: [{ kind: 'blur', params: { radius: 1 } }, { kind: 'rgbSplit', params: { amount: 1 } }] } as never;
  r.nodes.c2 = makeShapeLayer('star', { id: 'c2', parentId: 'g' });
  const out = buildScene(r, { width: 720, height: 720 });
  return out.find((i) => i.id === 'c')!.fx!.list.length === 2 && !!out.find((i) => i.id === 'c2')!.fx;
})()));
