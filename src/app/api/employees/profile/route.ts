import { NextRequest } from 'next/server'
import { getProfile } from '@/lib/employees'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function iso(d: Date) { return d.toISOString().slice(0, 10) }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const key = sp.get('key')
  if (!key) return Response.json({ error: 'key required' }, { status: 400 })

  const end = sp.get('end') ?? iso(new Date(Date.now() - 86400000))
  const start = sp.get('start') ?? iso(new Date(new Date(end).getTime() - 89 * 86400000))

  try {
    const data = await getProfile(key, start, end)
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ window: { start, end }, ...data })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
