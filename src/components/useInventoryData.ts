'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolveDateRange } from '@/lib/dates'
import { swrGet, swrSet } from '@/lib/swrCache'
import type { Period } from '@/lib/types'
import type { PurchasingLive } from '@/lib/purchasingUtils'

// Shared inventory-module data hook. Reads the timeframe off the URL (?period / ?start / ?end)
// so every tab and the timeframe control stay in sync, and fetches the live windowed payload.
// Windows already fetched this session (even from another inventory tab) render instantly
// from swrCache while the fetch below revalidates them in the background.
export function useInventoryData() {
  const sp = useSearchParams()
  const period = (sp.get('period') as Period) || 'quarterly'
  const start = sp.get('start') || ''
  const end = sp.get('end') || ''
  const window = resolveDateRange(period, start || undefined, end || undefined)

  const qs = new URLSearchParams({ period })
  if (start) qs.set('start', start)
  if (end) qs.set('end', end)
  const key = `inv:${qs}`

  const [data, setData] = useState<PurchasingLive | null>(null)
  const [loading, setLoading] = useState(true)

  // Render-phase adjustment on timeframe change: show the cached payload (or a
  // loading state) immediately, without an effect-driven extra render.
  const [prevKey, setPrevKey] = useState('')
  if (prevKey !== key) {
    setPrevKey(key)
    const cached = swrGet<PurchasingLive>(key)
    setData(cached ?? data)
    setLoading(!cached)
  }

  useEffect(() => {
    let stale = false
    fetch(`/api/inventory/live?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const next = d.error ? null : d
        if (next) swrSet(key, next)
        if (!stale) {
          if (next) setData(next)
          setLoading(false)
        }
      })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading, period, window }
}
