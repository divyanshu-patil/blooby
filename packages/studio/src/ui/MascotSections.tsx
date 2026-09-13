import { useEditor } from '../core/store';
import { mascotLabel, mascotsOf } from '../core/mascot';
import { isInside, makeLimbPair } from '../core/layers';
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
  return (
    <>
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
