import { z } from 'zod';
import { paginationDto } from '../common.js';

export const createProjectDto = z.object({
  name: z.string().trim().min(1).max(120),
  /** Seed content: a blank project, a template asset, or an explicit project payload. */
  templateAssetId: z.string().uuid().optional(),
  project: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProjectDto = z.infer<typeof createProjectDto>;

export const updateProjectDto = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    visibility: z.enum(['private', 'public']).optional(),
    thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProjectDto = z.infer<typeof updateProjectDto>;

export const duplicateProjectDto = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

/** The autosave payload. `expectedVersion` is what makes concurrent saves safe. */
export const saveProjectDataDto = z.object({
  project: z.record(z.string(), z.unknown()),
  thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type SaveProjectDataDto = z.infer<typeof saveProjectDataDto>;

export const listProjectsDto = paginationDto.extend({
  sort: z.enum(['recent', 'created', 'name']).default('recent'),
});
export type ListProjectsDto = z.infer<typeof listProjectsDto>;
