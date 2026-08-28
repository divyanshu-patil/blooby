# Working on the copilot

The copilot turns a sentence into editor actions. It is a plain request/response loop —
no agent framework, no streaming — and everything it is allowed to do is declared in
three tables. **Adding a capability means adding a row to a table, not editing five
files.** Where that is not yet true, fix the table rather than working around it.

Read this before touching `packages/studio/src/copilot/*`, `core/props.ts`, or
`Modifier` in `core/types.ts`.

## The rule

> If the editor can do it, the copilot must be able to do it, with a description, and
> `pnpm check` must fail if that stops being true.

Every bug the copilot has had was a violation of this. `stretch` shipped working and the
copilot rejected it for weeks, because the allowed kinds were written out by hand in
`validate`. `eye.openness` was rejected as `"openness" is not an animatable property`
because the tool docs used short names and nothing mapped them back. Both were parallel
lists drifting apart, and both are now derived.

## The three tables

| Table | Lives in | Drives |
| --- | --- | --- |
| `PROPS` | `core/props.ts` | inspector labels + sliders, what the renderer bakes, what the copilot may keyframe, the property reference in the system prompt |
| `MODIFIERS` | `core/types.ts` | the Effects panel's buttons and dial limits, the effect list in `TOOL_DOCS`, what `validate` accepts |
| `TOOL_NAMES` | `copilot/tools.ts` | the JSON schema sent to Ollama, the parser's allow-list |

Nothing downstream of these should ever restate their contents. If you find yourself
typing `'shake' \|\| 'float'` or a list of property paths, you are re-introducing the bug.

## Adding an animatable property

1. **Add the row to `PROPS`** in `core/props.ts`:

   ```ts
   'transform.skew': {
     on: 'node',                          // or 'camera'
     label: 'Skew',                       // what the inspector calls it
     range: [-45, 45, 1, '°'],            // [min, max, step, unit]; omit for non-numeric
     help: 'Slants the feature. Negative leans left, positive right; ±12° is a lot.',
   },
   ```

   Write `help` for someone who has never seen the editor. Say **which way is positive**
   and **what a typical value looks like** — it goes verbatim into the system prompt, and
   a model that does not know 8° is a cheeky tilt will write 80.

2. **Add the case to `getProp` and `setProp`** in the same file (or `getCameraProp` /
   `setCameraProp` for `on: 'camera'`). This is the only hand-written step, and
   `pnpm check` fails by name if you skip it:

   ```
   FAIL every PROPS row round-trips through get/setProp   transform.skew
   ```

3. **Make the renderer honour it** in `core/scene.ts`, if it needs to do more than sit on
   the node.

That is all. You get, for free: the inspector row, the slider bounds, keyframing, baking
to Lottie, the copilot's permission to write it, its short-name alias (`skew` →
`transform.skew`), and its line in the prompt's property reference.

**Do not** add it to a list in `types.ts`, `scene.ts`, `prompt.ts` or `tools.ts`. Those
lists no longer exist. `NODE_PROPS`, `CAMERA_PROPS`, `NUMERIC_PROPS`, `PROP_LABEL`,
`PROP_RANGE` and `PROP_ALIAS` are all derived from `PROPS`.

### Ambiguous short names

`PROP_ALIAS` maps a property's tail back to its full path, but only when the tail is
unique. `x` and `y` are deliberately absent — `size.x`, `flatOffset.x` and
`transform.scale.x` all end in `x`, so a guess would be wrong more often than right. A
model that writes a bare `x` gets a rejection naming every valid path, and the re-prompt
fixes it. Keep it that way; do not add a favourite.

## Adding an effect

1. Add the row to `MODIFIERS` in `core/types.ts` — `label`, `maxFrequency`, and a `help`
   line naming its useful frequency and amplitude ranges.
2. Add a branch to `applyModifier` in `core/scene.ts`.
3. Add its starting dial positions to `DEFAULTS` in `ui/Effects.tsx`. That map is typed
   `Record<ModifierKind, …>`, so this one **will not compile** until you do.

The Effects panel button, the copilot's permission and the prompt's description all
follow. `pnpm check` asserts every kind in `MODIFIERS` is accepted by `validate`.

## Adding a tool

1. Add the name to `TOOL_NAMES` in `copilot/tools.ts`. This is the single list the JSON
   schema and the parser's allow-list both read — miss it and the parser silently drops
   every call to your tool.
2. Add a line to `TOOL_DOCS` — argument names, and a `//` comment for anything a model
   would otherwise guess wrong.
3. Add a `case` to **all three** of `validate`, `describe` and `applyCalls`. A tool with
   only the first two validates, renders a nice card, and does nothing when applied —
   which is precisely what `set_block_duration`, `remove_block`, `move_block` and
   `add_timeline` did for a while. This one is not compiler-enforced, so grep before you
   commit:

   ```sh
   grep -c "case 'your_tool'" packages/studio/src/copilot/tools.ts   # must be 3
   ```

4. Add a selfcheck case that applies it and asserts the document actually changed.

If the tool edits something that already exists, it must be reachable from the prompt.
A tool taking a keyframe time is useless unless `timelineDump` prints that time, and the
selfcheck asserts exactly that: every time it prints is a time the tools accept.

### Prefer editing a store action over duplicating it

`applyCalls` runs inside one `commit()`, so it mutates the draft directly and cannot call
store actions. Reuse the pure helpers those actions use — `relayoutBlocks`,
`makeTimeline`, `uniqueName`, `writeKeyframe` — rather than reimplementing the logic. A
strip edit that skips `relayoutBlocks` desynchronises every clip-owned keyframe, silently.

## What the model can see

The system prompt is generated per turn from the live project, in `copilot/prompt.ts`:

- the layers, expressions and presets by name
- the **property reference**, generated from `PROPS` (see above)
- the **clip strip** — every block with its index and absolute span
- **every keyframe on the active timeline**, as `layer.property [clip]: <ms>=<value>`, at
  absolute times. These are exactly the coordinates `remove_keyframe`, `move_keyframe`
  and `add_keyframe` take. Without them the copilot could only ever append: it knew the
  timeline's length and nothing about what was in it.
- **custom presets in full**, because `edit_preset` replaces tracks wholesale and the
  model has to carry over what it is not changing. Built-in preset contents are omitted —
  not worth the tokens.
- the **craft block** (`copilot/craft.ts`) — timings, easing, anticipation, overshoot,
  squash ratios and per-emotion recipes, in this rig's own property paths. Where each
  number comes from is argued in [ANIMATION.md](./ANIMATION.md); change both together.

The keyframe dump is budgeted (`timelineDump`, 4000 chars) and says how many tracks it
dropped. Chat history is capped at the last 12 turns for the same reason: an unbounded
thread on top of a full timeline is how a reply gets cut off mid-JSON.

Each of the copilot's own past turns is replayed with **what became of its calls** —
applied, proposed-not-applied, or rejected — not just its prose. Rejecting keeps the
calls and sets `rejected`, rather than clearing them, so the model can be told not to
propose the same thing again.

## Rules the copilot code itself follows

- **Validate the batch, not the call.** `create_preset` followed by
  `add_preset_to_timeline` naming it is correct and common. `validateBatch` walks the
  turn against a view that includes what earlier calls will have made. Judging each call
  against the live project rejects the model's best answer.
- **Normalise before validating.** `normaliseCall` resolves layer names, short property
  names and argument aliases — at the top level *and* nested inside preset tracks and
  expression snapshots. A rejection should mean the model was wrong, not that it phrased
  it differently.
- **Never trust `format`.** Ollama enforces the JSON schema for local models and does not
  once the request reaches Ollama Cloud. `parse.ts` handles fenced JSON, prose before and
  after the object, bare arrays, `{ toolName: args }` instead of `{ name, args }`, and
  responses cut off mid-object. Add to `parse.ts` rather than re-prompting.
- **Report the whole failure.** `Model did not return JSON: ${raw.slice(0, 140)}` cost a
  day: the error truncated its own evidence at exactly the length that made a valid
  response look truncated. Include the length and enough of the body to diagnose.
- **One request path.** Everything goes through `chatJson`. The live test used to build
  its own request body and drifted out of date within a week.
- **A cancel is not a failure.** An `AbortError` must never mark a key bad or sweep the
  pool.

## Endpoints, briefly

Three tiers, and the cloud one forks in a way that is easy to get wrong:

| Tier | Route | Model name sent |
| --- | --- | --- |
| Local | `localhost:11434` | as typed |
| Cloud, no keys | `localhost:11434`, daemon proxies with its own sign-in | `gpt-oss:120b-cloud`, `glm-5.2:cloud` |
| Cloud, with keys | `POST /api/copilot/chat` → `ollama.com` | `gpt-oss:120b` — plain |
| Custom | your base URL | as typed |

A browser can never call `ollama.com` directly; it serves no CORS headers. That is why
"use my own keys" and "go through the backend" are the same switch. The `-cloud` suffix
is an instruction *to the local daemon* — sending it to `ollama.com` names a model that
does not exist. An untagged model takes `:cloud` **as** its tag; a tagged one takes
`-cloud` appended to the tag. `resolveModel` owns all of this and selfcheck covers it.

## Before you commit

```sh
pnpm check        # offline, deterministic — must pass
pnpm lint
npx tsc -b --noEmit
```

And against a real model, when you have a daemon or a key:

```sh
pnpm --filter @blooby/studio copilot:test -- gpt-oss:120b "make it blink twice then look surprised"
```
