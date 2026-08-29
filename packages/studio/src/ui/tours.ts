import type { DriveStep } from 'driver.js';
import type { TourEntry } from '../kit/TourMenu';

/**
 * Feature tours for the editor.
 *
 * Split by topic rather than run as one long sequence: nobody finishes a fifteen-step
 * walkthrough, and someone who came to work out the graph editor should not have to sit
 * through presets first. Each is four to six steps and stands alone.
 *
 * Steps whose anchor is not on screen are dropped by startTour, so a tour that mentions
 * a panel you have not opened degrades to the steps that do apply rather than pointing
 * at nothing.
 */

const intro: DriveStep[] = [
  { popover: { title: 'The editor', description: 'A quick pass over the four areas. Escape skips it — the ? button brings this back, along with tours of individual features.' } },
  { element: '[data-tour="stage"]', popover: { title: 'The stage', description: 'Your mascot, live. Everything you change here is what gets keyframed.' } },
  { element: '[data-tour="rail-left"]', popover: { title: 'Layers and presets', description: 'Layers are the parts of the rig — pick one to edit it. Presets are ready-made animations you drop in as clips.' } },
  { element: '[data-tour="rail-right"]', popover: { title: 'Properties', description: 'Everything about the selected layer, grouped into tabs: the node itself, its eyes, effects, states, and the copilot.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'The timeline', description: 'Clips along the top, one lane per animated property below.' } },
  { element: '[data-tour="export"]', popover: { title: 'Export', description: 'Lottie, GIF or MP4 — the same renderer as the stage, so what you see is what ships.' } },
];

const posing: DriveStep[] = [
  { popover: { title: 'Posing the mascot', description: 'How the head turns, and why it looks the way it does.' } },
  { element: '[data-tour="tool-turn"]', popover: { title: 'The turn tool', description: 'Switch to this (or press T) and drag on the stage to turn the head. The features are mapped onto a sphere, so they travel along its curve instead of sliding flat.' } },
  { element: '[data-tour="stage"]', popover: { title: 'Yaw and pitch', description: 'Dragging sideways is yaw, up and down is pitch — the readout in the corner shows both. The body squashes slightly as it turns, which is what makes a turn read at small angles.' } },
  { element: '[data-tour="tab-node"]', popover: { title: 'Exact values', description: 'The Node tab has the same yaw and pitch as numbers, for when you need a precise angle rather than a drag.' } },
  { element: '[data-tour="tab-eyes"]', popover: { title: 'Eyes', description: 'Openness, size and spacing. Eyes can be linked so one drag moves both together — useful for blinks, which otherwise drift apart.' } },
];

const animating: DriveStep[] = [
  { popover: { title: 'Animating', description: 'Turning a property into motion, and shaping how it moves.' } },
  { element: '[data-tour="rail-right"]', popover: { title: 'Start with the stopwatch', description: 'Every property row has one. Clicking it turns that property into an animated track — this is the step that turns a pose into an animation.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'Keyframes', description: 'Each diamond is a keyframe. Move the playhead, change a value, and a new one appears. Double-click a keyframe to delete it.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'Selecting several', description: 'Drag across the lanes to rubber-band select, or shift-click to add one at a time. ⌘C then ⌘V copies the whole group to the playhead, keeping its shape.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'Easing', description: 'Click a single keyframe and an easing button appears in the toolbar above, opening the curve editor. Easing is what separates mechanical motion from motion that feels intentional.' } },
  { element: '[data-tour="loop"]', popover: { title: 'Loop', description: 'Plays the timeline end to end, easing the last frame back onto the first so the seam disappears.' } },
];

const graph: DriveStep[] = [
  { popover: { title: 'The graph editor', description: 'When the diamonds are not enough to see what is wrong.' } },
  { element: '[data-tour="graph-toggle"]', popover: { title: 'Switch to Graph', description: 'Tracks view shows you WHEN things happen. Graph view shows you HOW — each property becomes a curve of value against time.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'Reading the curves', description: 'A steep section is fast movement, a flat one is a hold. Overshoot and stutter are visible here as shapes long before you can spot them in playback.' } },
  { element: '[data-tour="timeline"]', popover: { title: 'Shaping a segment', description: 'Select a keyframe and open the curve editor from the toolbar to edit the easing into it — drag the handles, or pick a named curve.' } },
];

const clips: DriveStep[] = [
  { popover: { title: 'Clips and presets', description: 'Building an animation out of reusable pieces.' } },
  { element: '[data-tour="rail-left"]', popover: { title: 'The preset library', description: 'Built-in, official and community animations. Click one to append it, or drag it onto the strip to drop it at a position.' } },
  { element: '[data-tour="strip"]', popover: { title: 'The clip strip', description: 'Each block is one preset playing over a span of time. Drag to reorder, drag the right edge to stretch, and the keyframes inside retime with it.' } },
  { element: '[data-tour="save-preset"]', popover: { title: 'Make your own', description: 'Turns the current selection into a reusable preset. From there you can publish it to the community.' } },
  { element: '[data-tour="tab-fx"]', popover: { title: 'Modifiers and effects', description: 'Procedural motion layered on top of your keyframes, and things thrown off the mascot. There is a tour of its own for these.' } },
];

const states: DriveStep[] = [
  { popover: { title: 'States and export', description: 'Several animations in one file, switchable at runtime.' } },
  { element: '[data-tour="timeline-add"]', popover: { title: 'A new timeline is a new state', description: 'This adds a second independent animation on the same rig — idle, happy, thinking. Each becomes a separate playable state in the exported .lottie.' } },
  { element: '[data-tour="timeline-tabs"]', popover: { title: 'Switching between them', description: 'Each tab is one state. Double-click to rename — the name is what you address it by at runtime.' } },
  { element: '[data-tour="tab-states"]', popover: { title: 'The state machine', description: 'Defines how states hand over: which one starts, and how each transitions into the next.' } },
  { element: '[data-tour="export"]', popover: { title: 'Exporting', description: 'A .lottie bundles every timeline as its own state plus the machine that drives them. GIF and MP4 flatten the active timeline instead.' } },
];

/** Modifiers, emitters and their ranges — the half of the app that is not keyframes. */
const effects: DriveStep[] = [
  { popover: { title: 'Modifiers and effects', description: 'Two different things. A modifier shakes, swings or pulses the rig itself. An effect throws something off it — zzz, tears, confetti, objects in orbit. Neither one touches your keyframes; they layer on top.' } },
  { element: '[data-tour="tab-fx"]', popover: { title: 'Where they live', description: 'Both sections fold, so whichever you are working in gets the height. The add buttons stay reachable while folded.' } },
  { element: '[data-tour="fx-target"]', popover: { title: 'Pick what it lands on', description: 'A new modifier or effect goes on the layer chosen here — the eyes rather than the whole mascot, say. Clicking the one already chosen clears it back to the body.' } },
  { element: '[data-tour="strip"]', popover: { title: 'Scope', description: 'With a clip selected, new effects belong to that clip and travel with it. With nothing selected they are global, bounded to the clips already on the strip so a preset you add later does not land underneath one.' } },
  { element: '[data-tour="fx-range"]', popover: { title: 'When it runs', description: 'Drag the handles to narrow an effect to part of its scope. The bar you are dragging is drawn on the strip too, so you can see it against the clips.' } },
  { element: '[data-tour="stage"]', popover: { title: 'Aiming an effect', description: 'Select an emitter and its path appears on the stage: a start point, an end point, and a knob where the particles start to fade. Drag an end near a layer and it snaps to it — which parents it, so tears follow the eye wherever the head moves.' } },
];

/** Outlines, morphing, and retiring a feature. */
const shapes: DriveStep[] = [
  { popover: { title: 'Shapes and morphing', description: 'Any layer can carry an outline instead of its plain pill or ellipse — and two outline keyframes morph between them. This is how an eye becomes a star.' } },
  { element: '[data-tour="tab-node"]', popover: { title: 'The shape editor', description: 'Pick a primitive and turn its dials — a star\u2019s points and waist, a rect\u2019s corners, how rounded the points are — or paste an SVG path straight in. It opens on the layer\u2019s own natural shape: a circle for the body, a pill for an eye.' } },
  { element: '[data-tour="rail-right"]', popover: { title: 'Morphing', description: 'Keyframe the shape with the stopwatch, move the playhead, pick a different one. The in-between is a real shape, not a switch at the halfway mark.' } },
  { element: '[data-tour="rail-right"]', popover: { title: 'Leaving the scene', description: 'The Visible row is a plain 0 to 1 and it fades AND shrinks. Keyframe it to 0 to retire a feature into the next clip rather than blinking it off.' } },
];

export const EDITOR_TOURS: TourEntry[] = [
  { key: 'editor', label: 'The basics', blurb: 'The four areas and what each is for', steps: intro },
  { key: 'editor-posing', label: 'Posing the mascot', blurb: 'Turning the head, yaw and pitch, eyes', steps: posing },
  { key: 'editor-animating', label: 'Animating', blurb: 'Stopwatch, keyframes, selection, easing', steps: animating },
  { key: 'editor-graph', label: 'The graph editor', blurb: 'Reading and shaping motion curves', steps: graph },
  { key: 'editor-clips', label: 'Clips and presets', blurb: 'Reusable animation blocks and effects', steps: clips },
  { key: 'editor-effects', label: 'Modifiers and effects', blurb: 'Shake, swing, and things thrown off the mascot', steps: effects },
  { key: 'editor-shapes', label: 'Shapes and morphing', blurb: 'Outlines, stars, and fading a feature out', steps: shapes },
  { key: 'editor-states', label: 'States and export', blurb: 'Multiple timelines, Lottie states', steps: states },
];

/** The one that runs unprompted on a first visit. The rest are opt-in from the menu. */
export const INTRO_TOUR = intro;
