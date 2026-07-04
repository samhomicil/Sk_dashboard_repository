import { PROXY_URL, STORE_CODES } from './config'
import type { Store } from './types'

export async function query<T = Record<string, unknown>[]>(sql: string): Promise<T> {
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
