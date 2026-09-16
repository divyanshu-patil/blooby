import { it, vi } from 'vitest';
import { check } from '../core/testkit';
import { chatJson } from './client';
import type { CopilotSettings } from './pool';

// a local Ollama answering in NDJSON chunks, the last one carrying the real counts
const lines = [
  { message: { content: '{"plan":"' } },
  { message: { content: 'x","status":"ok",' } },
  { message: { content: '"calls":[],"done":true}' } },
  { message: { content: '' }, done: true, prompt_eval_count: 1234, eval_count: 3 },
].map((l) => `${JSON.stringify(l)}\n`);
let sentBody: { stream?: boolean; options?: { num_ctx?: number } } = {};
vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
  sentBody = JSON.parse(String(init.body));
  const enc = new TextEncoder();
  // split mid-line, the way a network does
  const all = lines.join('');
  const parts = [all.slice(0, 20), all.slice(20, 70), all.slice(70)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200 });
});

const settings: CopilotSettings = { endpoint: 'local', customUrl: '', model: 'llama3', keys: [] };
const seen: number[] = [];
const r = await chatJson(settings, [{ role: 'user', content: 'hi' }], {}, () => {}, undefined, { onTokens: (n) => seen.push(n), numCtx: 32768 });

it('asks for a stream when live token counts are wanted', check(sentBody.stream === true && sentBody.options?.num_ctx === 32768));
it('the reply is reassembled from its chunks', check(r.content === '{"plan":"x","status":"ok","calls":[],"done":true}', r.content));
it('tokens are reported as they arrive, one step at a time', check(seen.join() === '1,2,3,4', seen.join()));
it('and the final counts are the endpoint\'s own', check(r.usage.input === 1234 && r.usage.output === 3));
