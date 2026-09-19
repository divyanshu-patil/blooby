import { useCallback, useEffect, useState } from 'react';
import { mcpApi, type McpLive } from './api';

/**
 * What AI clients are doing right now, polled — faster while one is active, slower when
 * none is, and not at all while the tab is hidden. The editor uses it twice: the MCP tab
 * (activity and approvals) and CloudEditor (reloading when an AI saved a newer version).
 *
 * ponytail: polling, not a socket — a few small requests a minute per open editor. Move to
 * Supabase Realtime or SSE if that ever shows up in the API's load.
 */
export function useMcpLive(projectId: string | null | undefined, enabled = true) {
  const [live, setLive] = useState<McpLive | null>(null);
  const refresh = useCallback(() => mcpApi.live(projectId ?? undefined).then(setLive).catch(() => {}), [projectId]);

  const active = !!live?.projects.some((p) => p.agents.length) || !!live?.proposals.some((p) => p.status === 'pending');
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (!stop) t = setTimeout(tick, active ? 2000 : 6000);
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [refresh, enabled, active]);

  return { live, refresh, project: live?.projects.find((p) => p.projectId === projectId) ?? null };
}
