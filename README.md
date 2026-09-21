<img src="brand/exports/mark-dark-160.png#gh-light-mode-only" alt="" width="80" align="left" />
<img src="brand/exports/mark-light-160.png#gh-dark-mode-only" alt="" width="80" align="left" />

# Blooby

A browser studio for building and animating mascot characters, and shipping them as
Lottie, dotLottie (with a real state machine), GIF, MP4, PNG or a React Native component.

<br clear="left" />

[![CI](https://github.com/divyanshu-patil/blooby/actions/workflows/ci.yml/badge.svg)](https://github.com/divyanshu-patil/blooby/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6.svg)
![React](https://img.shields.io/badge/React-19-149eca.svg)

## Overview

A Blooby mascot is a sphere seen from the front, with features mapped onto its surface
by angle rather than by pixel. Drag an eye sideways and it arcs across the face and
narrows near the rim, the way it would on a real ball. On top of that rig sit freeform
layers (shapes, SVG, text, drawn curves, rubber-hose hands and legs), a clip-based
timeline with keyframes, a dotLottie state machine, and an agentic Copilot that edits
the project through the same functions the UI uses.

The editor, renderer and exporters run entirely in the browser. The backend (`apps/api`)
adds accounts, cloud projects, a community preset catalogue and admin tooling. Without
it, the editor still runs offline on the built-in presets.

## Features

| Area | What exists today |
|---|---|
| **Mascots** | Several per project, each a body, a **face** layer, eyes and optional hands and legs. Saved mascot templates. One mascot can follow another |
| **Face rigging** | The face is its own layer holding the head shape, eyes and hands: move, roll, scale or turn it (yaw/pitch as a "look") while the body and legs stay put. Delete it, re-add it, or make any shape, SVG or group the face |
| **Roles** | Double-click a layer's tag in the Layers panel to change the part it plays: face, left/right eye, hand, leg, or a mascot body |
| **Hands & legs** | Rubber-hose limbs that keep their length, with an optional elbow or knee and a foot. Attach a limb to any part of a mascot (body, face, a shape) so it rides that part. **Pin any point** (hip, knee, foot, hand) in the world from the stage or the inspector: it stays put while the mascot moves, and the limb stretches past its length only while a pin needs it |
| **Poses** | One-click poses (Excited, Kick, Hands up, Shrug, Wave, Point, Stride…) shown as thumbnails of your mascot, keyed at the playhead. Hands, elbows, knees and feet can be dragged on the stage whenever the mascot is selected |
| **Layers** | Drag a layer onto the middle of a group, the face, a shape or a mascot to move it inside; "Move out" takes it back out. Nothing moves on screen. Layers made in another state are listed with "+ here" to bring them into this one (⇧ for every state) |
| **Transforms** | Position, scale (X/Y linkable), roll and opacity, plus an **anchor point**: rotation, scale and squish pivot around it (drag the crosshair on the stage). **Apply as base size** bakes a mascot's scale into its real size so scale starts from 1 again |
| **Squash & stretch** | Squish X/Y dials that multiply onto scale. Squish presets (Soft, Heavy, Landing, Bounce…) with a live preview write editable keyframes at the playhead |
| **Colour** | A picker with a saturation/value square, hue and opacity strips, hex entry and pastel presets |
| **Shapes** | A shape library, anchor editing and shape morphs via keyframes |
| **SVG** | Paste or import SVG as real vector layers with separate fill and stroke |
| **Text** | Google Fonts, on an arc or along another layer's outline, per-letter animations, and per-letter position/rotation/scale/opacity keyframes |
| **Curves** | Pen-drawn smooth, polyline or Bézier curves. **Start/End offset** (a trim path) for draw-on, draw-off and reversed ranges, a travelling **offset**, and a brush **taper** |
| **Layer effects** | Glow, blur, drop shadow, RGB split, slice tearing, scanlines, flicker, jitter (hand-drawn boil), echo trails and goo (metaballs), stacked per layer, every value keyframeable. Blend modes, masks from another layer's outline, linear/radial gradient fills |
| **2.5D & camera** | Layer depth (parallax and scale with the camera), rotate X/Y card turns, a mascot spinning round its sphere, camera pan and zoom, camera shake |
| **Procedural motion** | Shake, float, stretch, pendulum, plus a **walk cycle** with planted feet, **follow-through** on parts and **jelly** soft-body deformation |
| **Particles** | Paths, orbits and physics **bursts** (velocity, drag, gravity, turbulence) whose particles can gather onto a layer's outline or into a word, changing colour as they go |
| **Timeline** | Clips on per-mascot lanes, keyframe lanes, a value graph with Bézier easing that fits its range to curves and handles, clip transitions, loop closing. Bounce and Elastic easings become real keyframes you can drag |
| **Ownership** | A layer created in one state (timeline) is visible only in that state unless you choose to share it |
| **State machine** | A dotLottie machine: inputs, **rules** ("when `mood == 2`, play Dance" from any state) and state-to-state transitions, edited in a node graph whose nodes you can drag into place |
| **Presets** | 72 built-ins, from moods and idles to showcase, text, app-screen and **cinematic** presets: Portal Entrance, Full Body Morph, Walk Cycle + Parallax, Particle Assembly, Liquid Splash, Glitch Materialize, Doodle Reveal, BLOOBY Title, 3D Card Flip and a 20-second showreel |
| **Copilot** | An agent that inspects, searches presets, edits, previews and verifies. Shows live activity and token use; each run can be reverted or reapplied |
| **Export** | Lottie JSON, `.lottie` with state machine, GIF, MP4/WebM, PNG, React Native pack |
| **Admin** | Overview, moderation, users, projects, official presets and a splashscreen builder that uses the editor's renderer |

## Use it from Claude, ChatGPT or Cursor

Blooby is an MCP server. Copy your MCP link from the editor's **MCP** tab, paste it into your AI app as a connector, approve on the Blooby page it opens — and ask it to animate. See [docs/mcp](docs/mcp/README.md).

## Getting started

### Prerequisites

- **Node.js 22** (the version CI runs)
- **pnpm 10** (`packageManager` pins `pnpm@10.34.5`; `corepack enable` picks it up)
- For the backend only: a Supabase project, a Postgres connection string and an S3 bucket

### Installation

```bash
git clone https://github.com/divyanshu-patil/blooby.git
cd blooby
pnpm install
```

### Environment variables

Each app has its own `.env.example`. Copy it to `.env` in the same folder. **Frontend
values are shipped in the browser bundle, so put only publishable keys in them.**

| App | Variable | Required | Purpose |
|---|---|---|---|
| `apps/web`, `apps/admin` | `VITE_SUPABASE_URL` | no* | Supabase project URL |
| | `VITE_SUPABASE_PUBLISHABLE_KEY` | no* | Supabase publishable key |
| | `VITE_API_URL` | no* | Where `apps/api` runs, e.g. `http://localhost:3000` |
| `apps/api` | `NODE_ENV`, `PORT` | yes | Runtime mode and port (default `3000`) |
| | `APP_URL`, `ADMIN_URL` | yes | Web and admin origins (CORS) |
| | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` | yes | Auth and data. The secret key is server-only |
| | `DATABASE_URL` | yes | Prisma connection. Use the Supabase **transaction** pooler (`:6543`, `pgbouncer=true&connection_limit=1`) |
| | `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | Project JSON storage (private bucket) |
| | `ALLOWED_MEDIA_TYPES`, `MAX_PROJECT_BYTES` | yes | Upload limits |
| | `OLLAMA_URL` | no | Upstream for cloud Copilot requests |

\* Leave all three unset in `apps/web` to run the editor offline on the bundled presets.
`apps/api` validates its environment at boot (`src/config/env.ts`) and exits with a
specific message when a value is missing. Copilot API keys are not environment
variables; they are managed from the admin dashboard.

### Running the project

```bash
pnpm dev          # web (5173), admin (5174) and api (3000) through Turborepo
pnpm dev:web      # just the editor, http://localhost:5173
pnpm dev:admin    # just the admin dashboard, http://localhost:5174
pnpm dev:api      # just the API
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | All three apps in watch mode (Turborepo terminal UI) |
| `pnpm build` | Production build of every package |
| `pnpm test` | Vitest across the workspace |
| `pnpm lint` | oxlint across the workspace |
| `pnpm typecheck` | `tsc` across the workspace |
| `pnpm run ci` | lint + typecheck + test, what the CI workflow runs |
| `pnpm test:coverage` | Tests with a per-file coverage table |
| `pnpm seed:presets` | Seed the API's preset catalogue from `apps/api/prisma/presets.seed.json` |
| `pnpm --filter @blooby/studio copilot:test -- <model> "<prompt>"` | Run the copilot prompt pipeline against a real Ollama |

## Project structure

```
packages/studio/    the editor, renderer, exporters and copilot: nearly all the logic
  src/core/         data model, store, scene evaluation, layers, mascots, presets, migrations
  src/ui/           stage, layers, inspector, timeline, graph editor, state editor, copilot panel
  src/export/       Lottie baker, dotLottie container, React Native runtime, raster export
  src/copilot/      agent loop, tools, prompt, Ollama client
  src/cloud/        API clients, auth, splashscreen overlay
apps/web/           user-facing shell: auth, dashboard, community, cloud editor
apps/admin/         overview, moderation, users, projects, official presets, splashscreens
apps/api/           Express + Prisma + Supabase (routes → controllers → services → repositories)
supabase/           database migrations
brand/              the icon: vector masters, and what every favicon is generated from
```

`packages/studio/src/index.ts` is the package's only public surface; the apps import from
`@blooby/studio`.

## The icon

`brand/` is the source of truth. The mark is a circle and two tilted pills — the same
three shapes the editor draws — and it comes in two colourways:

| File | Body | For |
|---|---|---|
| `blooby-icon-dark.svg` | near-black | **light** backgrounds |
| `blooby-icon-light.svg` | paper | **dark** backgrounds |
| `blooby-icon-maskable.svg` | near-black on an opaque plate | Android launchers, which crop to their own shape |
| `apple-touch-icon.svg` | near-black on an opaque plate | iOS home screens, which do not composite transparency |
| `favicon.svg` | **both** | the tab strip — it carries its own `prefers-color-scheme` |
| `blooby-icon.icon/` | — | the Apple Icon Composer project the rest came from |

`brand/geometry.txt` has the three shapes' exact numbers. Nothing redraws them by eye: the
21° tilt and the two different eye sizes are what make the mark recognisable at 16px, and
they are the first thing an approximation loses. Every SVG here wraps the same source
geometry in one transform, `BloobyMark` in `packages/studio/src/kit` uses it in the app,
and the API's share cards (`services/og.service.ts`) use it too.

`apps/web/public` and `apps/admin/public` are **generated** from `brand/` — favicon.svg,
favicon.ico (16/32/48), favicon-96.png, apple-touch-icon.png, and for the app icon-192 and
icon-512 with a web manifest. Regenerate them after changing the masters:

```bash
pnpm icons
```

## Using the editor

- **Canvas**: select, move, scale and roll layers directly. Tools: select, hand, shape,
  pen, text and turn (swing a mascot's head). The crosshair inside a selection is its
  anchor. Limb points and curve anchors are dragged in place.
- **Layers**: the hierarchy (Mascot → Face → Eyes and hands, then Legs), draw order,
  grouping and attachment, plus adding mascots, shapes, SVG, text and curves.
- **Inspector**: every property of the selection, each with a keyframe stopwatch. It
  includes Role (make a shape the face), Transform and Anchor, Squish with its presets,
  Leg (Pin to ground), Curve (Start/End offset), Fill and Stroke (hex colour input), and
  Appearance (when the layer is on screen).
- **Timeline**: clips from presets on per-mascot lanes, keyframe lanes and a graph view.
  Select a keyframe to edit its easing curve. On a track's last key, you edit the curve
  arriving at it.

### Animation model

A project has several **timelines**, and each one is a **state**. A timeline holds clips
(`Block`), keyframe tracks (`Track` → `Keyframe`), procedural modifiers (shake, float,
stretch, pendulum), particle emitters and appearance ranges. A track animates one property
path, such as `transform.rotation`, `squish.x`, `trim.end` or `limb.b.y`. Its keyframes
interpolate with the outgoing key's easing (linear, named presets or a cubic Bézier).
Every animatable property is defined once in `core/props.ts`; the inspector, timeline,
exporters and Copilot all read that table.

### Mascots, face, hands and legs

A mascot is a `body` node plus parts with roles: `face`, `eyeL`/`eyeR`, `armL`/`armR`,
`legL`/`legR`. Eyes live inside the face, and the face hands the body's sphere down to
them, so eyes still arc when the face moves or turns. Hands ride the face; legs ride the
body. **Pin to ground** records the foot's world position. After that the leg bends
between the moving hip and the planted foot. **Unpin** writes the pinned pose back, so
nothing jumps.

### Curves and offsets

**Start offset** and **End offset** control which part of a curve's stroke is drawn, as
fractions of its length. Keyframe End from 0 to 1 to draw a line on, then Start from 0 to 1
to draw it off. Start greater than End is allowed and draws the same span reversed. The
Lottie export writes a trim path.

### Squash & stretch

**Squish X/Y** multiply onto scale, so a squash stacks on top of any scale animation, and
are clamped between 0.4 and 1.8. Set the anchor to the feet ("Squish from: Feet") to keep
a squash on the ground. Squish presets are reusable actions, not clips: **Apply** writes
squish keyframes starting at the playhead, which you can edit like any others.

### State machines

States are timelines. Inputs are `Boolean`, `Numeric`, `String` or `Event`. The **Rules**
section and its node graph express "when this input condition holds, play this state":

```text
mood == 1 → Happy
mood == 2 → Dance
mood == 3 → Sad
```

A rule applies from **whatever state is current**, so you never wire Idle → Dance,
Happy → Dance and Sad → Dance separately. Drag from **Any state** onto a state in the
graph to add a rule. Drag between two states for a transition out of one state only;
those are tried first. Blend duration, easing and extra conditions are under **More**.
Because dotLottie has no "any state", export fans each rule out into one edge per other
state.

### Presets

Presets are reusable clips: tracks plus any layers, effects and appearance ranges they
bring. Placing one adds an editable clip on the selected mascot's lane. The library holds
moods and idles, showcase presets (hands, legs, morphs, several mascots), text presets
and app-screen presets, and cinematic presets (`core/cinematicPresets.ts`) built only from
the editor's own systems: effects, masks, depth, the camera, bursts, walk/follow/jelly and
per-letter keys — open one and every part of it is an ordinary layer, key or effect.
`sequence()` joins presets end to end, which is how the showreel is made.

The **app mascot kit** (`core/mascotKit.ts`) holds shippable states for app screens — Writing,
Generation Failed/Cancelled/Complete, Shuffling Cards, Cards Fan Out, Hello Wave, Happy Idle,
Cloud Float (+ Pro), Refresh Release, No Scripts Yet, Telescope Scan, Disconnected, Clap and Bow,
Published!, Listening, Wrong Code, Thumbs Up, Head Scratch, Mail Sent, Sad Goodbye, Hello Jump In,
Sparkle Excited, Cover Eyes. Each is Lottie-safe and its tagline names the `.lottie` and state it
belongs to (`KIT_ASSETS`): make one timeline per state, place the preset, wire the inputs. Users can save
their own, and the community catalogue is served by the API.

A preset layer with a negative `zIndex` is placed behind the whole rig (portals, scenery);
any other sits on top.

### Copilot

The Copilot runs as an agent loop against Ollama (local, Ollama Cloud or a custom
endpoint):

```
request → inspect project → find functions → search presets → read their keyframes
        → edit in small batches → preview → verify → adjust → finish
```

- **Real editor operations.** Edits go through the same layer and keyframe functions the
  UI uses, and each one is an undo step. `find_functions` lists the edit tools and every
  store action (read from the store's own `Editor` interface), and `call_editor` runs one.
- **Learns from preset data.** `search_presets` matches on what presets actually do
  (hand tracks, squash, trim, curved text, several mascots). `get_preset` returns their
  real layers, keyframe times, values and easings.
- **Observes its work.** `preview` scrubs the playhead and reports where layers are drawn.
  The agent can also move the playhead, select layers and switch inspector tabs.
- **Visible.** A live activity list (status, reads, edits, errors), tokens used, counted as
  the reply streams in (never capped), the step count and elapsed time. Stop cancels the run.
- **Checkpoints.** Each run records the document before and after it. **Revert agent
  decision** restores the before state in one step. **Reapply** restores the recorded
  result without regenerating it.

### Export

| Format | Notes |
|---|---|
| Lottie JSON | Baked per frame from the same scene the canvas draws. Guides are left out. Blend modes, trim offset, flicker, jitter, echo, depth, camera, particles and per-letter motion bake exactly. **Glow, blur, shadow, RGB split, slices, scanlines, goo, gradients and masks have no Lottie equivalent here**: they are drawn in the editor, GIF, MP4 and PNG, and the export lists which layers lost them |
| `.lottie` | Every state in one composition, with markers and the state machine (`s/<id>.json`) |
| React Native pack | The `.lottie`, `blooby.machine.json` and a generated `Mascot.tsx` for `@lottiefiles/dotlottie-react-native` |
| GIF / MP4 / WebM / PNG | Rasterised in the browser. The video container depends on `MediaRecorder` support |

## Architecture

```
UI (ui/*.tsx)  ──►  store actions (core/store.ts, one per mutation, undoable)
                      │
Copilot agent ──► tools (copilot/tools.ts) ─┘  both call core/layers.ts, writeKeyframe, …
                      ▼
               Project (core/types.ts) ─► evaluateRig / buildScene (core/scene.ts)
                                              ├─► <Shapes> (stage, thumbnails, admin splash, raster)
                                              └─► bakeLottie ─► .lottie / React Native pack
```

- **One document shape.** `Project` in `core/types.ts`. Old files are upgraded by
  numbered, append-only steps in `core/migrate.ts`.
- **One renderer.** Preview, thumbnails, the admin splashscreen and every export go
  through `buildScene`, so they cannot drift apart.
- **One property table.** `core/props.ts`.

[AGENT_MAP.md](./AGENT_MAP.md) traces these flows in more detail.

## Admin splashscreens

`apps/admin` builds the app's splashscreen from the editor's current project, a published
preset or the default mascot. The preview and the live overlay render with the editor's
`sceneAt` and `<Shapes>`, so every layer type the editor draws also draws there. A preset
is mounted with the editor's own `presetPreviewProject`, which brings its layers, effects
and ranges along with its tracks.

## Testing

```bash
pnpm test                                   # everything
pnpm --filter @blooby/studio test           # editor engine, exporters, copilot
pnpm run ci                                 # lint + typecheck + test
```

Tests sit beside the module they cover (`core/rigging.test.ts`, `copilot/agent.test.ts`).
Studio tests run in Node, written as scripts of assertions (`core/testkit.ts`). The apps
use Testing Library in jsdom. Coverage includes:

- sphere maths
- export against the dotLottie engine's parser contract
- migrations of literal old documents
- every built-in preset: placement, closure and the animation critic
- anchor, squish, face, pinning and trim behaviour
- state rules
- the agent loop with a scripted model
- a cross-feature scenario ending in revert, reapply and a "make it slower" follow-up

## Contributing

1. Fork and clone the repository, then run `pnpm install`.
2. Create a branch: `git checkout -b feat/your-change`.
3. Make the change, with tests beside the code you touch.
4. Run `pnpm run ci` and make sure it passes.
5. Commit and open a pull request against `main`.

### Adding editor functionality

To keep the UI and the Copilot in sync:

1. **Write the operation once**: a plain function on a `Project` (usually in `core/layers.ts`).
2. **Expose it as a store action** in `core/store.ts` (one `commit`, so it is undoable),
   with a doc comment on the `Editor` interface. The Copilot's `find_functions` reads that
   comment.
3. **Connect the UI** to the store action. Never mutate `project` from a component.
4. **Register a Copilot tool** when the model should call it directly: `TOOL_NAMES`,
   `TOOL_DOCS`, `validate`, `describe` and `applyCalls` in `copilot/tools.ts`.
5. **New animatable property?** Add a row to `PROPS` and a case in `getProp`/`setProp`.
6. **Changed `Project`?** Make the field optional and add a migration step.
7. **Test it** beside the module, and update [COPILOT.md](./COPILOT.md) or this README if
   behaviour changes.

More guidance: [CLAUDE.md](./CLAUDE.md) (codebase map and conventions),
[ASSUMPTIONS.md](./ASSUMPTIONS.md) (decisions and known limits), [DESIGN.md](./DESIGN.md)
(visual language), [ANIMATION.md](./ANIMATION.md) (motion craft behind the Copilot).

## License

[MIT](./LICENSE) © 2026 Divyanshu Patil
