import { NextRequest } from 'next/server'
import { cacheStaffingAsync } from '@/lib/cache'
import { sigmaHeatmapWindow } from '@/lib/sigma'
import type { Period } from '@/lib/types'

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get('period') ?? 'weekly') as Period
  const data   = await cacheStaffingAsync(period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  const unitsWindow = sigmaHeatmapWindow()
  return Response.json({ ...data, unitsWindowStart: unitsWindow?.start, unitsWindowEnd: unitsWindow?.end })
}
