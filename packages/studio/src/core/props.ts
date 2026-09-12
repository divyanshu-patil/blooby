import type { ColorStop, Emitter, KeyValue, Modifier, Rig, RigNode, Timeline, Vec2 } from './types';
import { CAMERA_ID } from './types';

/** What a stroke is drawn in before anyone picks a colour — the eyes' own ink. */
export const STROKE_DEFAULT: ColorStop = { r: 20, g: 19, b: 24, a: 1 };

/** A limb point, or undefined when this node is not a limb or has no such point. */
function limbPoint(node: RigNode, which: string): Vec2 | undefined {
  const l = node.limb;
  if (!l) return undefined;
  return which === 'a' ? l.a : which === 'b' ? l.b : l.c;
}

/** One place that knows how a property path maps onto the rig. */
export function getProp(node: RigNode, path: string): KeyValue | undefined {
  if (path.startsWith('limb.')) return getLimbProp(node, path);
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
    case 'shape.path': return node.shapePath;
    case 'visible': return node.presence ?? 1;
    case 'opacity': return node.opacity ?? 1;
    case 'fill.enabled': return node.fill?.enabled === false ? 0 : 1;
    case 'fill.opacity': return node.fill?.opacity ?? 1;
    case 'stroke.enabled': return node.stroke?.enabled ? 1 : 0;
    case 'stroke.color': return node.stroke?.color ?? STROKE_DEFAULT;
    case 'stroke.opacity': return node.stroke?.opacity ?? 1;
    case 'stroke.width': return node.stroke?.width ?? 2;
    default: return undefined;
  }
}

function getLimbProp(node: RigNode, path: string): number | undefined {
  const l = node.limb;
  if (!l) return undefined;
  // limb.a.x / limb.b.y / limb.c.x — a point's coordinate
  const pt = /^limb\.([abc])\.([xy])$/.exec(path);
  if (pt) return limbPoint(node, pt[1])?.[pt[2] as 'x' | 'y'];
  switch (path) {
    case 'limb.hose': return l.hose;
    case 'limb.thickness': return l.thickness;
    case 'limb.bend': return l.bend;
    case 'limb.roundness': return l.roundness;
    case 'limb.taper': return l.taper;
    case 'limb.length': return l.length;
    case 'limb.foot.angle': return l.foot?.angle;
    case 'limb.foot.length': return l.foot?.length;
    case 'limb.foot.width': return l.foot?.width;
    default: return undefined;
  }
}

function setLimbProp(node: RigNode, path: string, n: number): void {
  const l = node.limb;
  if (!l || !Number.isFinite(n)) return;
  const pt = /^limb\.([abc])\.([xy])$/.exec(path);
  if (pt) {
    const p = limbPoint(node, pt[1]);
    if (p) p[pt[2] as 'x' | 'y'] = n;
    return;
  }
  switch (path) {
    case 'limb.hose': l.hose = Math.min(1, Math.max(0, n)); break;
    case 'limb.thickness': l.thickness = Math.max(0, n); break;
    case 'limb.bend': l.bend = n; break;
    case 'limb.roundness': l.roundness = Math.min(1, Math.max(0, n)); break;
    case 'limb.taper': l.taper = Math.min(1, Math.max(0, n)); break;
    case 'limb.length': l.length = Math.max(0, n); break;
    case 'limb.foot.angle': if (l.foot) l.foot.angle = n; break;
    case 'limb.foot.length': if (l.foot) l.foot.length = Math.max(0, n); break;
    case 'limb.foot.width': if (l.foot) l.foot.width = Math.max(0, n); break;
  }
}

export function setProp(node: RigNode, path: string, v: KeyValue): void {
  const n = v as number;
  if (path.startsWith('limb.')) { setLimbProp(node, path, n); return; }
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
    case 'shape.path': node.shapePath = typeof v === 'string' ? v : undefined; break;
    case 'visible': node.presence = Math.min(1, Math.max(0, n)); break;
    case 'opacity': node.opacity = Math.min(1, Math.max(0, n)); break;
    // on/off is a number so it can be keyframed; a keyframe between 0 and 1 switches at
    // the halfway mark rather than inventing a half-on paint
    case 'fill.enabled': node.fill = { ...node.fill, enabled: n >= 0.5 }; break;
    case 'fill.opacity': node.fill = { ...node.fill, opacity: Math.min(1, Math.max(0, n)) }; break;
    case 'stroke.enabled': node.stroke = { ...node.stroke, enabled: n >= 0.5 }; break;
    case 'stroke.color': node.stroke = { ...node.stroke, color: v as ColorStop }; break;
    case 'stroke.opacity': node.stroke = { ...node.stroke, opacity: Math.min(1, Math.max(0, n)) }; break;
    case 'stroke.width': node.stroke = { ...node.stroke, width: Math.max(0, n) }; break;
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
 * An effect's own properties, addressed the same way a node's are.
 *
 * Emitters and modifiers live on the timeline rather than in the rig, so they need their
 * own read/write pair — but everything above this (keyframes, autokey, the stopwatch, the
 * timeline lanes, the exporter's per-frame sampling) is written against nodeId+path and
 * does not care which side of the project the value came from.
 */
export function findEffect(tl: Timeline, id: string): Emitter | Modifier | undefined {
  return (tl.emitters ?? []).find((e) => e.id === id) ?? tl.modifiers.find((m) => m.id === id);
}

/** `fx.opacity` is the emitter's colour alpha; everything else is a plain field. */
const FX_FIELD = (path: string) => path.slice(3);

/**
 * What an optional field reads as when it has never been set.
 *
 * Without these the inspector row for, say, an orbit's radius simply vanished on an
 * emitter that had never had one written, because the field really is undefined until
 * something writes it — and a row you cannot see is a property you cannot keyframe.
 */
const FX_DEFAULT: Record<string, number> = {
  'fx.speed': 1, 'fx.speedJitter': 0, 'fx.orbitTilt': 0, 'fx.radiusX': 100, 'fx.radiusY': 100,
  'fx.scaleFrom': 1, 'fx.wobble': 0,
};

export function readEffectProp(tl: Timeline, id: string, path: string): number | undefined {
  const fx = findEffect(tl, id);
  if (!fx) return undefined;
  if (path === 'fx.opacity') return 'color' in fx ? fx.color.a : undefined;
  const v = (fx as unknown as Record<string, unknown>)[FX_FIELD(path)];
  if (typeof v === 'number') return v;
  // an orbit that was given a width but no height is a circle, not a default-sized one
  if (path === 'fx.radiusY') return readEffectProp(tl, id, 'fx.radiusX');
  return FX_DEFAULT[path];
}

export function writeEffectProp(tl: Timeline, id: string, path: string, v: number): void {
  const fx = findEffect(tl, id);
  if (!fx) return;
  if (path === 'fx.opacity') { if ('color' in fx) fx.color = { ...fx.color, a: v }; return; }
  (fx as unknown as Record<string, unknown>)[FX_FIELD(path)] = v;
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
  /**
   * Where the property lives: on a RigNode, on the rig's camera, or on an effect —
   * a modifier or an emitter, addressed by its own id in place of a nodeId.
   */
  on: 'node' | 'camera' | 'effect';
  /** [min, max, step, unit] — the inspector slider, and the sane range the copilot is told.
   *  Omitted for non-numeric properties, which are keyframeable but not copilot-settable. */
  range?: [number, number, number, string];
  /** One line, written for someone who has never seen the editor. Say which way is
   *  positive and what a typical value looks like — this goes straight into the prompt. */
  help: string;
}

export const PROPS: Record<string, PropSpec> = {
  // \u00b1360 rather than \u00b190: the projection already carries a feature round the back of
  // the sphere and out the other side at 300\u00b0 \u2014 only this range stopped a full spin being
  // reachable. The slider is coarser for it; the number field and the stage's turn tool
  // are how a gaze actually gets aimed.
  'surface.yaw': { on: 'node', label: 'Yaw', range: [-360, 360, 0.5, '\u00b0'],
    help: 'Turns the feature around the sphere. Negative is left, positive is right. It hides behind the silhouette past \u00b190\u00b0 and comes back out the other side \u2014 0 to 360 on the body is a full spin.' },
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
  visible: { on: 'node', label: 'Visible', range: [0, 1, 0.01, ''],
    help: 'How present the layer is. 1 is normal, 0 is gone — it fades AND shrinks to nothing, so keyframing it to 0 is how a feature leaves rather than pops out. Use it to retire a shape before the next clip.' },
  'shape.path': { on: 'node', label: 'Shape',
    help: 'An SVG path outline. Keyframe it and the shape morphs from one to the next. Not a number, so the copilot cannot set it.' },
  color: { on: 'node', label: 'Fill',
    help: 'Fill colour. Keyframeable, interpolated in OKLCH. Not a number, so set it with set_svg_fill rather than set_property.' },

  opacity: { on: 'node', label: 'Opacity', range: [0, 1, 0.01, ''],
    help: 'Layer opacity. 1 is solid, 0 is invisible. Fades WITHOUT shrinking (unlike visible), and fades every child with it. 0 → 1 over 150-250ms is a clean fade in.' },
  'fill.enabled': { on: 'node', label: 'Fill on', range: [0, 1, 1, ''],
    help: '1 paints the fill, 0 leaves only the stroke. A switch, not a fade — keyframes change it at the halfway mark; fade with fill.opacity.' },
  'fill.opacity': { on: 'node', label: 'Fill opacity', range: [0, 1, 0.01, ''],
    help: 'Opacity of the fill alone, leaving the stroke as it is. 1 is solid.' },
  'stroke.enabled': { on: 'node', label: 'Stroke on', range: [0, 1, 1, ''],
    help: '1 draws an outline around the shape, 0 has none. Off by default.' },
  'stroke.color': { on: 'node', label: 'Stroke',
    help: 'Outline colour, independent of the fill and keyframed on its own track. Set it with set_svg_stroke.' },
  'stroke.opacity': { on: 'node', label: 'Stroke opacity', range: [0, 1, 0.01, ''],
    help: 'Opacity of the outline alone. 1 is solid.' },
  'stroke.width': { on: 'node', label: 'Stroke width', range: [0, 40, 0.5, 'px'],
    help: 'Outline thickness in screen pixels. 2-4 is a clean line, 8+ is a cartoon outline.' },

  // limbs: points are in the body's own frame, px from its centre — +x right, +y DOWN
  'limb.a.x': { on: 'node', label: 'Shoulder X', range: [-400, 400, 1, 'px'],
    help: 'Limbs only. Where the limb meets the body (shoulder or hip), px right of the body centre. Negative is the left side.' },
  'limb.a.y': { on: 'node', label: 'Shoulder Y', range: [-400, 400, 1, 'px'],
    help: 'Limbs only. The same, px DOWN from the body centre. Arms sit around 20-60, hips around 100-130.' },
  'limb.b.x': { on: 'node', label: 'Hand X', range: [-400, 400, 1, 'px'],
    help: 'Limbs only. The hand (arm) or knee (leg), px right of the body centre. A raised hand for a wave is out past the shoulder, e.g. ±190.' },
  'limb.b.y': { on: 'node', label: 'Hand Y', range: [-400, 400, 1, 'px'],
    help: 'Limbs only. The hand or knee, px DOWN from the body centre — negative is above it, so -120 is a hand raised over the head.' },
  'limb.c.x': { on: 'node', label: 'Ankle X', range: [-400, 400, 1, 'px'],
    help: 'Legs only. The ankle, px right of the body centre. The foot sits here.' },
  'limb.c.y': { on: 'node', label: 'Ankle Y', range: [-400, 400, 1, 'px'],
    help: 'Legs only. The ankle, px DOWN from the body centre — about 200-230 stands the mascot on its feet.' },
  'limb.hose': { on: 'node', label: 'Rubber hose', range: [0, 1, 0.01, ''],
    help: 'Limbs only. 1 is a Cavalry-style rubber hose that keeps its length: bring the hand closer and it bends, pull it away and it straightens but never stretches. 0 is a plain rigid limb drawn straight between its points. In between blends the two.' },
  'limb.thickness': { on: 'node', label: 'Thickness', range: [2, 80, 0.5, 'px'],
    help: 'Limbs only. How thick the limb is at the shoulder, px. 18-28 reads as a chunky cartoon limb.' },
  'limb.bend': { on: 'node', label: 'Bend', range: [-1, 1, 0.01, ''],
    help: 'Limbs only. Which way the limb bends (the sign — flip it to bend the other way) and how: ±1 is one smooth rubber-hose arc, 0 folds at a sharp elbow. HOW MUCH it bends comes from its length and how close its points are.' },
  'limb.roundness': { on: 'node', label: 'Roundness', range: [0, 1, 0.01, ''],
    help: 'Limbs only. 1 gives fully round ends (the hand and shoulder are balls), 0 cuts them flat.' },
  'limb.taper': { on: 'node', label: 'Taper', range: [0, 1, 0.01, ''],
    help: 'Limbs only. 0 is the same thickness all along; 0.3 narrows toward the hand; 1 comes to a point.' },
  'limb.length': { on: 'node', label: 'Length', range: [20, 600, 1, 'px'],
    help: 'Limbs only. The hose\'s own length along its curve, px, and it is kept — the way Cavalry\'s rubber hose works. With the hand closer than this the limb bends to keep its length; pulled further it straightens and stops short, never stretching. About 1.1× the shoulder-to-hand distance is relaxed; +30% is clearly longer and bendier.' },
  'limb.foot.angle': { on: 'node', label: 'Foot angle', range: [-90, 90, 1, '°'],
    help: 'Legs only. Turns the foot at the ankle. 0 points it outward, away from the body; positive tips the toe up.' },
  'limb.foot.length': { on: 'node', label: 'Foot length', range: [0, 80, 0.5, 'px'],
    help: 'Legs only. How long the foot is, px. 0 hides it.' },
  'limb.foot.width': { on: 'node', label: 'Foot width', range: [0, 60, 0.5, 'px'],
    help: 'Legs only. How tall the foot is, px — about the limb thickness reads right.' },

  'camera.fov': { on: 'camera', label: 'Perspective', range: [0, 89, 1, '\u00b0'],
    help: 'Perspective, as a field-of-view angle. 0 is flat/orthographic; higher makes the sphere bulge and features near the rim fall away faster.' },
  'camera.distance': { on: 'camera', label: 'Distance', range: [1.2, 20, 0.1, 'R'],
    help: 'How far the camera sits from the sphere, measured in sphere radii.' },
  'camera.offset.x': { on: 'camera', label: 'Pan X', range: [-300, 300, 1, 'px'],
    help: 'Pans the whole view horizontally, in pixels.' },
  'camera.offset.y': { on: 'camera', label: 'Pan Y', range: [-300, 300, 1, 'px'],
    help: 'Pans the whole view vertically, in pixels.' },

  /* --- effects: an emitter or a modifier, keyed by its own id instead of a node's ---
   * `fx.` rather than the bare field name so nothing can collide with a node property,
   * and so one prefix test tells the store which side of the project to write to. */
  'fx.size': { on: 'effect', label: 'Size', range: [2, 200, 1, 'px'],
    help: 'Emitter only. How big each thing it throws is, before its own scale ramp.' },
  'fx.speed': { on: 'effect', label: 'Speed', range: [0.1, 4, 0.05, '\u00d7'],
    help: 'Emitter only. How fast everything travels, as a multiple of normal. On an orbit this is how fast the ring turns.' },
  'fx.rateMs': { on: 'effect', label: 'Every', range: [40, 2000, 10, 'ms'],
    help: 'Emitter only. Milliseconds between spawns. Smaller is a denser stream.' },
  'fx.count': { on: 'effect', label: 'At once', range: [1, 40, 1, ''],
    help: 'Emitter only. How many may be alive at a time — on an orbit, how many sit on the ring.' },
  'fx.spin': { on: 'effect', label: 'Spin', range: [-720, 720, 5, '\u00b0'],
    help: 'Emitter only. Degrees each thing turns over one full life.' },
  'fx.bow': { on: 'effect', label: 'Bow', range: [-200, 200, 1, 'px'],
    help: 'Emitter only. Sideways bend of the path — what makes a tear curve instead of falling flat.' },
  'fx.fadeStart': { on: 'effect', label: 'Fade at', range: [0, 1, 0.01, ''],
    help: 'Emitter only. How far through its life a thing starts fading out. 1 means it never does.' },
  'fx.radiusX': { on: 'effect', label: 'Ellipse X', range: [0, 400, 1, 'px'],
    help: 'Orbit only. Half-width of the ring.' },
  'fx.radiusY': { on: 'effect', label: 'Ellipse Y', range: [0, 400, 1, 'px'],
    help: 'Orbit only. Half-height of the ring.' },
  'fx.orbitTilt': { on: 'effect', label: 'Tilt', range: [-90, 90, 1, '\u00b0'],
    help: 'Orbit only. Tilts the whole ring, so it reads as seen at an angle.' },
  'fx.opacity': { on: 'effect', label: 'Opacity', range: [0, 1, 0.01, ''],
    help: 'Emitter only. Overall opacity of everything it throws.' },
  'fx.lifeMs': { on: 'effect', label: 'Lives', range: [200, 6000, 50, 'ms'],
    help: 'Emitter only. How long one thing lives — and therefore how long it takes to travel its path. On an orbit it is how long a full lap takes.' },
  'fx.scaleFrom': { on: 'effect', label: 'Starts at', range: [0.05, 3, 0.05, '\u00d7'],
    help: 'Emitter only. Size at birth, as a multiple of Size.' },
  'fx.scaleTo': { on: 'effect', label: 'Grows to', range: [0.05, 3, 0.05, '\u00d7'],
    help: 'Emitter only. Size at the end of its life, as a multiple of Size.' },
  'fx.wobble': { on: 'effect', label: 'Wander', range: [0, 40, 0.5, 'px'],
    help: 'Emitter only. How much each thing drifts sideways as it travels.' },
  'fx.speedJitter': { on: 'effect', label: 'Speed spread', range: [0, 1, 0.05, ''],
    help: 'Emitter only. 0 is a conveyor belt, 1 spreads the stream from half to double speed.' },
  'fx.amount': { on: 'effect', label: 'Amount', range: [0, 200, 1, '%'],
    help: 'Modifier only. How strong the shake, swing or pulse is. 0 turns it off.' },
  'fx.frequency': { on: 'effect', label: 'Frequency', range: [0, 12, 0.1, 'Hz'],
    help: 'Modifier only. How many times a second it repeats.' },
  'fx.amplitude': { on: 'effect', label: 'Amplitude', range: [0, 200, 1, ''],
    help: 'Modifier only. How far it travels at full amount, in the unit that modifier moves.' },
};

/** Every animatable property of an emitter or a modifier. */
export const EFFECT_PROPS: string[] = Object.keys(PROPS).filter((k) => PROPS[k].on === 'effect');
export const isEffectProp = (path: string) => path.startsWith('fx.');

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
