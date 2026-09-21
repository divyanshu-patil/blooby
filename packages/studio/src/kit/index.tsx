import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GITHUB_URL, GithubMark } from './TourMenu';

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

/**
 * The official mark, in the app.
 *
 * These three shapes are the icon's own geometry, scaled — not an approximation of it.
 * The 21° tilt and the two DIFFERENT eye sizes are what make it recognisable at 20px, and
 * they are the first thing lost when somebody redraws it by eye, which is what the two
 * upright circles this replaced had done. The masters are in brand/; brand/geometry.txt
 * has the numbers and where they came from.
 *
 * The body is `currentColor` so the mark takes the colour of whatever it sits in, and the
 * eyes are knocked out of it — a hole reads correctly on paper and on ink, where a fixed
 * eye colour is invisible on one of them.
 */
export function BloobyMark({ size = 20 }: { size?: number }) {
  // One mask per instance: the mark renders in the sidebar, the sign-in screen and the
  // admin header at once, and a hard-coded id would be three elements sharing one.
  // The colons useId puts in its ids are stripped — they are legal in an id and have a
  // history of tripping up url(#…) references in SVG.
  const eyes = `blooby-eyes-${useId().replace(/:/g, '')}`;
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <mask id={eyes}>
        <rect width="512" height="512" fill="#fff" />
        <g transform={MARK}>
          <rect x="2293.68" y="1094" width="722" height="1486" rx="361" transform="rotate(21.0472 2293.68 1094)" fill="#000" />
          <rect x="3602.03" y="1689.49" width="574.157" height="1346.14" rx="287.079" transform="rotate(21.0472 3602.03 1689.49)" fill="#000" />
        </g>
      </mask>
      <g mask={`url(#${eyes})`}>
        <circle cx="2293.58" cy="2356.58" r="2088" fill="currentColor" transform={MARK} />
      </g>
    </svg>
  );
}

/** Puts the icon's own 4587-unit geometry into a 512 box. See brand/geometry.txt. */
const MARK = 'translate(-7.62989 -14.87126) scale(0.11494252873563218)';

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

        <a className="side-item" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" title="View on GitHub" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="side-glyph" aria-hidden style={{ display: 'grid', placeItems: 'center' }}><GithubMark size={15} /></span>
          <span className="side-label">View on GitHub</span>
        </a>
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

/* --- people and pages --------------------------------------------------- */

/** A person's picture, or their initial when there is none. Monochrome, per DESIGN.md. */
export function Avatar({ name, url, size = 28 }: { name?: string | null; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.43) };
  if (url) return <img className="avatar" style={style} src={url} alt="" referrerPolicy="no-referrer" />;
  return <span className="avatar" style={style} aria-hidden>{(name ?? '?').trim().charAt(0).toUpperCase() || '?'}</span>;
}

/**
 * Cursor pages with a way back. The API only knows "next", so the stack remembers the
 * cursor each visited page started from; `reset` when the query changes.
 */
export function usePager() {
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  return {
    cursor: stack[stack.length - 1],
    page: stack.length,
    next: (c: string) => setStack((s) => [...s, c]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([undefined]),
  };
}

export function Pager({ pager, nextCursor }: { pager: ReturnType<typeof usePager>; nextCursor: string | null | undefined }) {
  if (pager.page === 1 && !nextCursor) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn ghost sm" disabled={pager.page === 1} onClick={pager.prev}>← Previous</button>
      <span className="pager-page">Page {pager.page}</span>
      <button className="btn ghost sm" disabled={!nextCursor} onClick={() => nextCursor && pager.next(nextCursor)}>Next →</button>
    </nav>
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

/**
 * How long ago something happened, in the largest unit that still says something.
 *
 * It used to stop at hours, so a project touched last spring read "3,412 hours ago" —
 * technically true and completely unreadable. Days, weeks, months and years continue the
 * ladder, and the units stay short (`5m`, `3h`, `2d`, `1w`, `4mon`, `2y`) because these
 * land in table cells and card footers where a full sentence wraps.
 *
 * A timestamp in the future — a server clock a little ahead of the browser's, which is
 * ordinary — reads "just now" rather than "-2m ago"; so does an unparseable one, since a
 * missing date is not worth rendering as NaN.
 */
function ago(ts: number) {
  if (!Number.isFinite(ts)) return 'just now';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  // weeks up to a month, then months — 30.44 and 365.25 are the average lengths, so
  // "12mon" never appears just before "1y" the way a flat 30/360 makes it
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  const mon = Math.round(d / 30.44);
  if (mon < 12) return `${mon}mon ago`;
  return `${Math.round(d / 365.25)}y ago`;
}

export const relativeTime = ago;
