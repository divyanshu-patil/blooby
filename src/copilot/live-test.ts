/**
 * Live end-to-end check for the copilot, against a real Ollama.
 *
 *   ollama serve            # and `ollama signin` once, for the cloud tier
 *   npm run copilot:test -- gpt-oss:120b "make the mascot blink twice then look surprised"
 *
 * Runs the real system prompt through the real parse -> normalise -> validate -> apply
 * chain and prints what it would do. Not part of `npm run check`: that one must stay
 * offline and deterministic, and this needs a daemon and a network.
 */
declare const process: { argv: string[] };
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { systemPrompt } from './prompt';
import { RESPONSE_SCHEMA, normaliseCall, validate, describe, applyCalls } from './tools';
import { parseTurn } from './parse';
import { resolveModel, type CopilotSettings } from './pool';
import { blockStarts } from '../core/timeline';
import { activeTimeline } from '../core/types';

const [, , model, ask] = process.argv;
const settings: CopilotSettings = { endpoint: 'cloud', customUrl: '', model, keys: [] };

const ed = useEditor.getState();
ed.loadProject(defaultProject());
const P = () => useEditor.getState().project;

const body = JSON.stringify({
  model: resolveModel(settings, settings.model),
  messages: [{ role: 'system', content: systemPrompt(P()) }, { role: 'user', content: ask }],
  stream: false, format: RESPONSE_SCHEMA, options: { temperature: 0.15 },
});

const res = await fetch('http://localhost:11434/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});
const data = await res.json();
const raw = data.message?.content ?? '';
console.log('--- raw ---\n' + raw.slice(0, 500) + '\n');

const parsed = parseTurn(raw);
const calls = parsed.calls.map((c) => normaliseCall(P(), c));
console.log('reply:', parsed.reply || '(none)');
for (const c of calls) {
  const bad = validate(P(), c);
  console.log(bad ? `  REJECT ${c.name}: ${bad}` : `  ok  ${describe(P(), c)}`);
}
if (calls.length && calls.every((c) => validate(P(), c) === null)) {
  const before = activeTimeline(P()).blocks.length;
  applyCalls(calls);
  const tl = activeTimeline(P());
  const starts = blockStarts(tl);
  console.log(`\napplied. blocks ${before} -> ${tl.blocks.length}, tracks ${tl.tracks.length}, modifiers ${tl.modifiers.length}`);
  console.log('timeline:', tl.blocks.map((b, i) => `${b.name}@${(starts[i] / 1000).toFixed(2)}s`).join('  '));
  useEditor.getState().undo();
  console.log('one undo -> blocks', activeTimeline(P()).blocks.length);
} else {
  console.log('\nnothing applyable');
}
