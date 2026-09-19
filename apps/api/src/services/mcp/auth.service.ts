import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { SCOPES, type Scope } from '@blooby/studio/engine';
import { env } from '../../config/env.js';
import { mcpRepository } from '../../repositories/mcp.repository.js';
import { HttpError } from '../../utils/httpError.js';

/**
 * Who may drive Blooby from an AI client, and with what.
 *
 * Two ways in, one kind of credential:
 *   - OAuth 2.1 (authorization code + PKCE, dynamic client registration) — what Claude.ai,
 *     Claude Desktop, ChatGPT connectors and Cursor do on their own when you paste the URL.
 *     The person approves the client and its scopes on Blooby's own /connect page.
 *   - personal access tokens, made in the editor's MCP tab, for CLI clients and scripts.
 * Both end as a row in mcp_tokens holding a sha256 of the secret, a user, scopes and a mode.
 * The person's Supabase session is never handed to an AI client.
 */

export type Mode = 'read_only' | 'suggest' | 'full';
export const MODES: Record<Mode, string> = {
  read_only: 'Look only — it can inspect and render, never change anything',
  suggest: 'Ask me first — every change waits for your approval in the editor',
  full: 'Full control — it edits your projects directly (every edit is undoable)',
};
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export interface Principal {
  userId: string;
  clientId: string;
  clientName: string;
  tokenId: string;
  scopes: Scope[];
  mode: Mode;
  /** seconds since epoch; absent for a PAT with no expiry */
  expiresAt?: number;
}

const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_S = 10 * 60;
const REQUEST_TTL_S = 15 * 60;

export const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const secret = (prefix: string) => `blb_${prefix}_${randomBytes(32).toString('base64url')}`;
const inSeconds = (s: number) => new Date(Date.now() + s * 1000);
const live = (t: { revokedAt: Date | null; expiresAt: Date | null }) => !t.revokedAt && (!t.expiresAt || t.expiresAt > new Date());

export function normaliseScopes(requested: unknown): Scope[] {
  const list = Array.isArray(requested) ? requested.map(String) : typeof requested === 'string' ? requested.split(/\s+/) : [];
  const valid = list.filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
  return valid.length ? [...new Set(valid)] : ALL_SCOPES;
}
const modeOf = (m: unknown): Mode => (m === 'read_only' || m === 'suggest' ? m : 'full');

// ---------------------------------------------------------------------------
// personal access tokens

export const tokensService = {
  /** The secret is returned HERE and never again — only its hash is kept. */
  async createPat(userId: string, o: { name: string; scopes?: unknown; mode?: unknown; expiresInDays?: number }) {
    const token = secret('pat');
    const row = await mcpRepository.createToken({
      kind: 'pat', tokenHash: hash(token), userId, name: o.name.trim().slice(0, 80) || 'Personal token',
      scopes: normaliseScopes(o.scopes), mode: modeOf(o.mode),
      expiresAt: o.expiresInDays ? inSeconds(Math.min(365, Math.max(1, o.expiresInDays)) * 86400) : null,
    });
    return { token, meta: patMeta(row) };
  },

  /** A new secret for the same name, scopes and mode; the old one stops working now. */
  async rotatePat(userId: string, id: string) {
    const old = await mcpRepository.tokenById(id);
    if (!old || old.userId !== userId || old.kind !== 'pat' || !live(old)) throw HttpError.notFound('No such token');
    await mcpRepository.updateToken(id, { revokedAt: new Date() });
    const days = old.expiresAt ? Math.ceil((old.expiresAt.getTime() - old.createdAt.getTime()) / 86400000) : undefined;
    return tokensService.createPat(userId, { name: old.name, scopes: old.scopes, mode: old.mode, expiresInDays: days });
  },

  async revokePat(userId: string, id: string) {
    const t = await mcpRepository.tokenById(id);
    if (!t || t.userId !== userId || t.kind !== 'pat') throw HttpError.notFound('No such token');
    await mcpRepository.updateToken(id, { revokedAt: new Date() });
  },

  /** Disconnect an OAuth client: its code, access and refresh tokens all die together. */
  async revokeConnection(userId: string, grantId: string) {
    if (!(await mcpRepository.revokeGrantOf(grantId, userId))) throw HttpError.notFound('No such connection');
  },

  /** PATs and OAuth connections, metadata only — never a secret. */
  async list(userId: string) {
    const rows = await mcpRepository.liveCredentials(userId);
    const clients = new Map((await mcpRepository.clientsByIds([...new Set(rows.flatMap((r) => (r.clientId ? [r.clientId] : [])))])).map((c) => [c.clientId, c]));
    const grants = new Map<string, { grantId: string; clientId: string; clientName: string; scopes: string[]; mode: string; connectedAt: Date; lastUsedAt: Date | null }>();
    for (const r of rows.filter((x) => x.grantId && x.clientId)) {
      const g = grants.get(r.grantId!);
      const used = r.lastUsedAt && (!g?.lastUsedAt || r.lastUsedAt > g.lastUsedAt) ? r.lastUsedAt : g?.lastUsedAt ?? null;
      grants.set(r.grantId!, {
        grantId: r.grantId!, clientId: r.clientId!, clientName: clients.get(r.clientId!)?.clientName ?? 'AI client',
        scopes: r.scopes, mode: r.mode, connectedAt: g && g.connectedAt < r.createdAt ? g.connectedAt : r.createdAt, lastUsedAt: used,
      });
    }
    return { tokens: rows.filter((r) => r.kind === 'pat').map(patMeta), connections: [...grants.values()] };
  },

  /** Bearer → principal. Both OAuth access tokens and PATs land here. */
  async verify(bearer: string): Promise<Principal> {
    const t = await mcpRepository.tokenByHash(hash(bearer));
    if (!t || (t.kind !== 'access' && t.kind !== 'pat') || !live(t) || !t.userId) throw new InvalidTokenError('Invalid, expired or revoked token');
    // a write per request would be a write per tool call; once a minute is plenty for "last used"
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) void mcpRepository.updateToken(t.id, { lastUsedAt: new Date() }).catch(() => {});
    const client = t.clientId ? await mcpRepository.client(t.clientId) : null;
    return {
      userId: t.userId, clientId: t.clientId ?? `pat:${t.id}`, clientName: client?.clientName ?? (t.name || 'Personal token'),
      tokenId: t.id, scopes: normaliseScopes(t.scopes), mode: modeOf(t.mode),
      ...(t.expiresAt ? { expiresAt: Math.floor(t.expiresAt.getTime() / 1000) } : {}),
    };
  },
};

const patMeta = (r: { id: string; name: string; scopes: string[]; mode: string; expiresAt: Date | null; lastUsedAt: Date | null; createdAt: Date }) =>
  ({ id: r.id, name: r.name, scopes: r.scopes, mode: r.mode, expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt });

// ---------------------------------------------------------------------------
// consent: the page between an AI app's /authorize and its callback

export const consentService = {
  async describe(requestId: string) {
    const r = await mcpRepository.tokenById(requestId);
    if (!r || r.kind !== 'request' || !live(r)) throw HttpError.notFound('This connection request has expired. Start again from your AI app.');
    const client = await mcpRepository.client(r.clientId!);
    return {
      requestId, clientName: client?.clientName ?? 'An AI client', redirectHost: new URL(r.redirectUri!).host,
      scopes: r.scopes.map((s) => ({ scope: s, description: SCOPES[s as Scope] ?? s })), modes: MODES,
    };
  },

  /** Approve or deny. Either way the answer is a URL on the client's own redirect_uri. */
  async decide(requestId: string, userId: string, o: { approve: boolean; scopes?: unknown; mode?: unknown }) {
    const r = await mcpRepository.tokenById(requestId);
    if (!r || r.kind !== 'request' || !live(r)) throw HttpError.notFound('This connection request has expired. Start again from your AI app.');
    if (!(await mcpRepository.spend(r.id))) throw HttpError.conflict('This request was already answered.');
    const { state } = (r.params ?? {}) as { state?: string };
    const to = new URL(r.redirectUri!);
    if (state) to.searchParams.set('state', state);
    if (!o.approve) {
      to.searchParams.set('error', 'access_denied');
      to.searchParams.set('error_description', 'The person declined access');
      return { redirectTo: to.toString() };
    }
    // never more than the client asked for
    const scopes = normaliseScopes(o.scopes).filter((s) => r.scopes.includes(s));
    const code = secret('code');
    await mcpRepository.createToken({
      kind: 'code', tokenHash: hash(code), userId, clientId: r.clientId, grantId: randomUUID(),
      scopes: scopes.length ? scopes : r.scopes, mode: modeOf(o.mode), redirectUri: r.redirectUri, codeChallenge: r.codeChallenge,
      resource: r.resource, expiresAt: inSeconds(CODE_TTL_S),
    });
    to.searchParams.set('code', code);
    return { redirectTo: to.toString() };
  },
};

// ---------------------------------------------------------------------------
// the OAuth server, as the MCP SDK's router expects it

const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    const c = await mcpRepository.client(clientId);
    if (!c) return undefined;
    return { ...(c.metadata as object), client_id: c.clientId, client_name: c.clientName, redirect_uris: c.redirectUris, ...(c.clientSecretHash ? { client_secret: c.clientSecretHash } : {}) } as OAuthClientInformationFull;
  },
  async registerClient(info) {
    const clientId = `blb_client_${randomBytes(12).toString('base64url')}`;
    const { client_secret, redirect_uris, client_name, ...rest } = info;
    await mcpRepository.createClient({
      clientId,
      // A DCR client secret identifies an app registration; alone it grants nothing — a token
      // still needs the person's consent and the PKCE verifier. The SDK compares it verbatim,
      // so it is kept as issued.
      clientSecretHash: client_secret ?? null,
      clientName: (client_name ?? 'AI client').slice(0, 80),
      redirectUris: redirect_uris.map(String),
      metadata: rest as object,
    });
    return { ...info, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) };
  },
};

async function issue(o: { userId: string; clientId: string; grantId: string; scopes: string[]; mode: string; resource: string | null }): Promise<OAuthTokens> {
  const access = secret('at'), refresh = secret('rt');
  const common = { userId: o.userId, clientId: o.clientId, grantId: o.grantId, scopes: o.scopes, mode: o.mode, resource: o.resource };
  await mcpRepository.createToken({ ...common, kind: 'access', tokenHash: hash(access), expiresAt: inSeconds(ACCESS_TTL_S) });
  await mcpRepository.createToken({ ...common, kind: 'refresh', tokenHash: hash(refresh), expiresAt: inSeconds(REFRESH_TTL_S) });
  void mcpRepository.touchClient(o.clientId).catch(() => {});
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: o.scopes.join(' ') };
}

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() { return clientsStore; },

  /** Park the request and send the person to Blooby's consent page, signed in as themselves. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const row = await mcpRepository.createToken({
      kind: 'request', clientId: client.client_id, scopes: normaliseScopes(params.scopes), redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge, resource: params.resource?.toString() ?? null,
      params: { state: params.state ?? null }, expiresAt: inSeconds(REQUEST_TTL_S),
    });
    res.redirect(`${env.APP_URL}/connect?request=${row.id}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const t = await mcpRepository.tokenByHash(hash(code));
    if (!t || t.kind !== 'code' || t.clientId !== client.client_id || !live(t)) throw new InvalidGrantError('Invalid or expired authorization code');
    return t.codeChallenge!;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const t = await mcpRepository.tokenByHash(hash(code));
    if (!t || t.kind !== 'code' || t.clientId !== client.client_id || !live(t)) throw new InvalidGrantError('Invalid or expired authorization code');
    if (redirectUri && redirectUri !== t.redirectUri) throw new InvalidGrantError('redirect_uri does not match the authorization request');
    // single use: a replayed code revokes everything it ever minted
    if (!(await mcpRepository.spend(t.id))) { await mcpRepository.revokeGrant(t.grantId!); throw new InvalidGrantError('Authorization code already used'); }
    return issue({ userId: t.userId!, clientId: client.client_id, grantId: t.grantId!, scopes: t.scopes, mode: t.mode, resource: t.resource });
  },

  async exchangeRefreshToken(client, refreshToken, scopes) {
    const t = await mcpRepository.tokenByHash(hash(refreshToken));
    if (!t || t.kind !== 'refresh' || t.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token');
    // rotation with reuse detection: an old refresh token coming back means it leaked
    if (!live(t) || !(await mcpRepository.spend(t.id))) { if (t.grantId) await mcpRepository.revokeGrant(t.grantId); throw new InvalidGrantError('Refresh token already used or revoked'); }
    const narrowed = scopes?.length ? t.scopes.filter((s) => scopes.includes(s)) : t.scopes;
    return issue({ userId: t.userId!, clientId: client.client_id, grantId: t.grantId!, scopes: narrowed, mode: t.mode, resource: t.resource });
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const p = await tokensService.verify(token);
    // the SDK's bearer check requires an expiry; a PAT without one is good for a year at a time
    return { token, clientId: p.clientId, scopes: p.scopes, expiresAt: p.expiresAt ?? Math.floor(Date.now() / 1000) + 365 * 86400, extra: { principal: p } };
  },

  async revokeToken(client, request: OAuthTokenRevocationRequest) {
    const t = await mcpRepository.tokenByHash(hash(request.token));
    if (t && t.clientId === client.client_id && t.grantId) await mcpRepository.revokeGrant(t.grantId);
  },
};
