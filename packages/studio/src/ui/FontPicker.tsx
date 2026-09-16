import { useEffect, useMemo, useRef, useState } from 'react';
import { useDismiss } from './bits';
import {
  catalogOffline, cssFamily, fontCatalog, fontError, fontStatus, fontWeightUsed, previewFont, searchFonts, weightsOf,
  type CatalogFont,
} from '../core/fonts';
import type { FontRef } from '../core/types';

const CATEGORIES: { id: string; label: string }[] = [
  { id: '', label: 'All' }, { id: 'sans-serif', label: 'Sans' }, { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' }, { id: 'handwriting', label: 'Script' }, { id: 'monospace', label: 'Mono' },
];

const WEIGHT_NAME: Record<number, string> = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black',
};

/**
 * Every Google font, searchable, each shown in its own face.
 *
 * The list is the catalogue itself — fetched the first time this opens, never at startup —
 * and a row loads its preview only when it scrolls into view, so opening the picker costs
 * a handful of small files rather than hundreds. Choosing one loads just that face.
 */
export function FontPicker({ value, onPick }: { value: FontRef; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [pickRef]);
  const [list, setList] = useState<CatalogFont[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const status = fontStatus(value);
  const used = fontWeightUsed(value);

  useEffect(() => {
    if (!open || list) return;
    let live = true;
    fontCatalog().then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, [open, list]);

  const results = useMemo(() => (list ? searchFonts(list, query, category || undefined).slice(0, 80) : []), [list, query, category]);

  return (
    <div className="font-pick" ref={pickRef}>
      <button className="font-current" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        title="Choose a Google font">
        <span className="font-current-name" style={{ fontFamily: cssFamily(value), fontWeight: value.weight, fontStyle: value.style }}>{value.family}</span>
        <span aria-hidden className="font-caret">▾</span>
      </button>
      {status === 'loading' && <p className="font-note">Loading {value.family}…</p>}
      {status === 'failed' && (
        <p className="font-note warn" role="status">{fontError(value) ?? `${value.family} could not be loaded`}. Showing a system font instead — exports will say so.</p>
      )}
      {status === 'ready' && used !== Math.round(value.weight / 100) * 100 && (
        <p className="font-note">{value.family} has no {WEIGHT_NAME[Math.round(value.weight / 100) * 100]?.toLowerCase() ?? value.weight}; drawing {WEIGHT_NAME[used]?.toLowerCase() ?? used}.</p>
      )}
      {open && (
        <div className="font-tray" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <input className="txt font-search" autoFocus placeholder="Search fonts" aria-label="Search fonts"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="font-cats" role="tablist" aria-label="Kind of font">
            {CATEGORIES.map((c) => (
              <button key={c.id} role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</button>
            ))}
          </div>
          <div className="font-list" role="listbox" aria-label="Fonts">
            {!list && <p className="font-note">Loading the Google Fonts catalogue…</p>}
            {list && !results.length && <p className="font-note">No font called “{query}”.</p>}
            {results.map((f) => (
              <FontRow key={f.id} font={f} selected={f.family === value.family}
                onPick={() => { onPick(f.family); setOpen(false); }} />
            ))}
          </div>
          {catalogOffline() && <p className="font-note">The catalogue could not be reached, so only popular fonts are listed.</p>}
        </div>
      )}
    </div>
  );
}

/** One family, drawn in itself once it scrolls into view. */
function FontRow({ font, selected, onPick }: { font: CatalogFont; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { previewFont(font.family); setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [font.family, seen]);
  return (
    <button ref={ref} role="option" aria-selected={selected} className="font-row" onClick={onPick}>
      <span className="font-row-name" style={seen ? { fontFamily: cssFamily({ family: font.family, weight: 400, style: 'normal' }) } : undefined}>{font.family}</span>
      <span className="font-row-meta">{font.weights.length} {font.weights.length === 1 ? 'weight' : 'weights'}</span>
    </button>
  );
}

/** The weights a family really has, named. */
export function WeightSelect({ value, onChange }: { value: FontRef; onChange: (w: number) => void }) {
  const weights = weightsOf(value.family);
  const current = Math.round(value.weight / 100) * 100;
  return (
    <select className="sel" aria-label="Weight" value={weights.includes(current) ? current : weights[0]} onChange={(e) => onChange(Number(e.target.value))}>
      {weights.map((w) => <option key={w} value={w}>{w} · {WEIGHT_NAME[w] ?? ''}</option>)}
    </select>
  );
}
