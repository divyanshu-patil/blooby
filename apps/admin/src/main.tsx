import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blooby/studio/index.css';
import './admin.css';
import { useEditor } from '@blooby/studio';
import { App } from './App';

// the shared library is the point of the backend — load it before first paint of any view
void useEditor.getState().loadCatalog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
