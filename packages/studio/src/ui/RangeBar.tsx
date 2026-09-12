import { useCallback, useRef } from 'react';
import { fmtSec } from '../core/timeline';

/**
 * The slice of its scope an effect runs in, dragged the way a clip's in/out points are.
 *
 * The bar IS the scope — the clip when the effect is clip-scoped, the whole timeline when
 * it is not — so the handles read as positions in the thing the user is actually looking
 * at, and the numbers underneath are relative to that same thing rather than to absolute
 * timeline time. Dragging the middle slides the whole window without resizing it, which is
 * what you want once the length is right and only the timing is wrong.
 */
export function RangeBar({ spanMs, startMs, endMs, onChange, label, snaps }: {
  spanMs: number;
  startMs?: number;
  endMs?: number;
  onChange: (start: number | undefined, end: number | undefined) => void;
  label: string;
  /** times a handle clicks onto when dragged within a few pixels — keyframes, the
   *  playhead, clip edges — in the same ms the bar measures in */
  snaps?: number[];
}) {
  const bar = useRef<HTMLDivElement>(null);
  const span = Math.max(1, spanMs);
  const a = Math.max(0, Math.min(span, startMs ?? 0));
  const b = Math.max(a, Math.min(span, endMs ?? span));
  const full = a === 0 && b >= span;

  const drag = useCallback((grab: 'a' | 'b' | 'both') => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    const at = (clientX: number) => Math.round(((clientX - box.left) / box.width) * span);
    const grabbed = at(down.clientX);
    const from = { a, b };
    // within 6px of something worth landing on, land on it (shift drags freely)
    const reach = (6 / Math.max(1, box.width)) * span;
    const snap = (v: number, free: boolean) => {
      if (free || !snaps?.length) return v;
      const hit = snaps.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), snaps[0]);
      return Math.abs(hit - v) <= reach ? Math.round(hit) : v;
    };

    const move = (e: PointerEvent) => {
      const d = at(e.clientX) - grabbed;
      // 60ms is about the shortest window that reads as an effect running at all, so the
      // handles refuse to cross rather than silently producing a range nothing evaluates in
      if (grab === 'a') onChange(Math.max(0, Math.min(from.b - 60, snap(from.a + d, e.shiftKey))), from.b);
      else if (grab === 'b') onChange(from.a, Math.min(span, Math.max(from.a + 60, snap(from.b + d, e.shiftKey))));
      else {
        const width = from.b - from.a;
        const start = Math.max(0, Math.min(span - width, from.a + d));
        onChange(start, start + width);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [a, b, span, onChange, snaps]);

  const pct = (v: number) => `${(v / span) * 100}%`;

  return (
    <div className="rangebar">
      <div className="rangebar-head">
        <span className="t">{label}</span>
        <span className="spacer" />
        <span className="rangebar-num">{full ? 'whole clip' : `${fmtSec(a)} → ${fmtSec(b)}`}</span>
        {!full && (
          <button className="btn ghost sm" title="Run for the whole scope again"
            onClick={() => onChange(undefined, undefined)}>Reset</button>
        )}
      </div>
      <div className="rangebar-track" ref={bar}>
        <div className="rangebar-fill" style={{ left: pct(a), width: pct(b - a) }}
          onPointerDown={drag('both')} role="presentation" />
        <button className="rangebar-grip" style={{ left: pct(a) }} onPointerDown={drag('a')}
          aria-label={`${label} start`} />
        <button className="rangebar-grip" style={{ left: pct(b) }} onPointerDown={drag('b')}
          aria-label={`${label} end`} />
      </div>
    </div>
  );
}
