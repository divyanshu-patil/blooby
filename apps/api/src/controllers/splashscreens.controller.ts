import type { Request, Response } from 'express';
import { splashscreenService } from '../services/splashscreen.service.js';
import type { CreateSplashscreenDto, UpdateSplashscreenDto } from '../dtos/splashscreens/index.js';

export const splashscreensController = {
  /** Public. Null is a normal answer and the client treats it as "no splash". */
  active: (_req: Request, res: Response) =>
    splashscreenService.active().then((s) => {
      res.set('Cache-Control', 'public, max-age=60');
      res.json(s);
    }),

  list: (_req: Request, res: Response) => splashscreenService.list().then((r) => res.json(r)),
  get: (req: Request, res: Response) => splashscreenService.get(req.params.id!).then((r) => res.json(r)),

  create: (req: Request, res: Response) =>
    splashscreenService.create(req.user!.id, req.body as CreateSplashscreenDto).then((r) => res.status(201).json(r)),

  update: (req: Request, res: Response) =>
    splashscreenService.update(req.params.id!, req.body as UpdateSplashscreenDto).then((r) => res.json(r)),

  publish: (req: Request, res: Response) => splashscreenService.publish(req.params.id!).then((r) => res.json(r)),
  unpublish: (req: Request, res: Response) => splashscreenService.unpublish(req.params.id!).then((r) => res.json(r)),
  remove: (req: Request, res: Response) => splashscreenService.remove(req.params.id!).then(() => res.status(204).end()),
};
