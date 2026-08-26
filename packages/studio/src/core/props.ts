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

/** Property ranges for the inspector sliders. [min, max, step, unit] */
export const PROP_RANGE: Record<string, [number, number, number, string]> = {
  'surface.yaw': [-90, 90, 0.5, '°'],
  'surface.pitch': [-90, 90, 0.5, '°'],
  'flatOffset.x': [-300, 300, 1, 'px'],
  'flatOffset.y': [-300, 300, 1, 'px'],
  'transform.scale.x': [0.05, 3, 0.01, '×'],
  'transform.scale.y': [0.05, 3, 0.01, '×'],
  'transform.rotation': [-180, 180, 1, '°'],
  'transform.length': [0.1, 4, 0.01, '×'],
  'eye.openness': [0, 1, 0.01, ''],
  'eye.distanceFromCenter': [-80, 80, 0.5, '°'],
  'size.x': [1, 300, 1, 'px'],
  'size.y': [1, 300, 1, 'px'],
  'camera.fov': [0, 89, 1, '°'],
  'camera.distance': [1.2, 20, 0.1, 'R'],
  'camera.offset.x': [-300, 300, 1, 'px'],
  'camera.offset.y': [-300, 300, 1, 'px'],
};
