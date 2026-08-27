import { Router } from 'express';
import { optionalAuth } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validateDto.js';
import { assetsController } from '../controllers/assets.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from '../dtos/common.js';
import { listAssetsDto } from '../dtos/assets/index.js';

/**
 * The community surface is the same asset browse with `source` pinned — one service, one
 * query, one set of cards. Kept as its own path because that is the URL shape the client
 * and the spec use, not because it is a different system.
 */
export const communityRoutes = Router();

const pin = (source: 'community' | 'official') => (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
  Object.defineProperty(req, 'query', { value: { ...req.query, source }, writable: true, configurable: true });
  next();
};

communityRoutes.get('/', optionalAuth, pin('community'), validate(listAssetsDto, 'query'), asyncHandler(assetsController.browse));
communityRoutes.get('/presets', optionalAuth, pin('community'), validate(listAssetsDto.extend({}), 'query'), asyncHandler(assetsController.browse));
communityRoutes.get('/expressions', optionalAuth, pin('community'), validate(listAssetsDto, 'query'), asyncHandler(assetsController.browse));
communityRoutes.get('/official', optionalAuth, pin('official'), validate(listAssetsDto, 'query'), asyncHandler(assetsController.browse));
communityRoutes.get('/:id', optionalAuth, validate(uuidParam('id'), 'params'), asyncHandler(assetsController.get));
