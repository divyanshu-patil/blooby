import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { chatJson, listModels, PoolError, type ChatMessage } from '../copilot/client';
import { DEFAULT_SETTINGS, loadSettings, maskKey, needsKey, saveSettings, type CopilotSettings, type KeyStatus } from '../copilot/pool';
import { applyCalls, describe, RESPONSE_SCHEMA, TOOL_DOCS, validate, type ToolCall } from '../copilot/tools';
import { Panel } from './bits';
import { fmtSec } from '../core/timeline';
import type { Project } from '../core/types';

interface Turn { role: 'user' | 'bot' | 'error'; text: string; calls?: ToolCall[]; done?: boolean }

/** Compact enough to fit any context window, complete enough to act on. */
function systemPrompt(p: Project): string {
  const nodes = Object.values(p.rig.nodes)
    .map((n) => `  ${n.id} "${n.name}" (${n.kind}${n.eye ? `, openness ${n.eye.openness}, distance ${n.eye.distanceFromCenter}°` : ''})`)
    .join('\n');
  return `You are the animation copilot inside blooby, a mascot studio.

The mascot is a sphere (the body) with features mapped onto its surface. Mapped features
are NOT positioned in pixels — they use two angles:
  surface.yaw   left(-) / right(+), degrees, around the sphere
  surface.pitch up(-) / down(+), degrees
A feature near the rim foreshortens automatically; past ~90° it hides behind the silhouette.
Roll (transform.rotation) is ordinary in-plane 2D rotation.

Animatable properties: surface.yaw, surface.pitch, flatOffset.x, flatOffset.y,
transform.scale.x, transform.scale.y, transform.rotation, transform.length,
eye.openness (0 closed, 1 open), eye.distanceFromCenter, size.x, size.y.

Layers:
${nodes}
Expressions: ${p.expressions.map((e) => `${e.name}`).join(', ') || 'none'}
Presets: ${p.presets.map((e) => `${e.name} (${fmtSec(e.durationMs)})`).join(', ')}
Timeline: ${fmtSec(p.timelineDurationMs)} at ${p.fps} fps, ${p.blocks.length} blocks.

Tools (emit them in "calls"):
${TOOL_DOCS}

Rules:
- Prefer existing presets for common beats (Blink, Talk, Happy, Surprised, Thinking, Notify).
- Times are milliseconds from the start of the timeline.
- Keep "reply" to one or two sentences. Put every change in "calls" — never describe a change you did not emit.
- Emit an empty "calls" array when the user is only asking a question.`;
}

export function Copilot() {
  const project = useEditor((s) => s.project);
  const [settings, setSettings] = useState<CopilotSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [status, setStatus] = useState('');
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => { setSettings(loadSettings()); }, []);
  useEffect(() => { thread.current?.scrollTo({ top: 1e6 }); }, [turns]);

  const patch = (p: Partial<CopilotSettings>) => setSettings((s) => { const n = { ...s, ...p }; saveSettings(n); return n; });

  const markKey = (value: string, st: KeyStatus, note?: string) =>
    setSettings((s) => {
      const n = { ...s, keys: s.keys.map((k) => (k.value === value ? { ...k, status: st, note, usedAt: Date.now() } : k)) };
      saveSettings(n);
      return n;
    });

  const refresh = async (s = settings) => {
    setStatus('checking…');
    try {
      const list = await listModels(s, markKey);
      setModels(list);
      setStatus(list.length ? `${list.length} models` : 'no models installed');
      if (list.length && !list.includes(s.model)) patch({ model: list[0] });
    } catch (e) {
      setModels([]);
      setStatus(e instanceof Error ? e.message.slice(0, 90) : 'unreachable');
    }
  };

  const ask = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text }]);
    setBusy(true);

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt(project) },
      ...turns.filter((t) => t.role !== 'error').map((t) => ({ role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text })),
      { role: 'user', content: text },
    ];

    const attempt = async (extra?: string): Promise<Turn> => {
      const msgs = extra ? [...history, { role: 'user' as const, content: extra }] : history;
      const raw = await chatJson(settings, msgs, RESPONSE_SCHEMA, markKey);
      let parsed: { reply?: string; calls?: ToolCall[] };
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`Model did not return JSON: ${raw.slice(0, 120)}`); }
      const calls = Array.isArray(parsed.calls) ? parsed.calls : [];
      const problems = calls.map((c) => validate(project, c)).filter(Boolean) as string[];
      if (problems.length) throw new ValidationError(problems.join('; '));
      return { role: 'bot', text: parsed.reply ?? '', calls };
    };

    try {
      let turn: Turn;
      try { turn = await attempt(); }
      catch (e) {
        // one re-prompt with the validator's complaint, then give up
        if (!(e instanceof ValidationError)) throw e;
        turn = await attempt(`Your previous tool calls were rejected: ${e.message}. Use only the layer ids, expression names and preset names listed above, and only the listed properties. Try again.`);
      }
      setTurns((t) => [...t, turn]);
    } catch (e) {
      const msg = e instanceof PoolError || e instanceof Error ? e.message : String(e);
      setTurns((t) => [...t, { role: 'error', text: msg }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = (i: number) => {
    const turn = turns[i];
    if (!turn.calls?.length) return;
    applyCalls(turn.calls);
    setTurns((t) => t.map((x, n) => (n === i ? { ...x, done: true } : x)));
  };

  return (
    <>
      <Panel title="Copilot" actions={
        <button className="btn ghost sm icon" title="Connection and keys" aria-pressed={showKeys}
          onClick={() => setShowKeys((v) => !v)}>⚙</button>
      }>
        {showKeys && (
          <>
            <div className="row">
              <div className="seg">
                {(['local', 'cloud', 'custom'] as const).map((e) => (
                  <button key={e} aria-pressed={settings.endpoint === e} onClick={() => patch({ endpoint: e })}>{e}</button>
                ))}
              </div>
              <span className="spacer" />
              <button className="btn sm" onClick={() => refresh()}>Check</button>
            </div>
            {settings.endpoint === 'custom' && (
              <input className="txt" placeholder="https://your-ollama-compatible-host" value={settings.customUrl}
                onChange={(e) => patch({ customUrl: e.target.value })} />
            )}
            {needsKey(settings) && (
              <>
                <div className="row">
                  <input className="txt" type="password" placeholder="Paste an API key" value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || !newKey.trim()) return;
                      patch({ keys: [...settings.keys, { id: `k${Date.now()}`, value: newKey.trim(), status: 'ok' }] });
                      setNewKey('');
                    }} />
                  <button className="btn sm" disabled={!newKey.trim()} onClick={() => {
                    patch({ keys: [...settings.keys, { id: `k${Date.now()}`, value: newKey.trim(), status: 'ok' }] });
                    setNewKey('');
                  }}>Add</button>
                </div>
                <div className="keypool">
                  {settings.keys.map((k) => (
                    <div key={k.id} className="keyrow">
                      <span className={`dot-status ${k.status === 'rate-limited' ? 'rate' : k.status}`} />
                      <span style={{ flex: 1 }}>{maskKey(k.value)}</span>
                      <span className="tag">{k.note ?? k.status}</span>
                      <button className="btn ghost sm icon" onClick={() => patch({ keys: settings.keys.filter((x) => x.id !== k.id) })}>✕</button>
                    </div>
                  ))}
                  {!settings.keys.length && <p className="hint">No keys yet. Requests rotate across every key you add and fail over on 401, 429 or 5xx.</p>}
                </div>
              </>
            )}
            <p className="hint">Keys live in this browser's localStorage and are sent only to the endpoint above — blooby has no server.</p>
            <div className="divider" />
          </>
        )}

        <div className="row">
          <select className="sel" style={{ flex: 1 }} value={settings.model} onChange={(e) => patch({ model: e.target.value })}>
            {!models.length && <option value={settings.model}>{settings.model || 'no model — press Check'}</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="tag">{status || settings.endpoint}</span>
        </div>
      </Panel>

      <div className="panel flush grow" style={{ minHeight: 260 }}>
        <div className="panel-body chat">
          <div className="thread" ref={thread}>
            {!turns.length && (
              <p className="hint">
                Try: “make the mascot blink twice then look surprised”, “add a slow float to the body”,
                or “capture a sleepy expression and morph into it over half a second”.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`msg ${t.role === 'user' ? 'user' : t.role === 'error' ? 'err' : 'bot'}`}>
                <span className="who">{t.role === 'user' ? 'you' : t.role === 'error' ? 'failed' : 'copilot'}</span>
                <div className="bubble">{t.text}</div>
                {!!t.calls?.length && (
                  <div className="proposal" style={{ marginTop: 6 }}>
                    <ul>
                      {t.calls.map((c, n) => <li key={n}>{describe(project, c)} <code>{c.name}</code></li>)}
                    </ul>
                    <div className="acts">
                      {t.done ? <span className="hint">Applied — ⌘Z undoes the whole batch.</span> : (
                        <>
                          <button className="btn sm primary" onClick={() => apply(i)}>Apply {t.calls.length}</button>
                          <button className="btn sm" onClick={() => setTurns((x) => x.map((y, n) => (n === i ? { ...y, calls: [] } : y)))}>Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="hint">thinking…</p>}
          </div>
          <textarea className="ask" placeholder="Describe the animation you want…" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }} />
          <div className="row">
            <span className="hint">⌘↵ to send</span>
            <span className="spacer" />
            <button className="btn sm" disabled={!turns.length} onClick={() => setTurns([])}>Clear</button>
            <button className="btn primary sm" disabled={busy || !input.trim() || !settings.model} onClick={ask}>Send</button>
          </div>
        </div>
      </div>
    </>
  );
}

class ValidationError extends Error {}
