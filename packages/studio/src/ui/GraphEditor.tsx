import { useEffect, useRef } from 'react';
import { useEditor } from '../core/store';
import { curveHandles } from '../core/easing';
import { sampleTrack } from '../core/scene';
import { activeTimeline, type Keyframe, type Project, type Track } from '../core/types';
import { PROP_LABEL } from '../core/props';
import { clipColor } from './Timeline';

const PAD = { l: 40, r: 14, t: 14, b: 20 };
const PALETTE = ['#2233e0', '#d9401f', '#2f9e57', '#a24bd6', '#c98a12', '#0f8ea3'];
const STEPS = 36;

/** A track's own clip color when it has one, else the next unused fallback from the
 * palette — so a colored clip's curves read the same accent everywhere, and an
 * uncolored one still gets a distinct line instead of every track defaulting to blue. */
function colorFor(project: Project, track: Track, index: number): string {
  const block = track.blockId ? activeTimeline(project).blocks.find((b) => b.id === track.blockId) : undefined;
  return clipColor(project, block) ?? PALETTE[index % PALETTE.length];
}

/**
 * The segment whose curve a selected key shows: the one leaving it — or, on the last key of
 * a track, the one arriving at it, because the last key leaves nothing and its handles would
 * otherwise never appear. The curve is always stored on `a`.
 */
function segmentOf(track: Track, kfId: string): { a: Keyframe; b: Keyframe } | null {
  const i = track.keyframes.findIndex((k) => k.id === kfId);
  if (i < 0) return null;
  if (i < track.keyframes.length - 1) return { a: track.keyframes[i], b: track.keyframes[i + 1] };
  return i > 0 ? { a: track.keyframes[i - 1], b: track.keyframes[i] } : null;
}

/**
 * Value-vs-time graph, After Effects style: keyframe points sit on the curve and the
 * bezier handles between two keys are the easing itself. Canvas, because 200 sampled
 * points per track per frame is not a job for the DOM.
 */
export function GraphEditor({ tracks, selected, onSelect, focus, onToggleFocus, onClearFocus }: {
  tracks: Track[];
  selected: { trackId: string; kfId: string } | null;
  onSelect: (s: { trackId: string; kfId: string } | null) => void;
  /** track ids to draw at full strength; every other track fades — empty set means "show
   * all equally". Set (not derived from `selected`) so a property stays focused across
   * keyframe picks, and survives switching between Tracks and Graph view. */
  focus: Set<string>;
  onToggleFocus: (id: string, additive: boolean) => void;
  onClearFocus: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const moveKeyframe = useEditor((s) => s.moveKeyframe);
  const setEasing = useEditor((s) => s.setEasing);
  const commit = useEditor((s) => s.commit);
  const drag = useRef<{
    kind: 'kf' | 'h1' | 'h2' | 'scrub'; trackId: string; kfId: string;
    /** the pointer and the key at grab time: a key moves BY the drag, never TO the pointer */
    x0: number; y0: number; t0: number; v0: number; moved: boolean;
  } | null>(null);
  /** the value ranges at grab time — held still while dragging, or the axis rescales under the
   *  pointer and the value it maps to runs away */
  const frozen = useRef<Map<string, [number, number]> | null>(null);

  const numeric = tracks.filter((t) => t.keyframes.every((k) => typeof k.value === 'number'));
  const duration = Math.max(activeTimeline(project).timelineDurationMs, 1);

  // Each track gets its own vertical range. A shared one would flatten openness (0–1)
  // into a hairline next to yaw (degrees) — the same reason After Effects normalises.
  // It fits everything that is drawn: the keys, the curve between them (a bounce or an
  // overshoot goes past both keys) and the selected segment's handles, so nothing is ever
  // off the top or the bottom.
  const fitted = new Map<string, [number, number]>();
  for (const t of numeric) {
    let a = Infinity, b = -Infinity;
    const take = (v: number) => { if (Number.isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); } };
    t.keyframes.forEach((k, i) => {
      take(k.value as number);
      const next = t.keyframes[i + 1];
      if (next) for (let s = 1; s < STEPS; s++) take(sampleTrack(t, k.time + ((next.time - k.time) * s) / STEPS) as number);
    });
    const seg = selected?.trackId === t.id ? segmentOf(t, selected.kfId) : null;
    if (seg) {
      const dv = (seg.b.value as number) - (seg.a.value as number);
      for (const h of curveHandles(seg.a.easingOut)) take((seg.a.value as number) + dv * h.y);
    }
    if (!Number.isFinite(a)) { a = 0; b = 1; }
    if (b - a < 1e-6) { a -= 0.5; b += 0.5; }
    const pad = (b - a) * 0.12;
    fitted.set(t.id, [a - pad, b + pad]);
  }
  const ranges = frozen.current ?? fitted;
  const axisTrack = numeric.find((t) => t.id === selected?.trackId) ?? numeric.find((t) => focus.has(t.id)) ?? numeric[0];
  const [lo, hi] = (axisTrack && ranges.get(axisTrack.id)) ?? [0, 1];
  const rangeOf = (id: string) => ranges.get(id) ?? fitted.get(id) ?? [lo, hi];

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const X = (t: number) => PAD.l + (t / duration) * (w - PAD.l - PAD.r);
    const Yin = (v: number, a: number, b: number) => h - PAD.b - ((v - a) / (b - a)) * (h - PAD.t - PAD.b);
    const Y = (v: number) => Yin(v, lo, hi);

    // grid + value axis
    g.font = '10px JetBrains Mono, monospace';
    g.strokeStyle = 'rgba(206,198,182,.55)';
    g.fillStyle = '#857d6d';
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(w - PAD.r, y); g.stroke();
      g.fillText(v.toFixed(Math.abs(hi - lo) < 4 ? 2 : 0), 4, y + 3);
    }
    if (axisTrack) {
      g.fillStyle = '#46423b';
      g.fillText(`${PROP_LABEL[axisTrack.property] ?? axisTrack.property} · ${project.rig.nodes[axisTrack.nodeId]?.name ?? axisTrack.nodeId}`, PAD.l + 4, 11);
    }
    const secStep = duration > 8000 ? 2000 : 1000;
    for (let t = 0; t <= duration; t += secStep) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, h - PAD.b); g.stroke();
      g.fillText(`${(t / 1000).toFixed(0)}s`, x + 3, h - 6);
    }

    numeric.forEach((track, ti) => {
      const col = colorFor(project, track, ti);
      const keys = track.keyframes;
      if (!keys.length) return;
      const [ta, tb] = rangeOf(track.id);
      const TY = (v: number) => Yin(v, ta, tb);
      // two independent reasons to fade a line: an explicit focus set says "just these",
      // or (with no focus set) picking a keyframe already implies interest in its track.
      const dim = focus.size > 0 ? !focus.has(track.id) : (axisTrack && track.id !== axisTrack.id && selected);
      g.globalAlpha = dim ? 0.28 : 1;

      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        for (let s = 0; s <= STEPS; s++) {
          const u = s / STEPS;
          // the evaluator's own sampler, so the line IS what plays — rotation's shortest turn included
          const v = sampleTrack(track, a.time + (b.time - a.time) * u) as number;
          const x = X(a.time + (b.time - a.time) * u);
          if (i === 0 && s === 0) g.moveTo(x, TY(v)); else g.lineTo(x, TY(v));
        }
      }
      if (keys.length === 1) { g.moveTo(PAD.l, TY(keys[0].value as number)); g.lineTo(w - PAD.r, TY(keys[0].value as number)); }
      g.stroke();

      // handles of the selected keyframe's segment only — otherwise the graph turns into hair
      const seg = selected?.trackId === track.id ? segmentOf(track, selected.kfId) : null;
      if (seg) {
        const { a, b } = seg;
        const [p1, p2] = curveHandles(a.easingOut);
        const dx = b.time - a.time, dv = (b.value as number) - (a.value as number);
        const h1 = { x: X(a.time + dx * p1.x), y: TY((a.value as number) + dv * p1.y) };
        const h2 = { x: X(a.time + dx * p2.x), y: TY((a.value as number) + dv * p2.y) };
        g.strokeStyle = 'rgba(23,22,27,.45)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(a.time), TY(a.value as number)); g.lineTo(h1.x, h1.y);
        g.moveTo(X(b.time), TY(b.value as number)); g.lineTo(h2.x, h2.y); g.stroke();
        for (const p of [h1, h2]) {
          g.fillStyle = '#fff'; g.strokeStyle = '#17161b';
          g.beginPath(); g.arc(p.x, p.y, 4.5, 0, 7); g.fill(); g.stroke();
        }
      }

      for (const k of keys) {
        const on = selected?.trackId === track.id && selected.kfId === k.id;
        g.fillStyle = on ? col : '#f1eee8';
        g.strokeStyle = col; g.lineWidth = 1.6;
        g.beginPath();
        const x = X(k.time), y = TY(k.value as number);
        // a point the easing generated (a bounce, an elastic) is drawn smaller
        const r = k.bakedFrom ? 3 : 4.5;
        g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath(); g.fill(); g.stroke();
      }
      g.globalAlpha = 1;
    });

    const px = X(playhead);
    g.strokeStyle = '#2233e0'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px + 0.5, 0); g.lineTo(px + 0.5, h); g.stroke();
  });

  const geom = () => {
    const c = canvas.current!;
    const w = c.clientWidth, h = c.clientHeight;
    return {
      w, h,
      X: (t: number) => PAD.l + (t / duration) * (w - PAD.l - PAD.r),
      T: (x: number) => ((x - PAD.l) / (w - PAD.l - PAD.r)) * duration,
      Yin: (v: number, a: number, b: number) => h - PAD.b - ((v - a) / (b - a)) * (h - PAD.t - PAD.b),
      Vin: (y: number, a: number, b: number) => a + ((h - PAD.b - y) / (h - PAD.t - PAD.b)) * (b - a),
    };
  };

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    const p = at(e);
    const { X } = geom();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const yOf = (track: Track, v: number) => geom().Yin(v, ...rangeOf(track.id));
    const grab = (kind: 'kf' | 'h1' | 'h2', trackId: string, kfId: string, t0 = 0, v0 = 0) => {
      frozen.current = new Map(ranges);
      drag.current = { kind, trackId, kfId, x0: p.x, y0: p.y, t0, v0, moved: false };
    };

    if (selected) {
      const track = numeric.find((t) => t.id === selected.trackId);
      const seg = track && segmentOf(track, selected.kfId);
      if (track && seg) {
        const { a, b } = seg;
        const [p1, p2] = curveHandles(a.easingOut);
        const dx = b.time - a.time, dv = (b.value as number) - (a.value as number);
        const pts: [string, number, number][] = [
          ['h1', X(a.time + dx * p1.x), yOf(track, (a.value as number) + dv * p1.y)],
          ['h2', X(a.time + dx * p2.x), yOf(track, (a.value as number) + dv * p2.y)],
        ];
        for (const [kind, hx, hy] of pts) {
          if (Math.hypot(p.x - hx, p.y - hy) < 8) { grab(kind as 'h1', track.id, a.id); return; }
        }
      }
    }

    for (const track of numeric) {
      for (const k of track.keyframes) {
        if (Math.hypot(p.x - X(k.time), p.y - yOf(track, k.value as number)) < 8) {
          onSelect({ trackId: track.id, kfId: k.id });
          grab('kf', track.id, k.id, k.time, k.value as number);
          return;
        }
      }
    }
    drag.current = { kind: 'scrub', trackId: '', kfId: '', x0: p.x, y0: p.y, t0: 0, v0: 0, moved: true };
    setPlayhead(Math.max(0, geom().T(p.x)));
  };

  const release = () => {
    drag.current = null;
    frozen.current = null;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const g = geom();
    if (d.kind === 'scrub') { setPlayhead(Math.max(0, g.T(p.x))); return; }
    // a click is not a drag: nothing changes until the pointer has travelled 3px
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < 3) return;
    d.moved = true;

    const track = numeric.find((t) => t.id === d.trackId);
    const k = track?.keyframes.find((x) => x.id === d.kfId);
    if (!track || !k) return;
    const [ra, rb] = rangeOf(track.id);

    if (d.kind === 'kf') {
      moveKeyframe(track.id, k.id, d.t0 + g.T(p.x) - g.T(d.x0));
      const v = d.v0 + g.Vin(p.y, ra, rb) - g.Vin(d.y0, ra, rb);
      commit((proj) => {
        const kk = activeTimeline(proj).tracks.find((t) => t.id === track.id)?.keyframes.find((x) => x.id === k.id);
        if (kk) kk.value = Math.round(v * 1000) / 1000;
      }, `gval.${k.id}`);
      return;
    }

    // a handle: k is the key the segment leaves
    const next = track.keyframes[track.keyframes.indexOf(k) + 1];
    if (!next) return;
    const dx = next.time - k.time, dv = (next.value as number) - (k.value as number);
    const [p1, p2] = curveHandles(k.easingOut);
    const nx = dx === 0 ? 0 : (g.T(p.x) - k.time) / dx;
    const ny = dv === 0 ? (d.kind === 'h1' ? p1.y : p2.y) : (g.Vin(p.y, ra, rb) - (k.value as number)) / dv;
    const clamped = { x: Math.min(1, Math.max(0, nx)), y: Math.round(ny * 1000) / 1000 };
    setEasing(track.id, k.id, { type: 'bezier', p1: d.kind === 'h1' ? clamped : p1, p2: d.kind === 'h2' ? clamped : p2 });
  };

  return (
    <div className="graph-wrap">
      {numeric.length > 1 && (
        <div className="graph-legend">
          {numeric.map((t, ti) => (
            <button key={t.id} className="graph-legend-item" data-dim={focus.size > 0 && !focus.has(t.id)}
              style={{ '--dot': colorFor(project, t, ti) } as React.CSSProperties}
              title="Click to focus this curve · shift-click to focus several"
              onClick={(e) => onToggleFocus(t.id, e.shiftKey)}>
              <span className="dot" />
              {PROP_LABEL[t.property] ?? t.property} <span className="dim">· {project.rig.nodes[t.nodeId]?.name ?? t.nodeId}</span>
            </button>
          ))}
          {focus.size > 0 && <button className="btn ghost sm" style={{ height: 20, padding: '0 6px', fontSize: 10.5 }}
            onClick={onClearFocus}>show all</button>}
        </div>
      )}
      <canvas ref={canvas} className="graph"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release} />
      {!numeric.length && <div className="graph-empty">No numeric tracks here yet — animate a property to see its curve.</div>}
    </div>
  );
}
