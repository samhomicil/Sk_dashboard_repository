import { NextRequest } from 'next/server'
import { cachePromotionsAsync } from '@/lib/cache'
import type { Store } from '@/lib/types'

export async function GET(req: NextRequest) {
  const store = (req.nextUrl.searchParams.get('store') ?? 'all') as Store
  const data  = await cachePromotionsAsync(store)
  return Response.json(data)
}
