import { buildOrderList, ORDER_STORES, type OrderStore } from '@/lib/orderList'
import { requireScope } from '@/lib/store-guard'
import { isStore } from '@/lib/storeAccess'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/inventory/order?store=Margate — one store's next order (read-only). */
export async function GET(req: Request) {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  const asked = new URL(req.url).searchParams.get('store')
  const store = ORDER_STORES.find(s => s.toLowerCase() === (asked || '').toLowerCase())
    ?? (scope === 'all' ? 'Margate' : ORDER_STORES.find(s => isStore(s, scope)))
  if (!store) return Response.json({ error: 'unknown_store' }, { status: 400 })
  if (scope !== 'all' && !isStore(store, scope)) return Response.json({ error: 'forbidden' }, { status: 403 })
  try {
    return Response.json(await buildOrderList(store as OrderStore))
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 })
  }
}
