import { NextRequest } from 'next/server'
import { cacheQuartersAsync } from '@/lib/cache'
import type { Store } from '@/lib/types'

export async function GET(req: NextRequest) {
  const store = (req.nextUrl.searchParams.get('store') ?? 'all') as Store
  const data  = await cacheQuartersAsync(store)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
