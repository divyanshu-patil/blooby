# Worked examples

Tool calls as an agent makes them. Every call below runs in a test as written — `packages/studio/src/engine/engine.test.ts` ("documented example … runs") and the end-to-end MCP test `apps/api/src/services/mcp/mcp.e2e.test.ts`.

## "Create a bouncing Blooby entrance"

```
project_create      { name: "Bouncy entrance" }
guide_get           { topic: "craft" }
preset_search       { query: "jump land squash" }          → e.g. a hop preset
preset_get          { preset: "<id>" }                      → its timing and easing
transaction_begin   { label: "entrance" }
batch_execute       { calls: [
  { capability: "add_keyframe", args: { nodeId: "body", property: "flatOffset.y", atMs: 0,   value: 260 } },
  { capability: "add_keyframe", args: { nodeId: "body", property: "flatOffset.y", atMs: 450, value: -40, easing: "easeOut" } },
  { capability: "add_keyframe", args: { nodeId: "body", property: "flatOffset.y", atMs: 700, value: 0,   easing: "easeIn" } },
  { capability: "apply_squish_preset", args: { nodeId: "body", preset: "Landing Squash", atMs: 700 } }
] }
render_sequence     { fromMs: 0, toMs: 1400, frames: 8 }    → one image of the arc
critique            { request: "a bouncing entrance" }
transaction_commit
project_save
```

## "Create a reusable waving preset" → "Save it as Happy Entrance"

```
add_layer           { type: "hand" }                        (if the mascot has no hands yet)
set_pose            { pose: "Wave", atMs: 400 }
set_pose            { pose: "<rest pose>", atMs: 1200 }
render_frame        { atMs: 400 }
preset_save         { name: "Happy Entrance", description: "Waves hello" }   → assetId, in your library
preset_publish      { assetId, description: "A friendly wave" }             → community review
```

## "Open my current project and inspect the animation"

```
project_list        {}
project_open        { name: "Product intro" }
editor_get_state    { level: "full" }
timeline_get        {}
render_sequence     { frames: 12 }
```

## "Find all layers using red" / "Make the mascot 20% smaller"

```
layer_find          { color: "#ff0000", tolerance: 80 }
set_mascot_transform { mascot: "body", scale: 0.8 }
```

## "Add a 2-second squish animation"

```
apply_squish_preset { nodeId: "body", preset: "Bounce Squash", atMs: 0 }
editor_tween_property { nodeId: "body", property: "squish.y", target: 1, durationMs: 2000, easing: { type: "preset", name: "easeInOut" } }
```

## "Render the frame at 2.4 seconds"

```
render_frame        { atMs: 2400, quality: "medium" }       → image/png + { atMs, composition, revision, selection }
```

## "Create a particle explosion"

```
add_emitter         { name: "boom", glyphs: [], parts: [{ shape: "dot" }, { shape: "star", color: [255,200,0] }],
                      path: "burst", count: 400, velocity: 900, spread: 360, drag: 1.5, gravity: 600,
                      lifeMs: 1400, startMs: 800 }
render_sequence     { fromMs: 700, toMs: 2000, frames: 6 }
```

## "Duplicate this composition and change the colours"

```
project_duplicate   { name: "Intro — night" }
layer_find          { kind: "body" }
set_svg_fill        { nodeId: "body", color: "#1b1f3a" }
render_frame        {}
```

## "Export this animation"

```
project_save        {}
export_start        { format: "lottie" }        → Lottie JSON inline + downloadUrl (1 hour)
export_start        { format: "dotlottie" }     → every state + the state machine
```

## Working safely

```
checkpoint_create   { name: "before redesign" }
…
checkpoint_diff     { name: "before redesign" }     → created / deleted / field-by-field from → to
checkpoint_restore  { name: "before redesign" }     → exact document back, undoable
add_layer           { type: "shape", shape: "star", dryRun: true }   → what would change, nothing changed
add_keyframe        { …, requestId: "k-17" }        → a retry with the same requestId returns the first result
add_keyframe        { …, expectedRevision: 42 }     → REVISION_CONFLICT if the project moved on
```

## Errors are written to be recovered from

```json
{ "ok": false, "error": {
  "code": "INVALID_VALUE", "message": "\"preset\" must be one of: Soft Squash, Heavy Squash, …",
  "field": "preset", "value": "Land", "allowed": ["Soft Squash", "…"] } }
```

Common codes: `MISSING_ARGUMENT`, `UNKNOWN_ARGUMENT`, `INVALID_TYPE`, `INVALID_VALUE`, `INVALID_ARGUMENT` (with a `suggestion`), `ENTITY_NOT_FOUND`, `UNKNOWN_CAPABILITY` (with near matches), `NO_PROJECT`, `REVISION_CONFLICT`, `READ_ONLY_PROJECT`, `FORBIDDEN_SCOPE`, `READ_ONLY_CONNECTION`, `CONFIRMATION_REQUIRED`, `RATE_LIMITED` (with `retryAfterMs`), `BUSY`, `TRANSACTION_OPEN`, `NO_TRANSACTION`, `JOB_NOT_DONE`.
