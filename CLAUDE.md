# Working in this repo

A map, so you can go straight to the file instead of grepping for it. If something here
contradicts the code, the code is right — fix this file in the same change.

## Shape

pnpm workspaces + Turborepo. Three apps, one package that holds nearly all the logic.

```
packages/studio/        the editor, the exporters, the copilot — almost everything
apps/web/               user-facing shell: auth, dashboard, community, cloud editor
apps/admin/             moderation, users, preset publishing, analytics
apps/api/               Express + Prisma + Supabase
```

`packages/studio/src/index.ts` is the only public surface of the package. Apps import
from `@blooby/studio`, never by deep path — if a component needs to be shared, export it
there.

```bash
pnpm dev          # all three apps
pnpm dev:web      # http://localhost:5173
pnpm ci           # lint + typecheck + test — run before saying you're done
pnpm test         # vitest across the workspace
```

## Where things live

### The document

`core/types.ts` is the whole data model, and the comments on it carry the reasoning.
Everything else reads a `Project`.

| Concept | Type | Note |
|---|---|---|
| the character | `Rig` / `RigNode` | features are placed by **angle** on a sphere, not pixels |
| one animation | `Timeline` | a project has several; each is one **state** |
| a placed preset | `Block` | clip on the strip |
| a freeform object | `RigNode` (`primitive` / `svgLayer` / `limb` / `group`) | `parentId: null` = world, child of the body = attached |
| draw order | `RigNode.zIndex` | the ONLY ordering — `layerOrder()`, `reorderLayer()` |
| when it is on screen | `Appearance` | on the timeline, scoped like an effect |
| keyframes | `Track` / `Keyframe` | |
| procedural motion | `Modifier` | shake, float, stretch, pendulum |
| particles | `Emitter` / `EmitterPart` | zzz, tears, confetti |
| the state machine | `StateMachineDef` | inputs + transitions; states are the timelines |

### Core

| File | Owns |
|---|---|
| `core/store.ts` | **the single zustand store.** Every mutation is an action here. 1,200 lines, and the first place to look for "how does X change" |
| `core/scene.ts` | evaluate the rig at time *t* — keyframes, effects, blends |
| `core/curvature.ts` | the sphere maths that makes a feature arc across the face |
| `core/timeline.ts` | clip layout, durations, retiming |
| `core/props.ts` | **the one table of animatable properties.** Add a property here and the inspector, the timeline and the copilot all pick it up |
| `core/stateMachine.ts` | dotLottie conversion both ways, evaluation, validation |
| `core/migrate.ts` | **every old document shape.** Read it before changing `Project` |
| `core/defaults.ts` | the default mascot, builtin presets, `makeTimeline` |
| `core/showcase.ts` | the freeform showcase presets (they bring their own layers + ranges) |
| `core/layers.ts` | **every layer operation** — order, attach, group, duplicate, appearance, SVG/shape/limb makers. Store and copilot both call it |
| `core/limb.ts` | the rubber-hose engine: points + length → outline (Cavalry-style, length is kept) |
| `core/svg.ts` | SVG → vector paths (and the sanitised markup kept alongside) |
| `core/comp.ts` | `compOf(project)` — the canvas size. Never hard-code 720 |
| `core/publicApi.ts` | `window.blooby.*` — the host-page surface |

### Export

| File | Produces |
|---|---|
| `export/lottie.ts` | bakes a timeline to Lottie JSON |
| `export/dotlottie.ts` | the `.lottie` container, **and imports one back** |
| `export/strip.ts` | lays every pose into ONE composition with morph frames between — read this before touching the exporter |
| `export/runtime.ts` | the React Native pack: generated `Mascot.tsx` + config |
| `export/zip.ts` | hand-rolled zip read/write, no dependency |
| `export/raster.ts` | GIF / MP4 / PNG |

### UI

`ui/Editor.tsx` is the frame — read it first to see how the panels fit together.
Right-rail tabs: `Inspector` (node), `EyePanel`, `Effects`, `StateMachine`, `Copilot`.
`ui/Stage.tsx` is the canvas, `ui/Timeline.tsx` the strip and keyframe lanes.

`ui/bits.tsx` has the shared controls (`PropRow`, `NumberField`, `Panel`) — use them
rather than a new one-off input.

### Copilot

`copilot/tools.ts` is the contract: one entry in `TOOL_NAMES`, a `validate` case, a
`describe` case and an `applyCalls` case. `copilot/prompt.ts` builds the system prompt.
See `COPILOT.md`.

### API

Standard layering, one file per resource at each level:
`routes/ → controllers/ → services/ → repositories/ → prisma`.
DTOs in `dtos/`, cross-cutting concerns in `middlewares/`.

## Conventions that will trip you up

**CSS is hand-rolled, in `packages/studio/src/index.css`.** Tailwind is present but only
generates classes found under the `@source` directive at the top of that file — importing
`tailwindcss/utilities.css` directly (as this repo does) disables automatic detection, so
a missing `@source` silently produces *no CSS at all* for a utility class. Prefer the
existing vocabulary: `.panel`, `.row`, `.btn`, `.prop-label`, `.prop-num`, `.txt`,
`.hint`, `.seg`, `.tag`, `.divider`, `.fold`.

**Tests sit beside the module** as `*.test.ts` and are written as a script of assertions,
not `describe`/`it` blocks with setup. `core/testkit.ts` exports `check(value, detail)`,
which **captures the value at the point it is written** — a plain getter would be
evaluated after the whole file has run. Follow the surrounding style.

**Studio tests run in `node`, not jsdom.** Component tests live in the apps. A `?raw`
import works for `.tsx` but comes back empty for `.css` (Vite's CSS pipeline runs first).

**Changing the `Project` type = a migration.** Make the field optional, append a step to
`MIGRATIONS` in `core/migrate.ts`, bump `SCHEMA_VERSION`. That file documents the rules at
the bottom. Never edit an existing step.

**One store, one action per mutation.** Don't reach into `project.timelines[i]` from a
component — the store has `at(p)` for the active timeline and `commit()` for undo.

## Documents worth reading before a big change

- `ASSUMPTIONS.md` — what is verified, what is guessed, and what is known-unverified.
  Anything surprising in the codebase is usually explained here.
- `DESIGN.md` — the visual language. Monochrome; colour only for destructive states.
- `ANIMATION.md` — where the copilot's numbers come from.
- `COPILOT.md` — how to work on the agent.

## State machine, specifically

The editor authors a **real dotLottie state machine**, not a mock. The vocabulary in
`core/stateMachine.ts` (`Boolean`/`Numeric`/`String`/`Event`, `conditionType`,
`compareTo`, `Tweened`) is dotLottie's own, verified against `dotlottie-rs`'s parsers —
don't "improve" the names, the export stops loading.

Flow: `inputs → transition conditions → state → animation`. The app never names an
animation; it sets an input and the machine decides. The generated `Mascot.tsx` picks the
setter from each input's declared type, so nothing hardcodes an input name.

Two asymmetries to know about.

**dotLottie has no OR.** A guard list is always ANDed, so an `OR` transition fans out into
one transition per condition at export.

**There is no cross-composition morph.** A `Tweened` transition interpolates the playhead
*inside the loaded composition*, and the engine skips the tween outright unless both states
name the same animation. So every baked timeline is exported as part of one composition —
`export/strip.ts` lays them out with real morph frames between — and each state carries
`segment`, **a marker NAME, not a frame pair** (`Option<String>` → `set_marker()`; it is
also how the tween finds its target frame). The constraint that falls out: **every frame of
the strip must be a valid pose**, same layers throughout, because the tween scrubs through
them. Never drop a layer between poses; fade it. (`bakeLottie` already does this — it takes
the union of layers it sees and writes opacity 0 where one is absent.)

**The engine's parser is all-or-nothing and silent.** A field present with the wrong type
discards the entire machine, `stateMachineLoad` returns a false the bindings drop, and the
animation autoplays looking roughly right. Before changing anything the machine emits, read
`export/engineContract.test.ts` — it is dotlottie-rs's parser written out field by field.
