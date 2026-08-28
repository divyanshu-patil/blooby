import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Supabase signs access tokens with asymmetric keys published at the project's JWKS
 * endpoint (this project uses ES256), so verification is local — fetch and cache the
 * public keys once — rather than a round-trip to /auth/v1/user on every request.
 */
const jwks = new JwksClient({
  jwksUri: env.SUPABASE_JWKS_URL,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

const getKey = (header: JwtHeader, cb: SigningKeyCallback) =>
  jwks.getSigningKey(header.kid, (err, key) => cb(err, key?.getPublicKey()));

const verify = (token: string) =>
  new Promise<jwt.JwtPayload>((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ['RS256', 'ES256'] }, (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string') return reject(HttpError.unauthorized('Invalid or expired session'));
      resolve(decoded);
    });
  });

const bearer = (req: Request) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/**
 * Verifies the token, then loads the profile to resolve the role.
 *
 * The role deliberately comes from the database and not from a JWT claim: app_metadata
 * is only as trustworthy as every code path that can write it, whereas public.profiles
 * has no insert/update policy for anon or authenticated at all.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) throw HttpError.unauthorized();

    const claims = await verify(token);
    if (!claims.sub) throw HttpError.unauthorized('Token has no subject');

    const profile = await prisma.profile.findUnique({ where: { id: claims.sub } });
    if (!profile) throw HttpError.unauthorized('No profile for this account');

    req.user = { id: profile.id, email: (claims.email as string | undefined) ?? null, role: profile.role };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Same as authenticate, but a missing token is not an error — the handler simply sees no
 * `req.user`. For endpoints that serve both signed-in and anonymous callers, like the
 * public community browse and the active splashscreen.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (!bearer(req)) return next();
  return authenticate(req, res, next);
}
