import { LABOR_TARGET, COGS_TARGET } from './core/targets'

/**
 * Overview-dashboard targets.
 *
 * Cost-control targets that other surfaces also grade against are RE-EXPORTED from
 * `core/targets.ts` rather than restated here — that file is the single source of
 * truth. Previously `laborPct` was a literal 0.25 while core said 0.22, so the same
 * store could read "on target" on the Overview and "over" on Weekly Ops in the same
 * week (Miramar, 23.6% trailing-28d, did exactly that). Both surfaces compute labor
 * identically — SUM(total_pay) from smoothieking.labor, excluding NON_EMP/Support —
 * so there was never a definitional reason for the two numbers to differ.
 *
 * Targets below the re-exports are Overview-only (guest satisfaction, void/discount
 * hygiene, YoY growth) and have no counterpart in core.
 */
export const TARGETS = {
  laborPct: LABOR_TARGET,   // 0.22 — canon, matches daily recap / Weekly Ops / Budget
  cogsPct: COGS_TARGET,     // 0.25 — canon, recipe-COGS basis
  eePct: 0.60,
  voidPct: 0.02,
  discountPct: 0.08,
  salesGrowthYoY: 0.10,
  // Guest satisfaction (SMG). 90% OSAT is the confirmed target.
  osatPct: 0.90,
  surveysPerStoreMonth: 22,
}

export const STORE_CODES: Record<string, string> = {
  pines:   'SK-1392',
  miramar: 'SK-1892',
  margate: 'SK-2384',
}

export const STORE_LABELS: Record<string, string> = {
  all:     'All Stores',
  pines:   'Pines (1392)',
  miramar: 'Miramar (1892)',
  margate: 'Margate (2384)',
}

export const STORE_NAMES_DB: Record<string, string> = {
  'SK-1392': 'Pines',
  'SK-1892': 'Miramar',
  'SK-2384': 'Margate',
}

// How many future periods to forecast per tab
export const FORECAST_PERIODS: Record<string, number> = {
  weekly:    6,
  monthly:   3,
  quarterly: 2,
  ytd:       12, // remaining months to Dec
  custom:    8,
}

export const PROXY_URL = process.env.PROXY_URL ?? 'http://127.0.0.1:5001/query'
