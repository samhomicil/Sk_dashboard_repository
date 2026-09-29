import { auth, isOwner } from '@/auth'
import { agentRole } from './agentAuth'
import { clampStore, scopeFor, type Scope } from './storeAccess'
import type { Store } from './types'

/**
 * Server-side store scoping for manager data routes — the in-handler half of the two
 * gates (proxy.ts clamps the `store` query param first; this re-derives it from the
 * session so a route is safe even if the middleware never ran, and so the in-process
 * sub-handler calls made by /api/dashboard are covered: they run inside the outer
 * request, so auth() still sees the real caller).
 *
 *   const s = await requireStore(p.get('store')); if (s instanceof Response) return s
 *   const store = s
 */
export async function currentScope(): Promise<Scope> {
  // Agent tokens keep their existing reach: the agent middleware applies its own
  // per-store row-level security before it ever calls these routes.
  if (await agentRole()) return 'all'
  try {
    const email = (await auth())?.user?.email
    return scopeFor(email, isOwner(email))
  } catch {
    return null   // auth misconfigured → fail closed
  }
}

const noStore = () =>
  Response.json({ error: 'forbidden', reason: 'no store is assigned to this login' }, { status: 403 })

/** The store this request may read, or a 403 Response. */
export async function requireStore(requested: string | null | undefined): Promise<Store | Response> {
  const store = clampStore(requested, await currentScope())
  return store ?? noStore()
}

/**
 * For routes whose payload spans every store: returns the scope so the handler can filter,
 * or a 403 Response for an unassigned login.
 */
export async function requireScope(): Promise<Exclude<Scope, null> | Response> {
  const scope = await currentScope()
  return scope ?? noStore()
}

/** For group-total routes that have no single-store version: owners/agents only. */
export async function requireAllStores(): Promise<Response | null> {
  const scope = await currentScope()
  if (scope === 'all') return null
  return Response.json(
    { error: 'forbidden', reason: 'group totals are not available to a single-store login' },
    { status: 403 },
  )
}
