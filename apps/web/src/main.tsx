import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blooby/studio/index.css';
import '@blooby/studio/kit.css';
import './features/auth/auth.css';
import './app.css';
import { installPublicApi, useEditor } from '@blooby/studio';
import { App } from './App';

installPublicApi();

// published presets come from Supabase when configured; with no env vars this resolves
// empty and the editor runs on the built-ins baked into defaultProject()
void useEditor.getState().loadCatalog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
