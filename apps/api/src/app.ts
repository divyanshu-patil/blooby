import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { generalLimiter } from './middlewares/rateLimiter.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { routes } from './routes/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // the ceiling is enforced again in storage.service against the serialized payload;
  // this one just stops an oversized body being buffered in the first place
  app.use(express.json({ limit: env.MAX_PROJECT_BYTES }));
  app.use(requestLogger);
  app.use(generalLimiter);

  app.get('/health', (_req, res) => res.json({ ok: true, env: env.NODE_ENV }));
  app.use('/api', routes);

  // order matters: unmatched paths become a 404 error, then everything lands in one handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
