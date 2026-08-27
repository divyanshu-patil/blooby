import { api } from './client';
import type { AdminUser, Analytics, AssetKind, AssetRow, AssetSource, Page, ProjectRow, SplashscreenRow } from './types';

/** Feature-level API modules. UI components call these, never fetch directly. */

export const projectsApi = {
  list: (params: { limit?: number; cursor?: string; q?: string; sort?: 'recent' | 'created' | 'name' }) =>
    api.get<Page<ProjectRow>>('/api/projects', params),
  create: (body: { name: string; templateAssetId?: string; project?: unknown }) =>
    api.post<ProjectRow>('/api/projects', body),
  get: (id: string) => api.get<ProjectRow>(`/api/projects/${id}`),
  update: (id: string, body: { name?: string; visibility?: 'private' | 'public'; thumbnailUrl?: string | null }) =>
    api.patch<ProjectRow>(`/api/projects/${id}`, body),
  remove: (id: string) => api.del<void>(`/api/projects/${id}`),
  duplicate: (id: string, name?: string) => api.post<ProjectRow>(`/api/projects/${id}/duplicate`, { name }),
  markOpened: (id: string) => api.post<ProjectRow>(`/api/projects/${id}/opened`),
  getData: (id: string) => api.get<{ project: ProjectRow; data: unknown }>(`/api/projects/${id}/data`),
  save: (id: string, body: { project: unknown; thumbnailUrl?: string | null; expectedVersion?: number }) =>
    api.put<{ version: number; sizeBytes: number; checksum: string; savedAt: string }>(`/api/projects/${id}/data`, body),
};

export const assetsApi = {
  browse: (params: { kind?: AssetKind; source?: AssetSource; q?: string; tag?: string; category?: string; sort?: 'newest' | 'popular' | 'name'; limit?: number; cursor?: string }) =>
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
  official: (params: { kind?: AssetKind; q?: string; limit?: number; cursor?: string }) =>
    api.get<Page<AssetRow>>('/api/community/official', params),
};

export const splashApi = {
  /** Public — no session needed, and null is a normal answer. */
  active: () => api.get<SplashscreenRow | null>('/api/splashscreen/active', undefined, { auth: false }),
};

export const adminApi = {
  analytics: (days: number) => api.get<Analytics>('/api/admin/analytics', { days }),
  users: (params: { q?: string; role?: 'user' | 'admin'; limit?: number; cursor?: string }) =>
    api.get<Page<AdminUser>>('/api/admin/users', params),
  user: (id: string) => api.get<AdminUser & { recentProjects: ProjectRow[]; publishedAssets: number; pendingAssets: number }>(`/api/admin/users/${id}`),
  setRole: (id: string, role: 'user' | 'admin') => api.patch<AdminUser>(`/api/admin/users/${id}/role`, { role }),
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
