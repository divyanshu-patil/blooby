import { z } from 'zod';
import { paginationDto } from '../common.js';

export const updateUserRoleDto = z.object({ role: z.enum(['user', 'admin']) });
export type UpdateUserRoleDto = z.infer<typeof updateUserRoleDto>;

export const listUsersDto = paginationDto.extend({
  role: z.enum(['user', 'admin']).optional(),
});
export type ListUsersDto = z.infer<typeof listUsersDto>;

export const listAdminProjectsDto = paginationDto.extend({
  userId: z.string().uuid().optional(),
});

/** Analytics windows. Bounded to keep the aggregate queries cheap. */
export const analyticsRangeDto = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type AnalyticsRangeDto = z.infer<typeof analyticsRangeDto>;
