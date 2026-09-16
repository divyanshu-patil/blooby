import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cssColor, hexColor, hsvToRgb, parseHex, PASTELS, readHex, rgbToHsv } from '../core/color';
import { useDismiss } from './bits';
import type { ColorStop } from '../core/types';

/**
 * The colour picker: a swatch that opens a saturation/value square, a hue strip, an
 * opacity strip, a hex field and a row of pastel presets.
 *
 * Hue is kept in state while the popover is open, because a grey or a black has no hue of
 * its own — deriving it from the colour every render would snap the strip back to red the
 * moment saturation reaches zero. The popover is `position: fixed` from the swatch, so an
 * inspector panel's overflow cannot clip it.
 */
export function ColorPicker({ value, onChange, label = 'Colour', alpha = true }: {
  value: ColorStop; onChange: (c: ColorStop) => void; label?: string; alpha?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [hue, setHue] = useState(() => rgbToHsv(value).h);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [btn, pop]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 224, h = 300;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 });
  }, [open]);

  const hsv = rgbToHsv(value);
  const h = hsv.s > 0.001 && hsv.v > 0.001 ? hsv.h : hue;
  const set = (patch: Partial<{ h: number; s: number; v: number }>) => {
    const next = { h, s: hsv.s, v: hsv.v, ...patch };
    if (patch.h !== undefined) setHue(patch.h);
    onChange(hsvToRgb(next, value.a));
  };

  const drag = (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number) => void) => {
    el.setPointerCapture?.(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <>
      <button ref={btn} type="button" className="cp-swatch" aria-label={`${label} colour ${hexColor(value)}`} aria-expanded={open}
        title="Pick a colour" onClick={() => { setHue(h); setOpen((v) => !v); }}
        style={{ '--sw': cssColor(value) } as React.CSSProperties} />
      {/* a portal: a swatch inside a chip or a clip sits in their stacking context, which
          would put the popover under the next chip along */}
      {open && createPortal(
        <div ref={pop} className="cp-pop" role="dialog" aria-label={`${label} colour picker`} style={{ left: pos.left, top: pos.top }}>
          <div className="cp-sv" style={{ backgroundColor: `hsl(${h} 100% 50%)` }}
            onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => set({ s: x, v: 1 - y }))}>
            <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: cssColor({ ...value, a: 1 }) }} />
          </div>
          <div className="cp-strip cp-hue" aria-label="Hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => set({ h: x * 360 }))}>
            <span className="cp-thumb" style={{ left: `${(h / 360) * 100}%` }} />
          </div>
          {alpha && (
            <div className="cp-strip cp-alpha" aria-label="Opacity"
              style={{ '--solid': cssColor({ ...value, a: 1 }) } as React.CSSProperties}
              onPointerDown={(e) => drag(e.currentTarget, e, (x) => onChange({ ...value, a: Math.round(x * 100) / 100 }))}>
              <span className="cp-thumb" style={{ left: `${value.a * 100}%` }} />
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            <input className="txt" spellCheck={false} aria-label={`${label} hex`} key={hexColor(value)} defaultValue={hexColor(value).toUpperCase()}
              style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono, ui-monospace, monospace)' }}
              onChange={(e) => { const c = readHex(e.target.value); if (c) onChange({ ...c, a: c.a ?? value.a }); }} />
            {alpha && <span className="hint" style={{ width: 34, textAlign: 'right' }}>{Math.round(value.a * 100)}%</span>}
          </div>
          <div className="cp-presets" aria-label="Pastel presets">
            {PASTELS.map((c) => {
              const hex = hexColor(c);
              return <button key={hex} type="button" className="cp-preset" title={hex.toUpperCase()} aria-label={`Pastel ${hex}`}
                aria-pressed={hex === hexColor(value)} style={{ background: hex }}
                onClick={() => { setHue(rgbToHsv(c).h); onChange({ ...c, a: value.a }); }} />;
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The same picker over a `#rrggbb` string — for clip accents, stage backdrops and the like. */
export function HexColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label?: string }) {
  return <ColorPicker value={parseHex(value || '#000000')} onChange={(c) => onChange(hexColor(c))} label={label} alpha={false} />;
}
