import { createApp } from './app.js';
import { env } from './config/env.js';
import { hasRedis } from './config/redis.js';
import { listenForInvalidations } from './utils/invalidate.js';

// one process tells the others when a cached row has changed; a no-op without Redis
listenForInvalidations();

createApp().listen(env.PORT, () => {
  console.log(`blooby api on :${env.PORT} (${env.NODE_ENV})${hasRedis() ? ' · redis' : ' · no redis (single instance)'}`);
});
