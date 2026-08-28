import { useEffect, useRef, useState } from 'react';
import type { DriveStep } from 'driver.js';
import { hasSeenTour, startTour } from './tour';

export interface TourEntry { key: string; label: string; blurb: string; steps: DriveStep[] }

/**
 * A picker for feature tours.
 *
 * One tour covering every feature would be a fifteen-step wall nobody finishes, and a
 * row of ? buttons would clutter the toolbar. A short list of named topics lets someone
 * learn the one thing they came for, and the "seen" dot means you can tell at a glance
 * which you have already watched.
 */
export function TourMenu({ tours, label = 'Show me around' }: { tours: TourEntry[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="tourmenu" ref={ref}>
      <button className="btn ghost sm" title={label} aria-expanded={open} aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}>?</button>

      {open && (
        <div className="tourmenu-pop" role="menu">
          <div className="tourmenu-head">{label}</div>
          {tours.map((t) => (
            <button key={t.key} role="menuitem" className="tourmenu-item"
              onClick={() => { setOpen(false); startTour(t.key, t.steps, { force: true }); }}>
              <span className="tourmenu-label">
                {t.label}
                {/* a filled dot means "not watched yet" — the only state worth marking */}
                {!hasSeenTour(t.key) && <span className="tourmenu-new" aria-label="not watched yet" />}
              </span>
              <span className="tourmenu-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
