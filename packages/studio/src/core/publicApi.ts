import { useEditor } from './store';
import type { EasingCurve } from './types';

/**
 * The application-level integration surface spec §14 asks for — a host page (or the
 * browser console, for testing) drives mascot state without touching editor internals.
 * "Enabling states through external events" means: some other system calls these.
 *
 * setState/enableState morph by default (captures the current pose, blends it into the
 * new state's own animation) — pass `{ duration: 0 }` for an instant cut instead.
 */
export interface BloobyStateMachine {
  setState(nameOrId: string, opts?: { at?: number; duration?: number; easing?: EasingCurve }): void;
  enableState(nameOrId: string, opts?: { at?: number; duration?: number; easing?: EasingCurve }): void;
  returnToPreviousState(opts?: { duration?: number; easing?: EasingCurve }): void;
  cancelScheduledState(): void;
  /** the authored blend into a state, in ms — what setState uses when given no duration */
  setStateTransition(nameOrId: string, durationMs: number, easing?: EasingCurve): void;
  getStates(): { id: string; name: string; transitionMs: number }[];
  getActiveState(): { id: string; name: string } | null;
  /** fires with the new active state whenever it changes — from this API, the editor's
   * own State panel, or a keyboard shortcut; all routes end up at the same store action. */
  onStateChange(cb: (state: { id: string; name: string }) => void): () => void;
}

declare global {
  interface Window { blooby?: BloobyStateMachine }
}

export function installPublicApi(): void {
  if (typeof window === 'undefined') return;
  const activeOf = () => {
    const { project } = useEditor.getState();
    const tl = project.timelines.find((t) => t.id === project.activeTimelineId);
    return tl ? { id: tl.id, name: tl.name } : null;
  };
  window.blooby = {
    setState: (n, o) => useEditor.getState().setState(n, o),
    enableState: (n, o) => useEditor.getState().enableState(n, o),
    returnToPreviousState: (o) => useEditor.getState().returnToPreviousState(o),
    cancelScheduledState: () => useEditor.getState().cancelScheduledState(),
    setStateTransition: (n, ms, e) => {
      const { project, setStateTransition } = useEditor.getState();
      const t = project.timelines.find((x) => x.id === n)
        ?? project.timelines.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (t) setStateTransition(t.id, ms, e);
    },
    getStates: () => useEditor.getState().project.timelines.map((t) => ({ id: t.id, name: t.name, transitionMs: t.transitionMs ?? 300 })),
    getActiveState: activeOf,
    onStateChange(cb) {
      let last = useEditor.getState().project.activeTimelineId;
      return useEditor.subscribe((s) => {
        if (s.project.activeTimelineId === last) return;
        last = s.project.activeTimelineId;
        const state = activeOf();
        if (state) cb(state);
      });
    },
  };
}
