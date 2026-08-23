import { bakeLottie, type LottieOptions } from './lottie';
import { blockStarts } from '../core/timeline';
import { zipStore } from './zip';
import type { Project } from '../core/types';

/**
 * .lottie container: a zip holding manifest.json plus one JSON per animation.
 * Each timeline block becomes its own named animation alongside the full timeline, so
 * a player can switch between "idle", "blink", "talk" as states.
 *
 * ponytail: the state-machine schema in the manifest follows dotLottie v1 as published;
 * every player ignores keys it doesn't know, and the animations themselves are plain
 * spec-compliant Lottie either way. See ASSUMPTIONS.md.
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
    return { name: `animations/${a.id}.json`, data: enc.encode(JSON.stringify(baked.json)) as Uint8Array<ArrayBuffer> };
  });

  const manifest: Record<string, unknown> = {
    version: '1.0.0',
    generator: 'blooby',
    animations: animations.map((a) => ({ id: a.id, autoplay: a.id === 'timeline', loop: true, direction: 1, speed: 1 })),
  };

  if (animations.length > 1) {
    const machine = {
      descriptor: { id: 'mascot', initial: 'timeline' },
      states: animations.map((a) => ({
        name: a.id,
        type: 'PlaybackState',
        animation: a.id,
        loop: a.id === 'timeline',
        autoplay: true,
        transitions: [{ type: 'Transition', toState: animations[(animations.indexOf(a) + 1) % animations.length].id, onCompleteEvent: {} }],
      })),
    };
    manifest.stateMachines = [{ id: 'mascot' }];
    entries.push({ name: 'states/mascot.json', data: enc.encode(JSON.stringify(machine)) as Uint8Array<ArrayBuffer> });
  }

  entries.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) as Uint8Array<ArrayBuffer> });
  return { blob: zipStore(entries), animations: animations.map((a) => a.id) };
}
