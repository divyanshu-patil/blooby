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

**Composition is a fixed 720×720.** Nothing in the spec parameterises it, and a fixed
size makes exports deterministic.

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

**Only `el` (ellipse) and `rc` (rounded rect) are emitted**, never `sh` paths, and the
rect radius is always `min(w,h)/2`. There is no way for the output to contain a sharp
corner.

**SVG layers are skipped by the Lottie exporter** and named in the result message.
Lottie has no way to embed arbitrary SVG markup. They still render in GIF, MP4 and PNG.

**`.lottie` is written by a hand-rolled store-only ZIP** (`export/zip.ts`, ~45 lines).
The payload is already-minified JSON going straight into a player, so deflate would save
little and cost a dependency. CRCs verified against the standard check vector, and the
output opens with `unzip`.

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

*Residual uncertainty, narrower than before*: the auto-advance-to-the-next-state-on-
completion wiring (`OnComplete` interaction → `Fire` action → `Event`-type guard) is
built from the best pattern available — no verbatim spec example was findable, only a
plausible one from community docs — and in the same live test the state machine started
and entered its first state correctly but did not visibly advance to the next state
within a full playthrough. The states, their animations, and manual switching all work;
whether this *particular* auto-chaining syntax is exactly what current players expect is
still open. *If auto-advance matters, drive it explicitly instead* — call
`stateMachineFireEvent`/`stateMachineSetBooleanInput` from host code per state, which
every version of the spec supports unambiguously, rather than relying on the file to
self-advance.

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
