import 'server-only';
import type { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const isDbConfigured = () => !!process.env.DATABASE_URL;

export function getPrisma(): PrismaClient | null {
  if (!isDbConfigured()) return null;
  if (!globalThis.__prisma) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
      globalThis.__prisma = new PrismaClient();
    } catch (e) {
      console.error('[db] Failed to initialize PrismaClient:', e);
      return null;
    }
  }
  return globalThis.__prisma;
}
