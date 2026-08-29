import { it } from 'vitest';
import { check, near, rig } from './testkit';
import { buildScene, evaluateRig, lerpAngle, resolveTracks, sampleTrack, sceneAt, valueAt } from './scene';
import { confetti, defaultProject } from './defaults';
import { relayoutBlocks } from './timeline';
import { useEditor } from './store';
import { activeTimeline } from './types';
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
        const proj = defaultProject();
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
  // its *contribution* 250ms into Blink (starts at 2400ms) must match a global one's
  // contribution 250ms into t=0, not 2650ms in. Compares deltas against the same
  // no-modifier baselines, so the unrelated keyframed motion each preset already does at
  // that absolute time (which legitimately differs between t=250 and t=2650) cancels out.
  const globalEquivalent = defaultProject();
  activeTimeline(globalEquivalent).modifiers.push({ id: 'gm', nodeId: globalEquivalent.rig.rootId, kind: 'stretch', amount: 100, frequency: 1, amplitude: 20 });
  const globalAt250 = buildScene(evaluateRig(globalEquivalent, 250), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const globalAt2650 = buildScene(evaluateRig(globalEquivalent, 2650), { width: 720, height: 720 }).find((s) => s.id === 'body')!;
  const insideDelta = inside.w - baseline2650.w;
  const global250Delta = globalAt250.w - baseline250.w;
  const global2650Delta = globalAt2650.w - baseline2650.w;
  it('a clip-scoped effect phases from its own clip start, not absolute timeline time', check(Math.abs(insideDelta - global250Delta) < 0.05 && Math.abs(insideDelta - global2650Delta) > 5, `Δinside=${insideDelta} vs Δglobal@250=${global250Delta} vs Δglobal@2650=${global2650Delta}`));

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
