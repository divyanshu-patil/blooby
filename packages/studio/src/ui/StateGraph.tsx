import { useEditor } from '../core/store';
import { conditionText, machineOf, transitionHolds, defaultValues } from '../core/stateMachine';
import type { SmTransition } from '../core/types';

/**
 * The machine as a picture: states as nodes, transitions as labelled edges (§6).
 *
 * The label on an edge is its condition — `isTyping == true`, `energy > 80` — because an
 * unlabelled arrow between two states says nothing you couldn't already see in the list.
 * An edge whose conditions currently hold is drawn live, so flipping an input in the
 * panel below shows you *why* the mascot moved, not just that it did.
 */

const W = 360;
const NODE_W = 92;
const NODE_H = 30;

function layout(count: number) {
  // a circle reads better than a row past three states, and a row is clearer below that
  if (count <= 3) {
    return (i: number) => ({ x: W / 2 + (i - (count - 1) / 2) * 118, y: 46 + (i % 2) * 62 });
  }
  const r = Math.min(120, 46 + count * 9);
  return (i: number) => ({
    x: W / 2 + r * Math.sin((i / count) * Math.PI * 2),
    y: 24 + r + 6 - r * Math.cos((i / count) * Math.PI * 2),
  });
}

/** Where an edge leaves/meets a node box, so arrows touch the box rather than its centre. */
function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // scale to the box's own half-extent along that direction
  const t = Math.min(Math.abs((NODE_W / 2 + 4) / (dx / len || 1e-6)), Math.abs((NODE_H / 2 + 4) / (dy / len || 1e-6)));
  return { x: from.x + (dx / len) * t, y: from.y + (dy / len) * t };
}

export function StateGraph({ selectedId, onSelect }: { selectedId: string | null; onSelect: (t: SmTransition | null) => void }) {
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.inputs);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const m = machineOf(project);
  const values = { ...defaultValues(project), ...live };

  const pos = layout(project.timelines.length);
  const at = new Map(project.timelines.map((t, i) => [t.id, pos(i)]));
  const height = Math.max(...[...at.values()].map((p) => p.y), 100) + NODE_H;

  const edges = m.transitions.filter((t) => at.has(t.from) && at.has(t.to));
  // two edges between the same pair must not sit on top of each other
  const pairSeen = new Map<string, number>();

  return (
    <div className="graph-wrap" style={{ overflow: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${height + 12}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="State machine graph">
        <defs>
          <marker id="sm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--line)" />
          </marker>
          <marker id="sm-arrow-live" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--signal)" />
          </marker>
        </defs>

        {edges.map((t) => {
          const a = at.get(t.from)!;
          const b = at.get(t.to)!;
          const key = [t.from, t.to].sort().join('|');
          const nth = pairSeen.get(key) ?? 0;
          pairSeen.set(key, nth + 1);

          const holds = transitionHolds(t, values) && project.activeTimelineId === t.from;
          const selected = t.id === selectedId;
          const stroke = selected ? 'var(--hot)' : holds ? 'var(--signal)' : 'var(--line)';
          const label = t.conditions.map((c) => conditionText(c, m.inputs)).join(t.logic === 'OR' ? ' OR ' : ' AND ');

          if (t.from === t.to) {
            // a self-edge: a small loop above the box, so it is visible rather than a dot
            const d = `M ${a.x - 14} ${a.y - NODE_H / 2} C ${a.x - 30} ${a.y - 56}, ${a.x + 30} ${a.y - 56}, ${a.x + 14} ${a.y - NODE_H / 2}`;
            return (
              <g key={t.id} onClick={() => onSelect(selected ? null : t)} style={{ cursor: 'pointer' }}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={selected || holds ? 1.8 : 1} markerEnd={`url(#sm-arrow${holds ? '-live' : ''})`} />
                <text x={a.x} y={a.y - 58} textAnchor="middle" fontSize="8.5" fill={holds ? 'var(--signal)' : 'var(--muted)'}>{label}</text>
              </g>
            );
          }

          const p1 = edgePoint(a, b);
          const p2 = edgePoint(b, a);
          // bow each parallel edge a little further out, alternating sides
          const bow = 18 + nth * 16;
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          const nx = -(p2.y - p1.y);
          const ny = p2.x - p1.x;
          const nl = Math.hypot(nx, ny) || 1;
          const side = a.x <= b.x ? 1 : -1;
          const cx = mx + (nx / nl) * bow * side;
          const cy = my + (ny / nl) * bow * side;

          return (
            <g key={t.id} onClick={() => onSelect(selected ? null : t)} style={{ cursor: 'pointer' }}>
              <path d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`} fill="none" stroke="transparent" strokeWidth={12} />
              <path d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`} fill="none"
                stroke={stroke} strokeWidth={selected || holds ? 1.8 : 1}
                strokeDasharray={t.conditions.length ? undefined : '3 3'}
                markerEnd={`url(#sm-arrow${holds ? '-live' : ''})`} />
              {/* the quadratic's own midpoint, not the chord's — the label sits on the curve */}
              <text x={(p1.x + 2 * cx + p2.x) / 4} y={(p1.y + 2 * cy + p2.y) / 4 - 3} textAnchor="middle"
                fontSize="8.5" fill={selected ? 'var(--hot)' : holds ? 'var(--signal)' : 'var(--muted)'}>
                {label.length > 34 ? `${label.slice(0, 32)}…` : label}
                <title>{label}</title>
              </text>
            </g>
          );
        })}

        {project.timelines.map((tl) => {
          const p = at.get(tl.id)!;
          const active = tl.id === project.activeTimelineId;
          const initial = tl.id === (m.initialStateId ?? project.timelines[0].id);
          return (
            <g key={tl.id} onClick={() => setActiveTimeline(tl.id)} style={{ cursor: 'pointer' }}>
              <rect x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={7}
                fill={active ? 'var(--signal)' : 'var(--field)'} stroke={active ? 'var(--signal)' : 'var(--line)'} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10.5" fontWeight={600}
                fill={active ? '#fff' : 'var(--ink-2)'}>
                {tl.name.length > 13 ? `${tl.name.slice(0, 12)}…` : tl.name}
              </text>
              {initial && <circle cx={p.x - NODE_W / 2 + 6} cy={p.y - NODE_H / 2 + 6} r={2.5} fill={active ? '#fff' : 'var(--hot)'}><title>Initial state</title></circle>}
            </g>
          );
        })}
      </svg>
      {!edges.length && <p className="hint">No transitions yet — add one below and it appears here as a labelled arrow.</p>}
    </div>
  );
}
