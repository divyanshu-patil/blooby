import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveState } from '../kit';
import { projectsApi } from './api';
import type { Project } from '../core/types';

const DEBOUNCE_MS = 2500;

/**
 * Autosave for the editor.
 *
 * Rules this encodes, in order of how much they matter:
 *  - Never silently discard work. A failed save leaves the local state untouched, shows
 *    an error and offers a retry; it does not clear the dirty flag.
 *  - Do not upload on every keystroke. Edits mark the project dirty and a debounce
 *    coalesces a burst of slider drags into one write.
 *  - Never race with itself. One in-flight save at a time; anything that changes while a
 *    save is running is picked up by the next pass rather than starting a second.
 *  - Track the server's version so a second tab cannot silently overwrite this one — the
 *    API answers 409 and the user is told to reload rather than losing the other side.
 */
export function useAutosave(projectId: string | null, project: Project, enabled: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);

  const version = useRef<number | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const latest = useRef(project);
  latest.current = project;

  /** Called by the loader once it knows which version this editor started from. */
  const setBaseVersion = useCallback((v: number) => { version.current = v; }, []);

  const flush = useCallback(async () => {
    if (!projectId || !enabled || inFlight.current) { pending.current = true; return; }

    inFlight.current = true;
    pending.current = false;
    setState('saving');

    try {
      const res = await projectsApi.save(projectId, {
        project: latest.current,
        ...(version.current !== null ? { expectedVersion: version.current } : {}),
      });
      version.current = res.version;
      setSavedAt(Date.parse(res.savedAt));
      setState(pending.current ? 'dirty' : 'saved');
    } catch (e) {
      // 409 means someone else saved first — a different problem from "the network
      // blipped", and the only safe resolution is reloading, not retrying blindly
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) {
        setConflict(true);
      }
      setState('error');
    } finally {
      inFlight.current = false;
      if (pending.current && !conflict) void flush();
    }
  }, [projectId, enabled, conflict]);

  // debounce: every edit restarts the timer, so a drag saves once when it settles
  useEffect(() => {
    if (!projectId || !enabled || conflict) return;
    setState((s) => (s === 'saving' ? s : 'dirty'));
    const t = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, projectId, enabled, conflict]);

  // a close with unsaved work is the one moment worth interrupting someone for
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'saving' || state === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  return { state, savedAt, conflict, saveNow: flush, setBaseVersion };
}
