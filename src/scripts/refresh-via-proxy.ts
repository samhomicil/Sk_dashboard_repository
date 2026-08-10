/**
 * One-off cache rebuild that WRITES through the Flask SQL proxy.
 *
 * `npm run refresh` writes with a direct mssql pool, which Azure's firewall blocks from
 * a local machine — getAzurePool() swallows that and the script reports
 * "Azure SQL not configured". Reads already go through the proxy, so this builds the
 * same cache and persists it the same way, via the proxy.
 *
 * Needed because /api/kpis serves standard periods (weekly/monthly/...) from
 * smoothieking.dashboard_cache, NOT from the live sqlCogsPct — so a COGS code fix does
 * not reach the Overview until the cache is rebuilt.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
function loadEnvLocal() {
  const p = join(process.cwd(), '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [k, ...rest] = t.split('=')
    if (!(k in process.env)) process.env[k] = rest.join('=').trim()
  }
}
loadEnvLocal()
delete process.env.AZURE_SQL_SERVER   // force every read down the proxy path

async function main() {
  const { buildCacheData } = await import('../lib/cache-builder')
  const { query } = await import('../lib/db')
  console.log('building cache…')
  const cache = await buildCacheData()
  const json = JSON.stringify(cache)
  console.log(`built: ${(json.length / 1024).toFixed(0)} KB, refreshedAt ${cache.refreshedAt}`)
  for (const st of ['all', 'pines', 'miramar', 'margate'] as const) {
    const w = (cache.kpis as Record<string, Record<string, { cogsActualPct?: number | null; cogsTheoreticalPct?: number | null; cogsActualAsOf?: string | null }>>)[st]?.weekly
    const f = (v?: number | null) => v == null ? 'null' : (v * 100).toFixed(1) + '%'
    console.log(`  ${st.padEnd(8)} weekly actual ${f(w?.cogsActualPct).padStart(7)}  theoretical ${f(w?.cogsTheoreticalPct).padStart(7)}  asOf ${w?.cogsActualAsOf}`)
  }
  const esc = json.replace(/'/g, "''")
  await query(`
    IF EXISTS (SELECT 1 FROM smoothieking.dashboard_cache WHERE id = 1)
      UPDATE smoothieking.dashboard_cache SET cache_json = N'${esc}', refreshed_at = GETDATE() WHERE id = 1
    ELSE
      INSERT INTO smoothieking.dashboard_cache (id, cache_json, refreshed_at) VALUES (1, N'${esc}', GETDATE())`)
  console.log('written to smoothieking.dashboard_cache')
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
