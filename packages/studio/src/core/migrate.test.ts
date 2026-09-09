import { it } from 'vitest';
import { check } from './testkit';
import { migrateProject, SCHEMA_VERSION } from './migrate';
import { defaultProject } from './defaults';
import { machineOf, validateMachine } from './stateMachine';
import { buildDotLottie } from '../export/dotlottie';
import { unzip } from '../export/zip';
import type { Project } from './types';

/**
 * Fixtures here are written out by hand, never built from `defaultProject()` and then
 * broken. That shortcut is what made the original legacy test vacuous: `defaultProject()`
 * now stamps the current `schemaVersion`, so a fixture derived from it claimed to be
 * up to date, every migration was skipped, and the assertions passed against the default
 * project rather than the migrated one. A fixture has to be a shape this build can no
 * longer produce, or it is not testing a migration.
 */

/** v0: one flat animation, before timelines[] and before versioning. */
const v0Flat = () => JSON.parse(JSON.stringify({
  name: 'Old Mascot',
  rig: defaultProject().rig,
  expressions: [], presets: [], fps: 30,
  tracks: [{ id: 'tr1', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'k1', time: 0, value: 0, easingOut: { type: 'linear' } },
    { id: 'k2', time: 500, value: 15, easingOut: { type: 'linear' } },
  ] }],
  blocks: [{ id: 'b1', presetId: 'p_idle', name: 'Idle', durationMs: 900 }],
  modifiers: [{ id: 'm1', nodeId: 'body', kind: 'float', amount: 100, frequency: 0.6, amplitude: 8 }],
  durationMode: 'custom',
  timelineDurationMs: 900,
  loop: true,
})) as unknown as Project;

/** v1: timelines exist, but the state machine was still derived at export time. */
const v1Timelines = () => JSON.parse(JSON.stringify({
  name: 'Two State Mascot',
  rig: defaultProject().rig,
  expressions: [], presets: [], fps: 30,
  timelines: [
    { id: 'tl_a', name: 'watching', tracks: [], modifiers: [], blocks: [],
      durationMode: 'custom', timelineDurationMs: 1000, loop: false, transitionMs: 450 },
    { id: 'tl_b', name: 'observing', tracks: [], modifiers: [], blocks: [],
      durationMode: 'custom', timelineDurationMs: 800, loop: true },
  ],
  activeTimelineId: 'tl_b',
})) as unknown as Project;

// --- v0 → current --------------------------------------------------------------
{
  const { project, from, applied } = migrateProject(v0Flat());
  it('an unversioned document is recognised as v0', check(from === 0, String(from)));
  it('and both steps run on it', check(applied.length === 2, applied.join(', ')));
  it('it comes out stamped at the current version', check(project.schemaVersion === SCHEMA_VERSION));

  it('the flat animation became exactly one timeline', check(project.timelines.length === 1));
  it('its keyframes came with it', check(project.timelines[0].tracks[0].keyframes.length === 2));
  it('its blocks came with it', check(project.timelines[0].blocks.length === 1));
  it('its effects came with it', check(project.timelines[0].modifiers.length === 1));
  it('its loop flag came with it', check(project.timelines[0].loop === true));
  it('its duration came with it', check(project.timelines[0].timelineDurationMs === 900));
  it('and something is active', check(project.activeTimelineId === project.timelines[0].id));

  const m = machineOf(project);
  it('a state machine was written down', check(!!project.stateMachine));
  it('its id is derived from the project name', check(m.id === 'old-mascot', m.id));
  it('it starts in the only state there is', check(m.initialStateId === project.timelines[0].id));
  it('with no invented inputs', check(m.inputs.length === 0));
  it('and no invented transitions', check(m.transitions.length === 0));
  it('a migrated project has no validation errors', check(
    validateMachine(project).filter((i) => i.level === 'error').length === 0,
    JSON.stringify(validateMachine(project))));
}

// --- v1 → current --------------------------------------------------------------
{
  const { project, from, applied } = migrateProject(v1Timelines());
  it('a v1-shaped document is also v0 to us, since it never said', check(from === 0));
  it('but the timelines step is a no-op on it', check(
    project.timelines.length === 2 && project.timelines[0].name === 'watching'));
  it('the state machine step still runs', check(applied.includes('state machine')));

  const m = machineOf(project);
  it('every existing state is preserved', check(
    project.timelines.map((t) => t.name).join() === 'watching,observing'));
  it('an authored per-state blend is preserved', check(project.timelines[0].transitionMs === 450));
  it('a looping state stays looping', check(project.timelines[1].loop === true));
  it('the machine starts at the FIRST state, not whichever was last open', check(
    m.initialStateId === 'tl_a', String(m.initialStateId)));
  it('and the editor’s own active timeline is left alone', check(project.activeTimelineId === 'tl_b'));
}

// --- idempotence and the future ------------------------------------------------
{
  const once = migrateProject(v0Flat()).project;
  const twice = migrateProject(JSON.parse(JSON.stringify(once)) as Project);
  it('a migrated project reports the current version on reload', check(twice.from === SCHEMA_VERSION, String(twice.from)));
  it('so no step runs a second time', check(twice.applied.length === 0, twice.applied.join()));
  it('and the document is byte-identical after a second pass', check(
    JSON.stringify(twice.project) === JSON.stringify(once)));
  it('keeping its own machine id rather than re-deriving it', check(
    machineOf(twice.project).id === 'old-mascot'));

  // a machine the user then edited must survive a reload untouched
  const edited = JSON.parse(JSON.stringify(once)) as Project;
  edited.stateMachine = { id: 'kept', initialStateId: edited.timelines[0].id, inputs: [{ name: 'isTyping', type: 'Boolean', value: false }], transitions: [] };
  const reloaded = migrateProject(edited).project;
  it('an existing machine is never overwritten by the migration', check(
    machineOf(reloaded).id === 'kept' && machineOf(reloaded).inputs.length === 1));

  const future = { ...defaultProject(), schemaVersion: SCHEMA_VERSION + 5 } as Project;
  const res = migrateProject(future);
  it('a file from a newer build is flagged, not mangled', check(res.fromFuture === true));
  it('and no step is run over it', check(res.applied.length === 0));
  it('and its version stamp is left as it was', check(res.project.schemaVersion === SCHEMA_VERSION + 5));
}

// --- the point of all this: an old project exports on the new exporter ----------
{
  const project = migrateProject(v1Timelines()).project;
  const { blob, animations } = buildDotLottie(project, { background: null });
  const files = await unzip(new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const machine = JSON.parse(new TextDecoder().decode(files.get('s/two-state-mascot.json')!));

  it('a pre-state-machine project still exports a .lottie', check(files.has('manifest.json')));
  // both old timelines become segments of ONE composition, which is what lets a Tweened
  // transition morph between them at all — see export/strip.ts
  it('with its timelines merged into one composition', check(animations.length === 1, animations.join()));
  it('and both states pointing into it by marker name', check(
    machine.states.every((s: { animation: string; segment: unknown }) =>
      s.animation === animations[0] && typeof s.segment === 'string'),
    JSON.stringify(machine.states.map((s: { segment: unknown }) => s.segment))));
  it('and a real state machine file', check(!!machine.states, [...files.keys()].join()));
  it('whose states are the old timelines', check(
    machine.states.map((s: { name: string }) => s.name).join() === 'watching,observing'));
  it('starting where the migration said', check(machine.initial === 'watching'));
  it('with no fabricated auto-advance edges', check(
    machine.states.every((s: { transitions: unknown[] }) => s.transitions.length === 0)));
  it('and no leftover OnComplete interactions from the old exporter', check(
    !JSON.stringify(machine).includes('OnComplete')));
}

// --- a partial document, which is what the cloud path actually hands us ----------
/**
 * A brand-new cloud project is seeded server-side as a bare `{}` — the API's
 * `create()` does `dto.project ?? {}` — and migrations run BEFORE `defaultProject()` is
 * merged over the top. So a step reading `p.name` gets undefined, and the editor threw
 * "Cannot read properties of undefined (reading 'toLowerCase')" on every new project.
 *
 * Every field is fair game to be missing, so every field gets tried.
 */
{
  const survives = (seed: object) => {
    const p = { ...defaultProject(), ...migrateProject(structuredClone(seed) as Project).project };
    validateMachine(p);
    buildDotLottie(p, { background: null });
    return p;
  };

  it('an empty object migrates, opens and exports', check(!!survives({})));
  it('and comes out with the default name and a state to be in', check(
    survives({}).timelines.length === 1 && !!survives({}).name));
  it('a machine id falls back rather than throwing on a nameless project', check(
    machineOf(survives({})).id === 'blooby', machineOf(survives({})).id));
  it('a name with no timelines is fine', check(survives({ name: 'Mine' }).timelines.length === 1));
  it('an empty timelines array is fine', check(survives({ timelines: [] }).timelines.length === 1));
  it('and the name still drives the id when there IS one', check(
    machineOf(survives({ name: 'Mine' })).id === 'mine'));

  // whichever field goes missing, nothing on the open path may throw
  const full = defaultProject() as unknown as Record<string, unknown>;
  const broke = Object.keys(full).filter((key) => {
    const seed = structuredClone(full);
    delete seed[key];
    try { survives(seed); return false; } catch { return true; }
  });
  it('no single missing top-level field breaks opening a project', check(!broke.length, broke.join(', ')));
}
