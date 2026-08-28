import type { Request, Response } from 'express';
import { profilesRepository } from '../repositories/profiles.repository.js';
import { usersService } from '../services/users.service.js';

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

  /** Records the sign-in so "active users" means something. Sign-out itself happens in
   *  Supabase on the client; there is no server session to destroy. */
  touchLogin: (req: Request, res: Response) =>
    usersService.touchLogin(req.user!.id).then((p) => res.json(p)),
};
