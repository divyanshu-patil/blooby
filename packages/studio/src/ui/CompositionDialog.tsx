import { useEffect, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP_MAX, COMP_MIN, COMP_PRESETS, compOf } from '../core/comp';
import { activeTimeline } from '../core/types';
import { useStageBg } from './stageBg';
import { NumberField } from './bits';

const BACKDROPS = ['#17161b', '#2b2a31', '#8b8794', '#f4f2ee', '#ffffff'];

/** Opens the composition settings from anywhere — the top bar, the stage's size readout. */
export const openComposition = () => window.dispatchEvent(new Event('blooby:open-composition'));

/**
 * The canvas: its size, rate, length and backdrop, in a dialog of its own.
 *
 * It used to share the inspector with whatever was selected, which meant it vanished the
 * moment you clicked a layer — and it is not a property of any layer. Each size is shown
 * as its own proportions, so the choice is the shape, not a pair of numbers to picture.
 */
export function CompositionDialog() {
  const [open, setOpen] = useState(false);
  const project = useEditor((s) => s.project);
  const setComposition = useEditor((s) => s.setComposition);
  const setTimelineDuration = useEditor((s) => s.setTimelineDuration);
  const commit = useEditor((s) => s.commit);
  const [bg, setBg] = useStageBg();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('blooby:open-composition', show);
    return () => window.removeEventListener('blooby:open-composition', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;

  const c = compOf(project);
  const clamp = (v: number) => Math.min(COMP_MAX, Math.max(COMP_MIN, Math.round(v)));
  const longest = Math.max(...COMP_PRESETS.map((p) => Math.max(p.width, p.height)));
  return (
    <div className="modal-scrim" onClick={() => setOpen(false)}>
      <div className="modal comp-dialog" role="dialog" aria-modal="true" aria-labelledby="comp-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="comp-title">Composition</h2>
          <span className="modal-sub">{c.width} × {c.height} px · {project.fps} fps</span>
          <button className="btn ghost sm icon" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
        </header>

        <div className="comp-sizes" role="radiogroup" aria-label="Canvas size">
          {COMP_PRESETS.map((p) => {
            const on = p.width === c.width && p.height === c.height;
            const k = 44 / longest;
            return (
              <button key={p.label} role="radio" aria-checked={on} className="comp-size" onClick={() => setComposition({ width: p.width, height: p.height })}>
                <span className="comp-frame-box"><span className="comp-frame" style={{ width: Math.max(8, p.width * k), height: Math.max(8, p.height * k) }} /></span>
                <span className="comp-size-label">{p.label}</span>
              </button>
            );
          })}
        </div>

        <div className="modal-grid">
          <label className="modal-field"><span>Width</span>
            <NumberField value={c.width} step={10} onChange={(v) => setComposition({ width: clamp(v) })} /><em>px</em></label>
          <label className="modal-field"><span>Height</span>
            <NumberField value={c.height} step={10} onChange={(v) => setComposition({ height: clamp(v) })} /><em>px</em></label>
          <label className="modal-field"><span>Frame rate</span>
            <NumberField value={project.fps} step={1} onChange={(v) => commit((p) => { p.fps = Math.min(120, Math.max(1, Math.round(v))); }, 'fps')} /><em>fps</em></label>
          <label className="modal-field"><span>Length</span>
            <NumberField value={Math.round(activeTimeline(project).timelineDurationMs) / 1000} step={0.1}
              onChange={(s) => setTimelineDuration(Math.max(0.2, s) * 1000)} /><em>s</em></label>
        </div>

        <div className="modal-row">
          <span className="modal-label">Backdrop</span>
          <div className="comp-swatches">
            <button className="sw checker" aria-pressed={bg === 'transparent'} title="Transparent — no backdrop in exports" onClick={() => setBg('transparent')} />
            {BACKDROPS.map((col) => <button key={col} className="sw" aria-pressed={bg === col} title={col} style={{ background: col }} onClick={() => setBg(col)} />)}
            <input type="color" aria-label="Custom backdrop" value={bg === 'transparent' ? '#17161b' : bg} onChange={(e) => setBg(e.target.value)} />
          </div>
        </div>

        <p className="modal-hint">A wider canvas gives the mascots room — nothing stretches, and everything stays where it is relative to the centre. Every export uses this size.</p>
        <footer className="modal-foot">
          <button className="btn sm primary" onClick={() => setOpen(false)}>Done</button>
        </footer>
      </div>
    </div>
  );
}
