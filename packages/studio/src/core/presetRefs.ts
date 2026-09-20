import { builtinPresets } from './defaults';
import type { Preset, PresetRef, StoredPreset } from './types';

/**
 * Built-in presets are stored as a reference, not a copy.
 *
 * `defaultProject()` puts the whole built-in library into `Project.presets`, and it was
 * being written out with every save: measured across 48 real projects, presets were
 * **92.8% of all stored bytes** — 29.6MB of 31.8MB, about 1.19MB of a 1.26MB document.
 * Every autosave shipped that from the browser to the API to S3, and every open pulled it
 * back, to move ~49KB of actual animation. None of it was the user's: it is in this
 * build's source.
 *
 * So a preset that still matches the library goes out as `{ id, builtin: true }` and is
 * expanded again on load. Anything the user made, and anything that no longer matches —
 * an older project holding the library as it was the day it was made — is written out in
 * full, exactly as it is.
 *
 * The comparison is deliberately **fail-safe**: "not certain it matches" means store the
 * whole thing. A false mismatch costs bytes; a false match would lose someone's edit.
 */

/**
 * The output of `uid()` — a short prefix, an underscore, up to seven base-36 characters.
 *
 * `builtinPresets()` mints fresh keyframe and track ids on every call, so two calls are
 * never equal as JSON and a stored preset never matches its source literally. Those ids
 * are identity, not content: what a preset *is* is its times, values, layers and names.
 * Blanking them is what makes the comparison mean "same preset". A stable id the rig
 * relies on — `body`, `eyeL`, `face` — has no underscore and is left alone, so a preset
 * pointing at a different layer still reads as different.
 */
const GENERATED_ID = /^[a-z]+_[0-9a-z]{1,7}$/;

/** A preset as content: every generated id blanked, key order made irrelevant. */
function signature(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (!v || typeof v !== 'object') return v;
    // sorted, so a field written in a different order is not read as an edit
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, k === 'id' && typeof x === 'string' && GENERATED_ID.test(x) ? '·' : norm(x)]),
    );
  };
  return JSON.stringify(norm(value));
}

/** id → signature for this build's library. Built once; `builtinPresets()` is not cheap. */
let cache: Map<string, string> | undefined;
const signatures = () => (cache ??= new Map(builtinPresets().map((p) => [p.id, signature(p)])));

export const isPresetRef = (p: StoredPreset): p is PresetRef =>
  !!p && (p as PresetRef).builtin === true && !Array.isArray((p as Preset).tracks);

/** What goes to disk: a reference where the library still has an identical preset. */
export function packPresets(presets: Preset[]): StoredPreset[] {
  const known = signatures();
  return presets.map((p) => {
    const mine = known.get(p.id);
    return mine && mine === signature(p) ? { id: p.id, builtin: true as const } : p;
  });
}

/**
 * What comes back. A reference to a preset this build no longer has is dropped rather
 * than left as a stub — `ui/Presets.tsx` already falls back to the catalogue for an id the
 * project does not carry, and half a preset in the picker is worse than none.
 */
export function unpackPresets(stored: StoredPreset[]): Preset[] {
  const lib = new Map(builtinPresets().map((p) => [p.id, p]));
  const out: Preset[] = [];
  for (const p of stored) {
    if (!isPresetRef(p)) { if (p) out.push(p as Preset); continue; }
    const real = lib.get(p.id);
    if (real) out.push(real);
  }
  return out;
}

/**
 * Note what a round trip does NOT preserve: a reference expands to a preset with freshly
 * minted keyframe and track ids, because that is what `builtinPresets()` hands back and
 * the old ones were never written down. That is harmless — `appendPreset` mints its own
 * `uid('t')`/`uid('k')` for everything it places, and a Block only ever refers to a preset
 * by `presetId`, so nothing outside this array has ever pointed at those ids.
 */

/** Only for tests: `builtinPresets()` is memoised above, and a test may want it rebuilt. */
export const resetPresetSignatures = () => { cache = undefined; };

/**
 * A project ready to be written down — to the cloud, to localStorage, to a file.
 *
 * Every place that serialises a Project goes through this, so the three of them cannot
 * drift into storing different things. It is a shallow copy: the store's object is never
 * touched, because the app keeps running on it.
 */
export function packProject<T extends { presets: Preset[] }>(project: T): T {
  return { ...project, presets: packPresets(project.presets ?? []) as unknown as Preset[] };
}
