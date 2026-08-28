import { createApp } from './app.js';
import { env } from './config/env.js';

createApp().listen(env.PORT, () => {
  console.log(`blooby api on :${env.PORT} (${env.NODE_ENV})`);
});
