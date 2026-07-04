import { NextRequest } from 'next/server'
import { cacheDailyAsync } from '@/lib/cache'
import { sigmaDailyFull, sigmaEEDailyPct, sigmaLaborDay } from '@/lib/sigma'
import type { Store, DailyRow } from '@/lib/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function buildRange(store: Store, start: string, end: string): Promise<DailyRow[]> {
  const sigMap = sigmaDailyFull(store, start, end)
  const rows: DailyRow[] = []
  const endDate = new Date(end + 'T00:00:00')

  for (let d = new Date(start + 'T00:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr    = d.toISOString().slice(0, 10)
    const sig        = sigMap.get(dateStr)
    const laborData  = sigmaLaborDay(store, dateStr)

    rows.push({
      date:        dateStr,
      day:         DAY_LABELS[d.getDay()],
      sales:       sig ? sig.net_sales : null,
      orders:      sig ? sig.orders    : null,
      eePct:       sigmaEEDailyPct(store, dateStr),
      voidPct:     sig && sig.gross_sales > 0 ? sig.voids_amount / sig.gross_sales : null,
      atv:         sig && sig.orders > 0 ? sig.net_sales / sig.orders : null,
      discountPct: sig && sig.gross_sales > 0
        ? Math.max(0, sig.gross_sales - sig.net_sales - sig.voids_amount) / sig.gross_sales
        : null,
      laborPct:    sig && sig.net_sales > 0 && laborData.labor > 0 ? laborData.labor / sig.net_sales : null,
      laborCost:   laborData.labor > 0 ? laborData.labor : null,
      laborHours:  laborData.hours > 0 ? laborData.hours : null,
    })
  }
  return rows
}

export async function GET(req: NextRequest) {
  const p       = req.nextUrl.searchParams
  const store   = (p.get('store')   ?? 'all') as Store
  const start   = p.get('start')   ?? ''
  const end     = p.get('end')     ?? ''
  const pyStart = p.get('pyStart') ?? ''
  const pyEnd   = p.get('pyEnd')   ?? ''

  if (start && end) {
    const [current, py] = await Promise.all([
      buildRange(store, start, end),
      pyStart && pyEnd ? buildRange(store, pyStart, pyEnd) : Promise.resolve([] as DailyRow[]),
    ])
    return Response.json({ current, py })
  }

  // Fallback: cached weekly sparklines (no date params)
  const data = await cacheDailyAsync(store)
  if (!data) return Response.json({ error: 'no_cache' }, { status: 503 })
  return Response.json(data)
}
