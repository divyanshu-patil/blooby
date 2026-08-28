import { z } from 'zod';

export const createSplashscreenDto = z.object({
  name: z.string().trim().min(1).max(120),
  /** The animation payload — normally a project or preset exported from the editor. */
  data: z.record(z.string(), z.unknown()),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0b0b0f').default('#0b0b0f'),
  durationMs: z.number().int().min(200).max(15_000).default(2000),
  fadeMs: z.number().int().min(0).max(5000).default(400),
});
export type CreateSplashscreenDto = z.infer<typeof createSplashscreenDto>;

export const updateSplashscreenDto = createSplashscreenDto.partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateSplashscreenDto = z.infer<typeof updateSplashscreenDto>;
