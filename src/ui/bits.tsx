import { useState, type ReactNode } from 'react';
import { useEditor } from '../core/store';
import { PROP_RANGE } from '../core/props';
import { PROP_LABEL } from '../core/types';
import { valueAt } from '../core/scene';

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
  const toggleTrack = useEditor((s) => s.toggleTrack);
  const selectTrack = useEditor((s) => s.selectTrack);

  const ids = Array.isArray(nodeId) ? nodeId : [nodeId];
  const primary = ids[0];
  const track = project.tracks.find((t) => t.nodeId === primary && t.property === property);
  const v = valueAt(project, primary, property, playhead);
  if (typeof v !== 'number') return null;
  const [min, max, step] = PROP_RANGE[property] ?? [-100, 100, 1];

  const writeAll = (n: number) => { for (const id of ids) setValue(id, property, n, `multi.${property}`); };
  const toggleAll = () => { for (const id of ids) toggleTrack(id, property); };

  return (
    <div className="prop">
      <button className="stopwatch" aria-pressed={!!track} title={track ? 'Remove keyframes' : 'Animate this property'}
        onClick={() => { toggleAll(); selectTrack(null); }} />
      <label className="prop-label"><span className="t">{label ?? PROP_LABEL[property] ?? property}</span>
        <input type="range" min={min} max={max} step={step} value={v}
          onChange={(e) => writeAll(parseFloat(e.target.value))} />
      </label>
      <NumberField value={v} step={step} onChange={(n) => writeAll(clampTo(n, min, max))} />
    </div>
  );
}

const clampTo = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
