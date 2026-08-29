import { expect } from 'vitest';
import { defaultProject } from './defaults';
import type { Rig, RigNode } from './types';

/**
 * Shared scaffolding for the test files that sit beside each module.
 *
 * Not a `.test.ts` on purpose — the runner would pick it up and find no tests in it.
 */

/**
 * The body of one assertion, with its subject captured NOW.
 *
 * These checks are written as a script: a block sets up the editor, asserts something,
 * then edits it again and asserts something else. Vitest runs a test body after the whole
 * module has evaluated, so an assertion that read live state through a getter would see
 * the end of the script rather than its own moment — sixteen of them did exactly that.
 * Capturing the value here and deferring only the comparison keeps each assertion about
 * the instant it was written for.
 */
export const check = (value: unknown, detail?: string) => () => {
  expect(value, detail).toBe(true);
};

export const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

/** The default rig, and the same rig with perspective flattened out. */
export const rig: Rig = defaultProject().rig;
export const flat: Rig = { ...rig, camera: { ...rig.camera, fov: 0 } };

/** A throwaway mapped feature at a given pose. */
export const mk = (yaw: number, pitch: number, roll = 0): RigNode => ({
  id: 't', name: 't', kind: 'primitive', parentId: rig.rootId,
  surface: { yaw, pitch, mapped: true },
  transform: { scale: { x: 1, y: 1 }, rotation: roll },
  size: { x: 10, y: 10 }, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, zIndex: 0,
});

/** The composition every check measures in. */
export const VIEW = { width: 720, height: 720 };
