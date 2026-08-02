import { NextRequest } from 'next/server'
import { requireOwner } from '@/lib/owner-guard'
import { getProfile } from '@/lib/employees'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function iso(d: Date) { return d.toISOString().slice(0, 10) }

export async function GET(req: NextRequest) {
  // Fail CLOSED, independently of proxy.ts. A preview deployment without AUTH env
  // vars fails the middleware gate OPEN — which briefly served this route's full
  // roster, including minors' dates of birth and pay rates, on a public URL.
  // Employee PII must never depend on the middleware running.
  const gate = await requireOwner()
  if (gate) return gate

  const sp = req.nextUrl.searchParams
  const key = sp.get('key')
  if (!key) return Response.json({ error: 'key required' }, { status: 400 })

  const end = sp.get('end') ?? iso(new Date(Date.now() - 86400000))
  const start = sp.get('start') ?? iso(new Date(new Date(end).getTime() - 89 * 86400000))

  try {
    const data = await getProfile(key, start, end)
    if (!data) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ window: { start, end }, ...data })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
