import { NextRequest } from 'next/server'
import { getMenuMixDaypart } from '@/lib/menuMixDaypart'

export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store') ?? 'all'
  const data  = getMenuMixDaypart(store)
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
