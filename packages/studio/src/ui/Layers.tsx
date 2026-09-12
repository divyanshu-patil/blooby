import { useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { cssColor } from '../core/color';
import { shapeById, SHAPE_LIBRARY, libraryOutline } from '../core/emitters';
import { attachmentOf, layerOrder, makeLimb, makeShapeLayer, makeSvgLayer } from '../core/layers';
import { naturalOutline, PRIMITIVE_SHAPES } from '../core/path';
import { Icon, Panel } from './bits';
import type { RigNode, ShapeKind } from '../core/types';

/**
 * The layers, as a small Figma-style list: front at the top, the mascot's own parts
 * indented under it, world layers beside it.
 *
 * The order shown IS the draw order — both read `zIndex`, through `layerOrder` — so
 * dragging a row is exactly what changes what paints over what on the stage and in the
 * export. There is no second ordering for this panel to disagree with.
 */
export function Layers() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const addLayer = useEditor((s) => s.addLayer);
  const deleteNode = useEditor((s) => s.deleteNode);
  const updateNode = useEditor((s) => s.updateNode);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const groupLayers = useEditor((s) => s.groupLayers);
  const ungroupLayer = useEditor((s) => s.ungroupLayer);
  const playhead = useEditor((s) => s.playhead);
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; front: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const rig = project.rig;
  const order = layerOrder(rig);
  const rank = new Map(order.map((n, i) => [n.id, i]));
  // front first, as every layer panel reads
  const kids = (parentId: string | null) => Object.values(rig.nodes)
    .filter((n) => n.parentId === parentId && n.id !== rig.rootId)
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));

  const rows: { node: RigNode; depth: number }[] = [];
  const walk = (n: RigNode, depth: number) => {
    rows.push({ node: n, depth });
    for (const c of kids(n.id)) walk(c, depth + 1);
  };
  // the mascot and the world layers interleave by their own draw order at the top level
  const tops = [rig.nodes[rig.rootId], ...kids(null)].filter(Boolean)
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
  for (const t of tops) walk(t, 0);

  const sel = selection.map((id) => rig.nodes[id]).filter((n): n is RigNode => !!n);
  const one = sel.length === 1 ? sel[0] : null;
  const isRoot = (n: RigNode) => n.id === rig.rootId;

  const addShape = (shape: string) => {
    setPicking(false);
    const kind = (PRIMITIVE_SHAPES as string[]).includes(shape) ? (shape as ShapeKind) : 'circle';
    const node = makeShapeLayer(kind, { name: shapeById(shape)?.name ?? 'Shape', shape: { kind: shape } });
    const d = libraryOutline(shape);
    if (d) node.shapePath = d;
    addLayer(node);
  };

  const addLimbs = (type: 'arm' | 'leg') => {
    // a pair, as one undo step; a side that is already there is not doubled
    const have = (side: number) => Object.values(rig.nodes).some((n) => n.limb?.type === type && Math.sign(n.limb.a.x) === side);
    const make = ([-1, 1] as const).filter((s) => !have(s));
    addLayer((make.length ? make : [1 as const]).map((s) => makeLimb(type, s, rig.rootId)));
  };

  const importFile = async (f: File) => {
    const made = makeSvgLayer(await f.text(), f.name.replace(/\.svg$/i, ''));
    if (!made) { setNote(`${f.name} is not an SVG this can read.`); return; }
    addLayer(made.node, { appearAt: playhead });
    setNote(made.warnings.length ? `Imported ${made.node.name} — not carried over: ${made.warnings.join('; ')}` : null);
  };

  /** Top half of a row means "in front of it". */
  const onDrop = (target: RigNode, front: boolean, dragged: string) => {
    setDrop(null);
    if (dragged === target.id) return;
    const ids = order.map((n) => n.id).filter((id) => id !== dragged);
    const t = ids.indexOf(target.id);
    reorderLayer(dragged, front ? t + 1 : t);
  };

  return (
    <Panel title="Layers" actions={
      <>
        <div className="shape-pick" style={{ flex: 'none' }}>
          <button className="btn ghost sm icon" title="Add a shape" aria-expanded={picking} onClick={() => setPicking((v) => !v)}><Icon name="shape" /></button>
          {picking && (
            <div className="shape-grid" style={{ left: 'auto', right: 0 }} role="listbox" aria-label="Add a shape">
              {SHAPE_LIBRARY.map((s) => (
                <button key={s.id} className="shapepick-cell" title={s.name} onClick={() => addShape(s.id)}>
                  <svg viewBox={s.viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: s.markup }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost sm icon" title="Import an SVG (or just paste one anywhere)" onClick={() => file.current?.click()}><Icon name="svg" /></button>
        <button className="btn ghost sm icon" title="Add hands — two points each, a rubber-hose arm" onClick={() => addLimbs('arm')}><Icon name="hand" /></button>
        <button className="btn ghost sm icon" title="Add legs — hip, knee and ankle" onClick={() => addLimbs('leg')}><Icon name="leg" /></button>
      </>
    }>
      <input ref={file} type="file" accept=".svg,image/svg+xml" multiple hidden
        onChange={(e) => { for (const f of [...(e.target.files ?? [])]) void importFile(f); e.target.value = ''; }} />
      {note && <p className="hint" role="status">{note}</p>}

      <div className="layer-list" role="tree" aria-label="Layers" aria-multiselectable>
        {rows.map(({ node, depth }) => {
          const locked = !!node.locked;
          const attached = !isRoot(node) && attachmentOf(node) === 'mascot';
          return (
            <div key={node.id} role="treeitem" aria-selected={selection.includes(node.id)} className="layer"
              data-depth={Math.min(depth, 4)} data-drop={drop?.id === node.id ? (drop.front ? 'front' : 'back') : undefined}
              data-hidden={!node.visible || undefined}
              draggable={!isRoot(node) && renaming !== node.id}
              onDragStart={(e) => { e.dataTransfer.setData('text/blooby-layer', node.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/blooby-layer')) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrop({ id: node.id, front: e.clientY < r.top + r.height / 2 });
              }}
              onDragLeave={() => setDrop((d) => (d?.id === node.id ? null : d))}
              onDrop={(e) => { const id = e.dataTransfer.getData('text/blooby-layer'); if (id) onDrop(node, !!drop?.front, id); }}
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
                <input className="txt layer-rename" autoFocus defaultValue={node.name} aria-label="Layer name"
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) updateNode(node.id, (n) => { n.name = v; }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
              ) : <span className="layer-name">{isRoot(node) ? 'Mascot' : node.name}</span>}
              {attached && depth === 1 && node.kind !== 'eye' && node.kind !== 'limb' && (
                <span className="layer-badge" title={node.surface.mapped ? 'Attached to the mascot, on its surface' : 'Attached to the mascot'}><Icon name="anchor" size={11} /></span>
              )}
              {!isRoot(node) && attachmentOf(node) === 'world' && (
                <span className="layer-badge" title="A world layer — stays put when the mascot moves"><Icon name="world" size={11} /></span>
              )}
              <span className="kind">{KIND_LABEL[node.kind]}</span>
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
            : <button className="btn ghost sm icon" title="Group selection" disabled={!sel.length || sel.some(isRoot)} onClick={() => groupLayers(sel.map((n) => n.id))}><Icon name="group" /></button>}
          <button className="btn ghost sm icon" title="Duplicate (⌘D)" disabled={!one || isRoot(one)} onClick={() => one && duplicateLayer(one.id)}><Icon name="copy" /></button>
          <button className="btn ghost sm icon danger-icon" title="Delete (⌫)" disabled={sel.every(isRoot)}
            onClick={() => { for (const n of sel) if (!isRoot(n)) deleteNode(n.id); }}><Icon name="trash" /></button>
        </div>
      )}
    </Panel>
  );
}

const KIND_LABEL: Record<string, string> = { body: 'body', eye: 'eye', group: 'grp', svgLayer: 'svg', primitive: 'shape', limb: 'limb' };

/** A 16px picture of what the layer draws — its outline in its own colour. */
function LayerThumb({ node }: { node: RigNode }) {
  const fill = cssColor({ ...node.color, a: 1 });
  let body;
  if (node.kind === 'limb') {
    body = <path d={node.limb?.type === 'leg' ? 'M-0.1 -0.45 C0.2 -0.1 0.1 0.2 -0.05 0.35 L0.35 0.35' : 'M-0.4 0.3 C-0.1 0.35 0.2 0 0.3 -0.35'}
      fill="none" stroke={fill} strokeWidth={0.2} strokeLinecap="round" />;
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
  const { r, g, b } = node.color;
  const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  return <svg className={`layer-thumb${dark ? ' on-light' : ''}`} viewBox="-0.55 -0.55 1.1 1.1" aria-hidden>{body}</svg>;
}
