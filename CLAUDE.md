# Working in this repo

A map, so you can go straight to the file instead of grepping for it. How data flows
between those files (render pipeline, ownership, presets, copilot): `AGENT_MAP.md`. If something here
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
pnpm db:migrate   # apply supabase/migrations/* (psql; tracked in public.schema_migrations)
pnpm test         # vitest across the workspace
```

## Where things live

### The document

`core/types.ts` is the whole data model, and the comments on it carry the reasoning.
Everything else reads a `Project`.

| Concept | Type | Note |
|---|---|---|
| the character | `Rig` / `RigNode` | features are placed by **angle** on a sphere, not pixels |
| one animation | `Timeline` | a project has several; each is one **state**, with its **own layers** (`tl.rig`; the active one is `Project.rig`) — see AGENT_MAP |
| a placed preset | `Block` | clip on the strip |
| a freeform object | `RigNode` (`primitive` / `svgLayer` / `limb` / `group`) | `parentId: null` = world, child of the body = attached |
| a mascot | a `body` `RigNode` + parts with a `role` (`face` is a group holding the eyes and hands) | several per project; `rig.rootId` is the first, and keeps the legacy ids |
| a mascot's clips | `Block.mascotId` | its lane; no id is the first mascot's lane |
| words | `RigNode.text` (`TextStyle`) | a layer; on an arc or along another layer's outline via `text.path` |
| a drawn curve | `RigNode.curve` + `shapePath` | a shape layer; `guide: true` keeps it out of exports |
| draw order | `RigNode.zIndex` | the ONLY ordering — `layerOrder()`, `reorderLayer()` |
| when it is on screen | `Appearance` | on the timeline, scoped like an effect |
| keyframes | `Track` / `Keyframe` | |
| procedural motion | `Modifier` | shake, float, stretch, pendulum, walk, follow, jelly; nodeId `CAMERA_ID` for the camera |
| a layer's look | `RigNode.effects` / `blend` / `mask` / `gradient` / `depth` | drawn in `ui/Mascot.tsx`; inspector `ui/StyleSections.tsx` |
| particles | `Emitter` / `EmitterPart` | zzz, tears, confetti; `path: 'burst'` physics + `attract` |
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
| `core/showcase.ts` | the showcase presets, several-mascot ones included (they bring their own layers + ranges) |
| `core/textPresets.ts` | curved-text and letters-arriving presets; `textPresetOnto` plays one on the selected text |
| `core/layers.ts` | **every layer operation** — order, attach, group, duplicate, appearance, SVG/shape/limb/text/curve makers, curve → rubber hose, `addMascot`. Store and copilot both call it |
| `core/squish.ts` | squish presets and eye actions (blink, squint, close) — keyframe actions written at the playhead (`applySquish`, `applyEyeAction`) |
| `core/appPresets.ts` | the ten app-screen presets (refresh, search, empty states, tap to start…) |
| `core/mascotKit.ts` | the app mascot kit: generating/failed/completed, cards, hero, cloud, empty and error states, celebrations, reactions — Lottie-safe, `KIT_ASSETS` maps presets to `.lottie` states. Also builds five of the app presets |
| `core/cinematicPresets.ts` | the ten cinematic presets (portal, morph, walk + parallax, particles, liquid, glitch, doodle, title, card flip, showreel) and `sequence()` |
| `core/effects.ts` | the layer effect stack (`EFFECTS`): glow, blur, shadow, RGB split, slices, scanlines, flicker, jitter, echo, goo |
| `core/mascot.ts` | what a mascot is: `makeMascot`, roles, `mascotOf`, lanes, `retargetId` (a preset onto another mascot) |
| `core/text.ts` | text layout and glyph placement — lines, arcs, along a path, per-letter motion |
| `core/fonts.ts` | Google Fonts via Fontsource: catalogue, lazy loading, opentype.js metrics and outlines |
| `core/curve.ts` | anchor editing for drawn curves — insert, move, remove, close, reverse |
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
`ui/Stage.tsx` is the canvas and its tools (select, hand, shape, pen, text, turn), with
`ui/CurveHandles.tsx` and `ui/TextPathHandles.tsx` for direct manipulation;
`ui/Timeline.tsx` the strip, its per-mascot lanes and the keyframe lanes. The inspector's
sections for text, curves and mascots are `ui/TextSections.tsx`, `ui/CurveSection.tsx`,
`ui/MascotSections.tsx`; `ui/FontPicker.tsx` is the font browser and
`ui/CompositionDialog.tsx` the canvas-settings modal.

`ui/bits.tsx` has the shared controls (`PropRow`, `NumberField`, `Panel`) — use them
rather than a new one-off input.

### Copilot

`copilot/agent.ts` is the loop (inspect → act → preview → finish), its read/UI tools, preset search and
discovery. `copilot/tools.ts` is the edit contract: one entry in `TOOL_NAMES`, a `validate` case, a
`describe` case and an `applyCalls` case. `copilot/prompt.ts` builds the system prompt.
See `COPILOT.md`.

### MCP (AI apps driving the Studio)

`docs/mcp/` explains it; the short version: `packages/studio/src/engine/` is the capability
registry (derived from the copilot's tools, the store's `Editor` interface and the agent's reads)
plus `EditorSession`, the real store run headless — exported as `@blooby/studio/engine`, the
node-safe entry. `apps/api/src/services/mcp/` serves it at `/mcp` with OAuth; the editor's MCP
tab is `ui/McpPanel.tsx`, the consent page `apps/web/src/features/connect/Connect.tsx`.
A new store action (with a doc comment) or copilot tool **is** a new MCP capability — then run
`pnpm --filter @blooby/api mcp:docs` to regenerate `docs/mcp/tools.md` and `parity.json`.
The API runs studio source under `tsx`; `apps/api/src/loaders/raw.mjs` answers `?raw` imports.

### API

Standard layering, one file per resource at each level:
`routes/ → controllers/ → services/ → repositories/ → prisma`.
DTOs in `dtos/`, cross-cutting concerns in `middlewares/`.

Sharing: a project is `private` or `public`, and while public its `access` is `view` (open and
duplicate) or `edit` (any signed-in user saves to it, under the owner's storage key). Both are
checked once, in `services/projects.service.ts`. Public projects, the trending sort and the public
insights are under `/community`; trending is `utils/trending.ts`.

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

## What's New — update it with every user-visible change

`packages/studio/src/whatsNew.ts` is the changelog people see: a "What's new" button in the
editor toolbar and the dashboard footer, opening by itself when there is something unseen.
**Any change a user would notice adds an item there in the same change** — a new release at the
top of `RELEASES` (version `YYYY.MM.DD`, `.2` for a second one that day), or an item on today's
release if it already exists and has not shipped. Write it for a person (what they can do now,
where to find it), set `surface: 'editor' | 'dashboard'`, and give it a `tour` of `data-tour`
steps when it has a place on screen — `whatsNew.test.ts` fails on an anchor the UI doesn't render.
What each person has seen is `profiles.last_seen_release` (PUT `/api/auth/whats-new`; localStorage
when signed out); everything newer is shown. Never edit an old release's version.

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
