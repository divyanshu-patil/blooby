import { api, fetchDataUrl } from './client';
import type {
  AdminUser, Analytics, AssetKind, AssetRow, AssetSource, McpUsage, Page, ProjectRow, PublicInsights,
  SplashscreenRow, Traffic,
} from './types';

/** Feature-level API modules. UI components call these, never fetch directly. */

/**
 * The document, through the API, after a direct fetch from the bucket did not work.
 *
 * Loud on purpose. This path is correct and it is several times slower, so it should read
 * as a misconfiguration to whoever opens the console — most likely CORS rules missing from
 * the bucket (`pnpm --filter @blooby/api s3:cors`).
 */
async function viaApi(id: string, cause: unknown) {
  console.warn(
    `[blooby] could not read project ${id} from storage directly, falling back to the API. `
    + 'If this is every project, the bucket is probably missing its CORS rules.',
    cause,
  );
  const r = await api.get<{ data: unknown }>(`/api/projects/${id}/data`, { inline: 1 });
  return r.data;
}

export const projectsApi = {
  list: (params: { limit?: number; cursor?: string; q?: string; sort?: 'recent' | 'created' | 'name' }) =>
    api.get<Page<ProjectRow>>('/api/projects', params),
  create: (body: { name: string; templateAssetId?: string; project?: unknown }) =>
    api.post<ProjectRow>('/api/projects', body),
  get: (id: string) => api.get<ProjectRow>(`/api/projects/${id}`),
  update: (id: string, body: { name?: string; visibility?: 'private' | 'public'; access?: 'view' | 'edit'; thumbnailUrl?: string | null }) =>
    api.patch<ProjectRow>(`/api/projects/${id}`, body),
  remove: (id: string) => api.del<void>(`/api/projects/${id}`),
  duplicate: (id: string, name?: string) => api.post<ProjectRow>(`/api/projects/${id}/duplicate`, { name }),
  markOpened: (id: string) => api.post<ProjectRow>(`/api/projects/${id}/opened`),
  /**
   * The project's row, and its document.
   *
   * The API answers with a presigned link, not the JSON: the document goes browser ↔ S3
   * directly, so the server never buffers a 2.6MB project nor spends a round trip on it
   * inside a request. A card on a listing already HAS that link (`row.dataUrl`) and should
   * use `projectData` instead of calling here at all.
   *
   * If that fetch cannot happen the API serves the document itself. Not a nicety — the
   * first deploy of the direct fetch went to a bucket with no CORS rules on it and every
   * project in the app failed to open, when the honest answer was "this is slower than it
   * should be". A presigned link also expires after an hour, so a tab left open overnight
   * lands here too.
   *
   * `canEdit`: whether this caller may save to it — the owner, or anyone while it is
   * public with edit access.
   */
  async getData(id: string) {
    const r = await api.get<{ project: ProjectRow; dataUrl?: string; data?: unknown; canEdit?: boolean; isOwner?: boolean }>(`/api/projects/${id}/data`);
    if (!r.dataUrl) return { ...r, data: r.data };
    try {
      return { ...r, data: await fetchDataUrl<unknown>(r.dataUrl) };
    } catch (e) {
      return { ...r, data: await viaApi(id, e) };
    }
  },

  /** A listed project's document, straight from the bucket — no request to the API at all,
   *  which is what makes a page of forty cards cost forty fetches and nothing else. */
  async projectData(row: ProjectRow) {
    if (!row.dataUrl) return projectsApi.getData(row.id).then((r) => r.data);
    try {
      return await fetchDataUrl<unknown>(row.dataUrl);
    } catch (e) {
      return viaApi(row.id, e);
    }
  },
  save: (id: string, body: { project: unknown; thumbnailUrl?: string | null; expectedVersion?: number }) =>
    api.put<{ version: number; sizeBytes: number; checksum: string; savedAt: string }>(`/api/projects/${id}/data`, body),
};

export const assetsApi = {
  browse: (params: { kind?: AssetKind; source?: AssetSource; q?: string; tag?: string; category?: string; sort?: 'newest' | 'popular' | 'name' | 'trending'; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/assets', params),
  mine: (params: { kind?: AssetKind; q?: string; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/assets/mine', params),
  get: (id: string) => api.get<AssetRow>(`/api/assets/${id}`),
  create: (body: { kind: AssetKind; name: string; description?: string; category?: string; tags?: string[]; data: unknown }) =>
    api.post<AssetRow>('/api/assets', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<AssetRow>(`/api/assets/${id}`, body),
  remove: (id: string) => api.del<void>(`/api/assets/${id}`),
  submitToCommunity: (id: string, body: { description: string; category?: string; tags?: string[] }) =>
    api.post<AssetRow>(`/api/assets/${id}/publish`, body),
  /** Counted when an item is pulled into a project — the number behind "most used". */
  markUsed: (id: string) => api.post<{ downloadCount: number }>(`/api/assets/${id}/use`).catch(() => null),
};

export const communityApi = {
  browse: (params: { kind?: AssetKind; q?: string; sort?: 'newest' | 'popular' | 'name'; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/community', params),
  /** everyone's public projects, trending (one ranked page) or newest */
  projects: (params: { q?: string; sort?: 'trending' | 'newest'; limit?: number; cursor?: string }) =>
    api.get<Page<ProjectRow>>('/api/community/projects', params),
  insights: () => api.get<PublicInsights>('/api/community/insights', undefined, { auth: false }),
  official: (params: { kind?: AssetKind; q?: string; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/community/official', params),
};

export const authApi = {
  /** What's New: everything up to `version` has been seen. The server never moves it backwards. */
  seenRelease: (version: string) => api.put<{ lastSeenRelease: string | null }>('/api/auth/whats-new', { version }),
};

export const splashApi = {
  /** Public — no session needed, and null is a normal answer. */
  active: () => api.get<SplashscreenRow | null>('/api/splashscreen/active', undefined, { auth: false }),
};

export const adminApi = {
  analytics: (days: number) => api.get<Analytics>('/api/admin/analytics', { days }),
  /** page analytics — views, visitors, top pages, referrers and the navigation flow */
  traffic: (days: number, app: 'web' | 'admin' = 'web') => api.get<Traffic>('/api/admin/traffic', { days, app }),
  /** MCP usage — connections, clients, capabilities and errors, from the audit trail */
  mcpUsage: (days: number) => api.get<McpUsage>('/api/admin/mcp', { days }),
  users: (params: { q?: string; role?: 'user' | 'admin'; limit?: number; cursor?: string }) =>
    api.get<Page<AdminUser>>('/api/admin/users', params),
  user: (id: string) => api.get<AdminUser & { recentProjects: ProjectRow[]; publishedAssets: number; pendingAssets: number }>(`/api/admin/users/${id}`),
  setRole: (id: string, role: 'user' | 'admin') => api.patch<AdminUser>(`/api/admin/users/${id}/role`, { role }),

  copilot: () => api.get<CopilotAdminView>('/api/admin/copilot'),
  setCopilotSettings: (allowUserKeys: boolean) => api.patch<CopilotAdminView>('/api/admin/copilot', { allowUserKeys }),
  addCopilotKey: (key: string, label: string) => api.post<CopilotKeyRow>('/api/admin/copilot/keys', { key, label }),
  removeCopilotKey: (id: string) => api.del<void>(`/api/admin/copilot/keys/${id}`),
  projects: (params: { q?: string; userId?: string; limit?: number; cursor?: string }) =>
    api.get<Page<ProjectRow>>('/api/admin/projects', params),
  moderationQueue: (params: { status: string; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/admin/community', params),
  moderate: (id: string, body: { action: 'approve' | 'reject' | 'unpublish' | 'archive'; reason?: string }) =>
    api.patch<AssetRow>(`/api/admin/community/${id}`, body),
  createOfficial: (body: { kind: AssetKind; name: string; description?: string; category?: string; tags?: string[]; data: unknown }) =>
    api.post<AssetRow>('/api/admin/assets', body),
  splashscreens: () => api.get<SplashscreenRow[]>('/api/admin/splashscreens'),
  createSplash: (body: { name: string; data: unknown; background?: string; durationMs?: number; fadeMs?: number }) =>
    api.post<SplashscreenRow>('/api/admin/splashscreens', body),
  updateSplash: (id: string, body: Record<string, unknown>) => api.patch<SplashscreenRow>(`/api/admin/splashscreens/${id}`, body),
  publishSplash: (id: string) => api.post<SplashscreenRow>(`/api/admin/splashscreens/${id}/publish`),
  unpublishSplash: (id: string) => api.post<SplashscreenRow>(`/api/admin/splashscreens/${id}/unpublish`),
  removeSplash: (id: string) => api.del<void>(`/api/admin/splashscreens/${id}`),
};

/** Two booleans, which is all a signed-in user is told about the server's copilot setup. */
export interface CopilotConfig { allowUserKeys: boolean; hasServerKeys: boolean }

/** Never carries `secret` — the API has no read path that selects it. */
export interface CopilotKeyRow {
  id: string; label: string; hint: string;
  status: 'ok' | 'rate-limited' | 'error';
  note: string | null; lastUsedAt: string | null; createdAt: string;
}

export interface CopilotAdminView {
  allowUserKeys: boolean;
  keys: CopilotKeyRow[];
}

export const copilotApi = {
  config: () => api.get<CopilotConfig>('/api/copilot/config'),
};

// --- MCP: AI apps (Claude, ChatGPT, Cursor…) acting on your projects -----------------------

export type McpMode = 'read_only' | 'suggest' | 'full';
export interface McpTokenMeta { id: string; name: string; scopes: string[]; mode: McpMode; expiresAt: string | null; lastUsedAt: string | null; createdAt: string }
export interface McpConnection { grantId: string; clientId: string; clientName: string; scopes: string[]; mode: McpMode; connectedAt: string; lastUsedAt: string | null }
export interface McpAuditRow { id: number | string; clientId: string | null; operation: string; projectId: string | null; ok: boolean; errorCode: string | null; durationMs: number | null; createdAt: string }
export interface McpOverview {
  serverUrl: string; capabilityVersion: string; capabilityCount: number;
  scopes: Record<string, string>; modes: Record<McpMode, string>;
  tokens: McpTokenMeta[]; connections: McpConnection[]; recent: McpAuditRow[];
}
export interface McpActivity { at: string; client: string; capability: string; summary: string; ok: boolean; error?: string }
export interface McpProposal { id: string; projectId: string; client: string; capability: string; summary: string; status: 'pending' | 'applied' | 'rejected' | 'failed'; preview: { created: unknown[]; deleted: unknown[]; changed: string[] } | null; createdAt: string }
export interface McpLive {
  projects: { projectId: string; name: string; version: number; unsaved: boolean; saveError: string | null; agents: { client: string; lastActiveAt: string }[]; activity: McpActivity[] }[];
  proposals: McpProposal[];
}
export interface McpConsent { requestId: string; clientName: string; redirectHost: string; scopes: { scope: string; description: string }[]; modes: Record<McpMode, string> }

export const mcpApi = {
  overview: () => api.get<McpOverview>('/api/mcp/overview'),
  /** the secret comes back here once and is never retrievable again */
  createToken: (body: { name: string; scopes?: string[]; mode?: McpMode; expiresInDays?: number }) =>
    api.post<{ token: string; meta: McpTokenMeta }>('/api/mcp/tokens', body),
  rotateToken: (id: string) => api.post<{ token: string; meta: McpTokenMeta }>(`/api/mcp/tokens/${id}/rotate`),
  revokeToken: (id: string) => api.del<void>(`/api/mcp/tokens/${id}`),
  disconnect: (grantId: string) => api.del<void>(`/api/mcp/connections/${grantId}`),
  consent: (requestId: string) => api.get<McpConsent>(`/api/mcp/consent/${requestId}`),
  decide: (requestId: string, body: { approve: boolean; scopes?: string[]; mode?: McpMode }) =>
    api.post<{ redirectTo: string }>(`/api/mcp/consent/${requestId}`, body),
  live: (projectId?: string) => api.get<McpLive>('/api/mcp/live', projectId ? { projectId } : undefined),
  decideProposal: (id: string, approve: boolean) => api.post<McpProposal>(`/api/mcp/proposals/${id}`, { approve }),
};
