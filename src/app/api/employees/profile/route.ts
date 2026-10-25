import { NextRequest } from 'next/server'
import { requireScope } from '@/lib/store-guard'
import { dateParams } from '@/lib/core/params'
import { isStore } from '@/lib/storeAccess'
import { getProfile } from '@/lib/employees'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function iso(d: Date) { return d.toISOString().slice(0, 10) }

export async function GET(req: NextRequest) {
  // Fail CLOSED, independently of proxy.ts. A preview deployment without AUTH env
  // vars fails the middleware gate OPEN — which briefly served this route's full
  // roster, including minors' dates of birth and pay rates, on a public URL.
  // Employee PII must never depend on the middleware running.
  //
  // Managers may open a crew member's profile, pay included — they do the hiring
  // (Sam, 2026-09-29). A store's own login only for staff whose home store is theirs.
  const scope = await requireScope(); if (scope instanceof Response) return scope

  const sp = req.nextUrl.searchParams
  const key = sp.get('key')
  if (!key) return Response.json({ error: 'key required' }, { status: 400 })

  // Interpolated into SQL — accept calendar dates only.
  const d = dateParams(sp, ['start', 'end']); if (d instanceof Response) return d
  const end = d.end || iso(new Date(Date.now() - 86400000))
  const start = d.start || iso(new Date(new Date(end).getTime() - 89 * 86400000))

  try {
    const data = await getProfile(key, start, end)
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    // Same answer as a missing key, so a store login cannot probe other stores' staff.
    if (scope !== 'all' && !isStore(data.dim.homeStore, scope)) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    return Response.json({ window: { start, end }, ...data })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
