export type Vec2 = { x: number; y: number };
export type ColorStop = { r: number; g: number; b: number; a: number };

export type NodeKind = 'body' | 'eye' | 'group' | 'svgLayer' | 'primitive' | 'limb' | 'text';

/**
 * Which font a text layer asks for. The project keeps the NAME, never a file: the family is
 * loaded on demand (core/fonts.ts) and the exporter writes it out as outlines, so a file
 * opens anywhere and only the glyphs it actually uses are ever fetched.
 */
export interface FontRef { family: string; weight: number; style: 'normal' | 'italic' }

/** How each character of a text layer moves on its own. `progress` 0 → 1 runs it once. */
export type TextCharAnim = 'none' | 'pop' | 'fade' | 'drop' | 'rise' | 'scatter' | 'wave';

/**
 * What a text layer's line of type sits on.
 *
 * `straight` is an ordinary text box. `arc` bends it round a circle of `radius`, between
 * `start` and `end` degrees clockwise from 12 o'clock. `path` lays it along another layer's
 * outline — a drawn curve, a shape, a star — live: move or animate that layer and the words
 * follow, because the relationship is stored, not the positions.
 */
export interface TextPathSpec {
  mode: 'straight' | 'arc' | 'path';
  /** path mode: the layer whose outline the text follows */
  nodeId?: string;
  radius?: number;
  start?: number;
  end?: number;
  /** px along the path before the text begins, after alignment */
  offset?: number;
  /** px off the path along its normal — positive lifts the text away from it */
  baseline?: number;
  /** run the other way along the path */
  reverse?: boolean;
  /** turn every glyph over and read it backwards — text round the bottom of a circle */
  flip?: boolean;
  /** glyphs turn with the path (the default); false keeps every one upright */
  rotate?: boolean;
}

/**
 * A text layer's typography. The words stay words: nothing about it is converted to
 * outlines in the project — the renderer lays the glyphs out every frame, and only an
 * export turns them into vector shapes.
 */
export interface TextStyle {
  content: string;
  font: FontRef;
  /** px */
  size: number;
  /** a multiple of the size */
  lineHeight: number;
  /** px added after every character */
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  /** the box width, px, that lines wrap at. Undefined: lines break only where you break them */
  width?: number;
  path?: TextPathSpec;
  /** the typewriter: only characters from `start` up to (not including) `end` are drawn */
  reveal?: { start: number; end?: number };
  /** per-character motion, driven by a keyframable 0 → 1 `progress` */
  chars?: { kind: TextCharAnim; progress: number; stagger: number };
  /** per-letter offsets on top of the layout, by letter index — animatable as text.char.<i>.<x|y|rotation|scale|opacity> */
  charOffsets?: Record<number, { x?: number; y?: number; rotation?: number; scale?: number; opacity?: number }>;
  /** turn each letter to face the way its offset is moving (letters flying on curved paths) */
  charOrient?: boolean;
}

/**
 * A drawn curve's own setting. Its geometry is `shapePath`, exactly like any other outline,
 * so it morphs, keyframes, fills and strokes through the same code; this only says how its
 * handles are made when an anchor moves. `smooth` works them out (Catmull-Rom), `polyline`
 * has none, `bezier` keeps whatever handles were dragged.
 */
export type CurveType = 'smooth' | 'polyline' | 'bezier';

/** A mascot kept for reuse — "+ Mascot → my saved one". Its nodes, body first. */
export interface MascotTemplate { id: string; name: string; nodes: RigNode[] }

/**
 * One path of an imported SVG, re-based into the layer's -0.5..0.5 box.
 *
 * `fill`/`stroke` undefined means "the layer's own paint" — which is what makes the
 * layer's Fill and Stroke rows (and their keyframes) recolour a one-colour icon. `null`
 * means none. A colour means the artwork painted this path itself and keeps it.
 */
export interface VectorPath {
  d: string;
  fill?: ColorStop | null;
  stroke?: ColorStop | null;
  /** as a fraction of the layer's size (geometric mean of w and h), so an imported line
   *  thickens with the artwork like it did in the file */
  strokeWidth?: number;
  /** `fill-rule="evenodd"`, which is how a lot of icon art cuts its holes */
  evenOdd?: true;
}

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

/**
 * A hand or a leg: two or three points the user drags, and a few dials.
 *
 * Points are in the parent's own frame, in rig pixels from its centre — the body's, for a
 * limb on the mascot — so a limb rides the body through every move, roll and squash
 * without a single keyframe of its own. The outline is generated from these by
 * core/limb.ts; nothing about it is stored, so there is no Bézier for anyone to edit.
 */
export interface LimbRig {
  type: 'arm' | 'leg';
  /** shoulder / hip — where the limb meets the body */
  a: Vec2;
  /** hand (arm) or knee (leg) */
  b: Vec2;
  /** the end past a joint: a leg's ankle below its knee (b), or an arm's hand past its elbow (b) */
  c?: Vec2;
  /** 0 = a rigid limb of straight segments, 1 = a smooth rubber hose. Animatable, so a
   *  limb can go floppy mid-clip; the toggle writes 0 or 1. */
  hose: number;
  /** px across at the shoulder */
  thickness: number;
  /** -1..1 — how far the hose bows sideways off the straight line between its points */
  bend: number;
  /** 0 = flat ends, 1 = fully round */
  roundness: number;
  /** 0 = even thickness, 1 = tapers to nothing at the far end */
  taper: number;
  /** multiplies the reach from the shoulder; 1 = exactly to the points */
  length: number;
  /** legs: the foot at the ankle */
  foot?: { angle: number; length: number; width: number };
  /**
   * Where the foot is planted, in WORLD (composition-centred) px — set by pinning. While
   * it is set the limb's end point is drawn here whatever the body does, and the knee
   * follows the hip→foot line, so the mascot moves and the foot stays on the ground.
   */
  pin?: Vec2;
  /** any other point held in WORLD px — a hip or a knee that stays where it was put */
  pins?: Partial<Record<'a' | 'b' | 'c', Vec2>>;
}

export interface RigNode {
  id: string;
  name: string;
  kind: NodeKind;
  /**
   * The layer this one rides on. The body is the mascot: a child of it is ATTACHED and
   * follows every move, turn and squash. `null` on anything but the root is a WORLD layer,
   * placed in composition coordinates by `flatOffset` from the centre.
   */
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

  /**
   * The pivot rotation, scale and squish happen around, in the layer's own unscaled px from
   * its centre (CSS transform-origin). {0,0} — or absent — is the centre, as it always was.
   * Moving it never moves the layer at rest; it changes what a roll or a squash swings about.
   */
  anchor?: Vec2;

  /**
   * Squash and stretch as its own dial, multiplied onto `transform.scale` — so a squish
   * preset can be dropped over a clip that already animates scale without fighting it.
   * {1,1} (or absent) is neutral. Clamped 0.4–1.8 where it is read.
   */
  squish?: Vec2;

  /**
   * The visible stretch of an outline's stroke, as fractions of its length (a trim path).
   * start 0 / end 1 is the whole line. start > end is not an error: it is the same span
   * drawn the other way round, so a draw-on can run backwards through it.
   */
  trim?: { start: number; end: number; offset?: number };

  /**
   * The layer's effect stack, drawn in order: glow, blur, shadow, rgb split, slices,
   * scanlines, flicker, jitter, echo, goo. One of each kind per layer; every numeric param is
   * animatable as `effect.<kind>.<param>` (see EFFECTS in core/effects.ts).
   */
  effects?: LayerEffect[];
  /** how the layer composites over what is under it */
  blend?: BlendMode;
  /** a gradient paint instead of the flat fill: two or more stops, linear at `angle` or radial */
  gradient?: { type: 'linear' | 'radial'; angle: number; stops: { at: number; color: ColorStop }[] };
  /** clip this layer (and what it holds) to another layer's outline, as it is drawn — or to outside it */
  mask?: { nodeId: string; invert?: boolean };
  /**
   * 2.5D: depth away from the camera (px; + is further, smaller, slower to pan) for a layer in
   * the world, and turns about the layer's own X and Y axes in degrees (a card flip). On a
   * mascot, rotateY turns the sphere, carrying its features round the back.
   */
  depth?: { z: number; rotateX: number; rotateY: number };

  /** Base geometry in rig units. body: x = radius. eye/primitive: x = width, y = height. */
  size: Vec2;

  color: ColorStop;
  /** the layer-list eye: hidden in the editor, and never drawn or exported */
  visible: boolean;
  /**
   * How present the layer is, 0–1, and animatable (`visible`). Distinct from the boolean
   * above, which is a workspace toggle: this one fades AND shrinks, so keyframing it to 0
   * is how a shape leaves the scene rather than popping out of it. Undefined means 1.
   */
  presence?: number;
  /**
   * The ONE draw order. Higher paints later, on top. Every layer's position in the list,
   * the stage, the timeline lanes and the exported Lottie comes from this number and
   * nothing else — `reorderLayer` in core/layers.ts keeps it dense and unique.
   */
  zIndex: number;
  /** Layer opacity, 0–1, animatable. Fades without shrinking — unlike `presence`, which
   *  does both. Cascades to children. Undefined means 1. */
  opacity?: number;
  /** the layer-list padlock: not selectable or draggable on the stage. Never exported. */
  locked?: boolean;
  /**
   * When true the layer exists only where the active timeline gives it an appearance
   * range — a preset's "Hi!" bubble should not hang around in every other clip. Undefined
   * means always present unless a range narrows it, which is every layer before this.
   */
  ranged?: boolean;

  /** Fill paint beyond its colour (which stays `color`, so every old keyframe still
   *  drives it). Undefined means on, fully opaque. */
  fill?: { enabled?: boolean; opacity?: number };
  /** Stroke paint. Undefined means no stroke — which is every layer before this existed. */
  /** taper: 0 an even line; up to 1 thin at both ends and full width in the middle, like a brush stroke */
  stroke?: { enabled?: boolean; color?: ColorStop; opacity?: number; width?: number; lineCap?: LineCap; lineJoin?: LineJoin; taper?: number };

  limb?: LimbRig;

  eye?: {
    linkedToId: string | null;
    openness: number;
    /** friendlier control that drives surface.yaw; sign comes from the node's own side */
    distanceFromCenter: number;
  };

  primitive?: { shape: 'circle' | 'pill' };

  /**
   * An SVG path `d` in a -0.5..0.5 box, drawn instead of the node's ellipse/pill and
   * scaled to its size. Keyframe it (`shape.path`) and the shape morphs — core/path.ts
   * resamples both outlines to the same points and interpolates them, so any closed shape
   * becomes any other. Undefined means the node draws its plain primitive, as always.
   */
  shapePath?: string;
  /** what generated `shapePath`, so the parameter editor can keep offering its dials.
   *  Absent once the path is hand-edited — the dials no longer describe it. */
  /** `kind` is a SHAPE_LIBRARY id — a generated outline (a ShapeKind) or library artwork */
  shape?: { kind: string; points?: number; innerRatio?: number; cornerRadius?: number; vertexRadius?: number; rotation?: number };

  /**
   * An imported SVG. `sourceMarkup` is the original, always kept. `paths` is its geometry
   * parsed into the layer's unit box — what the stage draws and the exporter writes as
   * native Lottie shapes. Absent when nothing in it could be parsed, in which case the
   * markup is drawn as-is and the exporter says it could not carry it.
   */
  svg?: { sourceMarkup: string; viewBox: string; paths?: VectorPath[]; unsupported?: string[] };

  /**
   * The part of a mascot this layer plays — 'body', 'eyeL', 'armR'. A `body` node IS a
   * mascot (its layers ride it), and roles are how one preset animates any of them: a
   * preset keyed to 'eyeL' lands on the second mascot's left eye because that eye says
   * so. Undefined on the first mascot of an older file, whose ids are the roles.
   */
  role?: string;
  /** kind 'text' */
  text?: TextStyle;
  /** a drawn curve (its outline is `shapePath`) */
  curve?: { type: CurveType };
  /** drawn in the editor as a guide, left out of every export — a path text follows */
  guide?: boolean;
}

/** Every outline core/path.ts can generate. `custom` is what hand-editing produces. */
export type ShapeKind = 'circle' | 'pill' | 'rect' | 'polygon' | 'star' | 'pebble' | 'capsule' | 'roundedRect' | 'blob' | 'octopus';

export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'add' | 'difference';
export type EffectKind = 'glow' | 'blur' | 'shadow' | 'rgbSplit' | 'slices' | 'scanlines' | 'flicker' | 'jitter' | 'echo' | 'goo' | 'wave' | 'outline' | 'grain' | 'hueShift';
export interface LayerEffect {
  kind: EffectKind;
  enabled?: boolean;
  /** numeric params by name — each kind's list and ranges are in core/effects.ts */
  params: Record<string, number>;
  color?: ColorStop;
}

export interface Rig {
  id: string;
  /** set on an EVALUATED rig only: the time it was evaluated at, for effects that move on their own clock (flicker, jitter, slices) */
  clockMs?: number;
  nodes: Record<string, RigNode>;
  rootId: string;
  camera: {
    /** 0 = orthographic, higher = stronger perspective divide */
    fov: number;
    /** eye distance in body radii */
    distance: number;
    offset: Vec2;
    /** zoom about the composition centre, 1 = none — a push-in is zoom 1 → 1.3 */
    zoom?: number;
  };
}

export type EasingCurve =
  | { type: 'linear' }
  /** `hold` keeps the value until the next keyframe and then cuts — a shape switch */
  | { type: 'preset'; name: 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'elastic' | 'hold' | 'spring' | 'anticipate' | 'overshoot' }
  | { type: 'bezier'; p1: Vec2; p2: Vec2 };

/** A string value is an SVG path `d` — see core/path.ts, which morphs between two. */
export type KeyValue = number | ColorStop | Vec2 | string;

export interface Keyframe {
  id: string;
  time: number;
  value: KeyValue;
  easingOut: EasingCurve;
  /**
   * Set on a key that a Bounce or Elastic easing generated: the id of the key whose curve it
   * belongs to. Picking another easing on that key removes these again.
   */
  bakedFrom?: string;
  /** On the key a Bounce/Elastic was picked for — the curve it now stands for as points */
  bakedAs?: 'bounce' | 'elastic';
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
  // `help` is written for the copilot: argument names, units and useful ranges. `blurb` is
  // written for a person choosing from a list, where a backtick is noise.
  shake: { label: 'Shake', maxFrequency: 30, defaults: { amount: 100, frequency: 12, amplitude: 6, seed: 1 },
    blurb: 'Jitters it with noise. Fast and small is a shiver; slower and wider is a rattle.',
    help: 'Jitters the node with noise. frequency 6-20 Hz, amplitude 3-15 (degrees, or px on the body).' },
  float: { label: 'Float', maxFrequency: 6, defaults: { amount: 100, frequency: 0.6, amplitude: 8, phase: 0 },
    blurb: 'Bobs it up and down on a slow sine — the idle drift of something weightless.',
    help: 'Bobs the node on a slow sine. frequency 0.3-1.5 Hz, amplitude 3-15.' },
  stretch: { label: 'Stretch', maxFrequency: 6, defaults: { amount: 100, frequency: 0.8, amplitude: 12, phase: 0 },
    blurb: 'Pulses its size, carrying everything mapped onto it — squash and stretch for the whole rig.',
    help: 'Pulses the node and everything mapped onto it as one \u2014 squash-and-stretch for the whole rig. frequency 0.3-1.5 Hz, amplitude 3-15.' },
  pendulum: { label: 'Pendulum', maxFrequency: 6, defaults: { amount: 100, frequency: 0.7, amplitude: 10, phase: 0 },
    blurb: 'Swings it back and forth on one axis, like a hanging weight. Rotation by default; the axis is a dial.',
    help: 'Swings the node back and forth on ONE axis, like a hanging weight \u2014 set `axis` to "rotation" (default), "x", "y", "yaw" or "pitch". frequency 0.3-1.5 Hz, amplitude 6-20.' },
  walk: { label: 'Walk', maxFrequency: 4, defaults: { amount: 100, frequency: 1.8, amplitude: 36, phase: 0 },
    blurb: 'A procedural walk cycle: travels, bobs, plants each foot and swings the arms. On a mascot with legs.',
    help: 'Walks a MASCOT (nodeId = its body): it travels amplitude px per step (negative walks left), frequency steps per second (1.5-2.5), feet planted on the ground during each stance, knees bend, arms swing opposite, body bobs and leans. Legs need knees. Use set_effect_range for when it walks.' },
  follow: { label: 'Follow-through', maxFrequency: 6, defaults: { amount: 100, frequency: 3, amplitude: 70, phase: 0 },
    blurb: 'Secondary motion: the layer lags behind its mascot and springs back past its rest — faces, hands, antennae.',
    help: 'Follow-through on a PART (the face, a hand, a hat): when its mascot moves, it lags and overshoots like it is on a spring. frequency is the spring (2-5 Hz, lower = floppier), amplitude the lag strength 20-100.' },
  bounce: { label: 'Bounce', maxFrequency: 4, defaults: { amount: 100, frequency: 1.2, amplitude: 40, phase: 0 },
    blurb: 'Hops on the spot: up, hang, down, and a squash on every landing — excitement, a tap target calling out.',
    help: 'Hops the node on the spot \u2014 a parabola up and down with a squash on each landing. frequency hops per second (0.8-2), amplitude the hop height in px (15-80).' },
  breathe: { label: 'Breathe', maxFrequency: 2, defaults: { amount: 100, frequency: 0.25, amplitude: 5, phase: 0 },
    blurb: 'A slow inhale and exhale: taller and a touch narrower, then back — the quietest sign of life for an idle.',
    help: 'Breathing: the node grows taller and slightly narrower on a slow sine and back (squish, so a feet anchor keeps it grounded). frequency 0.15-0.5 Hz, amplitude percent 2-10.' },
  orbit: { label: 'Orbit', maxFrequency: 3, defaults: { amount: 100, frequency: 0.3, amplitude: 14, phase: 0 },
    blurb: 'Drifts round a small ellipse with a gentle tilt — weightless, dreamy, underwater.',
    help: 'Drifts the node around a small ellipse (wider than tall) with a slight tilt that follows it. frequency 0.15-0.8 Hz, amplitude radius px 5-40.' },
  heartbeat: { label: 'Heartbeat', maxFrequency: 3, defaults: { amount: 100, frequency: 1.1, amplitude: 10, phase: 0 },
    blurb: 'Lub-dub: two quick pulses in size, then a rest — love, a like, something alive and eager.',
    help: 'Pulses the node\'s size twice per beat (lub-dub) then rests. frequency beats per second 0.8-2, amplitude percent 5-25.' },
  jelly: { label: 'Jelly', maxFrequency: 8, defaults: { amount: 100, frequency: 4, amplitude: 70, phase: 0 },
    blurb: 'Soft-body deformation: the outline stretches with speed, splats flat on impact and wobbles back.',
    help: 'Soft body on a MASCOT or shape: its OUTLINE deforms from its own vertical motion \u2014 stretched when moving fast, flattened and widened at the bottom when it lands (volume kept), then wobbles. amplitude 20-100 (strength), frequency 3-6 Hz (wobble).' },
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
  /** walk only: a finished walk keeps the mascot where it got to until here (same clock as
   *  startMs) instead of for the rest of its scope — how a walk inside a longer sequence ends */
  holdUntilMs?: number;
}

/** How an emitted particle travels. */
export type EmitterPath = 'arc' | 'orbit' | 'fall' | 'burst';

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
  /**
   * When set, x/y are multiples of the layer's own half-size rather than rig units — so
   * (1, 0) is its right edge whatever that edge currently is. This is what "snapped to
   * part of a shape" means: the point rides the shape as it scales, squashes and blinks,
   * instead of sitting where the edge used to be.
   */
  rel?: boolean;
}

/**
 * A stream of little things leaving the mascot: zzz, ♪, tears, a notification badge,
 * confetti, or objects orbiting overhead.
 *
 * One record covers all of those because they are the same thing with different numbers —
 * a glyph or an SVG, a path from somewhere to somewhere, some wander, and a fade. Five
 * separate "systems" would have been five sets of the same bugs.
 */
/**
 * One kind of thing an emitter throws.
 *
 * An emitter cycles its parts, so a confetti burst is five parts in five colours and a
 * sleeper's zzz is three of the same at different sizes. Each carries its own speed and
 * size multipliers, which is what stops a stream reading as a metronome.
 */
export interface EmitterPart {
  id: string;
  /** a shape from core/emitters SHAPE_LIBRARY */
  shapeId?: string;
  /** an SVG kept with the project */
  svgAssetId?: string;
  /** a plain character, still supported — the quickest way to try something */
  glyph?: string;
  /** its own colour, or the emitter's when absent ("automatic") */
  color?: ColorStop;
  /** how often this part comes up relative to the others */
  weight: number;
  /** multiplies the emitter's travel speed for this part */
  speed: number;
  sizeScale: number;
  /** degrees over a life, added to the emitter's own spin */
  spin: number;
}

export interface Emitter {
  id: string;
  name: string;
  /** cycled in order, one per particle: ['z','z','z'] or ['♪','♫','♩','♬'].
   *  Kept for projects saved before `parts`; `parts` wins when present. */
  glyphs: string[];
  /** what this emitter throws. Undefined falls back to `glyphs`. */
  parts?: EmitterPart[];
  /** used instead of a glyph when present */
  svg?: { sourceMarkup: string; viewBox: string };
  /** which entry in Project.svgAssets `svg` came from, so the picker can show it selected */
  svgAssetId?: string;
  color: ColorStop;
  /** glyph size in rig units before scaleFrom/scaleTo */
  size: number;
  /**
   * How a particle's progress along its path is shaped, and how much its speed varies.
   * Linear travel reads as a conveyor belt; `easing` bends one particle's journey and
   * `speedJitter` spreads the whole stream across a range so no two match.
   */
  easing?: EasingCurve;
  /** 0 = every particle the same speed, 1 = anywhere from half to double */
  speedJitter?: number;
  /**
   * How fast everything travels, as a multiple. Defaults to 1.
   *
   * `lifeMs` used to be the only lever, but it means two things at once — how long a
   * particle exists AND how long it takes to get there — so speeding an orbit up also
   * emptied it.
   */
  speed?: number;

  path: EmitterPath;
  from: Anchor;
  to: Anchor;
  /** sideways bow on an arc, in rig units — what makes a tear curve rather than fall flat */
  bow: number;
  /** orbit only: the ellipse around `from`. Undefined falls back to the travel distance. */
  radiusX?: number;
  radiusY?: number;
  /** orbit only: tilts the whole ellipse, in degrees — a ring seen at an angle */
  orbitTilt?: number;

  /** ms between spawns, how long one lives, and how many may be alive at once */
  rateMs: number;
  lifeMs: number;
  count: number;

  /** 0–1 of a particle's life, where it starts fading out */
  fadeStart: number;
  /**
   * `path: "burst"` physics — every particle is born at once and flies: out at `velocity`
   * (rig units/s, ± velocityJitter), `angle` ± spread/2 degrees, slowed by `drag` (per second),
   * pulled by `gravity`, stirred by `turbulence`. Closed form, so any instant is exact.
   */
  velocity?: number;
  velocityJitter?: number;
  angle?: number;
  spread?: number;
  drag?: number;
  gravity?: number;
  turbulence?: number;
  /** particles fly to points spread over another layer's shape — an assembly */
  attract?: { nodeId: string; startMs: number; durationMs: number; fill?: boolean };
  /** colour at the end of a particle's life; it lerps from `color` */
  colorTo?: ColorStop;
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

/**
 * When a layer is on screen, scoped exactly like an emitter: the clip when `blockId` is
 * set, the timeline otherwise, with `startMs`/`endMs` measured from the start of that
 * scope. A range decides whether the layer EXISTS; its opacity keyframes decide how it
 * looks while it does. The fades are the one bit of "how it looks" that belongs here,
 * because they are about the range's own edges.
 */
export interface Appearance {
  id: string;
  nodeId: string;
  blockId?: string;
  startMs?: number;
  endMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
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
  /**
   * The half of a preset that is not keyframes. "Sleepy" is not sleepy without the zzz
   * and "Cold" is not cold without the shiver, so a preset carries its own effects and
   * emitters and they are scoped to the clip when it is placed — a preset that only
   * carried tracks would be half an animation with no way to say so.
   * Both optional: every preset written before this existed is still valid.
   */
  modifiers?: Omit<Modifier, 'id' | 'blockId'>[];
  emitters?: Omit<Emitter, 'id' | 'blockId'>[];
  /**
   * Layers a preset needs that the rig may not have — the "Hi!" bubble, the arm that
   * waves. Added to the rig when the preset is placed, unless a layer with that id is
   * already there (then the preset animates it, which is how a user's own arm gets used).
   */
  layers?: RigNode[];
  /** when those layers are on screen, scoped to the clip like the effects above */
  appearances?: Omit<Appearance, 'id' | 'blockId'>[];
  /** what it shows off, for the preset browser — "Hand + SVG + Rubber Hose" */
  tagline?: string;
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
  /**
   * The mascot whose lane this clip plays in — a body id. Every mascot has its own row of
   * clips, tiled end to end and running alongside the others, so the first can be Happy
   * while the second Talks. Undefined is the first mascot's lane, which is where every clip
   * made before there was more than one mascot already is.
   */
  mascotId?: string;
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
  /**
   * This state's own layers, while it is NOT the active one. Every timeline keeps its own rig —
   * its own mascots, shapes and their base values — so editing one state never changes another.
   * The active timeline's rig is `Project.rig` (what every editor action reads and writes);
   * switching parks it here and brings the other one out: `switchTimeline`. Read another
   * timeline's through `rigOf` / `asTimeline`, never `Project.rig` directly.
   */
  rig?: Rig;
  tracks: Track[];
  modifiers: Modifier[];
  /** optional, so every project saved before emitters existed loads with no migration */
  emitters?: Emitter[];
  /** when each layer is on screen in THIS state — see Appearance */
  appearances?: Appearance[];
  blocks: Block[];
  /**
   * The marker naming this state's frames inside its animation, when that animation holds
   * several poses. Set on import so a `.lottie` whose states are markers of one strip
   * round-trips instead of every state claiming the whole composition. Blooby's own
   * exports compute it from the strip layout rather than reading it back from here.
   */
  segment?: string;
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
  /**
   * How long to blend INTO this state, and along what curve.
   *
   * Entering a state was always a lerp from the outgoing pose, but the duration lived
   * only in whatever `setState` happened to be passed — so an integration that called
   * `setState('happy')` with no options got a generic 300ms no matter how the state was
   * authored. Stored per state, this is the authored default; an explicit `duration` in
   * the call still wins. Undefined means DEFAULT_STATE_TRANSITION_MS.
   */
  transitionMs?: number;
  transitionEasing?: EasingCurve;
  /**
   * The animation this state plays, when it is not this timeline's own baked one.
   *
   * Set only by importing a `.lottie`: the state machine there points at animations
   * Blooby did not author and cannot re-draw, so the id is kept and the original
   * animation JSON travels with the project (`Project.importedAnimations`) to be written
   * back out untouched. Undefined — every timeline authored here — means "bake me".
   */
  animationId?: string;
}

/**
 * dotLottie state-machine inputs, spelled exactly as the runtime's JSON spells them
 * ("Boolean"/"Numeric"/"String"/"Event") so the export is close to an identity mapping
 * rather than a translation nobody can check against a player. The friendly labels
 * ("is true", ">") live in the UI; the wire format never sees them.
 */
export type InputType = 'Boolean' | 'Numeric' | 'String' | 'Event';
export type InputValue = boolean | number | string;

export interface SmInput {
  name: string;
  type: InputType;
  /** the default the machine starts with — dotLottie's `value`. Event inputs have none. */
  value?: InputValue;
  description?: string;
}

/**
 * A guard's `conditionType`, verbatim from dotlottie-rs. `Fired` is ours and never
 * reaches the wire: an Event guard is `{ type: 'Event', inputName }` with no condition
 * at all, so this is just how the editor says "this input fired".
 */
export type ConditionOp =
  | 'Equal' | 'NotEqual'
  | 'GreaterThan' | 'GreaterThanOrEqual' | 'LessThan' | 'LessThanOrEqual'
  | 'Fired';

export interface SmCondition {
  /** an SmInput.name — never a free-text expression */
  input: string;
  operator: ConditionOp;
  value?: InputValue;
}

/**
 * One conditional edge between two states.
 *
 * `from`/`to` are timeline ids, not names, so renaming a state cannot break an edge.
 * Names are resolved once, at export.
 */
/** `SmTransition.from` for a rule that fires from whatever state is current. */
export const ANY_STATE = '*';

export interface SmTransition {
  id: string;
  /** a state (timeline) id, or ANY_STATE — "when this holds, go to `to`", from anywhere */
  from: string;
  to: string;
  conditions: SmCondition[];
  /**
   * How several conditions combine. A dotLottie guard list is always ANDed — there is no
   * OR in the format — so an OR fans out to one transition per condition on export. Same
   * semantics, deterministically, instead of an invented `logic` field a player ignores.
   */
  logic?: 'AND' | 'OR';
  /** the blend into `to`, in ms. 0 (or absent) exports as a plain instant Transition. */
  durationMs?: number;
  easing?: EasingCurve;
}

/**
 * The state machine itself. States are the project's timelines — they already were, in
 * the exporter and in setState — so this holds only what a timeline cannot: the shared
 * inputs, the conditional edges between states, and which state the machine boots into.
 */
export interface StateMachineDef {
  id: string;
  /** where each state (and ANY_STATE) sits in the state editor's graph, once moved by hand */
  layout?: Record<string, Vec2>;
  /** a timeline id; falls back to the first timeline when unset or stale */
  initialStateId?: string;
  inputs: SmInput[];
  transitions: SmTransition[];
}

/** An SVG kept with the project so it can be reused — by an emitter, or as a layer. */
export interface SvgAsset { id: string; name: string; markup: string; viewBox: string }

export interface Project {
  name: string;
  rig: Rig;
  /** optional, so every project saved before the library existed loads untouched */
  svgAssets?: SvgAsset[];
  expressions: Expression[];
  presets: Preset[];
  timelines: Timeline[];
  activeTimelineId: string;
  fps: number;
  /**
   * The canvas every render and export uses, in px. The mascot is placed at its centre at
   * its own pixel size, so changing this reframes rather than distorts. Read it through
   * `compOf()` in core/defaults.ts; absent means the 720×720 every older project used.
   */
  composition?: { width: number; height: number };
  /**
   * Which document shape this project was written in — see core/migrate.ts, which is the
   * only thing that reads or writes it. Optional because every project saved before
   * versioning existed has no value here, and that absence is exactly what identifies it.
   */
  schemaVersion?: number;
  /** Optional so every project saved before state machines existed loads untouched —
   *  `machineOf()` in core/stateMachine.ts is the one place that defaults it. */
  stateMachine?: StateMachineDef;
  /** animation id → Lottie JSON, for animations that came in from an imported `.lottie`
   *  and are re-exported verbatim. Never populated by anything authored here. */
  importedAnimations?: Record<string, unknown>;
  /** mascots saved for reuse from "+ Mascot" */
  mascotTemplates?: MascotTemplate[];
}

export const CAMERA_ID = '__camera';

// NODE_PROPS, CAMERA_PROPS, PROP_LABEL and PROP_RANGE all derive from the one PROPS
// table in ./props — import them from there. They lived here as four hand-kept lists,
// which is how the copilot came to reject a `stretch` the renderer already supported.

/** The one timeline every editor action and every renderer actually reads/writes. */
export function activeTimeline(p: Project): Timeline {
  return p.timelines.find((t) => t.id === p.activeTimelineId) ?? p.timelines[0];
}

/** A rig with nothing on it — what a new timeline starts as. `rootId` is filled by the first mascot added. */
export const emptyRig = (like: Rig): Rig => ({ ...like, id: like.id, nodes: {}, rootId: '', camera: structuredClone(like.camera) });

/** The rig `tl` plays on: the live `p.rig` when it is active, its own otherwise. */
export function rigOf(p: Project, tl: Timeline): Rig {
  return tl.id === activeTimeline(p).id ? p.rig : tl.rig ?? p.rig;
}

/** `p` as if timeline `id` were active, with that timeline's own rig — for drawing or exporting another state. */
export function asTimeline(p: Project, id: string): Project {
  const tl = p.timelines.find((t) => t.id === id);
  if (!tl || tl.id === activeTimeline(p).id) return p;
  return { ...p, activeTimelineId: id, rig: rigOf(p, tl) };
}

/**
 * Make timeline `id` the active one, in place: the current rig is parked on the timeline being
 * left, and the incoming timeline's own rig becomes `p.rig`. The only way the active timeline
 * should change, so layers never leak from one state into another.
 */
export function switchTimeline(p: Project, id: string): boolean {
  const from = activeTimeline(p), to = p.timelines.find((t) => t.id === id);
  if (!to) return false;
  if (to.id === from.id) return true;
  if (p.timelines.includes(from)) from.rig = p.rig;
  p.rig = to.rig ?? emptyRig(p.rig);
  delete to.rig;
  p.activeTimelineId = to.id;
  return true;
}
