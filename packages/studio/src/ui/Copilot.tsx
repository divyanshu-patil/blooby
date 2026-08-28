import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { chatJson, listModels, verifyKeys, type ChatMessage } from '../copilot/client';
import { copilotApi } from '../cloud/api';
import { acceptsKeys, baseUrl, DEFAULT_CLOUD_MODEL, displayModel, ENDPOINT_INFO, loadSettings, maskKey, resolveModel, saveSettings, usesBackend, type CopilotSettings, type KeyStatus } from '../copilot/pool';
import { applyCalls, describe, normaliseCall, RESPONSE_SCHEMA, validateBatch } from '../copilot/tools';
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
  const { turns, input, phase, status, abort, push, patchTurn, setInput, setPhase, setStatus, setAbort, clear } = useCopilotSession();
  const busy = phase !== 'idle';
  const [showKeys, setShowKeys] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(-1);
  // where ↑/↓ currently sit in your own past messages; null means you are on the live draft
  const [recalled, setRecalled] = useState<number | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const draft = useRef('');

  useEffect(() => { thread.current?.scrollTo({ top: 1e6 }); }, [turns]);

  // whether this deployment lets you bring your own keys, and whether it has any of its
  // own, is the server's call — ask it rather than assuming, and fail open to the
  // previous behaviour (your keys, no server pool) when the backend is not reachable
  useEffect(() => {
    let live = true;
    copilotApi.config()
      .then((server) => { if (live) setSettings((s) => ({ ...s, server })); })
      .catch(() => { if (live) setSettings((s) => ({ ...s, server: { allowUserKeys: true, hasServerKeys: false } })); });
    return () => { live = false; };
  }, []);

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
      if (list.length && !list.includes(s.model)) patch({ model: list[0] });
      // on the backend tier the list is a fixed catalogue and proves nothing; what you
      // actually pressed Check to find out is whether your keys are accepted
      setStatus(usesBackend(s)
        ? await verifyKeys(s, markKey)
        : (list.length ? `${list.length} models` : 'no models installed'));
    } catch (e) {
      // the cloud catalogue is still usable when the daemon is simply not running yet
      setModels(s.endpoint === 'cloud' ? [...CLOUD_CATALOGUE] : []);
      const msg = e instanceof Error ? e.message : 'unreachable';
      setStatus(/fetch|network/i.test(msg) && !usesBackend(s)
        ? 'Ollama not reachable — is it running?'
        : msg.slice(0, 90));
    }
  };

  const ask = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setRecalled(null);
    push({ role: 'user', text });
    setPhase('thinking');
    const ac = new AbortController();
    setAbort(ac);

    const history: ChatMessage[] = [
      // only the real exchange: an error or a "stopped" note is about the copilot, not
      // something the model said, and replaying it just teaches it to say that
      // Capped, because the system prompt now carries the whole timeline — an unbounded
      // thread on top of that is how a reply gets cut off mid-JSON.
      { role: 'system', content: systemPrompt(project) },
      ...turns.filter((t) => t.role === 'user' || t.role === 'bot').slice(-12)
        .map((t) => ({ role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: asHistory(t) })),
      { role: 'user', content: text },
    ];

    const attempt = async (extra?: string): Promise<Turn> => {
      const msgs = extra ? [...history, { role: 'user' as const, content: extra }] : history;
      const { content, thinking } = await chatJson(settings, msgs, RESPONSE_SCHEMA, markKey, ac.signal);
      const parsed = parseTurn(content);
      const calls = parsed.calls.map((c) => normaliseCall(project, c));
      // as a batch: create_preset followed by add_preset_to_timeline is correct, and only
      // reads as "no preset" if each call is judged against the project as it stands now
      const problems = validateBatch(project, calls).filter(Boolean) as string[];
      if (problems.length) throw new ValidationError(problems.join('; '));
      if (!parsed.reply && !calls.length) throw new ValidationError('no tool calls and nothing to say');
      // the model's own plan is more useful than a reasoning trace, and every model
      // produces one because the schema requires it
      return {
        role: 'bot', calls,
        text: parsed.reply || `${calls.length} change${calls.length === 1 ? '' : 's'} ready.`,
        thinking: parsed.plan ?? thinking,
      };
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
      if (e instanceof Error && e.name === 'AbortError') push({ role: 'note', text: 'Stopped — nothing was changed.' });
      else push({ role: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAbort(null);
      setPhase('idle');
    }
  };

  const stop = () => abort?.abort();

  const copy = (i: number, text: string) => {
    // clipboard is unavailable on an insecure origin; say nothing rather than throw
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((n) => (n === i ? -1 : n)), 1400);
    }).catch(() => {});
  };

  /**
   * ↑/↓ through your own past messages, the way a shell does.
   *
   * Entering history needs the caret at the very start, so arrow keys still move around
   * a draft you are editing; once you are in it, they keep stepping. Returns whether it
   * handled the key.
   */
  const recall = (dir: -1 | 1): boolean => {
    const mine = turns.filter((t) => t.role === 'user').map((t) => t.text);
    if (!mine.length) return false;
    const put = (v: string) => {
      setInput(v);
      requestAnimationFrame(() => box.current?.setSelectionRange(v.length, v.length));
    };
    if (recalled === null) {
      if (dir === 1) return false;
      draft.current = input;
      setRecalled(mine.length - 1);
      put(mine[mine.length - 1]);
      return true;
    }
    const next = recalled + dir;
    if (next < 0) return true;                       // already at the oldest — swallow it
    if (next >= mine.length) { setRecalled(null); put(draft.current); return true; }
    setRecalled(next);
    put(mine[next]);
    return true;
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
                {settings.keys.length ? (
                  <>Using your {settings.keys.length} key{settings.keys.length === 1 ? '' : 's'} through the blooby
                    backend. <code>ollama.com</code> sends no CORS headers, so a browser cannot call it directly —
                    the backend makes the hop. Remove every key to fall back to
                    {settings.server?.hasServerKeys ? " this server's own keys." : ' your local Ollama.'}</>
                ) : settings.server?.hasServerKeys ? (
                  <>Running on this server&rsquo;s Ollama Cloud keys — nothing to configure.
                    {acceptsKeys(settings)
                      ? ' Add your own below to use your account instead.'
                      : ' Your own keys are turned off for this deployment.'}</>
                ) : (
                  <>With no keys, requests go to <code>localhost:11434</code> and your local Ollama proxies them
                    using its own sign-in. Add a key below to use your own Ollama Cloud account instead.</>
                )}
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
              <div key={i} className={`msg ${t.role === 'user' ? 'user' : t.role === 'error' ? 'err' : t.role === 'note' ? 'note' : 'bot'}`}>
                <span className="who">{t.role === 'user' ? 'you' : t.role === 'error' ? 'failed' : t.role === 'note' ? 'stopped' : 'copilot'}</span>
                <div className="bubble">{t.text}</div>
                {t.thinking && (
                  <details className="think">
                    <summary>plan</summary>
                    <pre>{t.thinking}</pre>
                  </details>
                )}
                <div className="msg-acts">
                  <button className="btn ghost sm" title="Copy this message" onClick={() => copy(i, t.text)}>
                    {copied === i ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {t.rejected && <p className="hint">Rejected — the copilot has been told not to propose it again.</p>}
                {!!t.calls?.length && !t.rejected && (
                  <div className="proposal" style={{ marginTop: 6 }}>
                    <ul>
                      {t.calls.map((c, n) => <li key={n}>{describe(project, c)} <code>{c.name}</code></li>)}
                    </ul>
                    <div className="acts">
                      {t.done ? <span className="hint">Applied — ⌘Z undoes the whole batch.</span> : (
                        <>
                          <button className="btn sm primary" onClick={() => apply(i)}>Apply {t.calls.length}</button>
                          <button className="btn sm" onClick={() => patchTurn(i, { rejected: true })}>Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="hint working">{PHASE_LABEL[phase as keyof typeof PHASE_LABEL]}</p>}
          </div>
          <textarea ref={box} className="ask" placeholder="Describe the animation you want…" value={input}
            onChange={(e) => { setInput(e.target.value); setRecalled(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { ask(); return; }
              const t = e.currentTarget;
              const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
              const atEnd = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
              if (e.key === 'ArrowUp' && (recalled !== null || atStart) && recall(-1)) e.preventDefault();
              else if (e.key === 'ArrowDown' && recalled !== null && atEnd && recall(1)) e.preventDefault();
              else if (e.key === 'Escape' && recalled !== null) { setRecalled(null); setInput(draft.current); }
            }} />
          <div className="row">
            <span className="hint">⌘↵ to send · ↑ for your last message</span>
            <span className="spacer" />
            <button className="btn sm" disabled={!turns.length || busy} onClick={clear}>Clear</button>
            {busy && phase !== 'applying'
              ? <button className="btn sm" title="Cancel this request" onClick={stop}>Stop</button>
              : <button className="btn primary sm" disabled={busy || !input.trim() || !settings.model} onClick={ask}>Send</button>}
          </div>
        </div>
      </div>
    </>
  );
}

class ValidationError extends Error {}

/**
 * What the model is shown for one of its own past turns.
 *
 * Its reply alone leaves out the part that matters: which changes it actually made. With
 * only the prose it re-proposes what the user already rejected, and describes edits to a
 * timeline it does not know it already made.
 */
function asHistory(t: Turn): string {
  if (t.role !== 'bot' || !t.calls?.length) return t.text;
  const status = t.rejected ? 'the user REJECTED these, do not propose them again'
    : t.done ? 'applied to the timeline'
    : 'proposed, the user has not applied them yet';
  const json = JSON.stringify(t.calls);
  return `${t.text}\n[${status}] ${json.length > 1200 ? t.calls.map((c) => c.name).join(', ') : json}`;
}
