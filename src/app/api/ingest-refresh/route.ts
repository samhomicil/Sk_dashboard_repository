import { NextRequest } from 'next/server'
import { mkdirSync, writeFileSync, readdirSync, copyFileSync } from 'fs'
import { join } from 'path'

// Deploy path for the 6am cloud routine: its sandbox can only make HTTPS
// requests (raw TCP to Azure SQL is blocked there), so it POSTs the data
// files it fetched from Sigma here. We overlay them on the bundled data/
// directory in /tmp, rebuild the cache in-process (this runtime CAN reach
// Azure SQL), and write the result to smoothieking.dashboard_cache.
export const maxDuration = 300

const ALLOWED_FILES = new Set([
  'sigma-daily.json',
  'ee-periods.json',
  'ee-daily.json',
  'heatmap-weekly.json',
  'heatmap-daily.json',
  'menu-mix.json',
  'menu-mix-daypart.json',
  'employee-key-map.json',
])

export async function POST(req: NextRequest) {
  const secret = process.env.REFRESH_SECRET ?? process.env.AZURE_SQL_PASSWORD
  if (!secret || req.headers.get('x-refresh-key') !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.AZURE_SQL_SERVER) {
    return Response.json({ error: 'AZURE_SQL_SERVER not configured' }, { status: 503 })
  }

  let files: Record<string, unknown>
  try {
    const body = await req.json()
    files = body?.files
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('missing files object')
    const bad = Object.keys(files).filter(f => !ALLOWED_FILES.has(f))
    if (bad.length) throw new Error(`files not allowed: ${bad.join(', ')}`)
    for (const [name, content] of Object.entries(files)) {
      if (content === null || typeof content !== 'object') throw new Error(`${name}: content must be a JSON object`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `bad request: ${msg}` }, { status: 400 })
  }

  const bundled = join(process.cwd(), 'data')
  const overlay = join('/tmp', `skdata-${Date.now()}`)
  mkdirSync(overlay, { recursive: true })
  for (const f of readdirSync(bundled)) {
    if (f.endsWith('.json')) copyFileSync(join(bundled, f), join(overlay, f))
  }
  const applied: string[] = []
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(overlay, name), JSON.stringify(content))
    applied.push(name)
  }

  process.env.SK_DATA_DIR = overlay
  try {
    const { buildCacheData } = await import('@/lib/cache-builder')
    const { writeCacheToDb } = await import('@/lib/azure-cache')
    const { invalidateCacheMemory } = await import('@/lib/cache')

    const cache = await buildCacheData()
    if (!cache?.kpis?.all?.weekly || !(cache.kpis.all.weekly.sales > 0)) {
      return Response.json({ error: 'sanity check failed: rebuilt cache has no weekly sales — DB not updated' }, { status: 500 })
    }
    await writeCacheToDb(cache as unknown as Parameters<typeof writeCacheToDb>[0])
    invalidateCacheMemory()

    return Response.json({
      status:       'refreshed',
      refreshedAt:  cache.refreshedAt,
      filesApplied: applied,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `ingest-refresh failed: ${msg}` }, { status: 500 })
  } finally {
    delete process.env.SK_DATA_DIR
  }
}
