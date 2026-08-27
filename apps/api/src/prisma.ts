import { PrismaClient } from '@prisma/client';

/** One client for the process — Prisma pools connections internally. */
export const prisma = new PrismaClient();
