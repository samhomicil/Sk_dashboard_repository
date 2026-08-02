/**
 * Canonical employee identity — the SINGLE way to key a person across sources.
 *
 * Employee names arrive in three shapes across the stack:
 *   smoothieking.labor, labor_schedule   -> "Last, First"
 *   smoothieking.sales, tillhistory, jolt -> "First Last"
 *   tillhistory (Apr-May 2026 only)       -> "Last, First"   <- format flipped mid-year
 *
 * `empKey` normalises all of them to `last|first`, lowercased. Measured match rates
 * against smoothieking.labor (June 2026 onward):
 *   tillhistory   35/35  (100%)  - the Apr-May flip collapses correctly
 *   sales         26/27  ( 96%)  - the one miss is the "Support (DO NOT DELETE)" placeholder
 *   labor_schedule 33/36 ( 92%)
 *   jolt          13/15  ( 87%)
 *
 * The residual is nickname/spelling drift ("Madaffari, Dan" vs "Daniel",
 * "Vasquez-" vs "Vasques-Escobar", "Tome, Isabelle" vs "Isabella"). Those are
 * resolved by an explicit alias table, never by fuzzy matching — merging two people
 * on edit distance would attribute one person's till shortage to another.
 *
 * This was previously inlined in cache-builder.fetchEmployeeEE; it lives here so every
 * surface keys people the same way.
 */

/** Normalise any source spelling to the canonical `last|first` key. */
export function empKey(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  let last: string, first: string
  if (s.includes(',')) {
    const [l, ...f] = s.split(',')
    last = l.trim()
    first = f.join(',').trim()
  } else {
    const parts = s.split(/\s+/)
    if (parts.length < 2) return null
    // "First Last", "First Last-Hyphen", "James Jean Baptiste" -> first token is the
    // given name, the remainder is the surname (matches how labor stores "Jean Baptiste, James").
    first = parts[0]
    last = parts.slice(1).join(' ')
  }
  if (!last || !first) return null
  return `${last.toLowerCase()}|${first.toLowerCase()}`
}

/** Same key, when the source already gives you the name split into parts. */
export function keyFromParts(last: string, first: string): string {
  return `${last.trim().toLowerCase()}|${first.trim().toLowerCase()}`
}

/** Display form ("First Last") from a canonical key. */
export function keyToName(key: string): string {
  const [last, first] = key.split('|')
  return [first, last].filter(Boolean).map(titleCase).join(' ')
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, c => c.toUpperCase())
}

/**
 * Non-crew records that must never appear in an employee-facing surface:
 * the IT "Support" login, the NON_EMP system placeholder, and the EOD Till
 * pseudo-employee that tillhistory books its end-of-day drawer against.
 * Role-based exclusion lives in core/targets.ts LABOR_EXCLUDE_ROLES; this catches
 * the ones that are identified by NAME rather than by role.
 */
const EXCLUDED_KEYS = new Set([
  'support (do not delete)|support',
  'eod till|eod',
])

export function isRealEmployee(key: string | null): key is string {
  if (!key) return false
  if (EXCLUDED_KEYS.has(key)) return false
  if (key.startsWith('support (do not delete)')) return false
  if (key.includes('eod till')) return false
  return true
}

/**
 * The key with alias drift resolved — USE THIS for any cross-table join.
 *
 * Two active people are spelled differently by different Brink reports:
 *   labor_schedule "Vasquez-Escobar" vs labor "Vasques-Escobar"
 *   labor_schedule "Madaffari, Dan"  vs labor "Madaffari, Daniel"
 * Joining on the raw key silently drops those matches. On the attendance join that does
 * not read as a missing row — it reads as a NO-SHOW, i.e. an accusation, against someone
 * who worked their shift. Always resolve before joining.
 */
export function resolvedKeySql(col: string): string {
  const k = empKeySql(col)
  return `COALESCE((SELECT TOP 1 a.employee_key FROM smoothieking.employee_alias a
                    WHERE a.alias = ${k}), ${k})`
}

/** SQL fragment producing the same `last|first` key server-side, for GROUP BY / JOIN. */
export function empKeySql(col: string): string {
  return `LOWER(CASE WHEN CHARINDEX(',', ${col}) > 0
      THEN LTRIM(RTRIM(LEFT(${col}, CHARINDEX(',', ${col}) - 1))) + '|' +
           LTRIM(RTRIM(SUBSTRING(${col}, CHARINDEX(',', ${col}) + 1, 200)))
      ELSE LTRIM(RTRIM(SUBSTRING(${col}, CHARINDEX(' ', ${col} + ' ') + 1, 200))) + '|' +
           LTRIM(RTRIM(LEFT(${col}, CHARINDEX(' ', ${col} + ' ') - 1)))
    END)`
}
