import { getPurchasingByStore } from '@/lib/purchasing'

export async function GET() {
  const data = getPurchasingByStore()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
