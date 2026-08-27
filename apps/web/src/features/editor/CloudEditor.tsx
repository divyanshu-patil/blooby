import { useEffect, useRef, useState } from 'react';
import {
  Dialog, Editor, ErrorState, SaveIndicator, projectsApi, useAutosave, useEditor,
  type Project,
} from '@blooby/studio';

/**
 * The editor, wired to one cloud project.
 *
 * The editor component itself is untouched — it still just edits the store. This wrapper
 * owns loading the project in, autosaving it out, and reporting what that save is doing,
 * so the same Editor renders identically offline, here, and in the admin panel.
 */
export function CloudEditor({ projectId, onExit }: { projectId: string; onExit: () => void }) {
  const project = useEditor((s) => s.project);
  const loadProject = useEditor((s) => s.loadProject);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const loadedFor = useRef<string | null>(null);

  const { state, savedAt, conflict, saveNow, setBaseVersion } = useAutosave(projectId, project, !loading && !error);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);

    projectsApi
      .getData(projectId)
      .then(({ project: meta, data }) => {
        if (!live) return;
        loadProject(data as Project);
        setBaseVersion(meta.currentVersion);
        setName(meta.name);
        loadedFor.current = projectId;
        setLoading(false);
        // "recently opened" only means something if opening records itself
        void projectsApi.markOpened(projectId).catch(() => {});
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : 'Could not open this project.');
        setLoading(false);
      });

    return () => { live = false; };
  }, [projectId, loadProject, setBaseVersion]);

  if (loading) {
    return <div className="state"><div className="state-title">Opening {name || 'project'}…</div></div>;
  }
  if (error) {
    return <ErrorState message={error} onRetry={onExit} />;
  }

  return (
    <div className="cloud-editor">
      <div className="cloud-bar">
        <button className="btn ghost sm" onClick={onExit}>← Projects</button>
        <strong className="cloud-name">{name}</strong>
        <span className="spacer" />
        <SaveIndicator state={state} savedAt={savedAt} onRetry={() => void saveNow()} />
        <button className="btn sm" onClick={() => void saveNow()} disabled={state === 'saving'}>Save now</button>
      </div>

      <div className="cloud-editor-body">
        <Editor />
      </div>

      {/* a lost update is the one save failure the user cannot fix by retrying, so it
          gets a dialog rather than the inline indicator */}
      {conflict && (
        <Dialog
          title="This project changed somewhere else"
          note="It was saved in another tab or on another device after you opened it. Reload to pick up the latest version — your current edits are still here until you do."
          onClose={() => {}}
          actions={<>
            <button className="btn ghost" onClick={onExit}>Back to projects</button>
            <button className="btn primary" onClick={() => window.location.reload()}>Reload project</button>
          </>}
        />
      )}
    </div>
  );
}
