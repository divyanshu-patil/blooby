# Authentication and authorization

Every request to `/mcp` carries `Authorization: Bearer <token>`. There are two ways to get one; both end as a row in `mcp_tokens` holding a **sha256 of the secret**, the person, scopes and a mode.

## OAuth 2.1 (what AI apps do by themselves)

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 — which authorization server protects `/mcp` |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `POST /register` | RFC 7591 dynamic client registration |
| `GET /authorize` | authorization code + PKCE (S256 required) |
| `POST /token` | code → tokens; refresh |
| `POST /revoke` | RFC 7009 |

Flow:

1. The app registers itself and calls `/authorize`. Blooby stores the request (15 minutes) and redirects to **`/connect?request=…`** in the web app.
2. The person signs in if needed (email or Google — the request survives the round trip) and sees the app's name, where it will return to, the permissions it asked for, and a mode.
3. **Allow** mints a single-use code (10 minutes) bound to the client, redirect URI and PKCE challenge, and the browser returns to the app. **Deny** returns `error=access_denied`.
4. The app exchanges the code: access token (1 hour) + refresh token (30 days).

Hardening: codes are single use (a replay revokes everything that grant minted); refresh tokens **rotate** on use, and a reused refresh token revokes the whole grant; granted scopes can only narrow what the app asked for.

## Personal access tokens

For scripts and clients without OAuth: MCP tab → **Personal tokens** → name, mode → **Create**. The token (`blb_pat_…`) is shown **once**; only its hash is stored. Tokens can be rotated (new secret, same permissions, old one dead at once), revoked, and given an expiry (1–365 days). They are never logged or returned by any read path.

## Scopes

| Scope | Allows |
|---|---|
| `project:read` | inspect projects, layers, keyframes, state |
| `project:write` | create and change projects, save |
| `preset:read` | browse presets, including full keyframe data |
| `preset:write` | save, edit, duplicate, publish, delete library presets |
| `render:read` | render frames as images |
| `export:write` | export Lottie, dotLottie, React Native pack, PNG, SVG |

Tools a connection may not use are **not listed** to it, and calling one anyway returns `FORBIDDEN_SCOPE`.

## Modes

| Mode | Behaviour (enforced server-side) |
|---|---|
| **Look only** (`read_only`) | every mutating tool hidden and refused (`READ_ONLY_CONNECTION`) |
| **Ask me first** (`suggest`) | each edit is dry-run for a preview and parked as a proposal; the person approves or rejects it in the MCP tab; the agent polls `proposal_get`. Deletion is unavailable |
| **Full control** (`full`) | edits apply directly; each is undoable |

## Managing access

The editor's MCP tab (and the dashboard's AI apps page) lists connected apps and tokens with their mode and last use, and **Disconnect** / **Revoke** / **Rotate** them. The management API is `/api/mcp/*`, authenticated with the person's own Supabase session:

`GET /overview` · `POST /tokens` · `POST /tokens/:id/rotate` · `DELETE /tokens/:id` · `DELETE /connections/:grantId` · `GET|POST /consent/:requestId` · `GET /live` · `POST /proposals/:id`
