import { z } from 'zod';

/** Cursor pagination everywhere: OFFSET degrades on deep pages, keyset does not. */
export const paginationDto = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().optional(),
  q: z.string().trim().max(120).optional(),
});
export type PaginationDto = z.infer<typeof paginationDto>;

export const uuidParam = (key: string) => z.object({ [key]: z.string().uuid() });

/**
 * The envelope every stored preset/expression/project payload carries (spec §37).
 * `data` stays unknown on purpose — the editor owns that shape and it evolves; this
 * layer's job is to guarantee the envelope so `schemaVersion` can drive migration later.
 */
export const contentEnvelope = z.object({
  schemaVersion: z.number().int().positive().default(1),
  data: z.unknown().refine((v) => v !== null && typeof v === 'object', 'data must be an object'),
});
