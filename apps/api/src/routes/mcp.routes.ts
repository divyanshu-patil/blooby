import cors from 'cors';
import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { capabilities, CAPABILITY_VERSION, SCOPES, summaryOf } from '@blooby/studio/engine';
import { env } from '../config/env.js';
import { authenticate } from '../middlewares/authenticate.js';
import { caller, store } from '../middlewares/rateLimiter.js';
import { validate } from '../middlewares/validateDto.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { mcpRepository } from '../repositories/mcp.repository.js';
import { ALL_SCOPES, consentService, MODES, oauthProvider, tokensService, type Principal } from '../services/mcp/auth.service.js';
import { createMcpServer, type Profile } from '../services/mcp/server.js';
import { connFor } from '../services/mcp/host.js';
import { workspace } from '../services/mcp/workspace.js';

/**
 * Three surfaces:
 *   /mcp                 the MCP endpoint (Streamable HTTP), bearer-authenticated — what AI clients talk to
 *   /.well-known, /authorize, /token, /register, /revoke
 *                        OAuth 2.1 for it, from the MCP SDK's router over our provider
 *   /api/mcp/*           the person's own management API (their Supabase session): tokens,
 *                        connections, consent, live activity, approvals — the editor's MCP tab
 */

export const MCP_URL = new URL('/mcp', env.publicApiUrl);

// --- OAuth, mounted at the app root because the metadata paths are fixed by the RFCs -------
export const oauthRoutes = mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(env.publicApiUrl),
  resourceServerUrl: MCP_URL,
  scopesSupported: ALL_SCOPES,
  resourceName: 'Blooby Studio',
});

// --- the MCP endpoint -----------------------------------------------------------------------
//
// STATELESS Streamable HTTP: every POST gets its own server and transport, and nothing about
// the connection is kept in this process. That is what lets any instance answer any call —
// on Vercel consecutive calls land on different instances, and an instance can be frozen or
// recycled between them; on Render it costs nothing. What a session used to hold is per
// person instead: the open project and the run are in sharedState (services/mcp/host.ts
// `connFor`), and the document is saved after every edit (services/mcp/workspace.ts).

const bearer = requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(MCP_URL) });
const principalOf = (req: Request) => (req.auth!.extra as { principal: Principal }).principal;

export const mcpRoutes = Router();
// any origin: browser-based clients (the MCP Inspector) are fine — this is bearer auth, no cookies
mcpRoutes.use(cors({ origin: true, exposedHeaders: ['WWW-Authenticate'], allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'] }));
mcpRoutes.use(express.json({ limit: '4mb' }));
// BEFORE `bearer`, which costs two round trips to Postgres: a flood from one token is refused
// here without touching the pool everyone else is waiting on. Keyed on the (hashed, unverified)
// token — a forged one only spends its own bucket. Above the per-account tool-call ceiling in
// services/mcp/server.ts, which is the limit a well-behaved client actually meets.
mcpRoutes.use(rateLimit({
  windowMs: 60_000, limit: 600, store: store('mcp'), passOnStoreError: true, keyGenerator: caller,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests — slow down, and use batch_execute to send many edits in one call.' }, id: null },
}));
mcpRoutes.use(bearer);

mcpRoutes.post('/', asyncHandler(async (req: Request, res: Response) => {
  const conn = await connFor(principalOf(req));
  const profile: Profile = req.query.tools === 'full' ? 'full' : 'compact';
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(conn, profile);
  res.on('close', () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));

// no sessions, so no server → client stream to open and none to end (the spec's answer is 405)
const stateless = (_req: Request, res: Response) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'This server is stateless: send every request as a POST.' }, id: null });
};
mcpRoutes.get('/', stateless);
mcpRoutes.delete('/', stateless);

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
  res.json(await workspace.live(req.user!.id, typeof req.query.projectId === 'string' ? req.query.projectId : undefined));
}));
mcpManageRoutes.post('/proposals/:id', validate(decideDto), asyncHandler(async (req, res) => {
  res.json(await workspace.decide(req.user!.id, String(req.params.id), (req.body as { approve: boolean }).approve));
}));
