import { createHash } from 'crypto'
import { PROXY_URL, STORE_CODES } from './config'
import type { Store } from './types'

// Server-side result cache for SQL reads (Vercel Runtime Cache, in-memory locally).
// The underlying data changes via the 6am refresh + occasional manual edits, so reads
// are cached briefly and the refresh/sync routes expire the whole tag on write.
export const DB_CACHE_TAG = 'db'
const DB_CACHE_TTL_SECONDS = 900

interface RuntimeCache {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, opts?: { ttl?: number; tags?: string[]; name?: string }): Promise<void>
  expireTag(tag: string | string[]): Promise<void>
}

let _rc: RuntimeCache | null | undefined
async function runtimeCache(): Promise<RuntimeCache | null> {
  if (_rc !== undefined) return _rc
  try {
    const { getCache } = await import('@vercel/functions')
    _rc = getCache({ namespace: 'sql' }) as unknown as RuntimeCache
  } catch {
    _rc = null
  }
  return _rc
}

export async function expireDbCache(): Promise<void> {
  try {
    const c = await runtimeCache()
    await c?.expireTag(DB_CACHE_TAG)
  } catch {
    // cache unavailable — nothing to expire
  }
}

async function rawQuery<T>(sql: string): Promise<T> {
  if (process.env.AZURE_SQL_SERVER) {
    const { azureSqlQuery } = await import('./azure-cache')
    return azureSqlQuery<T>(sql)
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DB error: ${err}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.rows ?? data.results ?? data
}

export async function query<T = Record<string, unknown>[]>(sql: string): Promise<T> {
  const isRead = /^\s*(select|with)\b/i.test(sql)
  if (!isRead) {
    // Writes bypass the cache and expire cached reads so pages don't serve pre-write data.
    const out = await rawQuery<T>(sql)
    await expireDbCache()
    return out
  }
  const c = await runtimeCache()
  if (!c) return rawQuery<T>(sql)
  const key = createHash('sha256').update(sql).digest('hex')
  try {
    const hit = await c.get(key)
    if (hit !== undefined && hit !== null) return hit as T
  } catch {
    // treat a cache read failure as a miss
  }
  const rows = await rawQuery<T>(sql)
  try {
    await c.set(key, rows, { ttl: DB_CACHE_TTL_SECONDS, tags: [DB_CACHE_TAG], name: 'sql-query' })
  } catch {
    // oversized or unavailable — serve uncached
  }
  return rows
}

export function storeFilter(store: Store, tableAlias = ''): string {
  const col = tableAlias ? `${tableAlias}.store` : 'store'
  if (store === 'all') return '1=1'
  return `${col} = '${STORE_CODES[store]}'`
}

export function dateFilter(
  start: string,
  end: string,
  col = 'closed_datetime',
): string {
  return `CAST(${col} AS DATE) BETWEEN '${start}' AND '${end}'`
}
