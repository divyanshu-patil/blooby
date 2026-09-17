import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { conditionText, defaultValues, machineOf, nextTransition } from '../core/stateMachine';
import { sceneAt, type SceneItem } from '../core/scene';
import { compOf } from '../core/comp';
import { MascotThumb } from './Mascot';
import { ANY_STATE, asTimeline, type SmTransition, type Vec2 } from '../core/types';

/**
 * The machine as a node editor: states as nodes, rules and transitions as wires.
 *
 * "Any state" is where rules start. A wire from it is a RULE — "when mood == 2, play Dance" —
 * and holds whichever state is current, so nobody has to draw Idle → Dance, Happy → Dance
 * and Sad → Dance by hand. A wire between two states is an ordinary transition, tried first.
 *
 * Drag a node by its body to move it (the layout is saved with the project); drag from its
 * port — the dot on its right — onto a state to wire it; click a wire to edit it below; click
 * a state without moving it to show it on the stage. A wire whose condition holds right now
 * is drawn live, so flipping an input shows WHY the mascot moved.
 */

const W = 360;
const ANY = { w: 84, h: 34 };
const NODE = { w: 150, h: 48 };
const box = (id: string) => (id === ANY_STATE ? ANY : NODE);

export function StateGraph({ selectedId, onSelect, disabled = false }: { selectedId: string | null; onSelect: (t: SmTransition | null) => void; disabled?: boolean }) {
  const project = useEditor((s) => s.project);
  const live = useEditor((s) => s.inputs);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const addStateTransition = useEditor((s) => s.addStateTransition);
  const setStateNodePosition = useEditor((s) => s.setStateNodePosition);
  const svg = useRef<SVGSVGElement>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const moving = useRef<{ id: string; dx: number; dy: number; x0: number; y0: number; moved: boolean } | null>(null);
  const m = machineOf(project);
  const values = { ...defaultValues(project), ...live };
  const states = project.timelines;

  // where each node is: its saved place, else the default — Any on the left, states in a column
  const pos = (id: string): Vec2 => {
    const saved = m.layout?.[id];
    if (saved) return saved;
    if (id === ANY_STATE) return { x: 8, y: Math.max(10, (states.length * (NODE.h + 12)) / 2 - ANY.h / 2) };
    const i = states.findIndex((t) => t.id === id);
    return { x: 190, y: 10 + Math.max(0, i) * (NODE.h + 12) };
  };
  const ids = [ANY_STATE, ...states.map((t) => t.id)];
  const height = Math.max(100, ...ids.map((id) => pos(id).y + box(id).h + 10));
  const centre = (id: string) => { const p = pos(id), b = box(id); return { x: p.x + b.w / 2, y: p.y + b.h / 2 }; };
  const port = (id: string) => { const p = pos(id), b = box(id); return { x: p.x + b.w, y: p.y + b.h / 2 }; };
  // what the machine would do next from the state on the stage, so that wire lights up
  const firing = nextTransition(project, project.activeTimelineId, values);

  // a small still of each state, at the middle of its own timeline
  const thumbs = useMemo(() => new Map<string, SceneItem[]>(states.map((tl) => {
    const p = asTimeline(project, tl.id);
    try { return [tl.id, sceneAt(p, tl.timelineDurationMs / 2, compOf(p))]; } catch { return [tl.id, []]; }
  })), [project, states]);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const stateAt = (x: number, y: number) => states.find((tl) => {
    const p = pos(tl.id);
    return x >= p.x - 8 && x <= p.x + NODE.w + 8 && y >= p.y && y <= p.y + NODE.h;
  });

  const startWire = (from: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    // a wire tests an input: none yet, nothing to wire
    if (disabled) return;
    svg.current?.setPointerCapture?.(e.pointerId);
    setWire({ from, ...toSvg(e) });
  };
  const startMove = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    svg.current?.setPointerCapture?.(e.pointerId);
    const p = toSvg(e), at = pos(id);
    moving.current = { id, dx: p.x - at.x, dy: p.y - at.y, x0: p.x, y0: p.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = toSvg(e);
    if (wire) { setWire({ ...wire, ...p }); return; }
    const mv = moving.current;
    if (!mv) return;
    if (!mv.moved && Math.hypot(p.x - mv.x0, p.y - mv.y0) < 3) return;
    mv.moved = true;
    const b = box(mv.id);
    setStateNodePosition(mv.id, { x: Math.min(W - b.w, Math.max(0, p.x - mv.dx)), y: Math.max(0, p.y - mv.dy) });
  };
  const onUp = (e: React.PointerEvent) => {
    const mv = moving.current;
    moving.current = null;
    // a click, not a drag: show that state on the stage
    if (mv && !mv.moved && mv.id !== ANY_STATE) setActiveTimeline(mv.id);
    if (!wire) return;
    const p = toSvg(e);
    const target = stateAt(p.x, p.y);
    const from = wire.from;
    setWire(null);
    if (!target || target.id === from) return;
    // born with a condition on the first input, so it can fire — edited right under the graph
    const input = m.inputs.find((i) => i.type !== 'Event') ?? m.inputs[0];
    addStateTransition(from, target.id, input ? [{
      input: input.name, operator: input.type === 'Event' ? 'Fired' : 'Equal',
      value: input.type === 'Numeric' ? 1 : input.type === 'Boolean' ? true : input.type === 'String' ? target.name : undefined,
    }] : undefined);
    const made = machineOf(useEditor.getState().project).transitions.at(-1);
    if (made) onSelect(made);
  };

  const label = (t: SmTransition) => t.conditions.map((c) => conditionText(c, m.inputs)).join(t.logic === 'OR' ? ' or ' : ' and ') || 'no condition';
  const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const valid = m.transitions.filter((t) => states.some((s) => s.id === t.to) && (t.from === ANY_STATE || states.some((s) => s.id === t.from)));
  // several wires between the same two nodes: fan their labels out
  const nth = new Map<string, number>();

  return (
    <div className="graph-wrap sm-graph" style={{ overflow: 'auto' }}>
      <svg ref={svg} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        role="img" aria-label="State machine node editor" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { moving.current = null; setWire(null); }}>
        <defs>
          {(['', '-live', '-sel'] as const).map((k) => (
            <marker key={k} id={`sm-arrow${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill={k === '-live' ? 'var(--signal)' : k === '-sel' ? 'var(--ink)' : 'var(--muted)'} />
            </marker>
          ))}
        </defs>

        {valid.map((t) => {
          const selected = t.id === selectedId;
          const holds = firing ? (firing.id === t.id || firing.id.startsWith(`${t.id}@`)) : false;
          const stroke = selected ? 'var(--ink)' : holds ? 'var(--signal)' : 'var(--muted)';
          const a = port(t.from), c = centre(t.to), tp = pos(t.to);
          // into the target's nearer side, so a node moved left of its source still reads
          const into = a.x <= c.x ? { x: tp.x - 2, y: c.y } : { x: tp.x + NODE.w + 2, y: c.y };
          const k = `${t.from}>${t.to}`;
          const n = nth.get(k) ?? 0;
          nth.set(k, n + 1);
          const bend = Math.max(40, Math.abs(into.x - a.x) / 2);
          const c2x = a.x <= c.x ? into.x - bend : into.x + bend;
          const d = `M ${a.x} ${a.y} C ${a.x + bend} ${a.y + n * 14}, ${c2x} ${into.y + n * 14}, ${into.x} ${into.y}`;
          const text = label(t);
          return (
            <g key={t.id} className="sm-wire" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(selected ? null : t)} style={{ cursor: 'pointer' }}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
              <path d={d} fill="none" stroke={stroke} strokeWidth={selected || holds ? 1.8 : 1}
                strokeDasharray={t.conditions.length ? undefined : '3 3'} markerEnd={`url(#sm-arrow${selected ? '-sel' : holds ? '-live' : ''})`} />
              <text x={(a.x + into.x) / 2} y={(a.y + into.y) / 2 - 4 + n * 12} textAnchor="middle" fontSize="8.5" fill={stroke}
                paintOrder="stroke" stroke="var(--field)" strokeWidth={3}>
                {short(text, 20)}
                <title>{`${t.from === ANY_STATE ? 'From any state' : states.find((x) => x.id === t.from)?.name} → ${states.find((x) => x.id === t.to)?.name} when ${text}`}</title>
              </text>
            </g>
          );
        })}

        {wire && (() => {
          const a = port(wire.from);
          return <path d={`M ${a.x} ${a.y} L ${wire.x} ${wire.y}`} stroke="var(--ink)" strokeWidth={1.4}
            strokeDasharray="4 3" fill="none" pointerEvents="none" markerEnd="url(#sm-arrow-sel)" />;
        })()}

        {/* any state: where rules start */}
        {(() => {
          const p = pos(ANY_STATE);
          return (
            <g>
              <g onPointerDown={startMove(ANY_STATE)} style={{ cursor: 'grab' }}>
                <rect x={p.x} y={p.y} width={ANY.w} height={ANY.h} rx={17} fill="var(--panel)" stroke="var(--ink-2)" strokeDasharray="4 3" />
                <text x={p.x + ANY.w / 2 - 4} y={p.y + ANY.h / 2 + 3.5} textAnchor="middle" fontSize="10" fontWeight={600} fill="var(--ink-2)">Any state</text>
                <title>Rules start here: whatever state is current, when the condition holds, go to the target. Drag to move.</title>
              </g>
              <circle className="sm-port" cx={p.x + ANY.w} cy={p.y + ANY.h / 2} r={5.5} fill="var(--ink)"
                onPointerDown={startWire(ANY_STATE)} style={{ cursor: disabled ? 'not-allowed' : 'crosshair' }} opacity={disabled ? 0.35 : 1}>
                <title>Drag onto a state to add a rule into it</title>
              </circle>
            </g>
          );
        })()}

        {states.map((tl) => {
          const p = pos(tl.id);
          const active = tl.id === project.activeTimelineId;
          const initial = tl.id === (m.initialStateId ?? states[0].id);
          const scene = thumbs.get(tl.id) ?? [];
          return (
            <g key={tl.id}>
              <g onPointerDown={startMove(tl.id)} style={{ cursor: 'grab' }}>
                <rect x={p.x} y={p.y} width={NODE.w} height={NODE.h} rx={8}
                  fill={active ? 'var(--signal-soft)' : 'var(--panel)'} stroke={active ? 'var(--ink)' : 'var(--line)'} strokeWidth={active ? 1.5 : 1} />
                <foreignObject x={p.x + 5} y={p.y + 5} width={38} height={38} pointerEvents="none">
                  <div style={{ width: 38, height: 38, borderRadius: 6, background: 'var(--field)', overflow: 'hidden' }}>
                    {scene.length > 0 && <MascotThumb scene={scene} view={compOf(project)} pad={6} />}
                  </div>
                </foreignObject>
                <text x={p.x + 50} y={p.y + 20} fontSize="11" fontWeight={600} fill="var(--ink)" pointerEvents="none">
                  {initial ? '★ ' : ''}{short(tl.name, 13)}
                </text>
                <text x={p.x + 50} y={p.y + 35} fontSize="9" fill="var(--muted)" pointerEvents="none">
                  {(tl.timelineDurationMs / 1000).toFixed(1)}s{tl.loop ? ' · loops' : ''}{active ? ' · on stage' : ''}
                </text>
                <title>{`${tl.name}${initial ? ' — the machine starts here' : ''}. Click to show it on the stage; drag to move it.`}</title>
              </g>
              <circle className="sm-port" cx={p.x + NODE.w} cy={p.y + NODE.h / 2} r={4.5} fill="var(--muted)"
                onPointerDown={startWire(tl.id)} style={{ cursor: disabled ? 'not-allowed' : 'crosshair' }} opacity={disabled ? 0.35 : 1}>
                <title>{`Drag onto another state for a transition out of ${tl.name} only`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      {!valid.length && !disabled && (
        <p className="hint">Drag from <b>Any state</b>'s dot onto a state to add a rule — “when this input is… play that state”. Drag nodes to arrange them.</p>
      )}
    </div>
  );
}
