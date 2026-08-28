import { Router } from 'express';
import { authenticate, optionalAuth } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { assetsController } from '../controllers/assets.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { createAssetDto, listAssetsDto, submitToCommunityDto, updateAssetDto } from '../dtos/assets/index.js';

/** Presets and expressions share these routes — `kind` is a filter, not a second API. */
export const assetsRoutes = Router();

const id = validate(uuidParam('id'), 'params');

assetsRoutes.get('/', optionalAuth, validate(listAssetsDto, 'query'), asyncHandler(assetsController.browse));
assetsRoutes.get('/mine', authenticate, validate(listAssetsDto, 'query'), asyncHandler(assetsController.mine));
assetsRoutes.post('/', authenticate, validate(createAssetDto), asyncHandler(assetsController.create));

assetsRoutes.get('/:id', optionalAuth, id, asyncHandler(assetsController.get));
assetsRoutes.patch('/:id', authenticate, id, validate(updateAssetDto), asyncHandler(assetsController.update));
assetsRoutes.delete('/:id', authenticate, id, asyncHandler(assetsController.remove));

assetsRoutes.post('/:id/publish', authenticate, id, validate(submitToCommunityDto), asyncHandler(assetsController.submit));
assetsRoutes.post('/:id/use', optionalAuth, id, asyncHandler(assetsController.use));
