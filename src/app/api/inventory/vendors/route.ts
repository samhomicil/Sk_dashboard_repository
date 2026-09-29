import { getPurchasingByVendor } from '@/lib/purchasing'
import { requireAllStores } from '@/lib/store-guard'

export async function GET() {
  // Group totals with no single-store version — owners only.
  const gate = await requireAllStores(); if (gate) return gate
  const data = getPurchasingByVendor()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
