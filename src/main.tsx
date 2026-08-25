import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installPublicApi } from './core/publicApi';

installPublicApi();

if (import.meta.env.DEV && new URLSearchParams(location.search).has('smoke')) {
  import('./smoke').then((m) => m.smoke().catch((e: Error) => { document.title = 'SMOKE FAIL ' + e.message; }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
