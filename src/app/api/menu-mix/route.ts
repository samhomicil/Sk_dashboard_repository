import { NextRequest } from 'next/server'
import { getMenuMix } from '@/lib/menuMix'

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? 'l90d'
  const store  = req.nextUrl.searchParams.get('store')  ?? 'all'
  const data   = getMenuMix(period, store)
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
