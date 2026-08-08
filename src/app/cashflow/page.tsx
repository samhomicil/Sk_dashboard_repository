import { requireOwnerPage } from '@/lib/owner-guard'
import ForecastClient from './ForecastClient'

// Owner-only (gated in proxy.ts + here). Per-store daily cash-balance forecast
// from sk_bills.Forecast (OpenBudget-anchored, written by the local forecast.py job).
export const dynamic = 'force-dynamic'

export default async function CashFlowPage() {
  await requireOwnerPage()
  return <ForecastClient />
}
