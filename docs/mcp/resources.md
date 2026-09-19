# Resources and prompts

## Resources

Read-only context an app can pull in without a tool call. Resources under `blooby://project/current` support **subscriptions**: a subscribed client is sent `notifications/resources/updated` whenever the open project changes, whoever changed it.

| URI | Type | Contents |
|---|---|---|
| `blooby://guide/workflow` | markdown | the working loop: look → learn → plan → act → check → save |
| `blooby://guide/craft` | markdown | timing, easing, anticipation, overshoot and squash numbers for this rig — the in-app copilot's own craft rules |
| `blooby://guide/tools` | markdown | every edit tool with its usage notes |
| `blooby://guide/properties` | markdown | every animatable property: path, range, unit, what it does |
| `blooby://guide/effects` | markdown | layer effects and procedural modifiers |
| `blooby://guide/easing` | markdown | easing names |
| `blooby://capabilities` | json | every capability allowed to this connection, one line each |
| `blooby://schema/project` | typescript | `core/types.ts` — the whole document model, with its reasoning |
| `blooby://project/current` | json | editor state: layers, states, clips, playhead, selection, viewport, revision, unsaved |
| `blooby://project/current/timeline` | json | tracks and keyframes of the active state, with ids |
| `blooby://project/current/document` | json | the complete project JSON |
| `blooby://projects` | json | your projects |
| `blooby://presets` | json | every preset you can use, with tags describing what it does |
| `blooby://presets/{id}` | json | one preset's layers, tracks and keyframes |
| `blooby://layers/{id}` | json | one layer as the inspector sees it |
| `blooby://exports/{jobId}/{filename}` | file | an export made in the last 30 minutes |

## Prompts

Starting workflows (Claude shows them as slash commands). They hide no capability; they carry the method that makes Blooby's own presets look the way they do.

| Prompt | Arguments | What it sets up |
|---|---|---|
| `create_animation` | `request`, `project?` | plan in beats, study a similar preset, build in a transaction, render, critique, fix, save — with the craft guide inlined |
| `create_preset` | `description`, `name?` | a preset that closes on its first pose, checked and saved to the library |
| `debug_animation` | `problem` | diagnose with renders, evaluate and timeline_get before touching anything |
| `optimize_animation` | `focus?` | polish without changing the story; summarise with checkpoint_diff |
| `inspect_project` | `project?` | describe a project without changing it |
| `explain_current_animation` | — | a beat-by-beat walkthrough for non-animators |
| `prepare_for_export` | `format?` | loop closure and machine checks, then export and hand over the link |
| `blooby_workflow` | — | the working method |

## Server instructions

On connect the server sends instructions (clients such as Claude add them to the model's context): start from `project_open`/`project_create`, look with `render_frame`, read the craft guide and a similar preset before animating, verify with renders and `critique`, then export.

## Matching Blooby's quality from outside

An outside model has none of Blooby's code, so the server gives it the same material the in-app copilot works from:

1. **The craft guide** (`guide_get { topic: "craft" }`) — concrete numbers for this rig.
2. **Every preset as data** — `preset_search` ranks presets by what their keyframes actually do; `preset_get` returns each track's keyframes as `[ms, value, easing]`, plus layers, modifiers and emitters; `full: true` returns the raw JSON.
3. **Eyes** — `render_frame` / `render_sequence` return real images from the stage renderer.
4. **A reviewer** — `critique { request }` runs the copilot's second gate on what this session wrote: named motions missing, movement too small to see, loops that do not close, no held poses, identical timing on every layer.
