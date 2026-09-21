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

/** Traffic is asked per app: the same paths exist in both and mean different things. */
export const trafficRangeDto = analyticsRangeDto.extend({
  app: z.enum(['web', 'admin']).default('web'),
});
export type TrafficRangeDto = z.infer<typeof trafficRangeDto>;
