import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';

export const supabase = createClient(url, key);

export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  isAdmin: boolean;
  animationCount: number;
}

export interface AnimationRow {
  id: string;
  name: string;
  projectJson: unknown;
  thumbnailUrl: string | null;
  updatedAt: string;
}

/** Every admin call carries the Supabase access token; apps/api verifies it against the
 *  project's JWKS and then checks profiles.is_admin before doing anything. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not signed in');

  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json() as Promise<T>;
}

export const listUsers = () => call<AdminUser[]>('/api/admin/users');
export const listAnimations = (userId: string) => call<AnimationRow[]>(`/api/admin/users/${userId}/animations`);
export const publishPreset = (body: unknown) =>
  call('/api/admin/presets', { method: 'POST', body: JSON.stringify(body) });
