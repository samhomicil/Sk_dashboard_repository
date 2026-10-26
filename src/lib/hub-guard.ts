import 'server-only'
import { createHash, timingSafeEqual } from 'crypto'

/**
 * The gate for /api/hub/* — the read-only feed Sam's agent hub (Nexus) calls server to
 * server so its alerts carry the same numbers Pulse's screens show.
 *
 * WHY ITS OWN TOKEN. Nexus has no user session. The hub routes are left out of proxy.ts's
 * session gate the way the cron routes are (/api/sync, /api/ingest-refresh), so this check
 * is the ONLY thing standing in front of them — and /api/hub/cash returns bank balances.
 * The agent tokens (lib/agentAuth.ts) are not reused: AGENT_TOKEN_OWNER opens every owner
 * route in the app, while HUB_TOKEN opens four read-only summaries. A leak of the narrow
 * token must not hand out the wide one, so a HUB_TOKEN equal to either agent token is
 * refused outright.
 *
 * NEVER A SESSION. These routes do not call auth(); a signed-in browser without the bearer
 * token gets the same 401 as anyone else.
 *
 * FAILS CLOSED. HUB_TOKEN unset, shorter than MIN_TOKEN_LEN, or doubling as an agent
 * token: every request is refused. Every refusal is the same bare 401, so a caller cannot
 * tell a misconfigured server from a wrong token.
 *
 *   export async function GET(req: Request) {
 *     const denied = requireHubToken(req); if (denied) return denied
 */

/** Same floor as the agent tokens: a short secret is how this kind of gate usually fails. */
const MIN_TOKEN_LEN = 32

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/** Constant-time compare. Hashing first gives both sides the same 32-byte length, so
 *  timingSafeEqual never throws and the compare leaks neither content nor length. */
function tokenMatches(presented: string, secret: string): boolean {
  return timingSafeEqual(digest(presented), digest(secret))
}

const unauthorized = () =>
  Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })

/** A 401 Response unless the request carries `Authorization: Bearer <HUB_TOKEN>`; null when
 *  it does. Call it first in every /api/hub handler. */
export function requireHubToken(req: Request): Response | null {
  const secret = process.env.HUB_TOKEN ?? ''
  if (secret.length < MIN_TOKEN_LEN) return unauthorized()
  if (secret === process.env.AGENT_TOKEN_OWNER || secret === process.env.AGENT_TOKEN_MANAGER) {
    return unauthorized()
  }
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(req.headers.get('authorization') ?? '')
  if (!m) return unauthorized()
  return tokenMatches(m[1], secret) ? null : unauthorized()
}
