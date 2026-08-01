import { requireOwnerPage } from '@/lib/owner-guard'
import BudgetView from '@/components/BudgetView'

// Owner-only (gated in proxy.ts + here). The weekly full budget — every dollar out,
// bucketed with drill-down — off the shared core rules via /api/budget.
export const dynamic = 'force-dynamic'

export default async function FinancialsPage() {
  await requireOwnerPage()
  return <BudgetView />
}
