import { useCallback, useState, type ReactNode } from 'react';

/**
 * A panel section that folds away, remembering whether it was open.
 *
 * Replaces the resizable split inside the right rail. A split forces every section to
 * carry a height whether or not it has anything in it, so a rail with five sections gave
 * each of them a fifth of the space and none of them enough; folding gives whatever is
 * open all of it. The state is per-key in localStorage, so the rail comes back the way it
 * was left rather than fully expanded every reload.
 */
export function Collapsible({ title, storageKey, badge, actions, defaultOpen = true, children }: {
  title: string;
  storageKey: string;
  /** a count or a word shown next to the title, readable while folded */
  badge?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `blooby.fold.${storageKey}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1'; }
    catch { return defaultOpen; }
  });

  const toggle = useCallback(() => {
    setOpen((v) => {
      try { localStorage.setItem(key, v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  }, [key]);

  return (
    <section className="fold" data-open={open}>
      <div className="fold-head">
        <button className="fold-toggle" aria-expanded={open} onClick={toggle}>
          <span className="fold-caret" aria-hidden>›</span>
          <span className="fold-title">{title}</span>
          {badge !== undefined && badge !== null && <span className="tag">{badge}</span>}
        </button>
        {/* actions stay reachable while folded: "+ Shake" should not need unfolding first */}
        {actions && <span className="fold-actions">{actions}</span>}
      </div>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
