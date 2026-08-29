/**
 * Dev-only harness: the real Editor with no auth in front of it.
 *
 * Every route in this app is behind a sign-in, which makes the editor itself impossible to
 * drive from a test or look at without an account. This mounts the same component the
 * product does, at /harness.html.
 *
 * It never ships: Vite only builds `index.html` as an entry, so this page and its module
 * are absent from `dist` — verified, not assumed. Keep it that way if you add build inputs.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AssetPreview, Editor } from '@blooby/studio';
import '@blooby/studio/index.css';
import '@blooby/studio/kit.css';
import '@blooby/studio/tour.css';
import './app.css';

/**
 * `?asset=<json>` mounts the admin review queue's own preview instead of the editor, so
 * the thing moderators actually look at can be driven from a test without a database row
 * and an admin account behind it.
 */
function Harness() {
  const raw = new URLSearchParams(location.search).get('asset');
  if (!raw) return <Editor />;
  const asset = JSON.parse(raw) as { kind: 'preset' | 'expression'; data: unknown };
  return (
    <div className="review-stage" style={{ width: 480, height: 480 }}>
      <AssetPreview kind={asset.kind} data={asset.data} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
