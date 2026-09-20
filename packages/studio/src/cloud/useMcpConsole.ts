import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './client';
import { mcpApi, type McpMode, type McpOverview } from './api';
import { useMcpLive } from './useMcpLive';

/**
 * Everything the MCP screens need: what is connected, what an AI is doing right now, and the
 * actions on both. The editor's rail tab and the dashboard's AI apps page render it very
 * differently — a 320px column and a full page are not the same design problem — so the state
 * lives here and each screen owns its own markup.
 */

export const MODE_LABEL: Record<McpMode, string> = { full: 'Full control', suggest: 'Ask me first', read_only: 'Look only' };

export function useMcpConsole(projectId?: string | null) {
  const [data, setData] = useState<McpOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** a token's secret, held only until the person says they have stored it */
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    mcpApi.overview().then(
      (d) => { if (live) { setData(d); setError(null); } },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) setSignedOut(true);
        else setError(e instanceof Error ? e.message : 'Could not reach the Blooby server.');
      },
    );
    return () => { live = false; };
  }, [nonce]);

  const { live, project, refresh } = useMcpLive(projectId, !signedOut && !error);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try { await fn(); reload(); void refresh(); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'That did not work.'); }
    finally { setBusy(false); }
  }, [reload, refresh]);

  return {
    data, error, signedOut, busy, problem, secret, setSecret, reload, act,
    live, project,
    url: data?.serverUrl ?? '',
    agents: project?.agents ?? [],
    pending: (live?.proposals ?? []).filter((p) => p.status === 'pending'),
    createToken: (name: string, mode: McpMode) => act(async () => {
      const r = await mcpApi.createToken({ name, mode });
      setSecret({ name: r.meta.name, token: r.token });
    }),
    rotateToken: (id: string) => act(async () => {
      const r = await mcpApi.rotateToken(id);
      setSecret({ name: r.meta.name, token: r.token });
    }),
    revokeToken: (id: string) => act(() => mcpApi.revokeToken(id)),
    disconnect: (grantId: string) => act(() => mcpApi.disconnect(grantId)),
    decide: (id: string, approve: boolean) => act(() => mcpApi.decideProposal(id, approve)),
  };
}

export type McpConsole = ReturnType<typeof useMcpConsole>;

/** What to paste where, per app. The link is the whole setup; the rest is where to paste it. */
export const MCP_CLIENTS = [
  { id: 'claude', label: 'Claude', where: 'Settings → Connectors → Add custom connector', code: (url: string) => url },
  { id: 'chatgpt', label: 'ChatGPT', where: 'Settings → Apps & Connectors → Advanced → Developer mode → Create', code: (url: string) => url },
  { id: 'claude-code', label: 'Claude Code', where: 'Run this, then /mcp → Authenticate', code: (url: string) => `claude mcp add --transport http blooby ${url}` },
  { id: 'cursor', label: 'Cursor', where: 'Add to ~/.cursor/mcp.json, then click “Needs login”', code: (url: string) => JSON.stringify({ mcpServers: { blooby: { url } } }, null, 2) },
  { id: 'other', label: 'Other apps', where: 'Any MCP client that speaks Streamable HTTP with OAuth', code: (url: string) => url },
] as const;
