import { Router } from 'express';
import { authenticate, optionalAuth } from '../middlewares/authenticate.js';
import { authController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRoutes = Router();

authRoutes.get('/session', optionalAuth, asyncHandler(async (req, res) => { authController.session(req, res); }));
authRoutes.get('/profile', authenticate, asyncHandler(authController.profile));
authRoutes.post('/login-event', authenticate, asyncHandler(authController.touchLogin));
