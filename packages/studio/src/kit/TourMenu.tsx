import { useEffect, useRef, useState } from "react";
import type { DriveStep } from "driver.js";
import { hasSeenTour, startTour } from "./tour";

/** Where Blooby's source lives. */
export const GITHUB_URL = "https://github.com/divyanshu-patil/blooby";

/** The GitHub mark (Octicons `mark-github`), in the current text colour. */
export function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      style={{ display: "block", flex: "none" }}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** A "View on GitHub" link button with the mark — the editor's top bar uses it. */
export function GithubLink({ label = "GitHub" }: { label?: string }) {
  return (
    <a
      className="btn sm github-link text-black"
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="View Blooby on GitHub"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        textDecoration: "none",
      }}
    >
      <GithubMark /> {label}
    </a>
  );
}

export interface TourEntry {
  key: string;
  label: string;
  blurb: string;
  steps: DriveStep[];
}

/**
 * A picker for feature tours.
 *
 * One tour covering every feature would be a fifteen-step wall nobody finishes, and a
 * row of ? buttons would clutter the toolbar. A short list of named topics lets someone
 * learn the one thing they came for, and the "seen" dot means you can tell at a glance
 * which you have already watched.
 */
export function TourMenu({
  tours,
  label = "Show me around",
}: {
  tours: TourEntry[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="tourmenu" ref={ref}>
      <button
        className="btn ghost sm"
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>

      {open && (
        <div className="tourmenu-pop" role="menu">
          <div className="tourmenu-head">{label}</div>
          {tours.map((t) => (
            <button
              key={t.key}
              role="menuitem"
              className="tourmenu-item"
              onClick={() => {
                setOpen(false);
                startTour(t.key, t.steps, { force: true });
              }}
            >
              <span className="tourmenu-label">
                {t.label}
                {/* a filled dot means "not watched yet" — the only state worth marking */}
                {!hasSeenTour(t.key) && (
                  <span className="tourmenu-new" aria-label="not watched yet" />
                )}
              </span>
              <span className="tourmenu-blurb">{t.blurb}</span>
            </button>
          ))}
          <a
            className="tourmenu-item"
            role="menuitem"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <span
              className="tourmenu-label"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <GithubMark /> View on GitHub
            </span>
            <span className="tourmenu-blurb">The source, issues and docs</span>
          </a>
        </div>
      )}
    </div>
  );
}
