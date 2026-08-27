import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Expression, Preset } from './types';

/**
 * The Supabase client, or null when this build has no backend configured at all.
 *
 * Reads of the shared library go straight from the browser to Postgres under RLS
 * (`assets` is anon-readable where `status = 'published'`), so there is no privilege to
 * borrow and therefore no reason to hop through apps/api for them. Only the operations
 * that genuinely need the service-role key — listing auth.users, publishing official
 * content — live behind Express.
 *
 * The publishable key is the only key that ever reaches a browser bundle.
 */
// optional-chained because selfcheck.ts bundles this file and runs it under plain Node,
// where there is no import.meta.env at all — no backend there is the correct answer
const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Whether this build talks to a backend at all. False = the bundled builtins are it. */
export const hasBackend = supabase !== null;

interface AssetRow {
  id: string; kind: 'preset' | 'expression'; source: string; name: string;
  data: unknown; published_at: string | null; download_count: number | null;
}

/**
 * Published presets AND expressions from the shared library.
 *
 * Reads `assets`, which is the one table behind built-in, official, user and community
 * content alike — the legacy `presets` table this used to query was superseded, which is
 * exactly why admin-published content stopped showing up in the editor.
 *
 * With no backend configured this resolves empty and the editor runs on the builtins
 * already baked into `defaultProject()` — the offline path. With a backend configured a
 * failure is NOT swallowed into that same fallback: the caller surfaces it, because a
 * library that silently looks like the builtins is a worse failure than an explicit error.
 */
export async function fetchCatalog(): Promise<{ presets: Preset[]; expressions: Expression[] }> {
  if (!supabase) return { presets: [], expressions: [] };

  const { data, error } = await supabase
    .from('assets')
    .select('id, kind, source, name, data, published_at, download_count')
    .eq('status', 'published')
    // builtins are already bundled into defaultProject(), and the seeded copies carry
    // different ids, so including them here shows every one twice. They stay in the
    // table for the API-backed Library browse, which has no bundled copy to fall back on.
    .neq('source', 'builtin')
    .order('published_at', { ascending: true });
  if (error) throw new Error(error.message);

  const presets: Preset[] = [];
  const expressions: Expression[] = [];

  for (const row of (data ?? []) as AssetRow[]) {
    // `data` is the editor's own payload; the row's columns are the catalogue metadata
    // around it. Trust the row for identity and provenance, not the embedded copy.
    const payload = (row.data ?? {}) as Record<string, unknown>;
    if (row.kind === 'preset') {
      if (!Array.isArray(payload.tracks)) continue;      // unusable without tracks
      presets.push({
        ...(payload as unknown as Preset),
        id: row.id,
        name: row.name,
        source: row.source === 'builtin' || row.source === 'official' || row.source === 'community' ? row.source : 'custom',
        publishedAt: row.published_at ?? undefined,
        uses: row.download_count ?? 0,
      });
    } else {
      if (!payload.snapshot || typeof payload.snapshot !== 'object') continue;
      expressions.push({ ...(payload as unknown as Expression), id: row.id, name: row.name });
    }
  }

  return { presets, expressions };
}
