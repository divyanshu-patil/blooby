import { baseUrl, needsKey, rotation, type CopilotSettings, type KeyStatus } from './pool';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export class PoolError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything stays in the browser: requests go straight from here to the endpoint. */
async function call(
  s: CopilotSettings,
  path: string,
  init: RequestInit,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<Response> {
  const keys = rotation(s);
  let lastError = 'no endpoint reachable';

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of keys) {
      if (needsKey(s) && !key) {
        throw new PoolError('This endpoint needs an API key. Add one in the copilot settings.');
      }
      try {
        const res = await fetch(`${baseUrl(s)}${path}`, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...init.headers },
        });
        if (res.ok) { if (key) markKey(key, 'ok'); return res; }

        const body = await res.text().catch(() => '');
        lastError = `${res.status} ${body.slice(0, 160)}`;
        if (key) markKey(key, res.status === 429 ? 'rate-limited' : 'error', `${res.status}`);
        if (res.status < 400 || res.status === 400 || res.status === 404) throw new PoolError(lastError);
      } catch (e) {
        if (e instanceof PoolError) throw e;
        lastError = e instanceof Error ? e.message : String(e);
        if (key) markKey(key, 'error', lastError.slice(0, 40));
      }
    }
    // whole pool exhausted — back off once before the second sweep
    if (attempt === 0) await sleep(1200);
  }
  throw new PoolError(lastError);
}

export async function listModels(
  s: CopilotSettings,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<string[]> {
  const res = await call(s, '/api/tags', { method: 'GET' }, markKey);
  const data = await res.json();
  const names: string[] = (data.models ?? []).map((m: { name?: string; model?: string }) => m.name ?? m.model).filter(Boolean);
  return names.sort();
}

export async function chatJson(
  s: CopilotSettings,
  messages: ChatMessage[],
  schema: object,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<string> {
  const res = await call(s, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model: s.model,
      messages,
      stream: false,
      format: schema,
      options: { temperature: 0.15 },
    }),
  }, markKey);
  const data = await res.json();
  return data.message?.content ?? data.response ?? '';
}
