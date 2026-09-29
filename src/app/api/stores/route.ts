import { NextRequest } from 'next/server'
import { cacheStoresAsync } from '@/lib/cache'
import { requireScope } from '@/lib/store-guard'
import { isStore } from '@/lib/storeAccess'
import type { Period } from '@/lib/types'

export async function GET(req: NextRequest) {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  const period = (req.nextUrl.searchParams.get('period') ?? 'weekly') as Period
  const data   = await cacheStoresAsync(period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  // One row per store — a store-locked login gets only its own row.
  return Response.json(scope === 'all' ? data : data.filter(r => isStore(r.store, scope)))
}
