import { useEffect, useRef } from 'react';
import { useEditor } from '../core/store';
import { applyEasing, curveHandles } from '../core/easing';
import type { Track } from '../core/types';

const PAD = { l: 40, r: 14, t: 14, b: 20 };

/**
 * Value-vs-time graph, After Effects style: keyframe points sit on the curve and the
 * bezier handles between two keys are the easing itself. Canvas, because 200 sampled
 * points per track per frame is not a job for the DOM.
 */
export function GraphEditor({ tracks, selected, onSelect }: {
  tracks: Track[];
  selected: { trackId: string; kfId: string } | null;
  onSelect: (s: { trackId: string; kfId: string } | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const moveKeyframe = useEditor((s) => s.moveKeyframe);
  const setEasing = useEditor((s) => s.setEasing);
  const commit = useEditor((s) => s.commit);
  const drag = useRef<{ kind: 'kf' | 'h1' | 'h2' | 'scrub'; trackId: string; kfId: string } | null>(null);

  const numeric = tracks.filter((t) => t.keyframes.every((k) => typeof k.value === 'number'));
  const duration = Math.max(project.timelineDurationMs, 1);

  // shared value range so tracks are comparable, with a floor so a flat track isn't a wall
  let lo = Infinity, hi = -Infinity;
  for (const t of numeric) for (const k of t.keyframes) { lo = Math.min(lo, k.value as number); hi = Math.max(hi, k.value as number); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const padV = (hi - lo) * 0.14;
  lo -= padV; hi += padV;

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
    const Y = (v: number) => h - PAD.b - ((v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);

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
    const secStep = duration > 8000 ? 2000 : 1000;
    for (let t = 0; t <= duration; t += secStep) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, h - PAD.b); g.stroke();
      g.fillText(`${(t / 1000).toFixed(0)}s`, x + 3, h - 6);
    }

    const palette = ['#2233e0', '#d9401f', '#2f9e57', '#a24bd6', '#c98a12', '#0f8ea3'];
    numeric.forEach((track, ti) => {
      const col = palette[ti % palette.length];
      const keys = track.keyframes;
      if (!keys.length) return;

      g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        const STEPS = 36;
        for (let s = 0; s <= STEPS; s++) {
          const u = s / STEPS;
          const v = (a.value as number) + ((b.value as number) - (a.value as number)) * applyEasing(a.easingOut, u);
          const x = X(a.time + (b.time - a.time) * u);
          if (i === 0 && s === 0) g.moveTo(x, Y(v)); else g.lineTo(x, Y(v));
        }
      }
      if (keys.length === 1) { g.moveTo(PAD.l, Y(keys[0].value as number)); g.lineTo(w - PAD.r, Y(keys[0].value as number)); }
      g.stroke();

      // handles of the selected keyframe only — otherwise the graph turns into hair
      const selKey = selected?.trackId === track.id ? keys.find((k) => k.id === selected.kfId) : null;
      if (selKey) {
        const i = keys.indexOf(selKey);
        const next = keys[i + 1];
        if (next) {
          const [p1, p2] = curveHandles(selKey.easingOut);
          const dx = next.time - selKey.time, dv = (next.value as number) - (selKey.value as number);
          const h1 = { x: X(selKey.time + dx * p1.x), y: Y((selKey.value as number) + dv * p1.y) };
          const h2 = { x: X(selKey.time + dx * p2.x), y: Y((selKey.value as number) + dv * p2.y) };
          g.strokeStyle = 'rgba(23,22,27,.45)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(X(selKey.time), Y(selKey.value as number)); g.lineTo(h1.x, h1.y);
          g.moveTo(X(next.time), Y(next.value as number)); g.lineTo(h2.x, h2.y); g.stroke();
          for (const p of [h1, h2]) {
            g.fillStyle = '#fff'; g.strokeStyle = '#17161b';
            g.beginPath(); g.arc(p.x, p.y, 4.5, 0, 7); g.fill(); g.stroke();
          }
        }
      }

      for (const k of keys) {
        const on = selected?.trackId === track.id && selected.kfId === k.id;
        g.fillStyle = on ? col : '#f1eee8';
        g.strokeStyle = col; g.lineWidth = 1.6;
        g.beginPath();
        const x = X(k.time), y = Y(k.value as number);
        g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y);
        g.closePath(); g.fill(); g.stroke();
      }
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
      Y: (v: number) => h - PAD.b - ((v - lo) / (hi - lo)) * (h - PAD.t - PAD.b),
      V: (y: number) => lo + ((h - PAD.b - y) / (h - PAD.t - PAD.b)) * (hi - lo),
    };
  };

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    const p = at(e);
    const { X, Y } = geom();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (selected) {
      const track = numeric.find((t) => t.id === selected.trackId);
      const k = track?.keyframes.find((x) => x.id === selected.kfId);
      const i = k && track ? track.keyframes.indexOf(k) : -1;
      const next = track && i >= 0 ? track.keyframes[i + 1] : undefined;
      if (k && next) {
        const [p1, p2] = curveHandles(k.easingOut);
        const dx = next.time - k.time, dv = (next.value as number) - (k.value as number);
        const pts: [string, number, number][] = [
          ['h1', X(k.time + dx * p1.x), Y((k.value as number) + dv * p1.y)],
          ['h2', X(k.time + dx * p2.x), Y((k.value as number) + dv * p2.y)],
        ];
        for (const [kind, hx, hy] of pts) {
          if (Math.hypot(p.x - hx, p.y - hy) < 8) {
            drag.current = { kind: kind as 'h1', trackId: selected.trackId, kfId: selected.kfId };
            return;
          }
        }
      }
    }

    for (const track of numeric) {
      for (const k of track.keyframes) {
        if (Math.hypot(p.x - X(k.time), p.y - Y(k.value as number)) < 8) {
          onSelect({ trackId: track.id, kfId: k.id });
          drag.current = { kind: 'kf', trackId: track.id, kfId: k.id };
          return;
        }
      }
    }
    drag.current = { kind: 'scrub', trackId: '', kfId: '' };
    setPlayhead(Math.max(0, geom().T(p.x)));
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const g = geom();
    if (d.kind === 'scrub') { setPlayhead(Math.max(0, g.T(p.x))); return; }

    const track = numeric.find((t) => t.id === d.trackId);
    const k = track?.keyframes.find((x) => x.id === d.kfId);
    if (!track || !k) return;

    if (d.kind === 'kf') {
      moveKeyframe(track.id, k.id, g.T(p.x));
      const v = g.V(p.y);
      commit((proj) => {
        const kk = proj.tracks.find((t) => t.id === track.id)?.keyframes.find((x) => x.id === k.id);
        if (kk) kk.value = Math.round(v * 1000) / 1000;
      }, `gval.${k.id}`);
      return;
    }

    const i = track.keyframes.indexOf(k);
    const next = track.keyframes[i + 1];
    if (!next) return;
    const dx = next.time - k.time, dv = (next.value as number) - (k.value as number);
    const [p1, p2] = curveHandles(k.easingOut);
    const nx = dx === 0 ? 0 : (g.T(p.x) - k.time) / dx;
    const ny = dv === 0 ? (d.kind === 'h1' ? p1.y : p2.y) : (g.V(p.y) - (k.value as number)) / dv;
    const clamped = { x: Math.min(1, Math.max(0, nx)), y: Math.round(ny * 1000) / 1000 };
    setEasing(track.id, k.id, { type: 'bezier', p1: d.kind === 'h1' ? clamped : p1, p2: d.kind === 'h2' ? clamped : p2 });
  };

  return (
    <div className="graph-wrap">
      <canvas ref={canvas} className="graph"
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
      {!numeric.length && <div className="graph-empty">No numeric tracks here yet — animate a property to see its curve.</div>}
    </div>
  );
}
