import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Hand-rolled drag-to-resize split, row or column. No dependency — the same call as
 * the stage/graph-editor being plain SVG/canvas: this is a small, fully-specified
 * interaction that a library would just wrap thinner than writing it directly.
 *
 * Exactly one pane is "flexible" (`flexIndex`, default the last one) and has no stored
 * size — it just absorbs whatever the fixed panes don't use. Every other pane has an
 * explicit pixel size, persisted to localStorage per `storageKey`. Each fixed pane has a
 * min-size threshold: drag its handle past that threshold and the pane snaps shut to a
 * thin strip — click the strip to restore its last size, same affordance as VS Code's
 * sidebar.
 */

const COLLAPSED = 8;

interface Pane {
  min?: number;
  max?: number;
  /** initial size for a fixed pane before any drag/persisted value exists — default 260 */
  default?: number;
  /** content already manages its own internal scrolling (e.g. a `.rail`) — default true */
  scroll?: boolean;
  content: ReactNode;
}

interface SplitProps {
  direction: 'row' | 'column';
  storageKey: string;
  panes: Pane[];
  flexIndex?: number;
  className?: string;
}

function load(key: string, ids: number[], defaults: Record<number, number>): Record<number, number> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        const out: Record<number, number> = {};
        for (const id of ids) out[id] = typeof obj[id] === 'number' ? obj[id] : defaults[id];
        return out;
      }
    }
  } catch { /* corrupt or blocked storage — start from the default split */ }
  return { ...defaults };
}

export function Split({ direction, storageKey, panes, flexIndex, className }: SplitProps) {
  const n = panes.length;
  const flex = flexIndex ?? n - 1;
  const fixedIds = useMemo(() => panes.map((_, i) => i).filter((i) => i !== flex), [panes, flex]);
  const key = `blooby.split.${storageKey}.${n}`;
  const restored = useRef<Record<number, number>>({});
  const [sizes, setSizes] = useState<Record<number, number>>(() =>
    load(key, fixedIds, Object.fromEntries(fixedIds.map((i) => [i, panes[i].default ?? 260]))));
  const drag = useRef<{ handle: number; startPx: number; target: number; sign: 1 | -1; startSize: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(sizes)); } catch { /* private mode */ }
  }, [key, sizes]);

  const axis = direction === 'row' ? 'x' : 'y';
  const dim = direction === 'row' ? 'width' : 'height';

  // Each handle sits between pane[h] and pane[h+1]. It resizes whichever side is NOT
  // the flex pane; if the flex pane is on the right, growing the handle's left neighbour
  // means dragging toward positive space (sign +1). If the flex pane is on the left,
  // the fixed pane is the one on the right, so growing it means dragging *away* from it
  // (sign -1) — pulling the handle left grows the right-hand fixed pane.
  const onHandleDown = useCallback((h: number) => (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const target = h + 1 === flex ? h : h + 1;
    const sign: 1 | -1 = h + 1 === flex ? 1 : -1;
    drag.current = { handle: h, startPx: axis === 'x' ? e.clientX : e.clientY, target, sign, startSize: sizes[target] };
  }, [axis, sizes, flex]);

  const onHandleMove = useCallback((h: number) => (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.handle !== h) return;
    const now = axis === 'x' ? e.clientX : e.clientY;
    const delta = (now - d.startPx) * d.sign;
    const pane = panes[d.target];
    const min = pane.min ?? 40;
    const max = pane.max ?? 2000;
    let next = d.startSize + delta;
    if (next < min) {
      if (next < min * 0.55) {
        restored.current[d.target] = Math.max(min, d.startSize);
        next = COLLAPSED;
      } else {
        next = min;
      }
    } else {
      next = Math.min(max, next);
    }
    setSizes((s) => ({ ...s, [d.target]: next }));
  }, [axis, panes]);

  const onHandleUp = useCallback(() => { drag.current = null; }, []);

  const restore = (index: number) => {
    const back = restored.current[index] ?? panes[index].min ?? 200;
    setSizes((s) => ({ ...s, [index]: back }));
  };

  const containerStyle = useMemo(() => ({
    display: 'flex' as const,
    flexDirection: direction === 'row' ? 'row' as const : 'column' as const,
    minHeight: 0, minWidth: 0, height: '100%', width: '100%',
  }), [direction]);

  return (
    <div className={className} style={containerStyle}>
      {panes.map((pane, i) => {
        const paneEl = i === flex
          ? <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: pane.scroll === false ? 'hidden' : 'auto' }}>{pane.content}</div>
          : (
            <div style={{ [dim]: sizes[i], minHeight: 0, minWidth: 0, overflow: pane.scroll === false ? 'hidden' : 'auto', flex: 'none' }}>
              {sizes[i] <= COLLAPSED
                ? <button className="split-collapsed" title="Restore panel" onClick={() => restore(i)}
                    style={direction === 'row' ? { width: COLLAPSED, height: '100%' } : { height: COLLAPSED, width: '100%' }} />
                : pane.content}
            </div>
          );
        if (i === n - 1) return <div key={i} style={{ display: 'contents' }}>{paneEl}</div>;
        return (
          <div key={i} style={{ display: 'contents' }}>
            {paneEl}
            <div className={`split-handle split-handle-${direction}`}
              onPointerDown={onHandleDown(i)} onPointerMove={onHandleMove(i)} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} />
          </div>
        );
      })}
    </div>
  );
}
