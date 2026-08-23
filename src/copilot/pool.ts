export type KeyStatus = 'ok' | 'rate-limited' | 'error';
export interface PoolKey { id: string; value: string; status: KeyStatus; note?: string; usedAt?: number }
export type Endpoint = 'local' | 'cloud' | 'custom';

export interface CopilotSettings {
  endpoint: Endpoint;
  customUrl: string;
  model: string;
  keys: PoolKey[];
}

const KEY = 'blooby.copilot.v1';

export const DEFAULT_SETTINGS: CopilotSettings = {
  endpoint: 'local',
  customUrl: '',
  model: '',
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

export function baseUrl(s: CopilotSettings): string {
  if (s.endpoint === 'local') return 'http://localhost:11434';
  if (s.endpoint === 'cloud') return 'https://ollama.com';
  return s.customUrl.replace(/\/+$/, '');
}

export const needsKey = (s: CopilotSettings) => s.endpoint !== 'local';

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
