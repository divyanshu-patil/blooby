# Assumptions

Every place the spec left a choice open, plus every corner deliberately cut. Each entry
says what was decided and what would change it.

## Curvature engine

**Sphere radius vs. drawn silhouette.** Under perspective a sphere of radius `R` at
distance `D` projects a silhouette of radius `R·D/√(D²−R²)`, which is larger than `R`.
Features are placed on the sphere of radius `R`; the body is *drawn* at the silhouette
radius, computed numerically in `silhouetteScale()`. Draw both at `R` and features spill
off the head as soon as perspective opens up. Verified in `selfcheck.ts` against the
closed form.

**The visible cap is smaller than the hemisphere.** `limbThreshold(fov, distance)` is
`w/d`, the tangent-ray `n.z` — anything below it is behind the body's own limb and is
neither drawn nor a drag target. At `fov = 0` it is 0, so the orthographic case reduces
to the plain hemisphere.

**Foreshortening is a scale vector, not a matrix.** The true rim compression is
`Rot(tilt)·diag(f,1)·Rot(−tilt)`, which has a shear term. Lottie's transform carries
rotation and a scale vector, so keeping the shear would make the preview and the export
different pictures. The scale-only form is exact when the shape's axes line up with the
radius (0°, 90°) and, with the `cos²2α` correction, at 45° too. Worst case in between
overshoots the silhouette by about 1.4 points more than the exact transform does — and
the exact transform already overshoots 5.3%, because a flat decal tangent to a sphere
genuinely pokes out near the rim. `selfcheck.ts` pins this at ≤7.5%.
*Upgrade path:* decompose to Lottie's `sk`/`sa` skew fields and drop the approximation.

**Head rotation composes properly.** Yaw and pitch rotate the surface normal with real
rotation matrices (`Ry` then `Rx`), not by adding degrees to each child's angles. Adding
degrees is wrong as soon as both are non-zero.

**Rim fade.** Features fade out over the last `0.14` of `n.z` before the limb rather
than popping. This is what real occlusion would do, and it exports as ordinary opacity
keyframes.

**Only the body is a sphere.** Children of the body ride its surface; children of
anything else use `flatOffset`. Nested spheres are not in the spec and nothing in the
reference character needs them.

**Body squash carries features, not their size.** Squashing the body moves the eyes with
it but does not squash the eyes themselves. Squashing them too looked worse.

## Data model

**`size: Vec2` was added to `RigNode`.** The spec's schema has scale but no base
dimensions, so there was nothing for scale to multiply. `size.x` is the body radius, or
a feature's width.

**`eye.distanceFromCenter` is a signed offset added to `surface.yaw`**, not an override
of it. The spec says "overrides", but then a keyframe on yaw and a keyframe on distance
fight each other. As an offset both stay independently animatable: yaw is the pose,
distance is the rig setting, and the left eye simply holds a negative value.

**`Block` and `Track.blockId` were added.** The spec's preset strip needs placed
instances with per-instance durations. A track that came from a preset remembers its
block and is retimed with it; a hand-authored track is free.

**The composition size is the project's own** (`Project.composition`, read through
`compOf()` in `core/comp.ts`), 64–4096px a side, presets 720², 1080², 1920×1080 and
1080×1920. It used to be a fixed 720×720; migration v3 writes that size into every older
project, so no default change can ever reframe a file that never chose one. The mascot is
placed at the canvas centre at its own pixel size — a wider canvas gives it room, it never
stretches it. Every render and export (stage, thumbnails, GIF/MP4/PNG, Lottie, dotLottie)
reads the same `compOf(project)`.

## Freeform layers

**One draw order.** `RigNode.zIndex` is the only ordering there is; the layer panel, the
stage, the timeline and the exporter all read it (`layerOrder()` in `core/layers.ts`), and
`reorderLayer` keeps it dense and unique so "forward one" is always one layer. There is no
separate z-index for world layers or for attachments.

**World vs mascot is the parent.** `parentId: null` on anything but the root is a WORLD
layer, placed by `flatOffset` from the composition centre; a child of the body is
ATTACHED and rides its moves, roll and squash. Switching is `placeUnder()`, which reads the
layer's frame off the same walk `buildScene` draws with and re-expresses its position,
size and angle in the new parent's frame — so it never jumps. Attached over the silhouette,
it lands on the sphere (yaw/pitch); off the rim it attaches as a flat offset.
*Not animatable:* which frame a layer lives in is structural, not a value. "Star moves off
into world space" in the Magical Reveal preset is the attachment offset carrying it away.

**`flatOffset` on a mapped layer now does something.** It is the attachment nudge, in the
body's own frame. Before, the renderer ignored it on anything placed on the sphere (the
help text promised a nudge that never happened). Migration v3 drops any such value, and
its tracks, from older projects so nothing that never moved starts moving.

**Appearance ranges are scoped like effects** (`Timeline.appearances`): the clip when
`blockId` is set, the timeline otherwise, `startMs`/`endMs` relative to the scope. They
fold into the evaluated `opacity` in `evaluateRig`, so the stage, the state blends and the
Lottie bake all get them for free. A layer with no range is always there — unless it is
`ranged` (a preset's own sticker), in which case it only exists where some range says so.
A preset never gives a range to a layer the user already had and is not `ranged`.

**Fill and stroke are separate tracks.** `color` stays the fill (every old keyframe keeps
driving it); `fill.opacity`, `fill.enabled`, `stroke.color`, `stroke.width`,
`stroke.opacity`, `stroke.enabled` are PROPS rows. On/off are 0/1 numbers so they key;
between keys they switch at the halfway mark. Line cap and join are static — Lottie's
`lc`/`lj` are too. Stroke width is screen px (non-scaling in the preview; divided by the
layer's scale in the Lottie, where strokes scale).

**Imported SVG is parsed, not pasted.** `core/svg.ts` turns path, rect (rounded), circle,
ellipse, line, polyline, polygon, groups and transforms into vector paths, regex over tags
so it runs identically in node and the browser. One path becomes an ordinary shape layer
(editable anchors, morphable); several become one vector layer that keeps each path's own
paint. Text, bitmaps, `<use>`, masks, filters and gradients are named in a warning; the
original markup is kept on the layer either way. A colour every path shares is promoted to
the layer's own fill/stroke, so the Fill row recolours an icon.

**Limbs keep their length, the way Cavalry's rubber hose does.** The points are exactly
where the shoulder and hand (hip, knee, ankle) sit; `length` is the hose's real length
along its curve. Bring the hand closer and it bends — a circular arc exactly that long —
pull it away and it straightens and stops short rather than stretch. `bend`'s sign picks
the side and its size the shape (1 an arc, 0 a sharp elbow). Rubber hose off is the plain
rigid limb, straight between the points. Legs pass through the knee, each half taking its
share of the length. It is all a pure function of the points and dials (`core/limb.ts`),
cached by input, so `sceneAt(t)` stays scrubbable in any order.
*Residual:* a leg's in-between length (just gone slack) is matched by bisection over a
blend of the taut and bent curves, exact to the sampling, not to the float.

**Shape morph modes are easings**, not a second interpolation path: Cut is a `hold`
easing, Overshoot and Elastic are curves that pass 1 — and `morphPath` extrapolates past
its ends rather than clamping, which is the only reason those two read as morphs.

## Several mascots, text and curves

**A mascot is a body and what rides it** (`core/mascot.ts`). There is one definition,
`makeMascot`; every mascot is an instance with its own ids, tracks and lane of clips. The
first mascot is `rig.rootId` and keeps the ids every older file and preset use (`body`,
`eyeL`, `eyeR`); any other names its parts `<body>.eyeL` and tags them with a `role`, which
is how a preset written for `eyeL` finds the second mascot's left eye (`retargetId`).
A mascot following another is a body parented to a body; a loop is refused.

**Lanes are `Block.mascotId`.** Blocks tile within their lane; the first mascot's lane has
no id. A layer plays in its mascot's lane, but a block may also drive another mascot's parts
while it runs — which is how "Two Friends", placed on one lane, animates the friend it brought.

**A body draws at twice its `size`.** The default mascot is ~296px across on a 720 canvas;
`flatOffset`s are composition px and arc radii are unscaled. Presets that place things
round a mascot are written against that (they were first written against 148 and put words
inside the head).

**Text is outlines, not `<text>`, wherever the font has loaded.** Fonts come from the
Fontsource CDN (Google Fonts, **latin subset only**) and are parsed with opentype.js for
metrics and glyph outlines, so the stage, the raster export and Lottie draw the same shapes.
Until a face arrives the stage uses deterministic fallback metrics and a `<text>` element;
a Lottie baked without the face falls back to live text layers and says so in its warnings.
A **fixed text height is not implemented** — a box wraps to a width and grows downward.
The letter motions (pop, fade, drop, rise, scatter, wave) are one keyed `progress`, and
which motion plays is a discrete `text.chars.kind` track, so a preset can switch it.

**Curves are ordinary shape layers** with an open or closed `shapePath` and a `curve.type`
— smooth, polyline or Bézier; a quadratic is covered by Bézier. Two keys of the same
structure interpolate anchor by anchor (`lerpPath`), so path keyframes move a curve and the
text on it. A `guide` curve shows in the editor and is left out of every export.

**Text presets on a selected text.** A text preset whose own words are straight plays on
the selected text layer instead (`textPresetOnto`): tracks move to it, the typewriter's
count scales to its length, and the closing keys that let the preset's own caption loop are
dropped, so the user's words stay once they have arrived. Presets with words on a curve of
their own, or with another mascot, always bring their layers.

**The view is not the camera.** Pan and zoom on the stage move the editor's view only;
Recentre resets that view. The preview and every export frame the composition.

## Timeline

**"Even" duration mode** gives every block the mean of the current durations. The spec
says "even/auto-fit" without defining the target length.

**Undo coalescing** merges same-labelled commits inside 700 ms, so one slider drag is one
undo step. History is capped at 80 full-project snapshots — `structuredClone` of a
project this size is cheap, and a normalised diff would be real machinery for no gain.
*Upgrade path:* switch to patches if projects grow past a few hundred nodes.

## Easing and noise

**Cubic bezier is solved by bisection, not Newton.** Newton stalls where the curve's
derivative goes flat, which is exactly the ease-in-out extremes people actually use.
24 iterations is well past float precision here.

**Shake uses 1D value noise with cubic interpolation**, seeded and deterministic
(`core/noise.ts`), not Perlin or simplex. Shake only ever samples one dimension, so the
gradient setup Perlin adds buys nothing. *Upgrade path:* swap in simplex if a modifier
ever needs 2D/3D coherence.

## Colour

**Authored as RGBA, interpolated in OKLCH.** Hue takes the short way round, and a
greyscale endpoint borrows the other end's hue so it does not swing through an arbitrary
one. `selfcheck.ts` checks that red→blue keeps its chroma instead of passing through mud.

## Export

**Lottie is baked by dense sampling, then simplified.** The curvature projection is not
representable as native Lottie transform keyframes, and neither are shake and float. So
every property is sampled once per frame and a per-channel pass drops every frame that a
straight line between its neighbours already predicts. Easing arrives pre-resolved, so
the temporal tangents are all linear. On a six-block project this keeps roughly 15% of
the sampled frames. `selfcheck.ts` reads the baked file back the way a player would and
compares it against the canvas frame by frame — worst case under a pixel.

**Shape size is static; the layer scales.** Animating layer scale instead of the shape's
own dimensions halves the animated properties and is what every Lottie player optimises
for. A non-uniformly scaled rounded rect keeps elliptical corners, which is still smooth.

**Plain features export as `el`/`rc`; everything with an outline as `sh` beziers.** An
eye or the round body is still an ellipse or a rounded rect (radius `min(w,h)/2`). A layer
with an outline — a morph, a library shape, an imported SVG, a limb — is bezier data: a
static outline written EXACTLY (its real vertices and tangents, `pathToBezier`), an
animated one resampled per frame and then thinned by the same line-fit reduction as every
other channel. Several subpaths are several `sh`, so a leg's foot and the dot of an "i" are
never joined by a stray edge.

**Nothing the editor draws is silently dropped.** Imported SVG exports as native vector
paths with their own fills and strokes. The one exception is an SVG with no readable
geometry at all, which is named in `skipped` — never faked as a rounded rectangle — and
still renders in GIF, MP4 and PNG from its preserved markup.

**`.lottie` is written by a hand-rolled ZIP** (`export/zip.ts`, ~60 lines), deflating each
entry through the platform's own `CompressionStream('deflate-raw')` — still no dependency,
because zip's method 8 *is* raw deflate. It stored entries uncompressed until 2026-09-20,
on the assumption that minified JSON was already small; **that was wrong and cost about
6× on every export.** A baked composition is mostly repeated numeric arrays, which is the
most compressible thing there is: measured over four projects, entries deflate to 8–16% of
their size (a three-state cinematic mascot went 3.1MB → 299KB). An entry deflate cannot
shrink is written stored, decided per entry. CRCs verified against the standard check
vector; `unzip -t` reads the output and reports the archive comment, `Made with Blooby`.

**Export size is dominated by baked vertices, and they are near the floor.** The other
things that look wasteful are not, measured on a 141-layer strip: the all-zero `i`/`o`
tangent arrays are 700KB of the raw JSON but only 51KB deflated, and the per-keyframe
linear-easing pairs only 14KB — both are pure repetition, which deflate already eats.
Cutting either would save little and break every player. What is left is vertex
coordinates, which do not compress.

**A limb outline is ~4.7px from its true curve, and more points will not fix it.** The
export resamples an outline to a ring of evenly spaced points with zero tangents.
Measured against a 1024-point reference on 100 real limb outlines, 72 points sit 4.7px
off at worst and 96 points still sit 3.7px off — the miss is a sharp feature that even
arc-length spacing cannot land on, not a shortage of points, and giving the ring
Catmull-Rom tangents does not help either (48 tangented points measured *worse* than 72
plain ones). So the vertex count stays, and this 4.7px is the noise floor that justifies
`EPS.v` (0.5px) and `GEOM` (0.1px) in `export/lottie.ts`: together they cost a measured
0.51px of worst-case drawn-point shift, on limbs only, for a fifth of the file.

**dotLottie: rewritten against v2.0 and verified against a real player** (this was
reported broken, and it was — the v1 shape assumed above was wrong on two structural
points: directories were `animations/`/`states/` instead of the spec's `a/`/`s/`, and the
state machine's `initial`/`states` were nested under a non-spec `descriptor` object
instead of sitting flat at the top level, so no conformant player could find either the
animations or the state machine at all). Fixed against the spec fetched directly from
`dotlottie.io/spec/2.0/`, then loaded with `@lottiefiles/dotlottie-web` in a real headless
Chrome session: the file loads, `stateMachineLoad('mascot')` and `stateMachineStart()`
both return `true`, and the player fires real `stateMachineTransition`/
`stateMachineStateEntered` events entering the first state. That's the part that was
reported broken, and it's now confirmed working end to end.

**The auto-advance wiring is gone, replaced by real transitions.** The old exporter
chained each state to the next with an `OnComplete` interaction firing an `Event` guard.
That was the one part built from a community-docs pattern rather than a spec example, and
in a live test it never actually advanced. It is now removed: states are connected by the
transitions authored in the State Editor, with real `Boolean`/`Numeric`/`String` guards.
A machine with no authored transitions stays in its initial state, and validation says so
in the editor rather than shipping a file that quietly does nothing.

**The state-machine schema is read off the engine, not off docs.** `core/stateMachine.ts`
uses dotLottie's own vocabulary verbatim — input `type` (`Boolean`/`Numeric`/`String`/
`Event`), guard `conditionType` (`GreaterThan`, `GreaterThanOrEqual`, `LessThan`,
`LessThanOrEqual`, `Equal`, `NotEqual`), `compareTo`, `Tweened` transitions whose
`duration` is in **seconds** with a 4-number cubic-bezier `easing` — all checked against
`dotlottie-rs/src/state_machine/{inputs,states,transitions/{mod,guard}}.rs`, which is what
actually parses the file. So `toDotLottie` is close to an identity mapping and
`fromDotLottie` round-trips it (there is a test asserting exactly that).

*The one thing Blooby carries that the format cannot express is `OR` across conditions.*
The engine ANDs a guard list (`guards.iter().all(...)`) and has no OR, so an OR transition
fans out into one transition per condition, tried in order — identical behaviour, and no
invented key a player would ignore. The editor says so on the transition itself.

*Residual uncertainty*: the guards, inputs and tween shapes are verified against the
parser source, not against a running React Native player — this repo has no RN app to run
one in. The exact method names in the generated `Mascot.tsx` come from
`@lottiefiles/dotlottie-react-native@0.12.1`'s own typings (note `stateMachineFire`, not
the web player's `stateMachineFireEvent`), so they are right for that version.

**Importing a `.lottie` preserves its animations rather than re-drawing them.** Blooby
cannot map someone else's Lottie onto its own rig, so an imported state keeps its
`animationId` and the original animation JSON travels with the project
(`Project.importedAnimations`) and is written back out byte for byte. Those states are
editable *as states* — name, loop, transitions, blend, conditions; their artwork is not.
Flattening them into independent animations would be the one thing the spec explicitly
forbids. Re-importing a file is idempotent: a state whose name already exists reuses that
timeline instead of creating a second one.

**A `Tweened` transition cannot morph between two compositions.** It interpolates the
playhead within the one that is loaded — `Tweening` exists only as a player status
alongside Playing/Paused/Stopped, and there is no cross-composition morph API in the wasm
build, the CJS build, or the iOS `DotLottiePlayer` core. Two states naming two different
animations hard-swap, and the `duration`/`easing` they declare have nothing to act on.
Verified by another agent reading the shipped binaries, after a file that looked correct
kept cutting.

So every baked timeline exports as a frame range of a single composition (`export/strip.ts`),
with real morph frames between the ranges for the playhead to scrub through.

**`segment` on a `PlaybackState` is a marker NAME, not a frame pair.** Read from the
dotlottie-rs source rather than guessed: `states.rs` declares `segment: Option<String>`,
parses it with `opt_str_field`, and applies it with `player.set_marker()`. The engine also
uses it to find a `Tweened` transition's target — it looks the name up in the animation's
markers and tweens to `marker.segment.start`. So the name must match a marker in the
animation, and both states must name the *same* animation or the engine skips the tween
and falls through to an instant cut.

Shipping it as `[start, end]` did not merely disable the segment — **it discarded the
entire machine.** `opt()` in `json.rs` returns `Some(None)` for an absent field but `None`
for one that is present with the wrong type; `state_from_json` forwards that with `?`; and
`array_of` collects into `Option<Vec<_>>`, which short-circuits. One mistyped field on one
state and `stateMachineLoad` returns false — a bool the native bindings discard. Nothing
raises, and the animation autoplays every pose end to end, which looks close enough to
working to cost hours. `export/engineContract.test.ts` is that parser, written out, so the
next wrong type fails at build time.

**Old projects are migrated, not reinterpreted.** `core/migrate.ts` holds one numbered
step per document shape, applied on every load path (localStorage, a downloaded
`.blooby.json`, the IndexedDB gallery, a cloud row) because all of them funnel through
`loadProject`. A project saved before state machines existed gets one written down on
open — its timelines become states, the id is pinned from the project name and the
initial state from the first timeline.

*It is deliberately given no transitions.* The old exporter chained state to state with an
`OnComplete` interaction, and that chain was never observed to advance in a real player
(see above). Reconstructing it would carry a bug forward and dress it as intent, so an
upgraded project gets an inert machine plus the editor's own validation warning saying
exactly that — visible and fixable, rather than shipped and mysterious.

A document from a *newer* build is detected and left alone rather than run through older
steps, with a console warning; the parts this build understands still open.

**`unzip` uses `DecompressionStream('deflate-raw')`**, so reading a deflated `.lottie`
(now including our own) still needs no zip dependency. Entries are read from the
central directory rather than by scanning local headers, so a streamed archive with data
descriptors reads correctly.

**MP4 via `MediaRecorder`, not `ffmpeg.wasm`.** Chrome and Safari both advertise
`video/mp4;codecs=avc1`; where they do not, the exporter falls back to WebM and the
button says so. `ffmpeg.wasm` is a ~30 MB download that needs COOP/COEP headers, which
would end the "no server" property. The cost is that recording runs in wall-clock time.
*Upgrade path:* `mediabunny` or `ffmpeg.wasm` if frame-exact muxing is ever needed.

**GIF via `gif.js.optimized`**, already in the dependency list, with its worker resolved
through Vite's `?url`.

## Copilot

**Ollama Cloud is routed through the local daemon, not straight to ollama.com.** This is
forced, not preferred: `ollama.com` sends no `Access-Control-Allow-Origin` on any route
and answers preflights with `405` — checked against `/api/tags`, `/api/chat` and the
OpenAI-compatible `/v1/*` endpoints, and confirmed with a real browser fetch, which fails
every one of them. A page can never call it directly. The local daemon, meanwhile, sends
correct CORS headers (including `Authorization`) and proxies any `-cloud` model to Ollama
Cloud using the sign-in it already holds. So the cloud tier keeps the browser talking to
`localhost:11434`, appends `-cloud` to the model name, and lets Ollama make the
authenticated hop. One `ollama signin` is the whole setup, and no key touches the page.
*Revisit if ollama.com ever ships CORS headers.*

**The cloud model catalogue is a hardcoded fallback.** §14 asks for a live list, and
`https://ollama.com/api/tags` does serve one unauthenticated — but it is CORS-blocked
like everything else there, so a browser cannot read it. The catalogue in `pool.ts` is
seeded from that endpoint and merged ahead of any `-cloud` model already pulled locally;
any model name typed into the picker is passed through untouched. It will drift as
Ollama's line-up changes. *A proxy on the custom tier restores the live list.*

**`format` is not enforced for cloud models.** Ollama honours the JSON-schema `format`
field locally, but it does not survive the hop to Ollama Cloud: replies come back wrapped
in markdown fences, sometimes as a bare array, and often with each call written as
`{ toolName: args }` rather than `{ name, args }`. `copilot/parse.ts` normalises all of
those, and `normaliseCall` resolves layer *names* to ids and the argument aliases models
reach for (`time` → `atMs`, `layer` → `nodeId`). The system prompt also spells out the
envelope explicitly rather than relying on the schema. Recorded real responses are pinned
as fixtures in `selfcheck.ts`. The single re-prompt is still there for genuine mistakes.

**No free community gateway is wired in.** The spec asks to verify CORS and terms of a
specific gateway at implementation time; that could not be verified here, and a hardcoded
guess would likely be wrong and would send user prompts somewhere unvetted. The **custom**
tier takes any Ollama-compatible base URL instead — a proxy in front of ollama.com, or a
remote Ollama — and that is where the API-key pool applies.

**Keys live in `localStorage` and are sent only to the configured endpoint.** The panel
says so in the UI. Only the custom tier can need one — local and cloud both go to the
daemon, which owns its own credentials.

## Interface

**A new file opens on a working idle → blink → talk → happy timeline** rather than an
empty strip, so the first thing anyone sees is the tool doing its job.

**Custom easing is edited on the value graph**, not in a separate cubic-bezier widget —
the graph editor already draws the handles in context, and a second widget showing the
same two control points would be a second place to keep in sync.

## One object per project in S3, no history

`users/{userId}/projects/{projectId}.json`, overwritten on every save. It used to be
`.../{projectId}/versions/{n}.json`, one object per save, on the reasoning that a bad
write could never destroy the last good one. In practice an afternoon of autosaving left
149 objects for a single project and the bucket grew without bound, so that trade is off.

What is actually lost is narrower than it sounds. S3 `PutObject` is atomic, so an
interrupted or failed upload still leaves the previous object whole; what is gone is
recovery from a save that *succeeded* with bad content. `currentVersion` stays in Postgres
and still does the job that mattered — the compare-and-set that stops two tabs
overwriting each other — it simply no longer names a key.

`pnpm --filter @blooby/api collapse:versions` migrated the existing bucket (258 objects
across 3 projects down to 3, dry-run by default). `check:storage` asserts the property
holds: create, save five times, one object, delete, bucket back where it started.

## Faces, anchors, squish, pins, trims, rules

**The face is a group that hands the sphere down.** A `group` (or any layer with role
`face`) sitting on a sphere passes the parent's radius, head turn and squash to its
children, adding its own offset, roll, scale and yaw/pitch as a "look". Mapped eyes inside
it still arc. Migration step 7 wraps existing eyes in a face at rest, so no pixel moves.
*Hands* are parented to the face (the requested hierarchy); preset arms written against
the body are re-parented on placement, which is identical while the face is at rest.

**Anchor is CSS transform-origin, not After Effects' anchor.** Moving it never moves the
layer at rest; it changes what rotation, scale and squish pivot about. Dragging it on the
stage compensates position so the layer stays put even when rotated. It does not apply to
limbs, whose points are their geometry.

**Squish multiplies onto scale and is clamped 0.4–1.8** where it is read, so a bad
keyframe cannot invert the mascot. Squish presets write keys and clear only squish keys
inside their own window.

**A pin is a static world point.** It is not animatable. Pinning captures the foot at the
playhead; unpinning writes the pinned points back as keyframes (or base values) at the
playhead. The knee follows the hip→foot line as a similarity transform.
*Upgrade path:* keyframeable pin weight for walk cycles.

**Trim affects the stroke in the preview; Lottie's trim path trims the whole group.**
Curves have no fill by default, so the two agree there. A filled shape with a trim shows
its full fill in the editor but a trimmed fill in a Lottie player.

**Rules from any state fan out at export.** `from: "*"` is one transition in the document.
The engine sees one edge per other state (never into the target itself), after that
state's own edges. State-to-state edges therefore win where both hold.

**New layers belong to the state they were made in** (`ranged` plus a whole-timeline
appearance). Layers already leaked across states in older files cannot be attributed
after the fact and are left as they are.

**Timeline easing popover on a last keyframe edits the incoming segment.** The curve is
stored on the key a segment leaves, so the last key had nothing to edit.

**The head shape belongs to the face group.** A body with a face GROUP draws its own
outline in the face's frame (moved, rolled, scaled with it), while the body's frame — what
legs and hung layers ride — stays where the mascot stands. A shape made the face (not a
group) is itself the face drawing, so the body outline stays put there. The Layers panel
shows the head as a "Head shape" row under Face; it selects the mascot.

**Bounce and Elastic are baked into keyframes** (`setEasingIn` in core/store.ts): a key at
every contact and peak, marked `bakedFrom`, removed when another easing is picked or the key
is deleted. Peaks within 2% of the target are dropped. Presets that already use the bounce
formula keep it; only an easing picked in the editor bakes.

**Apply as base size** scales every length under the mascot by the per-axis scale where the
parent frame stretches per axis (the body, its face group) and by the uniform part elsewhere,
then puts the body back where its anchor-scaled centre was. Stroke widths are screen px and
are left alone.

**Layer effects that Lottie cannot carry are kept, drawn and reported, not dropped.** Glow,
blur, shadow, RGB split, slices, scanlines and goo are SVG filters/clips; gradients and masks
are not written by the baker yet. All are drawn in the editor, the thumbnails and the raster
exports (GIF/MP4/PNG), and `bakeLottie` returns a warning naming each layer that lost one.
Flicker, jitter and echo evaluate to plain opacity/paths/copies per frame, so they bake. Blend
modes bake as the layer `bm`, trim offset as the trim path's `o`.

**Slice bands sit on a 900px screen grid**, not per layer, so a mascot and its eyes tear along
the same lines.

**Effects are drawn, not simulated:** everything is a function of time (hashes seeded by frame
step), so scrubbing back to a frame gives the same picture and a bake is deterministic.
Echo re-evaluates the rig at earlier times; each echoing layer costs one extra scene per copy.

**Burst particles are closed-form.** Velocity decays with drag, gravity is ½gt², turbulence is
1D noise — no integration state, so any frame can be evaluated alone. Gathering onto a target
eases each particle to its own point on the target's outline (or inside a word's letters),
read as the target WOULD be drawn even while it is hidden.

**Particles are measured by the mascot, unless it has been scaled away.** Below a tenth of its
scale the emitter unit is taken as if it were whole, so a mascot that bursts into particles
does not take their size down with it.

**Depth is a simple pinhole**: scale = 1000 / (1000 + z), applied to size and to the distance
from the composition centre, with the camera pan divided the same way (parallax). rotateX/Y
narrow a layer by cos(angle); on a mascot they turn the sphere instead.

**Walk cycles** plant each foot in the world by compensating the body's squash, ease up to
speed over 0.4s, and — given an end — leave the mascot where it walked to for the rest of the
clip, or until `holdUntilMs` (how `sequence()` keeps a walk inside its own part).

**Per-point limb pins are in world px.** A pinned point stays where it was pinned in the
world; while the pins pull the limb further than its length, the length stretches to reach,
and it is the inspector length again as soon as they no longer do. Unpinning writes the
pinned pose back into the points (so nothing jumps within reach); a stretched limb then
shortens to its own length.

**Preset layers with a negative zIndex go behind the rig** when placed (`addPresetLayers`);
any other goes on top, as before.

**Cinematic presets open on the mascot's rest pose for one held instant** (`settled` in
core/cinematicPresets.ts) and start their own pose 1ms in. The builtin rule is that a preset
closes on its opening value; opening on rest means a portal or glitch that starts with no
mascot never hands an invisible mascot to the next clip or the next part of a sequence.

**Keyframe copy goes through the system clipboard** (`blooby-keyframes:` + JSON), from the
`copy` event. A keydown-only copy left an earlier SVG on the clipboard, which the editor's
SVG paste then took as a new layer, so the keys never arrived.
