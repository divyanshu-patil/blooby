import { useRef } from 'react';
import { useEditor } from '../core/store';
import { parseSvg } from '../core/svg';
import { INK, uid } from '../core/defaults';
import { cssColor } from '../core/color';
import { Panel } from './bits';
import type { RigNode } from '../core/types';

const KIND_LABEL: Record<string, string> = { body: 'body', eye: 'eye', group: 'grp', svgLayer: 'svg', primitive: 'shape' };

export function Layers() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const addNode = useEditor((s) => s.addNode);
  const deleteNode = useEditor((s) => s.deleteNode);
  const updateNode = useEditor((s) => s.updateNode);
  const file = useRef<HTMLInputElement>(null);

  const parentId = selection[0] && project.rig.nodes[selection[0]]?.kind !== 'body'
    ? project.rig.nodes[selection[0]].parentId ?? project.rig.rootId
    : project.rig.rootId;

  const rows: { node: RigNode; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    const n = project.rig.nodes[id];
    if (!n) return;
    rows.push({ node: n, depth });
    Object.values(project.rig.nodes)
      .filter((c) => c.parentId === id)
      .sort((a, b) => a.zIndex - b.zIndex)
      .forEach((c) => walk(c.id, depth + 1));
  };
  walk(project.rig.rootId, 0);

  const addPrimitive = (shape: 'circle' | 'pill') => {
    const top = Math.max(0, ...Object.values(project.rig.nodes).map((n) => n.zIndex));
    addNode({
      id: uid('s'), name: shape === 'circle' ? 'Dot' : 'Mouth', kind: 'primitive', parentId,
      surface: { yaw: 0, pitch: shape === 'circle' ? -30 : 26, mapped: true },
      transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1 },
      size: { x: shape === 'circle' ? 26 : 54, y: shape === 'circle' ? 26 : 16 },
      color: INK, visible: true, zIndex: top + 1,
      primitive: { shape },
    });
  };

  const importSvg = async (f: File) => {
    const parsed = parseSvg(await f.text());
    if (!parsed) return;
    const vb = parsed.viewBox;
    const [, , vw, vh] = vb.split(/[\s,]+/).map(Number);
    const top = Math.max(0, ...Object.values(project.rig.nodes).map((n) => n.zIndex));
    addNode({
      id: uid('svg'), name: f.name.replace(/\.svg$/i, '').slice(0, 22), kind: 'svgLayer', parentId,
      surface: { yaw: 0, pitch: -40, mapped: true },
      transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1 },
      size: { x: Math.min(vw || 80, 140), y: Math.min(vh || 80, 140) },
      color: INK, visible: true, zIndex: top + 1,
      svg: { sourceMarkup: parsed.markup, viewBox: vb },
    });
  };

  return (
    <Panel title="Layers" actions={
      <>
        <button className="btn ghost sm icon" title="Add circle" onClick={() => addPrimitive('circle')}>●</button>
        <button className="btn ghost sm icon" title="Add pill" onClick={() => addPrimitive('pill')}>▬</button>
        <button className="btn ghost sm icon" title="Import SVG layer" onClick={() => file.current?.click()}>↥</button>
      </>
    }>
      <input ref={file} type="file" accept=".svg,image/svg+xml" multiple hidden
        onChange={(e) => { for (const f of [...(e.target.files ?? [])]) importSvg(f); e.target.value = ''; }} />
      <div>
        {rows.map(({ node, depth }) => (
          <div key={node.id} className="layer" data-depth={depth} aria-selected={selection.includes(node.id)}
            onPointerDown={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                select(selection.includes(node.id) ? selection.filter((id) => id !== node.id) : [...selection, node.id]);
              } else {
                select([node.id]);
              }
            }}>
            <span className="swatch" style={{ background: cssColor(node.color) }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
            <span className="kind">{KIND_LABEL[node.kind]}</span>
            <button className="btn ghost sm icon eyecon" title={node.visible ? 'Hide' : 'Show'}
              onClick={(e) => { e.stopPropagation(); updateNode(node.id, (n) => { n.visible = !n.visible; }); }}>
              {node.visible ? '◉' : '○'}
            </button>
            {node.kind !== 'body' && (
              <button className="btn ghost sm icon eyecon" title="Delete layer"
                onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}>✕</button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
