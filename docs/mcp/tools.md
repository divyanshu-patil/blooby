# Tool reference

_Generated from the capability registry (version 1.0.0) by `pnpm --filter @blooby/api mcp:docs` — do not edit by hand._

245 capabilities. Every one is callable as its own MCP tool with `?tools=full`, or through `invoke { capability, args }` in the default compact profile. Mutating capabilities also take `requestId` (idempotency), `dryRun` and `expectedRevision`.

## Scopes

- `project:read` — See your projects: layers, keyframes, states and settings
- `project:write` — Create and change projects: layers, animation, text, effects, states — and save them
- `preset:read` — Browse presets: the built-in library, community presets and your own
- `preset:write` — Create, edit and publish presets in your library
- `render:read` — Render frames of your projects as images
- `export:write` — Export your projects as Lottie, dotLottie and images

## Contents

- [account](#category-account) (1)
- [agent](#category-agent) (6)
- [animation](#category-animation) (7)
- [composition](#category-composition) (2)
- [discovery](#category-discovery) (4)
- [effect](#category-effect) (11)
- [export](#category-export) (2)
- [expression](#category-expression) (5)
- [history](#category-history) (10)
- [inspector](#category-inspector) (1)
- [job](#category-job) (4)
- [keyframe](#category-keyframe) (11)
- [layer](#category-layer) (26)
- [mascot](#category-mascot) (27)
- [path](#category-path) (9)
- [playback](#category-playback) (1)
- [preset](#category-preset) (22)
- [project](#category-project) (11)
- [render](#category-render) (2)
- [selection](#category-selection) (2)
- [shape](#category-shape) (5)
- [state](#category-state) (30)
- [style](#category-style) (4)
- [text](#category-text) (13)
- [timeline](#category-timeline) (27)
- [viewport](#category-viewport) (2)

## Category: account

<a id="category-account"></a>

### account_whoami
<a id="account_whoami"></a>

**Who am I** · `project:read` · read-only · source: server

The Blooby account this connection acts for, the scopes it was granted, its mode (read_only / suggest / full) and the capability version.

Arguments: _no arguments_

## Category: agent

<a id="category-agent"></a>

### batch_execute
<a id="batch_execute"></a>

**Run many calls** · `project:write` · changes the project · source: session

Runs capability calls in order, each validated and applied exactly as if called alone. atomic (default true): if one fails, everything in the batch is rolled back and the failing call is named. Up to 200 calls.

Arguments: `calls` (array) · `atomic`? (boolean)

Example: `{"calls":[{"capability":"add_keyframe","args":{"nodeId":"body","property":"flatOffset.y","atMs":0,"value":0}},{"capability":"add_keyframe","args":{"nodeId":"body","property":"flatOffset.y","atMs":400,"value":-80,"easing":"easeOut"}}]}`

### critique
<a id="critique"></a>

**Review the motion** · `project:read` · read-only · source: session

The copilot's second gate, for you: reads the tracks this session wrote and says what is wrong with them AS ANIMATION — a motion the request names that nothing animates, movement too small to see, clips that do not close on their first pose, no held poses, every layer on identical frames. Pass the user's request in their words. Empty = nothing to fix.

Arguments: `request` (string)

Example: `{"request":"a cute entrance where Blooby jumps in, squashes on landing and waves"}`

### editor_get_state
<a id="editor_get_state"></a>

**Editor state** · `project:read` · read-only · source: session

Everything about the editor right now: revision, unsaved changes, undo depth, the active state, playhead, selection, composition, layers in draw order, clips, keyframes near the playhead and the viewport. level "minimal" is a few fields; "full" adds every track, modifier, emitter and the state machine.
Usage: call first, and again whenever you are unsure — never guess.

Arguments: `level`? — one of `minimal`, `standard`, `full`

Example: `{"level":"standard"}`

### proposal_get
<a id="proposal_get"></a>

**A proposed change** · `project:read` · read-only · source: server

In "ask me first" mode every change waits for the person to approve it in the editor. This says whether it was applied (with its result), rejected, or is still pending.

Arguments: `proposalId` (string)

### run_get
<a id="run_get"></a>

**This run** · `project:read` · read-only · source: server

What this run has done: every operation in order with ok/error, counts of entities created and changed, the projects touched and the checkpoints made.

Arguments: _no arguments_

### run_start
<a id="run_start"></a>

**Start a run** · `project:read` · read-only · source: server

Starts a new agent run with a goal — the record of what this piece of work did (run_get). A run starts on its own at connect; call this per task.

Arguments: `goal` (string)

## Category: animation

<a id="category-animation"></a>

### clear_animation
<a id="clear_animation"></a>

**clear animation** · `project:write` · changes the project, undoable · source: edit

drop tracks; omit both to clear the whole timeline

Arguments: `nodeId`? (string) · `property`? (string)

### editor_apply_scale_as_base
<a id="editor_apply_scale_as_base"></a>

**applyScaleAsBase** · `project:write` · changes the project, undoable · source: action

bake a mascot's current scale into its size, so scale is 1 again and nothing moves

Arguments: `mascotId` (string)

### editor_set_value
<a id="editor_set_value"></a>

**setValue** · `project:write` · changes the project, undoable · source: action

The Studio's setValue action.

Arguments: `nodeId` (string) · `property` (string) · `value` · `label`? (string)

### editor_toggle_track
<a id="editor_toggle_track"></a>

**toggleTrack** · `project:write` · changes the project, undoable · source: action

The Studio's toggleTrack action.

Arguments: `nodeId` (string) · `property` (string)

### evaluate
<a id="evaluate"></a>

**Evaluate frames** · `project:read` · read-only · source: session

Where every layer is drawn at each time: x, y, w, h, rotation, alpha in composition px. The exact-numbers counterpart of render_frame — use it to check a jump peaks where planned or a loop closes. Up to 24 times.

Arguments: `times` (array) · `nodeIds`? (array)

Example: `{"times":[0,600,1250],"nodeIds":["body"]}`

### get_values
<a id="get_values"></a>

**get values** · `project:read` · read-only · source: read

what those properties evaluate to at that time

Arguments: `nodeId` (string) · `properties` (array) · `atMs` (number)

### set_property
<a id="set_property"></a>

**set property** · `project:write` · changes the project, undoable · source: edit

atMs writes a keyframe, otherwise the base pose

Arguments: `nodeId` (string) · `property` (string) · `value` · `atMs`? (number)

## Category: composition

<a id="category-composition"></a>

### editor_set_composition
<a id="editor_set_composition"></a>

**setComposition** · `project:write` · changes the project, undoable · source: action

The Studio's setComposition action.

Arguments: `patch`

### set_composition
<a id="set_composition"></a>

**set composition** · `project:write` · changes the project, undoable · source: edit

The editor's set composition.

Arguments: `width`? (number) · `height`? (number) · `preset`? — one of `720x720`, `1080x1080`, `1920x1080`, `1080x1920`

## Category: discovery

<a id="category-discovery"></a>

### capabilities_search
<a id="capabilities_search"></a>

**Find capabilities** · `project:read` · read-only · source: session

What Blooby can do, filtered: by words, category, read/write. Returns ids with one-line summaries; capability_get gives one in full.

Arguments: `query`? (string) · `category`? (string) · `mutates`? (boolean)

Example: `{"query":"keyframe"}`

### capability_get
<a id="capability_get"></a>

**One capability in full** · `project:read` · read-only · source: session

A capability's full description with usage, its argument schema, scope, what it requires and examples.

Arguments: `id` (string)

### guide_get
<a id="guide_get"></a>

**Guides** · `project:read` · read-only · source: session

The knowledge the in-app copilot works from. topic "workflow": the loop to follow. "craft": timing, easing, squash and overshoot numbers for THIS rig — read before animating. "tools": every edit tool with usage. "properties": every animatable property with range and meaning. "effects": layer effects and modifiers. "easing": easing names.

Arguments: `topic` — one of `workflow`, `craft`, `tools`, `properties`, `effects`, `easing`

### search
<a id="search"></a>

**Search everything** · `project:read` · read-only · source: session

One search across capabilities, presets (by what their keyframes actually do), layers, properties, effects and easings. scope narrows it.

Arguments: `query` (string) · `scope`? (array)

Example: `{"query":"squish","scope":["capabilities","presets","properties"]}`

## Category: effect

<a id="category-effect"></a>

### add_emitter
<a id="add_emitter"></a>

**add emitter** · `project:write` · changes the project, undoable · source: edit

color?, colorTo?, size?, bow?, rateMs?, lifeMs?, count?, fadeStart?, spin?,
wobble?, radiusX?, radiusY?, startMs?, endMs?, parts?,
velocity?, velocityJitter?, angle?, spread?, drag?, gravity?, turbulence?,
attract?: { node, startMs, durationMs, fill? } }
path "burst": EVERY particle (count, up to 2000) is born at startMs and explodes out at
velocity (units/s) in angle ± spread/2 (deg, -90 up), slowing by drag, pulled by gravity,
stirred by turbulence; lifeMs is how long they last. attract: from its startMs (clip time)
each flies to a point on that layer's outline (fill: over its area) — an assembly,
even onto a layer that is still invisible. colorTo lerps the colour over the life.
Give glyphs [] and parts [{ shape: "dot" }] for plain dots.
little things leaving the mascot: zzz, ♪, tears, confetti, orbiting objects.
glyphs is an array cycled one per particle, e.g. ["z","z","Z"].
path: "arc" drifts (zzz, notes) · "fall" drops (tears, confetti)
· "orbit" circles fromX/fromY on an ellipse (things overhead)
fromNode/toNode PIN that end to a layer so it follows it — pin a tear's
start to eyeL and the drops leave the eye wherever the head moves.
x/y are offsets in rig units from that layer (or from the body centre).
color is [r,g,b] 0-255. fadeStart is 0-1 of a particle's life.

Arguments: `name` (string) · `glyphs` (array) · `path`? (string) · `fromNode`? (string) · `fromX`? (number) · `fromY`? (number) · `toNode`? (string) · `toX`? (number) · `toY`? (number) · `color`? · `colorTo`? · `size`? (number) · `bow`? (number) · `rateMs`? (number) · `lifeMs`? (number) · `count`? (number) · `fadeStart`? (number) · `spin`? (number) · `wobble`? (number) · `radiusX`? (number) · `radiusY`? (number) · `startMs`? (number) · `endMs`? (number) · `parts`? (array) · `velocity`? (number) · `velocityJitter`? (number) · `angle`? (number) · `spread`? (number) · `drag`? (number) · `gravity`? (number) · `turbulence`? (number) · `attract`? (object)

### add_modifier
<a id="add_modifier"></a>

**add modifier** · `project:write` · changes the project, undoable · source: edit

amount is an intensity percentage, 0-200, where 100 is normal
shake: Jitters the node with noise. frequency 6-20 Hz, amplitude 3-15 (degrees, or px on the body).
float: Bobs the node on a slow sine. frequency 0.3-1.5 Hz, amplitude 3-15.
stretch: Pulses the node and everything mapped onto it as one — squash-and-stretch for the whole rig. frequency 0.3-1.5 Hz, amplitude 3-15.
pendulum: Swings the node back and forth on ONE axis, like a hanging weight — set `axis` to "rotation" (default), "x", "y", "yaw" or "pitch". frequency 0.3-1.5 Hz, amplitude 6-20.
walk: Walks a MASCOT (nodeId = its body): it travels amplitude px per step (negative walks left), frequency steps per second (1.5-2.5), feet planted on the ground during each stance, knees bend, arms swing opposite, body bobs and leans. Legs need knees. Use set_effect_range for when it walks.
follow: Follow-through on a PART (the face, a hand, a hat): when its mascot moves, it lags and overshoots like it is on a spring. frequency is the spring (2-5 Hz, lower = floppier), amplitude the lag strength 20-100.
bounce: Hops the node on the spot — a parabola up and down with a squash on each landing. frequency hops per second (0.8-2), amplitude the hop height in px (15-80).
breathe: Breathing: the node grows taller and slightly narrower on a slow sine and back (squish, so a feet anchor keeps it grounded). frequency 0.15-0.5 Hz, amplitude percent 2-10.
orbit: Drifts the node around a small ellipse (wider than tall) with a slight tilt that follows it. frequency 0.15-0.8 Hz, amplitude radius px 5-40.
heartbeat: Pulses the node's size twice per beat (lub-dub) then rests. frequency beats per second 0.8-2, amplitude percent 5-25.
jelly: Soft body on a MASCOT or shape: its OUTLINE deforms from its own vertical motion — stretched when moving fast, flattened and widened at the bottom when it lands (volume kept), then wobbles. amplitude 20-100 (strength), frequency 3-6 Hz (wobble).

Arguments: `nodeId` (string) · `kind` — one of `shake`, `float`, `stretch`, `pendulum`, `walk`, `follow`, `bounce`, `breathe`, `orbit`, `heartbeat`, `jelly` · `amount` (number) · `frequency` (number) · `amplitude` (number) · `seed`? (number) · `phase`? (number)

### editor_add_emitter
<a id="editor_add_emitter"></a>

**addEmitter** · `project:write` · changes the project, undoable · source: action

The Studio's addEmitter action.

Arguments: `e`

### editor_add_modifier
<a id="editor_add_modifier"></a>

**addModifier** · `project:write` · changes the project, undoable · source: action

The Studio's addModifier action.

Arguments: `m`

### editor_remove_emitter
<a id="editor_remove_emitter"></a>

**removeEmitter** · `project:write` · changes the project, undoable · source: action

The Studio's removeEmitter action.

Arguments: `id` (string)

### editor_remove_modifier
<a id="editor_remove_modifier"></a>

**removeModifier** · `project:write` · changes the project, undoable · source: action

The Studio's removeModifier action.

Arguments: `id` (string)

### editor_select_emitter
<a id="editor_select_emitter"></a>

**selectEmitter** · `project:write` · changes the project, undoable · source: action

The Studio's selectEmitter action.

Arguments: `id` (string,null)

### set_camera
<a id="set_camera"></a>

**set camera** · `project:write` · changes the project, undoable · source: edit

perspective is the field-of-view angle

Arguments: `property` — one of `perspective`, `distance` · `value`

### set_effect_range
<a id="set_effect_range"></a>

**set effect range** · `project:write` · changes the project, undoable · source: edit

effect = an effect's or emitter's name. Times are from the start of its
scope — the clip it belongs to, or the timeline. Omit both to run always.

Arguments: `effect` (string) · `startMs`? (number) · `endMs`? (number)

### set_emitter_parts
<a id="set_emitter_parts"></a>

**set emitter parts** · `project:write` · changes the project, undoable · source: edit

what an emitter throws. shape is one of:
circle, pill, rect, polygon, star, pebble, capsule, roundedRect, blob, octopus, drop, drop-small, splash, streamer, curl, chip, quaver, beamed, zed, bang, query, spark, heart, bell
Several parts at different speeds, sizes and colours is what makes a
burst read — one shape repeated does not.

Arguments: `emitter` (string) · `parts` (array)

### set_layer_effect
<a id="set_layer_effect"></a>

**set layer effect** · `project:write` · changes the project, undoable · source: edit

adds or updates ONE effect of a kind on a layer. kind: glow, blur, shadow, rgbSplit, slices, scanlines, flicker, jitter, echo, wave, outline, grain, hueShift, goo.
params by kind: glow(radius,strength) blur(radius) shadow(x,y,blur,opacity) rgbSplit(amount,angle) slices(amount,bands,rate,seed) scanlines(spacing,opacity) flicker(amount,rate,seed) jitter(amount,rate,seed) echo(count,delay,falloff) wave(amount,waves,speed) outline(width,opacity) grain(amount,size,rate) hueShift(speed,offset) goo(radius).
Each param then keys as effect.<kind>.<param> with add_keyframe. goo on a mascot or group melts
it and the shapes inside it together; echo draws fading trails (motion blur at delay 20-40).

Arguments: `nodeId` (string) · `kind` — one of `glow`, `blur`, `shadow`, `rgbSplit`, `slices`, `scanlines`, `flicker`, `jitter`, `echo`, `wave`, `outline`, `grain`… · `params`? (object) · `color`? · `enabled`? (boolean) · `remove`? (boolean)

## Category: export

<a id="category-export"></a>

### export_formats
<a id="export_formats"></a>

**Export formats** · `export:write` · read-only · source: server

What export_start can produce here, and what only the editor can — GIF and MP4 render on the person's own device, so those are a link, not a file.

Arguments: _no arguments_

### export_start
<a id="export_start"></a>

**Export** · `export:write` · read-only · source: server

Exports the open project as a job. With wait (default true) it returns the file when ready — inline, plus a one-hour download link to give the person. Otherwise it returns a jobId for job_get / job_result. Save first if you want the cloud copy to match.

Arguments: `format` — one of `lottie`, `dotlottie`, `runtime`, `png`, `svg` · `fromMs`? (number) · `toMs`? (number) · `atMs`? (number) · `background`? (string) · `wait`? (boolean)

Example: `{"format":"lottie"}`

## Category: expression

<a id="category-expression"></a>

### apply_expression
<a id="apply_expression"></a>

**apply expression** · `project:write` · changes the project, undoable · source: edit

expression = id or name

Arguments: `expression` (string) · `atMs` (number) · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold`

### create_expression
<a id="create_expression"></a>

**create expression** · `project:write` · changes the project, undoable · source: edit

The editor's create expression.

Arguments: `name` (string) · `snapshot` (object)

### editor_apply_expression
<a id="editor_apply_expression"></a>

**applyExpression** · `project:write` · changes the project, undoable · source: action

The Studio's applyExpression action.

Arguments: `expressionId` (string) · `atMs` (number) · `easing`?

### editor_capture_expression
<a id="editor_capture_expression"></a>

**captureExpression** · `project:write` · changes the project, undoable · source: action

The Studio's captureExpression action.

Arguments: `name` (string)

### editor_rename_expression
<a id="editor_rename_expression"></a>

**renameExpression** · `project:write` · changes the project, undoable · source: action

The Studio's renameExpression action.

Arguments: `id` (string) · `name` (string)

## Category: history

<a id="category-history"></a>

### checkpoint_create
<a id="checkpoint_create"></a>

**Checkpoint** · `project:read` · read-only · source: session

Saves the exact document under a name ("before redesign"), for checkpoint_restore or checkpoint_diff later in this session. Same name overwrites.

Arguments: `name` (string)

### checkpoint_diff
<a id="checkpoint_diff"></a>

**What changed since a checkpoint** · `project:read` · read-only · source: session

A structured diff from the checkpoint to now: entities created, deleted, and every changed field with from → to.

Arguments: `name` (string)

### checkpoint_list
<a id="checkpoint_list"></a>

**Checkpoints** · `project:read` · read-only · source: session

Every checkpoint in this session with its time and revision.

Arguments: _no arguments_

### checkpoint_restore
<a id="checkpoint_restore"></a>

**Restore a checkpoint** · `project:write` · changes the project, undoable · source: session

Puts the document back exactly as it was at the checkpoint — not regenerated, the same data. It is one undoable step, so history_undo brings the newer version back.

Arguments: `name` (string)

### history_get
<a id="history_get"></a>

**Undo history** · `project:read` · read-only · source: session

How many steps can be undone and redone, the last step's label, the open transaction and the checkpoints.

Arguments: _no arguments_

### history_redo
<a id="history_redo"></a>

**Redo** · `project:write` · changes the project, undoable · source: session

Redoes what was undone (or `steps` of it).

Arguments: `steps`? (number)

### history_undo
<a id="history_undo"></a>

**Undo** · `project:write` · changes the project, undoable · source: session

Undoes the last step (or `steps` of them) — exactly the editor's Cmd+Z.

Arguments: `steps`? (number)

### transaction_begin
<a id="transaction_begin"></a>

**Begin a transaction** · `project:write` · read-only · source: session

Marks the start of a multi-step change. transaction_rollback puts the document AND its history back exactly as they were here; transaction_commit keeps everything. One at a time.

Arguments: `label`? (string)

### transaction_commit
<a id="transaction_commit"></a>

**Commit the transaction** · `project:write` · read-only · source: session

Keeps everything since transaction_begin.

Arguments: _no arguments_

### transaction_rollback
<a id="transaction_rollback"></a>

**Roll back the transaction** · `project:write` · changes the project · source: session

Throws away everything since transaction_begin — the document and the undo history return to exactly that moment.

Arguments: _no arguments_

## Category: inspector

<a id="category-inspector"></a>

### inspector_get
<a id="inspector_get"></a>

**Inspector** · `project:read` · read-only · source: session

The inspector for one layer as semantic controls: every property it has, its value at atMs (default the playhead), resting value, range and unit, whether it is animated, its keyframes, and what it does. Set one with set_property; animate it with set_property + atMs or add_keyframe.

Arguments: `nodeId` (string) · `atMs`? (number)

Example: `{"nodeId":"body","atMs":1250}`

## Category: job

<a id="category-job"></a>

### job_cancel
<a id="job_cancel"></a>

**Cancel a job** · `export:write` · read-only · source: server

Cancels a running job.

Arguments: `jobId` (string)

### job_get
<a id="job_get"></a>

**Job status** · `export:write` · read-only · source: server

A job's status, progress, and when done its file (name, size, download link).

Arguments: `jobId` (string)

### job_list
<a id="job_list"></a>

**Recent jobs** · `export:write` · read-only · source: server

Your jobs from the last half hour.

Arguments: _no arguments_

### job_result
<a id="job_result"></a>

**Job result** · `export:write` · read-only · source: server

A finished job's file, inline (as an embedded resource) with its download link.

Arguments: `jobId` (string)

## Category: keyframe

<a id="category-keyframe"></a>

### add_keyframe
<a id="add_keyframe"></a>

**add keyframe** · `project:write` · changes the project, undoable · source: edit

The editor's add keyframe.

Arguments: `nodeId` (string) · `property` (string) · `atMs` (number) · `value` · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold`

### editor_add_keyframe_now
<a id="editor_add_keyframe_now"></a>

**addKeyframeNow** · `project:write` · changes the project, undoable · source: action

The Studio's addKeyframeNow action.

Arguments: `nodeId` (string) · `property` (string)

### editor_delete_keyframe
<a id="editor_delete_keyframe"></a>

**deleteKeyframe** · `project:write` · changes the project, undoable · source: action

The Studio's deleteKeyframe action.

Arguments: `trackId` (string) · `kfId` (string)

### editor_delete_keyframes
<a id="editor_delete_keyframes"></a>

**deleteKeyframes** · `project:write` · changes the project, undoable · source: action

The Studio's deleteKeyframes action.

Arguments: `ids` (array)

### editor_move_keyframe
<a id="editor_move_keyframe"></a>

**moveKeyframe** · `project:write` · changes the project, undoable · source: action

The Studio's moveKeyframe action.

Arguments: `trackId` (string) · `kfId` (string) · `time` (number)

### editor_move_keyframes
<a id="editor_move_keyframes"></a>

**moveKeyframes** · `project:write` · changes the project, undoable · source: action

set several keyframes (from a multi-select drag) to explicit absolute times in one undo step — the caller (drag handler) computes each from its own pre-drag time plus a shared delta, so this never compounds across repeated pointermove events.

Arguments: `entries` (array)

### editor_set_easing
<a id="editor_set_easing"></a>

**setEasing** · `project:write` · changes the project, undoable · source: action

The Studio's setEasing action.

Arguments: `trackId` (string) · `kfId` (string) · `easing`

### editor_toggle_keyframe
<a id="editor_toggle_keyframe"></a>

**toggleKeyframe** · `project:write` · changes the project, undoable · source: action

The Studio's toggleKeyframe action.

Arguments: `nodeId` (string) · `property` (string)

### editor_tween_property
<a id="editor_tween_property"></a>

**tweenProperty** · `project:write` · changes the project, undoable · source: action

CURRENT → TARGET for one property: a keyframe holding whatever it reads right now at the playhead, and one at `target` after `durationMs`. What "Apply transition" does.

Arguments: `nodeId` (string) · `property` (string) · `target` · `durationMs` (number) · `easing`

### move_keyframe
<a id="move_keyframe"></a>

**move keyframe** · `project:write` · changes the project, undoable · source: edit

retime one keyframe; fromMs must match an existing one

Arguments: `nodeId` (string) · `property` (string) · `fromMs` (number) · `toMs` (number)

### remove_keyframe
<a id="remove_keyframe"></a>

**remove keyframe** · `project:write` · changes the project, undoable · source: edit

atMs must match a keyframe listed under "Keyframes"

Arguments: `nodeId` (string) · `property` (string) · `atMs` (number)

## Category: layer

<a id="category-layer"></a>

### add_layer
<a id="add_layer"></a>

**add layer** · `project:write` · changes the project, undoable · source: edit

fill?, attach?: "world"|"mascot", side?: "left"|"right"|"both" }
shape: a shape library id (see set_shape). fill: [r,g,b] or "#rrggbb".
"hand" / "leg" add rubber-hose limbs to the body, both sides by default.

Arguments: `type` — one of `shape`, `hand`, `leg`, `group` · `shape`? (string) · `name`? (string) · `x`? (number) · `y`? (number) · `width`? (number) · `height`? (number) · `fill`? · `attach`? — one of `world`, `mascot` · `side`? — one of `left`, `right`, `both`

### add_svg
<a id="add_svg"></a>

**add svg** · `project:write` · changes the project, undoable · source: edit

a whole <svg>…</svg>; becomes vector paths

Arguments: `markup` (string) · `name`? (string) · `x`? (number) · `y`? (number) · `attach`? (string)

### duplicate_layer
<a id="duplicate_layer"></a>

**duplicate layer** · `project:write` · changes the project, undoable · source: edit

The editor's duplicate layer.

Arguments: `nodeId` (string)

### editor_add_layer
<a id="editor_add_layer"></a>

**addLayer** · `project:write` · changes the project, undoable · source: action

Layer operations. Each is one commit — one undo step — over the pure function of the same name in core/layers.ts, which the copilot's tools call too.  on top of everything (a limb keeps its place behind the body); `appearAt` starts it there on the timeline, which is what pasting at the playhead means

Arguments: `node` (array) · `opts`?

### editor_add_node
<a id="editor_add_node"></a>

**addNode** · `project:write` · changes the project, undoable · source: action

The Studio's addNode action.

Arguments: `node`

### editor_add_svg_asset
<a id="editor_add_svg_asset"></a>

**addSvgAsset** · `project:write` · changes the project, undoable · source: action

Keeps an SVG with the project, so it survives a save and an emitter can point at it.

Arguments: `name` (string) · `markup` (string) · `viewBox` (string)

### editor_delete_node
<a id="editor_delete_node"></a>

**deleteNode** · `project:write` · changes the project, undoable · source: action

The Studio's deleteNode action.

Arguments: `id` (string)

### editor_duplicate_layer
<a id="editor_duplicate_layer"></a>

**duplicateLayer** · `project:write` · changes the project, undoable · source: action

The Studio's duplicateLayer action.

Arguments: `id` (string)

### editor_group_layers
<a id="editor_group_layers"></a>

**groupLayers** · `project:write` · changes the project, undoable · source: action

The Studio's groupLayers action.

Arguments: `ids` (array)

### editor_move_into
<a id="editor_move_into"></a>

**moveInto** · `project:write` · changes the project, undoable · source: action

move a layer into another layer (null: the world), keeping it where it is on screen

Arguments: `nodeId` (string) · `parentId` (string,null)

### editor_remove_svg_asset
<a id="editor_remove_svg_asset"></a>

**removeSvgAsset** · `project:write` · changes the project, undoable · source: action

The Studio's removeSvgAsset action.

Arguments: `id` (string)

### editor_reorder_layer
<a id="editor_reorder_layer"></a>

**reorderLayer** · `project:write` · changes the project, undoable · source: action

The Studio's reorderLayer action.

Arguments: `id` (string) · `to`

### editor_set_appearance
<a id="editor_set_appearance"></a>

**setAppearance** · `project:write` · changes the project, undoable · source: action

in absolute ms; `null` removes every range so the layer is simply always there

Arguments: `nodeId` (string) · `range` · `label`? (string) · `entryId`? (string)

### editor_set_attachment
<a id="editor_set_attachment"></a>

**setAttachment** · `project:write` · changes the project, undoable · source: action

world ↔ mascot, keeping the layer where it is on screen

Arguments: `id` (string) · `mode` · `anchorId`? (string)

### editor_show_layers_in
<a id="editor_show_layers_in"></a>

**showLayersIn** · `project:write` · changes the project, undoable · source: action

bring layers owned by another state into this one, or into every state

Arguments: `nodeIds` (array) · `where` — one of `here`, `everywhere`

### editor_ungroup_layer
<a id="editor_ungroup_layer"></a>

**ungroupLayer** · `project:write` · changes the project, undoable · source: action

The Studio's ungroupLayer action.

Arguments: `id` (string)

### get_layer
<a id="get_layer"></a>

**get layer** · `project:read` · read-only · source: read

one layer's settings and every keyframe on it

Arguments: `nodeId` (string)

### layer_find
<a id="layer_find"></a>

**Find layers** · `project:read` · read-only · source: session

Layers by name (contains, any case), kind (body, primitive, svgLayer, limb, group, text…), role (face, eyeL, armR…), words in a text layer, or colour ("#ff0000", within tolerance 0-441, default 60 — "every red layer").

Arguments: `name`? (string) · `kind`? (string) · `role`? (string) · `text`? (string) · `color`? (string) · `tolerance`? (number)

Example: `{"name":"hat"}`

### remove_layer
<a id="remove_layer"></a>

**remove layer** · `project:write` · changes the project, undoable · source: edit

The editor's remove layer.

Arguments: `nodeId` (string)

### reorder_layer
<a id="reorder_layer"></a>

**reorder layer** · `project:write` · changes the project, undoable · source: edit

the one draw order

Arguments: `nodeId` (string) · `to` — one of `front`, `back`, `forward`, `backward`

### set_layer_appearance_range
<a id="set_layer_appearance_range"></a>

**set layer appearance range** · `project:write` · changes the project, undoable · source: edit

absolute ms: when the layer EXISTS. Keyframe "opacity" for how it looks.

Arguments: `nodeId` (string) · `startMs`? (number) · `endMs`? (number) · `fadeInMs`? (number) · `fadeOutMs`? (number) · `clear`? (boolean)

### set_layer_attachment
<a id="set_layer_attachment"></a>

**set layer attachment** · `project:write` · changes the project, undoable · source: edit

"mascot" makes it follow the head (anchor defaults to the body); it lands ON
the sphere, so surface.yaw / surface.pitch then carry it round the head.
Either way it keeps its place on screen.

Arguments: `nodeId` (string) · `mode` — one of `world`, `mascot` · `anchor`? (string)

### set_layer_lock
<a id="set_layer_lock"></a>

**set layer lock** · `project:write` · changes the project, undoable · source: edit

The editor's set layer lock.

Arguments: `nodeId` (string) · `locked` (boolean)

### set_layer_order
<a id="set_layer_order"></a>

**set layer order** · `project:write` · changes the project, undoable · source: edit

above/below another layer or MASCOT — a mascot moves as one, parts and all

Arguments: `nodeId` (string) · `above`? (string) · `below`? (string) · `to`? — one of `front`, `back`

### set_layer_parent
<a id="set_layer_parent"></a>

**set layer parent** · `project:write` · changes the project, undoable · source: edit

a layer or a mascot to ride; null = the world.
Keeps its place on screen. Mascots may only follow mascots.

Arguments: `nodeId` (string) · `parent` (string)

### set_layer_visibility
<a id="set_layer_visibility"></a>

**set layer visibility** · `project:write` · changes the project, undoable · source: edit

the layer list's eye, not animated

Arguments: `nodeId` (string) · `visible` (boolean)

## Category: mascot

<a id="category-mascot"></a>

### add_face
<a id="add_face"></a>

**add face** · `project:write` · changes the project, undoable · source: edit

a face group for a mascot whose face was deleted

Arguments: `mascot`? (string)

### add_mascot
<a id="add_mascot"></a>

**add mascot** · `project:write` · changes the project, undoable · source: edit

x/y px from the composition centre; left out, it goes in the widest free gap

Arguments: `kind`? — one of `default`, `cute`, `blob`, `octopus` · `name`? (string) · `x`? (number) · `y`? (number)

### duplicate_mascot
<a id="duplicate_mascot"></a>

**duplicate mascot** · `project:write` · changes the project, undoable · source: edit

a copy beside it, with its own lane of the same clips

Arguments: `mascot` (string)

### editor_add_face
<a id="editor_add_face"></a>

**addFace** · `project:write` · changes the project, undoable · source: action

a face group for a mascot that has none (after its face was deleted), with its eyes and hands

Arguments: `mascotId` (string)

### editor_add_mascot
<a id="editor_add_mascot"></a>

**addMascot** · `project:write` · changes the project, undoable · source: action

A new mascot — a look, or a saved one by template id — selected. Returns its body id.

Arguments: `kind` · `opts`?

### editor_apply_eye_action
<a id="editor_apply_eye_action"></a>

**applyEyeAction** · `project:write` · changes the project, undoable · source: action

a blink, squint or close on these eyes, as openness keyframes from the playhead — see core/squish.ts

Arguments: `eyeIds` (array) · `actionId` (string)

### editor_apply_pose
<a id="editor_apply_pose"></a>

**applyPose** · `project:write` · changes the project, undoable · source: action

put every hand and foot of a mascot into a named pose, as keyframes at the playhead when `keyed`

Arguments: `mascotId` (string) · `pose` (string) · `keyed` (boolean)

### editor_apply_squish_to
<a id="editor_apply_squish_to"></a>

**applySquishTo** · `project:write` · changes the project, undoable · source: action

a squish preset on several layers at once, in one undo step

Arguments: `nodeIds` (array) · `presetId` (string)

### editor_pin_limb
<a id="editor_pin_limb"></a>

**pinLimb** · `project:write` · changes the project, undoable · source: action

plant a limb's end on the ground where it is now, or lift it without a jump

Arguments: `nodeId` (string) · `on` (boolean)

### editor_pin_limb_point
<a id="editor_pin_limb_point"></a>

**pinLimbPoint** · `project:write` · changes the project, undoable · source: action

pin (or lift) ONE point of a limb — 'a' hip/shoulder, 'b' knee/elbow (or the end of a two-point limb), 'c' ankle/hand — in the world

Arguments: `nodeId` (string) · `key` — one of `a`, `b`, `c` · `on` (boolean)

### editor_save_mascot_template
<a id="editor_save_mascot_template"></a>

**saveMascotTemplate** · `project:write` · changes the project, undoable · source: action

The Studio's saveMascotTemplate action.

Arguments: `bodyId` (string) · `name`? (string)

### editor_set_face_role
<a id="editor_set_face_role"></a>

**setFaceRole** · `project:write` · changes the project, undoable · source: action

make a layer its mascot's face (any shape or group), or an ordinary layer again

Arguments: `nodeId` (string) · `on` (boolean)

### editor_set_role
<a id="editor_set_role"></a>

**setRole** · `project:write` · changes the project, undoable · source: action

give a layer a part to play ('' for none) — see core/layers.ts setRole

Arguments: `nodeId` (string) · `role` (string)

### pin_limb
<a id="pin_limb"></a>

**pin limb** · `project:write` · changes the project, undoable · source: edit

point: "hip"|"knee"|"ankle"|"shoulder"|"elbow"|"hand" (default the end).
A pinned point stays where it is in the world; the limb stretches to reach it, never below its length.
Plant a leg's foot on the ground where it is now:
the body can move, roll, squash and scale and the foot stays. false lifts it, no jump.

Arguments: `nodeId` (string) · `pinned` (boolean) · `point`? (string)

### remove_mascot
<a id="remove_mascot"></a>

**remove mascot** · `project:write` · changes the project, undoable · source: edit

its parts and clips go; things hung on it stay, in the world

Arguments: `mascot` (string)

### rename_mascot
<a id="rename_mascot"></a>

**rename mascot** · `project:write` · changes the project, undoable · source: edit

The editor's rename mascot.

Arguments: `mascot` (string) · `name` (string)

### set_eye_params
<a id="set_eye_params"></a>

**set eye params** · `project:write` · changes the project, undoable · source: edit

The editor's set eye params.

Arguments: `nodeId` (string) · `openness`? (number) · `distanceFromCenter`? (number) · `length`? (number) · `scaleX`? (number) · `scaleY`? (number) · `rotation`? (number) · `atMs`? (number)

### set_face
<a id="set_face"></a>

**set face** · `project:write` · changes the project, undoable · source: edit

make a shape or group the mascot's FACE: the eyes
(and hands) move onto it, nothing jumps. A face moves, rolls, scales and LOOKS
(its surface.yaw / surface.pitch) apart from the body. false gives them back.

Arguments: `nodeId` (string) · `face` (boolean)

### set_hand_points
<a id="set_hand_points"></a>

**set hand points** · `project:write` · changes the project, undoable · source: edit

body px, +y down

Arguments: `nodeId` (string) · `shoulder`? (object) · `hand`? (object) · `atMs`? (number)

### set_hand_rig
<a id="set_hand_rig"></a>

**set hand rig** · `project:write` · changes the project, undoable · source: edit

The editor's set hand rig.

Arguments: `nodeId` (string) · `rubberHose`? (boolean) · `length`? (number) · `thickness`? (number) · `bend`? (number) · `roundness`? (number) · `taper`? (number) · `atMs`? (number)

### set_leg_points
<a id="set_leg_points"></a>

**set leg points** · `project:write` · changes the project, undoable · source: edit

The editor's set leg points.

Arguments: `nodeId` (string) · `hip`? (object) · `knee`? (object) · `ankle`? (object) · `atMs`? (number)

### set_leg_rig
<a id="set_leg_rig"></a>

**set leg rig** · `project:write` · changes the project, undoable · source: edit

footAngle?, footLength?, footWidth?, atMs? }
a hand has exactly two points and a leg three. length is the hose's own
length in px and it is KEPT (Cavalry-style): points closer than it make
the limb bend, further and it straightens without stretching. So "longer"
and "bend more" are both a longer length (~+30%), or the points closer.
bend: its sign flips the side, ±1 a smooth arc, 0 a sharp elbow.

Arguments: `nodeId` (string) · `rubberHose`? (boolean) · `length`? (number) · `thickness`? (number) · `bend`? (number) · `roundness`? (number) · `taper`? (number) · `footAngle`? (number) · `footLength`? (number) · `footWidth`? (number) · `atMs`? (number)

### set_mascot_parent
<a id="set_mascot_parent"></a>

**set mascot parent** · `project:write` · changes the project, undoable · source: edit

it follows that mascot's moves, turns and scale;
follows null/omitted stands it on its own. A loop (A follows B follows A) is refused.

Arguments: `mascot` (string) · `follows`? (string)

### set_mascot_shape
<a id="set_mascot_shape"></a>

**set mascot shape** · `project:write` · changes the project, undoable · source: edit

pebble, capsule, roundedRect, blob, octopus, circle…
with atMs it MORPHS from the shape it has to this one, finishing at atMs

Arguments: `mascot` (string) · `shape` (string) · `atMs`? (number)

### set_mascot_transform
<a id="set_mascot_transform"></a>

**set mascot transform** · `project:write` · changes the project, undoable · source: edit

x/y its position (px from the centre, or from its leader when it follows one);
scale 1 is its authored size; yaw/pitch turn its HEAD. With atMs, keyframes.

Arguments: `mascot` (string) · `x`? (number) · `y`? (number) · `scale`? (number) · `rotation`? (number) · `yaw`? (number) · `pitch`? (number) · `atMs`? (number)

### set_pose
<a id="set_pose"></a>

**set pose** · `project:write` · changes the project, undoable · source: edit

move every hand and foot of a mascot into a named pose:
"Rest", "Excited", "Hands up", "Kick left", "Kick right", "Shrug", "Wave", "Point", "Stride". With atMs it is keyframes.

Arguments: `mascot`? (string) · `pose` — one of `Rest`, `Excited`, `Hands up`, `Kick left`, `Kick right`, `Shrug`, `Wave`, `Point`, `Stride` · `atMs`? (number)

### set_role
<a id="set_role"></a>

**set role** · `project:write` · changes the project, undoable · source: edit

the part a layer plays; a hand made a leg gains a knee, a world shape made "body" is a mascot

Arguments: `nodeId` (string) · `role` — one of ``, `face`, `eyeL`, `eyeR`, `armL`, `armR`, `legL`, `legR`, `body`

## Category: path

<a id="category-path"></a>

### add_curve
<a id="add_curve"></a>

**add curve** · `project:write` · changes the project, undoable · source: edit

at least two points; smooth (the default) flows through every one. guide: true
shows it in the editor only and leaves it out of every export — a path for text.

Arguments: `points` (number) · `closed`? (boolean) · `type`? — one of `smooth`, `polyline`, `bezier` · `guide`? (boolean) · `name`? (string) · `attach`? (string)

### add_curve_point
<a id="add_curve_point"></a>

**add curve point** · `project:write` · changes the project, undoable · source: edit

joins the curve at the segment nearest (x, y)

Arguments: `nodeId` (string) · `x` (number) · `y` (number)

### close_curve
<a id="close_curve"></a>

**close curve** · `project:write` · changes the project, undoable · source: edit

The editor's close curve.

Arguments: `nodeId` (string) · `closed` (boolean)

### editor_add_curve
<a id="editor_add_curve"></a>

**addCurve** · `project:write` · changes the project, undoable · source: action

A drawn curve from composition points — a pen stroke — selected. Null for under two points.

Arguments: `points` (array) · `opts`?

### editor_curve_to_hose
<a id="editor_curve_to_hose"></a>

**curveToHose** · `project:write` · changes the project, undoable · source: action

a drawn curve becomes a rubber-hose limb through its start, middle and end — see core/layers.ts

Arguments: `nodeId` (string)

### editor_set_curve_type
<a id="editor_set_curve_type"></a>

**setCurveType** · `project:write` · changes the project, undoable · source: action

Smooth, polyline or hand-edited Bézier — switching to Bézier keeps the shape it had.

Arguments: `nodeId` (string) · `type`

### move_curve_point
<a id="move_curve_point"></a>

**move curve point** · `project:write` · changes the project, undoable · source: edit

index into its points, from 0. With atMs it is a
PATH KEYFRAME: key two positions of a point and the curve animates — text on it follows.

Arguments: `nodeId` (string) · `index` (number) · `x` (number) · `y` (number) · `atMs`? (number)

### remove_curve_point
<a id="remove_curve_point"></a>

**remove curve point** · `project:write` · changes the project, undoable · source: edit

a curve keeps at least two points

Arguments: `nodeId` (string) · `index` (number)

### reverse_curve
<a id="reverse_curve"></a>

**reverse curve** · `project:write` · changes the project, undoable · source: edit

runs it the other way; text on it starts from the other end

Arguments: `nodeId` (string)

## Category: playback

<a id="category-playback"></a>

### playhead_set
<a id="playhead_set"></a>

**Move the playhead** · `project:read` · read-only · source: session

Moves the playhead. With no atMs on set_property, values land at the playhead; render_frame without atMs renders it.

Arguments: `atMs` (number)

## Category: preset

<a id="category-preset"></a>

### add_preset_to_timeline
<a id="add_preset_to_timeline"></a>

**add preset to timeline** · `preset:write` · changes the project, undoable · source: edit

preset = id or name; appended if index omitted

Arguments: `preset` (string) · `index`? (number) · `mascot`? (string)

### apply_squish_preset
<a id="apply_squish_preset"></a>

**apply squish preset** · `preset:write` · changes the project, undoable · source: edit

writes squish.x/squish.y keyframes starting at atMs
(default: the playhead). preset: "Soft Squash", "Heavy Squash", "Vertical Stretch", "Landing Squash", "Bounce Squash", "Quick Pop", "Anticipation Squash".
Plain keyframes afterwards. anchor.y = the body's radius squashes from the feet.

Arguments: `nodeId` (string) · `preset` — one of `Soft Squash`, `Heavy Squash`, `Vertical Stretch`, `Landing Squash`, `Bounce Squash`, `Quick Pop`, `Anticipation Squash` · `atMs`? (number)

### create_preset
<a id="create_preset"></a>

**create preset** · `preset:write` · changes the project, undoable · source: edit

The editor's create preset.

Arguments: `name` (string) · `durationMs` (number) · `tracks` (array)

### edit_preset
<a id="edit_preset"></a>

**edit preset** · `preset:write` · changes the project, undoable · source: edit

tracks REPLACE the preset's tracks; clips already on
the strip keep the copy they were added with, so re-add to see the change

Arguments: `preset` (string) · `name`? (string) · `durationMs`? (number) · `tracks`? (array)

### editor_apply_squish_preset
<a id="editor_apply_squish_preset"></a>

**applySquishPreset** · `preset:write` · changes the project, undoable · source: action

drop a squish preset onto a layer, starting at the playhead — see core/squish.ts

Arguments: `nodeId` (string) · `presetId` (string)

### editor_delete_preset
<a id="editor_delete_preset"></a>

**deletePreset** · `preset:write` · changes the project, undoable · source: action

The Studio's deletePreset action.

Arguments: `id` (string)

### editor_rename_preset
<a id="editor_rename_preset"></a>

**renamePreset** · `preset:write` · changes the project, undoable · source: action

The Studio's renamePreset action.

Arguments: `id` (string) · `name` (string)

### editor_save_preset
<a id="editor_save_preset"></a>

**savePreset** · `preset:write` · changes the project, undoable · source: action

The Studio's savePreset action.

Arguments: `name` (string) · `trackIds` (array) · `durationMs` (number)

### editor_set_preset_color
<a id="editor_set_preset_color"></a>

**setPresetColor** · `preset:write` · changes the project, undoable · source: action

The Studio's setPresetColor action.

Arguments: `id` (string) · `color`

### editor_update_preset_from_block
<a id="editor_update_preset_from_block"></a>

**updatePresetFromBlock** · `preset:write` · changes the project, undoable · source: action

Overwrite the preset a clip came from with that clip's current keyframes.

Arguments: `blockId` (string)

### get_preset
<a id="get_preset"></a>

**get preset** · `preset:read` · read-only · source: read

one preset's actual layers, tracks and keyframes [ms, value, easing], effects and ranges — learn timing and amplitude from it.

Arguments: `preset` (string)

### preset_apply
<a id="preset_apply"></a>

**Apply a preset** · `project:write` · changes the project · source: server

Places any preset (built-in, library, community or the project's) as a clip on the open project's strip — appended, or at index — on a mascot's lane when mascot names one. It becomes part of the file.

Arguments: `preset` (string) · `mascot`? (string) · `index`? (number)

Example: `{"preset":"Wave","mascot":"Mascot 2"}`

### preset_delete
<a id="preset_delete"></a>

**Delete a library preset** · `preset:write` · changes the project · source: server

Removes one of your library presets. Needs confirm: true.

Arguments: `assetId` (string) · `confirm` (boolean)

### preset_duplicate
<a id="preset_duplicate"></a>

**Duplicate a preset** · `preset:write` · changes the project · source: server

Copies any preset you can see (built-in, community, yours) into your library under a new name — the way to start from an existing one.

Arguments: `preset` (string) · `name` (string)

### preset_get
<a id="preset_get"></a>

**Study a preset** · `preset:read` · read-only · source: server

One preset's real data: its layers, every track with keyframes as [ms, value, easing], modifiers, emitters and ranges — learn timing, amplitude and easing from it. full: true returns the raw preset JSON exactly as stored (to copy, adapt or import).

Arguments: `preset` (string) · `full`? (boolean)

Example: `{"preset":"Hop"}`

### preset_import
<a id="preset_import"></a>

**Import a preset** · `preset:write` · changes the project · source: server

Adds a preset from its JSON (as preset_get { full: true } returns it) to your library.

Arguments: `name` (string) · `preset` (object)

### preset_list
<a id="preset_list"></a>

**List presets** · `preset:read` · read-only · source: server

Every preset, filtered by source: builtin (Blooby's own), official, community, mine (your library), project (in the open project), or all. offset/limit page it.

Arguments: `source`? — one of `all`, `builtin`, `official`, `community`, `mine`, `project` · `offset`? (number) · `limit`? (number)

### preset_publish
<a id="preset_publish"></a>

**Submit to the community** · `preset:write` · changes the project · source: server

Sends one of your library presets for community review (a moderator approves it before anyone sees it).

Arguments: `assetId` (string) · `description` (string) · `category`? (string) · `tags`? (array)

### preset_save
<a id="preset_save"></a>

**Save a preset to the library** · `preset:write` · changes the project · source: server

Saves animation as a reusable preset in your Blooby library (private to you until you publish it). From one of the project's presets (preset: its name), or from the whole active timeline (omit preset) — every track becomes part of it.

Arguments: `name` (string) · `preset`? (string) · `description`? (string) · `category`? (string) · `tags`? (array)

Example: `{"name":"Happy Entrance","description":"Jumps in, squashes on landing, waves"}`

### preset_search
<a id="preset_search"></a>

**Search presets** · `preset:read` · read-only · source: server

Finds presets by what their keyframes actually DO — "jump", "squash", "wave", "blink", "particles", "curved text", "portal", "walk", "empty state"… — across the built-in library, the community, your own and the open project. Then preset_get to study one: that is how to match Blooby's quality.

Arguments: `query` (string) · `limit`? (number)

Example: `{"query":"bouncy entrance"}`

### preset_update
<a id="preset_update"></a>

**Update a library preset** · `preset:write` · changes the project · source: server

Changes one of your library presets: name, description, category, tags, and/or its animation (from the open project's preset named by from).

Arguments: `assetId` (string) · `name`? (string) · `description`? (string) · `category`? (string) · `tags`? (array) · `from`? (string)

### search_presets
<a id="search_presets"></a>

**search presets** · `preset:read` · read-only · source: read

presets whose DATA matches: "squash", "hand wave", "path drawing", "curved text", "multiple mascots", "empty state"… Returns ids and tags.

Arguments: `query` (string) · `limit`? (number)

## Category: project

<a id="category-project"></a>

### inspect_project
<a id="inspect_project"></a>

**inspect project** · `project:read` · read-only · source: read

the project NOW: layers, states, clips, tracks

Arguments: _no arguments_

### project_close
<a id="project_close"></a>

**Close** · `project:read` · read-only · source: server

Saves anything unsaved and closes the project on this connection.

Arguments: _no arguments_

### project_create
<a id="project_create"></a>

**Create a project** · `project:write` · changes the project · source: server

A new cloud project with the default mascot, opened on this connection. It appears on the person's dashboard straight away, and `url` in the result is the link to give them.

Arguments: `name` (string)

Example: `{"name":"Happy entrance"}`

### project_current
<a id="project_current"></a>

**The open project** · `project:read` · read-only · source: server

Which project this connection has open, its stored version, and whether there are unsaved changes.

Arguments: _no arguments_

### project_delete
<a id="project_delete"></a>

**Delete a project** · `project:write` · changes the project · source: server

Deletes one of your projects for good — it cannot be undone. Needs confirm: true. Only when the person clearly asked for it.

Arguments: `projectId` (string) · `confirm` (boolean)

### project_duplicate
<a id="project_duplicate"></a>

**Duplicate** · `project:write` · changes the project · source: server

Copies a project (the open one, or projectId — any project you can see, including public ones) into your projects, and opens the copy. How to edit something view-only, or branch before a redesign.

Arguments: `projectId`? (string) · `name`? (string)

### project_list
<a id="project_list"></a>

**List projects** · `project:read` · read-only · source: server

Your projects, newest first: id, name, visibility, last update, and the link to open each one in Blooby. q filters by name. Page with cursor.

Arguments: `q`? (string) · `limit`? (number) · `cursor`? (string)

Example: `{"q":"intro"}`

### project_open
<a id="project_open"></a>

**Open a project** · `project:read` · read-only · source: server

Opens a project for this connection — every editing capability then works on it. By id, or by name (exact first, then contains). Shared with the Blooby editor: your edits autosave, and the person sees them.

Arguments: `projectId`? (string) · `name`? (string)

Example: `{"name":"Product intro"}`

### project_reload
<a id="project_reload"></a>

**Reload from the cloud** · `project:write` · changes the project · source: server

Throws away unsaved AI changes and loads the stored project — how to take the editor's version after a conflict.

Arguments: _no arguments_

### project_rename
<a id="project_rename"></a>

**Rename** · `project:write` · changes the project · source: server

Renames the open project (owner only).

Arguments: `name` (string)

### project_save
<a id="project_save"></a>

**Save** · `project:write` · changes the project · source: server

Saves to the cloud now (edits also autosave a few seconds after they stop). If the project was saved from the editor in between, this is a REVISION_CONFLICT; force: true overwrites it.

Arguments: `force`? (boolean)

## Category: render

<a id="category-render"></a>

### render_frame
<a id="render_frame"></a>

**Render a frame** · `render:read` · read-only · source: server

Renders the open project at atMs (default: the playhead) and returns the IMAGE — the same renderer as the editor's stage. Use it after every meaningful change: look, then fix. quality "preview" is cheap. viewport: true renders what viewport_set framed. background: a CSS colour (default transparent over white).

Arguments: `atMs`? (number) · `quality`? — one of `preview`, `medium`, `final` · `background`? (string) · `viewport`? (boolean)

Example: `{"atMs":2400,"quality":"preview"}`

### render_sequence
<a id="render_sequence"></a>

**Render a contact sheet** · `render:read` · read-only · source: server

Several moments of the animation in ONE image, each labelled with its time — how to see motion (a jump's arc, a squash, a loop closing) in a single look. frames 2-16 evenly from fromMs to toMs (default the whole timeline), or exact times.

Arguments: `fromMs`? (number) · `toMs`? (number) · `frames`? (number) · `times`? (array) · `columns`? (number) · `quality`? — one of `preview`, `medium`, `final`

Example: `{"fromMs":0,"toMs":1200,"frames":8}`

## Category: selection

<a id="category-selection"></a>

### editor_select_track
<a id="editor_select_track"></a>

**selectTrack** · `project:write` · changes the project, undoable · source: action

The Studio's selectTrack action.

Arguments: `id` (string,null)

### selection_set
<a id="selection_set"></a>

**Select layers** · `project:read` · read-only · source: session

Selects layers by id or name, like clicking them in the Layers panel. Store actions that act on "the selection" use it.

Arguments: `nodeIds` (array)

## Category: shape

<a id="category-shape"></a>

### editor_morph_between
<a id="editor_morph_between"></a>

**morphBetween** · `project:write` · changes the project, undoable · source: action

The Studio's morphBetween action.

Arguments: `fromId` (string) · `toId` (string) · `atMs` (number) · `durationMs` (number) · `easing`

### editor_set_shape_morph
<a id="editor_set_shape_morph"></a>

**setShapeMorph** · `project:write` · changes the project, undoable · source: action

how the shape keyframe under the playhead becomes the next one

Arguments: `nodeId` (string) · `mode` · `durationMs`? (number)

### morph_between
<a id="morph_between"></a>

**morph between** · `project:write` · changes the project, undoable · source: edit

from/to = expression id or name

Arguments: `from` (string) · `to` · `atMs` (number) · `durationMs` (number) · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold`

### set_shape
<a id="set_shape"></a>

**set shape** · `project:write` · changes the project, undoable · source: edit

shape is any id from the shape library: circle, pill, rect, polygon, star, pebble, capsule, roundedRect, blob, octopus,
or any artwork id listed under set_emitter_parts. On the body this changes
the MASCOT's shape — pebble, capsule (the pill), roundedRect, blob, octopus.
gives a layer an outline. With atMs it is a keyframe, and two keyframes
holding different shapes MORPH — that is how an eye becomes a star.
points: sides, or a star's points. innerRatio: a star's waist, 0.05-0.9.
vertexRadius: rounds the points, 0-1. cornerRadius: a rect's corners.
The body is naturally a circle and an eye a pill — start a morph from
that shape, or the first frame pops.

Arguments: `nodeId` (string) · `shape` (string) · `points`? (number) · `innerRatio`? (number) · `cornerRadius`? (number) · `vertexRadius`? (number) · `rotation`? (number) · `atMs`? (number)

### set_shape_morph
<a id="set_shape_morph"></a>

**set shape morph** · `project:write` · changes the project, undoable · source: edit

how the shape keyframe at atMs becomes the next one; durationMs moves the next

Arguments: `nodeId` (string) · `atMs` (number) · `mode` — one of `morph`, `cut`, `smooth`, `elastic`, `overshoot`, `ease` · `durationMs`? (number)

## Category: state

<a id="category-state"></a>

### add_input
<a id="add_input"></a>

**add input** · `project:write` · changes the project, undoable · source: edit

a STATE MACHINE input the app sets at runtime. A name that already exists
is REUSED, never duplicated — so always add_input before referring to one.

Arguments: `name` (string) · `type` — one of `Boolean`, `Numeric`, `String`, `Event` · `default`? (string) · `description`? (string)

### add_rule
<a id="add_rule"></a>

**add rule** · `project:write` · changes the project, undoable · source: edit

"when <input> <operator> <value>, play <state>" FROM WHATEVER STATE IS CURRENT —
one rule, never an edge per state. mood == 2 → Dance is add_rule { input: "mood",
value: 2, state: "Dance" }. add_input first when the input does not exist.

Arguments: `input` (string) · `operator`? (string) · `value`? · `state` (string) · `durationMs`? (number) · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold`

### add_transition
<a id="add_transition"></a>

**add transition** · `project:write` · changes the project, undoable · source: edit

from/to are STATE names (timelines). operator is one of:
Boolean: "is true" | "is false"
Numeric: "==" "!=" ">" ">=" "<" "<="
String:  "==" "!="
Event:   "fired"
logic is "AND" (default) or "OR" across several conditions.
This is how behaviour is authored: "look at me when I'm typing" is an
isTyping Boolean plus watching -> observing when it is true, NEVER a call
that plays an animation. The machine decides which state is active.

Arguments: `from` (string) · `to` · `conditions` (array) · `logic`? (string) · `durationMs`? (number) · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold`

### editor_add_input
<a id="editor_add_input"></a>

**addInput** · `project:write` · changes the project, undoable · source: action

Reuses an input already declared under that name rather than duplicating it (§4) — returns the name that ended up in the machine either way.

Arguments: `input`

### editor_add_state_transition
<a id="editor_add_state_transition"></a>

**addStateTransition** · `project:write` · changes the project, undoable · source: action

The Studio's addStateTransition action.

Arguments: `from` (string) · `to` (string) · `conditions`? (array)

### editor_cancel_scheduled_state
<a id="editor_cancel_scheduled_state"></a>

**cancelScheduledState** · `project:write` · changes the project, undoable · source: action

The Studio's cancelScheduledState action.

Arguments: _no arguments_

### editor_clear_state_transition
<a id="editor_clear_state_transition"></a>

**clearStateTransition** · `project:write` · changes the project, undoable · source: action

The Studio's clearStateTransition action.

Arguments: _no arguments_

### editor_enable_state
<a id="editor_enable_state"></a>

**enableState** · `project:write` · changes the project, undoable · source: action

The Studio's enableState action.

Arguments: `nameOrId` (string) · `opts`?

### editor_fire_input
<a id="editor_fire_input"></a>

**fireInput** · `project:write` · changes the project, undoable · source: action

an Event input: true for exactly one evaluation, then gone

Arguments: `name` (string)

### editor_go_to_state
<a id="editor_go_to_state"></a>

**goToState** · `project:write` · changes the project, undoable · source: action

CURRENT → TARGET: a direct transition from the active state (or every state) to the target, on the `state` input, then played straight away in the preview.

Arguments: `targetId` (string) · `opts`

### editor_remove_input
<a id="editor_remove_input"></a>

**removeInput** · `project:write` · changes the project, undoable · source: action

The Studio's removeInput action.

Arguments: `name` (string)

### editor_remove_state_transition
<a id="editor_remove_state_transition"></a>

**removeStateTransition** · `project:write` · changes the project, undoable · source: action

The Studio's removeStateTransition action.

Arguments: `id` (string)

### editor_remove_transition
<a id="editor_remove_transition"></a>

**removeTransition** · `project:write` · changes the project, undoable · source: action

The Studio's removeTransition action.

Arguments: `afterBlockId` (string)

### editor_reset_inputs
<a id="editor_reset_inputs"></a>

**resetInputs** · `project:write` · changes the project, undoable · source: action

Drop the live override for one input, or all of them, so the DECLARED default is what the machine reads again. Deletes the key rather than writing the default into it — otherwise editing the default later would silently not take effect.

Arguments: `name`? (string)

### editor_reset_machine
<a id="editor_reset_machine"></a>

**resetMachine** · `project:write` · changes the project, undoable · source: action

Clear the machine — every input and every transition — leaving the states and their animation work untouched. Undoable, like any other document edit.

Arguments: _no arguments_

### editor_reset_state_transition
<a id="editor_reset_state_transition"></a>

**resetStateTransition** · `project:write` · changes the project, undoable · source: action

Put a state's own blend (the one `setState` uses) back to the defaults.

Arguments: `timelineId` (string)

### editor_return_to_previous_state
<a id="editor_return_to_previous_state"></a>

**returnToPreviousState** · `project:write` · changes the project, undoable · source: action

The Studio's returnToPreviousState action.

Arguments: `opts`?

### editor_set_initial_state
<a id="editor_set_initial_state"></a>

**setInitialState** · `project:write` · changes the project, undoable · source: action

The Studio's setInitialState action.

Arguments: `timelineId` (string)

### editor_set_input
<a id="editor_set_input"></a>

**setInput** · `project:write` · changes the project, undoable · source: action

The Studio's setInput action.

Arguments: `name` (string) · `value`

### editor_set_inputs
<a id="editor_set_inputs"></a>

**setInputs** · `project:write` · changes the project, undoable · source: action

several at once, evaluated once — what <Mascot inputs={{...}} /> does per render

Arguments: `values`

### editor_set_machine_id
<a id="editor_set_machine_id"></a>

**setMachineId** · `project:write` · changes the project, undoable · source: action

The Studio's setMachineId action.

Arguments: `id` (string)

### editor_set_state
<a id="editor_set_state"></a>

**setState** · `project:write` · changes the project, undoable · source: action

Programmatic state-machine control (spec §14) — each Timeline is a "state" (matching the dotLottie export, where every timeline already becomes one exported state). The intended public surface: setState for an immediate-or-scheduled switch, enableState as its alias, returnToPreviousState, cancelScheduledState. Matched by name (case- insensitive) or id, so `setState("happy")` reads the way the spec's own examples do. Morphs by default (DEFAULT_STATE_TRANSITION_MS) — pass `{ duration: 0 }` for an instant cut instead; that's the opt-in direction, not the other way around. Also mirrored onto window.blooby for host-app / console use — see main.tsx — so runtime control never requires reaching into editor internals.

Arguments: `nameOrId` (string) · `opts`?

### editor_set_state_node_position
<a id="editor_set_state_node_position"></a>

**setStateNodePosition** · `project:write` · changes the project, undoable · source: action

where a node sits in the state editor's graph (a state id, or ANY_STATE)

Arguments: `id` (string) · `at`

### editor_set_state_transition
<a id="editor_set_state_transition"></a>

**setStateTransition** · `project:write` · changes the project, undoable · source: action

the authored blend into a state — what setState uses when given no duration

Arguments: `id` (string) · `durationMs` (number) · `easing`?

### editor_set_transition
<a id="editor_set_transition"></a>

**setTransition** · `project:write` · changes the project, undoable · source: action

The Studio's setTransition action.

Arguments: `afterBlockId` (string) · `patch`

### editor_update_input
<a id="editor_update_input"></a>

**updateInput** · `project:write` · changes the project, undoable · source: action

The Studio's updateInput action.

Arguments: `name` (string) · `patch`

### editor_update_state_transition
<a id="editor_update_state_transition"></a>

**updateStateTransition** · `project:write` · changes the project, undoable · source: action

The Studio's updateStateTransition action.

Arguments: `id` (string) · `patch`

### set_state
<a id="set_state"></a>

**set state** · `project:write` · changes the project, undoable · source: edit

make that state (timeline) the active one

Arguments: `state` (string)

### set_transition
<a id="set_transition"></a>

**set transition** · `project:write` · changes the project, undoable · source: edit

CURRENT -> TARGET as ONE direct edge, on a String input "state" set to the
target's name (created if missing). from defaults to "current" — the active
state. "any" adds one direct edge from every other state. Never chain
through states in between: Excited -> Angry is one call, not three.

Arguments: `to` · `from`? (string) · `durationMs`? (number) · `easing`? — one of `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `spring`, `anticipate`, `overshoot`, `hold` · `input`? (string)

### show_layer_in_state
<a id="show_layer_in_state"></a>

**show layer in state** · `project:write` · changes the project, undoable · source: edit

a layer made in ANOTHER state is not on screen here
(layers belong to the state they were made in). This brings it into this state,
or with everywhere: true into every state. Layers listed "not on screen in this state".

Arguments: `nodeId` (string) · `everywhere`? (boolean)

## Category: style

<a id="category-style"></a>

### set_layer_style
<a id="set_layer_style"></a>

**set layer style** · `project:write` · changes the project, undoable · source: edit

blend: normal|screen|add|multiply|overlay|difference. mask clips the layer (and all it holds) to
another layer's outline as drawn — hide the mask layer to make it a pure cutter. charOrient on text
turns letters to face the way their text.char.<i>.x/y offsets move them.

Arguments: `nodeId` (string) · `blend`? (string) · `mask`? (object) · `gradient`? (object) · `charOrient`? (string)

### set_svg_fill
<a id="set_svg_fill"></a>

**set svg fill** · `project:write` · changes the project, undoable · source: edit

The editor's set svg fill.

Arguments: `nodeId` (string) · `color`? · `opacity`? (number) · `enabled`? (boolean) · `atMs`? (number)

### set_svg_stroke
<a id="set_svg_stroke"></a>

**set svg stroke** · `project:write` · changes the project, undoable · source: edit

The editor's set svg stroke.

Arguments: `nodeId` (string) · `color`? · `width`? (number) · `opacity`? (number) · `enabled`? (boolean) · `cap`? (string) · `join`? (string) · `atMs`? (number)

### set_svg_stroke_width
<a id="set_svg_stroke_width"></a>

**set svg stroke width** · `project:write` · changes the project, undoable · source: edit

fill and stroke are separate tracks: with atMs each writes a keyframe, so
"fill blue -> pink while the stroke goes black -> white" is four calls.

Arguments: `nodeId` (string) · `width` (number) · `atMs`? (number)

## Category: text

<a id="category-text"></a>

### add_text
<a id="add_text"></a>

**add text** · `project:write` · changes the project, undoable · source: edit

x/y px from the composition centre (or from the mascot when attach names one).
font is a Google Fonts family: "Inter", "Poppins", "Playfair Display"…

Arguments: `content` (string) · `x`? (number) · `y`? (number) · `font`? (string) · `weight`? (number) · `size`? (number) · `color`? · `attach`? (string)

### animate_text
<a id="animate_text"></a>

**animate text** · `project:write` · changes the project, undoable · source: edit

startMs?, durationMs?, stagger? }
letters arriving: typewriter types them out; pop/fade/drop/rise/scatter bring each
letter in (stagger 0 all together, 1 one after another); wave keeps them bobbing.

Arguments: `nodeId` (string) · `effect` — one of `typewriter`, `pop`, `fade`, `drop`, `rise`, `scatter`, `wave` · `startMs`? (number) · `durationMs`? (number) · `stagger`? (number)

### editor_add_text
<a id="editor_add_text"></a>

**addText** · `project:write` · changes the project, undoable · source: action

A text layer, selected. `at` is a composition point (where the Text tool was clicked).

Arguments: `content`? (string) · `opts`?

### set_text
<a id="set_text"></a>

**set text** · `project:write` · changes the project, undoable · source: edit

with atMs the words switch at that keyframe

Arguments: `nodeId` (string) · `content` (string) · `atMs`? (number)

### set_text_color
<a id="set_text_color"></a>

**set text color** · `project:write` · changes the project, undoable · source: edit

The editor's set text color.

Arguments: `nodeId` (string) · `color` · `opacity`? (number) · `atMs`? (number)

### set_text_curve
<a id="set_text_curve"></a>

**set text curve** · `project:write` · changes the project, undoable · source: edit

arc: amount 0-1 bends the words that fraction of a full circle (0.3 is a gentle arc),
or give radius px with start/end degrees clockwise from 12 o'clock.
underneath: true makes it a smile — words sitting in the bowl of the arc.

Arguments: `nodeId` (string) · `mode` — one of `straight`, `arc` · `amount`? (number) · `radius`? (number) · `start`? (number) · `end`? (number) · `underneath`? (boolean)

### set_text_font
<a id="set_text_font"></a>

**set text font** · `project:write` · changes the project, undoable · source: edit

The editor's set text font.

Arguments: `nodeId` (string) · `family` (string) · `weight`? (number) · `italic`? (boolean)

### set_text_path
<a id="set_text_path"></a>

**set text path** · `project:write` · changes the project, undoable · source: edit

the words run along another layer's outline, live: a curve, any shape, or a MASCOT
("put HELLO around the mascot" is path: "body", baseline ~20). path null = straight again.
offset px along the path; baseline px off it; reverse runs it from the other end;
flip turns the letters over — for text round the bottom of a loop.

Arguments: `nodeId` (string) · `path` (string) · `offset`? (number) · `baseline`? (number) · `reverse`? (boolean) · `flip`? (boolean)

### set_text_path_offset
<a id="set_text_path_offset"></a>

**set text path offset** · `project:write` · changes the project, undoable · source: edit

keyframe it to make the words travel along the path

Arguments: `nodeId` (string) · `offset` (number) · `atMs`? (number)

### set_text_size
<a id="set_text_size"></a>

**set text size** · `project:write` · changes the project, undoable · source: edit

px

Arguments: `nodeId` (string) · `size` (number) · `atMs`? (number)

### set_text_stroke
<a id="set_text_stroke"></a>

**set text stroke** · `project:write` · changes the project, undoable · source: edit

The editor's set text stroke.

Arguments: `nodeId` (string) · `color`? · `width`? (number) · `opacity`? (number) · `enabled`? (boolean) · `atMs`? (number)

### set_text_style
<a id="set_text_style"></a>

**set text style** · `project:write` · changes the project, undoable · source: edit

lineHeight?, letterSpacing?, width?, atMs? }   // width px wraps lines; 0 = no wrap

Arguments: `nodeId` (string) · `align`? — one of `left`, `center`, `right` · `valign`? — one of `top`, `middle`, `bottom` · `lineHeight`? (number) · `letterSpacing`? (number) · `width`? (number) · `atMs`? (number)

### set_text_weight
<a id="set_text_weight"></a>

**set text weight** · `project:write` · changes the project, undoable · source: edit

100-900: 400 regular, 700 bold

Arguments: `nodeId` (string) · `weight` (number) · `atMs`? (number)

## Category: timeline

<a id="category-timeline"></a>

### add_timeline
<a id="add_timeline"></a>

**add timeline** · `project:write` · changes the project, undoable · source: edit

a new timeline = a new exported Lottie state. Every state has its OWN layers: copyLayers (default true) starts it with a copy of the current state's layers (not its animation); false = just the base mascot

Arguments: `name` (string) · `copyLayers`? (boolean)

### editor_add_block
<a id="editor_add_block"></a>

**addBlock** · `project:write` · changes the project, undoable · source: action

`mascotId` puts the clip in that mascot's lane, the preset animating that mascot

Arguments: `presetId` (string) · `index`? (number) · `mascotId`? (string)

### editor_add_timeline
<a id="editor_add_timeline"></a>

**addTimeline** · `project:write` · changes the project, undoable · source: action

a new timeline — the base mascot only, or with `copyLayers` a copy of this state's layers (not its animation)

Arguments: `name`? (string) · `opts`?

### editor_adopt_keys_into_block
<a id="editor_adopt_keys_into_block"></a>

**adoptKeysIntoBlock** · `project:write` · changes the project, undoable · source: action

keys made on the timeline (not in any clip) that fall inside this clip's span become the clip's own — so "Save to preset" takes them

Arguments: `blockId` (string)

### editor_delete_timeline
<a id="editor_delete_timeline"></a>

**deleteTimeline** · `project:write` · changes the project, undoable · source: action

The Studio's deleteTimeline action.

Arguments: `id` (string)

### editor_duplicate_block
<a id="editor_duplicate_block"></a>

**duplicateBlock** · `project:write` · changes the project, undoable · source: action

The Studio's duplicateBlock action.

Arguments: `id` (string)

### editor_duplicate_timeline
<a id="editor_duplicate_timeline"></a>

**duplicateTimeline** · `project:write` · changes the project, undoable · source: action

a copy of a timeline: its own copy of the layers, and its clips, keys, effects and ranges

Arguments: `id` (string)

### editor_move_block
<a id="editor_move_block"></a>

**moveBlock** · `project:write` · changes the project, undoable · source: action

The Studio's moveBlock action.

Arguments: `id` (string) · `index` (number)

### editor_remove_block
<a id="editor_remove_block"></a>

**removeBlock** · `project:write` · changes the project, undoable · source: action

The Studio's removeBlock action.

Arguments: `id` (string)

### editor_rename_block
<a id="editor_rename_block"></a>

**renameBlock** · `project:write` · changes the project, undoable · source: action

The Studio's renameBlock action.

Arguments: `id` (string) · `name` (string)

### editor_rename_timeline
<a id="editor_rename_timeline"></a>

**renameTimeline** · `project:write` · changes the project, undoable · source: action

The Studio's renameTimeline action.

Arguments: `id` (string) · `name` (string)

### editor_select_block
<a id="editor_select_block"></a>

**selectBlock** · `project:write` · changes the project, undoable · source: action

The Studio's selectBlock action.

Arguments: `id` (string,null)

### editor_set_active_lane
<a id="editor_set_active_lane"></a>

**setActiveLane** · `project:write` · changes the project, undoable · source: action

The Studio's setActiveLane action.

Arguments: `lane` (string)

### editor_set_active_timeline
<a id="editor_set_active_timeline"></a>

**setActiveTimeline** · `project:write` · changes the project, undoable · source: action

The Studio's setActiveTimeline action.

Arguments: `id` (string)

### editor_set_block_color
<a id="editor_set_block_color"></a>

**setBlockColor** · `project:write` · changes the project, undoable · source: action

The Studio's setBlockColor action.

Arguments: `id` (string) · `color`

### editor_set_block_duration
<a id="editor_set_block_duration"></a>

**setBlockDuration** · `project:write` · changes the project, undoable · source: action

The Studio's setBlockDuration action.

Arguments: `id` (string) · `ms` (number)

### editor_set_block_loop
<a id="editor_set_block_loop"></a>

**setBlockLoop** · `project:write` · changes the project, undoable · source: action

The Studio's setBlockLoop action.

Arguments: `id` (string) · `loop` (boolean)

### editor_set_block_speed
<a id="editor_set_block_speed"></a>

**setBlockSpeed** · `project:write` · changes the project, undoable · source: action

The Studio's setBlockSpeed action.

Arguments: `id` (string) · `speed` (number)

### editor_set_duration_mode
<a id="editor_set_duration_mode"></a>

**setDurationMode** · `project:write` · changes the project, undoable · source: action

The Studio's setDurationMode action.

Arguments: `mode` — one of `custom`, `even`

### editor_set_loop
<a id="editor_set_loop"></a>

**setLoop** · `project:write` · changes the project, undoable · source: action

The Studio's setLoop action.

Arguments: `loop` (boolean)

### editor_set_timeline_duration
<a id="editor_set_timeline_duration"></a>

**setTimelineDuration** · `project:write` · changes the project, undoable · source: action

The Studio's setTimelineDuration action.

Arguments: `ms` (number)

### editor_set_timeline_loop
<a id="editor_set_timeline_loop"></a>

**setTimelineLoop** · `project:write` · changes the project, undoable · source: action

The Studio's setTimelineLoop action.

Arguments: `loop` (boolean)

### move_block
<a id="move_block"></a>

**move block** · `project:write` · changes the project, undoable · source: edit

The editor's move block.

Arguments: `block` · `index` (number)

### remove_block
<a id="remove_block"></a>

**remove block** · `project:write` · changes the project, undoable · source: edit

The editor's remove block.

Arguments: `block`

### set_block_duration
<a id="set_block_duration"></a>

**set block duration** · `project:write` · changes the project, undoable · source: edit

block = id, name, or 0-based index on the strip

Arguments: `block` · `durationMs` (number)

### set_timeline
<a id="set_timeline"></a>

**set timeline** · `project:write` · changes the project, undoable · source: edit

loop eases the last frame back onto the first

Arguments: `durationMs`? (number) · `loop`? (boolean) · `fps`? (number)

### timeline_get
<a id="timeline_get"></a>

**Tracks and keyframes** · `project:read` · read-only · source: session

The active state's timeline with ids: duration, fps, loop, clips, and every track with its keyframes (id, atMs, value, easing). Filter by nodeId and/or property. The ids feed editor_move_keyframe, editor_delete_keyframe and editor_set_easing; the times feed add_keyframe / move_keyframe / remove_keyframe.

Arguments: `nodeId`? (string) · `property`? (string)

Example: `{"nodeId":"body","property":"transform.scale.y"}`

## Category: viewport

<a id="category-viewport"></a>

### viewport_get
<a id="viewport_get"></a>

**Viewport** · `project:read` · read-only · source: session

The view onto the canvas: zoom and centre in composition px, and the window render_frame { viewport: true } draws.

Arguments: _no arguments_

### viewport_set
<a id="viewport_set"></a>

**Zoom, pan and focus** · `project:read` · read-only · source: session

zoom (0.1-8), centerX/centerY (composition px), fit: true to show the whole composition, focus: a layer id or name to frame it (padding 0-2, default 0.4).

Arguments: `zoom`? (number) · `centerX`? (number) · `centerY`? (number) · `fit`? (boolean) · `focus`? (string) · `padding`? (number)

Example: `{"focus":"body"}`

