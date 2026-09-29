import { NextRequest } from 'next/server'
import { cacheStaffingAsync } from '@/lib/cache'
import { loadHeatmapCache, sqlHeatmapWindow, sqlHeatmapWeeklyWindow } from '@/lib/heatmapCache'
import { requireScope } from '@/lib/store-guard'
import { STORE_KEYS } from '@/lib/storeAccess'
import type { Period, StaffingData } from '@/lib/types'

export async function GET(req: NextRequest) {
  const scope = await requireScope(); if (scope instanceof Response) return scope
  const period = (req.nextUrl.searchParams.get('period') ?? 'weekly') as Period
  const data   = await cacheStaffingAsync(period)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  // Keyed by store (who worked when, with names) — blank every store but the caller's.
  let scoped: StaffingData = data
  if (scope !== 'all') {
    scoped = { ...data }
    for (const k of STORE_KEYS) if (k !== scope) scoped[k] = []
  }
  // Weekly uses actual sales for its own week; Monthly/Quarterly/YTD use the
  // rolling 90-day average — see fetchStaffing in cache-builder.ts.
  await loadHeatmapCache()
  const unitsWindow = period === 'weekly' ? sqlHeatmapWeeklyWindow() : sqlHeatmapWindow()
  return Response.json({ ...scoped, unitsWindowStart: unitsWindow?.start, unitsWindowEnd: unitsWindow?.end })
}
