import { Router } from 'express';
import { authenticate, optionalAuth } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { writeLimiter } from '../middlewares/rateLimiter.js';
import { projectsController } from '../controllers/projects.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { createProjectDto, duplicateProjectDto, listProjectsDto, saveProjectDataDto, updateProjectDto } from '../dtos/projects/index.js';

export const projectsRoutes = Router();

const id = validate(uuidParam('id'), 'params');

projectsRoutes.get('/', authenticate, validate(listProjectsDto, 'query'), asyncHandler(projectsController.list));
projectsRoutes.post('/', authenticate, validate(createProjectDto), asyncHandler(projectsController.create));

// optionalAuth: a public project is readable signed-out; ownership is still checked in
// the service for everything private
projectsRoutes.get('/:id', optionalAuth, id, asyncHandler(projectsController.get));
projectsRoutes.patch('/:id', authenticate, id, validate(updateProjectDto), asyncHandler(projectsController.update));
projectsRoutes.delete('/:id', authenticate, id, asyncHandler(projectsController.remove));

projectsRoutes.post('/:id/duplicate', authenticate, id, validate(duplicateProjectDto), asyncHandler(projectsController.duplicate));
projectsRoutes.post('/:id/opened', authenticate, id, asyncHandler(projectsController.touchOpened));

projectsRoutes.get('/:id/data', optionalAuth, id, asyncHandler(projectsController.getData));
projectsRoutes.put('/:id/data', authenticate, writeLimiter, id, validate(saveProjectDataDto), asyncHandler(projectsController.save));
