import { NextRequest } from 'next/server'
import { cachePromotionsAsync } from '@/lib/cache'
import type { Store } from '@/lib/types'
import { requireStore } from '@/lib/store-guard'

export async function GET(req: NextRequest) {
  const scoped = await requireStore(req.nextUrl.searchParams.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped as Store
  const data  = await cachePromotionsAsync(store)
  return Response.json(data)
}
