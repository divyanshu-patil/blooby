import type { Prisma } from '@prisma/client';

/**
 * Zod validates JSON payloads as `Record<string, unknown>`; Prisma wants `InputJsonValue`.
 * The two describe the same runtime value but do not overlap structurally, so the cast
 * lives here once instead of at every call site.
 */
export const toJson = (v: unknown) => v as Prisma.InputJsonValue;
