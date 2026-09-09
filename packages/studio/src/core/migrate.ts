import { makeTimeline } from './defaults';
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
 */

/** Bump this with every new entry in MIGRATIONS. `defaultProject()` stamps it. */
export const SCHEMA_VERSION = 2;

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
     */
    run(p) {
      if (p.stateMachine) return;
      p.stateMachine = {
        id: slug(p.name) || 'blooby',
        initialStateId: p.timelines[0]?.id,
        inputs: [],
        transitions: [],
      };
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
 *   4. `run` must be idempotent and must not assume anything a previous step added is
 *      present in a shape older than that step — the only guarantee is that steps run in
 *      order.
 *   5. Add a case to `migrate.test.ts` with a literal old document. Not one built by
 *      `defaultProject()` and then broken: the point of the fixture is to be a shape this
 *      build can no longer produce.
 */
