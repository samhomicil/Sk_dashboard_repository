import { NextRequest } from 'next/server'
import { cacheStaffingAsync } from '@/lib/cache'
import { sigmaHeatmapWindow, sigmaHeatmapWeeklyWindow } from '@/lib/sigma'
import type { Period } from '@/lib/types'

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get('period') ?? 'weekly') as Period
  const data   = await cacheStaffingAsync(period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  // Weekly uses actual sales for its own week; Monthly/Quarterly/YTD use the
  // rolling 90-day average — see fetchStaffing in cache-builder.ts.
  const unitsWindow = period === 'weekly' ? sigmaHeatmapWeeklyWindow() : sigmaHeatmapWindow()
  return Response.json({ ...data, unitsWindowStart: unitsWindow?.start, unitsWindowEnd: unitsWindow?.end })
}
