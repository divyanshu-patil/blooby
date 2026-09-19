# Blooby MCP

Blooby is natively controllable by AI. Any app that speaks the [Model Context Protocol](https://modelcontextprotocol.io) — Claude, ChatGPT, Cursor, Claude Code, Codex, your own agent — can open your projects, animate, render frames to check its work, save presets and export Lottie, using **the same functions the Studio UI uses**.

## Connect in one minute

1. Open a project in Blooby → **MCP** tab (or **AI apps** on the dashboard). Copy **your Blooby MCP link**.
2. Paste it into your AI app as a connector. In Claude: *Settings → Connectors → Add custom connector*.
3. The app opens a Blooby page. Choose what it may do, click **Allow**.
4. Ask it: *"Create a 5-second entrance where Blooby jumps in, squashes on landing and waves."*

Its edits land in your editor as it works (and are all undoable). Per-app details: [client-setup.md](client-setup.md).

## What it can do

245 capabilities (version 1.0.0), grouped as:

| Area | Examples |
|---|---|
| Projects | `project_list`, `project_open`, `project_create`, `project_save`, `project_duplicate` |
| Layers, shapes, SVG, text, curves | `add_layer`, `add_svg`, `add_text`, `set_text_path`, `add_curve`, `move_curve_point`, `set_layer_style` (blend, mask, gradient) |
| Mascots | `add_mascot`, `set_pose`, `set_face`, `pin_limb`, `apply_squish_preset` |
| Animation | `set_property`, `add_keyframe`, `move_keyframe`, `editor_set_easing`, `add_modifier`, `add_emitter`, `set_layer_effect` |
| Timeline & states | `timeline_get`, `add_timeline`, `add_input`, `add_transition`, `add_rule` |
| Presets | `preset_search`, `preset_get` (full keyframe data), `preset_apply`, `preset_save`, `preset_publish` |
| Seeing it | `render_frame` (a PNG), `render_sequence` (a contact sheet), `evaluate` (exact numbers), `critique` |
| Safety | `transaction_begin/commit/rollback`, `checkpoint_create/restore/diff`, `history_undo/redo`, `dryRun` on every edit |
| Export | `export_start` — Lottie, dotLottie (with the state machine), React Native pack, PNG, SVG |

The full generated reference is [tools.md](tools.md); the Studio → core → MCP audit is [parity.json](parity.json).

## Documents

- [client-setup.md](client-setup.md) — Claude, ChatGPT, Claude Code, Cursor, Codex, custom clients
- [architecture.md](architecture.md) — how it is built, and why the MCP has no business logic of its own
- [authentication.md](authentication.md) — OAuth, personal tokens, scopes, modes
- [security.md](security.md) — the threat model
- [tools.md](tools.md) — every capability (generated)
- [resources.md](resources.md) — resources and prompts
- [examples.md](examples.md) — worked workflows
- [capability-registry.md](capability-registry.md) — the registry, versioning, the parity audit
- [development.md](development.md) — running it locally, tests, adding a capability
