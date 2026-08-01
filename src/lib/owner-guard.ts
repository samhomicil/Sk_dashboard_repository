import { auth, isOwner } from '@/auth'
import { redirect } from 'next/navigation'

/**
 * Server-side owner gate for financial API routes — defense-in-depth on top of
 * proxy.ts. Sensitive money data must never depend on the middleware running, so
 * every financial route calls this first. Returns a Response to send back when the
 * caller isn't an authenticated owner, or null when access is granted.
 *
 *   const gate = await requireOwner(); if (gate) return gate
 */
export async function requireOwner(): Promise<Response | null> {
  let email: string | null | undefined
  try {
    const session = await auth()
    email = session?.user?.email
  } catch {
    // Auth misconfigured / no secret → fail CLOSED (never serve financial data).
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!email) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!isOwner(email)) return Response.json({ error: 'forbidden' }, { status: 403 })
  return null
}

/**
 * Server-side owner gate for financial PAGES (server components). Redirects a
 * non-owner away before any owner-only page renders — defense-in-depth on top of
 * proxy.ts. Call at the top of the page: `await requireOwnerPage()`.
 */
export async function requireOwnerPage(): Promise<void> {
  let email: string | null | undefined
  try {
    const session = await auth()
    email = session?.user?.email
  } catch {
    redirect('/login')
  }
  if (!email) redirect('/login')
  if (!isOwner(email)) redirect('/')
}
