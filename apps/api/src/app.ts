import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { generalLimiter } from './middlewares/rateLimiter.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { routes } from './routes/index.js';
import { mcpRoutes, oauthRoutes } from './routes/mcp.routes.js';
import { ogRoutes } from './routes/og.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Whether X-Forwarded-For may be believed, and from how many hops. Unset behind a proxy
  // would make every request look like it came from the proxy — one rate-limit bucket for
  // the whole deployment — and too trusting lets a client forge its own address.
  app.set('trust proxy', env.trustProxy);

  // Postgres bigint columns (projects.size_bytes) arrive as JS BigInt, which
  // JSON.stringify throws on. Handled once here rather than mapped in every controller
  // that happens to return a project — a route added later cannot forget it.
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value);
  // The MCP endpoint and its OAuth server come first: they answer AI clients from any
  // origin with their own CORS, body parsing and rate limits, not the app's.
  app.use(oauthRoutes);
  app.use('/mcp', mcpRoutes);

  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // the ceiling is enforced again in storage.service against the serialized payload;
  // this one just stops an oversized body being buffered in the first place
  app.use(express.json({ limit: env.MAX_PROJECT_BYTES }));
  app.use(requestLogger);
  app.use(generalLimiter);

  app.get('/health', (_req, res) => res.json({ ok: true, env: env.NODE_ENV }));
  // link previews: asked for by unfurlers and crawlers from anywhere, never authenticated,
  // and outside /api because the URL itself ends up pasted into chat windows
  app.use('/og', ogRoutes);
  app.use('/api', routes);

  // order matters: unmatched paths become a 404 error, then everything lands in one handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
