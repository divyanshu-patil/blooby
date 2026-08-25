export type Vec2 = { x: number; y: number };
export type ColorStop = { r: number; g: number; b: number; a: number };

export type NodeKind = 'body' | 'eye' | 'group' | 'svgLayer' | 'primitive';

export interface RigNode {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;

  /** Placement on the parent's sphere. Angles, not pixels — see core/curvature.ts */
  surface: {
    yaw: number;
    pitch: number;
    mapped: boolean;
    flatOffset?: Vec2;
  };

  transform: {
    scale: Vec2;
    rotation: number;
    /** eye/primitive: elongation along the major (vertical) axis */
    length?: number;
  };

  /** Base geometry in rig units. body: x = radius. eye/primitive: x = width, y = height. */
  size: Vec2;

  color: ColorStop;
  visible: boolean;
  zIndex: number;

  eye?: {
    linkedToId: string | null;
    openness: number;
    /** friendlier control that drives surface.yaw; sign comes from the node's own side */
    distanceFromCenter: number;
  };

  primitive?: { shape: 'circle' | 'pill' };

  svg?: { sourceMarkup: string; viewBox: string };
}

export interface Rig {
  id: string;
  nodes: Record<string, RigNode>;
  rootId: string;
  camera: {
    /** 0 = orthographic, higher = stronger perspective divide */
    fov: number;
    /** eye distance in body radii */
    distance: number;
    offset: Vec2;
  };
}

export type EasingCurve =
  | { type: 'linear' }
  | { type: 'preset'; name: 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'elastic' }
  | { type: 'bezier'; p1: Vec2; p2: Vec2 };

export type KeyValue = number | ColorStop | Vec2;

export interface Keyframe {
  id: string;
  time: number;
  value: KeyValue;
  easingOut: EasingCurve;
}

export interface Track {
  id: string;
  nodeId: string;
  property: string;
  keyframes: Keyframe[];
  /** set when the track came from a preset block — retimed with it */
  blockId?: string;
}

export interface Modifier {
  id: string;
  nodeId: string;
  kind: 'shake' | 'float' | 'stretch';
  /** 0–200 %, the intensity dial */
  amount: number;
  frequency: number;
  seed?: number;
  amplitude: number;
  phase?: number;
  /** set when this effect was added to one clip specifically — it then only evaluates
   * inside that block's own time window instead of the whole timeline. Undefined means
   * global, exactly like every effect before per-clip effects existed. */
  blockId?: string;
}

export interface Expression {
  id: string;
  name: string;
  snapshot: Record<string, KeyValue>;
}

export interface Preset {
  id: string;
  name: string;
  source: 'builtin' | 'custom';
  durationMs: number;
  tracks: Track[];
  thumbnail?: string;
}

/** One placed preset instance on the strip (§7) — a clip instance in spec terms: the
 * `presetId` is the reusable source, everything else here is this placement's own. */
export interface Block {
  id: string;
  presetId: string;
  name: string;
  durationMs: number;
  /** how fast this clip's own keyframes progress, independent of how much timeline space
   * it occupies — 1 = normal. At 2 it plays twice as fast then holds its last pose for
   * the remainder of `durationMs`; at 0.5 it may not finish before the clip ends. Distinct
   * from resizing the clip (which proportionally re-times every keyframe to fit). */
  speed?: number;
  /** when true, this clip's own animation repeats to fill `durationMs` instead of holding
   * its last pose once it runs out — useful once a short clip (Blink) is stretched long. */
  loop?: boolean;
  /** set when this clip's tracks were copied from a *different* saved project's timeline
   * (§12/§13) rather than a local preset — presetId is unused ('') for these. Only tracks
   * whose nodeId exists in this project's own rig are copied in; a gallery mascot with an
   * incompatible rig (custom layers this rig doesn't have) just contributes fewer tracks,
   * never a crash. Changing `timelineId` (via the clip inspector) re-copies from that
   * timeline instead — the gallery project itself is only ever read, never modified. */
  gallerySource?: { galleryId: string; galleryName: string; timelineId: string; timelineName: string };
}

/** How one clip blends into the next. Lives on the *incoming* clip's side of the seam —
 * `afterBlockId` names the clip it follows. A runtime blend, never baked into keyframes:
 * evaluation captures the outgoing clip's actually-evaluated pose at the boundary, then
 * lerps it toward the incoming clip's own (still-progressing) animation over `durationMs`,
 * eased by `easing`. Both clips' source keyframes are untouched either way. */
export interface Transition {
  id: string;
  afterBlockId: string;
  durationMs: number;
  easing: EasingCurve;
}

/**
 * One independent animation sequence on the shared rig — "idle", "wave", "talk-loop".
 * A project can hold several; each becomes its own state in the exported `.lottie`, and
 * they're switched from the timeline-tabs strip, never mixed together on one strip.
 */
export interface Timeline {
  id: string;
  name: string;
  tracks: Track[];
  modifiers: Modifier[];
  blocks: Block[];
  /** one per transitioned seam, keyed by the clip it follows — absent entries just mean
   * no transition there yet. Optional (not defaulted to []) so every project saved before
   * transitions existed keeps loading with zero migration needed. */
  transitions?: Transition[];
  durationMode: 'custom' | 'even';
  timelineDurationMs: number;
  /** explicit user-set duration floor — lets the timeline hold trailing dead space past
   * its last block/keyframe (a pause on the final pose). Undefined means fully derived,
   * exactly like every project before this field existed. Never lets timelineDurationMs
   * shrink below the tiled blocks or a clamped keyframe, only extend past them. */
  durationOverrideMs?: number;
  /** when true, every track eases from its last keyframe back to its t=0 value at the
   * end of the timeline, so a looped playthrough (or export) has no seam. */
  loop: boolean;
}

export interface Project {
  name: string;
  rig: Rig;
  expressions: Expression[];
  presets: Preset[];
  timelines: Timeline[];
  activeTimelineId: string;
  fps: number;
}

export const CAMERA_ID = '__camera';

/** Every animatable path. Anything not here is not keyframeable. */
export const NODE_PROPS = [
  'surface.yaw',
  'surface.pitch',
  'flatOffset.x',
  'flatOffset.y',
  'transform.scale.x',
  'transform.scale.y',
  'transform.rotation',
  'transform.length',
  'eye.openness',
  'eye.distanceFromCenter',
  'size.x',
  'size.y',
  'color',
] as const;

export const CAMERA_PROPS = ['camera.fov', 'camera.distance', 'camera.offset.x', 'camera.offset.y'] as const;

export const PROP_LABEL: Record<string, string> = {
  'surface.yaw': 'Yaw',
  'surface.pitch': 'Pitch',
  'flatOffset.x': 'Offset X',
  'flatOffset.y': 'Offset Y',
  'transform.scale.x': 'Scale X',
  'transform.scale.y': 'Scale Y',
  'transform.rotation': 'Roll',
  'transform.length': 'Length',
  'eye.openness': 'Openness',
  'eye.distanceFromCenter': 'Eye distance',
  'size.x': 'Width',
  'size.y': 'Height',
  color: 'Color',
  'camera.fov': 'Perspective',
  'camera.distance': 'Distance',
  'camera.offset.x': 'Pan X',
  'camera.offset.y': 'Pan Y',
};

/** The one timeline every editor action and every renderer actually reads/writes. */
export function activeTimeline(p: Project): Timeline {
  return p.timelines.find((t) => t.id === p.activeTimelineId) ?? p.timelines[0];
}
