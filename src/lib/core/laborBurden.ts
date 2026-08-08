// Employer payroll burden — the real employer cost stacked on top of gross wages,
// the labor equivalent of the shared targets. Replaces the old flat 11%.
//
//   • FICA (employer) 7.65% — Social Security 6.2% + Medicare 1.45%. Uncapped in
//     practice (nobody here approaches the $168k SS wage base).
//   • FUTA 0.6% (net of the 5.4% state credit) on each employee's first $7,000 of
//     CALENDAR-year wages.
//   • FL reemployment tax (SUTA) — experience-rated, on the same first $7,000.
//   • Workers' comp — restaurant class rate applied to payroll (not a fixed bill;
//     the Lockton bills are general/umbrella only, so WC is not double-counted).
//
// The $7k cap barely front-loads THIS roster: it's mostly part-time, so ~85-90% of
// wages stay FUTA/SUTA-taxable all year (few employees ever reach $7k). The
// per-employee cap logic below captures that exactly — verified against live YTD
// wages 2026-08. SUTA & WC are employer-specific — CONFIRM the per-store rates.

export const FICA_RATE = 0.0765
export const FUTA_RATE = 0.006          // net of the 5.4% state credit
export const WAGE_CAP = 7000            // FUTA & FL reemployment calendar-year base

// Per-store employer rates. Each store is a separate FL employer (own experience
// rating), so the SUTA rate can differ. CONFIRM with the owner / the FL RT-20 and
// the WC policy before treating these as exact.
// Confirmed against the ADP Payroll Liability statement (7/17/2026, reconciled to
// the debit to the penny): FL SUI = 2.7000% (new-employer default), WC = ~2.2% of
// gross (ADP Pay-by-Pay). Update per store if an RT-20 experience rate differs.
export const SUTA_RATE: Record<string, number> = { Pines: 0.027, Miramar: 0.027, Margate: 0.027 }
export const WC_RATE:   Record<string, number> = { Pines: 0.022, Miramar: 0.022, Margate: 0.022 }

// Tips: credit-card tips run through payroll as taxable wages — the house keeps
// 15%, so 85% is paid out and taxed. Employer burden applies to that 85% too.
export const TIP_PAYOUT = 0.85

/** Employer burden $ on one employee's wage for a period, given their CALENDAR-year
 *  wages BEFORE this period (so the $7k FUTA/SUTA cap is applied marginally). */
export function empBurden(store: string, wage: number, ytdBefore: number): number {
  if (wage <= 0) return 0
  const capRoom = Math.max(0, WAGE_CAP - ytdBefore)
  const capTaxable = Math.min(wage, capRoom)
  const suta = SUTA_RATE[store] ?? 0.027
  const wc = WC_RATE[store] ?? 0.015
  return wage * (FICA_RATE + wc) + capTaxable * (FUTA_RATE + suta)
}

/** The fully-uncapped burden rate for a store — the early-career / trailing-forecast
 *  fallback when an employee still has full $7k cap room. */
export function uncappedRate(store: string): number {
  return FICA_RATE + (WC_RATE[store] ?? 0.015) + FUTA_RATE + (SUTA_RATE[store] ?? 0.027)
}
