import { getPurchasingByVendor } from '@/lib/purchasing'

export async function GET() {
  const data = getPurchasingByVendor()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
