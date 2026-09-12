import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { compOf } from '../core/comp';
import { composeScene, evaluateRig, evaluateWithTransition, fromFrame, sceneFrames, toFrame, WORLD, type LayerFrame, type SceneItem } from '../core/scene';
import { TrajectoryHandles } from './TrajectoryHandles';
import { ShapeHandles } from './ShapeHandles';
import { screenToSurface } from '../core/curvature';
import { flattenPath } from '../core/path';
import { hoseInputOf, limbPoints, rubberHose } from '../core/limb';
import { Shapes } from './Mascot';
import { activeTimeline } from '../core/types';
import { DEFAULT_BG, useStageBg } from './stageBg';
import type { Project, Rig, RigNode, Vec2 } from '../core/types';

type Mode = 'move' | 'scale' | 'rotate' | 'turn' | 'limb';

interface Drag {
  mode: Mode;
  id: string;
  ox: number; oy: number;          // pointer at grab, in comp space
  start: Record<string, number>;   // whatever the mode needs to restore from
  /** the frame the layer lives in, as the renderer drew it at grab time */
  frame?: LayerFrame;
  /** limb drags: which point */
  key?: 'a' | 'b' | 'c';
}

/** Even-odd ray cast — whether a point is inside an outline's flattened polygon. */
function inPolygon(pts: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The topmost layer under a point. Outlines are tested against their real shape rather
 * than their box, so a limb's empty bounding box does not steal clicks meant for the
 * body behind it. Locked layers are skipped — that is what the padlock is for.
 */
function hit(scene: SceneItem[], x: number, y: number, pickable: (id: string) => boolean): SceneItem | undefined {
  for (let i = scene.length - 1; i >= 0; i--) {
    const s = scene[i];
    if (!pickable(s.id)) continue;
    const a = (-s.rotation * Math.PI) / 180;
    const dx = x - s.cx, dy = y - s.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const rx = Math.max(s.w, 8) / 2, ry = Math.max(s.h, 8) / 2;
    let inside: boolean;
    if (s.path && s.w > 12 && s.h > 12) {
      inside = Math.abs(lx) <= rx && Math.abs(ly) <= ry && inPolygon(flattenPath(s.path, 64), lx / s.w, ly / s.h);
    } else {
      inside = s.shape === 'ellipse' && !s.path
        ? (lx / rx) ** 2 + (ly / ry) ** 2 <= 1
        : Math.abs(lx) <= rx && Math.abs(ly) <= ry;
    }
    if (inside) return s;
  }
  return undefined;
}

export function Stage() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const setValue = useEditor((s) => s.setValue);
  const editPoints = useEditor((s) => s.editPoints);
  const setEditPoints = useEditor((s) => s.setEditPoints);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const [tool, setTool] = useState<'select' | 'turn'>('select');
  const [showGuides, setShowGuides] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else frameRef.current?.requestFullscreen();
  };
  const [bg, setBgPersist] = useStageBg();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const view = compOf(project);

  // a state-machine switch with `duration` (setState/enableState) blends live here for its
  // own span — preview only, never how evaluateRig itself behaves for export/baking.
  const stateTransition = useEditor((s) => s.stateTransition);
  const clearStateTransition = useEditor((s) => s.clearStateTransition);
  const [transitionTick, setTransitionTick] = useState(0);
  useEffect(() => {
    if (!stateTransition) return;
    let raf = 0;
    const loop = () => {
      if (performance.now() - stateTransition.startedAtMs >= stateTransition.durationMs) { clearStateTransition(); return; }
      setTransitionTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stateTransition, clearStateTransition]);

  const rig = useMemo(() => {
    if (!stateTransition) return evaluateRig(project, playhead);
    const progress = (performance.now() - stateTransition.startedAtMs) / stateTransition.durationMs;
    return evaluateWithTransition(project, playhead, stateTransition.fromRig, progress, stateTransition.easing);
    // transitionTick is a deliberate extra dependency — it's the rAF-driven "re-sample
    // wall-clock progress" signal, not itself a value read inside this computation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, playhead, stateTransition, transitionTick]);
  // composeScene, not buildScene: the stage must draw exactly what the exporter bakes,
  // emitters included, or the preview quietly lies about the finished animation
  const scene = useMemo(() => composeScene(project, rig, playhead, view), [project, rig, playhead, view]);
  // every layer's frame, from the same walk that placed it — so a drag is the exact inverse
  const frames = useMemo(() => sceneFrames(rig, view), [rig, view]);
  const body = frames.get(project.rig.rootId);
  const selectedEmitterId = useEditor((s) => s.selectedEmitterId);
  const selectedEmitter = (activeTimeline(project).emitters ?? []).find((e) => e.id === selectedEmitterId);
  const sel = scene.find((s) => s.id === selection[0]);
  const selNode = selection.length === 1 ? project.rig.nodes[selection[0]] : undefined;

  const toComp = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  /** The node a drag should actually write to — a linked eye defers to its source. */
  const targetOf = (id: string) => {
    const n = project.rig.nodes[id];
    return n?.eye?.linkedToId && project.rig.nodes[n.eye.linkedToId] ? n.eye.linkedToId : id;
  };
  const pickable = (id: string) => { const n = project.rig.nodes[id]; return !!n && !n.locked; };

  /** Where a move starts from: the pose on screen, not the stored one. */
  const beginMove = (id: string, p: Vec2, r: Rig, fr: Map<string, LayerFrame>): Drag | null => {
    const node = r.nodes[id];
    if (!node) return null;
    return {
      mode: 'move', id, ox: p.x, oy: p.y, frame: fr.get(node.parentId ?? WORLD),
      start: {
        yaw: node.surface.yaw, pitch: node.surface.pitch,
        fx: node.surface.flatOffset?.x ?? 0, fy: node.surface.flatOffset?.y ?? 0,
        ...(node.limb ? Object.fromEntries(limbPoints(node.limb).flatMap((k) => [[`${k}x`, node.limb![k]!.x], [`${k}y`, node.limb![k]!.y]])) : {}),
      },
    };
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toComp(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (tool === 'turn') {
      // rig, not project.rig: a drag has to continue from the pose on screen. Seeded from
      // the base rig instead, an animated yaw read as 0 and the head snapped there.
      const root = rig.nodes[project.rig.rootId];
      drag.current = { mode: 'turn', id: root.id, ox: p.x, oy: p.y, start: { yaw: root.surface.yaw, pitch: root.surface.pitch } };
      return;
    }
    const item = hit(scene, p.x, p.y, pickable);
    if (!item) { select([]); drag.current = null; return; }

    const additive = e.shiftKey && !selection.includes(item.id);
    if (additive) { select([...selection, item.id]); drag.current = null; return; }
    let id = targetOf(item.id);
    if (!selection.includes(item.id) || selection.length > 1) select([item.id]);

    // Alt/Option-drag leaves the original where it was and drags a copy away
    if (e.altKey && id !== project.rig.rootId) {
      const copy = duplicateLayer(id);
      if (copy) {
        id = copy;
        const now = useEditor.getState().project;
        const r2 = evaluateRig(now, playhead);
        drag.current = beginMove(id, p, r2, sceneFrames(r2, view));
        return;
      }
    }
    drag.current = beginMove(id, p, rig, frames);
  };

  const startHandle = (mode: 'scale' | 'rotate') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!sel) return;
    const id = targetOf(sel.id);
    const node = rig.nodes[id];
    if (!node) return;
    const p = toComp(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      mode, id, ox: p.x, oy: p.y,
      start: {
        sx: node.transform.scale.x, sy: node.transform.scale.y, rot: node.transform.rotation,
        cx: sel.cx, cy: sel.cy, w: sel.w, h: sel.h, drawnRot: sel.rotation,
        a0: Math.atan2(p.y - sel.cy, p.x - sel.cx),
      },
    };
  };

  const startLimbPoint = (key: 'a' | 'b' | 'c') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!selNode?.limb) return;
    const node = rig.nodes[selNode.id];
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toComp(e);
    drag.current = { mode: 'limb', id: selNode.id, key, ox: p.x, oy: p.y, frame: frames.get(selNode.parentId ?? WORLD),
      start: { x: node.limb![key]?.x ?? 0, y: node.limb![key]?.y ?? 0 } };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    let p = toComp(e);
    const node = useEditor.getState().project.rig.nodes[d.id];
    if (!node) return;

    if (d.mode === 'turn') {
      // gentle enough that a full sweep of the stage doesn't blow straight past ±90°
      const yaw = clamp(d.start.yaw + (p.x - d.ox) * 0.18, -89, 89);
      const pitch = clamp(d.start.pitch + (p.y - d.oy) * 0.18, -89, 89);
      setValue(d.id, 'surface.yaw', yaw, `turn.${d.id}`);
      setValue(d.id, 'surface.pitch', pitch, `turn.${d.id}`);
      return;
    }

    if (d.mode === 'limb' && d.frame && d.key) {
      // the points ARE where the shoulder, hand, knee and ankle sit — the hose's length
      // decides the curve between them — so a drag writes the point straight back
      const local = fromFrame(d.frame, p);
      setValue(d.id, `limb.${d.key}.x`, round2(local.x), `limb.${d.id}`);
      setValue(d.id, `limb.${d.key}.y`, round2(local.y), `limb.${d.id}`);
      return;
    }

    if (d.mode === 'move') {
      // shift keeps the move on one axis, whichever it has gone further along
      if (e.shiftKey) {
        if (Math.abs(p.x - d.ox) > Math.abs(p.y - d.oy)) p = { x: p.x, y: d.oy };
        else p = { x: d.ox, y: p.y };
      }
      const f = d.frame;
      if (node.limb && f) {
        // a limb moves as a whole: every point by the same local delta
        const a = fromFrame(f, { x: d.ox, y: d.oy }), b = fromFrame(f, p);
        for (const k of limbPoints(node.limb)) {
          setValue(d.id, `limb.${k}.x`, round2(d.start[`${k}x`] + b.x - a.x), `move.${d.id}`);
          setValue(d.id, `limb.${k}.y`, round2(d.start[`${k}y`] + b.y - a.y), `move.${d.id}`);
        }
        return;
      }
      if (node.surface.mapped && node.parentId === project.rig.rootId && f) {
        const a = (-f.rot * Math.PI) / 180;
        const dx = p.x - f.x, dy = p.y - f.y;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (f.squash || 1);
        const s = screenToSurface(lx, ly, project.rig, f.R, f.head);
        setValue(d.id, 'surface.yaw', round2(s.x - (node.eye?.distanceFromCenter ?? 0)), `move.${d.id}`);
        setValue(d.id, 'surface.pitch', round2(s.y), `move.${d.id}`);
      } else if (f && d.id !== project.rig.rootId) {
        const a = fromFrame(f, { x: d.ox, y: d.oy }), b = fromFrame(f, p);
        setValue(d.id, 'flatOffset.x', round2(d.start.fx + b.x - a.x), `move.${d.id}`);
        setValue(d.id, 'flatOffset.y', round2(d.start.fy + b.y - a.y), `move.${d.id}`);
      } else {
        setValue(d.id, 'flatOffset.x', round2(d.start.fx + p.x - d.ox), `move.${d.id}`);
        setValue(d.id, 'flatOffset.y', round2(d.start.fy + p.y - d.oy), `move.${d.id}`);
      }
      return;
    }

    if (d.mode === 'scale') {
      const a = (-d.start.drawnRot * Math.PI) / 180;
      const grab = rotate(d.ox - d.start.cx, d.oy - d.start.cy, a);
      const now = rotate(p.x - d.start.cx, p.y - d.start.cy, a);
      const kx = Math.abs(grab.x) < 4 ? 1 : now.x / grab.x;
      const ky = Math.abs(grab.y) < 4 ? 1 : now.y / grab.y;
      const uniform = e.shiftKey ? Math.max(kx, ky) : 0;
      setValue(d.id, 'transform.scale.x', clamp(d.start.sx * (uniform || kx), 0.03, 6), `scale.${d.id}`);
      setValue(d.id, 'transform.scale.y', clamp(d.start.sy * (uniform || ky), 0.03, 6), `scale.${d.id}`);
      return;
    }

    if (d.mode === 'rotate') {
      const a = Math.atan2(p.y - d.start.cy, p.x - d.start.cx);
      let deg = d.start.rot + ((a - d.start.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      setValue(d.id, 'transform.rotation', round2(((deg + 180) % 360 + 360) % 360 - 180), `rot.${d.id}`);
    }
  };

  const onUp = () => { drag.current = null; };

  // arrow keys nudge the selection: 1px (or 1°), 10 with shift — one undo step per burst
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir || !selection.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const now = useEditor.getState().project;
      const r = evaluateRig(now, useEditor.getState().playhead);
      for (const id of selection) {
        const n = r.nodes[id];
        if (!n || n.locked) continue;
        const label = `nudge.${id}`;
        if (n.limb) {
          for (const k of limbPoints(n.limb)) {
            setValue(id, `limb.${k}.x`, n.limb[k]!.x + dir[0] * step, label);
            setValue(id, `limb.${k}.y`, n.limb[k]!.y + dir[1] * step, label);
          }
        } else if (n.surface.mapped && id !== now.rig.rootId) {
          setValue(id, 'surface.yaw', n.surface.yaw + dir[0] * step, label);
          setValue(id, 'surface.pitch', n.surface.pitch + dir[1] * step, label);
        } else {
          setValue(id, 'flatOffset.x', (n.surface.flatOffset?.x ?? 0) + dir[0] * step, label);
          setValue(id, 'flatOffset.y', (n.surface.flatOffset?.y ?? 0) + dir[1] * step, label);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, setValue]);

  const reset = () => commit((p: Project) => {
    p.rig.camera.offset = { x: 0, y: 0 };
    const root = p.rig.nodes[p.rig.rootId];
    root.surface.yaw = 0; root.surface.pitch = 0; root.surface.flatOffset = { x: 0, y: 0 };
  });

  const limbNode: RigNode | undefined = selNode?.limb ? rig.nodes[selNode.id] : undefined;
  const limbFrame = limbNode ? frames.get(limbNode.parentId ?? WORLD) : undefined;
  const showBox = sel && showGuides && !sel.limb && !(editPoints && sel.path);
  const attachedTo = selNode && selNode.parentId && selNode.kind !== 'eye' && selNode.kind !== 'limb' ? frames.get(selNode.parentId) : undefined;

  const transparent = bg === 'transparent';
  return (
    <div ref={frameRef} className={`stage-frame${transparent ? ' checker' : ''}${!transparent && isLight(bg) ? ' on-light' : ''}${fullscreen ? ' fullscreen' : ''}`}
      style={transparent ? undefined : { background: bg }}>
      <svg ref={svgRef} viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={() => { if (sel?.path && !sel.limb) setEditPoints(!editPoints); }}>
        <rect x={0.5} y={0.5} width={view.width - 1} height={view.height - 1}
          fill="none" style={{ stroke: 'rgba(var(--stage-ink), .1)' }} pointerEvents="none" />
        {showGuides && body && (
          <ellipse cx={body.x} cy={body.y} rx={body.R} ry={body.R * body.squash}
            transform={`rotate(${body.rot} ${body.x} ${body.y})`}
            fill="none" style={{ stroke: 'rgba(var(--stage-ink), .14)' }} strokeDasharray="4 6" pointerEvents="none" />
        )}
        <Shapes scene={scene} />

        {/* an attached layer shows what it is attached to: a faint tether to its anchor */}
        {sel && attachedTo && showGuides && (
          <g pointerEvents="none" className="tether">
            <line x1={attachedTo.x} y1={attachedTo.y} x2={sel.cx} y2={sel.cy} />
            <circle cx={attachedTo.x} cy={attachedTo.y} r={3} />
          </g>
        )}

        {/* the selected layer's outline as draggable points, in shape-edit mode */}
        {sel?.path && !sel.limb && editPoints && showGuides && selection.length === 1 && (
          <ShapeHandles nodeId={selection[0]} item={sel} path={sel.path} toComp={toComp} />
        )}

        {selectedEmitter && showGuides && (
          <TrajectoryHandles emitter={selectedEmitter} rig={rig} scene={scene} view={view} toComp={toComp} />
        )}

        {showBox && sel && (
          <g pointerEvents="none">
            <g transform={`rotate(${sel.rotation} ${sel.cx} ${sel.cy})`}>
              <rect className="sel-ring" x={sel.cx - sel.w / 2 - 5} y={sel.cy - sel.h / 2 - 5}
                width={sel.w + 10} height={sel.h + 10} rx={6} />
              {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => (
                <rect key={`${sx}${sy}`} className="handle sq" width={9} height={9} rx={2}
                  x={sel.cx + sx * (sel.w / 2 + 5) - 4.5} y={sel.cy + sy * (sel.h / 2 + 5) - 4.5}
                  pointerEvents="all" onPointerDown={startHandle('scale')} onPointerMove={onMove} onPointerUp={onUp} />
              ))}
              <line x1={sel.cx} y1={sel.cy - sel.h / 2 - 5} x2={sel.cx} y2={sel.cy - sel.h / 2 - 22}
                stroke="var(--signal)" strokeWidth={1.25} />
              <circle className="handle" cx={sel.cx} cy={sel.cy - sel.h / 2 - 24} r={5.5}
                pointerEvents="all" onPointerDown={startHandle('rotate')} onPointerMove={onMove} onPointerUp={onUp} />
            </g>
          </g>
        )}

        {/* a limb is edited by its points and nothing else: two for a hand, three for a leg */}
        {limbNode?.limb && limbFrame && showGuides && (
          <g className="limb-handles">
            {(() => {
              const l = limbNode.limb!;
              // exactly on the points: the length shapes the curve between them, never
              // where they are
              const drawn = (k: 'a' | 'b' | 'c') => toFrame(limbFrame, l[k]!);
              const pts = limbPoints(l).map((k) => ({ k, at: drawn(k) }));
              // where the hose actually ends: short of the hand when it is out of reach,
              // because a rubber hose keeps its length rather than stretching
              const end = rubberHose(hoseInputOf(l, (v) => toFrame(limbFrame, v), limbFrame.cum))?.end;
              const target = pts[pts.length - 1].at;
              const short = end && Math.hypot(end.x - target.x, end.y - target.y) > 2 ? end : null;
              return (
                <>
                  <polyline points={pts.map((q) => `${q.at.x},${q.at.y}`).join(' ')} className="limb-bone" pointerEvents="none" />
                  {short && (
                    <line x1={short.x} y1={short.y} x2={target.x} y2={target.y} className="limb-reach" pointerEvents="none">
                      <title>Out of reach — the limb keeps its length. Lengthen it to reach.</title>
                    </line>
                  )}
                  {pts.map(({ k, at }) => (
                    <circle key={k} cx={at.x} cy={at.y} r={k === 'a' ? 6 : 7} className={`limb-pt limb-pt-${k}`}
                      pointerEvents="all" onPointerDown={startLimbPoint(k)} onPointerMove={onMove} onPointerUp={onUp}>
                      <title>{l.type === 'leg' ? { a: 'Hip', b: 'Knee', c: 'Ankle' }[k] : { a: 'Shoulder', b: 'Hand', c: '' }[k]}</title>
                    </circle>
                  ))}
                </>
              );
            })()}
          </g>
        )}
      </svg>
      <div className="stage-grid" />
      <div className="stage-tools">
        <button className="btn icon sm" aria-pressed={tool === 'select'} title="Select and move (V) — shift constrains, alt duplicates" onClick={() => setTool('select')}>↖</button>
        <button className="btn icon sm" data-tour="tool-turn" aria-pressed={tool === 'turn'} title="Turn the head (T)" onClick={() => setTool('turn')}>◍</button>
        <button className="btn icon sm" aria-pressed={editPoints} disabled={!sel?.path || !!sel.limb} title="Edit the outline's points (or double-click the shape)"
          onClick={() => setEditPoints(!editPoints)}>✎</button>
        <button className="btn icon sm" aria-pressed={showGuides} title="Guides (G)" onClick={() => setShowGuides((v) => !v)}>⌗</button>
        <button className="btn icon sm" title="Recentre" onClick={reset}>⌂</button>
        <button className="btn icon sm" aria-pressed={fullscreen} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
          onClick={toggleFullscreen}>⛶</button>
        <div className="stage-bg" title="Backdrop for the preview and for every export">
          {BG_SWATCHES.map((c) => (
            <button key={c} className={`sw${c === 'transparent' ? ' checker' : ''}`} aria-pressed={bg === c}
              title={c === 'transparent' ? 'Transparent (no backdrop in exports)' : c}
              style={c === 'transparent' ? undefined : { background: c }}
              onClick={() => setBgPersist(c)} />
          ))}
          <input type="color" aria-label="Custom preview background"
            value={transparent ? DEFAULT_BG : bg} onChange={(e) => setBgPersist(e.target.value)} />
        </div>
      </div>
      <div className="stage-meta">
        <span>{view.width}×{view.height}</span>
        <span>yaw {(body?.head.x ?? 0).toFixed(1)}° · pitch {(body?.head.y ?? 0).toFixed(1)}°</span>
        <span>fov {rig.camera.fov.toFixed(0)}°</span>
      </div>
    </div>
  );
}

const BG_SWATCHES = ['transparent', '#17161b', '#2b2a31', '#8b8794', '#f4f2ee', '#ffffff'];

/** sRGB luma — good enough to decide whether stage overlays should be dark or light. */
function isLight(hex: string): boolean {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.58;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const rotate = (x: number, y: number, a: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
