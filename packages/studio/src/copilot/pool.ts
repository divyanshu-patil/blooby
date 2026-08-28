export type KeyStatus = 'ok' | 'rate-limited' | 'error';
export interface PoolKey { id: string; value: string; status: KeyStatus; note?: string; usedAt?: number }
export type Endpoint = 'local' | 'cloud' | 'custom';

/** Where a tier's requests actually go, and why. */
export const ENDPOINT_INFO: Record<Endpoint, { label: string; hint: string }> = {
  local: {
    label: 'Local',
    hint: 'Models installed on this machine, served by Ollama on port 11434.',
  },
  cloud: {
    label: 'Ollama Cloud',
    hint: 'Big models run on Ollama\u2019s hardware. Add your own API keys below and requests go through the blooby backend, rotating across them. With no keys, it falls back to your local Ollama\u2019s sign-in \u2014 run `ollama signin` once.',
  },
  custom: {
    label: 'Custom',
    hint: 'Any Ollama-compatible base URL. Use this for a proxy in front of ollama.com, or a remote Ollama.',
  },
};

export interface CopilotSettings {
  endpoint: Endpoint;
  customUrl: string;
  model: string;
  keys: PoolKey[];
}

const KEY = 'blooby.copilot.v1';

/** Solid at structured output and available to every signed-in account. */
export const DEFAULT_CLOUD_MODEL = 'gpt-oss:120b';

export const DEFAULT_SETTINGS: CopilotSettings = {
  // cloud by default: it is the tier most likely to have a model good enough to be
  // useful here, and it needs one `ollama signin` rather than a multi-gigabyte pull
  endpoint: 'cloud',
  customUrl: '',
  model: DEFAULT_CLOUD_MODEL,
  keys: [],
};

export function loadSettings(): CopilotSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* corrupt or blocked storage — start clean */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: CopilotSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export const LOCAL_URL = 'http://localhost:11434';
export const OLLAMA_CLOUD_URL = 'https://ollama.com';

/**
 * Ollama Cloud goes through the *local* daemon, not straight to ollama.com.
 *
 * ollama.com serves no `Access-Control-Allow-Origin` and answers preflights with 405,
 * so a browser can never call it directly — checked against /api/tags, /api/chat and
 * the OpenAI-compatible /v1 routes. The local daemon, on the other hand, sends proper
 * CORS headers (including Authorization) and proxies any `-cloud` model to Ollama Cloud
 * using the sign-in it already holds. So the cloud tier keeps the browser talking to
 * localhost and lets Ollama do the authenticated hop.
 */
export function baseUrl(s: CopilotSettings): string {
  if (s.endpoint === 'custom') return s.customUrl.replace(/\/+$/, '');
  return LOCAL_URL;
}

/**
 * The cloud tier has two ways to work, and which one applies is decided by whether you
 * have added keys:
 *
 *  - keys added   -> the request goes to blooby's own backend, which holds no CORS
 *                    restriction against ollama.com and rotates across your keys.
 *  - no keys      -> the local daemon proxies to Ollama Cloud with its own sign-in,
 *                    which is the only way a pure browser can reach it at all.
 *
 * A browser can never send your keys straight to ollama.com; that is a CORS fact, not a
 * design choice, which is why "use my own keys" and "go through the backend" are the
 * same switch.
 */
export const usesBackend = (s: CopilotSettings) => s.endpoint === 'cloud' && s.keys.length > 0;

/** A custom endpoint always needs a key; cloud needs one only when routing via backend. */
export const needsKey = (s: CopilotSettings) => s.endpoint === 'custom' || usesBackend(s);

/** Which tiers can hold a key pool at all — what the settings UI gates on. Distinct from
 *  needsKey, which asks whether a key is *required* for the request about to be sent;
 *  gating the editor on that would hide the field you need to add your first key. */
export const acceptsKeys = (s: CopilotSettings) => s.endpoint === 'custom' || s.endpoint === 'cloud';

/**
 * How a cloud model has to be addressed, which depends on HOW the request gets there.
 *
 * Through the local daemon it is a proxy instruction: the cloud marker rides on the TAG,
 * the part after the colon. A tagged model takes it as a tag suffix
 * (`gpt-oss:120b` -> `gpt-oss:120b-cloud`), an untagged one has no tag to suffix and
 * takes the marker AS the tag (`glm-5.2` -> `glm-5.2:cloud`). Blindly appending `-cloud`
 * produced `glm-5.2-cloud`, which names a model that does not exist, and the daemon
 * answered 404.
 *
 * Straight to ollama.com — which is what routing through the backend does — there is no
 * proxy to instruct and the marker is wrong entirely: the plain name is the model.
 */
export function resolveModel(s: CopilotSettings, model: string): string {
  if (s.endpoint !== 'cloud' || !model) return model;
  if (usesBackend(s)) return stripCloudSuffix(model);
  if (model.endsWith('-cloud') || model.endsWith(':cloud')) return model;
  return model.includes(':') ? `${model}-cloud` : `${model}:cloud`;
}

/** The inverse — what the model is called upstream, with any local proxy marker removed. */
export const stripCloudSuffix = (m: string) => m.replace(/-cloud$/, '').replace(/:cloud$/, '');

export const displayModel = (m: string) => stripCloudSuffix(m);

/**
 * Fallback catalogue, used because the live list at ollama.com/api/tags is CORS-blocked
 * from a browser. Ollama's cloud line-up moves, so treat this as a starting point: any
 * model name typed into the picker is passed straight through, and any `-cloud` model
 * already pulled locally is merged in ahead of this list.
 */
export const CLOUD_CATALOGUE = [
  'deepseek-v4-flash:0731',
  'deepseek-v4-pro:0813',
  'gemma4:31b',
  'glm-5.2',
  'gpt-oss:20b',
  'gpt-oss:120b',
  'kimi-k2.7-code',
  'kimi-k3',
  'minimax-m3',
  'mistral-large-3:675b',
  'nemotron-3-nano:30b',
  'nemotron-3-super',
  'nemotron-3-ultra',
  'qwen3.5:397b',
];

/** Healthy keys first, then rate-limited ones, so a cooled-off key gets another go. */
export function rotation(s: CopilotSettings): (string | null)[] {
  if (!needsKey(s)) return [null];
  if (!s.keys.length) return [null];
  const rank = { ok: 0, 'rate-limited': 1, error: 2 } as const;
  return [...s.keys]
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.usedAt ?? 0) - (b.usedAt ?? 0))
    .map((k) => k.value);
}

export const maskKey = (v: string) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-4)}`);
