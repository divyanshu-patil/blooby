/** Shapes the API returns. Kept next to the client so both apps agree on them. */

export type UserRole = 'user' | 'admin';
export type Visibility = 'private' | 'public';
export type AssetKind = 'preset' | 'expression';
export type AssetSource = 'builtin' | 'official' | 'user' | 'community';
export type AssetStatus = 'draft' | 'pending_review' | 'published' | 'rejected' | 'archived';
export type SplashStatus = 'draft' | 'published' | 'archived';

export interface SessionUser { id: string; email: string | null; role: UserRole }

export interface Profile {
  id: string; role: UserRole; username: string | null; avatarUrl: string | null;
  email?: string | null; createdAt: string; updatedAt: string; lastLoginAt: string | null;
}

export interface ProjectRow {
  id: string; userId: string; name: string; thumbnailUrl: string | null;
  s3Key: string; s3Bucket: string; currentVersion: number; sizeBytes: number | string;
  checksum: string | null; visibility: Visibility;
  createdAt: string; updatedAt: string; lastOpenedAt: string | null;
}

export interface AssetRow {
  id: string; kind: AssetKind; source: AssetSource; status: AssetStatus;
  ownerId: string | null; name: string; description: string | null; category: string | null;
  tags: string[]; thumbnailUrl: string | null; data: unknown;
  schemaVersion: number; version: number; downloadCount: number;
  reviewNote: string | null; reviewedAt: string | null; publishedAt: string | null;
  createdAt: string; updatedAt: string;
}

export interface SplashscreenRow {
  id: string; name: string; status: SplashStatus; data: unknown;
  background: string; durationMs: number; fadeMs: number;
  publishedAt: string | null; createdAt: string; updatedAt: string;
}

export interface AdminUser extends Profile {
  lastSignInAt: string | null; projectCount: number;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface Analytics {
  days: number;
  overview: {
    totalUsers: number; newUsers: number; activeUsers: number;
    totalProjects: number; projectsToday: number;
    communityPresets: number; communityExpressions: number;
    officialPublished: number; pendingReview: number;
  };
  growth: {
    users: { date: string; count: number }[];
    projects: { date: string; count: number }[];
    deltas: { users: number | null; projects: number | null };
  };
  insights: {
    topAssets: { id: string; name: string; kind: AssetKind; source: AssetSource; downloadCount: number }[];
    topCreators: { userId: string; username: string | null; projects: number }[];
  };
}
