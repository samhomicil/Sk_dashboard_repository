import 'server-only';
import { expandSpec, type SpecBill } from './vendorAlias';
import { SPEC } from './vendorAliasSpec';

// Which bills the vendor-alias table says are settled by ONE real payment —
// Neal Realty's Margate draft (Base Rent + Property Expense), MTC's Miramar
// draft (Base Rent + Stiles water). Structural: derived from the spec's
// alsoSettles relationships, independent of whether a matching transaction
// has actually been found for any given period. The Bills table uses this to
// render linked bills as one merged row instead of two, per Sam's request —
// the bills themselves stay distinct records; only the display merges.
//
// Map value is the FULL group including the key itself, e.g.
// groups.get(baseRentId) === groups.get(propertyExpenseId) === [baseRentId, propertyExpenseId].
// The first id in each array is the "primary" — the row the merged display
// renders under.
export function computeBillGroups(bills: SpecBill[]): Map<string, string[]> {
  const { rules } = expandSpec(SPEC, bills);
  const groups = new Map<string, string[]>();
  for (const r of rules) {
    if (!r.alsoSettles.length) continue;
    const full = [r.billId, ...r.alsoSettles];
    for (const id of full) groups.set(id, full);
  }
  return groups;
}
