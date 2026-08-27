import type { Request, Response } from 'express';
import { assetsService } from '../services/assets.service.js';
import type { CreateAssetDto, ListAssetsDto, ModerateAssetDto, SubmitToCommunityDto, UpdateAssetDto } from '../dtos/assets/index.js';

export const assetsController = {
  browse: (req: Request, res: Response) =>
    assetsService.browse(req.query as unknown as ListAssetsDto, req.user?.id ?? null).then((r) => res.json(r)),

  mine: (req: Request, res: Response) =>
    assetsService.mine(req.user!.id, req.query as unknown as ListAssetsDto).then((r) => res.json(r)),

  get: (req: Request, res: Response) =>
    assetsService.get(req.params.id!, req.user?.id ?? null, req.user?.role ?? 'user').then((a) => res.json(a)),

  create: (req: Request, res: Response) =>
    assetsService.create(req.user!.id, req.user!.role, req.body as CreateAssetDto).then((a) => res.status(201).json(a)),

  /** Same service call, official flag on — the admin path is a capability, not a fork. */
  createOfficial: (req: Request, res: Response) =>
    assetsService.create(req.user!.id, req.user!.role, req.body as CreateAssetDto, true).then((a) => res.status(201).json(a)),

  update: (req: Request, res: Response) =>
    assetsService.update(req.params.id!, req.user!.id, req.user!.role, req.body as UpdateAssetDto).then((a) => res.json(a)),

  remove: (req: Request, res: Response) =>
    assetsService.remove(req.params.id!, req.user!.id, req.user!.role).then(() => res.status(204).end()),

  submit: (req: Request, res: Response) =>
    assetsService.submitToCommunity(req.params.id!, req.user!.id, req.body as SubmitToCommunityDto).then((a) => res.json(a)),

  moderate: (req: Request, res: Response) =>
    assetsService.moderate(req.params.id!, req.user!.id, req.body as ModerateAssetDto).then((a) => res.json(a)),

  use: (req: Request, res: Response) => assetsService.use(req.params.id!).then((a) => res.json({ downloadCount: a.downloadCount })),
};
