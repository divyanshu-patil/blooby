import { bakeLottie, type LottieOptions } from './lottie';
import { zipStore } from './zip';
import type { Project } from '../core/types';

/**
 * .lottie container, per the dotLottie v2.0 spec (dotlottie.io/spec/2.0/, checked
 * directly against the fetched schema rather than assumed):
 *   a/  animations   (was wrongly `animations/` before — no player found anything there)
 *   s/  state machines (was wrongly `states/`)
 * manifest.json needs a top-level "version": "2" and "initial": { animation }, and a
 * state machine file is FLAT — { initial, states, interactions, inputs } — not nested
 * under a made-up "descriptor" object. Verified against a real dotLottie player: the
 * file loads, `stateMachineLoad`/`stateMachineStart` both return true, and the player
 * enters the first state. The auto-advance mechanism (Event guard + OnComplete
 * interaction firing it) is the best-documented pattern for "play this, then the next"
 * with no user input — see ASSUMPTIONS.md for what's still unverified about it.
 *
 * Each of the project's own timelines becomes one state directly — "idle", "wave",
 * "talk-loop" are authored as separate timelines (see TimelineTabs), not derived from
 * preset blocks, so what you see in the switcher is exactly what ships as a state.
 */
export function buildDotLottie(project: Project, opts: Omit<LottieOptions, 'from' | 'to' | 'name'>) {
  const enc = new TextEncoder();
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anim';

  const used = new Set<string>();
  const animations = project.timelines.map((tl) => {
    let id = slug(tl.name);
    let n = 2;
    while (used.has(id)) id = `${slug(tl.name)}-${n++}`;
    used.add(id);
    return { id, timeline: tl };
  });

  const entries: { name: string; data: Uint8Array<ArrayBuffer> }[] = animations.map((a) => {
    const synthetic: Project = { ...project, activeTimelineId: a.timeline.id };
    const baked = bakeLottie(synthetic, { ...opts, name: a.id, from: 0, to: a.timeline.timelineDurationMs });
    return { name: `a/${a.id}.json`, data: enc.encode(JSON.stringify(baked.json)) as Uint8Array<ArrayBuffer> };
  });

  const manifest: Record<string, unknown> = {
    version: '2',
    generator: 'blooby',
    initial: { animation: animations[0].id },
    animations: animations.map((a) => ({ id: a.id })),
    /**
     * The authored blend into each state, in ms.
     *
     * dotLottie 2.0 has no field for it — a PlaybackState is entered on the frame the
     * transition fires — so it goes in a namespaced key of our own rather than invented
     * inside a spec object, which is exactly the mistake that made the first state
     * machines unreadable. A player ignores it; a host page reads it and passes it to
     * window.blooby.setState, which is where the lerp actually happens.
     */
    blooby: {
      transitions: Object.fromEntries(animations.map((a) => [a.id, {
        durationMs: a.timeline.transitionMs ?? 300,
        easing: a.timeline.transitionEasing ?? { type: 'preset', name: 'easeInOut' },
      }])),
    },
  };

  if (animations.length > 1) {
    const machineId = 'mascot';
    const eventFor = (id: string) => `${id}-done`;

    // a timeline authored to loop forever never completes, so it gets no outgoing
    // transition — it's a resting state, not a step in the chain. Everything else
    // advances to the next timeline on completion, wrapping back to the first.
    const states = animations.map((a, i) => {
      const next = animations[(i + 1) % animations.length];
      const loop = a.timeline.loop;
      return {
        name: a.id,
        type: 'PlaybackState',
        animation: a.id,
        loop,
        autoplay: i === 0,
        transitions: loop ? [] : [{ type: 'Transition', toState: next.id, guards: [{ type: 'Event', inputName: eventFor(a.id) }] }],
      };
    });
    const interactions = animations.filter((a) => !a.timeline.loop).map((a) => ({
      type: 'OnComplete', stateName: a.id,
      actions: [{ type: 'Fire', inputName: eventFor(a.id) }],
    }));
    const inputs = animations.filter((a) => !a.timeline.loop).map((a) => ({ type: 'Event', name: eventFor(a.id) }));

    const machine = { initial: animations[0].id, states, interactions, inputs };
    manifest.stateMachines = [{ id: machineId, name: 'Mascot states' }];
    entries.push({ name: `s/${machineId}.json`, data: enc.encode(JSON.stringify(machine)) as Uint8Array<ArrayBuffer> });
  }

  entries.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) as Uint8Array<ArrayBuffer> });
  return { blob: zipStore(entries), animations: animations.map((a) => a.id) };
}
