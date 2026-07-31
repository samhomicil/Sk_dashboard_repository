'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolveDateRange } from '@/lib/dates'
import type { Period } from '@/lib/types'
import type { PurchasingLive } from '@/lib/purchasingUtils'

// Shared inventory-module data hook. Reads the timeframe off the URL (?period / ?start / ?end)
// so every tab and the timeframe control stay in sync, and fetches the live windowed payload.
export function useInventoryData() {
  const sp = useSearchParams()
  const period = (sp.get('period') as Period) || 'quarterly'
  const start = sp.get('start') || ''
  const end = sp.get('end') || ''
  const window = resolveDateRange(period, start || undefined, end || undefined)

  const [data, setData] = useState<PurchasingLive | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams({ period })
    if (start) qs.set('start', start)
    if (end) qs.set('end', end)
    fetch(`/api/inventory/live?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setData(d.error ? null : d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period, start, end])

  return { data, loading, period, window }
}
