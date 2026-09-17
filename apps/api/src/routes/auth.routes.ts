import { Router } from 'express';
import { authenticate, optionalAuth } from '../middlewares/authenticate.js';
import { authController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validateDto.js';
import { z } from 'zod';

/** a release version: YYYY.MM.DD, optionally .n */
const seenReleaseDto = z.object({ version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d{1,3})?$/) });

export const authRoutes = Router();

authRoutes.get('/session', optionalAuth, asyncHandler(async (req, res) => { authController.session(req, res); }));
authRoutes.get('/profile', authenticate, asyncHandler(authController.profile));
authRoutes.post('/login-event', authenticate, asyncHandler(authController.touchLogin));
authRoutes.put('/whats-new', authenticate, validate(seenReleaseDto), asyncHandler(authController.seenRelease));
