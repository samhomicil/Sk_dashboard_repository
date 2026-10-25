// Request-boundary validation for values that end up inside SQL text.
//
// The DB layer builds SQL as strings (db.ts query() takes text, not parameters), so a
// query-string value interpolated into a WHERE clause is an injection unless it has been
// pinned to a known shape first. `?start=2026-01-01' OR '1'='1` reached dateFilter() from
// /api/kpis and /api/daily unchecked. Every date a route reads from a request goes
// through here; `npm run check` refuses a route that reads start/end/pyStart/pyEnd
// straight off searchParams.
//
// Pure: no I/O, safe to import from route handlers, lib code and scripts alike.

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A real calendar date written YYYY-MM-DD. The shape alone is not enough: 2026-02-30
 * and 2026-13-01 match the pattern, then throw a RangeError (or silently roll over)
 * the first time anything does date arithmetic on them. The round trip through Date
 * rejects both.
 */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_SHAPE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function badRequest(reason: string): Response {
  return Response.json({ error: 'bad_request', reason }, { status: 400 })
}

/**
 * Read date query params by name. Each must be absent/empty or a real calendar date.
 * Returns the values — '' for an absent one, so callers keep their own defaults — or a
 * 400 Response naming the offending param.
 *
 *   const d = dateParams(sp, ['start', 'end']); if (d instanceof Response) return d
 *   const start = d.start || defaultStart
 */
export function dateParams<K extends string>(
  sp: URLSearchParams,
  names: readonly K[],
): Record<K, string> | Response {
  const out = {} as Record<K, string>
  for (const name of names) {
    const v = sp.get(name) ?? ''
    if (v !== '' && !isIsoDate(v)) return badRequest(`${name} must be a calendar date (YYYY-MM-DD)`)
    out[name] = v
  }
  return out
}
