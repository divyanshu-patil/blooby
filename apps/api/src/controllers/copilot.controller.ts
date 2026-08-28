import type { Request, Response } from 'express';
import { copilotService } from '../services/copilot.service.js';
import type { CopilotChatDto, CopilotSettingsDto, CreateCopilotKeyDto } from '../dtos/copilot/index.js';

export const copilotController = {
  chat: (req: Request, res: Response) =>
    copilotService.chat(req.body as CopilotChatDto).then((r) => res.json(r)),

  /** Any signed-in user: two booleans, so the editor knows what to offer. */
  config: (_req: Request, res: Response) => copilotService.config().then((r) => res.json(r)),

  adminView: (_req: Request, res: Response) => copilotService.adminView().then((r) => res.json(r)),

  setSettings: (req: Request, res: Response) =>
    copilotService.setAllowUserKeys((req.body as CopilotSettingsDto).allowUserKeys)
      .then(() => copilotService.adminView())
      .then((r) => res.json(r)),

  addKey: (req: Request, res: Response) =>
    copilotService.addKey(req.user!.id, req.body as CreateCopilotKeyDto).then((r) => res.status(201).json(r)),

  removeKey: (req: Request, res: Response) =>
    copilotService.removeKey(req.params.id!).then(() => res.status(204).end()),
};
