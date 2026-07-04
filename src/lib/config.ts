export const TARGETS = {
  laborPct: 0.25,
  eePct: 0.80,
  cogsPct: 0.167,       // 16.7% business COGS target
  voidPct: 0.02,
  discountPct: 0.08,
  salesGrowthYoY: 0.10,
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
