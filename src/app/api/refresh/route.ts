import { spawn } from 'child_process'
import { getCacheAsync } from '@/lib/cache'

// In-memory state (local dev only — serverless instances don't share this)
let isRunning = false
let startedAt: string | null = null

/**
 * Minimum gap between full cache rebuilds. A rebuild recomputes every dashboard
 * rollup and WRITES smoothieking.dashboard_cache, so it is expensive; the manual
 * Refresh button on the Overview is reachable by any signed-in user (managers
 * included, by design — it is their operating data). The `isRunning` flag below
 * cannot throttle production because serverless instances don't share memory, so
 * the real guard is this cooldown, measured against the persisted refreshedAt.
 */
const COOLDOWN_MS = 5 * 60 * 1000

/** Remaining cooldown in ms, or 0 when a rebuild is allowed. */
async function cooldownLeft(): Promise<number> {
  try {
    const c = await getCacheAsync()
    if (!c?.refreshedAt) return 0
    const age = Date.now() - new Date(c.refreshedAt).getTime()
    return age >= 0 && age < COOLDOWN_MS ? COOLDOWN_MS - age : 0
  } catch {
    return 0   // can't read the cache → don't block a legitimate refresh
  }
}

export async function GET() {
  return Response.json({ running: isRunning, startedAt })
}

export async function POST() {
  const wait = await cooldownLeft()
  if (wait > 0) {
    const mins = Math.ceil(wait / 60000)
    return Response.json({
      error: `Data was just refreshed — try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    })
  }

  // Vercel production: run refresh in-process, write result to Azure SQL
  if (process.env.VERCEL) {
    if (!process.env.AZURE_SQL_SERVER) {
      return Response.json(
        { error: 'AZURE_SQL_SERVER env var not set — add Azure SQL credentials in Vercel project settings' },
        { status: 503 },
      )
    }
    try {
      const { buildCacheData } = await import('@/lib/cache-builder')
      const { writeCacheToDb } = await import('@/lib/azure-cache')
      const { invalidateCacheMemory } = await import('@/lib/cache')
      const { expireDbCache } = await import('@/lib/db')

      const cache = await buildCacheData()
      // writeCacheToDb expects Cache type; the shape is identical
      await writeCacheToDb(cache as unknown as Parameters<typeof writeCacheToDb>[0])
      invalidateCacheMemory()
      await expireDbCache()

      return Response.json({
        status:      'refreshed',
        refreshedAt: cache.refreshedAt,
        message:     'Dashboard data updated — reload to see fresh data',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return Response.json({ error: `Refresh failed: ${msg}` }, { status: 500 })
    }
  }

  if (isRunning) return Response.json({ status: 'running', startedAt })

  isRunning = true
  startedAt = new Date().toISOString()

  // Rebuild the cached rollups from SQL. (This used to run `npm run sigma` first, but
  // no such script exists — it failed on every invocation and was swallowed by the `;`
  // separator. Sales/COGS now come from Azure SQL, so there is nothing to pre-fetch.)
  const child = spawn(
    'bash',
    ['-c', 'npm run refresh'],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, FORCE_COLOR: '0' },
    },
  )

  child.on('close', () => { isRunning = false })
  child.on('error', () => { isRunning = false })
  child.unref()

  return Response.json({ status: 'started' })
}
