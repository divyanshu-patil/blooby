import { bakeLottie, type LottieOptions } from './lottie';
import { blockStarts } from '../core/timeline';
import { zipStore } from './zip';
import type { Project } from '../core/types';

/**
 * .lottie container, per the dotLottie v2.0 spec (dotlottie.io/spec/2.0/, checked
 * directly against the fetched schema rather than assumed):
 *   a/  animations   (was wrongly `animations/` before — no player found anything there)
 *   s/  state machines (was wrongly `states/`)
 * manifest.json needs a top-level "version": "2" and "initial": { animation }, and a
 * state machine file is FLAT — { initial, states, interactions, inputs } — not nested
 * under a made-up "descriptor" object. Verified against a real dotLottie player in
 * `selfcheck`-adjacent scratch testing during this fix; the auto-advance mechanism
 * (Event guard + OnComplete interaction firing it) is the documented pattern for
 * "play this, then the next" with no user input, which is exactly what a preset-derived
 * state list needs.
 *
 * Each timeline block becomes its own named animation/state alongside the full
 * timeline, so a player can switch between "idle", "blink", "talk" as states.
 */
export function buildDotLottie(project: Project, opts: Omit<LottieOptions, 'from' | 'to' | 'name'>) {
  const enc = new TextEncoder();
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anim';

  const animations: { id: string; from: number; to: number }[] = [
    { id: 'timeline', from: 0, to: project.timelineDurationMs },
  ];
  const starts = blockStarts(project);
  const used = new Set(['timeline']);
  project.blocks.forEach((b, i) => {
    let id = slug(b.name);
    let n = 2;
    while (used.has(id)) id = `${slug(b.name)}-${n++}`;
    used.add(id);
    animations.push({ id, from: starts[i], to: starts[i] + b.durationMs });
  });

  const entries: { name: string; data: Uint8Array<ArrayBuffer> }[] = animations.map((a) => {
    const baked = bakeLottie(project, { ...opts, name: a.id, from: a.from, to: a.to });
    return { name: `a/${a.id}.json`, data: enc.encode(JSON.stringify(baked.json)) as Uint8Array<ArrayBuffer> };
  });

  const manifest: Record<string, unknown> = {
    version: '2',
    generator: 'blooby',
    initial: { animation: animations[0].id },
    animations: animations.map((a) => ({ id: a.id })),
  };

  if (animations.length > 1) {
    const machineId = 'mascot';
    const eventFor = (id: string) => `${id}-done`;

    // every state must eventually complete to fire its OnComplete guard and advance the
    // chain — a looping state never would, so none of them loop; the chain itself wraps
    // back to the first state, which is what makes the whole thing cycle forever.
    const states = animations.map((a, i) => {
      const next = animations[(i + 1) % animations.length];
      return {
        name: a.id,
        type: 'PlaybackState',
        animation: a.id,
        loop: false,
        autoplay: i === 0,
        transitions: [{ type: 'Transition', toState: next.id, guards: [{ type: 'Event', inputName: eventFor(a.id) }] }],
      };
    });
    const interactions = animations.map((a) => ({
      type: 'OnComplete', stateName: a.id,
      actions: [{ type: 'Fire', inputName: eventFor(a.id) }],
    }));
    const inputs = animations.map((a) => ({ type: 'Event', name: eventFor(a.id) }));

    const machine = { initial: animations[0].id, states, interactions, inputs };
    manifest.stateMachines = [{ id: machineId, name: 'Mascot states' }];
    entries.push({ name: `s/${machineId}.json`, data: enc.encode(JSON.stringify(machine)) as Uint8Array<ArrayBuffer> });
  }

  entries.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) as Uint8Array<ArrayBuffer> });
  return { blob: zipStore(entries), animations: animations.map((a) => a.id) };
}
