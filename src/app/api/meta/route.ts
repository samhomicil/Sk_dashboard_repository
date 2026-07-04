import { getCacheAsync } from '@/lib/cache'

export async function GET() {
  const c = await getCacheAsync()
  return Response.json({
    refreshedAt: c?.refreshedAt ?? null,
    hasCache:    c !== null,
  })
}
