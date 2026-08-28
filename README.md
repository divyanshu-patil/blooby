# blooby

A browser mascot studio. Build a character out of circles and pills, animate it on a
timeline, and export **Lottie**, **.lottie**, **GIF**, **MP4** and **PNG** — with no
server anywhere in the loop.

The character is a sphere seen from the front with features mapped onto its surface, so
dragging an eye sideways makes it *arc* across the face and narrow as it nears the rim,
the way it would on a real ball. That one idea — the curvature engine — is what the rest
of the app is built around.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # the maths + export self-check, runs in node
pnpm build
```

## What's here

**Editor.** SVG canvas with direct manipulation — click to select, drag to move along the
sphere, corner handle to scale, arc handle to roll, or switch to the turn tool and swing
the whole head. Layers, groups, SVG import, z-order. Colour is authored in RGBA and
edited in OKLCH (lightness / chroma / hue), which is also how it interpolates, so a red →
blue transition never passes through mud.

**Eye expression controller.** Plain-language sliders — distance apart, openness, length,
width — plus a 2D pad that aims both eyes at once. It sits on top of the raw yaw/pitch
fields rather than replacing them; the inspector still shows those, and both are
keyframeable.

**Timeline.** A strip of preset blocks, each with its own duration and a **live portrait
of the rig at that pose** — the strip is a contact sheet of faces, and it re-renders as
you edit. Drag a preset in from the library or click to append. Underneath: keyframe
lanes with draggable diamonds and snapping, prev/next chevrons, and an After Effects
style value graph where the bezier handles between two keys *are* the easing. Every
track is normalised to its own range, so 0–1 openness reads as clearly as 90° of yaw.

**Procedural effects.** Shake (seeded noise) and float (sine), layered non-destructively
over the keyframes and baked into literal keyframes on export.

**Expressions and morphs.** Capture the current pose as a named expression, set it at any
time on the timeline, or morph A → B over a duration — numbers linearly, colours in
OKLCH, angles by the shortest arc.

**Copilot.** Three tiers, all client-side: **Local** models, **Ollama Cloud**, or any
**Custom** Ollama-compatible URL, where a pool of API keys rotates with per-key health and
failover on 401/429/5xx.

Ollama Cloud goes *through* your local Ollama rather than to `ollama.com` — that host
serves no CORS headers on any route, so no browser can reach it directly, while the local
daemon proxies any `-cloud` model using the sign-in it already holds. `ollama signin` once
and big models work with no key in the page at all.

Replies are parsed tolerantly (cloud models ignore Ollama's JSON-schema `format` and tend
to fence their output), validated against the rig, and land as an Apply / Reject card
describing each change in plain English. Nothing touches the document until you say so,
and applying a batch is a single undo step.

## Layout

```
src/core/       pure logic, no React — curvature, easing, colour, noise, scene, store
src/ui/         canvas, layers, inspector, eye panel, timeline, graph editor, copilot
src/export/     lottie baker, dotLottie container, zip writer, GIF/MP4/PNG rasteriser
src/copilot/    ollama client, key pool, prompt, tolerant parser, tool schema, live test
```

`core/curvature.ts` and `export/lottie.ts` are pure and independently testable; the SVG
canvas, the block thumbnails and the exporter all render through the same
`buildScene()` → `<Shapes>` pair, so an export cannot drift from the preview.

## Verification

`pnpm check` runs `src/core/selfcheck.ts` in node. It covers the sphere projection and
its inverse across fov and head angles, the perspective silhouette against the closed
form `R·D/√(D²−R²)`, easing curves, OKLCH round-trips, angular interpolation, track
sampling — and then bakes a six-block project with shake to Lottie, **reads it back the
way a player would, and compares it against the canvas frame by frame** (worst case under
a pixel).

`npm run copilot:test -- gpt-oss:120b "make the mascot blink twice then look surprised"`
runs the copilot end to end against a real Ollama — system prompt, parse, normalise,
validate, apply — and prints what it would do. Needs a running daemon, so it is kept out
of `check`.

`pnpm dev` then `/?smoke` runs the browser half — SVG serialisation, canvas raster, the
zip writer, the GIF worker, MediaRecorder support — and reports in the tab title.

The exported files were checked against `lottie-web` and `unzip`.

## Shortcuts

| | |
|---|---|
| `space` | play / pause |
| `,` `.` | previous / next keyframe |
| `Home` | back to the start |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `⌫` | delete the selected layer |
| `⇧` while scaling | uniform; while rotating, snap to 15° |
| `⌘↵` in the copilot | send |

Design notes and every deliberate shortcut are in [ASSUMPTIONS.md](./ASSUMPTIONS.md).
Visual tokens are in [DESIGN.md](./DESIGN.md). Before adding an animatable property, an
effect, or a copilot tool, read [COPILOT.md](./COPILOT.md) — those all come from single
tables now, and it says which one.
