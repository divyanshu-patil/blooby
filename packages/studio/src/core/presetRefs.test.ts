import { it } from 'vitest';
import { check } from './testkit';
import { defaultProject, builtinPresets } from './defaults';
import { packPresets, unpackPresets, packProject, isPresetRef } from './presetRefs';
import { migrateProject, SCHEMA_VERSION } from './migrate';
import type { Preset, StoredPreset } from './types';

/**
 * The built-in library was 92.8% of every stored project — 29.6MB of 31.8MB across 48
 * real ones — and none of it was anyone's work. It is in this build's source, so it goes
 * out as a reference and comes back on load.
 */
{
  const p = defaultProject();
  const packed = packPresets(p.presets);
  it('a fresh project stores no built-in preset by value', check(
    packed.every(isPresetRef), `${packed.filter((x) => !isPresetRef(x)).length} written in full`));

  const whole = JSON.stringify(p).length;
  const small = JSON.stringify(packProject(p)).length;
  it('which is most of the document', check(small < whole * 0.15, `${(whole / 1024) | 0}KB -> ${(small / 1024) | 0}KB`));

  // not id-for-id: a reference expands to freshly minted keyframe ids, which nothing
  // outside this array has ever pointed at (see the note in presetRefs.ts)
  const shape = (v: unknown) => JSON.stringify(v).replace(/"id":"[a-z]+_[0-9a-z]{1,7}"/g, '"id":"·"');
  it('and it comes back the same presets', check(
    shape(unpackPresets(packed)) === shape(p.presets)));
}

/**
 * `builtinPresets()` mints new keyframe and track ids on every call, so a stored preset
 * never equals its source literally. If that were read as "edited" nothing would ever be
 * packed; if ids were ignored too broadly, a real edit would be thrown away.
 */
{
  const a = builtinPresets(), b = builtinPresets();
  it('two calls are never literally equal', check(JSON.stringify(a) !== JSON.stringify(b)));
  it('but each still packs to a reference', check(packPresets(b).every(isPresetRef)));
}

/** The fail-safe direction: anything that is not certainly the built-in is kept whole. */
{
  const lib = builtinPresets();
  const edited = structuredClone(lib);
  edited[3] = { ...edited[3], durationMs: edited[3].durationMs + 1 };
  const renamed = structuredClone(lib);
  renamed[5] = { ...renamed[5], name: 'my version' };
  const mine = { ...structuredClone(lib[0]), id: 'p_mine', source: 'custom' } as Preset;

  const keptTime = packPresets(edited)[3];
  const keptName = packPresets(renamed)[5];
  it('a changed duration is stored in full', check(!isPresetRef(keptTime) && (keptTime as Preset).durationMs === edited[3].durationMs));
  it('a renamed built-in is stored in full', check(!isPresetRef(keptName) && (keptName as Preset).name === 'my version'));
  it('a preset of your own is stored in full', check(
    JSON.stringify(packPresets([mine])[0]) === JSON.stringify(mine)));

  // a keyframe value changed deep inside, the most likely real edit
  const deep = structuredClone(lib);
  const track = deep.find((x) => x.tracks[0]?.keyframes[0])!;
  const ti = deep.indexOf(track);
  deep[ti].tracks[0].keyframes[0].time += 7;
  it('a moved keyframe is stored in full', check(!isPresetRef(packPresets(deep)[ti])));
}

/** Order is the picker's order, and a reference holds its place in it. */
{
  const lib = builtinPresets();
  const mixed: Preset[] = [lib[0], { ...structuredClone(lib[1]), id: 'p_mine', source: 'custom' } as Preset, lib[2]];
  const back = unpackPresets(packPresets(mixed));
  it('a custom preset keeps its position between two built-ins', check(
    back.map((x) => x.id).join() === `${lib[0].id},p_mine,${lib[2].id}`, back.map((x) => x.id).join()));
}

/**
 * Loading is the part that must never regress: a packed document arrives already AT the
 * current version, so it skips every migration step. Unpacking cannot be a step.
 */
{
  const p = defaultProject();
  const onDisk = JSON.parse(JSON.stringify(packProject(p)));
  it('a packed document is stored at the current schema', check(onDisk.schemaVersion === SCHEMA_VERSION));
  const { project: back, applied } = migrateProject(onDisk);
  it('and still loads with every preset whole', check(
    back.presets.length === p.presets.length && back.presets.every((x) => Array.isArray(x.tracks)),
    `${back.presets.length} vs ${p.presets.length}`));
  it('running no migration steps at all', check(applied.length === 0, applied.join()));
  const same = (v: unknown) => JSON.stringify(v).replace(/"id":"[a-z]+_[0-9a-z]{1,7}"/g, '"id":"·"');
  it('the library is the real thing, not stubs', check(
    same(back.presets) === same(p.presets)));
}

/** An older document has whole presets and must be untouched by any of this. */
{
  const old = { schemaVersion: 12, presets: [{ id: 'p_ancient', name: 'Ancient', source: 'user', durationMs: 500, tracks: [] }] } as unknown as Parameters<typeof migrateProject>[0];
  const { project } = migrateProject(old);
  it('an unknown preset from an old file survives', check(
    project.presets.some((x) => x.id === 'p_ancient'), project.presets.length + ' presets'));
}

/** A reference to something this build dropped must not become half a preset. */
{
  const ghost: StoredPreset[] = [{ id: 'p_no_longer_shipped', builtin: true }];
  const back = unpackPresets(ghost);
  it('a reference to a preset this build no longer has is dropped, not left as a stub', check(back.length === 0));
}
