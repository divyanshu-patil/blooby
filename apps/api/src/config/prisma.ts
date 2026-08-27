import { PrismaClient } from '@prisma/client';

/** One client per process — Prisma pools connections internally. */
export const prisma = new PrismaClient();
