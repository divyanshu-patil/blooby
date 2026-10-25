// Vercel's entry: the platform calls the exported app per request instead of running
// src/index.ts, so there is no listen() here. Bundled to ./index.mjs by scripts/bundle.mjs.
import { createApp } from './app.js';
import { listenForInvalidations } from './utils/invalidate.js';

listenForInvalidations();

export default createApp();
