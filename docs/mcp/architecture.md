# Architecture

```
AI app (Claude, ChatGPT, Cursor…)
   │  MCP over Streamable HTTP, OAuth bearer
   ▼
apps/api  /mcp ─ services/mcp/server.ts     tools/resources/prompts generated from the registry;
   │                                        scopes, modes, limits, audit — no animation logic
   ├─ services/mcp/host.ts                  projects, library, PNG render, export jobs, runs
   ├─ services/mcp/workspace.ts             one live session per (person, project); autosave; sync
   ▼
@blooby/studio/engine
   ├─ engine/registry.ts   the capability registry (derived — see capability-registry.md)
   ├─ engine/session.ts    EditorSession: the real useEditor store, headless
   └─ engine/diff.ts       structured diffs
   ▼
core/store.ts · copilot/tools.ts · core/layers.ts · core/scene.ts · export/*   ← the same code the Studio UI runs
```

## One source of truth

There is no MCP-specific editing code. A tool call becomes one of:

| Capability kind | Executed by | Also used by |
|---|---|---|
| `edit` (82) | `normaliseCall → validateBatch → applyCalls` in `copilot/tools.ts` | the in-app Copilot |
| `action` (101) | the named action on `useEditor` (`core/store.ts`) | every Studio panel |
| `read` (5) | `runAgentTool` in `copilot/agent.ts` | the Copilot agent |
| `session` (25) | `engine/session.ts` (history, checkpoints, inspector, viewport, evaluate…) | — |
| `server` (32) | `apps/api/src/services/mcp/host.ts` (projects, library, render, export, jobs) | the REST API's services |

`EditorSession` keeps a snapshot of the entire zustand store (document, undo history, playhead, selection, catalog) and swaps it in for each call under a process-wide lock, so a call literally runs the editor's own action. Undo, coalescing, validation and layer ownership all behave exactly as in the UI.

## Live collaboration with the editor

The cloud project (S3 JSON + `projects.current_version`) is the shared truth.

- **AI → editor.** Each edit marks the session dirty; the workspace saves 2.5 s after the last edit with the same compare-and-set as the editor's autosave. The editor polls `GET /api/mcp/live` (2 s while an AI is active, 6 s otherwise); when the stored version is newer and it has nothing unsaved, it loads the new version in place and shows *"Claude editing…"*.
- **Editor → AI.** Before every call the workspace reads the stored version. Newer and the AI has nothing unsaved: it reloads and returns a warning. Newer while the AI has unsaved work: `REVISION_CONFLICT`, with `project_reload` (take theirs) or `project_save { force: true }` (keep mine).
- **Within a session**, every result carries `revision`; mutations accept `expectedRevision`.

## Transactions, checkpoints, runs

- `transaction_begin` records the document *and its undo history*; `transaction_rollback` restores both exactly. `batch_execute` is atomic by default using the same mechanism.
- `checkpoint_create` stores the exact document; `checkpoint_restore` puts it back as one undoable step (never regenerated); `checkpoint_diff` returns a structured diff.
- Each connection has a **run** (`run_get`): every operation with ok/error, counts of entities created/changed, projects touched. `run_start { goal }` begins a new one.

## Long operations

`export_start` runs as a job (`job_get`, `job_result`, `job_cancel`, `job_list`); with `wait` (default) it returns within 25 s when done, else a `jobId`. Finished files are returned inline (Lottie JSON as an embedded resource, binaries as blobs) and uploaded under the person's S3 prefix with a one-hour download link.

## Rendering

`export/frame.ts` renders a frame to SVG with the stage's own `<Shapes>` component (`react-dom/server`); `@resvg/resvg-js` rasterises it to PNG. `quality`: preview 360 px, medium 720 px, final 1440 px. `render_sequence` composes up to 16 frames into one labelled contact sheet so an agent sees motion in one image.

## Scaling notes

The editor sessions, MCP transport sessions, jobs and approvals live in the API process (marked `ponytail:` in the code). One API instance is assumed; several need sticky routing per user, or those maps moved to Redis.

## Runtime

The API imports studio TypeScript source, so it runs under `tsx` in development and production. `src/loaders/raw.mjs` answers Vite's `?raw` imports under Node (the registry reads the store's own source to list its actions).
