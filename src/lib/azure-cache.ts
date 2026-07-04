import sql from 'mssql'
import type { Cache } from './cache'

const cfg: sql.config = {
  server:         process.env.AZURE_SQL_SERVER!,
  database:       process.env.AZURE_SQL_DATABASE ?? 'master',
  user:           process.env.AZURE_SQL_USER!,
  password:       process.env.AZURE_SQL_PASSWORD!,
  options:        { encrypt: true, trustServerCertificate: false },
  pool:           { max: 3, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 15000,
  requestTimeout:    30000,
}

let _pool: sql.ConnectionPool | null = null

export async function getAzurePool(): Promise<sql.ConnectionPool | null> {
  if (!process.env.AZURE_SQL_SERVER) return null
  try {
    if (_pool && _pool.connected) return _pool
    _pool = await new sql.ConnectionPool(cfg).connect()
    return _pool
  } catch {
    return null
  }
}

export async function readCacheFromDb(): Promise<Cache | null> {
  const p = await getAzurePool()
  if (!p) return null
  try {
    const r = await p.request().query(
      'SELECT TOP 1 cache_json FROM smoothieking.dashboard_cache ORDER BY refreshed_at DESC'
    )
    const row = r.recordset[0]
    if (!row?.cache_json) return null
    return JSON.parse(row.cache_json) as Cache
  } catch {
    return null
  }
}

export async function writeCacheToDb(cache: Cache): Promise<void> {
  const p = await getAzurePool()
  if (!p) return
  const json = JSON.stringify(cache)
  await p.request()
    .input('j', sql.NVarChar(sql.MAX), json)
    .query(`
      IF EXISTS (SELECT 1 FROM smoothieking.dashboard_cache WHERE id = 1)
        UPDATE smoothieking.dashboard_cache SET cache_json = @j, refreshed_at = GETDATE() WHERE id = 1
      ELSE
        INSERT INTO smoothieking.dashboard_cache (id, cache_json, refreshed_at) VALUES (1, @j, GETDATE())
    `)
}

export async function azureSqlQuery<T = Record<string, unknown>[]>(sql_str: string): Promise<T> {
  const p = await getAzurePool()
  if (!p) throw new Error('Azure SQL not configured')
  const r = await p.request().query(sql_str)
  return r.recordset as T
}
