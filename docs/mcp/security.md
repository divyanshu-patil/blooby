# Security model

`/mcp` is a public attack surface. The AI controls **Blooby**, never the server it runs on: there is no filesystem, shell, database or environment access through any capability.

| Threat | Mitigation |
|---|---|
| Stolen or leaked token | hashed at rest; short-lived access tokens; refresh rotation with reuse detection; instant revoke/disconnect; PAT expiry |
| The person's own session given to an AI | never: OAuth mints a separate, scoped credential; the consent page is Blooby's own |
| Cross-user access / ID enumeration | every project goes through `projectsService` (owner, or public with edit access); a stranger's id is `NOT_FOUND`, the same as a missing one. Tested |
| Session hijack | an MCP session id is bound to its user; another user's token on it is a 404. Tested |
| Privilege escalation | scopes filter both the tool list and every call; `invoke` checks the target capability's scope; MCP always acts with the `user` role — never admin, even for an admin |
| Malicious prompt / compromised agent | **Look only** and **Ask me first** modes; every edit undoable; checkpoints; `project_delete` / `preset_delete` need `confirm: true` and are refused in ask-first mode |
| Replay / duplicate requests | `requestId` idempotency on every mutation; single-use OAuth codes |
| Lost updates | revision checks against the stored version; `REVISION_CONFLICT` instead of overwriting the person's edits |
| Malicious SVG | `add_svg` goes through `core/svg.ts` (parsed to vector paths, sanitised markup); rendering uses resvg (no scripts, no network) |
| Resource exhaustion | per-token 1200 req/min; per-user 900 calls/min, 60 renders/min, 20 exports/min, 4 concurrent calls; batches ≤ 200; frames ≤ 16 per sheet; images ≤ 2400 px; project size capped by `MAX_PROJECT_BYTES`; JSON bodies ≤ 4 MB |
| Arbitrary code execution | capabilities are data-in/data-out; store actions are an allow-list derived from the `Editor` interface, minus those that replace the document or take callbacks (listed with reasons in `parity.json`) |
| Sensitive data in logs | the audit (`mcp_audit`) records operation names, ids, ok/error code, duration and run id — never arguments, tokens or project content. Tested |

## Audit and observability

Every tool call writes an `mcp_audit` row (user, client, token id, operation, project, ok, error code, run id, duration) and one structured log line `{mcp, ok, ms, error, user, client}`. The person sees their own recent activity in the MCP tab. Authorization failures come from the SDK's bearer middleware as 401 with `WWW-Authenticate`.

## Database

`mcp_clients`, `mcp_tokens`, `mcp_audit` have RLS enabled with **no policies**: only the API's service role can read them. Migration: `supabase/migrations/20260920120000_mcp.sql`.
