import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError.js';

/**
 * The single admin gate. Mounted once per admin router rather than repeated inside every
 * controller, so a new admin route cannot be added without it.
 *
 * Hiding admin UI in the frontend is presentation, not protection — a user typing /admin
 * by hand reaches the same API, and this is what actually stops them.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(HttpError.unauthorized());
  if (req.user.role !== 'admin') return next(HttpError.forbidden('This area is restricted to administrators'));
  next();
}
