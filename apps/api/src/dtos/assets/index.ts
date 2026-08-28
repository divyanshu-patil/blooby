import { z } from 'zod';
import { paginationDto } from '../common.js';

export const assetKind = z.enum(['preset', 'expression']);
export const assetSource = z.enum(['builtin', 'official', 'user', 'community']);

export const createAssetDto = z.object({
  kind: assetKind,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  thumbnailUrl: z.string().url().max(2048).optional(),
  schemaVersion: z.number().int().positive().default(1),
  data: z.record(z.string(), z.unknown()),
});
export type CreateAssetDto = z.infer<typeof createAssetDto>;

export const updateAssetDto = createAssetDto.partial().omit({ kind: true })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateAssetDto = z.infer<typeof updateAssetDto>;

/** A user submitting to the community supplies the listing metadata, not the status —
 *  the service decides that, so nobody can self-publish by posting `status`. */
export const submitToCommunityDto = z.object({
  description: z.string().trim().min(1).max(2000),
  category: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type SubmitToCommunityDto = z.infer<typeof submitToCommunityDto>;

export const listAssetsDto = paginationDto.extend({
  kind: assetKind.optional(),
  source: assetSource.optional(),
  category: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(30).optional(),
  sort: z.enum(['newest', 'popular', 'name']).default('newest'),
});
export type ListAssetsDto = z.infer<typeof listAssetsDto>;

/** Admin moderation. A rejection must carry a reason — that is the whole point of it. */
export const moderateAssetDto = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('unpublish') }),
  z.object({ action: z.literal('archive') }),
]);
export type ModerateAssetDto = z.infer<typeof moderateAssetDto>;

export const listModerationDto = paginationDto.extend({
  status: z.enum(['draft', 'pending_review', 'published', 'rejected', 'archived']).default('pending_review'),
});
