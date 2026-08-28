import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { validate } from '../middlewares/validateDto.js';
import { adminController } from '../controllers/admin.controller.js';
import { assetsController } from '../controllers/assets.controller.js';
import { splashscreensController } from '../controllers/splashscreens.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { analyticsRangeDto, listAdminProjectsDto, listUsersDto, updateUserRoleDto } from '../dtos/admin/index.js';
import { createAssetDto, listModerationDto, moderateAssetDto } from '../dtos/assets/index.js';
import { createSplashscreenDto, updateSplashscreenDto } from '../dtos/splashscreens/index.js';
import { copilotSettingsDto, createCopilotKeyDto } from '../dtos/copilot/index.js';
import { copilotController } from '../controllers/copilot.controller.js';

/**
 * The gate is applied once, to the whole router. A new admin endpoint therefore cannot be
 * added without authentication and the role check — there is no per-route opt-in to
 * forget, which is the failure mode this structure exists to prevent.
 */
export const adminRoutes = Router();
adminRoutes.use(authenticate, requireAdmin);

const id = validate(uuidParam('id'), 'params');

adminRoutes.get('/analytics', validate(analyticsRangeDto, 'query'), asyncHandler(adminController.analytics));

adminRoutes.get('/users', validate(listUsersDto, 'query'), asyncHandler(adminController.listUsers));
adminRoutes.get('/users/:id', id, asyncHandler(adminController.getUser));
adminRoutes.patch('/users/:id/role', id, validate(updateUserRoleDto), asyncHandler(adminController.setUserRole));

adminRoutes.get('/projects', validate(listAdminProjectsDto, 'query'), asyncHandler(adminController.listProjects));

adminRoutes.get('/community', validate(listModerationDto, 'query'), asyncHandler(adminController.moderationQueue));
adminRoutes.patch('/community/:id', id, validate(moderateAssetDto), asyncHandler(adminController.moderate));

// official content uses the same create service as a user's own, with the official flag
adminRoutes.post('/assets', validate(createAssetDto), asyncHandler(assetsController.createOfficial));

adminRoutes.get('/splashscreens', asyncHandler(async (req, res) => { await splashscreensController.list(req, res); }));
adminRoutes.post('/splashscreens', validate(createSplashscreenDto), asyncHandler(splashscreensController.create));
adminRoutes.get('/splashscreens/:id', id, asyncHandler(splashscreensController.get));
adminRoutes.patch('/splashscreens/:id', id, validate(updateSplashscreenDto), asyncHandler(splashscreensController.update));
adminRoutes.post('/splashscreens/:id/publish', id, asyncHandler(splashscreensController.publish));
adminRoutes.post('/splashscreens/:id/unpublish', id, asyncHandler(splashscreensController.unpublish));
adminRoutes.delete('/splashscreens/:id', id, asyncHandler(splashscreensController.remove));

// the copilot key pool. `secret` is never selected by these handlers — an admin manages
// keys by hint and label, and reads none of them back.
adminRoutes.get('/copilot', asyncHandler(copilotController.adminView));
adminRoutes.patch('/copilot', validate(copilotSettingsDto), asyncHandler(copilotController.setSettings));
adminRoutes.post('/copilot/keys', validate(createCopilotKeyDto), asyncHandler(copilotController.addKey));
adminRoutes.delete('/copilot/keys/:id', id, asyncHandler(copilotController.removeKey));
