# Agent map — how the code actually flows

CLAUDE.md says where files are. This says how data moves between them, so an agent can
change something without re-reading 5,000 lines. Terse on purpose. Code wins on conflict.

## Render pipeline (one path for everything)

```
Project ─ evaluateRig(p, t) ─► Rig (tracks sampled, modifiers, appearance → opacity)
        └ composeScene / sceneAt(p, t, comp) ─► SceneItem[]  (buildScene + emitters)
SceneItem[] ─► ui/Mascot.tsx <Shapes>   stage, thumbs, admin splash, raster export
            ─► export/lottie.ts bakeLottie   samples sceneAt per frame, writes shapes
```
- `core/scene.ts buildScene(rig, view, frames?)` walks parent→child. Each layer gets a
  `LayerFrame {x,y,rot,kx,ky,cum,R,head,squash,alpha,parentCum}`. Children use the parent
  frame. `toFrame/fromFrame` convert local↔screen. Stage drags + `placeUnder` use the same frames.
- body: `mascot()` inner fn. Mapped (`surface.mapped`) children project onto the sphere
  of radius `f.R` with head turn `f.head`; flat children use `flatOffset * kx/ky`.
- limb: points a/b/c live in the PARENT frame; `rubberHose(hoseInputOf(...))` → outline.
- text laid out last (may follow another layer's outline via `placed`).
- Anything added to SceneItem must be handled in `Shapes` (preview) AND `bakeLottie`.
- `stretchOf(node)` = scale × clamped `squish`; `pivoted()` moves the centre so roll/scale/
  squish turn about `node.anchor` (CSS transform-origin semantics — anchor alone moves nothing).
- A body with a face GROUP defers its drawing (`heads` map) and emits it in the face's frame.
- A `group`/role `face` on a sphere (`f.R > 0`) passes R, head(+own yaw/pitch), squash down;
  eyes inside a face stay mapped. `pinned()` rewrites a limb's end point to `limb.pin` (WORLD px).
- `SceneItem.trim` → `Shapes` draws the stroke unscaled in px with one measured dash
  (`trimStroke`); lottie writes a `tm` shape in `paintGroups`.

## Motion systems (round 4)
- `core/effects.ts EFFECTS` = the effect stack; params are props `effect.<kind>.<param>`.
  scene.ts: flicker/jitter evaluated (alpha / `boil` path), echo in `composeScene` (re-evaluated
  rig at earlier t → `id~echoK`), the rest travel as `SceneItem.fx` and are drawn by `withEffects`
  in ui/Mascot.tsx. rgbSplit/slices/scanlines/blur are handed down to children (`handedDown`).
- `blend`, `gradient`, `mask` (→ `SceneItem.clip` post-pass from `placed` outlines), goo (parent +
  children share one filter group). Lottie: `bm`, trim `o`; the rest → `bakeLottie().warnings`.
- 2.5D: `depthFrame(z)` = 1000/(1000+z) on world layers; rotateX/Y cos-narrow; on a body they
  add to yaw/pitch. Camera `zoom`; modifiers with nodeId `CAMERA_ID` move the camera.
- Modifiers `walk` (planted feet, `holdUntilMs`, two-bone `knee` IK, `footFacing`), `follow` (spring over past samples), `jelly`
  (outline from vertical velocity). `past` sampler = resolved timeline cache + `modifierMotion` (float/shake/pendulum/walk
  displacement), so drivers feel modifier motion too. Per-kind defaults: `MODIFIERS[k].defaults`.
- Emitters `path:'burst'`: closed-form physics in `emitterItems`; `attract` onto an outline or
  text glyphs (hidden target rebuilt); `emitterPathAt` shared with TrajectoryHandles. Glyphless
  particles draw as dots; `emitterFrame` unit ignores a mascot scaled below 0.1.
- Text `charOffsets` (props `text.char.<i>.*`, `group` rows kept out of PROP_ALIAS), `charOrient`.
- Limb pins: `limb.pin` (end) + `limb.pins[a|b|c]` world px; `pinned()` stretches length to reach.
- Presets: `core/cinematicPresets.ts` (`settled` = open on rest + looped; `sequence()` joins
  presets). Negative preset-layer zIndex → behind the rig (`addPresetLayers`). Migration 9.

## App mascot kit
- `core/mascotKit.ts mascotKitPresets()` + `KIT_ASSETS` (file → input → state → preset id). Lottie-safe only
  (no filter effects; `mascotKit.test.ts` bakes each). Loops authored closed with `sine()` (no seam snap, tested).
  Hands in front of the body = `mitten{L,R}` art riding the arm point (`mittenHand`). Builds 5 app presets
  (refresh = scrubbed, search, noresults, nosaved, nodecks); migration 10 swaps builtin copies.
- Hit slop: `:where(...)::before` behind children in index.css (end of file).

## Values & keyframes
- `core/props.ts PROPS` table + `getProp/setProp` switch = every animatable property.
  Inspector `PropRow`, timeline lanes, copilot validation all read it.
- `sampleTrack` uses the EARLIER keyframe's `easingOut`. `valueAt(p,node,prop,t)` = what the
  inspector shows; `activeTrackFor` picks the track (clip-sealed, per mascot lane).
- Store writes: `setValue` (autokey/track aware), `writeKeyframe(p,…)`, `layers.writeValue`.
- Undo: `commit(fn,label)` clones project; same label within 700ms coalesces.

## Layers / ownership
- Every timeline has its OWN rig. `p.rig` is the ACTIVE timeline's (every editor action reads/writes it);
  inactive ones keep theirs in `tl.rig`. Change the active timeline only through `switchTimeline(p,id)`
  (types.ts — parks/unparks rigs). Draw/export another state with `asTimeline(p,id)` / `rigOf(p,tl)`, never
  `{...p, activeTimelineId}` (that would pair its tracks with the wrong layers). New timeline = the first mascot only
  (`baseRig`; `emptyRig`, rootId '' until `addMascot`, is the fallback); `addTimeline(name,{copyLayers})`, `duplicateTimeline`.
  Copilot `add_timeline` copies layers unless `copyLayers:false`. Migration 11 gave old timelines copies.
- Layer ops in layers.ts touch only the active timeline's tracks; `showLayerIn(...,'everywhere')` copies
  the layer into every other timeline's rig.
- Visibility per timeline: `appearanceAt(tl,node,t)` — no entry → visible unless `node.ranged`.
- `core/layers.ts` = every layer op (store + copilot both call it). `removeLayer` cleans
  tracks/appearances/links in the active timeline (the others have their own layers).
- NEW layers are owned by the active state: `ownLayer()` (store.addLayer + copilot add_*)
  sets `ranged` + a whole-timeline appearance. Mascots/faces are not owned (shared rig).
- Mascot = `body` node + parts with `role`. Roles: body, face (group), eyeL/R (in face),
  armL/R (in face via `limbParent`), legL/R (on body). `setFaceRole`, `pinLimb`, `adopt()`
  (reparent keeping screen position, mapped children included) live in layers.ts.
  `mascotOf`, `partOf(rig, mascotId, role)`, `retargetId` map preset ids onto a mascot.

## Presets
- Registry: `defaults.builtinPresets()` = `showcasePresets()` + `textPresets()` + `appPresets()` + moods.
  Builtins must close on their opening pose (`looped()`); showcase.test runs every one.
- Squish presets are NOT presets: `core/squish.ts applySquish` writes keys at the playhead.
  Old projects get new builtins through a `migrate.ts` step (append-only, bump SCHEMA_VERSION).
- Placing: store `addBlock` → tracks offset by clip start + `attachPresetEffects` (modifiers,
  emitters, `addPresetLayers`, appearances). Preview: `presetPreviewProject(project, preset)`.
- Authoring helpers in `core/showcase.ts`: `k, tr, both, squash, uniform, point, words, art, limb`.

## State machine
- States = timelines. `SmTransition {from,to,conditions,logic,durationMs,easing}`.
  `from === ANY_STATE ('*')` is a RULE: from whatever state is current.
- `concreteTransitions(p)` fans rules out (own edges first, never into itself). Use it
  everywhere the engine's view is needed: `nextTransition`, `toDotLottie`, runtime pack.
- Preview: store `setInputs` → `nextTransition(p, activeId, values)` (chains hops per write).
- UI: `ui/StateGraph.tsx` node editor (drag ports to wire), `Rules` in `ui/StateMachine.tsx`.
- Export: `toDotLottie`, `export/runtime.ts` (RN pack), `export/dotlottie.ts` (import back).
  Contract: `export/engineContract.test.ts`.

## Copilot
- `copilot/tools.ts`: TOOL_NAMES, TOOL_DOCS, `validate`, `describe`, `applyCalls` (runs in one commit).
  Motion tools: set_layer_effect, set_layer_style, add_emitter (burst/attract), add_modifier (camera).
- `copilot/prompt.ts systemPrompt(p, made, playhead, protocol?)` dumps layers/timeline;
  `copilot/client.ts chatJson` → Ollama `/api/chat`, returns `usage`.
- `copilot/agent.ts runAgent`: loop of `{plan,status,calls,done}`; edit tools → `applyCalls`
  per call; agent tools (`runAgentTool`) read/preview/move UI; `find_functions` parses
  `interface Editor` from `store.ts?raw` — doc-comment new store actions there.
- UI `ui/Copilot.tsx` (`RunCard`: activity, tokens, revert/reapply via
  `store.restoreProject`), thread store `copilot/session.ts` (`Turn.run` checkpoint).
- Right-rail tab is store state (`railTab`) so the agent can switch it.

## MCP (docs/mcp/)
- Registry `engine/registry.ts capabilities()`: edit tools (TOOL_DOCS parsed to JSON Schema), store actions
  (`editorFunctions()`, excluded ones in `excludedActions()` with reasons), agent reads, session + host caps via
  `registerCapabilities`. `EditorSession.invoke(id, args)` swaps the session's store snapshot into `useEditor` under a
  global lock → validate (schema, then `normaliseCall`/`validateBatch` for edit tools) → apply → `diffProjects` → OpResult.
  Transactions/checkpoints/idempotency/dryRun/expectedRevision live there.
- API: `routes/mcp.routes.ts` (`/mcp` Streamable HTTP + SDK `mcpAuthRouter` + `/api/mcp/*`), `services/mcp/server.ts`
  (tool list per scope/mode/profile, `callTool`, resources, audit, limits), `host.ts` (project/preset/render/export/job
  caps), `workspace.ts` (session per user+project, autosave 2.5s, `sync` vs stored version, proposals), `auth.service.ts`.
- Editor: `useMcpLive` polls `/api/mcp/live`; CloudEditor adopts a newer AI save via `useAutosave().adoptRemote`.

## Latency (why the API is shaped this way)
- One round trip to the Supabase pooler measures ~580ms from the deployment; an S3 GET ~270ms;
  the median project is 320KB. Request time = the COUNT of serial hops, so the rule is: add a
  hop only if the answer can change.
- `utils/ttlCache.ts` = read-through cache holding the PROMISE (a burst shares one load).
  `utils/invalidate.ts shared(name, forget)` publishes the eviction over Redis so every instance
  drops it; `listenForInvalidations()` in index.ts subscribes. No Redis → local forget + the TTL.
- Cached: the profile behind `req.user` (30s, evicted by every profile write), a project's OWNER
  (10min — a project never changes hands, so it cannot go stale), auth identities (60s).
  Visibility/access are NEVER cached: the owner flips them at will.
- Project JSON never passes through the API. `/data` and every listing carry a presigned
  `dataUrl`; the browser fetches S3 directly. Objects are stored gzipped with `ContentEncoding`,
  so the browser inflates them and a card moves ~7× less; the reader sniffs gzip's magic bytes,
  so pre-compression objects still open. `cloud/client.ts` gzips request bodies too (Express
  inflates them with no server change).
- An owner's autosave is ONE query: `writeAndBump` puts the object, then compare-and-sets the
  version. Order is load-bearing — a failed upload must leave the row on the whole object.
- `config/redis.ts` is optional everywhere. It backs the HTTP rate limiters (so "60 a minute"
  is not 60 per instance) and the invalidation channel. The MCP throttle stays in memory.

## Admin
- `apps/admin/src/features/Splashscreens.tsx` builds splash data; `SplashPreview.tsx` renders
  via `sceneAt` + `MascotThumb` (same renderer as the editor).

## UI conventions added
- Menus/popovers close on outside click via `useDismiss(open, close, [refs])` in `ui/bits.tsx`.
- Colour text entry: `readHex` (core/color.ts) behind the hex field in `ColorField`.
- Timeline easing popover on a track's last key edits the incoming segment (`curveKf`);
  GraphEditor `segmentOf` does the same for handles. Key drags move BY the drag (3px threshold).
- `setEasingIn` bakes bounce/elastic into keys (`bakedFrom`/`bakedAs`).
- Colours: `ui/ColorPicker.tsx` (portal popover, PASTELS in core/color.ts), `HexColorPicker` for hex strings.
- Roles: `layers.setRole` / `rolesFor` / `ROLE_LABEL`; Layers panel double-click on the tag.
- `layers.applyScaleAsBase` bakes mascot scale into sizes; `PropRow linkTo` links scale X/Y.
- `layers.moveInto` reparents keeping screen position (Layers drag "into", Move out, limb "Attached to").
- `layers.absentHere` / `showLayerIn` — layers owned by other states, "+ here" in Layers.
- `core/poses.ts` POSES + `applyPose` (limbs by role; arms may have an elbow: a,b=elbow,c=hand).
  Stage shows pose handles for every limb of the selected mascot.
- State graph node positions persist in `StateMachineDef.layout` (`setStateNodePosition`).
- Copilot `normaliseCall` splits "body.transform.scale.x" nodeIds; missing-keyframe errors list real times.
- Previews built from a fresh timeline must copy the state's clip-less appearances
  (`presetPreviewProject`, `effectPreviewProject`, SquishPreview) or owned layers vanish.
- Headless visual check: `apps/web/harness.html` exposes `window.__editor` (dev-only).
- Keyframe copy/paste: `copy`/`paste` events in Timeline.tsx, clipboard text `blooby-keyframes:` + JSON.
- `valueAt` samples loop-resolved tracks, same as `evaluateRig`.

## What's New
- `packages/studio/src/whatsNew.ts` RELEASES (newest first) + `unseenReleases(seen)`; seen = `profiles.last_seen_release`
  (session user `lastSeenRelease`, PUT `/api/auth/whats-new`, never backwards) wired by web `App` via `configureWhatsNew`,
  localStorage otherwise. UI `kit/WhatsNew.tsx WhatsNewButton` (editor toolbar, dashboard footer); item tours = driver steps
  on `data-tour` anchors, checked by `whatsNew.test.ts`. Every user-visible change adds an item (CLAUDE.md).

## Tests
- `pnpm --filter @blooby/studio test` (vitest, node). Style: script of `it(name, check(v, detail))`.
- `pnpm ci` = lint + typecheck + test across the workspace.
