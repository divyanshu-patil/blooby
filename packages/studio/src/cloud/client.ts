import { supabase } from '../core/catalog';

/**
 * The single HTTP door to apps/api. Every feature module calls through here rather than
 * reaching for fetch, so token attachment, error shape and base URL are decided once.
 */
const base = (import.meta.env?.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };

  // most routes need the caller's identity; the public ones (splashscreen, browse) work
  // either way, and send it when there is one so the server can widen what it returns
  if (init?.auth !== false && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }

  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // the server already writes user-facing messages and never includes internal detail
    // (see middlewares/errorHandler), so passing them through keeps one voice
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.code, body.details);
  }
  return body as T;
}

const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const q = s.toString();
  return q ? `?${q}` : '';
};

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>, opts?: { auth?: boolean }) =>
    request<T>(`${path}${params ? qs(params) : ''}`, { method: 'GET', ...opts }),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), ...opts }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
