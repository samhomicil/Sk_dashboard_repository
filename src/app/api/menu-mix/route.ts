import { NextRequest } from 'next/server'
import { getMenuMix } from '@/lib/menuMix'
import { requireStore } from '@/lib/store-guard'

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? 'l90d'
  const scoped = await requireStore(req.nextUrl.searchParams.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped
  const data   = getMenuMix(period, store)
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
