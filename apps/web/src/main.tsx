import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blooby/studio/index.css';
import { Editor, installPublicApi } from '@blooby/studio';

installPublicApi();

if (import.meta.env.DEV && new URLSearchParams(location.search).has('smoke')) {
  import('@blooby/studio').then((m) => m.smoke().catch((e: Error) => { document.title = 'SMOKE FAIL ' + e.message; }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
