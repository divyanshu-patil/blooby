import type { ToolCall } from './tools';

/**
 * Turns whatever a model actually said into { reply, calls }.
 *
 * Ollama's `format` field pins the shape for local models, but it is not enforced once
 * the daemon proxies to Ollama Cloud — cloud models come back fence-wrapped, sometimes
 * as a bare array, and often with each call written as `{ toolName: args }` rather than
 * `{ name, args }`. Rather than re-prompt on every one of those, normalise here and
 * keep the re-prompt for genuine mistakes.
 */

const TOOL_NAMES = new Set([
  'set_eye_params', 'set_property', 'add_keyframe', 'create_expression', 'apply_expression',
  'create_preset', 'add_preset_to_timeline', 'add_modifier', 'morph_between',
]);

/** Pull JSON out of ``` fences or out of surrounding prose. */
export function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith('{') || body.startsWith('[')) return body;
  // a model that chatted first: take the first balanced brace/bracket run
  const start = body.search(/[[{]/);
  if (start < 0) return body;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) return body.slice(start, i + 1);
  }
  return body.slice(start);
}

function asCall(item: unknown): ToolCall | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;

  // the documented shape
  const named = o.name ?? o.tool ?? o.function;
  if (typeof named === 'string' && TOOL_NAMES.has(named)) {
    const args = o.args ?? o.arguments ?? o.parameters ?? o.input ?? {};
    return { name: named, args: (typeof args === 'object' && args ? args : {}) as Record<string, unknown> };
  }

  // { add_preset_to_timeline: { preset: "Blink" } } — what cloud models tend to emit
  const keys = Object.keys(o).filter((k) => TOOL_NAMES.has(k));
  if (keys.length === 1) {
    const args = o[keys[0]];
    return { name: keys[0], args: (typeof args === 'object' && args ? args : {}) as Record<string, unknown> };
  }
  return null;
}

export interface ParsedTurn { reply: string; calls: ToolCall[] }

export function parseTurn(raw: string): ParsedTurn {
  const json = extractJson(raw);
  let data: unknown;
  try { data = JSON.parse(json); }
  catch { throw new Error(`Model did not return JSON: ${raw.slice(0, 140)}`); }

  // a bare array is a list of calls
  const list = Array.isArray(data)
    ? data
    : (() => {
        const o = data as Record<string, unknown>;
        for (const key of ['calls', 'tool_calls', 'toolCalls', 'actions', 'tools']) {
          if (Array.isArray(o[key])) return o[key] as unknown[];
        }
        // a single call written without a wrapper
        return asCall(o) ? [o] : [];
      })();

  const obj = Array.isArray(data) ? {} : (data as Record<string, unknown>);
  const reply = [obj.reply, obj.message, obj.text, obj.summary].find((v) => typeof v === 'string' && v.trim()) as string | undefined;

  return {
    reply: reply ?? '',
    calls: list.map(asCall).filter((c): c is ToolCall => c !== null),
  };
}
