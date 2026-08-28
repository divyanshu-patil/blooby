import type { UserRole } from '@prisma/client';

/** What `authenticate` attaches. Declared globally so controllers read `req.user`
 *  without casting. */
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string | null; role: UserRole };
    }
  }
}

export {};
