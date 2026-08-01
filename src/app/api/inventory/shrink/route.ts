import { NextRequest } from 'next/server'
import { buildShrink } from '@/lib/shrink'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const periodEnd = req.nextUrl.searchParams.get('periodEnd') ?? undefined
  try {
    const data = await buildShrink(periodEnd)
    if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
