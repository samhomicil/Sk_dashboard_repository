import { getPurchasingOverview } from '@/lib/purchasing'

export async function GET() {
  const data = getPurchasingOverview()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
