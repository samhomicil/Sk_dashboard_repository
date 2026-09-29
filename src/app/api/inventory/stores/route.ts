import { getPurchasingByStore } from '@/lib/purchasing'
import { requireScope } from '@/lib/store-guard'
import { STORE_KEYS } from '@/lib/storeAccess'

export async function GET() {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  const data = getPurchasingByStore()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  if (scope === 'all') return Response.json(data)
  // One column per store — zero every column but the caller's.
  const categoryByStore = data.categoryByStore.map(r => {
    const row = { ...r }
    for (const k of STORE_KEYS) if (k !== scope) row[k] = 0
    return row
  })
  return Response.json({ ...data, categoryByStore })
}
