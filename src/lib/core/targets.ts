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
