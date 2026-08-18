// Shared cost-control targets and store config — the single source of truth for
// every surface (ops-week report, daily recap parity, the owner budget view).
// Changing a number here changes it everywhere, by construction.

export const LABOR_TARGET = 0.22   // labor % of sales (matches daily recap)
export const LABOR_AMBER = 0.03    // amber band = target .. target+3pts

// Recipe-COGS: default/fallback, plus the derived "beat-your-run-rate" target.
export const COGS_TARGET = 0.25
export const COGS_IMPROVEMENT = 0.005  // 0.5-pt stretch below the trailing run-rate
export const COGS_FLOOR = 0.20
export const COGS_CAP = 0.28

export const DEFAULT_RATE = 13.50  // rate fallback when an employee has no history
export const HIST_WEEKS = 4        // trailing weeks for the same-weekday forecast

// Labor hygiene: roles that are $0-pay placeholders, excluded from hours/cost.
export const LABOR_EXCLUDE_ROLES = ['NON_EMP', 'Support'] as const

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const STORES = [
  { key: 'pines', name: 'Pines', num: '1392', wm: 'pines' },
  { key: 'miramar', name: 'Miramar', num: '1892', wm: 'miramar' },
  { key: 'margate', name: 'Margate', num: '2384', wm: 'margate' },
] as const

// PFG delivery cadence by store (JS getUTCDay: Tue=2, Fri=5). Pines/Miramar
// deliver Tue+Fri, Margate Tue — same source of truth as the order guide.
export const DELIVERY_DOWS: Record<string, number[]> = { Pines: [2, 5], Miramar: [2, 5], Margate: [2] }

// ── Constants relocated here, values unchanged ───────────────────────────────
// Each of these was a literal in the file that used it, which is how the Overview
// came to grade labor at 25% while Weekly Ops used 22%. Moving them changes no
// number; it gives each one a single address so the next surface reads it rather
// than restating it. `npm run check` fails if a new one appears outside this file.

/** Prime cost ceiling, LOADED (recipe COGS + labor incl. tips and burden).
 *  Was a local literal in app/api/budget/route.ts. NOT COGS_TARGET + LABOR_TARGET,
 *  which is the unloaded 0.47 — the two are different bases and both are shown. */
export const PRIME_TARGET = 0.52

/** Jolt evidence-photo pass rate below which the card reads red.
 *  Was a literal in components/JoltQualityCard.tsx. */
export const JOLT_QUALITY_TARGET = 0.85

/** Jolt SOP completion target. Was a literal in components/SopCard.tsx.
 *  Deliberately a separate constant from JOLT_QUALITY_TARGET despite sharing a
 *  value today — completing a checklist and photographing it well are different
 *  things, and tying them together would make one move when the other is tuned. */
export const SOP_COMPLETE_TARGET = 0.85

/** Inventory watchlist thresholds. Were literals in lib/inventoryWatchlistUtils.ts. */
export const FAST_MOVER_DAYS = 30
export const VARIANCE_FLAG_PCT = 0.15

/**
 * Salaried manager cost per store, per WEEK, BEFORE burden.
 *
 * ⚠️ This disagrees with cash-forecast/forecast.py, which carries
 * DAN_PER_ENTITY = {Miramar: 1386, Pines: 1386, Margate: 0} per BIWEEKLY period —
 * $693/week against the $625 here. Both are pre-burden (Budget applies `empBurden`
 * separately, forecast.py multiplies by PAY_BURDEN afterwards), so the bases match
 * and the $68/week/store gap is real: ~$7,072/yr across the two salaried entities.
 *
 * The value here is UNCHANGED pending a decision. Budget's comment says 625 makes
 * "Brink hourly + this salary + 0.85×tips tie to actual Staff Wages within ~1%";
 * forecast.py's 1386 is described as validated against the 7/31 ADP register. One of
 * those calibrations is stale. Do not resolve it by editing this line alone — the two
 * repos must move together or the Budget and Cash Flow tabs will disagree.
 */
export const MGR_WEEKLY: Record<string, number> = { Miramar: 625, Pines: 625, Margate: 0 }

/**
 * Staffing adequacy — forecast orders ÷ staff on duty. HIGH IS BAD.
 *
 * Canon is daily-recap/recap.py `_uplh_style`, which these bands reproduce exactly.
 * The daily recap is the reference for insight methodology, so any surface showing
 * this metric must use these bands.
 *
 * ⚠️ NAME COLLISION: components/Heatmap.tsx also says "UPLH" but means something
 * else — units per labor hour, with per-store targets back-solved from wage cost
 * (STORE_UPH below). The ranges overlap, so a reader seeing "UPLH 7" gets "near
 * optimal" from the heatmap and "tight, red" from the recap. Same word, opposite
 * verdicts. Renaming one is a decision, not a refactor.
 */
export const STAFFING_BANDS = [
  { under: 3, word: 'overstaffed' },
  { max: 6, word: 'on target' },
  { max: 7.5, word: 'tight' },
  { word: 'understaffed' },
] as const

/** Units per labor hour, per store — the OTHER "UPLH". Back-solved from each store's
 *  June wage cost and average revenue per unit against the 22% labor target.
 *  Was a literal in components/Heatmap.tsx. See the collision note above. */
export const STORE_UPH: Record<string, number> = { pines: 7.5, miramar: 8.4, margate: 8.2 }

/**
 * The shortest NetChef period that can carry a meaningful ACTUAL cost of goods.
 *
 * Actual COGS is (beginning + received − physical) × price. Over a full cycle the
 * received stock is also largely used, so it cancels. Over a 2-day window it does
 * not: one delivery lands inside the window and nothing has consumed it yet, so
 * actual comes out enormous against two days of sales.
 *
 * That is not hypothetical. On 2026-08-17 the only count period inside the week was
 * Aug 11–12 — two days — and the Overview reported actual COGS of 182.1% (Margate
 * 256.8%) beside a perfectly sane 26.0% theoretical. Theoretical survives a short
 * window because recipe usage scales with sales; actual does not, because receipts
 * are lumpy.
 *
 * A real inventory cycle is a week. 5 is the floor rather than 7 so a count taken a
 * day early or late still counts, while 1- and 2-day partials are refused. Below
 * this, actual COGS is reported as unavailable — never as a number.
 */
export const INVENTORY_PERIOD_MIN_DAYS = 5

/* ── Crew exception thresholds (Labor & crew) ─────────────────────────────── */
/**
 * Drawer variance a till may be off before it is worth asking about.
 *
 * Already in use — it was `Math.abs(c.ownPerTill) > 5` inside the employees page.
 * Moved here because a threshold inside a component is invisible to anyone reading
 * this file to ask what the app grades against. Value unchanged.
 */
export const DRAWER_VARIANCE_LIMIT = 5

/**
 * Void rate a person may run before it is flagged, in absolute terms.
 * Also already in use — `<Rate limit={0.02}>` on the same page. Value unchanged.
 */
export const VOID_LIMIT_PCT = 0.02

/**
 * How far past the REST-OF-SHIFT void rate a person's own rate must sit to be worth
 * raising. The kit's Labor & crew names this rule in its own subtitle: "void rates
 * past double the shift baseline".
 *
 * NEW — the app displayed both figures side by side but never compared them. It is
 * here rather than in a component so it is visible and arguable. It matters because
 * an absolute 2% limit flags a whole busy store on a bad night, while "double the
 * people working the same shift" isolates the one person, which is the only version
 * of this a manager can act on.
 */
export const VOID_VS_SHIFT_MULTIPLE = 2
