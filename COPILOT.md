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
| `EMITTER_PRESETS` | `ui/Effects.tsx` | the ready-made emitters in the panel |

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

## Emitters

Everything that leaves the mascot — zzz, ♪, tears, a notification badge, confetti, objects
orbiting overhead — is one `Emitter` record with a different `path` and different numbers.
Resist adding a second system for the next one; if it does not fit, widen `path`.

Three rules the engine depends on:

- **No simulation.** `sceneAt(t)` must be answerable for any `t` in any order — the
  timeline scrubs, the exporter jumps, a thumbnail asks for one instant — so a particle is
  a pure function of its slot index and the time. Never carry state between frames.
- **`emitterFrame` is the only mapping** between rig-unit offsets and the screen. The stage
  handles and the evaluator both use it; two copies would drift the moment the body scaled
  and the handle would sit next to the stream rather than on it.
- **A particle at u=0 is invisible** (faded in over its first 12%) and dropped. Any check
  comparing "the newest particle" against the start handle is measuring a different slot.

Lottie cannot represent a glyph without an embedded font descriptor, so emitters join SVG
layers in the exporter's `skipped` list — named, never silently dropped. GIF and MP4 go
through the real renderer and keep them.

## Shapes and morphing

A layer can carry `shapePath`, an SVG outline in a **-0.5..0.5 box**, drawn instead of its
ellipse/pill and scaled to its size. Authoring in a unit box is what makes a morph about
outlines rather than dimensions.

`core/path.ts` owns it. Two `d` strings almost never share a command structure, so it
flattens both to the same number of points spaced evenly by arc length, rotates them into
their best alignment (or a square morphing into a star twists on the way), and interpolates
point by point. `lerpValue` calls it, so `shape.path` keyframes morph for free.

It is all arithmetic on purpose: `SVGPathElement.getPointAtLength` only exists in a
browser, and the selfcheck, the exporter and any headless render need identical results.

An outline is also editable by hand: `pathAnchors` returns the points that define it (not
resampled ones — dragging one of 64 even samples would fight the seven that actually shape
it) and `movePathAnchor` moves one, carrying its control handles rigidly so curvature
survives. Hand-editing clears the primitive's dials, because they no longer describe it.

Two rules if you touch the parser:

- **Every loop iteration must consume a token.** A malformed path left `cmd` on `Z`, which
  reads nothing, and `M 1 zz 4` spun forever. There is a `step()` guard on every branch.
- **Garbage degrades to nothing, never to NaN.** The shape editor takes pasted text, and
  NaN coordinates go straight into the DOM. Non-finite segments are dropped.

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
- **where new animation goes** — an absolute start time computed past everything already
  on the strip (`suggestedStart`), and the distinction between preset-relative times
  (`create_preset` starts at 0) and absolute timeline times (`add_keyframe`). Getting
  these two confused is how the copilot overwrote clip 0 while believing it was appending.
- the **craft block** (`copilot/craft.ts`) — timings, easing, anticipation, overshoot,
  squash ratios and per-emotion recipes, in this rig's own property paths. Where each
  number comes from is argued in [ANIMATION.md](./ANIMATION.md); change both together.

The keyframe dump is budgeted (`timelineDump`, 4000 chars) and says how many tracks it
dropped. Chat history is capped at the last 12 turns for the same reason: an unbounded
thread on top of a full timeline is how a reply gets cut off mid-JSON.

The prompt also carries **what this conversation has already built** — the names from
applied `create_preset` / `add_preset_to_timeline` / `add_timeline` calls, newest last —
so a follow-up ("make it scale more") edits that work instead of building a second clip
beside it. Only *applied* turns count: telling the model about a proposal the user
rejected is how it ends up editing a clip that is not there.

There is a trap in the follow-up rules worth knowing before you change them.
`edit_preset` changes the **template only** — a clip already on the strip holds the copy
it was added with, so editing the preset alone changes nothing the user can see. The
prompt therefore points refinements at the strip's own keyframes (`add_keyframe` at a
listed time overwrites in place) and mentions `edit_preset` as the separate thing it is.
The selfcheck proves both halves: that a placed clip really does ignore a later
`edit_preset`, and that `add_keyframe` at the listed time really does change what plays.

The response schema puts **`plan` first**, before `reply` and `calls`, and requires it.
Key order in a JSON schema is generation order, so the model states what the request
means, which recipe it matches, what is already on the timeline and which beats it is
about to write — and only then emits calls. It is shown collapsed under the reply.

Each of the copilot's own past turns is replayed with **what became of its calls** —
applied, proposed-not-applied, or rejected — not just its prose. Rejecting keeps the
calls and sets `rejected`, rather than clearing them, so the model can be told not to
propose the same thing again.

## Two gates, not one

`validate` answers *"will this corrupt the document"*. Everything it lets through is
legal, and most of it is lifeless — a body that scales by 1.03, four layers moving on
identical frames, a pose passed through rather than held, a clip that ends somewhere
other than it started.

`critique` (`copilot/critique.ts`) is the second gate. It reads the tracks a turn
produced and says what is wrong with them **as animation**, then feeds the same re-prompt
loop `validate` uses — so a weak first answer is revised once before the user sees it.
The revision is kept only if it has fewer complaints than the original, and there is
exactly one: a weak animation beats making someone wait.

It checks: a motion named in the request with nothing animating it; a named motion that
moves by less than `MIN_CHANGE` for that property; the request being about the mascot
while nothing touches the body; tracks that do not close back on their opening value; no
held pose anywhere; and identical keyframe times across every layer.

Two rules when adding a check:

- **Be conservative.** A false complaint costs a round trip and teaches nothing. Magnitude
  is only ever questioned for a motion the user asked for *by name* — a deliberately
  subtle idle must pass untouched, and the selfcheck asserts that it does.
- **`MIN_CHANGE` is not derived from `PROPS.range`.** A range is what is *possible*; 8% of
  scale's 0.05–3 range is a quarter, far more than "visible". These numbers are what a
  viewer notices, and they belong next to the check that uses them.

The selfcheck covers each complaint firing on the shape that should trigger it, and — the
one that matters most — a well-made clip drawing no complaints at all.

## What the copilot can reach

The rule at the top of this file — if the editor can do it, the copilot must be able to —
is why every capability added to the editor arrives with a tool in the same commit:

| editor feature | tool |
| --- | --- |
| shapes and morphing | `set_shape` (with `atMs`, two of them morph) |
| what an emitter throws | `set_emitter_parts` |
| emitters at all | `add_emitter` |
| effect and emitter ranges | `set_effect_range` |
| pendulum | `add_modifier` with `kind: "pendulum"` |
| retiring a feature | `visible`, a plain 0–1 property |

The tool docs list the shape library's ids inline, generated from `SHAPE_LIBRARY`, so a
new shape is offerable the moment it exists. The selfcheck asserts that: every entry's id
must appear in `TOOL_DOCS`.

## Rules the copilot code itself follows

- **Validate the batch, not the call.** `create_preset` followed by
  `add_preset_to_timeline` naming it is correct and common. `validateBatch` walks the
  turn against a view that includes what earlier calls will have made. Judging each call
  against the live project rejects the model's best answer.
- **A create naming something that exists is an edit.** "make it scale more" comes back
  as `create_preset` with the same name constantly. `normaliseCall` rewrites it to
  `edit_preset`, which is both what was meant and the only way to avoid two presets
  sharing a name — `findPreset` resolves by name, so the second would be unreachable.
- **`describe` runs against the project as it stands.** A batch that creates a preset and
  places it in one turn names something that does not exist yet, which is how the card
  read `Add "undefined" to the strip`. Every lookup in `describe` falls back to what the
  model actually wrote.
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

## Keys, and whose they are

Ollama Cloud keys are **rows in `public.copilot_keys`**, managed from the admin
dashboard's Copilot tab. They are deliberately not in an environment variable: a pool in
`OLLAMA_KEYS` means rotating one key is a redeploy, only whoever owns the host can do it,
and every key is readable by anything that can read the process environment.

Both `copilot_keys` and `copilot_settings` have RLS **enabled with no policies**. That is
not an oversight — a table in that state is readable only by the service role, so only
`apps/api` behind `requireAdmin` can touch it. A leaked publishable key reads nothing.

A key is write-only from the dashboard: posted once, and it comes back as a `hint`
(`sk-a…9f2c`). No read path on the server selects `secret`, so no amount of poking at the
admin screen recovers a key — including for the admin who pasted it.

### The `allowUserKeys` switch

| switch | user keys | server keys | what happens |
| --- | --- | --- | --- |
| on | some | — | backend, using the user's keys |
| on | none | yes | backend, using the server pool |
| on | none | no | local Ollama daemon |
| off | ignored | yes | backend, server pool |
| off | ignored | no | local Ollama daemon |

The editor hides the key field when the switch is off, but **the hiding is a convenience,
not the mechanism**. `copilotService.keysFor()` drops supplied keys whenever the switch is
off, so a client that keeps sending them is simply ignored. A UI-only switch is not a
switch. `pnpm --filter @blooby/api check:copilot` asserts exactly that against the real
database, plus rotation order and that no read path leaks a `secret`.

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
