import type { Request, Response } from 'express';
import { projectsService } from '../services/projects.service.js';
import type { CreateProjectDto, ListProjectsDto, ListPublicProjectsDto, SaveProjectDataDto, UpdateProjectDto } from '../dtos/projects/index.js';

/** Controllers stay thin: unwrap the validated request, call one service, shape a
 *  response. No business rules live here. */
export const projectsController = {
  list: (req: Request, res: Response) =>
    projectsService.list(req.user!.id, req.query as unknown as ListProjectsDto).then((r) => res.json(r)),

  listPublic: (req: Request, res: Response) =>
    projectsService.listPublic(req.query as unknown as ListPublicProjectsDto).then((r) => res.json(r)),

  create: (req: Request, res: Response) =>
    projectsService.create(req.user!.id, req.body as CreateProjectDto).then((p) => res.status(201).json(p)),

  get: (req: Request, res: Response) =>
    projectsService.get(req.params.id!, req.user?.id ?? null).then((p) => res.json(p)),

  update: (req: Request, res: Response) =>
    projectsService.update(req.params.id!, req.user!.id, req.body as UpdateProjectDto).then((p) => res.json(p)),

  remove: (req: Request, res: Response) =>
    projectsService.remove(req.params.id!, req.user!.id).then(() => res.status(204).end()),

  duplicate: (req: Request, res: Response) =>
    projectsService.duplicate(req.params.id!, req.user!.id, (req.body as { name?: string }).name).then((p) => res.status(201).json(p)),

  /**
   * The row and a presigned link — the browser fetches the document from the bucket
   * itself, so the payload never passes through here (projectsService.getDataUrl).
   *
   * `?inline=1` serves the document instead. It is the client's fallback for when the
   * direct fetch cannot happen: a bucket without CORS on it, or a link that has outlived
   * its hour in a tab left open. Slower, and the whole point is that it still works.
   */
  getData: (req: Request, res: Response) =>
    (req.query.inline === '1'
      ? projectsService.getData(req.params.id!, req.user?.id ?? null)
      : projectsService.getDataUrl(req.params.id!, req.user?.id ?? null)
    ).then((r) => res.json(r)),

  save: (req: Request, res: Response) =>
    projectsService.save(req.params.id!, req.user!.id, req.body as SaveProjectDataDto).then((r) => res.json(r)),

  touchOpened: (req: Request, res: Response) =>
    projectsService.touchOpened(req.params.id!, req.user!.id).then((p) => res.json(p)),
};
