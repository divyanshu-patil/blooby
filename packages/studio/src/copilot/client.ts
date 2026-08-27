import { baseUrl, CLOUD_CATALOGUE, displayModel, needsKey, resolveModel, rotation, type CopilotSettings, type KeyStatus } from './pool';

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
        // the daemon holds the cloud sign-in, so an auth failure has one fix
        if (s.endpoint === 'cloud' && (res.status === 401 || res.status === 403)) {
          throw new PoolError('Ollama is not signed in to Ollama Cloud — run `ollama signin`, then try again.');
        }
        if (key) markKey(key, res.status === 429 ? 'rate-limited' : 'error', `${res.status}`);
        // a bad request or a missing model is not going to work on a different key
        if (res.status === 400 || res.status === 404) throw new PoolError(lastError);
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

/**
 * What the daemon actually has. For the cloud tier this is merged with the catalogue,
 * because the live cloud list at ollama.com is unreachable from a browser.
 */
export async function listModels(
  s: CopilotSettings,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<string[]> {
  const res = await call(s, '/api/tags', { method: 'GET' }, markKey);
  const data = await res.json();
  const names: string[] = (data.models ?? [])
    .map((m: { name?: string; model?: string }) => m.name ?? m.model)
    .filter(Boolean);

  if (s.endpoint !== 'cloud') return [...new Set(names)].sort();

  // pulled cloud models first, then the rest of the catalogue
  const pulled = names.filter((n) => n.endsWith('-cloud')).map(displayModel);
  return [...new Set([...pulled, ...CLOUD_CATALOGUE])];
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
      model: resolveModel(s, s.model),
      messages,
      stream: false,
      format: schema,
      options: { temperature: 0.15 },
    }),
  }, markKey);
  const data = await res.json();
  return data.message?.content ?? data.response ?? '';
}
