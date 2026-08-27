import { Router } from 'express';
import { splashscreensController } from '../controllers/splashscreens.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Public: the one thing every app boot asks for, before any sign-in. */
export const splashscreensRoutes = Router();

splashscreensRoutes.get('/active', asyncHandler(async (req, res) => { await splashscreensController.active(req, res); }));
