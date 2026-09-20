# The capability registry

`packages/studio/src/engine/registry.ts` — everything Blooby can do, as data. MCP tool lists, the docs ([tools.md](tools.md)), discovery (`capabilities_search`, `capability_get`), validation, scope checks and the parity audit all read it.

## Derived, not restated

| Family | Source | How |
|---|---|---|
| edit (82) | `TOOL_NAMES` + `TOOL_DOCS` in `copilot/tools.ts` | each doc block's `{ a, b?, c: "x"\|"y" }` becomes a JSON Schema: `?` → optional, quoted alternatives → `enum`, names typed by convention (`*Ms` numbers, `nodeId` string…), enums for `kind`/`easing`/`preset`/`pose`/`mode` taken from `MODIFIER_KINDS`, `EFFECT_KINDS`, `EASING_NAMES`, `SQUISH_PRESETS`, `POSES`, `MORPH_MODE_NAMES`. Prose like "`add_preset_to_timeline` also takes `{ mascot }`" adds the argument |
| action (101) | `interface Editor` in `core/store.ts` (via `editorFunctions()`, which reads the store's own source) | parameter names and TypeScript types become the schema; the doc comment becomes the description. Actions taking callbacks, or replacing the document, are excluded **with a reason** (`excludedActions()`) |
| read (5) | `AGENT_TOOL_DOCS` in `copilot/agent.ts` | same parsing as edit tools |
| session (25) | `engine/session.ts` | defined next to their code |
| server (32) | `apps/api/src/services/mcp/host.ts` | registered with `registerCapabilities()` |

So adding a Studio feature the way the repo already asks (a store action with a doc comment, or a copilot tool per COPILOT.md) makes it an MCP capability with a schema, a description, a scope and a doc entry — no MCP code to write.

## Shape

```ts
interface Capability {
  id: string;                 // also the MCP tool name, [a-z0-9_]
  title: string;
  description: string;        // usage notes, what to watch for
  category: Category;         // project, layer, mascot, text, path, keyframe, state, render, export…
  kind: 'edit' | 'action' | 'read' | 'session' | 'server';
  mutates: boolean;
  scope: Scope;               // project:read|write, preset:read|write, render:read, export:write
  reversible: boolean;        // undoable with history_undo
  requires: ('project' | 'layer' | …)[];
  async?: boolean;            // runs as a job
  inputSchema: JsonSchema;    // strict: additionalProperties false
  examples?: object[];
  since: string;
  deprecated?: string;
}
```

Every mutating capability also accepts `requestId` (idempotency), `dryRun` and `expectedRevision`.

## Validation and errors

`EditorSession.invoke` checks required and unknown arguments, types and enums against the schema, then hands edit tools to the copilot's own `normaliseCall` + `validateBatch` (which resolves layer names, property aliases and mascot labels, and rejects bad values with a reason). Errors carry a `code`, the `field`, the `value` and a `suggestion` pointing at the read that fixes it. An action that changes nothing because an id matched nothing is `ENTITY_NOT_FOUND`, not a silent no-op.

## Versioning

`CAPABILITY_VERSION` (1.0.0) is sent as the MCP server version and in `editor_get_state`. Additions bump the minor. A change to an existing capability's arguments or meaning bumps the major and keeps the old id working with `deprecated` set, documented in this file.

## Parity audit

`pnpm --filter @blooby/api mcp:docs` regenerates [tools.md](tools.md) and [parity.json](parity.json). For every capability the audit records: feature, source kind, the core function behind it, its MCP tool, schema, scope, whether it mutates / is undoable, the test files that exercise it, and its docs anchor — plus every store action **not** exposed and why. `engine.test.ts` fails if a store action is neither exposed nor excluded with a reason, and runs a scripted pass through the capabilities the other tests do not reach.
