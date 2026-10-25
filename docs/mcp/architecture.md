# Architecture

```
AI app (Claude, ChatGPT, Cursor…)
   │  MCP over Streamable HTTP, OAuth bearer
   ▼
apps/api  /mcp ─ services/mcp/server.ts     tools/resources/prompts generated from the registry;
   │                                        scopes, modes, limits, audit — no animation logic
   ├─ services/mcp/host.ts                  projects, library, PNG render, export jobs, runs
   ├─ services/mcp/workspace.ts             one cached session per (person, project); save per edit; sync
   ├─ utils/sharedState.ts                  what every instance must agree on (Redis, or this process)
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

**The transport is stateless.** Every POST to `/mcp` gets its own server and transport; no
`Mcp-Session-Id` is issued, and GET/DELETE answer 405. So any instance can answer any call — on Vercel
consecutive calls land on different instances, and an instance can be frozen between them.

**Which project is open belongs to the person, not the connection.** `connFor` loads the last project
each person opened (and their run) from shared state at the start of every request. Capabilities that need no
document (`capabilities_search`, `capability_get`, `guide_get`, `search`) answer on a scratch session
before anything is open.

## Live collaboration with the editor

The cloud project (S3 JSON + `projects.current_version`) is the shared truth.

- **AI → editor.** Every call that changes the document saves it before it answers, with the same compare-and-set as the editor's autosave — so the stored copy is always current and the in-process `EditorSession` is only a cache. A save that fails is a warning on the call (`Not saved: …`), not an error. The editor polls `GET /api/mcp/live` (2 s while an AI is active, 6 s otherwise); when the stored version is newer and it has nothing unsaved, it loads the new version in place and shows *"Claude editing…"*.
- **Editor → AI.** Before every call the workspace reads the stored version. Newer and the AI has nothing unsaved: it reloads and returns a warning (silently when the newer version is the AI's own save, written through another instance). Newer while the AI has unsaved work: `REVISION_CONFLICT`, with `project_reload` (take theirs) or `project_save { force: true }` (keep mine).
- **Within a session**, every result carries `revision`; mutations accept `expectedRevision`.
- **What does not cross instances:** undo history, checkpoints and an open transaction live in the cached session. A call served by another instance starts them over on the stored document.

## Transactions, checkpoints, runs

- `transaction_begin` records the document *and its undo history*; `transaction_rollback` restores both exactly. `batch_execute` is atomic by default using the same mechanism.
- `checkpoint_create` stores the exact document; `checkpoint_restore` puts it back as one undoable step (never regenerated); `checkpoint_diff` returns a structured diff.
- Each person has a **run** per client (`run_get`), kept a day: the last 200 operations with ok/error, counts of entities created/changed, projects touched. `run_start { goal }` begins a new one.

## Long operations

`export_start` runs to the end inside its call — nothing runs after a serverless response — and returns the file with a `jobId` that `job_get`, `job_result`, `job_cancel` and `job_list` answer from any instance for 30 minutes (`wait` is accepted and ignored). Finished files are returned inline (Lottie JSON as an embedded resource, binaries as blobs) and uploaded under the person's S3 prefix with a one-hour download link; an instance that did not make a file fetches it back from there.

## Rendering

`export/frame.ts` renders a frame to SVG with the stage's own `<Shapes>` component (`react-dom/server`); `@resvg/resvg-js` rasterises it to PNG. `quality`: preview 360 px, medium 720 px, final 1440 px. `render_sequence` composes up to 16 frames into one labelled contact sheet so an agent sees motion in one image.

## Scaling notes

Shared across instances through `utils/sharedState.ts` (Redis when `REDIS_URL` is set): the open project per person, runs, jobs, proposals and the live feed. Without Redis it is this process's memory — right for one instance (Render, local), and the fallback when Redis is down. Still per instance: the cached `EditorSession`s (see above) and the per-account tool-call throttle in `server.ts`; the HTTP rate limit in front of `/mcp` is shared through Redis.

## Runtime

The API imports studio TypeScript source, so it runs under `tsx` in development and on Render. `src/loaders/raw.mjs` answers Vite's `?raw` imports under Node (the registry reads the store's own source to list its actions). On Vercel, `scripts/bundle.mjs` bundles `src/serverless.ts` into one file with the `?raw` imports inlined.
