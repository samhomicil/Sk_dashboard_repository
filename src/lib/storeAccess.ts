import type { Store } from './types'

/**
 * Store scoping — which store(s) a signed-in person may see.
 *
 * Owners see every store. A store's own login (ops@ / admin@ on that store's domain) is
 * locked to that one store: every data route clamps its `store` to it, and any payload
 * that carries several stores is filtered down before it leaves the server. A manager who
 * can sign in but has NO store assignment sees no store data at all — fail closed, so a
 * new address added to ALLOWED_EMAILS never silently inherits the whole portfolio.
 *
 * Pure and dependency-free on purpose: proxy.ts (the middleware) imports it as well as the
 * route handlers, so the rule is written once.
 *
 * The map can be extended without a deploy of code — STORE_ACCESS, comma-separated
 * `email:store` pairs (e.g. `gm@example.com:pines`) — but Vercel only applies env changes
 * on the next deployment, like every other variable. Entries there are ADDED to the
 * defaults below and win on conflict.
 */

export type StoreKey = Exclude<Store, 'all'>

export const STORE_KEYS: readonly StoreKey[] = ['pines', 'miramar', 'margate']

/** Display names as they appear in the sales table and most payloads. */
export const STORE_NAME: Record<StoreKey, string> = {
  pines: 'Pines', miramar: 'Miramar', margate: 'Margate',
}

const DEFAULT_STORE_ACCESS: Record<string, StoreKey> = {
  'ops@smoothiekingmargate.com':   'margate',
  'admin@smoothiekingmargate.com': 'margate',
  'ops@smoothiekingmiramar.com':   'miramar',
  'admin@smoothiekingmiramar.com': 'miramar',
  'ops@smoothiekingpines.com':     'pines',
  'admin@smoothiekingpines.com':   'pines',
}

function isStoreKey(s: string): s is StoreKey {
  return (STORE_KEYS as readonly string[]).includes(s)
}

export function storeAccessMap(): Record<string, StoreKey> {
  const out: Record<string, StoreKey> = { ...DEFAULT_STORE_ACCESS }
  for (const pair of (process.env.STORE_ACCESS ?? '').split(',')) {
    const [email, store] = pair.split(':').map(s => s?.trim().toLowerCase())
    if (email && store && isStoreKey(store)) out[email] = store
  }
  return out
}

/**
 * 'all'   — unrestricted (owners, agent tokens)
 * a store — locked to that store
 * null    — signed in, but assigned to no store: no store data
 */
export type Scope = 'all' | StoreKey | null

export function scopeFor(email: string | null | undefined, owner: boolean): Scope {
  if (owner) return 'all'
  if (!email) return null
  return storeAccessMap()[email.trim().toLowerCase()] ?? null
}

/**
 * The store a request is allowed to read. Unrestricted callers get what they asked for
 * (default 'all'); a locked caller gets their own store no matter what was requested;
 * an unassigned caller gets null and must be refused.
 */
export function clampStore(requested: string | null | undefined, scope: Scope): Store | null {
  if (scope === null) return null
  if (scope !== 'all') return scope
  const r = (requested || 'all').toLowerCase()
  return r === 'all' || isStoreKey(r) ? (r as Store) : 'all'
}

/** Does a store label ('Pines', 'pines', '1392 - Pembroke Pines, FL' …) belong to `key`? */
export function isStore(label: string | null | undefined, key: StoreKey): boolean {
  if (!label) return false
  const l = label.toLowerCase()
  return l === key || l === STORE_NAME[key].toLowerCase()
}
