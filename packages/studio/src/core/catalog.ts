import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Preset } from './types';

/**
 * The Supabase client, or null when this build has no backend configured at all.
 *
 * Reads of the preset catalogue go straight from the browser to Postgres under RLS
 * (`presets` is anon-readable where `published = true`), so there is no privilege to
 * borrow and therefore no reason to hop through apps/api for them. Only the operations
 * that genuinely need the service-role key — listing auth.users, publishing a preset —
 * live behind Express.
 *
 * The publishable key is the only key that ever reaches a browser bundle. The secret key
 * belongs to apps/api and must never be imported from here.
 */
// optional-chained because selfcheck.ts bundles this file and runs it under plain Node,
// where there is no import.meta.env at all — no backend there is the correct answer
const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Whether this build talks to a backend at all. False = the bundled builtins are it. */
export const hasBackend = supabase !== null;

/**
 * Published presets from the shared library.
 *
 * With no backend configured this resolves empty and the editor simply runs on the
 * builtins already baked into `defaultProject()` — the offline/dev path. With a backend
 * configured a failure is *not* swallowed into that same fallback: the caller surfaces it,
 * because "the library silently looks like the 2019 builtins" is a much worse failure
 * than an explicit error.
 */
export async function fetchCatalog(): Promise<Preset[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('presets')
    .select('preset_json')
    .eq('published', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.preset_json as Preset);
}
