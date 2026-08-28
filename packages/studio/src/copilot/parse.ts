import { TOOL_NAMES as TOOL_NAME_LIST, type ToolCall } from './tools';

/**
 * Turns whatever a model actually said into { reply, calls }.
 *
 * Ollama's `format` field pins the shape for local models, but it is not enforced once
 * the daemon proxies to Ollama Cloud — cloud models come back fence-wrapped, sometimes
 * as a bare array, and often with each call written as `{ toolName: args }` rather than
 * `{ name, args }`. Rather than re-prompt on every one of those, normalise here and
 * keep the re-prompt for genuine mistakes.
 */

const TOOL_NAMES: Set<string> = new Set(TOOL_NAME_LIST);

/**
 * Pull JSON out of ``` fences or out of surrounding prose.
 *
 * Always balance-scans, even when the text already starts with `{` — a model that adds
 * "Hope that helps!" after the closing brace produces exactly that, and returning the
 * whole body verbatim made `JSON.parse` throw on a response that was otherwise perfect.
 */
export function extractJson(raw: string): { json: string; closed: boolean } {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  // nothing bracket-shaped at all is a model that ignored the format, not a cut-off one
  if (start < 0) return { json: body, closed: true };
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
    else if (c === close && --depth === 0) return { json: body.slice(start, i + 1), closed: true };
  }
  return { json: body.slice(start), closed: false };
}

/**
 * Close what a cut-off response left open, so a truncated turn still yields the calls it
 * did manage to emit instead of throwing the whole thing away.
 */
export function closeTruncated(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of s) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = esc ? s.slice(0, -1) : s;
  if (inStr) out += '"';
  // a key with no value, or a dangling comma, cannot be closed into valid JSON
  out = out.replace(/(,|"[^"]*"\s*:)\s*$/, '').replace(/,\s*$/, '');
  return out + stack.reverse().join('');
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
  const { json, closed } = extractJson(raw);
  let data: unknown;
  try { data = JSON.parse(json); }
  catch {
    // a response cut off mid-object still carries the calls before the cut
    try { data = JSON.parse(closeTruncated(json)); }
    catch {
      throw new Error(closed
        ? `Model did not return JSON (${raw.length} chars): ${raw.slice(0, 400)}`
        : `Model's answer was cut off after ${raw.length} chars — ask for a shorter reply, or pick a model with a bigger output budget: ${raw.slice(0, 400)}`);
    }
  }

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
