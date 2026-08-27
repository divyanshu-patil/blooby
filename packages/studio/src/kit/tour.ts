import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

/**
 * First-run product tour.
 *
 * driver.js rather than a hand-rolled overlay: it already handles focus trapping,
 * keyboard navigation, scroll-into-view and repositioning on resize — all the parts of
 * a tour that are tedious to get right and obvious when they are wrong.
 *
 * A tour that reappears is worse than no tour, so completion is recorded per key and
 * skipping counts as completion. `startTour(key, steps, { force: true })` replays one on
 * demand, which is what a "Show me around" menu item calls.
 */
const seenKey = (key: string) => `blooby.tour.${key}`;

export const hasSeenTour = (key: string) => {
  try { return localStorage.getItem(seenKey(key)) === '1'; } catch { return true; }
};

const markSeen = (key: string) => {
  try { localStorage.setItem(seenKey(key), '1'); } catch { /* private mode — just re-show */ }
};

/**
 * At most one tour runs at a time.
 *
 * StrictMode double-invokes effects in development, and a scheduled start can also race
 * a re-render, so without this guard two driver instances stack their overlays and the
 * page ends up with two popovers and a doubled scrim.
 */
let active: { destroy: () => void } | null = null;

export function startTour(key: string, steps: DriveStep[], opts?: { force?: boolean }) {
  if (!opts?.force && hasSeenTour(key)) return;

  // an explicit replay should restart cleanly rather than be swallowed by the guard
  if (active) {
    if (!opts?.force) return;
    active.destroy();
    active = null;
  }

  // a step whose element never rendered would show an empty highlight box
  const live = steps.filter((s) => !s.element || document.querySelector(s.element as string));
  if (!live.length) return;

  const instance = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: 'blooby-tour',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Got it',
    steps: live,
    // skipping and finishing both mean "do not show me this again"
    onDestroyed: () => { markSeen(key); active = null; },
  });

  active = instance;
  instance.drive();
}

/** Run a tour once the elements it points at exist, without racing the first paint. */
export function startTourWhenReady(key: string, steps: DriveStep[], opts?: { force?: boolean }) {
  if (!opts?.force && hasSeenTour(key)) return;
  requestAnimationFrame(() => setTimeout(() => startTour(key, steps, opts), 350));
}
