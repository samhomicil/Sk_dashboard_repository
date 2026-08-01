import 'server-only'
import type { PrismaClient } from '@prisma/client'

// Prisma client for the sk_bills schema (bills, forecast, balances, cost plan).
// Separate from lib/db.ts `query()`, which hits the smoothieking schema raw.
// Both point at the same Azure SQL server. Returns null when DATABASE_URL is
// unset so non-financial routes never fail on a missing bills connection.

declare global {
  var __prisma: PrismaClient | undefined
}

export const isDbConfigured = () => !!process.env.DATABASE_URL

export function getPrisma(): PrismaClient | null {
  if (!isDbConfigured()) return null
  if (!globalThis.__prisma) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
      globalThis.__prisma = new PrismaClient()
    } catch (e) {
      console.error('[prisma] Failed to initialize PrismaClient:', e)
      return null
    }
  }
  return globalThis.__prisma
}
