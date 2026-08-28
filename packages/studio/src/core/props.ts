import type { ColorStop, KeyValue, Rig, RigNode } from './types';
import { CAMERA_ID } from './types';

/** One place that knows how a property path maps onto the rig. */
export function getProp(node: RigNode, path: string): KeyValue | undefined {
  switch (path) {
    case 'surface.yaw': return node.surface.yaw;
    case 'surface.pitch': return node.surface.pitch;
    case 'flatOffset.x': return node.surface.flatOffset?.x ?? 0;
    case 'flatOffset.y': return node.surface.flatOffset?.y ?? 0;
    case 'transform.scale.x': return node.transform.scale.x;
    case 'transform.scale.y': return node.transform.scale.y;
    case 'transform.rotation': return node.transform.rotation;
    case 'transform.length': return node.transform.length ?? 1;
    case 'eye.openness': return node.eye?.openness;
    case 'eye.distanceFromCenter': return node.eye?.distanceFromCenter;
    case 'size.x': return node.size.x;
    case 'size.y': return node.size.y;
    case 'color': return node.color;
    default: return undefined;
  }
}

export function setProp(node: RigNode, path: string, v: KeyValue): void {
  const n = v as number;
  switch (path) {
    case 'surface.yaw': node.surface.yaw = n; break;
    case 'surface.pitch': node.surface.pitch = n; break;
    case 'flatOffset.x': node.surface.flatOffset = { x: n, y: node.surface.flatOffset?.y ?? 0 }; break;
    case 'flatOffset.y': node.surface.flatOffset = { x: node.surface.flatOffset?.x ?? 0, y: n }; break;
    case 'transform.scale.x': node.transform.scale.x = n; break;
    case 'transform.scale.y': node.transform.scale.y = n; break;
    case 'transform.rotation': node.transform.rotation = n; break;
    case 'transform.length': node.transform.length = n; break;
    case 'eye.openness': if (node.eye) node.eye.openness = n; break;
    case 'eye.distanceFromCenter': if (node.eye) node.eye.distanceFromCenter = n; break;
    case 'size.x': node.size.x = n; break;
    case 'size.y': node.size.y = n; break;
    case 'color': node.color = v as ColorStop; break;
  }
}

export function getCameraProp(rig: Rig, path: string): number {
  switch (path) {
    case 'camera.fov': return rig.camera.fov;
    case 'camera.distance': return rig.camera.distance;
    case 'camera.offset.x': return rig.camera.offset.x;
    case 'camera.offset.y': return rig.camera.offset.y;
    default: return 0;
  }
}

export function setCameraProp(rig: Rig, path: string, v: number): void {
  switch (path) {
    case 'camera.fov': rig.camera.fov = v; break;
    case 'camera.distance': rig.camera.distance = v; break;
    case 'camera.offset.x': rig.camera.offset.x = v; break;
    case 'camera.offset.y': rig.camera.offset.y = v; break;
  }
}

export function readProp(rig: Rig, nodeId: string, path: string): KeyValue | undefined {
  if (nodeId === CAMERA_ID) return getCameraProp(rig, path);
  const node = rig.nodes[nodeId];
  return node && getProp(node, path);
}

export function writeProp(rig: Rig, nodeId: string, path: string, v: KeyValue): void {
  if (nodeId === CAMERA_ID) { setCameraProp(rig, path, v as number); return; }
  const node = rig.nodes[nodeId];
  if (node) setProp(node, path, v);
}

/**
 * Every animatable property, defined once.
 *
 * This table is the ONLY definition. The inspector's label and slider, what the renderer
 * bakes, what the copilot is allowed to keyframe, and the description the copilot's
 * system prompt is built from all read it. Add a row here and the property becomes
 * animatable, inspectable and known to the agent in the same commit — there is no second
 * list to remember, which is how `stretch` ended up implemented but rejected by the
 * copilot, and `color` ended up animatable but never baked.
 *
 * Adding one is two steps, both enforced by selfcheck: a row here, and a case in
 * getProp/setProp (or getCameraProp/setCameraProp) so it reaches the rig.
 * See COPILOT.md.
 */
export interface PropSpec {
  /** what the inspector calls it */
  label: string;
  /** node properties live on a RigNode, camera properties on the rig itself */
  on: 'node' | 'camera';
  /** [min, max, step, unit] — the inspector slider, and the sane range the copilot is told.
   *  Omitted for non-numeric properties, which are keyframeable but not copilot-settable. */
  range?: [number, number, number, string];
  /** One line, written for someone who has never seen the editor. Say which way is
   *  positive and what a typical value looks like — this goes straight into the prompt. */
  help: string;
}

export const PROPS: Record<string, PropSpec> = {
  'surface.yaw': { on: 'node', label: 'Yaw', range: [-90, 90, 0.5, '\u00b0'],
    help: 'Turns the feature around the sphere. Negative is left, positive is right. It foreshortens near the rim and hides past \u00b190\u00b0.' },
  'surface.pitch': { on: 'node', label: 'Pitch', range: [-90, 90, 0.5, '\u00b0'],
    help: 'The same, vertically. Negative is up, positive is down.' },
  'flatOffset.x': { on: 'node', label: 'Offset X', range: [-300, 300, 1, 'px'],
    help: 'Nudges the feature sideways in screen pixels AFTER it is mapped onto the sphere. For small corrections, not for movement \u2014 use surface.yaw to move a feature.' },
  'flatOffset.y': { on: 'node', label: 'Offset Y', range: [-300, 300, 1, 'px'],
    help: 'The same, vertically.' },
  'transform.scale.x': { on: 'node', label: 'Scale X', range: [0.05, 3, 0.01, '\u00d7'],
    help: 'Horizontal scale. 1 is the authored size; 1.6 is noticeably bigger. On the body it scales every mapped feature with it.' },
  'transform.scale.y': { on: 'node', label: 'Scale Y', range: [0.05, 3, 0.01, '\u00d7'],
    help: 'Vertical scale. Squash and stretch is scale.x and scale.y moving in opposite directions.' },
  'transform.rotation': { on: 'node', label: 'Roll', range: [-180, 180, 1, '\u00b0'],
    help: 'In-plane 2D roll in degrees. This is a tilt of the drawing, not a rotation around the sphere \u2014 8\u00b0 reads as a cheeky head-tilt.' },
  'transform.length': { on: 'node', label: 'Length', range: [0.1, 4, 0.01, '\u00d7'],
    help: 'Stretches the feature along its own long axis. 1 is normal; on an eye this is what makes it tall and round rather than wide.' },
  'eye.openness': { on: 'node', label: 'Openness', range: [0, 1, 0.01, ''],
    help: 'Eyes only. 0 is fully closed, 1 fully open. A blink is 1 \u2192 0 \u2192 1 over about 120 ms.' },
  'eye.distanceFromCenter': { on: 'node', label: 'Eye distance', range: [-80, 80, 0.5, '\u00b0'],
    help: 'Eyes only. How far the eye sits from the face\u2019s centre line, in degrees around the sphere.' },
  'size.x': { on: 'node', label: 'Width', range: [1, 300, 1, 'px'],
    help: 'The authored width in pixels. Prefer transform.scale.x for animation \u2014 this resizes the drawing itself.' },
  'size.y': { on: 'node', label: 'Height', range: [1, 300, 1, 'px'],
    help: 'The authored height in pixels. Prefer transform.scale.y for animation.' },
  color: { on: 'node', label: 'Color',
    help: 'Fill colour. Keyframeable in the editor, but it is not a number, so the copilot cannot set it.' },

  'camera.fov': { on: 'camera', label: 'Perspective', range: [0, 89, 1, '\u00b0'],
    help: 'Perspective, as a field-of-view angle. 0 is flat/orthographic; higher makes the sphere bulge and features near the rim fall away faster.' },
  'camera.distance': { on: 'camera', label: 'Distance', range: [1.2, 20, 0.1, 'R'],
    help: 'How far the camera sits from the sphere, measured in sphere radii.' },
  'camera.offset.x': { on: 'camera', label: 'Pan X', range: [-300, 300, 1, 'px'],
    help: 'Pans the whole view horizontally, in pixels.' },
  'camera.offset.y': { on: 'camera', label: 'Pan Y', range: [-300, 300, 1, 'px'],
    help: 'Pans the whole view vertically, in pixels.' },
};

const pathsWhere = (f: (s: PropSpec) => boolean) => Object.keys(PROPS).filter((k) => f(PROPS[k]));

/** Every animatable path on a node. Anything not here is not keyframeable. */
export const NODE_PROPS: string[] = pathsWhere((s) => s.on === 'node');
export const CAMERA_PROPS: string[] = pathsWhere((s) => s.on === 'camera');
/** The numeric ones \u2014 what a slider, a baked export and the copilot can all handle. */
export const NUMERIC_PROPS: string[] = pathsWhere((s) => !!s.range);

export const PROP_LABEL: Record<string, string> =
  Object.fromEntries(Object.entries(PROPS).map(([k, v]) => [k, v.label]));

/** Property ranges for the inspector sliders. [min, max, step, unit] */
export const PROP_RANGE: Record<string, [number, number, number, string]> =
  Object.fromEntries(Object.entries(PROPS).flatMap(([k, v]) => (v.range ? [[k, v.range] as const] : [])));

/**
 * The short name a property is commonly called by, mapped back to its full path.
 *
 * Models write `openness` for `eye.openness` and `rotation` for `transform.rotation`
 * constantly \u2014 the tool docs use short names for set_eye_params, so the confusion is
 * ours, not theirs. Derived, so a new property gets its alias for free. Ambiguous tails
 * (`x`, `y`) are dropped rather than guessed.
 */
export const PROP_ALIAS: Record<string, string> = (() => {
  const byTail: Record<string, string[]> = {};
  for (const path of Object.keys(PROPS)) {
    for (const tail of [path.slice(path.indexOf('.') + 1), path.slice(path.lastIndexOf('.') + 1)]) {
      if (tail === path) continue;
      (byTail[tail] ??= []).push(path);
    }
  }
  return Object.fromEntries(
    Object.entries(byTail).filter(([, paths]) => new Set(paths).size === 1).map(([tail, paths]) => [tail, paths[0]]),
  );
})();

/** Resolve whatever a caller wrote to a real property path, or undefined. */
export function resolveProp(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const s = name.trim();
  return PROPS[s] ? s : PROP_ALIAS[s];
}
