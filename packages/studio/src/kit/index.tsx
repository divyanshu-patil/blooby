import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The shell components shared by the user dashboard and the admin panel.
 *
 * These exist once precisely because the spec's rule is that role changes what a person
 * can DO, not which implementation renders it — an admin's project list is the same
 * ProjectCard with an extra menu item, not a second component that drifts out of sync.
 */

/* --- shell -------------------------------------------------------------- */

export interface NavItem { id: string; label: string; glyph: string; count?: number }
export interface NavGroup { title?: string; items: NavItem[] }

/** The mascot reduced to its silhouette: body, two eyes. Same shapes the editor draws,
 *  so the mark and the product are literally the same thing. */
export const BloobyMark = ({ size = 20 }: { size?: number }) => (
  <svg className="brand-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <circle cx="10" cy="10" r="9" fill="currentColor" />
    <circle cx="6.8" cy="8.6" r="1.9" fill="var(--panel)" />
    <circle cx="13.2" cy="8.6" r="1.9" fill="var(--panel)" />
  </svg>
);

export function Shell({ nav, active, onNavigate, footer, brand, children }: {
  nav: NavGroup[];
  active: string;
  onNavigate: (id: string) => void;
  footer?: ReactNode;
  brand?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('blooby.side') === '1');
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('blooby.side', next ? '1' : '0');
  };

  return (
    <div className="shell">
      <aside className="side" data-collapsed={collapsed} data-open={open}>
        <button className="brand" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <BloobyMark />
          <span className="brand-word">{brand ?? 'blooby'}</span>
        </button>

        {nav.map((group, gi) => (
          <div key={group.title ?? gi}>
            {group.title && <div className="side-group-title">{group.title}</div>}
            {group.items.map((item) => (
              <button key={item.id} className="side-item" aria-current={active === item.id}
                data-tour={item.id} title={item.label}
                onClick={() => { onNavigate(item.id); setOpen(false); }}>
                <span className="side-glyph" aria-hidden>{item.glyph}</span>
                <span className="side-label">{item.label}</span>
                {item.count !== undefined && item.count > 0 && <span className="side-count">{item.count}</span>}
              </button>
            ))}
          </div>
        ))}

        {footer && <div className="side-foot">{footer}</div>}
      </aside>

      <main className="main">
        <button className="side-trigger" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">☰</button>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      <span className="spacer" />
      {children}
    </header>
  );
}

/* --- data display ------------------------------------------------------- */

export function StatCard({ label, value, delta }: { label: string; value: number | string; delta?: number | null }) {
  const dir = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {/* a bare percentage says nothing; the direction and window are the insight */}
      {delta != null && (
        <div className="stat-delta" data-dir={dir}>
          {delta > 0 ? '↑' : delta < 0 ? '↓' : '–'} {Math.abs(delta)}% vs previous period
        </div>
      )}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder = 'Search' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="searchbar">
      <span aria-hidden style={{ opacity: .5 }}>⌕</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

export function ChipBar<T extends string>({ options, value, onChange }: {
  options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="chipbar">
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/* --- states ------------------------------------------------------------- */

export function EmptyState({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-title">{title}</div>
      <p className="state-note">{note}</p>
      {action}
    </div>
  );
}

/** A skeleton grid rather than a spinner: the page keeps its shape while it loads, so
 *  nothing jumps when the real cards arrive. */
export const LoadingGrid = ({ count = 8 }: { count?: number }) => (
  <div className="card-grid" aria-busy="true" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton skeleton-card" />)}
  </div>
);

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <div className="state-title">Something didn’t load</div>
      <p className="state-note">{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/* --- overlays ----------------------------------------------------------- */

export function Dialog({ title, note, onClose, children, actions }: {
  title: string; note?: string; onClose: () => void; children?: ReactNode; actions?: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

/** Card overflow menu. Closes on outside click so it never strands itself open. */
export function CardMenu({ items }: { items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div ref={ref}>
      <button className="card-menu" aria-expanded={open} aria-label="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>⋯</button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.label} data-danger={it.danger} onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --- save status -------------------------------------------------------- */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** The autosave readout. Says what actually happened, and never claims "Saved" while a
 *  change is still pending — silence about unsaved work is the failure people notice. */
export function SaveIndicator({ state, savedAt, onRetry }: { state: SaveState; savedAt?: number | null; onRetry?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (state !== 'saved') return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [state]);

  const text =
    state === 'saving' ? 'Saving…'
    : state === 'dirty' ? 'Unsaved changes'
    : state === 'error' ? 'Couldn’t save'
    : state === 'saved' ? (savedAt ? `Saved ${ago(savedAt)}` : 'Saved')
    : '';

  if (!text) return null;
  return (
    <span className="savestate" data-state={state} role="status">
      <span className="dot" aria-hidden />
      {text}
      {state === 'error' && onRetry && <button className="btn ghost sm" onClick={onRetry}>Retry</button>}
    </span>
  );
}

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

export const relativeTime = ago;
