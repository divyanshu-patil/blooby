import { baseUrl, CLOUD_CATALOGUE, displayModel, needsKey, resolveModel, rotation, usesBackend, type CopilotSettings, type KeyStatus } from './pool';
import { api, ApiError } from '../cloud/client';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export class PoolError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Requests go straight from the browser to the endpoint, EXCEPT the cloud tier with your
 * own keys — a browser cannot reach ollama.com at all (no CORS headers), so those hop
 * through blooby's backend, which has no such restriction. The keys still live only in
 * this browser; they are sent per-request and never stored server-side.
 */
async function callBackend(s: CopilotSettings, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    const json = await api.post<unknown>('/api/copilot/chat', { ...(body as object), keys: s.keys.map((k) => k.value) }, { signal });
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      throw new PoolError('Sign in to use Ollama Cloud with your own keys — the backend needs to know who you are.');
    }
    throw new PoolError(e instanceof Error ? e.message : String(e));
  }
}

async function call(
  s: CopilotSettings,
  path: string,
  init: RequestInit,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<Response> {
  // the backend does its own rotation across the keys we hand it, so there is nothing
  // to sweep here
  if (usesBackend(s) && path === '/api/chat') {
    return callBackend(s, init.body ? JSON.parse(init.body as string) : {}, init.signal ?? undefined);
  }

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
        // with no keys the daemon holds the cloud sign-in, so an auth failure has one fix
        if (s.endpoint === 'cloud' && !usesBackend(s) && (res.status === 401 || res.status === 403)) {
          throw new PoolError('Ollama is not signed in to Ollama Cloud — run `ollama signin`, then try again.');
        }
        if (key) markKey(key, res.status === 429 ? 'rate-limited' : 'error', `${res.status}`);
        // a bad request or a missing model is not going to work on a different key
        if (res.status === 400 || res.status === 404) throw new PoolError(lastError);
      } catch (e) {
        if (e instanceof PoolError) throw e;
        // a deliberate stop is not a failing key: never sweep the pool past it
        if (e instanceof Error && e.name === 'AbortError') throw e;
        lastError = e instanceof Error ? e.message : String(e);
        if (key) markKey(key, 'error', lastError.slice(0, 40));
      }
    }
    // whole pool exhausted — back off once before the second sweep
    if (attempt === 0) await sleep(1200);
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
  // through the backend there is no daemon in the picture at all, and ollama.com's own
  // list is CORS-blocked — so the catalogue IS the list. Asking localhost here only ever
  // reported that a daemon this tier never touches was not running.
  if (usesBackend(s)) return [...CLOUD_CATALOGUE];

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
  signal?: AbortSignal,
  opts: {
    /** called as the reply streams in, with the tokens generated so far — live usage */
    onTokens?: (output: number) => void;
    /** context window for local models; the agent's prompt needs more than a one-shot's */
    numCtx?: number;
  } = {},
): Promise<{ content: string; thinking?: string; usage: { input: number; output: number } }> {
  // streamed wherever the browser talks to Ollama itself; the backend hop answers whole
  const stream = !!opts.onTokens && !usesBackend(s);
  const res = await call(s, '/api/chat', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model: resolveModel(s, s.model),
      messages,
      stream,
      format: schema,
      // a preset with several tracks is a long reply; a default output budget cuts it
      // off mid-JSON, which reads downstream as "the model did not return JSON".
      // num_ctx is a local-model knob — cloud sizes its own context, so don't send it.
      options: { temperature: 0.15, num_predict: 4096, ...(s.endpoint === 'cloud' ? {} : { num_ctx: opts.numCtx ?? 8192 }) },
    }),
  }, markKey);
  let data: { message?: { content?: string; thinking?: string }; response?: string; prompt_eval_count?: number; eval_count?: number };
  if (stream && res.body) {
    // NDJSON: one chunk per line, about a token each; the last carries the real counts
    let content = '', thinking = '', chunks = 0, buf = '';
    let last: typeof data = {};
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const chunk = JSON.parse(line);
          content += chunk.message?.content ?? chunk.response ?? '';
          thinking += chunk.message?.thinking ?? '';
          chunks++;
          last = chunk;
          opts.onTokens?.(chunks);
        } catch { /* a partial line waits for the rest */ }
      }
    }
    data = { ...last, message: { content, thinking } };
  } else {
    data = await res.json();
    opts.onTokens?.(typeof data.eval_count === 'number' ? data.eval_count : 0);
  }
  // reasoning models put their scratchpad in `thinking`; the UI shows it collapsed
  const content = data.message?.content ?? data.response ?? '';
  // what the endpoint counted; a rough 4 characters a token when it says nothing
  const sent = messages.reduce((n, m) => n + m.content.length, 0);
  const usage = {
    input: typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : Math.ceil(sent / 4),
    output: typeof data.eval_count === 'number' ? data.eval_count : Math.ceil(content.length / 4),
  };
  return { content, thinking: data.message?.thinking || undefined, usage };
}

/**
 * Whether the pool actually works, asked on the real path.
 *
 * On the backend tier the model list is a static catalogue, so it proves nothing — the
 * only question worth answering when you press Check is whether your keys are accepted.
 * One near-empty round trip answers it, and marks each key as it goes.
 */
export async function verifyKeys(
  s: CopilotSettings,
  markKey: (key: string, status: KeyStatus, note?: string) => void,
): Promise<string> {
  if (!s.model) throw new PoolError('Pick a model first.');
  const res = await call(s, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model: resolveModel(s, s.model),
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
      options: { num_predict: 1 },
    }),
  }, markKey);
  await res.json().catch(() => ({}));
  return `${s.keys.length} key${s.keys.length === 1 ? '' : 's'} ok`;
}
