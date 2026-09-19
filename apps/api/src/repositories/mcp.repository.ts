import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** Rows for the MCP server: registered AI clients, credentials (hashes only) and the audit trail. */
export const mcpRepository = {
  client: (clientId: string) => prisma.mcpClient.findUnique({ where: { clientId } }),
  createClient: (data: Prisma.McpClientUncheckedCreateInput) => prisma.mcpClient.create({ data }),
  touchClient: (clientId: string) => prisma.mcpClient.update({ where: { clientId }, data: { lastUsedAt: new Date() } }),
  clientsByIds: (ids: string[]) => prisma.mcpClient.findMany({ where: { clientId: { in: ids } } }),

  tokenByHash: (tokenHash: string) => prisma.mcpToken.findUnique({ where: { tokenHash } }),
  tokenById: (id: string) => prisma.mcpToken.findUnique({ where: { id } }),
  createToken: (data: Prisma.McpTokenUncheckedCreateInput) => prisma.mcpToken.create({ data }),
  updateToken: (id: string, data: Prisma.McpTokenUncheckedUpdateInput) => prisma.mcpToken.update({ where: { id }, data }),
  /** Single-use: marks it spent only if nobody else did first. 0 = already used. */
  spend: (id: string) => prisma.mcpToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } }).then((r) => r.count),
  revokeGrant: (grantId: string) => prisma.mcpToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: new Date() } }),
  revokeGrantOf: (grantId: string, userId: string) =>
    prisma.mcpToken.updateMany({ where: { grantId, userId, revokedAt: null }, data: { revokedAt: new Date() } }).then((r) => r.count),

  /** What the MCP tab lists: live PATs and live OAuth grants (their newest access/refresh row). */
  liveCredentials: (userId: string) => prisma.mcpToken.findMany({
    where: { userId, kind: { in: ['pat', 'access', 'refresh'] }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, name: true, clientId: true, grantId: true, scopes: true, mode: true, expiresAt: true, lastUsedAt: true, createdAt: true },
  }),

  audit: (data: Prisma.McpAuditUncheckedCreateInput) => prisma.mcpAudit.create({ data }),
  recentAudit: (userId: string, projectId?: string, take = 40) => prisma.mcpAudit.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, clientId: true, operation: true, projectId: true, ok: true, errorCode: true, durationMs: true, runId: true, createdAt: true },
  }),
};
