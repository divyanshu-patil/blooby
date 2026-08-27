import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { copilotChat } from '../services/copilot.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const copilotRoutes = Router();

copilotRoutes.post('/chat', authenticate, asyncHandler(copilotChat));
