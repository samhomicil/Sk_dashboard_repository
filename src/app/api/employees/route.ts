import { NextRequest } from 'next/server'
import { cacheEmployeesAsync } from '@/lib/cache'
import type { Store, Period } from '@/lib/types'

export async function GET(req: NextRequest) {
  const store  = (req.nextUrl.searchParams.get('store')  ?? 'all')    as Store
  const period = (req.nextUrl.searchParams.get('period') ?? 'weekly') as Period
  const data   = await cacheEmployeesAsync(store, period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
