import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { faceOf, mascotLabel, mascotOf, mascotsOf } from '../core/mascot';
import { isInside, makeLimbPair } from '../core/layers';
import { applyEyeAction as writeEyeAction, applySquish, EYE_ACTIONS, SQUISH_PRESETS, squishPreset } from '../core/squish';
import { applyPose, POSES } from '../core/poses';
import { makeTimeline } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { compOf } from '../core/comp';
import { activeTimeline, type Project } from '../core/types';
import { MascotThumb, sceneBounds, unionBounds, type Bounds } from './Mascot';
import { PropRow } from './bits';
import type { RigNode } from '../core/types';

/**
 * A mascot's own sections: its rig (hands, legs, how rubbery they are) and whom it
 * follows. Its look is the Shape section and its colour the Fill — the same controls every
 * layer has, because a mascot's body is a layer.
 */
export function MascotRigSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const addLayer = useEditor((s) => s.addLayer);
  const commit = useEditor((s) => s.commit);
  const saveMascotTemplate = useEditor((s) => s.saveMascotTemplate);
  const rig = project.rig;
  const limbs = Object.values(rig.nodes).filter((n) => n.kind === 'limb' && isInside(rig, n.id, node.id));
  const arms = limbs.filter((n) => n.limb?.type === 'arm').length;
  const legs = limbs.filter((n) => n.limb?.type === 'leg').length;
  const hose = limbs.length ? limbs.every((n) => (n.limb?.hose ?? 1) >= 0.5) : true;
  const setHose = (v: number) => commit((p) => { for (const l of limbs) { const n = p.rig.nodes[l.id]; if (n?.limb) n.limb.hose = v; } }, `hose.${node.id}`);
  const saved = (project.mascotTemplates ?? []).length;
  const addFace = useEditor((s) => s.addFace);
  const select = useEditor((s) => s.select);
  const face = faceOf(rig, node.id);
  return (
    <>
      <div className="row" style={{ gap: 4 }}>
        {face
          ? <button className="btn sm" title="Select the face — move, turn or animate it apart from the body" onClick={() => select([face])}>Face</button>
          : <button className="btn sm" title="A face group for the eyes and hands, so they can move apart from the body" onClick={() => addFace(node.id)}>Add face</button>}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn sm" title="Two rubber-hose arms, a point for each hand" onClick={() => addLayer(makeLimbPair(rig, node.id, 'arm'))}>
          {arms ? `Hands (${arms})` : 'Add hands'}</button>
        <button className="btn sm" title="Two legs — hip, knee and ankle" onClick={() => addLayer(makeLimbPair(rig, node.id, 'leg'))}>
          {legs ? `Legs (${legs})` : 'Add legs'}</button>
      </div>
      {limbs.length > 0 && (
        <div className="row">
          <span className="prop-label" style={{ flex: 1 }}>Rubber hose</span>
          <div className="seg">
            <button aria-pressed={hose} onClick={() => setHose(1)}>On</button>
            <button aria-pressed={!hose} onClick={() => setHose(0)}>Off</button>
          </div>
        </div>
      )}
      {limbs.length > 0 && <PosePicker node={node} />}
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} title="Keep this mascot's look — its body, eyes and limbs — to add again from “+ Add”"
        onClick={() => saveMascotTemplate(node.id)}>Save to reuse{saved ? ` (${saved} saved)` : ''}</button>
    </>
  );
}

/** Whom this mascot follows. Never itself, never one that already follows it. */
export function MascotFollowSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const setAttachment = useEditor((s) => s.setAttachment);
  const rig = project.rig;
  const leaders = mascotsOf(rig).filter((m) => m.id !== node.id && !isInside(rig, m.id, node.id));
  const leader = node.parentId ? rig.nodes[node.parentId] : undefined;
  return (
    <>
      <div className="row">
        <span className="prop-label" style={{ width: 52 }}>Follows</span>
        <select className="sel" style={{ flex: 1, minWidth: 0 }} aria-label="Follows" value={node.parentId ?? ''}
          onChange={(e) => (e.target.value ? setAttachment(node.id, 'mascot', e.target.value) : setAttachment(node.id, 'world'))}>
          <option value="">No one — it stands on its own</option>
          {leaders.map((m) => <option key={m.id} value={m.id}>{mascotLabel(rig, m)}</option>)}
        </select>
      </div>
      <p className="hint">{leader
        ? `Moves, turns and scales with ${mascotLabel(rig, leader)}; its position is now an offset from it. Its head turn stays its own.`
        : 'A mascot that follows another rides along with it — a sidekick, or a crowd that moves as one.'}</p>
    </>
  );
}

/**
 * Squash and stretch, as two dials and a shelf of ready-made squishes.
 *
 * The presets are ACTIONS, not clips: Apply writes a few squish keyframes starting at the
 * playhead, over whatever is already there, and they are ordinary keyframes afterwards.
 * "From the feet" moves the anchor to the bottom so a squash stays on the ground.
 */
export function SquishSection({ node }: { node: RigNode }) {
  const applySquishPreset = useEditor((s) => s.applySquishPreset);
  const setValue = useEditor((s) => s.setValue);
  const playhead = useEditor((s) => s.playhead);
  const [pick, setPick] = useState(SQUISH_PRESETS[0].id);
  const bottom = node.kind === 'body' ? node.size.y || node.size.x : node.size.y / 2;
  const grounded = Math.abs((node.anchor?.y ?? 0) - bottom) < 0.5;
  return (
    <>
      <PropRow nodeId={node.id} property="squish.x" />
      <PropRow nodeId={node.id} property="squish.y" />
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Squish from</span>
        <div className="seg">
          <button aria-pressed={!grounded && !node.anchor?.y} title="Squash about the middle"
            onClick={() => { setValue(node.id, 'anchor.x', 0, `pivot.${node.id}`); setValue(node.id, 'anchor.y', 0, `pivot.${node.id}`); }}>Centre</button>
          <button aria-pressed={grounded} title="Squash about the bottom, so it stays on the ground"
            onClick={() => { setValue(node.id, 'anchor.x', 0, `pivot.${node.id}`); setValue(node.id, 'anchor.y', bottom, `pivot.${node.id}`); }}>Feet</button>
        </div>
      </div>
      <div className="divider" />
      <div className="row" style={{ gap: 4 }}>
        <select className="sel" style={{ flex: 1, minWidth: 0 }} aria-label="Squish preset" value={pick} onChange={(e) => setPick(e.target.value)}>
          {SQUISH_PRESETS.map((sp) => <option key={sp.id} value={sp.id} title={sp.blurb}>{sp.name}</option>)}
        </select>
        <button className="btn sm primary" title={`Write it as keyframes starting at ${(playhead / 1000).toFixed(2)}s`}
          onClick={() => applySquishPreset(node.id, pick)}>Apply</button>
      </div>
      <SquishPreview nodeId={node.id} presetId={pick} />
      <p className="hint">{SQUISH_PRESETS.find((sp) => sp.id === pick)?.blurb} — lands at the playhead as squish keyframes you can edit.</p>
    </>
  );
}

/**
 * Eye actions at the playhead: blink, squint, close — and the squish presets, onto these eyes.
 * Pick one to preview it looping on this mascot; Apply writes it. Like squish presets they are
 * keyframes the moment they land, nothing opaque.
 */
export function EyeActions({ eyeIds }: { eyeIds: string[] }) {
  const playhead = useEditor((s) => s.playhead);
  const applyEyeAction = useEditor((s) => s.applyEyeAction);
  const applySquishTo = useEditor((s) => s.applySquishTo);
  const [pick, setPick] = useState<string>(EYE_ACTIONS[0].id);
  const action = EYE_ACTIONS.find((a) => a.id === pick);
  const squish = action ? undefined : squishPreset(pick);
  const ids = eyeIds.join(' ');
  if (!eyeIds.length || (!action && !squish)) return null;
  const spanMs = action ? action.keys[action.keys.length - 1][0] : squish!.keys[squish!.keys.length - 1][0];
  const apply = () => (action ? applyEyeAction(eyeIds, action.id) : applySquishTo(eyeIds, squish!.id));
  return (
    <>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }} role="radiogroup" aria-label="Eye action">
        {EYE_ACTIONS.map((a) => (
          <button key={a.id} className="btn sm" role="radio" aria-checked={pick === a.id} aria-pressed={pick === a.id}
            title={a.blurb} onClick={() => setPick(a.id)}>{a.name}</button>
        ))}
      </div>
      <select className="sel" aria-label="Eye squish preset" value={squish ? pick : ''} onChange={(e) => e.target.value && setPick(e.target.value)}>
        <option value="">Squish the eyes…</option>
        {SQUISH_PRESETS.map((sp) => <option key={sp.id} value={sp.id} title={sp.blurb}>{sp.name}</option>)}
      </select>
      <ActionPreview label={action?.name ?? squish!.name} actionKey={`eyes.${ids}.${pick}`} spanMs={spanMs} focus={eyeIds}
        apply={(q) => { if (action) writeEyeAction(q, eyeIds, action.id, 0); else for (const id of eyeIds) applySquish(q, id, squish!.id, 0); }} />
      <div className="row">
        <span className="hint" style={{ flex: 1 }}>{action?.blurb ?? squish!.blurb}</span>
        <button className="btn sm primary" title={`Write it as keyframes starting at ${(playhead / 1000).toFixed(2)}s`} onClick={apply}>
          Apply at {(playhead / 1000).toFixed(2)}s
        </button>
      </div>
    </>
  );
}

/** Which part a layer plays. A shape or a group can be its mascot's face. */
export function RoleSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const setFaceRole = useEditor((s) => s.setFaceRole);
  const m = mascotOf(project.rig, node.id) ?? project.rig.nodes[project.rig.rootId];
  const isFace = node.role === 'face';
  return (
    <>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Role</span>
        <div className="seg" role="radiogroup" aria-label="Role">
          <button role="radio" aria-checked={!isFace} aria-pressed={!isFace} onClick={() => isFace && setFaceRole(node.id, false)}>Normal</button>
          <button role="radio" aria-checked={isFace} aria-pressed={isFace} title="Treat this as the face: the eyes and hands move onto it"
            onClick={() => !isFace && setFaceRole(node.id, true)}>Face</button>
        </div>
      </div>
      <p className="hint">
        {isFace
          ? `The face of ${m ? mascotLabel(project.rig, m) : 'its mascot'}: its eyes and hands ride it. Yaw and pitch make it look around.`
          : 'Make it the face and it goes onto its mascot, taking over the eyes and hands.'}
      </p>
    </>
  );
}

/**
 * The picked squish, playing on a still copy of this layer's mascot — so you can see what
 * Apply will do before it writes a single keyframe. Loops with a short rest between.
 */
function SquishPreview({ nodeId, presetId }: { nodeId: string; presetId: string }) {
  const preset = squishPreset(presetId);
  if (!preset) return null;
  return <ActionPreview label={preset.name} actionKey={`squish.${nodeId}.${presetId}`}
    spanMs={preset.keys[preset.keys.length - 1][0]} apply={(q) => { applySquish(q, nodeId, presetId, 0); }} />;
}

/**
 * A keyframe action played on a copy of this project, looping — what Apply will do, before
 * it does it. `focus` crops to those layers (a blink is too small to read on the whole mascot).
 * `actionKey` names the action: the copy is rebuilt only when it or the project changes.
 */
export function ActionPreview({ label, actionKey, spanMs, apply, focus }: {
  label: string; actionKey: string; spanMs: number; apply: (q: Project) => void; focus?: string[];
}) {
  const project = useEditor((s) => s.project);
  const focusKey = focus?.join(' ') ?? '';
  const temp = useMemo<Project>(() => {
    const tl = makeTimeline('action preview');
    // the layers this state owns stay drawn; nothing else animates
    tl.appearances = (activeTimeline(project).appearances ?? []).filter((a) => !a.blockId);
    tl.timelineDurationMs = spanMs + 400;
    const q: Project = { ...project, timelines: [tl], activeTimelineId: tl.id };
    apply(q);
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` is named by actionKey
  }, [project, actionKey, spanMs]);
  const box = useMemo<Bounds | null>(() => {
    let b: Bounds | null = null;
    const only = focusKey ? new Set(focusKey.split(' ')) : null;
    for (let t = 0; t <= spanMs; t += Math.max(20, spanMs / 8)) {
      const scene = sceneAt(temp, t, compOf(temp));
      b = unionBounds(b, sceneBounds(only ? scene.filter((x) => only.has(x.id)) : scene));
    }
    if (b && only) {
      // room around the eyes, so a squint reads against the face rather than filling the frame
      const w = b.x1 - b.x0, h = b.y1 - b.y0, m = Math.max(w, h) * 0.35;
      b = { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
    }
    return b;
  }, [temp, spanMs, focusKey]);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => { setT(Math.min(spanMs, (now - start) % (spanMs + 450))); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [temp, spanMs]);
  return (
    <div className="squish-preview" aria-label={`Preview of ${label}`}>
      <MascotThumb scene={sceneAt(temp, t, compOf(temp))} view={compOf(temp)} box={box} pad={10} />
    </div>
  );
}

/**
 * Poses as thumbnails of THIS mascot: click one and every hand and foot goes there — as
 * keyframes at the playhead ("Key it") or as its resting pose. Drag any hand or foot on the
 * stage afterwards to adjust.
 */
function PosePicker({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const apply = useEditor((s) => s.applyPose);
  const [keyed, setKeyed] = useState(true);
  // on the mascot's resting pose, no animation: cheap to redo, and it is the pose that shows
  const rig = project.rig;
  const owned = activeTimeline(project).appearances;
  const thumbs = useMemo(() => POSES.map((pose) => {
    const tl = makeTimeline('pose');
    tl.appearances = (owned ?? []).filter((a) => !a.blockId);
    const q: Project = { ...project, rig: structuredClone(rig), timelines: [tl], activeTimelineId: tl.id };
    applyPose(q, node.id, pose.id, 0, false);
    const all = sceneAt(q, 0, compOf(q));
    // just this mascot, framed on itself
    const mine = all.filter((s) => s.id === node.id || mascotOf(q.rig, s.id)?.id === node.id);
    return { pose, scene: mine };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rig, owned, node.id]);
  return (
    <>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Pose</span>
        <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Write the pose as keyframes at the playhead">
          <input type="checkbox" checked={keyed} onChange={(e) => setKeyed(e.target.checked)} /> key it
        </label>
      </div>
      <div className="pose-grid">
        {thumbs.map(({ pose, scene }) => (
          <button key={pose.id} className="pose-cell" title={`${pose.name} — ${pose.blurb}`} onClick={() => apply(node.id, pose.id, keyed)}>
            <MascotThumb scene={scene} view={compOf(project)} pad={8} />
            <span>{pose.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
