import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blooby/studio/index.css';
import '@blooby/studio/kit.css';
import '@blooby/studio/tour.css';
import './admin.css';
import { useEditor } from '@blooby/studio';
import { App } from './App';

// the shared library backs the Official editor's preset panel too
void useEditor.getState().loadCatalog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
