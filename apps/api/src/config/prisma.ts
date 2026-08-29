import { PrismaClient } from '@prisma/client';

/**
 * One client per process — Prisma pools connections internally.
 *
 * Cached on globalThis because `tsx watch` re-evaluates this module on every save while
 * the process lives on. A fresh PrismaClient each time meant a fresh connection pool each
 * time, with the old one still holding its connections open: a few saves was enough to
 * exhaust the pooler and turn every request into EMAXCONNSESSION.
 */
const cache = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = cache.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') cache.prisma = prisma;
