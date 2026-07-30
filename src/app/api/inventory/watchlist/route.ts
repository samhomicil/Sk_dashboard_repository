import { buildOrderGuide } from '@/lib/orderGuide'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const data = await buildOrderGuide()
    if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 503 })
  }
}
