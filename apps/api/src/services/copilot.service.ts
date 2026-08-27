import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Why this exists: ollama.com serves no CORS headers, so a browser can never call it
 * directly with your own keys. Server-to-server has no such limit, which is where
 * "n keys, immediate failover" finally means real cloud access with real keys.
 *
 * Same rotation shape as the editor's own client: try every key once, back off, sweep
 * again. A 400/404 is not retried, because a different key will not fix it.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function copilotChat(req: Request, res: Response) {
  // A caller may supply their own keys — that is the whole point of the cloud tier from
  // a browser, which cannot reach ollama.com directly. They are used for this request
  // only: never logged, never persisted, never mixed into the server's own pool.
  const { keys: supplied, ...body } = (req.body ?? {}) as { keys?: unknown };
  const callerKeys = Array.isArray(supplied)
    ? supplied.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).slice(0, 10)
    : [];

  const keys = callerKeys.length ? callerKeys : env.ollamaKeys;
  if (!keys.length) {
    throw HttpError.badRequest('Add an Ollama Cloud API key in the copilot settings, or configure keys on the server.');
  }

  let lastError = 'no endpoint reachable';
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of keys) {
      try {
        const upstream = await fetch(`${env.OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ ...body, stream: false }),
        });
        if (upstream.ok) return res.json(await upstream.json());

        lastError = `${upstream.status} ${(await upstream.text().catch(() => '')).slice(0, 160)}`;
        if (upstream.status === 400 || upstream.status === 404) throw HttpError.badRequest(lastError);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (attempt === 0) await sleep(1200);
  }
  throw HttpError.upstream(lastError);
}
