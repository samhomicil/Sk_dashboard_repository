/**
 * Promise.all keyed by NAME rather than position.
 *
 * This exists because of a bug that ran undetected in `app/api/ops-week/route.ts`:
 * a nine-element `Promise.all` was destructured positionally as
 * `[salesWeek, salesHist, salesPY, ...]` while the array was ordered
 * `[this week, prior year, history, ...]`. Prior-year totals landed in the history slot
 * and vice versa.
 *
 * Nothing failed. Nothing threw. `tsc` was satisfied, because both queries returned
 * `SalesRow[]`. The only visible symptom was a "—" in the PY column — while the
 * same-weekday sales forecast was quietly being built from LAST YEAR'S week, which in
 * turn sizes the PFG order targets on that page. Margate's next-week forecast came out
 * 31% low ($6,389 against a real $8,344).
 *
 * Binding by key makes that class of mistake unrepresentable: reordering the object
 * literal cannot change which value each name receives.
 *
 * Use this instead of positional destructuring whenever a `Promise.all` has several
 * entries, and especially when two of them share a row type.
 */
export async function allKeyed<T extends Record<string, Promise<unknown>>>(
  obj: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(obj) as (keyof T)[]
  const settled = await Promise.all(keys.map(k => obj[k]))
  return Object.fromEntries(keys.map((k, i) => [k, settled[i]])) as { [K in keyof T]: Awaited<T[K]> }
}
