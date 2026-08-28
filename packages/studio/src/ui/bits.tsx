import { useState, type ReactNode } from 'react';
import { useEditor } from '../core/store';
import { PROP_RANGE } from '../core/props';
import { activeTimeline } from '../core/types';
import { PROP_LABEL } from '../core/props';
import { activeTrackFor, valueAt } from '../core/scene';

export function Panel({ title, actions, children, flush }: { title: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={flush ? 'panel flush' : 'panel'}>
      <header className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="spacer" />
        {actions}
      </header>
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

/** Number input that only commits on blur/Enter, so typing "-" doesn't snap to 0. */
export function NumberField({ value, onChange, step = 1, className = 'prop-num' }: { value: number; onChange: (v: number) => void; step?: number; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmtNum(value);
  const flush = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(n);
    setDraft(null);
  };
  return (
    <input className={className} value={shown} inputMode="decimal" step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { flush(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') setDraft(null);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          onChange(Math.round((value + d) * 1000) / 1000);
        }
      }} />
  );
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/**
 * Stopwatch + slider + number. The only way a numeric property is ever edited.
 * `nodeId` can be an array — every write applies to every id in it, so selecting both
 * eyes and dragging one slider moves both, in lock-step, as one undo step.
 */
export function PropRow({ nodeId, property, label }: { nodeId: string | string[]; property: string; label?: string }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const toggleKeyframe = useEditor((s) => s.toggleKeyframe);
  const selectTrack = useEditor((s) => s.selectTrack);

  const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
  const primary = ids[0];
  const tl = activeTimeline(project);
  const track = activeTrackFor(tl, primary, property, playhead);
  const v = valueAt(project, primary, property, playhead);
  if (typeof v !== 'number') return null;
  const [min, max, step] = PROP_RANGE[property] ?? [-100, 100, 1];
  const driver = track ? (track.blockId ? 'clip' : 'keyframes') : 'base';

  const writeAll = (n: number) => { for (const id of ids) setValue(id, property, n, `multi.${property}`); };
  const toggleAll = () => { for (const id of ids) toggleKeyframe(id, property); };

  return (
    <div className="prop" data-driver={driver}>
      <KeyNav nodeId={primary} property={property} onToggle={() => { toggleAll(); selectTrack(null); }} />
      <label className="prop-label"><span className="t">{label ?? PROP_LABEL[property] ?? property}</span>
        <input type="range" min={min} max={max} step={step} value={v}
          onChange={(e) => writeAll(parseFloat(e.target.value))} />
      </label>
      <NumberField value={v} step={step} onChange={(n) => writeAll(clampTo(n, min, max))} />
    </div>
  );
}

const clampTo = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The stopwatch, and the chevrons for walking this property's keyframes.
 *
 * Lit means "there is a keyframe HERE", not "this property is animated somewhere" — the
 * old meaning stayed on after the playhead moved off the keyframe, so a second click
 * looked like it would add one and instead deleted the whole track. Every panel with a
 * stopwatch uses this, so none of them can drift back to the old behaviour.
 */
export function KeyNav({ nodeId, property, onToggle }: {
  nodeId: string; property: string; onToggle: () => void;
}) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);

  // across whichever clips animate it: navigating should walk the property, not stop at
  // the edge of the clip that happens to own the keyframe under the playhead
  const times = [...new Set(
    activeTimeline(project).tracks
      .filter((t) => t.nodeId === nodeId && t.property === property)
      .flatMap((t) => t.keyframes.map((k) => Math.round(k.time))),
  )].sort((a, b) => a - b);

  const here = times.some((t) => Math.abs(t - playhead) < 1);
  const prev = [...times].reverse().find((t) => t < playhead - 1);
  const next = times.find((t) => t > playhead + 1);
  const secs = (t: number) => `${(t / 1000).toFixed(2)}s`;

  return (
    <span className="keynav">
      {/* only once there is something to walk to, so an un-animated property keeps the
          row it always had */}
      {!!times.length && (
        <button className="keychev" disabled={prev === undefined} aria-label="Previous keyframe"
          title={prev === undefined ? 'No earlier keyframe' : `Go to ${secs(prev)}`}
          onClick={() => prev !== undefined && setPlayhead(prev)}>‹</button>
      )}
      <button className="stopwatch" aria-pressed={here}
        title={here ? 'Keyframe here — click to remove it' : 'Add a keyframe here'}
        onClick={onToggle} />
      {!!times.length && (
        <button className="keychev" disabled={next === undefined} aria-label="Next keyframe"
          title={next === undefined ? 'No later keyframe' : `Go to ${secs(next)}`}
          onClick={() => next !== undefined && setPlayhead(next)}>›</button>
      )}
    </span>
  );
}
