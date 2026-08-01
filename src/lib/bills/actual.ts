// Type-only shim. The Actual Budget integration was retired (QuickBooks is the
// live transaction source), so the real @actual-app/api wrapper is NOT migrated.
// Only the ActualTxn type is still referenced (by actualMock / actualAdapter).

export interface ActualTxn {
  id: string
  account: string
  date: string
  amount: number          // integer cents; NEGATIVE for outflows/expenses
  payee_name?: string
  imported_payee?: string
  notes?: string
  cleared?: boolean
}

// Kept as a harmless value export in case anything references it; the live path
// uses QuickBooks amounts directly, not Actual's integer-cents conversion.
export const toDollars = (intCents: number) => intCents / 100
