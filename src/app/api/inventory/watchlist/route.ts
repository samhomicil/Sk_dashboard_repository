import { getWatchlist } from '@/lib/inventoryWatchlist'

export async function GET() {
  const data = getWatchlist()
  if (!data) return Response.json({ error: 'no_data' }, { status: 503 })
  return Response.json(data)
}
