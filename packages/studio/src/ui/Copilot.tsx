import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { chatJson, listModels, PoolError, type ChatMessage } from '../copilot/client';
import { acceptsKeys, baseUrl, DEFAULT_CLOUD_MODEL, displayModel, ENDPOINT_INFO, loadSettings, maskKey, resolveModel, saveSettings, usesBackend, type CopilotSettings, type KeyStatus } from '../copilot/pool';
import { applyCalls, describe, normaliseCall, RESPONSE_SCHEMA, validate } from '../copilot/tools';
import { systemPrompt } from '../copilot/prompt';
import { parseTurn } from '../copilot/parse';
import { CLOUD_CATALOGUE } from '../copilot/pool';
import { useCopilotSession, type Turn } from '../copilot/session';
import { Panel } from './bits';

const PHASE_LABEL = {
  thinking: 'thinking…',
  retrying: 'that batch did not validate — asking again…',
  applying: 'applying changes…',
} as const;

export function Copilot() {
  const project = useEditor((s) => s.project);
  const [settings, setSettings] = useState<CopilotSettings>(loadSettings);
  // the cloud catalogue needs no network, so the picker is never empty on the cloud tier
  const [models, setModels] = useState<string[]>(() => (loadSettings().endpoint === 'cloud' ? [...CLOUD_CATALOGUE] : []));
  // the thread lives in a store, not here: this panel is one tab in the right rail, and
  // switching to Node or Effects unmounts it — which used to throw the conversation away
  const { turns, input, phase, status, push, patchTurn, setInput, setPhase, setStatus, clear } = useCopilotSession();
  const busy = phase !== 'idle';
  const [showKeys, setShowKeys] = useState(false);
  const [newKey, setNewKey] = useState('');
  const thread = useRef<HTMLDivElement>(null);

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
      // the cloud catalogue is still usable when the daemon is simply not running yet
      setModels(s.endpoint === 'cloud' ? [...CLOUD_CATALOGUE] : []);
      setStatus(e instanceof Error && /fetch|network/i.test(e.message)
        ? 'Ollama not reachable — is it running?'
        : (e instanceof Error ? e.message.slice(0, 90) : 'unreachable'));
    }
  };

  const ask = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push({ role: 'user', text });
    setPhase('thinking');

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt(project) },
      ...turns.filter((t) => t.role !== 'error').map((t) => ({ role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text })),
      { role: 'user', content: text },
    ];

    const attempt = async (extra?: string): Promise<Turn> => {
      const msgs = extra ? [...history, { role: 'user' as const, content: extra }] : history;
      const { content, thinking } = await chatJson(settings, msgs, RESPONSE_SCHEMA, markKey);
      const parsed = parseTurn(content);
      const calls = parsed.calls.map((c) => normaliseCall(project, c));
      const problems = calls.map((c) => validate(project, c)).filter(Boolean) as string[];
      if (problems.length) throw new ValidationError(problems.join('; '));
      if (!parsed.reply && !calls.length) throw new ValidationError('no tool calls and nothing to say');
      return { role: 'bot', text: parsed.reply || `${calls.length} change${calls.length === 1 ? '' : 's'} ready.`, calls, thinking };
    };

    try {
      let turn: Turn;
      try { turn = await attempt(); }
      catch (e) {
        // one re-prompt with the validator's complaint, then give up
        if (!(e instanceof ValidationError)) throw e;
        setPhase('retrying');
        turn = await attempt(`Your previous tool calls were rejected: ${e.message}. Use only the layer ids, expression names and preset names listed above, and only the listed properties. Try again.`);
      }
      push(turn);
    } catch (e) {
      const msg = e instanceof PoolError || e instanceof Error ? e.message : String(e);
      push({ role: 'error', text: msg });
    } finally {
      setPhase('idle');
    }
  };

  const apply = (i: number) => {
    const turn = turns[i];
    if (!turn.calls?.length) return;
    setPhase('applying');
    try { applyCalls(turn.calls); } finally { setPhase('idle'); }
    patchTurn(i, { done: true });
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
                  <button key={e} aria-pressed={settings.endpoint === e} onClick={() => {
                    patch({ endpoint: e, model: e === 'cloud' ? DEFAULT_CLOUD_MODEL : '' });
                    setModels(e === 'cloud' ? [...CLOUD_CATALOGUE] : []);
                    setStatus('');
                  }}>{ENDPOINT_INFO[e].label}</button>
                ))}
              </div>
              <span className="spacer" />
              <button className="btn sm" title="Ask Ollama which models it has" onClick={() => refresh()}>Check</button>
            </div>
            <p className="hint">{ENDPOINT_INFO[settings.endpoint].hint}</p>
            {settings.endpoint === 'custom' && (
              <input className="txt" placeholder="https://your-ollama-compatible-host" value={settings.customUrl}
                onChange={(e) => patch({ customUrl: e.target.value })} />
            )}
            {settings.endpoint === 'cloud' && (
              <p className="hint">
                {usesBackend(settings)
                  ? <>Using your {settings.keys.length} key{settings.keys.length === 1 ? '' : 's'} through the blooby
                      backend. <code>ollama.com</code> sends no CORS headers, so a browser cannot call it directly —
                      the backend makes the hop. Remove every key to fall back to your local Ollama.</>
                  : <>With no keys, requests go to <code>localhost:11434</code> and your local Ollama proxies them
                      using its own sign-in. Add a key below to use your own Ollama Cloud account instead.</>}
              </p>
            )}
            {acceptsKeys(settings) && (
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
            <p className="hint">
              Keys live in this browser's localStorage. On a custom endpoint they are sent straight there;
              on Ollama Cloud they are forwarded per-request through the blooby backend, which never stores them.
            </p>
            <div className="divider" />
          </>
        )}

        <div className="row">
          <select className="sel" style={{ flex: 1 }} value={settings.model} onChange={(e) => patch({ model: e.target.value })}>
            {!models.length && <option value={settings.model}>{settings.model || 'no model — press Check'}</option>}
            {models.map((m) => <option key={m} value={m}>{displayModel(m)}</option>)}
          </select>
          <span className="tag" title={baseUrl(settings)}>{status || ENDPOINT_INFO[settings.endpoint].label}</span>
        </div>
        {settings.endpoint === 'cloud' && settings.model && (
          <p className="hint">Runs as <code>{resolveModel(settings, settings.model)}</code> on Ollama Cloud.</p>
        )}
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
                {t.thinking && (
                  <details className="think">
                    <summary>thinking</summary>
                    <pre>{t.thinking}</pre>
                  </details>
                )}
                {!!t.calls?.length && (
                  <div className="proposal" style={{ marginTop: 6 }}>
                    <ul>
                      {t.calls.map((c, n) => <li key={n}>{describe(project, c)} <code>{c.name}</code></li>)}
                    </ul>
                    <div className="acts">
                      {t.done ? <span className="hint">Applied — ⌘Z undoes the whole batch.</span> : (
                        <>
                          <button className="btn sm primary" onClick={() => apply(i)}>Apply {t.calls.length}</button>
                          <button className="btn sm" onClick={() => patchTurn(i, { calls: [] })}>Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="hint working">{PHASE_LABEL[phase as keyof typeof PHASE_LABEL]}</p>}
          </div>
          <textarea className="ask" placeholder="Describe the animation you want…" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }} />
          <div className="row">
            <span className="hint">⌘↵ to send</span>
            <span className="spacer" />
            <button className="btn sm" disabled={!turns.length || busy} onClick={clear}>Clear</button>
            <button className="btn primary sm" disabled={busy || !input.trim() || !settings.model} onClick={ask}>Send</button>
          </div>
        </div>
      </div>
    </>
  );
}

class ValidationError extends Error {}
