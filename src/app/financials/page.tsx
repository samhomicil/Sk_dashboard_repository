import BudgetView from '@/components/BudgetView'

// Owner-only (gated in proxy.ts). The weekly full budget — every dollar out,
// bucketed with drill-down — off the shared core rules via /api/budget.
export const dynamic = 'force-dynamic'

export default function FinancialsPage() {
  return <BudgetView />
}
