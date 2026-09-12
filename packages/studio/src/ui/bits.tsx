import { useState, type ReactNode } from 'react';
import { useEditor } from '../core/store';
import { PROP_RANGE } from '../core/props';
import { activeTimeline } from '../core/types';
import { PROP_LABEL } from '../core/props';
import { activeTrackFor, valueAt } from '../core/scene';

/**
 * Thin-stroke icons for the layer panel, the stage and the inspector — scanned faster
 * than words in a dense rail. Drawn in currentColor at 1.6px on a 24 grid, so they sit
 * with the type rather than on top of it.
 */
const ICONS = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9 M6.5 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.5-1.6 M9.9 9.9a2.8 2.8 0 0 0 4 4',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  plus: 'M12 5v14 M5 12h14',
  shape: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7L12 3Z',
  svg: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  hand: 'M5 18c3-2 5-5 6-9 M11 9c1-3 3-4 5-3 M16 6c2 0 3 2 2 4-.8 1.6-2.4 2-4 1.6',
  leg: 'M9 3c-1 5 1 8 4 11 M13 14c1 2 .5 4-1 5 M12 19h6',
  group: 'M4 7h6l2 2h8v10H4z',
  front: 'M12 4v12 M7 9l5-5 5 5 M5 20h14',
  back: 'M12 20V8 M7 15l5 5 5-5 M5 4h14',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  world: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  anchor: 'M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M12 8v13 M5 14a7 7 0 0 0 14 0 M8 11h8',
  points: 'M5 19l5-12 5 8 4-6 M5 19h.01 M10 7h.01 M15 15h.01 M19 9h.01',
  play: 'M8 5l11 7-11 7z',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 14, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={ICONS[name]} />
    </svg>
  );
}

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
/**
 * A number you can type, or scrub by dragging across it — the convention every other
 * motion tool uses, and the reason nobody types a value they only want to nudge.
 *
 * A drag only starts once the pointer has actually moved, so a plain click still puts the
 * caret in the field and typing keeps working.
 */
export function NumberField({ value, onChange, step = 1, className = 'prop-num' }: { value: number; onChange: (v: number) => void; step?: number; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const shown = draft ?? fmtNum(value);

  const startScrub = (down: React.PointerEvent<HTMLInputElement>) => {
    if (down.button !== 0) return;
    const from = value;
    const x0 = down.clientX;
    let moved = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;      // a click is not a drag
      if (!moved) { moved = true; setScrubbing(true); }
      // shift for fine, alt for coarse — the same modifiers these tools always use
      const scale = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      const next = from + dx * step * scale;
      // snap to the step's own precision, so dragging by 0.1 does not produce 0.30000004
      const places = Math.max(0, Math.ceil(-Math.log10(step * scale)));
      onChange(Number(next.toFixed(Math.min(6, places))));
    };
    const up = () => {
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const flush = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(n);
    setDraft(null);
  };
  return (
    <input className={`${className} scrubbable${scrubbing ? ' scrubbing' : ''}`} value={shown} inputMode="decimal" step={step}
      onPointerDown={startScrub}
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
