import { NextRequest } from 'next/server'
import { getMenuMixDaypart } from '@/lib/menuMixDaypart'
import { requireStore } from '@/lib/store-guard'

export async function GET(req: NextRequest) {
  const scoped = await requireStore(req.nextUrl.searchParams.get('store')); if (scoped instanceof Response) return scoped
  const store = scoped
  const data  = await getMenuMixDaypart(store)
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
