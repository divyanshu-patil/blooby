import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { env } from './env.js';
import { prisma } from './prisma.js';

/**
 * Supabase signs access tokens with asymmetric keys published at the project's JWKS
 * endpoint, so verification is local (fetch + cache the public keys once) rather than a
 * round-trip to /auth/v1/user on every request. jwks-rsa handles the caching and the
 * rate limiting; `kid` on the token header selects the key.
 */
const jwks = new JwksClient({
  jwksUri: env.jwksUrl,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

const getKey = (header: JwtHeader, cb: SigningKeyCallback) => {
  jwks.getSigningKey(header.kid, (err, key) => cb(err, key?.getPublicKey()));
};

export interface AuthedRequest extends Request {
  userId?: string;
}

/** Verifies the bearer token and pins req.userId. 401 on anything unverifiable. */
export function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  jwt.verify(token, getKey, { algorithms: ['RS256', 'ES256'] }, (err, decoded) => {
    if (err || !decoded || typeof decoded === 'string') {
      return res.status(401).json({ error: 'invalid token' });
    }
    const sub = decoded.sub;
    if (!sub) return res.status(401).json({ error: 'token has no subject' });
    req.userId = sub;
    next();
  });
}

/**
 * Admin gate. Reads profiles.is_admin for the verified user — deliberately from the
 * database and not from a JWT claim, because app_metadata claims are only as trustworthy
 * as every code path that can write them, whereas this table has no write policy for
 * anon or authenticated at all.
 */
export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const profile = await prisma.profile.findUnique({ where: { id: req.userId! } });
  if (!profile?.isAdmin) return res.status(403).json({ error: 'admin only' });
  next();
}
