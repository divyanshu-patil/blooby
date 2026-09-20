# Connecting an AI app

Everything starts from **your Blooby MCP link**, shown in the editor's **MCP** tab and on the dashboard's **AI apps** page. It is the API's public address plus `/mcp`, e.g. `https://api.blooby.app/mcp`.

The link carries no secret. The app authenticates with OAuth: it opens a Blooby page, you approve, and it receives its own scoped key. Your Blooby password and session are never given to it.

> **Public vs local.** Claude.ai and ChatGPT connect from their own servers, so they need the API on a public `https` address — your deployment, or a tunnel while developing (`cloudflared tunnel --url http://localhost:3000`, then set `PUBLIC_API_URL` to the tunnel URL). Claude Code, Claude Desktop and Cursor running on your machine can use `http://localhost:3000/mcp`.

## Claude (claude.ai and Claude Desktop)

1. Settings → **Connectors** → **Add custom connector**.
2. Name: `Blooby`. URL: your MCP link.
3. **Connect** → approve on the Blooby page. Enable the connector in a chat and ask away.

## ChatGPT

1. Settings → **Apps & Connectors** → **Advanced settings** → turn on **Developer mode**.
2. **Create** a connector: name `Blooby`, URL your MCP link, authentication **OAuth**.
3. Approve on the Blooby page, then choose Blooby in the chat's tools.

## Claude Code

```sh
claude mcp add --transport http blooby https://api.blooby.app/mcp
```

Then run `/mcp`, choose **blooby** → **Authenticate**, approve in the browser.

## Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a repo):

```json
{ "mcpServers": { "blooby": { "url": "https://api.blooby.app/mcp" } } }
```

Cursor shows *Needs login* — click it and approve.

## Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.blooby]
url = "https://api.blooby.app/mcp"
bearer_token_env_var = "BLOOBY_TOKEN"
```

Create a personal token in the MCP tab and `export BLOOBY_TOKEN=blb_pat_…`.

## Anything else

- **Streamable HTTP + OAuth** clients need only the URL. Discovery is standard: a 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…/.well-known/oauth-protected-resource/mcp`, which points at `/.well-known/oauth-authorization-server` (dynamic client registration, PKCE S256).
- **Personal token** clients send `Authorization: Bearer blb_pat_…`. Create one in the MCP tab; it is shown once.
- **stdio-only** clients bridge with `npx mcp-remote https://api.blooby.app/mcp --header "Authorization: Bearer $BLOOBY_TOKEN"`.

### From your own code (TypeScript SDK)

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('https://api.blooby.app/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.BLOOBY_TOKEN}` } },
}));
await client.callTool({ name: 'project_create', arguments: { name: 'From my agent' } });
const frame = await client.callTool({ name: 'render_frame', arguments: { atMs: 500 } }); // content[0] is a PNG
```

## "It asks me before every action"

That prompt is your AI app's own, not Blooby's: most clients confirm the first use of each tool
and offer "always allow". Blooby only asks you when the connection's mode is **Ask me first**,
and then it asks in Blooby (editor → MCP tab, or the AI apps page), not in the app.

## Tool profiles

- **Compact** (default, `/mcp`): ~50 everyday tools plus `invoke`, which runs *any* capability by id. Keeps context small — right for ChatGPT, Cursor and most chats.
- **Full** (`/mcp?tools=full`): every capability as its own tool (~245). For clients with tool search, such as Claude Code.

Nothing is out of reach in either: `capabilities_search` finds a capability, `capability_get` explains it, `invoke` runs it.
