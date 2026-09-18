import { useRef, useState } from 'react';
import { activeTimeline } from '../core/types';
import { useEditor } from '../core/store';
import { cssColor } from '../core/color';
import { shapeById, SHAPE_LIBRARY, libraryOutline } from '../core/emitters';
import { attachmentOf, layerOrder, makeLimbPair, makeShapeLayer, makeSvgLayer, ROLE_LABEL, rolesFor, absentHere } from '../core/layers';
import { naturalOutline, PRIMITIVE_SHAPES, primitivePath } from '../core/path';
import { looksLikeSvg } from '../core/svg';
import { MASCOT_KINDS, mascotLabel, mascotOf, mascotsOf, type MascotKind } from '../core/mascot';
import { Icon, Panel, useDismiss } from './bits';
import type { RigNode, ShapeKind } from '../core/types';

type Tray = null | 'add' | 'shape' | 'svg';

/**
 * The layers, as a small Figma-style list: front at the top, each mascot's own parts
 * indented under it, world layers beside them.
 *
 * The order shown IS the draw order — both read `zIndex`, through `layerOrder` — so
 * dragging a row is exactly what changes what paints over what on the stage and in the
 * export. There is no second ordering for this panel to disagree with. A mascot drags as
 * one, parts and all.
 */
export function Layers() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const addLayer = useEditor((s) => s.addLayer);
  const addMascot = useEditor((s) => s.addMascot);
  const addText = useEditor((s) => s.addText);
  const setTool = useEditor((s) => s.setTool);
  const deleteNode = useEditor((s) => s.deleteNode);
  const updateNode = useEditor((s) => s.updateNode);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const groupLayers = useEditor((s) => s.groupLayers);
  const ungroupLayer = useEditor((s) => s.ungroupLayer);
  const playhead = useEditor((s) => s.playhead);
  const file = useRef<HTMLInputElement>(null);
  const [tray, setTray] = useState<Tray>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const setRole = useEditor((s) => s.setRole);
  const showLayersIn = useEditor((s) => s.showLayersIn);
  /** where a dragged layer would land: in front of, behind, or INTO the row under the pointer */
  const [drop, setDrop] = useState<{ id: string; front: boolean; into?: boolean } | null>(null);
  const moveInto = useEditor((s) => s.moveInto);
  const [note, setNote] = useState<string | null>(null);
  const [svgText, setSvgText] = useState('');

  const rig = project.rig;
  const order = layerOrder(rig);
  const rank = new Map(order.map((n, i) => [n.id, i]));
  // front first, as every layer panel reads
  const kids = (parentId: string | null) => Object.values(rig.nodes)
    .filter((n) => n.parentId === parentId && n.id !== rig.rootId)
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));

  // layers owned by another state: listed (dimmed) so they can be brought back
  const absent = Object.keys(rig.nodes).filter((id) => absentHere(project, id));
  const rows: { node: RigNode; depth: number; head?: boolean }[] = [];
  const walk = (n: RigNode, depth: number) => {
    rows.push({ node: n, depth });
    // the head is drawn by the face: show it there, as the part of the face it is
    if (n.kind === 'group' && n.role === 'face' && n.parentId && rig.nodes[n.parentId]?.kind === 'body') {
      rows.push({ node: rig.nodes[n.parentId], depth: depth + 1, head: true });
    }
    for (const c of kids(n.id)) walk(c, depth + 1);
  };
  // the mascots and the world layers interleave by their own draw order at the top level
  const tops = [rig.nodes[rig.rootId], ...kids(null)].filter(Boolean)
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
  for (const t of tops) walk(t, 0);

  const sel = selection.map((id) => rig.nodes[id]).filter((n): n is RigNode => !!n);
  const one = sel.length === 1 ? sel[0] : null;
  const isRoot = (n: RigNode) => n.id === rig.rootId;
  // hands and legs go on the mascot being worked on
  const current = mascotOf(rig, selection[0]) ?? rig.nodes[rig.rootId];
  const many = mascotsOf(rig).length > 1;

  const addShape = (shape: string) => {
    setTray(null);
    const kind = (PRIMITIVE_SHAPES as string[]).includes(shape) ? (shape as ShapeKind) : 'circle';
    const node = makeShapeLayer(kind, { name: shapeById(shape)?.name ?? 'Shape', shape: { kind: shape } });
    const d = libraryOutline(shape);
    if (d) node.shapePath = d;
    addLayer(node);
  };

  /** Markup → a layer at the playhead. False (with a note) when it is not SVG we can read. */
  const importText = (text: string, name?: string, label = 'That'): boolean => {
    const made = makeSvgLayer(text, name);
    if (!made) { setNote(`${label} is not an SVG this can read.`); return false; }
    addLayer(made.node, { appearAt: playhead });
    setNote(made.warnings.length ? `Imported ${made.node.name} — not carried over: ${made.warnings.join('; ')}` : null);
    return true;
  };
  const importFile = async (f: File) => { importText(await f.text(), f.name.replace(/\.svg$/i, ''), f.name); };
  const closeTray = () => { setTray(null); setSvgText(''); };
  const addBtn = useRef<HTMLButtonElement>(null), trayRef = useRef<HTMLDivElement>(null);
  // a pasted-but-not-imported SVG is a draft worth keeping: only the add and shape trays close by themselves
  useDismiss(tray === 'add' || tray === 'shape', closeTray, [addBtn, trayRef]);
  const pasteClipboard = async () => {
    try {
      if (importText(await navigator.clipboard.readText(), undefined, 'The clipboard')) closeTray();
    } catch {
      setNote('The browser blocked clipboard access — paste into the box with ⌘V instead.');
    }
  };

  /** Top half of a row means "in front of it". */
  /** a layer another can be moved into: groups, the face, shapes, SVG, mascots — not eyes, limbs or text */
  const canHold = (n: RigNode) => n.kind === 'group' || n.kind === 'body' || n.kind === 'primitive' || n.kind === 'svgLayer';

  const onDrop = (target: RigNode, front: boolean, dragged: string, into?: boolean) => {
    setDrop(null);
    if (dragged === target.id) return;
    if (into) { moveInto(dragged, target.id); return; }
    const ids = order.map((n) => n.id).filter((id) => id !== dragged);
    const t = ids.indexOf(target.id);
    reorderLayer(dragged, front ? t + 1 : t);
  };

  return (
    <Panel title="Layers" actions={
      <button ref={addBtn} className="btn sm add-btn" aria-expanded={tray !== null} title="Add a mascot, text, a curve, a shape or an SVG"
        onClick={() => (tray ? closeTray() : setTray('add'))}><Icon name="plus" size={12} />Add</button>
    }>
      <input ref={file} type="file" accept=".svg,image/svg+xml" multiple hidden
        onChange={(e) => { for (const f of [...(e.target.files ?? [])]) void importFile(f); e.target.value = ''; closeTray(); }} />
      {/* trays in the panel's own flow: a popover here is clipped by .panel's overflow */}
      {tray === 'add' && (
        <div ref={trayRef} className="add-tray" role="menu" aria-label="Add" onKeyDown={(e) => { if (e.key === 'Escape') closeTray(); }}>
          <span className="add-tray-label">Mascot</span>
          <div className="add-mascots">
            {(Object.keys(MASCOT_KINDS) as MascotKind[]).map((k) => (
              <button key={k} role="menuitem" className="add-mascot" title={MASCOT_KINDS[k].blurb}
                onClick={() => { addMascot(k); closeTray(); }}>
                <MascotGlyph color={MASCOT_KINDS[k].color} shape={MASCOT_KINDS[k].shape} />
                <span>{MASCOT_KINDS[k].label}</span>
              </button>
            ))}
            {(project.mascotTemplates ?? []).map((t) => {
              const body = t.nodes.find((n) => n.kind === 'body');
              return (
                <button key={t.id} role="menuitem" className="add-mascot" title={`Your saved mascot “${t.name}”`}
                  onClick={() => { addMascot({ templateId: t.id }); closeTray(); }}>
                  <MascotGlyph color={body?.color} path={body?.shapePath} />
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
          <span className="add-tray-label">Layer</span>
          <div className="add-layers">
            <button role="menuitem" className="add-layer" onClick={() => { addText(); closeTray(); }}><Icon name="text" />Text<kbd>T</kbd></button>
            <button role="menuitem" className="add-layer" title="Draw it on the stage, point by point"
              onClick={() => { setTool('pen'); closeTray(); }}><Icon name="pen" />Curve<kbd>P</kbd></button>
            <button role="menuitem" className="add-layer" onClick={() => setTray('shape')}><Icon name="shape" />Shape</button>
            <button role="menuitem" className="add-layer" onClick={() => setTray('svg')}><Icon name="svg" />SVG</button>
            {current && <>
            <button role="menuitem" className="add-layer" title={`Two rubber-hose arms on ${mascotLabel(rig, current)}`}
              onClick={() => { addLayer(makeLimbPair(rig, current.id, 'arm')); closeTray(); }}><Icon name="hand" />Hands</button>
            <button role="menuitem" className="add-layer" title={`Two legs on ${mascotLabel(rig, current)}`}
              onClick={() => { addLayer(makeLimbPair(rig, current.id, 'leg')); closeTray(); }}><Icon name="leg" />Legs</button>
            </>}
          </div>
          {many && current && <p className="hint" style={{ margin: 0 }}>Hands and legs go on {mascotLabel(rig, current)} — select another mascot to give them to it.</p>}
        </div>
      )}
      {tray === 'shape' && (
        <div ref={trayRef} className="shape-grid tray" role="listbox" aria-label="Add a shape">
          {SHAPE_LIBRARY.map((s) => (
            <button key={s.id} className="shapepick-cell" title={s.name} onClick={() => addShape(s.id)}>
              <svg viewBox={s.viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: s.markup }} />
            </button>
          ))}
        </div>
      )}
      {tray === 'svg' && (
        <div ref={trayRef} className="svg-import" role="group" aria-label="Import an SVG" onKeyDown={(e) => { if (e.key === 'Escape') closeTray(); }}>
          <textarea className="ask svg-paste" autoFocus spellCheck={false} aria-label="SVG markup"
            placeholder="Paste SVG markup here (⌘V)" value={svgText} onChange={(e) => setSvgText(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text');
              if (looksLikeSvg(t) && importText(t)) { e.preventDefault(); closeTray(); }
            }} />
          <div className="row">
            <button className="btn sm" disabled={!svgText.trim()} onClick={() => { if (importText(svgText)) closeTray(); }}>Add layer</button>
            <button className="btn ghost sm" onClick={() => void pasteClipboard()}>From clipboard</button>
            <button className="btn ghost sm" onClick={() => file.current?.click()}>File…</button>
          </div>
        </div>
      )}
      {note && <p className="hint" role="status">{note}</p>}

      {absent.length > 0 && (
        <div className="row absent-note" role="status">
          <span className="hint" style={{ flex: 1 }}>{absent.length} layer{absent.length === 1 ? '' : 's'} from other states {absent.length === 1 ? 'is' : 'are'} not in “{activeTimeline(project).name}”.</span>
          <button className="btn sm" title="Show them in this state too" onClick={() => showLayersIn(absent, 'here')}>Show here</button>
        </div>
      )}
      <div className="layer-list" role="tree" aria-label="Layers" aria-multiselectable>
        {rows.map(({ node, depth, head }) => {
          const locked = !!node.locked;
          const mascot = node.kind === 'body';
          const attached = !mascot && attachmentOf(node) === 'mascot';
          if (head) {
            return (
              <div key={`${node.id}.head`} role="treeitem" aria-selected={selection.includes(node.id)} className="layer"
                data-depth={Math.min(depth, 4)} title="The head shape — it moves, turns and scales with the face. Selecting it selects the mascot."
                onPointerDown={() => select([node.id])}>
                <span className="layer-btn" aria-hidden />
                <LayerThumb node={node} />
                <span className="layer-name">Head shape</span>
                <span className="kind">{node.shape?.kind ?? 'circle'}</span>
                <span className="layer-btn" aria-hidden />
              </div>
            );
          }
          return (
            <div key={node.id} role="treeitem" aria-selected={selection.includes(node.id)} className="layer"
              data-depth={Math.min(depth, 4)} data-drop={drop?.id === node.id ? (drop.into ? 'into' : drop.front ? 'front' : 'back') : undefined}
              data-hidden={!node.visible || absent.includes(node.id) || undefined} data-mascot={mascot || undefined}
              draggable={renaming !== node.id}
              onDragStart={(e) => { e.dataTransfer.setData('text/blooby-layer', node.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/blooby-layer')) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const f = (e.clientY - r.top) / r.height;
                // the middle of a row that can hold layers means "put it inside"; its edges, "beside"
                const into = f > 0.28 && f < 0.72 && canHold(node);
                setDrop({ id: node.id, front: f < 0.5, into });
              }}
              onDragLeave={() => setDrop((d) => (d?.id === node.id ? null : d))}
              onDrop={(e) => { const id = e.dataTransfer.getData('text/blooby-layer'); if (id) onDrop(node, !!drop?.front, id, drop?.into); }}
              onPointerDown={(e) => {
                if (renaming === node.id) return;
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  select(selection.includes(node.id) ? selection.filter((id) => id !== node.id) : [...selection, node.id]);
                } else select([node.id]);
              }}
              onDoubleClick={() => setRenaming(node.id)}>
              <button className="layer-btn" title={node.visible ? 'Hide' : 'Show'} aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => updateNode(node.id, (n) => { n.visible = !n.visible; })}>
                <Icon name={node.visible ? 'eye' : 'eyeOff'} />
              </button>
              <LayerThumb node={node} />
              {renaming === node.id ? (
                <input className="txt layer-rename" autoFocus defaultValue={mascot ? mascotLabel(rig, node) : node.name} aria-label="Layer name"
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) updateNode(node.id, (n) => { n.name = v; }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
              ) : <span className="layer-name">{mascot ? mascotLabel(rig, node) : node.name}</span>}
              {absent.includes(node.id) && (
                <button className="btn ghost sm layer-here" title={`Not in “${activeTimeline(project).name}” — made in another state. Click to show it here; ⇧-click to share it with every state.`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => showLayersIn([node.id], e.shiftKey ? 'everywhere' : 'here')}>+ here</button>
              )}
              {attached && node.kind !== 'eye' && node.kind !== 'limb' && (
                <span className="layer-badge" title={node.surface.mapped ? 'Attached to its mascot, on the surface' : `Attached to ${rig.nodes[node.parentId!]?.name ?? 'its parent'}`}><Icon name="anchor" size={11} /></span>
              )}
              {mascot && node.parentId && (
                <span className="layer-badge" title={`Follows ${mascotLabel(rig, rig.nodes[node.parentId] ?? node)}`}><Icon name="anchor" size={11} /></span>
              )}
              {!mascot && attachmentOf(node) === 'world' && (
                <span className="layer-badge" title="A world layer — stays put when the mascots move"><Icon name="world" size={11} /></span>
              )}
              {roleFor === node.id ? (
                <select className="sel layer-role" autoFocus aria-label={`Role of ${node.name}`} value={node.role ?? ''}
                  onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                  onChange={(e) => { setRole(node.id, e.target.value); setRoleFor(null); }}
                  onBlur={() => setRoleFor(null)} onKeyDown={(e) => { if (e.key === 'Escape') setRoleFor(null); }}>
                  {rolesFor(node).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              ) : (
                <span className="kind" title={`${node.role ? ROLE_LABEL[node.role] ?? node.role : 'No role'} — double-click to change its role`}
                  onDoubleClick={(e) => { e.stopPropagation(); setRoleFor(node.id); }}>
                  {node.guide ? 'guide' : node.curve ? 'curve' : node.role && node.kind !== 'body' ? ROLE_LABEL[node.role]?.replace(/^(Left|Right) /, '') ?? node.role : KIND_LABEL[node.kind]}
                </span>
              )}
              <button className="layer-btn lock" data-on={locked} title={locked ? 'Unlock' : 'Lock — cannot be selected or moved on the stage'}
                aria-label={locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => updateNode(node.id, (n) => { n.locked = !n.locked; })}>
                <Icon name={locked ? 'lock' : 'unlock'} />
              </button>
            </div>
          );
        })}
      </div>

      {sel.length > 0 && (
        <div className="layer-actions" role="toolbar" aria-label="Arrange">
          <button className="btn ghost sm icon" title="Bring to front" disabled={!one} onClick={() => one && reorderLayer(one.id, 'front')}><Icon name="front" /></button>
          <button className="btn ghost sm icon" title="Bring forward" disabled={!one} onClick={() => one && reorderLayer(one.id, 'forward')}><Icon name="up" /></button>
          <button className="btn ghost sm icon" title="Send backward" disabled={!one} onClick={() => one && reorderLayer(one.id, 'backward')}><Icon name="down" /></button>
          <button className="btn ghost sm icon" title="Send to back" disabled={!one} onClick={() => one && reorderLayer(one.id, 'back')}><Icon name="back" /></button>
          <span className="spacer" />
          {one?.kind === 'group'
            ? <button className="btn ghost sm" title="Ungroup — the children stay where they are" onClick={() => ungroupLayer(one.id)}>Ungroup</button>
            : <button className="btn ghost sm icon" title="Group selection" disabled={!sel.length || sel.some((n) => n.kind === 'body')} onClick={() => groupLayers(sel.map((n) => n.id))}><Icon name="group" /></button>}
          {one && one.parentId !== null && one.kind !== 'eye' && (
            <button className="btn ghost sm" title={`Move out of ${rig.nodes[one.parentId]?.name ?? 'its parent'} — it stays where it is on screen`}
              onClick={() => { const up = rig.nodes[one.parentId!]; moveInto(one.id, up?.kind === 'body' ? null : up?.parentId ?? null); }}>Move out</button>
          )}
          <button className="btn ghost sm icon" title="Duplicate (⌘D)" disabled={!one} onClick={() => one && duplicateLayer(one.id)}><Icon name="copy" /></button>
          <button className="btn ghost sm icon danger-icon" title="Delete (⌫)" disabled={sel.every(isRoot)}
            onClick={() => { for (const n of sel) if (!isRoot(n)) deleteNode(n.id); }}><Icon name="trash" /></button>
        </div>
      )}
    </Panel>
  );
}

const KIND_LABEL: Record<string, string> = { body: 'mascot', eye: 'eye', group: 'grp', svgLayer: 'svg', primitive: 'shape', limb: 'limb', text: 'text' };

/** A mascot look in miniature: its body outline in its colour, and two eyes. */
function MascotGlyph({ color, shape, path }: { color?: RigNode['color']; shape?: string; path?: string }) {
  const d = path ?? (shape ? primitivePath(shape as ShapeKind) : primitivePath('circle'));
  return (
    <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden>
      <path d={d} fill={cssColor({ ...(color ?? { r: 242, g: 239, b: 233, a: 1 }), a: 1 })} stroke="rgba(10,10,10,.18)" strokeWidth={0.03} />
      <ellipse cx={-0.13} cy={-0.04} rx={0.045} ry={0.08} fill="#141318" />
      <ellipse cx={0.13} cy={-0.04} rx={0.045} ry={0.08} fill="#141318" />
    </svg>
  );
}

/** A 16px picture of what the layer draws — its outline in its own colour. */
function LayerThumb({ node }: { node: RigNode }) {
  const paint = node.curve ? node.stroke?.color ?? node.color : node.color;
  const fill = cssColor({ ...paint, a: 1 });
  let body;
  if (node.kind === 'limb') {
    body = <path d={node.limb?.type === 'leg' ? 'M-0.1 -0.45 C0.2 -0.1 0.1 0.2 -0.05 0.35 L0.35 0.35' : 'M-0.4 0.3 C-0.1 0.35 0.2 0 0.3 -0.35'}
      fill="none" stroke={fill} strokeWidth={0.2} strokeLinecap="round" />;
  } else if (node.kind === 'text') {
    body = <text x={0} y={0.22} textAnchor="middle" fontSize={0.72} fontWeight={700} fill={fill}>T</text>;
  } else if (node.curve && node.shapePath) {
    body = <path d={node.shapePath} fill="none" stroke={fill} strokeWidth={0.12} strokeLinecap="round" transform="scale(0.85)" />;
  } else if (node.kind === 'svgLayer' && node.svg?.paths) {
    body = <g transform="scale(0.9)">{node.svg.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill === null ? 'none' : p.fill ? cssColor(p.fill) : fill} stroke={p.stroke ? cssColor(p.stroke) : undefined} strokeWidth={p.stroke ? 0.06 : undefined} />)}</g>;
  } else if (node.kind === 'group') {
    body = <rect x={-0.42} y={-0.3} width={0.84} height={0.6} rx={0.1} fill="none" stroke="currentColor" strokeWidth={0.1} />;
  } else if (node.kind === 'svgLayer') {
    body = <text x={0} y={0.15} textAnchor="middle" fontSize={0.45} fill="currentColor">svg</text>;
  } else {
    body = <path d={naturalOutline(node)} fill={fill} transform="scale(0.9)" />;
  }
  // a dark layer on the dark tile is invisible (the eyes were black on black), so the tile
  // flips to the light surface for anything darker than mid-grey
  const { r, g, b } = paint;
  const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  return <svg className={`layer-thumb${dark ? ' on-light' : ''}`} viewBox="-0.55 -0.55 1.1 1.1" aria-hidden>{body}</svg>;
}
