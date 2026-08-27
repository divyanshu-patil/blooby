import type { Request, Response } from 'express';
import { env } from './env.js';

/**
 * The reason this route exists: ollama.com serves no CORS headers, so a browser can
 * never call it directly with your own keys — the editor's "cloud" tier has to borrow the
 * local daemon's sign-in instead. Server-to-server has no such limit, so this is where
 * "n keys, immediate failover" finally means real cloud access with real keys.
 *
 * Same rotation shape as packages/studio/src/copilot/client.ts: try every key once,
 * back off, sweep again; a 400/404 is not retried because a different key won't fix it.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function copilotChat(req: Request, res: Response) {
  if (!env.ollamaKeys.length) {
    return res.status(503).json({ error: 'no OLLAMA_KEYS configured on this server' });
  }

  let lastError = 'no endpoint reachable';
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of env.ollamaKeys) {
      try {
        const upstream = await fetch(`${env.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ ...req.body, stream: false }),
        });
        if (upstream.ok) return res.json(await upstream.json());

        lastError = `${upstream.status} ${(await upstream.text().catch(() => '')).slice(0, 160)}`;
        if (upstream.status === 400 || upstream.status === 404) {
          return res.status(upstream.status).json({ error: lastError });
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (attempt === 0) await sleep(1200);
  }
  res.status(502).json({ error: lastError });
}
