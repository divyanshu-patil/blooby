import { Router } from 'express';
import { authRoutes } from './auth.routes.js';
import { projectsRoutes } from './projects.routes.js';
import { assetsRoutes } from './assets.routes.js';
import { communityRoutes } from './community.routes.js';
import { splashscreensRoutes } from './splashscreens.routes.js';
import { adminRoutes } from './admin.routes.js';
import { copilotRoutes } from './copilot.routes.js';

export const routes = Router();

routes.use('/auth', authRoutes);
routes.use('/projects', projectsRoutes);
routes.use('/assets', assetsRoutes);
routes.use('/community', communityRoutes);
routes.use('/splashscreen', splashscreensRoutes);
routes.use('/admin', adminRoutes);
routes.use('/copilot', copilotRoutes);
