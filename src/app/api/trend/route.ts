import { NextRequest } from 'next/server'
import { cacheTrendAsync } from '@/lib/cache'
import type { Store, Period } from '@/lib/types'

export async function GET(req: NextRequest) {
  const store  = (req.nextUrl.searchParams.get('store')  ?? 'all')    as Store
  const period = (req.nextUrl.searchParams.get('period') ?? 'monthly') as Period
  const data   = await cacheTrendAsync(store, period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
