import { makeTimeline } from './defaults';
import { showcasePresets } from './showcase';
import { slug } from './stateMachine';
import type { Block, Modifier, Project, Track } from './types';

/**
 * Every project ever saved, brought up to the current shape on load.
 *
 * A project is a document that lives in five places — localStorage, the IndexedDB
 * gallery, a `.blooby.json` a user downloaded a year ago, a row in the cloud, and the
 * community catalogue — and only the first two are ever rewritten by us. So "just change
 * the type and fix the writers" is never available: something out there is still the old
 * shape, and it has to keep opening.
 *
 * The rule is one numbered step per shape change, appended and never edited afterwards.
 * A step only ever runs on documents older than itself, so an edit to an existing step
 * changes history for files already migrated past it — which is how a migration chain
 * usually breaks. See ADDING A MIGRATION at the bottom.
 *
 * A step may assume NOTHING about the document it is handed. `defaultProject()` is merged
 * over the result afterwards, not before, so the fields it would have supplied are not
 * there yet — and the cloud path seeds a brand new project as a bare `{}`. Optional-chain
 * every read.
 */

/** Bump this with every new entry in MIGRATIONS. `defaultProject()` stamps it. */
export const SCHEMA_VERSION = 4;

interface Migration {
  /** the version this step produces */
  to: number;
  /** shown in the console when it runs, so an upgrade is never silent */
  label: string;
  /** mutates `p` in place; must be safe to run on any document older than `to` */
  run: (p: Project) => void;
}

/**
 * Anything written before versioning existed. Detected by the absence of the field
 * rather than by inspecting the shape — a v0 document is simply one that never said.
 */
const versionOf = (p: Project): number => {
  const v = (p as { schemaVersion?: unknown }).schemaVersion;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

const MIGRATIONS: Migration[] = [
  {
    to: 1,
    label: 'flat timeline → timelines[]',
    /**
     * Before Stage 3 a project had ONE animation, so `tracks`/`blocks`/`modifiers` sat at
     * the top level. Lift them into a single timeline named Idle.
     */
    run(p) {
      if (Array.isArray(p.timelines) && p.timelines.length) return;
      const legacy = p as unknown as {
        tracks?: Track[]; blocks?: Block[]; modifiers?: Modifier[];
        durationMode?: 'custom' | 'even'; timelineDurationMs?: number; loop?: boolean;
      };
      const tl = makeTimeline('Idle');
      if (legacy.tracks) tl.tracks = legacy.tracks;
      if (legacy.blocks) tl.blocks = legacy.blocks;
      if (legacy.modifiers) tl.modifiers = legacy.modifiers;
      if (legacy.durationMode) tl.durationMode = legacy.durationMode;
      if (legacy.timelineDurationMs) tl.timelineDurationMs = legacy.timelineDurationMs;
      if (legacy.loop) tl.loop = legacy.loop;
      p.timelines = [tl];
      p.activeTimelineId = tl.id;
    },
  },
  {
    to: 2,
    label: 'state machine',
    /**
     * Timelines were always exported as states, but the machine that connected them was
     * derived at export time — every state chained to the next by an `OnComplete` event,
     * with no inputs and nothing the app could steer. Now the machine is part of the
     * document, so an old project needs one written down.
     *
     * It is deliberately EMPTY of transitions rather than a reconstruction of that chain.
     * The chain was never verified to advance in a real player (see ASSUMPTIONS.md), so
     * rebuilding it would migrate a bug forward and make it look intentional. An empty
     * machine is honest, opens, exports, and the editor's own validation says exactly
     * what is missing: "No transitions yet — the machine will stay in its initial state."
     *
     * The id and initial state are PINNED here rather than left to `machineOf()`'s
     * fallback. That fallback derives the id from the project name, so renaming a project
     * after shipping would silently change the id the app calls `stateMachineLoad()` with.
     * Deriving it from the name HERE preserves whatever id that project was already
     * exporting under, which is the point — a new project gets a fixed one instead
     * (`defaultProject()`), because it has nothing to preserve.
     *
     * `p.name` may be absent. Steps run before `defaultProject()` is merged over the
     * document, so nothing here may assume a field exists — the cloud path seeds a brand
     * new project as a bare `{}`.
     */
    run(p) {
      if (p.stateMachine) return;
      p.stateMachine = {
        id: slug(p.name) || 'blooby',
        initialStateId: p.timelines?.[0]?.id,
        inputs: [],
        transitions: [],
      };
    },
  },
  {
    to: 3,
    label: 'freeform layers',
    /**
     * Two things, both about keeping an old project looking exactly as it did.
     *
     * The composition is written down. Every project before this rendered at 720×720
     * because nothing could say otherwise; pinning it means a later change to the default
     * cannot quietly reframe a file that never chose a size.
     *
     * A mapped layer's `flatOffset` is dropped. The renderer used to ignore it on anything
     * placed on the sphere — the help text promised a nudge that never happened — and it
     * is now applied, as the attachment offset. A value sitting there from before would
     * suddenly move a feature that has never moved, so it goes: static value and tracks
     * alike, on the rig and in presets. What was drawn is unchanged, which is the rule.
     *
     * Everything else new (fill, stroke, opacity, appearance, attachment, limbs) is
     * optional with a default that reads as "what it always was", so it needs no step.
     */
    run(p) {
      if (!p.composition) p.composition = { width: 720, height: 720 };
      const mapped = new Set<string>();
      for (const n of Object.values(p.rig?.nodes ?? {})) {
        if (!n?.surface?.mapped) continue;
        mapped.add(n.id);
        delete n.surface.flatOffset;
      }
      if (!mapped.size) return;
      const stale = (t: Track) => mapped.has(t?.nodeId) && (t.property === 'flatOffset.x' || t.property === 'flatOffset.y');
      for (const tl of p.timelines ?? []) if (Array.isArray(tl?.tracks)) tl.tracks = tl.tracks.filter((t) => !stale(t));
      for (const pr of p.presets ?? []) if (Array.isArray(pr?.tracks)) pr.tracks = pr.tracks.filter((t) => !stale(t));
    },
  },
  {
    to: 4,
    label: 'showcase presets',
    /**
     * The preset library is saved INSIDE the project, so a project from before the
     * showcase presets existed never shows them — the autosaved one a user reopens every
     * day least of all. Add the ones it lacks, first in the library as in a new project.
     *
     * A step, not a merge on every load: it runs once per document, so a showcase preset
     * the user deletes afterwards stays deleted. A document without a preset list is left
     * alone — `defaultProject()` is merged over it and brings the full library.
     */
    run(p) {
      if (!Array.isArray(p.presets)) return;
      const have = new Set(p.presets.map((x) => x?.id));
      p.presets = [...showcasePresets().filter((x) => !have.has(x.id)), ...p.presets];
    },
  },
];

export interface MigrationResult {
  project: Project;
  /** the version it arrived as — 0 for anything saved before versioning */
  from: number;
  /** labels of the steps that actually ran, oldest first */
  applied: string[];
  /** set when the file came from a NEWER build than this one */
  fromFuture?: boolean;
}

/**
 * Bring a project up to `SCHEMA_VERSION`, reporting what it had to do.
 *
 * Safe to call on an already-current document (every step is skipped) and on one from a
 * newer build (nothing runs — see below), so every load path can route through it
 * unconditionally rather than guessing whether a given source needs it.
 */
export function migrateProject(raw: Project): MigrationResult {
  const project = raw;
  const from = versionOf(project);

  // A file from a newer build: its extra fields are unknown to us, and running old steps
  // over them could only damage it. Opening read-only-ish beats refusing outright — the
  // parts this build understands still work, and nothing is silently rewritten.
  if (from > SCHEMA_VERSION) {
    return { project, from, applied: [], fromFuture: true };
  }

  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.to <= from) continue;
    m.run(project);
    applied.push(m.label);
  }
  (project as { schemaVersion?: number }).schemaVersion = SCHEMA_VERSION;
  return { project, from, applied };
}

/**
 * ADDING A MIGRATION
 *
 *   1. Make the new field OPTIONAL in `types.ts`, always. A required field would make
 *      every older document fail to typecheck at the boundary, and the boundary is the
 *      one place that has to accept them.
 *   2. Append one entry here: `{ to: SCHEMA_VERSION + 1, label, run }`. Never renumber or
 *      edit an existing entry — documents already past it will never run it again, so an
 *      edit only changes what happens to files that have not been opened yet.
 *   3. Bump `SCHEMA_VERSION`.
 *   4. `run` must be idempotent, must not assume anything a previous step added is present
 *      in a shape older than that step, and must not assume ANY field exists — `{}` is a
 *      real input on the cloud-create path, and defaults are merged after, not before.
 *      Optional-chain every read; `migrate.test.ts` runs every partial shape through.
 *   5. Add a case to `migrate.test.ts` with a literal old document. Not one built by
 *      `defaultProject()` and then broken: the point of the fixture is to be a shape this
 *      build can no longer produce.
 */
