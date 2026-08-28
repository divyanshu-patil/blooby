import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP } from '../core/defaults';
import { composeScene, evaluateRig, evaluateWithTransition, type SceneItem } from '../core/scene';
import { TrajectoryHandles } from './TrajectoryHandles';
import { bodyTurnScale, screenToSurface } from '../core/curvature';
import { Shapes } from './Mascot';
import { activeTimeline } from '../core/types';
import type { Project, Rig } from '../core/types';

type Mode = 'idle' | 'move' | 'scale' | 'rotate' | 'turn' | 'pan';

interface Drag {
  mode: Mode;
  id: string;
  ox: number; oy: number;          // pointer at grab, in comp space
  start: Record<string, number>;   // whatever the mode needs to restore from
}

/** Body centre, radius and roll at the current time — the frame mapped children live in. */
function bodyFrame(rig: Rig) {
  const root = rig.nodes[rig.rootId];
  const off = root.surface.flatOffset ?? { x: 0, y: 0 };
  const turn = bodyTurnScale(root.surface.yaw, root.surface.pitch);
  const rx = root.size.x * root.transform.scale.x * turn.sx;
  const ry = (root.size.y || root.size.x) * root.transform.scale.y * turn.sy;
  return {
    cx: COMP.width / 2 + rig.camera.offset.x + off.x,
    cy: COMP.height / 2 + rig.camera.offset.y + off.y,
    R: rx,
    squash: rx === 0 ? 1 : ry / rx,
    roll: root.transform.rotation,
    head: { x: root.surface.yaw, y: root.surface.pitch },
  };
}

function hit(scene: SceneItem[], x: number, y: number): SceneItem | undefined {
  for (let i = scene.length - 1; i >= 0; i--) {
    const s = scene[i];
    const a = (-s.rotation * Math.PI) / 180;
    const dx = x - s.cx, dy = y - s.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const rx = Math.max(s.w, 8) / 2, ry = Math.max(s.h, 8) / 2;
    const inside = s.shape === 'ellipse'
      ? (lx / rx) ** 2 + (ly / ry) ** 2 <= 1
      : Math.abs(lx) <= rx && Math.abs(ly) <= ry;
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
  const [bg, setBg] = useState(() => { try { return localStorage.getItem('blooby.stageBg') || '#17161b'; } catch { return '#17161b'; } });
  const setBgPersist = (v: string) => { setBg(v); try { localStorage.setItem('blooby.stageBg', v); } catch { /* private mode */ } };
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

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
  const scene = useMemo(() => composeScene(activeTimeline(project), rig, playhead, COMP), [project, rig, playhead]);
  const frame = bodyFrame(rig);
  const selectedEmitterId = useEditor((s) => s.selectedEmitterId);
  const selectedEmitter = (activeTimeline(project).emitters ?? []).find((e) => e.id === selectedEmitterId);
  const sel = scene.find((s) => s.id === selection[0]);

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

  const onDown = (e: React.PointerEvent) => {
    const p = toComp(e);
    const item = hit(scene, p.x, p.y);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (tool === 'turn') {
      const root = project.rig.nodes[project.rig.rootId];
      drag.current = { mode: 'turn', id: root.id, ox: p.x, oy: p.y, start: { yaw: root.surface.yaw, pitch: root.surface.pitch } };
      return;
    }
    if (!item) { select([]); drag.current = null; return; }

    const id = targetOf(item.id);
    select([item.id]);
    const node = project.rig.nodes[id];
    if (!node) return;
    drag.current = {
      mode: 'move', id, ox: p.x, oy: p.y,
      start: {
        yaw: node.surface.yaw, pitch: node.surface.pitch,
        fx: node.surface.flatOffset?.x ?? 0, fy: node.surface.flatOffset?.y ?? 0,
      },
    };
  };

  const startHandle = (mode: 'scale' | 'rotate') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!sel) return;
    const id = targetOf(sel.id);
    const node = project.rig.nodes[id];
    if (!node) return;
    const p = toComp(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      mode, id, ox: p.x, oy: p.y,
      start: {
        sx: node.transform.scale.x, sy: node.transform.scale.y, rot: node.transform.rotation,
        cx: sel.cx, cy: sel.cy, w: sel.w, h: sel.h,
        a0: Math.atan2(p.y - sel.cy, p.x - sel.cx),
      },
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toComp(e);
    const node = project.rig.nodes[d.id];
    if (!node) return;

    if (d.mode === 'turn') {
      // gentle enough that a full sweep of the stage doesn't blow straight past ±90°
      const yaw = clamp(d.start.yaw + (p.x - d.ox) * 0.18, -89, 89);
      const pitch = clamp(d.start.pitch + (p.y - d.oy) * 0.18, -89, 89);
      setValue(d.id, 'surface.yaw', yaw, `turn.${d.id}`);
      setValue(d.id, 'surface.pitch', pitch, `turn.${d.id}`);
      return;
    }

    if (d.mode === 'move') {
      if (node.surface.mapped && node.parentId === project.rig.rootId) {
        const a = (-frame.roll * Math.PI) / 180;
        const dx = p.x - frame.cx, dy = p.y - frame.cy;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (frame.squash || 1);
        const s = screenToSurface(lx, ly, project.rig, frame.R, frame.head);
        setValue(d.id, 'surface.yaw', round2(s.x - (node.eye?.distanceFromCenter ?? 0)), `move.${d.id}`);
        setValue(d.id, 'surface.pitch', round2(s.y), `move.${d.id}`);
      } else {
        setValue(d.id, 'flatOffset.x', round2(d.start.fx + p.x - d.ox), `move.${d.id}`);
        setValue(d.id, 'flatOffset.y', round2(d.start.fy + p.y - d.oy), `move.${d.id}`);
      }
      return;
    }

    if (d.mode === 'scale') {
      const a = (-d.start.rot * Math.PI) / 180;
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

  const reset = () => commit((p: Project) => {
    p.rig.camera.offset = { x: 0, y: 0 };
    const root = p.rig.nodes[p.rig.rootId];
    root.surface.yaw = 0; root.surface.pitch = 0; root.surface.flatOffset = { x: 0, y: 0 };
  });

  const transparent = bg === 'transparent';
  return (
    <div ref={frameRef} className={`stage-frame${transparent ? ' checker' : ''}${!transparent && isLight(bg) ? ' on-light' : ''}${fullscreen ? ' fullscreen' : ''}`}
      style={transparent ? undefined : { background: bg }}>
      <svg ref={svgRef} viewBox={`0 0 ${COMP.width} ${COMP.height}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <rect x={0.5} y={0.5} width={COMP.width - 1} height={COMP.height - 1}
          fill="none" style={{ stroke: 'rgba(var(--stage-ink), .1)' }} pointerEvents="none" />
        {showGuides && (
          <ellipse cx={frame.cx} cy={frame.cy} rx={frame.R} ry={frame.R * frame.squash}
            transform={`rotate(${frame.roll} ${frame.cx} ${frame.cy})`}
            fill="none" style={{ stroke: 'rgba(var(--stage-ink), .14)' }} strokeDasharray="4 6" pointerEvents="none" />
        )}
        <Shapes scene={scene} />

        {/* the emitter being edited gets its path drawn over the mascot, with the ends and
            the fade point draggable — otherwise it is a dozen numbers aiming at nothing */}
        {selectedEmitter && showGuides && (
          <TrajectoryHandles emitter={selectedEmitter} rig={rig} scene={scene} view={COMP} toComp={toComp} />
        )}

        {sel && showGuides && (
          <g pointerEvents="none">
            <g transform={`rotate(${sel.rotation} ${sel.cx} ${sel.cy})`}>
              <rect className="sel-ring" x={sel.cx - sel.w / 2 - 5} y={sel.cy - sel.h / 2 - 5}
                width={sel.w + 10} height={sel.h + 10} rx={6} />
              <circle className="handle" cx={sel.cx + sel.w / 2 + 5} cy={sel.cy + sel.h / 2 + 5} r={5.5}
                pointerEvents="all" onPointerDown={startHandle('scale')} onPointerMove={onMove} onPointerUp={onUp} />
              <line x1={sel.cx} y1={sel.cy - sel.h / 2 - 5} x2={sel.cx} y2={sel.cy - sel.h / 2 - 22}
                stroke="var(--signal)" strokeWidth={1.25} />
              <circle className="handle" cx={sel.cx} cy={sel.cy - sel.h / 2 - 24} r={5.5}
                pointerEvents="all" onPointerDown={startHandle('rotate')} onPointerMove={onMove} onPointerUp={onUp} />
            </g>
          </g>
        )}
      </svg>
      <div className="stage-grid" />
      <div className="stage-tools">
        <button className="btn icon sm" aria-pressed={tool === 'select'} title="Select and move (V)" onClick={() => setTool('select')}>↖</button>
        <button className="btn icon sm" data-tour="tool-turn" aria-pressed={tool === 'turn'} title="Turn the head (T)" onClick={() => setTool('turn')}>◍</button>
        <button className="btn icon sm" aria-pressed={showGuides} title="Guides (G)" onClick={() => setShowGuides((v) => !v)}>⌗</button>
        <button className="btn icon sm" title="Recentre" onClick={reset}>⌂</button>
        <button className="btn icon sm" aria-pressed={fullscreen} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
          onClick={toggleFullscreen}>⛶</button>
        <div className="stage-bg" title="Preview background only — exports stay transparent">
          {BG_SWATCHES.map((c) => (
            <button key={c} className={`sw${c === 'transparent' ? ' checker' : ''}`} aria-pressed={bg === c}
              title={c === 'transparent' ? 'Transparent (as exported)' : c}
              style={c === 'transparent' ? undefined : { background: c }}
              onClick={() => setBgPersist(c)} />
          ))}
          <input type="color" aria-label="Custom preview background"
            value={transparent ? '#17161b' : bg} onChange={(e) => setBgPersist(e.target.value)} />
        </div>
      </div>
      <div className="stage-meta">
        <span>{COMP.width}×{COMP.height}</span>
        <span>yaw {frame.head.x.toFixed(1)}° · pitch {frame.head.y.toFixed(1)}°</span>
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
