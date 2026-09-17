import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HexColorPicker } from './ColorPicker';
import { useEditor, type Tool } from '../core/store';
import { compOf } from '../core/comp';
import { composeScene, evaluateRig, evaluateWithTransition, fromFrame, pinned, sceneFrames, stretchOf, toFrame, WORLD, type LayerFrame, type SceneItem } from '../core/scene';
import { TrajectoryHandles } from './TrajectoryHandles';
import { ShapeHandles } from './ShapeHandles';
import { CurveHandles } from './CurveHandles';
import { TextPathHandles } from './TextPathHandles';
import { screenToSurface } from '../core/curvature';
import { flattenPath, isOpenPath, pathBounds } from '../core/path';
import { curveToPath, smoothTangents, type CurvePoint } from '../core/curve';
import { hoseInputOf, limbPoints, rubberHose } from '../core/limb';
import { mascotOf } from '../core/mascot';
import { makeShapeLayer, textName } from '../core/layers';
import { Shapes } from './Mascot';
import { Icon, type IconName } from './bits';
import { openComposition } from './CompositionDialog';
import { activeTimeline } from '../core/types';
import { DEFAULT_BG, useStageBg } from './stageBg';
import type { Rig, RigNode, Vec2 } from '../core/types';

type Mode = 'move' | 'scale' | 'rotate' | 'turn' | 'limb' | 'bend' | 'pan' | 'anchor';

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

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'cursor', label: 'Select and move — shift constrains, alt duplicates', key: 'V' },
  { id: 'hand', icon: 'pan', label: 'Pan the view — ⌘/Ctrl + scroll zooms', key: 'H' },
  { id: 'shape', icon: 'shape', label: 'Shape — click to place one', key: 'S' },
  { id: 'pen', icon: 'pen', label: 'Pen — click to add points, drag to curve them', key: 'P' },
  { id: 'text', icon: 'text', label: 'Text — click to place it', key: 'T' },
  { id: 'turn', icon: 'turn', label: 'Turn a mascot’s head', key: 'R' },
];

/** Even-odd ray cast — whether a point is inside an outline's flattened polygon. */
function inPolygon(pts: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

const segDist = (px: number, py: number, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
};

/**
 * The topmost layer under a point. Outlines are tested against their real shape rather
 * than their box, so a limb's empty bounding box does not steal clicks meant for the
 * body behind it; an outline with no fill — a drawn curve — is picked by its LINE. Locked
 * layers are skipped — that is what the padlock is for.
 */
function hit(scene: SceneItem[], x: number, y: number, pickable: (id: string) => boolean): SceneItem | undefined {
  for (let i = scene.length - 1; i >= 0; i--) {
    const s = scene[i];
    if (!pickable(s.id)) continue;
    const a = (-s.rotation * Math.PI) / 180;
    const dx = x - s.cx, dy = y - s.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (s.path && s.color.a < 0.01) {
      const w = Math.max(Math.abs(s.w), 1e-3), h = Math.max(Math.abs(s.h), 1e-3);
      const pts = flattenPath(s.path, 160).map((p) => ({ x: p.x * w, y: p.y * h }));
      if (!isOpenPath(s.path) && pts.length) pts.push(pts[0]);
      const tol = Math.max(7, (s.stroke?.width ?? 0) / 2 + 4);
      if (pts.some((p, k) => k > 0 && segDist(lx, ly, pts[k - 1], p) <= tol)) return s;
      continue;
    }
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

/** A pen stroke's points as a curve: dragged points keep their handles, clicked ones get
 *  the smooth handles the curve would have given them. */
function penCurve(points: CurvePoint[], closed: boolean): { points: CurvePoint[]; type: 'smooth' | 'bezier' } {
  if (!points.some((p) => p.hin || p.hout)) return { points, type: 'smooth' };
  const auto = smoothTangents({ points, closed });
  return {
    type: 'bezier',
    points: points.map((p, i) => ({ ...p, hin: p.hin ?? { x: -auto[i].x, y: -auto[i].y }, hout: p.hout ?? auto[i] })),
  };
}

export function Stage() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const setValue = useEditor((s) => s.setValue);
  const updateNode = useEditor((s) => s.updateNode);
  const pinLimbPoint = useEditor((s) => s.pinLimbPoint);
  const editPoints = useEditor((s) => s.editPoints);
  const setEditPoints = useEditor((s) => s.setEditPoints);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const addLayer = useEditor((s) => s.addLayer);
  const addText = useEditor((s) => s.addText);
  const addCurve = useEditor((s) => s.addCurve);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const fontsVersion = useEditor((s) => s.fontsVersion);
  const [showGuides, setShowGuides] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // the view onto the canvas — pan and zoom. Not the project's camera: nothing here changes
  // what is rendered or exported, only where you are looking
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [draft, setDraft] = useState<CurvePoint[] | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const penDrag = useRef<number | null>(null);
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
  // emitters included, or the preview quietly lies about the finished animation. A font
  // arriving re-lays the text out, which is what fontsVersion is for.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => composeScene(project, rig, playhead, view), [project, rig, playhead, view, fontsVersion]);
  // every layer's frame, from the same walk that placed it — so a drag is the exact inverse
  const frames = useMemo(() => sceneFrames(rig, view), [rig, view]);
  const selectedEmitterId = useEditor((s) => s.selectedEmitterId);
  const selectedEmitter = (activeTimeline(project).emitters ?? []).find((e) => e.id === selectedEmitterId);
  const sel = scene.find((s) => s.id === selection[0]);
  const selNode = selection.length === 1 ? project.rig.nodes[selection[0]] : undefined;
  // the mascot being worked on: the head the turn tool turns, the sphere the guide draws
  const current = mascotOf(project.rig, selection[0]) ?? project.rig.nodes[project.rig.rootId];
  const body = current ? frames.get(current.id) : undefined;

  const toComp = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);
  /** composition px per screen px, for tolerances that should feel the same at any zoom */
  const unit = () => 1 / (svgRef.current?.getScreenCTM()?.a || 1);

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

  /** The pen stroke becomes a curve layer; one point or none is no curve at all. */
  const finishPen = (closed = false) => {
    const pts = (draft ?? []).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1.5);
    setDraft(null);
    setHover(null);
    if (pts.length >= 2) {
      const c = penCurve(pts, closed && pts.length > 2);
      addCurve(c.points, { closed: closed && pts.length > 2, type: c.type });
      setTool('select');
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toComp(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setEditingText(null);

    if (tool === 'hand' || e.button === 1) {
      drag.current = { mode: 'pan', id: '', ox: e.clientX, oy: e.clientY, start: { x: cam.x, y: cam.y, k: unit() } };
      return;
    }
    if (tool === 'turn') {
      // rig, not project.rig: a drag has to continue from the pose on screen. Seeded from
      // the base rig instead, an animated yaw read as 0 and the head snapped there.
      const head = current && rig.nodes[current.id];
      if (head) drag.current = { mode: 'turn', id: head.id, ox: p.x, oy: p.y, start: { yaw: head.surface.yaw, pitch: head.surface.pitch } };
      return;
    }
    if (tool === 'pen') {
      const pts = draft ?? [];
      // the first point again closes the path
      if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 9 * unit()) { finishPen(true); return; }
      setDraft([...pts, { x: p.x, y: p.y }]);
      penDrag.current = pts.length;
      return;
    }
    if (tool === 'text') {
      const id = addText('Type something', { at: p });
      setTool('select');
      setEditingText(id);
      return;
    }
    if (tool === 'shape') {
      const world = frames.get(WORLD);
      const local = world ? fromFrame(world, p) : p;
      addLayer(makeShapeLayer('circle', { surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: round2(local.x), y: round2(local.y) } } }));
      setTool('select');
      return;
    }

    const item = hit(scene, p.x, p.y, pickable);
    if (!item) { select([]); drag.current = null; return; }

    const additive = e.shiftKey && !selection.includes(item.id);
    if (additive) { select([...selection, item.id]); drag.current = null; return; }
    let id = targetOf(item.id);
    if (!selection.includes(item.id) || selection.length > 1) select([item.id]);

    // Check for limb bend handle click
    if (selection.length === 1) {
      const node = project.rig.nodes[id];
      if (node?.limb && !node.limb.c) {
        const f = frames.get(node.parentId ?? WORLD);
        if (f) {
          const hose = rubberHose(hoseInputOf(node.limb, (v) => toFrame(f, v), f.cum));
          if (hose && hose.centreline.length) {
            const mid = hose.centreline[Math.floor(hose.centreline.length / 2)];
            const midComp = toFrame(f, mid);
            if (Math.hypot(p.x - midComp.x, p.y - midComp.y) < 10 * unit()) {
              drag.current = { mode: 'bend', id, ox: p.x, oy: p.y, frame: f, start: { bend: node.limb.bend } };
              return;
            }
          }
        }
      }
    }

    // Alt/Option-drag leaves the original where it was and drags a copy away
    if (e.altKey) {
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

  /** Where the selected layer's anchor is drawn, in its own rotated box, and the px one local
   *  unit of anchor is along each axis there. */
  const anchorOf = (id: string) => {
    const node = rig.nodes[id];
    const f = frames.get(node?.parentId ?? WORLD), mine = frames.get(id);
    if (!node || !f || !mine || node.kind === 'limb') return null;
    const st = stretchOf(node);
    // a body's frame carries its own stretch per axis; any other layer's parent is uniform
    const sxk = node.kind === 'body' ? mine.kx : mine.parentCum * st.x;
    const syk = node.kind === 'body' ? mine.ky : mine.parentCum * st.y;
    const a = node.anchor ?? { x: 0, y: 0 };
    return { x: a.x * sxk, y: a.y * syk, sxk, syk, k: mine.parentCum, f, node, a };
  };

  const startAnchor = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!sel) return;
    const id = targetOf(sel.id);
    const at = anchorOf(id);
    if (!at) return;
    const p = toComp(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      mode: 'anchor', id, ox: p.x, oy: p.y,
      start: {
        ax: at.a.x, ay: at.a.y, sxk: at.sxk, syk: at.syk, k: at.k, cx: sel.cx, cy: sel.cy, rot: sel.rotation,
        prot: at.f.rot, pkx: at.f.kx, pky: at.f.ky,
        fx: at.node.surface.flatOffset?.x ?? 0, fy: at.node.surface.flatOffset?.y ?? 0,
      },
    };
  };

  const startLimbPoint = (key: 'a' | 'b' | 'c', limbId = selNode?.id) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const node = limbId ? rig.nodes[limbId] : undefined;
    if (!node?.limb) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toComp(e);
    drag.current = { mode: 'limb', id: node.id, key, ox: p.x, oy: p.y, frame: frames.get(node.parentId ?? WORLD),
      start: { x: node.limb[key]?.x ?? 0, y: node.limb[key]?.y ?? 0 } };
  };

  const onMove = (e: React.PointerEvent) => {
    if (tool === 'pen') {
      const p = toComp(e);
      const i = penDrag.current;
      if (i !== null && e.buttons) {
        // dragging off a new point pulls out its handles: a smooth point, curved your way
        setDraft((d) => {
          if (!d?.[i]) return d;
          const h = { x: p.x - d[i].x, y: p.y - d[i].y };
          if (Math.hypot(h.x, h.y) < 3 * unit()) return d;
          const next = [...d];
          next[i] = { ...d[i], hout: h, hin: { x: -h.x, y: -h.y } };
          return next;
        });
      } else setHover(p);
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setCam((c) => ({ ...c, x: d.start.x - (e.clientX - d.ox) * d.start.k, y: d.start.y - (e.clientY - d.oy) * d.start.k }));
      return;
    }
    let p = toComp(e);
    const node = useEditor.getState().project.rig.nodes[d.id];
    if (!node) return;

    if (d.mode === 'bend' && d.frame) {
      const l = node.limb!;
      const a = toFrame(d.frame, l.a);
      const b = toFrame(d.frame, l.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const nx = -dy / length, ny = dx / length;
        const delta = (p.x - d.ox) * nx + (p.y - d.oy) * ny;
        setValue(d.id, 'limb.bend', round2(d.start.bend + delta * 0.01), `bend.${d.id}`);
      }
      return;
    }
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
      // a planted foot moves its pin: that is where the ground is now
      const l = node.limb;
      const isEnd = !!l && d.key === limbPoints(l)[limbPoints(l).length - 1];
      if (l && frames.get(WORLD) && (isEnd ? l.pin : l.pins?.[d.key])) {
        const w = fromFrame(frames.get(WORLD)!, p);
        const at = { x: round2(w.x), y: round2(w.y) };
        // through setValue, so a keyed pin gets a keyframe here like any other drag
        setValue(d.id, `limb.pin.${d.key}.x`, at.x, `pin.${d.id}`);
        setValue(d.id, `limb.pin.${d.key}.y`, at.y, `pin.${d.id}`);
        return;
      }
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
      // on a sphere: the body's, or the face's that hands the body's down
      const onSphere = node.surface.mapped && f && f.R > 0;
      if (onSphere && f) {
        // on any mascot's surface: the point under the pointer, as yaw and pitch on its sphere
        const a = (-f.rot * Math.PI) / 180;
        const dx = p.x - f.x, dy = p.y - f.y;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (f.squash || 1);
        const s = screenToSurface(lx, ly, project.rig, f.R, f.head);
        setValue(d.id, 'surface.yaw', round2(s.x - (node.eye?.distanceFromCenter ?? 0)), `move.${d.id}`);
        setValue(d.id, 'surface.pitch', round2(s.y), `move.${d.id}`);
      } else if (f) {
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
      const uniform = e.shiftKey || node.kind === 'text' ? Math.max(kx, ky) : 0;
      setValue(d.id, 'transform.scale.x', clamp(d.start.sx * (uniform || kx), 0.03, 6), `scale.${d.id}`);
      setValue(d.id, 'transform.scale.y', clamp(d.start.sy * (uniform || ky), 0.03, 6), `scale.${d.id}`);
      return;
    }

    if (d.mode === 'anchor') {
      // the point under the pointer, in the layer's own unscaled px from its centre — and the
      // position nudged by exactly what that pivot change would shift, so nothing moves
      const q = rotate(p.x - d.start.cx, p.y - d.start.cy, (-d.start.rot * Math.PI) / 180);
      const ax = round2(q.x / (d.start.sxk || 1)), ay = round2(q.y / (d.start.syk || 1));
      const dax = (ax - d.start.ax) * d.start.k, day = (ay - d.start.ay) * d.start.k;
      const r0 = (d.start.prot * Math.PI) / 180, r1 = (d.start.rot * Math.PI) / 180;
      const s0 = rotate(dax, day, r0);
      const s1 = rotate(dax * (d.start.sxk / (d.start.k || 1)), day * (d.start.syk / (d.start.k || 1)), r1);
      const back = rotate(s0.x - s1.x, s0.y - s1.y, -r0);
      setValue(d.id, 'anchor.x', ax, `anchor.${d.id}`);
      setValue(d.id, 'anchor.y', ay, `anchor.${d.id}`);
      if (!node.surface.mapped) {
        setValue(d.id, 'flatOffset.x', round2(d.start.fx - back.x / (d.start.pkx || 1)), `anchor.${d.id}`);
        setValue(d.id, 'flatOffset.y', round2(d.start.fy - back.y / (d.start.pky || 1)), `anchor.${d.id}`);
      }
      return;
    }

    if (d.mode === 'rotate') {
      const a = Math.atan2(p.y - d.start.cy, p.x - d.start.cx);
      let deg = d.start.rot + ((a - d.start.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      setValue(d.id, 'transform.rotation', round2(((deg + 180) % 360 + 360) % 360 - 180), `rot.${d.id}`);
    }
  };

  const onUp = () => { drag.current = null; penDrag.current = null; };

  // ⌘/Ctrl + scroll zooms about the pointer; a plain scroll (a trackpad's two fingers) pans.
  // A native listener: React's wheel listener is passive, so it cannot stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = 1 / (svg.getScreenCTM()?.a || 1);
      if (!(e.ctrlKey || e.metaKey)) { setCam((c) => ({ ...c, x: c.x + e.deltaX * k, y: c.y + e.deltaY * k })); return; }
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      setCam((c) => {
        const z = clamp(c.z * Math.exp(-e.deltaY * 0.0025), 0.2, 8);
        const x0 = view.width / 2 - view.width / (2 * c.z) + c.x, y0 = view.height / 2 - view.height / (2 * c.z) + c.y;
        const u = (p.x - x0) / (view.width / c.z), v = (p.y - y0) / (view.height / c.z);
        return { z, x: p.x - u * (view.width / z) - view.width / 2 + view.width / (2 * z), y: p.y - v * (view.height / z) - view.height / 2 + view.height / (2 * z) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [view.width, view.height]);

  // arrow keys nudge the selection: 1px (or 1°), 10 with shift — one undo step per burst.
  // Letters pick tools; Enter finishes a pen stroke and Escape drops it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (draft && e.key === 'Enter') { e.preventDefault(); finishPen(false); return; }
      if (e.key === 'Escape') {
        if (draft) { setDraft(null); setHover(null); return; }
        if (tool !== 'select') { setTool('select'); return; }
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (t) { setTool(t.id); return; }
        if (e.key.toLowerCase() === 'g') { setShowGuides((v) => !v); return; }
      }
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
        } else if (n.surface.mapped && n.kind !== 'body') {
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
    // finishPen reads `draft` — re-bound whenever it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, setValue, draft, tool, setTool]);

  const limbNode: RigNode | undefined = selNode?.limb ? rig.nodes[selNode.id] : undefined;
  const limbFrame = limbNode ? frames.get(limbNode.parentId ?? WORLD) : undefined;
  const isCurve = !!selNode?.curve && !!sel?.path;
  const showBox = sel && showGuides && tool === 'select' && !sel.limb && !isCurve && !(editPoints && sel.path);
  const attachedTo = selNode && selNode.parentId && selNode.kind !== 'eye' && selNode.kind !== 'limb' ? frames.get(selNode.parentId) : undefined;
  // a curve's box is its line's extent, not the square it is stored in
  const box = (() => {
    if (!sel) return null;
    const b = sel.path && selNode?.curve ? pathBounds(sel.path) : null;
    return b ? { x0: b.x0 * sel.w, y0: b.y0 * sel.h, x1: b.x1 * sel.w, y1: b.y1 * sel.h } : { x0: -sel.w / 2, y0: -sel.h / 2, x1: sel.w / 2, y1: sel.h / 2 };
  })();

  const editNode = editingText ? project.rig.nodes[editingText] : undefined;
  const editItem = editingText ? scene.find((s) => s.id === editingText) : undefined;

  const penPreview = draft && draft.length ? penCurve(hover && penDrag.current === null ? [...draft, hover] : draft, false) : null;

  const vb = { w: view.width / cam.z, h: view.height / cam.z };
  const viewBox = `${view.width / 2 - vb.w / 2 + cam.x} ${view.height / 2 - vb.h / 2 + cam.y} ${vb.w} ${vb.h}`;
  const transparent = bg === 'transparent';
  return (
    <div ref={frameRef} className={`stage-frame${transparent ? ' checker' : ''}${!transparent && isLight(bg) ? ' on-light' : ''}${fullscreen ? ' fullscreen' : ''}`}
      style={transparent ? undefined : { background: bg }} data-tool={tool}>
      <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => {
          if (tool === 'pen') { finishPen(false); return; }
          if (selNode?.kind === 'text') { setEditingText(selNode.id); return; }
          if (sel?.path && !sel.limb && !isCurve) setEditPoints(!editPoints);
        }}>
        <rect x={0.5} y={0.5} width={view.width - 1} height={view.height - 1}
          fill="none" style={{ stroke: 'rgba(var(--stage-ink), .1)' }} pointerEvents="none" />
        {showGuides && body && (
          <ellipse cx={body.x} cy={body.y} rx={body.R} ry={body.R * body.squash}
            transform={`rotate(${body.rot} ${body.x} ${body.y})`}
            fill="none" style={{ stroke: 'rgba(var(--stage-ink), .14)' }} strokeDasharray="4 6" pointerEvents="none" />
        )}
        <Shapes scene={scene} guides={showGuides} />
        {/* past the composition's edge is not in any export — dim it, art that spills there included */}
        <path className="stage-outside" fillRule="evenodd" pointerEvents="none"
          d={`M${-view.width * 20} ${-view.height * 20}H${view.width * 21}V${view.height * 21}H${-view.width * 20}Z M0 0H${view.width}V${view.height}H0Z`} />

        {/* an attached layer shows what it is attached to: a faint tether to its anchor */}
        {sel && attachedTo && showGuides && (
          <g pointerEvents="none" className="tether">
            <line x1={attachedTo.x} y1={attachedTo.y} x2={sel.cx} y2={sel.cy} />
            <circle cx={attachedTo.x} cy={attachedTo.y} r={3} />
          </g>
        )}

        {/* the selected layer's outline as draggable points, in shape-edit mode */}
        {sel?.path && !sel.limb && !isCurve && editPoints && showGuides && selection.length === 1 && (
          <ShapeHandles nodeId={selection[0]} item={sel} path={sel.path} toComp={toComp} />
        )}
        {/* a curve shows its points whenever it is selected — they are the thing to edit */}
        {isCurve && selNode && sel && showGuides && tool === 'select' && selection.length === 1 && (
          <CurveHandles node={selNode} item={sel} toComp={toComp} />
        )}
        {selNode?.kind === 'text' && sel && showGuides && tool === 'select' && (
          <TextPathHandles node={selNode} item={sel} scene={scene} frame={frames.get(selNode.id)} toComp={toComp} />
        )}

        {selectedEmitter && showGuides && (
          <TrajectoryHandles emitter={selectedEmitter} rig={rig} scene={scene} view={view} toComp={toComp} />
        )}

        {showBox && sel && box && (
          <g pointerEvents="none">
            <g transform={`translate(${sel.cx} ${sel.cy}) rotate(${sel.rotation})`}>
              <rect className="sel-ring" x={box.x0 - 5} y={box.y0 - 5} width={box.x1 - box.x0 + 10} height={box.y1 - box.y0 + 10} rx={6} />
              {([[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]] as const).map(([x, y], i) => (
                <rect key={i} className="handle sq" width={9} height={9} rx={2}
                  x={x + Math.sign(x || -1) * 5 - 4.5} y={y + Math.sign(y || -1) * 5 - 4.5}
                  pointerEvents="all" onPointerDown={startHandle('scale')} onPointerMove={onMove} onPointerUp={onUp} />
              ))}
              <line x1={(box.x0 + box.x1) / 2} y1={box.y0 - 5} x2={(box.x0 + box.x1) / 2} y2={box.y0 - 22}
                stroke="var(--signal)" strokeWidth={1.25} />
              <circle className="handle" cx={(box.x0 + box.x1) / 2} cy={box.y0 - 24} r={5.5}
                pointerEvents="all" onPointerDown={startHandle('rotate')} onPointerMove={onMove} onPointerUp={onUp} />
              {(() => {
                const at = anchorOf(targetOf(sel.id));
                if (!at) return null;
                return (
                  <g className="anchor-handle" transform={`translate(${at.x} ${at.y})`} pointerEvents="all"
                    onPointerDown={startAnchor} onPointerMove={onMove} onPointerUp={onUp}>
                    <title>Anchor — what it turns, scales and squishes around. Drag to move it.</title>
                    <circle r={9} fill="transparent" />
                    <circle r={4.5} fill="none" stroke="var(--signal)" strokeWidth={1.25} />
                    <line x1={-9} x2={9} y1={0} y2={0} stroke="var(--signal)" strokeWidth={1.25} />
                    <line x1={0} x2={0} y1={-9} y2={9} stroke="var(--signal)" strokeWidth={1.25} />
                  </g>
                );
              })()}
            </g>
          </g>
        )}

        {/* posing: with a mascot (or any part of it that is not a limb) selected, every hand and
            foot it has is a handle — drag them straight into a pose, no limb to select first */}
        {!limbNode && current && mascotOf(project.rig, selection[0]) && showGuides && tool === 'select' && selection.length === 1 && (
          <g className="pose-handles">
            {Object.values(rig.nodes).filter((n) => n.limb && mascotOf(project.rig, n.id)?.id === current.id).map((n) => {
              const f = frames.get(n.parentId ?? WORLD);
              if (!f || !n.limb) return null;
              const keys = limbPoints(n.limb).slice(1);
              return keys.map((k, i) => {
                const pt = n.limb!.pin && i === keys.length - 1 && frames.get(WORLD) ? toFrame(frames.get(WORLD)!, n.limb!.pin) : toFrame(f, n.limb![k]!);
                const end = i === keys.length - 1;
                return (
                  <circle key={`${n.id}.${k}`} cx={pt.x} cy={pt.y} r={end ? 6 : 4.5} className={`limb-pt pose-pt${end ? ' end' : ''}`}
                    pointerEvents="all" onPointerDown={startLimbPoint(k, n.id)} onPointerMove={onMove} onPointerUp={onUp}>
                    <title>{`${n.name} — ${n.limb!.type === 'leg' ? (end ? 'foot' : 'knee') : (end ? 'hand' : 'elbow')}: drag to pose`}</title>
                  </circle>
                );
              });
            })}
          </g>
        )}

        {/* a limb is edited by its points and nothing else: two for a hand, three for a leg */}
        {limbNode?.limb && limbFrame && showGuides && (
          <g className="limb-handles">
            {(() => {
              const l = limbNode.limb!;
              // exactly on the points: the length shapes the curve between them, never
              // where they are
              // where each point is drawn — a pinned one at its pin
              const placed = pinned(hoseInputOf(l, (v) => toFrame(limbFrame, v), limbFrame.cum), l, frames.get(WORLD)!).points;
              const keys = limbPoints(l);
              const pts = keys.map((k, i) => ({ k, at: placed[i] }));
              const isPinned = (k: 'a' | 'b' | 'c') => (k === keys[keys.length - 1] ? !!l.pin : !!l.pins?.[k]);
              // where the hose actually ends: short of the hand when it is out of reach,
              // because a rubber hose keeps its length rather than stretching
              const end = rubberHose(pinned(hoseInputOf(l, (v) => toFrame(limbFrame, v), limbFrame.cum), l, frames.get(WORLD)!))?.end;
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
                  {pts.map(({ k, at }) => {
                    const name = l.type === 'leg' ? { a: 'Hip', b: l.c ? 'Knee' : 'Ankle', c: 'Ankle' }[k] : { a: 'Shoulder', b: l.c ? 'Elbow' : 'Hand', c: 'Hand' }[k];
                    const on = isPinned(k);
                    return (
                      <g key={k}>
                        <circle cx={at.x} cy={at.y} r={k === 'a' ? 6 : 7} className={`limb-pt limb-pt-${k}${on ? ' pinned' : ''}`}
                          pointerEvents="all" onPointerDown={startLimbPoint(k)} onPointerMove={onMove} onPointerUp={onUp}>
                          <title>{`${name}${on ? ' — pinned in place' : ''}`}</title>
                        </circle>
                        {/* the pin: holds this point where it is in the world */}
                        <g className="limb-pin" data-on={on || undefined} transform={`translate(${at.x + 10} ${at.y - 22})`} pointerEvents="all"
                          onPointerDown={(e) => { e.stopPropagation(); pinLimbPoint(limbNode.id, k, !on); }}>
                          <title>{on ? `Unpin the ${name.toLowerCase()} — it follows the body again` : `Pin the ${name.toLowerCase()} where it is — the body moves, it stays`}</title>
                          <circle r={9} cx={6} cy={6} />
                          <path d="M6 9.5v3.5 M4.2 1.2h3.6l-.6 3.6 1.8 1.8v1.2H3v-1.2l1.8-1.8-.6-3.6Z" transform="translate(0 0)" />
                        </g>
                      </g>
                    );
                  })}
                </>
              );
            })()}
          </g>
        )}

        {/* the pen's stroke in progress */}
        {penPreview && draft && (
          <g className="pen-draft" pointerEvents="none">
            <path d={curveToPath({ points: penPreview.points, closed: false }, penPreview.type)} />
            {draft.map((p, i) => (
              <g key={i}>
                {p.hout && <line x1={p.x - p.hout.x} y1={p.y - p.hout.y} x2={p.x + p.hout.x} y2={p.y + p.hout.y} className="pen-arm" />}
                <circle cx={p.x} cy={p.y} r={i === 0 && draft.length >= 3 ? 6 : 4} data-first={i === 0 || undefined} />
              </g>
            ))}
          </g>
        )}

        {/* typing into a text layer, on the canvas, just under the words */}
        {editNode?.text && editItem && (
          <foreignObject x={editItem.cx - 140} y={editItem.cy + Math.max(editItem.h, 20) / 2 + 10} width={280} height={112}>
            <div className="text-edit" onPointerDown={(e) => e.stopPropagation()}>
              <textarea autoFocus aria-label="Text" value={editNode.text.content} rows={3}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const v = e.target.value;
                  const label = `content.${editNode.id}`;
                  setValue(editNode.id, 'text.content', v, label);
                  if (editNode.name === textName(editNode.text!.content)) updateNode(editNode.id, (n) => { n.name = textName(v); }, label);
                }}
                onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); setEditingText(null); } }} />
              <span>Esc or ⌘↵ to finish</span>
            </div>
          </foreignObject>
        )}
      </svg>
      <div className="stage-grid" />
      <div className="stage-tools">
        <div className="tool-group" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} className="btn icon sm" aria-pressed={tool === t.id} title={`${t.label} (${t.key})`}
              data-tour={t.id === 'turn' ? 'tool-turn' : undefined}
              onClick={() => { setDraft(null); setTool(t.id); }}><Icon name={t.icon} /></button>
          ))}
        </div>
        <div className="tool-group">
          <button className="btn icon sm" aria-pressed={editPoints} disabled={!sel?.path || !!sel.limb || isCurve} title="Edit the outline's points (or double-click the shape)"
            onClick={() => setEditPoints(!editPoints)}><Icon name="points" /></button>
          <button className="btn icon sm" aria-pressed={showGuides} title="Guides (G)" onClick={() => setShowGuides((v) => !v)}><Icon name="grid" /></button>
          <button className="btn icon sm" title="Fit the view" disabled={cam.x === 0 && cam.y === 0 && cam.z === 1} onClick={() => setCam({ x: 0, y: 0, z: 1 })}><Icon name="centre" /></button>
          <button className="btn icon sm" aria-pressed={fullscreen} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
            onClick={toggleFullscreen}><Icon name="expand" /></button>
        </div>
        <div className="stage-bg" title="Backdrop for the preview and for every export">
          {BG_SWATCHES.map((c) => (
            <button key={c} className={`sw${c === 'transparent' ? ' checker' : ''}`} aria-pressed={bg === c}
              title={c === 'transparent' ? 'Transparent (no backdrop in exports)' : c}
              style={c === 'transparent' ? undefined : { background: c }}
              onClick={() => setBgPersist(c)} />
          ))}
          <HexColorPicker label="Custom preview background" value={transparent ? DEFAULT_BG : bg} onChange={setBgPersist} />
        </div>
      </div>
      {tool === 'pen' && (
        <div className="stage-hint" role="status">
          {draft?.length ? 'Click to add points, drag to curve them · click the first point to close · double-click or Enter to finish · Esc to cancel'
            : 'Click to start a curve — each click adds a point, drag to curve it'}
        </div>
      )}
      {tool === 'text' && <div className="stage-hint" role="status">Click where the text should go</div>}
      {tool === 'shape' && <div className="stage-hint" role="status">Click to place a shape</div>}
      <div className="stage-meta">
        <button className="stage-meta-size" onClick={openComposition} title="Composition settings">{view.width}×{view.height}</button>
        <span>yaw {(body?.head.x ?? 0).toFixed(1)}° · pitch {(body?.head.y ?? 0).toFixed(1)}°</span>
        <span>fov {rig.camera.fov.toFixed(0)}°</span>
        {cam.z !== 1 && <span>{Math.round(cam.z * 100)}%</span>}
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
