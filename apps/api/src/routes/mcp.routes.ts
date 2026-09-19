import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { capabilities, CAPABILITY_VERSION, SCOPES, summaryOf } from '@blooby/studio/engine';
import { env } from '../config/env.js';
import { authenticate } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { mcpRepository } from '../repositories/mcp.repository.js';
import { ALL_SCOPES, consentService, MODES, oauthProvider, tokensService, type Principal } from '../services/mcp/auth.service.js';
import { createMcpServer, type Profile } from '../services/mcp/server.js';
import { newRun, type Conn } from '../services/mcp/host.js';
import { workspace } from '../services/mcp/workspace.js';

/**
 * Three surfaces:
 *   /mcp                 the MCP endpoint (Streamable HTTP), bearer-authenticated — what AI clients talk to
 *   /.well-known, /authorize, /token, /register, /revoke
 *                        OAuth 2.1 for it, from the MCP SDK's router over our provider
 *   /api/mcp/*           the person's own management API (their Supabase session): tokens,
 *                        connections, consent, live activity, approvals — the editor's MCP tab
 */

export const MCP_URL = new URL('/mcp', env.PUBLIC_API_URL);

// --- OAuth, mounted at the app root because the metadata paths are fixed by the RFCs -------
export const oauthRoutes = mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(env.PUBLIC_API_URL),
  resourceServerUrl: MCP_URL,
  scopesSupported: ALL_SCOPES,
  resourceName: 'Blooby Studio',
  serviceDocumentationUrl: new URL('/docs/mcp', env.APP_URL),
});

// --- the MCP endpoint -----------------------------------------------------------------------

interface Live { transport: StreamableHTTPServerTransport; conn: Conn; seen: number }
const sessions = new Map<string, Live>();
setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.seen > 60 * 60_000) { void s.transport.close(); sessions.delete(id); }
}, 60_000).unref();

const bearer = requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(MCP_URL) });
const principalOf = (req: Request) => (req.auth?.extra as { principal: Principal }).principal;

export const mcpRoutes = Router();
// any origin: browser-based clients (the MCP Inspector) are fine — this is bearer auth, no cookies
mcpRoutes.use(cors({ origin: true, exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'], allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'] }));
mcpRoutes.use(express.json({ limit: '4mb' }));
mcpRoutes.use(bearer);
mcpRoutes.use(rateLimit({
  windowMs: 60_000, limit: 1200, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => principalOf(req)?.tokenId ?? 'anon',
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests — slow down.' }, id: null },
}));

mcpRoutes.post('/', asyncHandler(async (req: Request, res: Response) => {
  const principal = principalOf(req);
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid) {
    const s = sessions.get(sid);
    // a session belongs to the person who opened it; anyone else's token gets a 404 like a stranger's id
    if (!s || s.conn.principal.userId !== principal.userId) { res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found — initialize again.' }, id: null }); return; }
    s.conn.principal = principal;    // a refreshed token may narrow scopes
    s.seen = Date.now();
    await s.transport.handleRequest(req, res, req.body);
    return;
  }
  if (!isInitializeRequest(req.body)) { res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No session: send initialize first.' }, id: null }); return; }
  const conn: Conn = { principal, projectId: null, run: newRun(), subscriptions: new Set() };
  const profile: Profile = req.query.tools === 'full' ? 'full' : 'compact';
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => { sessions.set(id, { transport, conn, seen: Date.now() }); },
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await createMcpServer(conn, profile).connect(transport);
  await transport.handleRequest(req, res, req.body);
}));

const existing = asyncHandler(async (req: Request, res: Response) => {
  const s = sessions.get(req.headers['mcp-session-id'] as string ?? '');
  if (!s || s.conn.principal.userId !== principalOf(req).userId) { res.status(404).send('Session not found'); return; }
  s.seen = Date.now();
  await s.transport.handleRequest(req, res);
});
mcpRoutes.get('/', existing);      // server → client event stream
mcpRoutes.delete('/', existing);   // client ends its session

// --- the person's own management API ---------------------------------------------------------

const scopeList = z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1).optional();
const mode = z.enum(['read_only', 'suggest', 'full']).default('full');
const createTokenDto = z.object({ name: z.string().trim().min(1).max(80), scopes: scopeList, mode, expiresInDays: z.number().int().min(1).max(365).optional() });
const consentDto = z.object({ approve: z.boolean(), scopes: scopeList, mode });
const decideDto = z.object({ approve: z.boolean() });

export const mcpManageRoutes = Router();
mcpManageRoutes.use(authenticate);

/** Everything the MCP tab shows: how to connect, what is connected, and what it did. */
mcpManageRoutes.get('/overview', asyncHandler(async (req, res) => {
  const [creds, recent] = await Promise.all([tokensService.list(req.user!.id), mcpRepository.recentAudit(req.user!.id)]);
  res.json({
    serverUrl: MCP_URL.toString(), capabilityVersion: CAPABILITY_VERSION, capabilityCount: capabilities().length,
    scopes: SCOPES, modes: MODES, ...creds, recent,
  });
}));
mcpManageRoutes.get('/capabilities', (_req, res) => { res.json({ capabilityVersion: CAPABILITY_VERSION, capabilities: capabilities().map(summaryOf) }); });

mcpManageRoutes.post('/tokens', validate(createTokenDto), asyncHandler(async (req, res) => {
  res.status(201).json(await tokensService.createPat(req.user!.id, req.body as z.infer<typeof createTokenDto>));
}));
mcpManageRoutes.post('/tokens/:id/rotate', validate(uuidParam('id'), 'params'), asyncHandler(async (req, res) => {
  res.json(await tokensService.rotatePat(req.user!.id, req.params.id!));
}));
mcpManageRoutes.delete('/tokens/:id', validate(uuidParam('id'), 'params'), asyncHandler(async (req, res) => {
  await tokensService.revokePat(req.user!.id, req.params.id!);
  res.status(204).end();
}));
mcpManageRoutes.delete('/connections/:id', validate(uuidParam('id'), 'params'), asyncHandler(async (req, res) => {
  await tokensService.revokeConnection(req.user!.id, req.params.id!);
  res.status(204).end();
}));

mcpManageRoutes.get('/consent/:id', validate(uuidParam('id'), 'params'), asyncHandler(async (req, res) => {
  res.json(await consentService.describe(req.params.id!));
}));
mcpManageRoutes.post('/consent/:id', validate(uuidParam('id'), 'params'), validate(consentDto), asyncHandler(async (req, res) => {
  res.json(await consentService.decide(req.params.id!, req.user!.id, req.body as z.infer<typeof consentDto>));
}));

/** Polled by the editor: AI presence, activity and pending approvals, and the version to reload at. */
mcpManageRoutes.get('/live', asyncHandler(async (req, res) => {
  res.json(workspace.live(req.user!.id, typeof req.query.projectId === 'string' ? req.query.projectId : undefined));
}));
mcpManageRoutes.post('/proposals/:id', validate(decideDto), asyncHandler(async (req, res) => {
  res.json(await workspace.decide(req.user!.id, String(req.params.id), (req.body as { approve: boolean }).approve));
}));
