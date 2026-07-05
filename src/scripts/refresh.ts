/**
 * Refresh script — run after loading new data:
 *   npm run refresh
 *
 * Queries Azure SQL (via proxy or direct connection), computes all dashboard
 * data, and writes data/cache.json.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { format } from 'date-fns'
import { PROXY_URL } from '../lib/config'
import { buildCacheData } from '../lib/cache-builder'
import { writeCacheToDb } from '../lib/azure-cache'

// tsx doesn't auto-load .env.local the way Next.js does — load it manually
// (same approach sigma-fetch.py uses) so local direct-DB writes actually work.
function loadEnvLocal() {
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (!(key in process.env)) process.env[key] = rest.join('=').trim()
  }
}
loadEnvLocal()

async function testConnection() {
  if (process.env.AZURE_SQL_SERVER) return  // mssql connects lazily on first query
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'SELECT 1 AS ok' }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
}

async function main() {
  const isProxy = !process.env.AZURE_SQL_SERVER
  console.log(isProxy ? `🔄 Connecting via proxy at ${PROXY_URL}` : '🔄 Using Azure SQL direct connection')

  try {
    await testConnection()
  } catch {
    console.error('❌ Cannot reach proxy at', PROXY_URL)
    console.error('   Start it with: python3 /Users/sam/azure-sql-proxy.py')
    process.exit(1)
  }
  console.log('✅ Connected\n⏳ Building cache...')

  const cache = await buildCacheData()

  mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(join(process.cwd(), 'data', 'cache.json'), JSON.stringify(cache, null, 2))

  // Production reads from smoothieking.dashboard_cache (see src/lib/cache.ts
  // getCacheAsync), not the deployed cache.json file — the DB row must be
  // updated directly or a fresh deploy silently has no effect on prod.
  if (process.env.AZURE_SQL_SERVER) {
    await writeCacheToDb(cache as unknown as Parameters<typeof writeCacheToDb>[0])
    console.log('✅ Cache written to Azure SQL (smoothieking.dashboard_cache)')
  } else {
    console.log('⚠️  AZURE_SQL_SERVER not set — skipped DB write; production will keep serving its last DB cache until this runs with DB credentials or the in-app Refresh button is used.')
  }

  console.log(`\n✅ Cache written — refreshed at: ${cache.refreshedAt}`)
}

main().catch(err => {
  console.error('\n❌ Refresh failed:', err.message)
  process.exit(1)
})
