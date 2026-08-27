import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blooby/studio/index.css';
import { Editor, installPublicApi, useEditor } from '@blooby/studio';

installPublicApi();

// published presets come from Supabase when configured; with no env vars this resolves
// empty and the editor runs on the built-ins already baked into defaultProject()
void useEditor.getState().loadCatalog();

if (import.meta.env.DEV && new URLSearchParams(location.search).has('smoke')) {
  import('@blooby/studio').then((m) => m.smoke().catch((e: Error) => { document.title = 'SMOKE FAIL ' + e.message; }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
