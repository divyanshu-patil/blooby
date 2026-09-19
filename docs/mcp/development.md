# Developing the MCP server

## Run it

```sh
pnpm install
cp apps/api/.env.example apps/api/.env      # fill in Supabase, database and S3 values
# apply the MCP tables once (Supabase CLI, or the SQL editor):
#   supabase/migrations/20260920120000_mcp.sql
pnpm dev                                     # web :5173, admin :5174, api :3000
```

The MCP endpoint is `http://localhost:3000/mcp`. Sign in to the web app, open a project → **MCP** tab → copy the link.

Connect a local client: `claude mcp add --transport http blooby http://localhost:3000/mcp`, then `/mcp` → Authenticate. Or explore with the MCP Inspector: `npx @modelcontextprotocol/inspector` → Streamable HTTP → the URL (OAuth runs in the browser).

For Claude.ai or ChatGPT during development, expose the API: `cloudflared tunnel --url http://localhost:3000`, set `PUBLIC_API_URL` to the tunnel's https URL, restart the API.

## Environment

| Variable | Needed for |
|---|---|
| `PUBLIC_API_URL` | the MCP URL (`${PUBLIC_API_URL}/mcp`) and the OAuth issuer. Default `http://localhost:3000` |
| `APP_URL` | where `/authorize` sends the person to approve (`${APP_URL}/connect`) |
| `DATABASE_URL`, `SUPABASE_*` | tokens, clients, audit, projects, the preset library |
| `AWS_*` | project storage and export download links |

No secret is ever put in a URL, a prompt, a tool result or a log.

## Tests

```sh
pnpm --filter @blooby/studio test     # engine: registry derivation, sessions, every capability, documented examples
pnpm --filter @blooby/api test        # mcp.e2e.test.ts: HTTP + the official SDK client + OAuth + an agent workflow
pnpm --filter @blooby/web test        # the consent page, the AI apps page, live sync in the editor
```

The end-to-end test starts the real Express app on a port and drives it with `@modelcontextprotocol/sdk`'s client: dynamic registration, PKCE authorize, consent, token exchange, then create → compose → animate in a transaction → set easing → render (PNG) → evaluate → modify → render a sheet → critique → save → save/read/update a preset → apply it in another project → export Lottie and dotLottie → verify. It also covers cross-user access, session hijack, read-only and scoped tokens, revocation, ask-first approvals, refresh rotation with reuse detection, and editor/AI revision conflicts. Postgres and S3 are in-memory fakes at the repository boundary.

## Adding a capability

Almost always: **don't touch the MCP code.**

- A new editor behaviour → a store action with a doc comment in `interface Editor` (`core/store.ts`). It is a capability on the next start.
- A new thing the copilot should be able to do → a tool per [COPILOT.md](../../COPILOT.md). It is a capability too.
- Something that needs the server (storage, rendering, files) → an entry in `HOST` in `apps/api/src/services/mcp/host.ts` with its schema and handler, calling existing services.

Then `pnpm --filter @blooby/api mcp:docs` to regenerate the reference and the audit, and name the new id in a test.

## Files

| File | Role |
|---|---|
| `packages/studio/src/engine/registry.ts` | the registry |
| `packages/studio/src/engine/session.ts` | the headless editor session and session capabilities |
| `packages/studio/src/engine/diff.ts` | structured diffs |
| `packages/studio/src/export/frame.ts` | frame → SVG, contact sheets |
| `apps/api/src/routes/mcp.routes.ts` | `/mcp`, OAuth router, `/api/mcp/*` |
| `apps/api/src/services/mcp/server.ts` | MCP server: tools, resources, prompts, limits, audit |
| `apps/api/src/services/mcp/host.ts` | server capabilities, rendering, jobs |
| `apps/api/src/services/mcp/workspace.ts` | open projects, autosave, sync, proposals |
| `apps/api/src/services/mcp/auth.service.ts` | OAuth provider, PATs, consent |
| `apps/api/src/services/mcp/prompts.ts` | MCP prompts |
| `packages/studio/src/ui/McpPanel.tsx` | the editor's MCP tab (also the dashboard's AI apps page) |
| `apps/web/src/features/connect/Connect.tsx` | the consent page |
