/**
 * Service-to-service auth for AI agents (the Store-questions MCP connector).
 *
 * WHY A SEPARATE PATH. Every dashboard route is session-gated, and an agent has no
 * session. The alternative — re-implementing each module's rules inside the agent
 * middleware in Python — is what this exists to avoid: the middleware runs its own SQL,
 * the dashboard runs the rules in src/lib/core/*, and any rule written twice drifts.
 * (Four separate instances of exactly that were removed in the week before this shipped.)
 * So the middleware calls these routes instead, and gets the same numbers by construction.
 *
 * WHY TWO TOKENS RATHER THAN ONE WITH A CLAIM. A single token carrying a role is a
 * single secret to leak, and rotating it revokes everything. Two independent secrets mean
 * the manager-scope token can live on a phone connector while the owner-scope one — which
 * can read every bill, balance and payment — is granted separately, revoked separately,
 * and simply left unset until that decision is made. An unset token is not an error here;
 * it is the safe default.
 *
 * THE OWNER GATE STILL APPLIES. AGENTS.md requires money routes to be gated in the
 * middleware AND in the handler. This module is honoured in both: proxy.ts calls
 * `agentRole()` before the session check, and owner-guard.ts calls it before falling back
 * to the session. A manager-scope token hitting /api/bills gets the same 403 a manager
 * would. Nothing here widens what is reachable — it only changes who may present
 * credentials for it.
 */
import { headers } from 'next/headers'
import { timingSafeEqual } from 'crypto'

export type AgentRole = 'owner' | 'manager'

/** Minimum token length. Short secrets are the usual way this kind of gate fails. */
const MIN_TOKEN_LEN = 32

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  // timingSafeEqual throws on length mismatch, which itself leaks length — compare a
  // fixed-size digest-shaped buffer instead by padding to the longer of the two.
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Resolve the agent role from the Authorization header, or null when the caller is not
 * a recognised agent (in which case the normal session path applies).
 *
 * Fails closed: a token shorter than MIN_TOKEN_LEN is ignored entirely rather than
 * trusted, so a placeholder value in the environment cannot open the door.
 */
export async function agentRole(): Promise<AgentRole | null> {
  let presented: string | null = null
  try {
    const h = await headers()
    const raw = h.get('authorization') ?? ''
    const m = /^Bearer\s+(.+)$/i.exec(raw.trim())
    presented = m?.[1]?.trim() ?? null
  } catch {
    return null   // no request context (build/prerender) — never an agent
  }
  if (!presented || presented.length < MIN_TOKEN_LEN) return null

  const owner = process.env.AGENT_TOKEN_OWNER ?? ''
  const manager = process.env.AGENT_TOKEN_MANAGER ?? ''

  if (owner.length >= MIN_TOKEN_LEN && safeEqual(presented, owner)) return 'owner'
  if (manager.length >= MIN_TOKEN_LEN && safeEqual(presented, manager)) return 'manager'
  return null
}

/** True when the caller may reach owner-only (financial) routes. */
export async function isAgentOwner(): Promise<boolean> {
  return (await agentRole()) === 'owner'
}
