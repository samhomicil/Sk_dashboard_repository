/**
 * SK (CrunchTime) fiscal financial calendar — 12 periods per year, 5-4-4 pattern
 * (35/28/28 days, 364-day year). Franchise fees (royalty, national/regional ad
 * fund) are billed on the just-CLOSED financial period's net sales, NOT the
 * calendar month of the ACH draw. Verified 2026-08-01 against QuickBooks draws:
 * royalty = 6%, national ad fund = 3%, regional (RAF) = 2% of period net sales,
 * drawn ~2 weeks after period close; actuals reconciled to ~1% once the per-store
 * POS-net vs SK-reportable-net basis factor (below) is applied.
 *
 * Client-safe (no server-only): the bills forecast runs in the browser too.
 * Source of truth: CrunchTime "Edit Financial Calendar" (FY2025 & FY2026 screens).
 */

export interface FiscalPeriod {
  id: string;      // e.g. "2026-P04" (fiscal year + zero-padded period)
  fy: number;      // fiscal year
  period: number;  // 1..12
  begin: string;   // ISO (inclusive)
  end: string;     // ISO (inclusive)
}

// FY2025 begins 2024-12-31; every fiscal year is 364 days (52 weeks), so each
// subsequent FY start is +364 days. Within a year, the 5-4-4 day pattern gives
// these cumulative day-offsets for period starts (period p begins at start+CUM[p-1]).
const FY2025_START = Date.UTC(2024, 11, 31); // 2024-12-31
const FY_DAYS = 364;
const CUM = [0, 35, 63, 91, 126, 154, 182, 217, 245, 273, 308, 336, 364];
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

let _cache: FiscalPeriod[] | null = null;

/** All fiscal periods for FY2024..FY2029 (covers any realistic forecast horizon). */
export function financialPeriods(): FiscalPeriod[] {
  if (_cache) return _cache;
  const out: FiscalPeriod[] = [];
  for (let fy = 2024; fy <= 2029; fy++) {
    const yearStart = FY2025_START + (fy - 2025) * FY_DAYS * DAY;
    for (let p = 1; p <= 12; p++) {
      out.push({
        id: `${fy}-P${String(p).padStart(2, '0')}`,
        fy,
        period: p,
        begin: iso(yearStart + CUM[p - 1] * DAY),
        end: iso(yearStart + (CUM[p] - 1) * DAY),
      });
    }
  }
  _cache = out;
  return out;
}

/**
 * The period whose franchise fee is drawn on/around `drawISO` = the most recently
 * CLOSED period at draw time (latest period whose end date is before the draw).
 * Matches the observed ~2-week billing lag: a May-16 draw bills the period that
 * ended ~May 4. Returns null if the draw predates the calendar.
 */
export function periodForDraw(drawISO: string): FiscalPeriod | null {
  let best: FiscalPeriod | null = null;
  for (const p of financialPeriods()) {
    if (p.end < drawISO && (!best || p.end > best.end)) best = p;
  }
  return best;
}

/** The fiscal period that contains a given calendar date (inclusive). */
export function periodContaining(dateISO: string): FiscalPeriod | null {
  for (const p of financialPeriods()) {
    if (dateISO >= p.begin && dateISO <= p.end) return p;
  }
  return null;
}

/**
 * Per-store basis factor: SK's royalty-reportable net sales runs slightly below
 * our POS net_sales. Derived from 6 periods of actual QB royalty draws ÷ (6% × POS
 * period net): Miramar −1.0%, Pines −1.7%, Margate −2.0%. Applied to every
 * %-of-sales franchise fee so the estimate lands on the real draw, not ~2% high.
 */
export const BASIS_FACTOR: Record<string, number> = {
  Margate: 0.980,
  Miramar: 0.990,
  Pines: 0.983,
};

/** A franchise fee that is a percent of period sales (royalty / ad-fund lines). */
export function isFranchisePercentFee(bill: {
  category?: string;
  amountType?: string;
}): boolean {
  return bill.category === 'Franchise Fees' && bill.amountType === 'percent';
}
