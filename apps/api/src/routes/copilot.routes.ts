import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { copilotController } from '../controllers/copilot.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { copilotChatDto } from '../dtos/copilot/index.js';

export const copilotRoutes = Router();
copilotRoutes.use(authenticate);

// what the editor may know: whether it can offer a key field, and whether the server has
// keys of its own. Never the keys, never how many.
copilotRoutes.get('/config', asyncHandler(copilotController.config));
copilotRoutes.post('/chat', validate(copilotChatDto), asyncHandler(copilotController.chat));
