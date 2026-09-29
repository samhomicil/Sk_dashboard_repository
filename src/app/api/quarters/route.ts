import { NextRequest } from 'next/server'
import { cacheQuartersAsync } from '@/lib/cache'
import type { Store } from '@/lib/types'
import { requireStore } from '@/lib/store-guard'

export async function GET(req: NextRequest) {
  const scoped = await requireStore(req.nextUrl.searchParams.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped as Store
  const data  = await cacheQuartersAsync(store)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
