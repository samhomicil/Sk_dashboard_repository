import { spawn } from 'child_process'

// In-memory state (local dev only — serverless instances don't share this)
let isRunning = false
let startedAt: string | null = null

export async function GET() {
  return Response.json({ running: isRunning, startedAt })
}

export async function POST() {
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
      const { writeCacheToDb, getAzurePool } = await import('@/lib/azure-cache')
      const { invalidateCacheMemory } = await import('@/lib/cache')

      const cache = await buildCacheData()
      // writeCacheToDb expects Cache type; the shape is identical
      await writeCacheToDb(cache as unknown as Parameters<typeof writeCacheToDb>[0])
      invalidateCacheMemory()

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

  // Run sigma (updates sigma-daily.json) then rebuild cache.json.
  // Semicolon separator: cache refresh runs even if sigma fails (e.g. missing credentials).
  const child = spawn(
    'bash',
    ['-c', 'npm run sigma; npm run refresh'],
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
