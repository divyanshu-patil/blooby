import { bakeLottie, type LottieOptions } from './lottie';
import { unzip, zipStore } from './zip';
import { animationIds, fromDotLottie, machineOf, toDotLottie } from '../core/stateMachine';
import { dotLottieLayout } from './strip';
import { makeTimeline, uid } from '../core/defaults';
import type { Project, SmTransition, Timeline } from '../core/types';

/**
 * .lottie container, per the dotLottie v2.0 spec (dotlottie.io/spec/2.0/, checked
 * directly against the fetched schema rather than assumed):
 *   a/  animations   (was wrongly `animations/` before — no player found anything there)
 *   s/  state machines (was wrongly `states/`)
 * manifest.json needs a top-level "version": "2" and "initial": { animation }, and a
 * state machine file is FLAT — { initial, states, inputs } — not nested under a made-up
 * "descriptor" object.
 *
 * Each of the project's own timelines becomes one state directly — "idle", "wave",
 * "talk-loop" are authored as separate timelines (see TimelineTabs), not derived from
 * preset blocks, so what you see in the switcher is exactly what ships as a state.
 *
 * The machine's inputs, guards and conditional edges come from core/stateMachine.ts,
 * which speaks dotLottie's own vocabulary — see the note there for why the shapes here
 * are almost a straight copy of the editor's own objects.
 */
export function buildDotLottie(project: Project, opts: Omit<LottieOptions, 'from' | 'to' | 'name'>) {
  const enc = new TextEncoder();
  const bytes = (v: unknown) => enc.encode(JSON.stringify(v)) as Uint8Array<ArrayBuffer>;
  const anim = animationIds(project);

  /**
   * Baked timelines merge into ONE composition; imported ones cannot.
   *
   * A `Tweened` transition moves the playhead within the loaded composition, so two
   * states can only morph into each other if they are frame ranges of the same animation
   * (see strip.ts). An imported animation is a whole composition someone else authored,
   * written out byte for byte — it stays its own file and its state gets no segment, so
   * entering it is still a cut. That is the format, not a shortcut.
   */
  const { baked: bakedTls, stripId, strip, animationOf } = dotLottieLayout(project);

  const entries: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
  if (strip) {
    const built = bakeLottie(project, {
      ...opts, name: stripId, from: 0, to: strip.totalMs, sampleAt: strip.sampleAt,
    });
    /**
     * The markers each state's `segment` names. Not decoration: the engine resolves a
     * state's segment by looking the name up here, both to bound playback and to find a
     * Tweened transition's target frame. No marker, no morph, and no error either.
     */
    (built.json as Record<string, unknown>).markers = bakedTls.map((tl) => {
      const { marker, range: [s0, e0] } = strip.segments.get(tl.id)!;
      return { cm: marker, tm: s0, dr: e0 - s0 };
    });
    entries.push({ name: `a/${stripId}.json`, data: bytes(built.json) });
  }
  const writtenImports = new Set<string>();
  for (const tl of project.timelines) {
    const imported = tl.animationId ? project.importedAnimations?.[tl.animationId] : undefined;
    // several imported states can share one composition — write it once, not once each
    if (!imported || writtenImports.has(tl.animationId!)) continue;
    writtenImports.add(tl.animationId!);
    entries.push({ name: `a/${anim.get(tl.id)!}.json`, data: bytes(imported) });
  }

  const machine = toDotLottie(project, strip ? { animationOf, segments: strip.segments } : undefined);
  const initial = machineOf(project).initialStateId ?? project.timelines[0].id;

  const manifest: Record<string, unknown> = {
    version: '2',
    generator: 'blooby',
    // naming the machine here too means a player can start it without the host page
    // knowing its id — `stateMachineLoad` with the wrong id fails silently
    initial: {
      animation: animationOf.get(initial) ?? animationOf.get(project.timelines[0].id),
      stateMachine: machine.id,
    },
    animations: [...new Set(project.timelines.map((tl) => animationOf.get(tl.id)!))].map((id) => ({ id })),
    stateMachines: [{ id: machine.id, name: `${project.name} states` }],
    /**
     * The authored blend into each state, in ms.
     *
     * A *transition* carries its own tween (dotLottie's `Tweened`), but a state entered
     * any other way — `setState` from a host page, the editor's own switcher — has no
     * spec field for one. So it goes in a namespaced key of our own rather than invented
     * inside a spec object, which is exactly the mistake that made the first state
     * machines unreadable. A player ignores it; the generated Mascot runtime reads it.
     */
    blooby: {
      // keyed by STATE name, not animation id — every baked state now shares one
      // composition, so an animation id no longer identifies a state
      transitions: Object.fromEntries(project.timelines.map((tl) => [tl.name, {
        durationMs: tl.transitionMs ?? 300,
        easing: tl.transitionEasing ?? { type: 'preset', name: 'easeInOut' },
      }])),
    },
  };

  entries.push({ name: `s/${machine.id}.json`, data: bytes(machine.json) });
  entries.unshift({ name: 'manifest.json', data: bytes(manifest) });
  return { blob: zipStore(entries), animations: [...new Set(animationOf.values())], machine };
}

/**
 * Read a `.lottie` back into the editor (§12).
 *
 * Everything the state machine declares is preserved: input names, types and defaults,
 * states with their animation references and loop flags, transitions with their
 * conditions, duration and easing, and the initial state. A state whose name already
 * matches a timeline reuses that timeline rather than creating a second one, so
 * re-importing a file Blooby exported is idempotent instead of doubling the machine.
 *
 * The animations themselves are kept verbatim under `importedAnimations` and written
 * straight back out on export — Blooby cannot re-draw someone else's Lottie on its own
 * rig, and flattening the machine into independent animations is exactly what §13 says
 * must not happen. Those states are editable as states (name, loop, transitions, blend);
 * their artwork is not.
 */
export async function importDotLottie(file: Blob, into: Project): Promise<{ project: Project; states: number; inputs: number; warnings: string[] }> {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const text = (name: string) => {
    const d = files.get(name);
    return d ? new TextDecoder().decode(d) : null;
  };
  const parse = (name: string): unknown => {
    const t = text(name);
    if (t === null) return null;
    try { return JSON.parse(t); } catch { return null; }
  };

  const manifest = parse('manifest.json') as Record<string, unknown> | null;
  if (!manifest) throw new Error('That file is not a .lottie (no manifest.json inside).');

  const warnings: string[] = [];
  const project: Project = structuredClone(into);
  project.importedAnimations = { ...project.importedAnimations };

  for (const [name, data] of files) {
    const id = name.startsWith('a/') && name.endsWith('.json') ? name.slice(2, -5) : null;
    if (!id) continue;
    try { project.importedAnimations[id] = JSON.parse(new TextDecoder().decode(data)); }
    catch { warnings.push(`Animation "${id}" is not valid JSON and was skipped.`); }
  }

  // the manifest names the machines; fall back to whatever is under s/ if it doesn't
  const declared = (Array.isArray(manifest.stateMachines) ? manifest.stateMachines : [])
    .map((m) => (m && typeof m === 'object' ? String((m as Record<string, unknown>).id ?? '') : ''))
    .filter(Boolean);
  const machineNames = declared.length ? declared.map((id) => `s/${id}.json`) : [...files.keys()].filter((n) => n.startsWith('s/'));
  const machineJson = machineNames.map(parse).find((m) => m && typeof m === 'object');

  if (!machineJson) {
    const ids = Object.keys(project.importedAnimations);
    if (!ids.length) throw new Error('That .lottie has no animations and no state machine.');
    warnings.push('No state machine in that file — its animations were imported as states with no transitions.');
    for (const id of ids) reuseOrCreate(project, id, id, false);
    return { project, states: ids.length, inputs: 0, warnings };
  }

  const read = fromDotLottie(machineJson, (stateName, animation, loop, segment) => reuseOrCreate(project, stateName, animation, loop, segment));
  if (!read) throw new Error('That file’s state machine could not be read.');

  for (const name of read.danglingInputs) warnings.push(`A transition tests "${name}", which the file never declares as an input.`);
  for (const tl of project.timelines) {
    if (tl.animationId && !project.importedAnimations[tl.animationId]) {
      warnings.push(`State "${tl.name}" plays "${tl.animationId}", which is not in the file.`);
    }
  }

  const existing = project.stateMachine;
  project.stateMachine = {
    id: String((manifest.stateMachines as { id?: string }[] | undefined)?.[0]?.id ?? existing?.id ?? 'blooby'),
    initialStateId: read.initialStateId ?? existing?.initialStateId,
    // an input the file declares wins over one of ours with the same name — the imported
    // machine's own types and defaults are the ones its transitions were written against
    inputs: [...read.inputs, ...(existing?.inputs ?? []).filter((i) => !read.inputs.some((r) => r.name === i.name))],
    transitions: dedupe([...(existing?.transitions ?? []), ...read.transitions]),
  };
  project.activeTimelineId = project.stateMachine.initialStateId ?? project.timelines[0].id;

  return { project, states: project.timelines.length, inputs: read.inputs.length, warnings };
}

/** Same state name → same timeline. Re-importing a file must not double its states. */
function reuseOrCreate(p: Project, stateName: string, animation: string, loop: boolean, segment?: string): string {
  const found = p.timelines.find((t) => t.name.toLowerCase() === stateName.toLowerCase());
  const tl: Timeline = found ?? makeTimeline(stateName);
  tl.name = stateName;
  tl.loop = loop;
  if (animation) tl.animationId = animation;
  // several states sharing one composition is the normal shape now, so without this each
  // of them would come back claiming the whole strip
  if (segment) tl.segment = segment;
  if (!found) { tl.id = uid('tl'); p.timelines.push(tl); }
  return tl.id;
}

/** Two identical edges (same ends, same conditions) are one edge. */
function dedupe(list: SmTransition[]): SmTransition[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const key = `${t.from}>${t.to}|${t.logic ?? 'AND'}|${t.conditions.map((c) => `${c.input}${c.operator}${String(c.value)}`).sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
