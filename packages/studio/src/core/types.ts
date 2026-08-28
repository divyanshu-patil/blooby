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

/**
 * Every effect, with the description the copilot's prompt is built from.
 *
 * Same contract as PROPS in ./props: one row here plus a branch in scene.ts's
 * applyModifier is the whole job, and both the Effects panel and the agent pick it up.
 * `stretch` shipped working and stayed invisible to the copilot for exactly as long as
 * this list was written out by hand in three places. See COPILOT.md.
 */
export const MODIFIERS = {
  shake: { label: 'Shake', maxFrequency: 30,
    help: 'Jitters the node with noise. frequency 6-20 Hz, amplitude 3-15 (degrees, or px on the body).' },
  float: { label: 'Float', maxFrequency: 6,
    help: 'Bobs the node on a slow sine. frequency 0.3-1.5 Hz, amplitude 3-15.' },
  stretch: { label: 'Stretch', maxFrequency: 6,
    help: 'Pulses the node and everything mapped onto it as one \u2014 squash-and-stretch for the whole rig. frequency 0.3-1.5 Hz, amplitude 3-15.' },
  pendulum: { label: 'Pendulum', maxFrequency: 6,
    help: 'Swings the node back and forth on ONE axis, like a hanging weight \u2014 set `axis` to "rotation" (default), "x", "y", "yaw" or "pitch". frequency 0.3-1.5 Hz, amplitude 6-20.' },
} as const;

/** Which single property a pendulum swings. Rotation is the one that reads as a pendulum. */
export type ModifierAxis = 'rotation' | 'x' | 'y' | 'yaw' | 'pitch';
export const MODIFIER_AXES: ModifierAxis[] = ['rotation', 'x', 'y', 'yaw', 'pitch'];

export type ModifierKind = keyof typeof MODIFIERS;
export const MODIFIER_KINDS = Object.keys(MODIFIERS) as ModifierKind[];

export interface Modifier {
  id: string;
  nodeId: string;
  kind: ModifierKind;
  /** 0–200 %, the intensity dial */
  amount: number;
  frequency: number;
  seed?: number;
  amplitude: number;
  phase?: number;
  /** pendulum only: which axis it swings on. Undefined means 'rotation'. */
  axis?: ModifierAxis;
  /** set when this effect was added to one clip specifically — it then only evaluates
   * inside that block's own time window instead of the whole timeline. Undefined means
   * global, exactly like every effect before per-clip effects existed. */
  blockId?: string;
  /**
   * The slice of its scope this effect actually runs in, in ms from the START OF THAT
   * SCOPE — the clip's own start when `blockId` is set, the timeline's when it is not.
   * Relative rather than absolute so dragging a clip elsewhere cannot desynchronise the
   * effect inside it, exactly like the phase origin. Undefined at either end means "the
   * whole scope", which is what every effect did before ranges existed.
   */
  startMs?: number;
  endMs?: number;
}

/** How an emitted particle travels. */
export type EmitterPath = 'arc' | 'orbit' | 'fall';

/**
 * Where an emitter's path begins or ends.
 *
 * Attached to a node, the point tracks whatever that node is doing — which is the whole
 * trick behind tears: parent the start to an eye and the drops come out of the eye no
 * matter how the head moves. Free, it is an offset from the body's centre.
 */
export interface Anchor {
  /** follow this layer; undefined means the offset is from the body centre */
  nodeId?: string;
  x: number;
  y: number;
}

/**
 * A stream of little things leaving the mascot: zzz, ♪, tears, a notification badge,
 * confetti, or objects orbiting overhead.
 *
 * One record covers all of those because they are the same thing with different numbers —
 * a glyph or an SVG, a path from somewhere to somewhere, some wander, and a fade. Five
 * separate "systems" would have been five sets of the same bugs.
 */
export interface Emitter {
  id: string;
  name: string;
  /** cycled in order, one per particle: ['z','z','z'] or ['♪','♫','♩','♬'] */
  glyphs: string[];
  /** used instead of a glyph when present */
  svg?: { sourceMarkup: string; viewBox: string };
  color: ColorStop;
  /** glyph size in rig units before scaleFrom/scaleTo */
  size: number;

  path: EmitterPath;
  from: Anchor;
  to: Anchor;
  /** sideways bow on an arc, in rig units — what makes a tear curve rather than fall flat */
  bow: number;
  /** orbit only: the ellipse around `from`. Undefined falls back to the travel distance. */
  radiusX?: number;
  radiusY?: number;

  /** ms between spawns, how long one lives, and how many may be alive at once */
  rateMs: number;
  lifeMs: number;
  count: number;

  /** 0–1 of a particle's life, where it starts fading out */
  fadeStart: number;
  scaleFrom: number;
  scaleTo: number;
  /** degrees over a full life */
  spin: number;

  /** off-path wander, in rig units, from the same noise the shake modifier uses */
  wobble: number;
  wobbleFrequency: number;

  seed?: number;
  /** scoped exactly like a Modifier — same clip, same relative range */
  blockId?: string;
  startMs?: number;
  endMs?: number;
}

export interface Expression {
  id: string;
  name: string;
  snapshot: Record<string, KeyValue>;
}

/** Where a preset came from. builtin/custom are local to a file; official and community
 *  arrive from the shared library and are read-only here. */
export type PresetSource = 'builtin' | 'custom' | 'official' | 'community';

export interface Preset {
  id: string;
  name: string;
  source: PresetSource;
  durationMs: number;
  tracks: Track[];
  thumbnail?: string;
  /** Library metadata, present only on presets that came from the shared catalogue.
   *  Local builtin/custom presets have no publish date or usage count to sort on. */
  publishedAt?: string;
  uses?: number;
  /** an identifying accent — shown on the preset's chip, and on every clip/track/graph
   * line it drives, so a busy timeline reads at a glance instead of every clip looking
   * the same. Undefined means "no accent", the same as every preset before this existed. */
  color?: string;
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
  /** overrides the source preset's own color for this instance — unset means "use the
   * preset's color", same fallback a gallery/blank clip (no preset color to inherit) needs. */
  color?: string;
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
  /** optional, so every project saved before emitters existed loads with no migration */
  emitters?: Emitter[];
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

// NODE_PROPS, CAMERA_PROPS, PROP_LABEL and PROP_RANGE all derive from the one PROPS
// table in ./props — import them from there. They lived here as four hand-kept lists,
// which is how the copilot came to reject a `stretch` the renderer already supported.

/** The one timeline every editor action and every renderer actually reads/writes. */
export function activeTimeline(p: Project): Timeline {
  return p.timelines.find((t) => t.id === p.activeTimelineId) ?? p.timelines[0];
}
