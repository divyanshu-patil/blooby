import type { EasingCurve, Expression, Keyframe, KeyValue, Preset, Project, Rig, RigNode, Track } from './types';

export const uid = (p = 'n') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const BONE = { r: 242, g: 239, b: 233, a: 1 };
export const INK = { r: 20, g: 19, b: 24, a: 1 };

const ease = (name: string): EasingCurve =>
  name === 'linear' ? { type: 'linear' } : { type: 'preset', name: name as 'easeInOut' };

export const kf = (time: number, value: KeyValue, easing = 'easeInOut'): Keyframe => ({
  id: uid('k'), time, value, easingOut: ease(easing),
});

const track = (nodeId: string, property: string, keyframes: Keyframe[]): Track => ({
  id: uid('t'), nodeId, property, keyframes,
});

export function makeBody(): RigNode {
  return {
    id: 'body', name: 'Body', kind: 'body', parentId: null,
    surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 0, y: 0 } },
    transform: { scale: { x: 1, y: 1 }, rotation: 0 },
    size: { x: 148, y: 148 },
    color: BONE, visible: true, zIndex: 0,
  };
}

export function makeEye(id: string, distance: number): RigNode {
  return {
    id, name: distance < 0 ? 'Left eye' : 'Right eye', kind: 'eye', parentId: 'body',
    surface: { yaw: 0, pitch: -4, mapped: true },
    transform: { scale: { x: 1, y: 1 }, rotation: 0, length: 1.55 },
    size: { x: 38, y: 38 },
    color: INK, visible: true, zIndex: 1,
    eye: { linkedToId: null, openness: 1, distanceFromCenter: distance },
  };
}

export function defaultRig(): Rig {
  const nodes: Record<string, RigNode> = {};
  for (const n of [makeBody(), makeEye('eyeL', -21), makeEye('eyeR', 21)]) nodes[n.id] = n;
  return { id: uid('rig'), nodes, rootId: 'body', camera: { fov: 28, distance: 6, offset: { x: 0, y: 0 } } };
}

/* ---- built-in presets: self-contained mini-timelines starting at 0 ---------- */

const bothEyes = (property: string, keys: Keyframe[]): Track[] => [
  track('eyeL', property, keys),
  track('eyeR', property, keys.map((k) => ({ ...k, id: uid('k') }))),
];

export function builtinPresets(): Preset[] {
  return [
    {
      id: 'p_idle', name: 'Idle', source: 'builtin', durationMs: 2400,
      tracks: [
        track('body', 'flatOffset.y', [kf(0, 0), kf(1200, -7), kf(2400, 0)]),
        track('body', 'surface.yaw', [kf(0, 0), kf(1600, 4), kf(2400, 0)]),
        ...bothEyes('eye.openness', [kf(0, 1, 'linear'), kf(1700, 1, 'linear'), kf(1790, 0.06), kf(1880, 1)]),
      ],
    },
    {
      id: 'p_blink', name: 'Blink', source: 'builtin', durationMs: 900,
      tracks: bothEyes('eye.openness', [kf(0, 1, 'linear'), kf(240, 0.06, 'easeIn'), kf(360, 1, 'easeOut'), kf(560, 1, 'linear'), kf(700, 0.06, 'easeIn'), kf(820, 1, 'easeOut')]),
    },
    {
      id: 'p_talk', name: 'Talk', source: 'builtin', durationMs: 1600,
      tracks: [
        track('body', 'transform.scale.y', [kf(0, 1), kf(200, 1.05), kf(400, 0.97), kf(600, 1.04), kf(800, 0.98), kf(1000, 1.05), kf(1200, 0.98), kf(1600, 1)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(200, 0.97), kf(400, 1.03), kf(600, 0.98), kf(800, 1.02), kf(1000, 0.97), kf(1200, 1.02), kf(1600, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(300, 1.3), kf(700, 1.6), kf(1100, 1.35), kf(1600, 1.55)]),
      ],
    },
    {
      id: 'p_happy', name: 'Happy', source: 'builtin', durationMs: 1400,
      tracks: [
        ...bothEyes('eye.openness', [kf(0, 1), kf(260, 0.42), kf(1100, 0.42), kf(1400, 1)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(260, 1.22), kf(1100, 1.22), kf(1400, 1)]),
        track('body', 'flatOffset.y', [kf(0, 0), kf(200, -22, 'easeOut'), kf(520, 0, 'bounce'), kf(760, -10, 'easeOut'), kf(1000, 0, 'bounce'), kf(1400, 0)]),
      ],
    },
    {
      id: 'p_surprised', name: 'Surprised', source: 'builtin', durationMs: 1000,
      tracks: [
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(140, 1.5, 'easeOut'), kf(760, 1.5), kf(1000, 1)]),
        ...bothEyes('transform.length', [kf(0, 1.55), kf(140, 1.15, 'easeOut'), kf(760, 1.15), kf(1000, 1.55)]),
        track('body', 'transform.scale.x', [kf(0, 1), kf(140, 1.07, 'easeOut'), kf(760, 1.07), kf(1000, 1)]),
        track('body', 'transform.scale.y', [kf(0, 1), kf(140, 1.07, 'easeOut'), kf(760, 1.07), kf(1000, 1)]),
      ],
    },
    {
      id: 'p_thinking', name: 'Thinking', source: 'builtin', durationMs: 2200,
      tracks: [
        track('body', 'surface.yaw', [kf(0, 0), kf(600, -20), kf(1600, -20), kf(2200, 0)]),
        track('body', 'surface.pitch', [kf(0, 0), kf(600, -10), kf(1600, -10), kf(2200, 0)]),
        track('eyeL', 'eye.openness', [kf(0, 1), kf(600, 0.5), kf(1600, 0.5), kf(2200, 1)]),
        track('eyeR', 'surface.pitch', [kf(0, -4), kf(700, -14), kf(1500, -14), kf(2200, -4)]),
      ],
    },
    {
      id: 'p_notify', name: 'Notify', source: 'builtin', durationMs: 1300,
      tracks: [
        track('body', 'surface.yaw', [kf(0, 0), kf(150, 16, 'easeOut'), kf(330, -14), kf(500, 10), kf(670, -6), kf(900, 0, 'elastic'), kf(1300, 0)]),
        track('body', 'transform.rotation', [kf(0, 0), kf(150, -5, 'easeOut'), kf(400, 4), kf(700, -2), kf(1000, 0, 'elastic'), kf(1300, 0)]),
        ...bothEyes('transform.scale.x', [kf(0, 1), kf(150, 1.3, 'easeOut'), kf(700, 1), kf(1300, 1)]),
      ],
    },
  ];
}

export function builtinExpressions(): Expression[] {
  return [
    { id: 'x_neutral', name: 'Neutral', snapshot: { 'eyeL.eye.openness': 1, 'eyeR.eye.openness': 1, 'eyeL.transform.length': 1.55, 'eyeR.transform.length': 1.55, 'eyeL.transform.scale.x': 1, 'eyeR.transform.scale.x': 1, 'body.surface.yaw': 0, 'body.surface.pitch': 0 } },
    { id: 'x_happy', name: 'Happy', snapshot: { 'eyeL.eye.openness': 0.42, 'eyeR.eye.openness': 0.42, 'eyeL.transform.scale.x': 1.22, 'eyeR.transform.scale.x': 1.22, 'body.surface.pitch': 4 } },
    { id: 'x_surprised', name: 'Surprised', snapshot: { 'eyeL.transform.scale.x': 1.5, 'eyeR.transform.scale.x': 1.5, 'eyeL.transform.length': 1.15, 'eyeR.transform.length': 1.15, 'body.transform.scale.x': 1.07, 'body.transform.scale.y': 1.07 } },
    { id: 'x_sleepy', name: 'Sleepy', snapshot: { 'eyeL.eye.openness': 0.14, 'eyeR.eye.openness': 0.14, 'body.surface.pitch': 10 } },
  ];
}

export function defaultProject(): Project {
  return {
    name: 'Untitled mascot',
    rig: defaultRig(),
    tracks: [],
    modifiers: [],
    expressions: builtinExpressions(),
    presets: builtinPresets(),
    blocks: [],
    durationMode: 'custom',
    timelineDurationMs: 4000,
    fps: 30,
  };
}
