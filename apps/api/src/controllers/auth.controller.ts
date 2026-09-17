import type { Request, Response } from 'express';
import { profilesRepository } from '../repositories/profiles.repository.js';
import { usersService } from '../services/users.service.js';

/** YYYY.MM.DD[.n], part by part as numbers — the same order the app's changelog uses. */
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
};

export const authController = {
  /** Who am I, according to the server. The frontend uses this rather than trusting its
   *  own decoded token for anything that gates behaviour. */
  session: (req: Request, res: Response) =>
    res.json({ user: req.user ?? null }),

  async profile(req: Request, res: Response) {
    const profile = await profilesRepository.findById(req.user!.id);
    const identity = await usersService.identitiesFor([req.user!.id]);
    res.json({ ...profile, ...identity.get(req.user!.id) });
  },

  /** What's New: the newest release this person has now seen. Never moves backwards. */
  async seenRelease(req: Request, res: Response) {
    const { version } = req.body as { version: string };
    const current = req.user!.lastSeenRelease;
    if (current && compareVersions(version, current) <= 0) { res.json({ lastSeenRelease: current }); return; }
    const p = await profilesRepository.setLastSeenRelease(req.user!.id, version);
    res.json({ lastSeenRelease: p.lastSeenRelease });
  },

  /** Records the sign-in so "active users" means something. Sign-out itself happens in
   *  Supabase on the client; there is no server session to destroy. */
  touchLogin: (req: Request, res: Response) =>
    usersService.touchLogin(req.user!.id).then((p) => res.json(p)),
};
