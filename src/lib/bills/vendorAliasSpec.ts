// The alias rule set, written as a compact spec and expanded against the live
// Bill table by build-vendor-aliases.ts.
//
// Every entry below was derived from actual bank descriptors in the OpenBudget
// history (2026-05-02 .. 2026-08-08, 1,500 transactions across 9 accounts), not
// from guesswork. `confirmed: false` means the descriptor is identified but the
// bill it maps to still needs Sam's confirmation — those are reported separately
// and are safe to leave disabled.

export interface SpecEntry {
  /** Text to look for in the bank descriptor. */
  pattern: string;
  matchType?: 'contains' | 'prefix' | 'regex';
  field?: 'name' | 'merchant';
  /** Substring of Bill.vendor identifying the target bill, within each store. */
  vendorLike: string;
  /** Limit to one store; omit to expand across all three. */
  store?: string;
  amountMin?: number;
  amountMax?: number;
  priority?: number;
  confirmed?: boolean;
  /** Defaults to true. Set false to keep the research on record without matching. */
  enabled?: boolean;
  /** Other bills in the same store settled by the same single charge. */
  alsoSettles?: string[];
  /** Bill amount is a placeholder, not an expectation (credit-card payments). */
  variableAmount?: boolean;
  /** Day numbers (0=Sun..6=Sat) this rule applies to. */
  weekday?: number[];
  note?: string;
}

// Store attribution is CONFIRMED against the QuickBooks chart of accounts, not
// inferred from descriptor text: each company's bank/credit accounts carry the
// mask in their name (Lakay Legacy has "BofA Checking (9371)", SK Miramar has
// "BOA CHK (0828)", Hispaniola Wellness has "BOA CHK (5710)"), and the app's
// store keys map margate->Lakay Legacy, miramar->SK Miramar, pines->Hispaniola.
export const ACCOUNTS = [
  { id: 'ACT-000002', institution: 'Bank of America', name: 'Business Adv Fundamentals', subtype: 'checking',    mask: '0828', store: 'Miramar', paidFrom: 'BOA',   storeNumber: '1892' },
  { id: 'ACT-000001', institution: 'Bank of America', name: 'Business Advantage Sav',    subtype: 'savings',     mask: '0286', store: 'Miramar', paidFrom: 'BOA',   storeNumber: '1892' },
  { id: 'ACT-000003', institution: 'Bank of America', name: 'Business Adv Fundamentals', subtype: 'checking',    mask: '5710', store: 'Pines',   paidFrom: 'BOA',   storeNumber: '1392' },
  { id: 'ACT-000006', institution: 'Bank of America', name: 'Business Adv Fundamentals', subtype: 'checking',    mask: '9371', store: 'Margate', paidFrom: 'BOA',   storeNumber: '2384' },
  { id: 'ACT-000005', institution: 'Bank of America', name: 'Business Advantage Sav',    subtype: 'savings',     mask: '1782', store: 'Margate', paidFrom: 'BOA',   storeNumber: '2384' },

  // Cards ARE store-specific — QB books each one to a single company. An earlier
  // pass treated them as shared because the feed names them all "D. AYBAR".
  { id: 'ACT-000007', institution: 'Chase',           name: 'D. AYBAR',                  subtype: 'credit card', mask: '5979', store: 'Margate', paidFrom: 'Chase', storeNumber: '2384' },
  { id: 'ACT-000008', institution: 'Chase',           name: 'D. AYBAR',                  subtype: 'credit card', mask: '2918', store: 'Pines',   paidFrom: 'Chase', storeNumber: '1392' },
  { id: 'ACT-000009', institution: 'Capital One',     name: 'Capital One',               subtype: 'credit card', mask: '7879', store: 'Miramar', paidFrom: 'Chase', storeNumber: '1892' },

  // ACT-000004 (BOA savings ••1151, $80.00) appears on NO store's QuickBooks
  // chart of accounts — Hispaniola/Pines has no savings account at all. Left
  // unattributed rather than guessed; an earlier pass assigned it to Pines by
  // elimination, which QB does not support.
  { id: 'ACT-000004', institution: 'Bank of America', name: 'Business Advantage Sav',    subtype: 'savings',     mask: '1151', store: null,      paidFrom: 'BOA',   storeNumber: null },
];

export const SPEC: SpecEntry[] = [
  // ---- Smoothie King corporate ACH -------------------------------------------
  // Descriptors carry the fiscal period (P4/P5/P6) and store number (ID:1392),
  // which is why these are billed on period sales rather than calendar month.
  { pattern: 'SKFI\\s+OPERATING\\s+DES:P\\d+_?ROYALTY', matchType: 'regex', vendorLike: 'Royalty Fees',
    priority: 90, confirmed: true,
    note: 'e.g. "SKFI OPERATING DES:P4_ROYALTY ID:1392" — period royalty' },
  { pattern: 'SKFI\\s+OPERATING\\s+DES:P\\d+_?TECHFEE', matchType: 'regex', vendorLike: 'Technology F',
    priority: 90, confirmed: true,
    note: 'same originator as royalty, distinguished by the TECHFEE suffix' },
  { pattern: 'NAF\\s+OPERATING\\s+DES:P\\d+_?NATION', matchType: 'regex', vendorLike: 'National Mar',
    priority: 90, confirmed: true,
    note: 'National Ad Fund, e.g. "NAF OPERATING DES:P5NATIONAL"' },
  { pattern: 'MIAMI\\s+RAF\\s+DES:P\\d+_?REGIONAL', matchType: 'regex', vendorLike: 'Regional Mar',
    priority: 90, confirmed: true,
    note: 'Regional Ad Fund — Miami co-op' },

  // ---- Loans, rent, taxes -----------------------------------------------------
  { pattern: 'MECHANICS&FARMER DES:AUTO TRANS', vendorLike: 'M&F Bank', priority: 90, confirmed: true,
    note: 'M&F = Mechanics & Farmers Bank; descriptor ends "PMT INFO:M&F"' },
  // Sales tax arrives as "FLA DEPT REVENUE DES:C01", not the merchant string.
  // An earlier pattern matched only the merchant field and never fired.
  { pattern: 'FLA DEPT REVENUE', vendorLike: 'Florida Dept. of Revenue', priority: 90, confirmed: true,
    note: '9 payments, $32,007.42, across ALL THREE stores — but only Margate has this bill' },
  { pattern: 'Florida Department of Revenu', field: 'merchant', vendorLike: 'Florida Dept. of Revenue',
    priority: 88, confirmed: true },
  { pattern: 'Zelle Recurring payment to Anthony Tome', vendorLike: 'TOME', priority: 95, confirmed: true,
    note: 'Monthly Consulting Fees, $3,333.33/mo — matches the TOME bills' },

  // Pines rent (InvenTrust) is ALSO enriched as "Smoothie King" — same receiver-name
  // problem as PFG, but monthly and ~$8.6k rather than weekly and ~$2k. One draft
  // covers rent + water/sewer: 2026-07-08 is $8,629.44 = $8,182.96 + $446.48 exactly.
  // Priority must beat the PFG rules below, which match the same merchant string.
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'Rent',
    alsoSettles: ['InvenTrust — Utilities- Water/Sewer'], store: 'Pines',
    amountMin: 7500, amountMax: 9500, priority: 88, confirmed: true,
    note: 'InvenTrust: rent + water/sewer in one monthly draft; water varies $426-$476' },

  // ---- Food cost (PFG / Performance Foods) ------------------------------------
  // The ACH is "PERFORMACE FOODS DES:PAYMENT ID:7000144604 INDN:SMOOTHIE KING",
  // but the feed enriches the merchant from the RECEIVER name, so it arrives as
  // plain "Smoothie King" — identical to the sales deposits, separable only by
  // sign. Earlier passes quarantined these as a feed anomaly; they are in fact
  // the largest bills in the book.
  //
  // Deliveries are TUESDAY and FRIDAY at every store (confirmed by Sam). The
  // weekdays below are PAYMENT days, which lag delivery by about a business day:
  //   payment Mon (or Fri)   -> Friday delivery
  //   payment Tue / Wed / Thu -> Tuesday delivery
  // That is why the raw data clusters on Mon/Wed rather than Tue/Fri, and why an
  // earlier pass mislabelled these as Mon/Tue/Wed orders.
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'PFG — Food Cost (Tue order)',
    store: 'Margate', weekday: [2, 3, 4], amountMax: 6000, priority: 65, confirmed: true,
    note: 'amountMax keeps a rent-sized draft out of food cost' },
  // No Margate Friday rule: smoothieking.pfs_invoices (the source forecast.py
  // trusts) shows Margate/3167 taking TUESDAY deliveries only — 13 invoices, no
  // Fridays. Miramar/3783 and Pines/3784 take both. Margate's stray Mon/Fri debits
  // are not a second delivery.
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'PFG — Food Cost (Fri order)',
    store: 'Pines', weekday: [1, 5], amountMax: 6000, priority: 65, confirmed: true },
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'PFG — Food Cost (Tue order)',
    store: 'Pines', weekday: [2, 3, 4], amountMax: 6000, priority: 65, confirmed: true },
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'PFG — Food Cost (Fri order)',
    store: 'Miramar', weekday: [1, 5], amountMax: 6000, priority: 65, confirmed: true },
  { pattern: 'Smoothie King', field: 'merchant', vendorLike: 'PFG — Food Cost (Tue order)',
    store: 'Miramar', weekday: [2, 3, 4], amountMax: 6000, priority: 65, confirmed: true },

  // ---- Bookkeeping / subscriptions --------------------------------------------
  // All three billed monthly, but only Margate carries the bill record.
  { pattern: 'LEDGER FRAMEWORK', vendorLike: 'Ledger Frame Works', priority: 85, confirmed: true,
    note: 'descriptor is "LEDGER FRAMEWORK DES:SALE"; charged $200/mo/store vs a $300 bill' },
  // Pines and Miramar pay QuickBooks by ACH; MARGATE pays the same $38 by card,
  // so it needs the card descriptor. Only Margate carries the bill.
  { pattern: 'INTUIT * DES:QBooks', vendorLike: 'Quickbooks', priority: 85, confirmed: true,
    note: '$38/mo ACH; Pines and Miramar are charged but have no bill record' },
  { pattern: 'INTUIT *QBooks Online', vendorLike: 'Quickbooks', store: 'Margate',
    priority: 86, confirmed: true, note: 'Margate pays by card, not ACH' },
  { pattern: 'CANVA*', vendorLike: 'Canva', priority: 85, confirmed: true,
    note: '$15/mo; Miramar has the bill, but Margate is charged for it too' },

  // ---- Utilities / services ---------------------------------------------------
  { pattern: 'Florida Power & Light', field: 'merchant', vendorLike: 'FPL', priority: 80, confirmed: true },
  { pattern: 'IN *C3MS',   vendorLike: 'C3MS',    store: 'Margate', priority: 80, confirmed: true },
  { pattern: 'CRUNCH CORAL', vendorLike: 'Crunch Fitness', store: 'Margate',
    amountMin: 150, amountMax: 180, priority: 80, confirmed: true,
    note: 'Margate card, $162.75 exactly. Pines is charged Crunch too but has no bill.' },
  // The "Storage Unit" bill is Extra Space Storage; the vendor label never says so.
  { pattern: 'EXTRA SPACE', vendorLike: 'Storage', store: 'Miramar',
    priority: 80, confirmed: true, note: 'EXTRA SPACE 1068 on the Miramar card; $146.26 vs a $146.48 bill' },
  // PARKED 2026-08-08. Descriptor reads "ADP PAYROLL FEES DES:ADP FEES", but the
  // charge is EXACTLY $218.60 on the 8th of each month while the payroll it would
  // supposedly be a fee on swung from $12.7k to $21.3k (+66%). A usage-based
  // processing fee would move; a premium would not. Sam's read is that this is
  // workers comp. There is no workers-comp bill in the table for ANY store, so
  // there is nothing correct to map it to — booking it against the $99 payroll
  // processing line would misstate both. Resolve, add the right bill, then enable.
  { pattern: 'ADP PAYROLL FEES', vendorLike: 'ADP — Payroll Processing', priority: 75,
    confirmed: false, enabled: false,
    note: 'PARKED — likely workers comp, not a payroll fee. Pines only; Miramar has no equivalent charge.' },
  // AirTech is QUARTERLY at ~$215/store, and the bills already carry
  // every_n_months n:3. But AirTech also does ad-hoc repair calls on the same
  // card, and those are not bills. Without an amount bracket every service visit
  // gets booked against the quarterly PM — Pines alone shows four charges
  // ($284.27, $155.18, $671.43, $222.29) in two months against one quarterly bill.
  // The bracket keeps the PM-sized charge and lets repairs fall out as unmatched.
  { pattern: 'Airtech', field: 'merchant', vendorLike: 'Air', amountMin: 190, amountMax: 260,
    priority: 70, confirmed: true,
    note: 'quarterly PM only; charges outside $190-$260 are repair calls, not bills' },
  { pattern: 'WORKSTREAM.US', vendorLike: 'Workstream — Hiring', store: 'Margate',
    amountMin: 50, amountMax: 70, priority: 60, confirmed: false,
    note: 'four Workstream subscriptions bill on one card; only the $59 Hiring line is separable by amount so far' },

  // Northwest Extermination bills two stores at different rates; the descriptor
  // is identical, so amount is the only separator.
  { pattern: 'WWP*NORTHWEST EXTERMIN', vendorLike: 'Northwest Extermination — Pest Control',
    store: 'Pines', amountMin: 70, amountMax: 90, priority: 82, confirmed: true, note: '$80.00 bill' },
  { pattern: 'WWP*NORTHWEST EXTERMIN', vendorLike: 'Northwest Extermination — Rodent Monitoring',
    store: 'Margate', amountMin: 50, amountMax: 68, priority: 82, confirmed: false, note: '$58.85 bill' },
  { pattern: 'WWP*NORTHWEST EXTERMIN', vendorLike: 'Northwest Extermination — Pest Control',
    store: 'Margate', amountMin: 12, amountMax: 28, priority: 82, confirmed: false, note: '$20.00 bill' },

  // ---- card-paid bills (shared cards: store pinned by amount) ------------------
  // Margate Comcast bills on Chase ••5979: $133.91 Internet and ~$73 VoiceEdge.
  { pattern: 'Comcast', field: 'merchant', vendorLike: 'Comcast — Internet', store: 'Margate',
    amountMin: 125, amountMax: 150, priority: 75, confirmed: true, note: '$133.91 bill' },
  { pattern: 'Comcast', field: 'merchant', vendorLike: 'Comcast — Business VoiceEdge', store: 'Margate',
    amountMin: 60, amountMax: 85, priority: 75, confirmed: true, note: '$71.94 bill, charged $73.12' },
  // Pines pays Comcast from both BOA ••5710 and Chase ••2918.
  { pattern: 'Comcast', field: 'merchant', vendorLike: 'Comcast — Internet + Phone', store: 'Pines',
    amountMin: 160, amountMax: 200, priority: 75, confirmed: true,
    note: 'Pines pays Comcast from both BOA ••5710 and Chase ••2918; charges run $168.77-$196.63 against a $168.84 bill' },
  // Miramar's single $352.74 on Capital One ••7879 is a catch-up after a missed
  // payment: 2 x $168.77 + $15.20 late fee. The range is deliberately wide enough
  // to admit a two-period payment; a consumer must not assume one payment closes
  // exactly one occurrence.
  { pattern: 'Comcast', field: 'merchant', vendorLike: 'Comcast — Internet + Phone', store: 'Miramar',
    amountMin: 160, amountMax: 370, priority: 75, confirmed: true,
    note: 'catch-up payment: 2 x $168.77 + $15.20 late fee = $352.74' },

  // ---- Lockton ------------------------------------------------------------
  // Margate RE-ENABLED 2026-08-09: one charge settles both Margate policies —
  // Business $213 + Umbrella $37 = $250, and the real draft is 97-99% of that
  // ($243.00 Apr-Jun, stepped up to $248.40 Jul-Aug — a plausible premium
  // renewal, not a mismatch). Close enough to trust, unlike Pines/Miramar below.
  { pattern: 'Lockton Affinity', vendorLike: 'Lockton Insurance — Business Insurance',
    alsoSettles: ['Lockton Insurance — Umbrella Policy'], store: 'Margate',
    amountMin: 230, amountMax: 260, priority: 70, confirmed: true,
    note: 'one draft settles Business + Umbrella. $243.00 Apr-Jun, $248.40 Jul+ (rate change).' },

  // Pines RE-ENABLED 2026-08-09: the earlier "$64.05 unexplained gap" was
  // never a missing third bill — it was wrong bill amounts. Sam supplied the
  // real Lockton invoice (7483059/7483060, policies LRZ-IB-20000055-01 and
  // LRZ-UM-20000062-02): Business is actually $194.00, Umbrella $36.00
  // ($230 combined), not the $36/$138 that had been sitting in the bill
  // table since seeding — which turns out to be Miramar's numbers with the
  // Business/Umbrella labels swapped, i.e. a copy-paste error between the
  // two stores. Corrected both the live DB and bills.json to $194/$36.
  // $230 vs the real $238.05/mo draft is an $8.05 (3.4%) gap — the same
  // order of variance already trusted for Margate below, not the old
  // near-30% mismatch. Miramar's own numbers are unverified — still parked
  // until Sam supplies its invoice too; don't assume it's the same swap.
  { pattern: 'Lockton Affinity', vendorLike: 'Lockton Insurance — Business Insurance',
    alsoSettles: ['Lockton Insurance — Umbrella Policy'], store: 'Pines',
    amountMin: 220, amountMax: 255, priority: 70, confirmed: true,
    note: 'one draft settles Business + Umbrella. $194.00 + $36.00 = $230, real draft $238.05 (3.4% gap, plausible fee/tax).' },

  // Miramar STILL PARKED — left disabled rather than deleted so the finding
  // survives. Charges the same $238.05/mo real draft as Pines did, against
  // Business $138 + Umbrella $36 = $174 currently in the bill table — but
  // Pines' resolution above shows that $138/$36 pairing was actually a
  // copy-paste of the WRONG numbers into Pines, so Miramar's own $138/$36
  // can't be assumed correct just because it's internally consistent.
  // Re-enable once Sam supplies Miramar's actual Lockton invoice.
  { pattern: 'Lockton Affinity', vendorLike: 'Lockton Insurance — Business Insurance', store: 'Miramar',
    amountMin: 230, amountMax: 245, priority: 70, confirmed: false, enabled: false,
    note: 'PARKED. $238.05/mo vs Business $138 + Umbrella $36 = $174 stored — unverified against a real invoice.' },

  // ---- payroll ----------------------------------------------------------------
  { pattern: 'ADP Tax DES:ADP Tax', vendorLike: 'ADP — Payroll', priority: 72, confirmed: false,
    note: 'payroll tax draw, separate ACH from the EEPAY wage draw; both fund the same payroll bill' },

  // ---- Card payments ----------------------------------------------------------
  // Card bills are paid at whatever the balance allows, so their amountValue is a
  // placeholder ($500 Miramar, $300/$500 Chase) and variance against it is
  // meaningless. Ideally these rows would be amountType 'estimate', not 'fixed'.
  { pattern: 'CAPITAL ONE DES:', vendorLike: 'Capital One', store: 'Miramar', priority: 80,
    confirmed: true, variableAmount: true },
  { pattern: 'CHASE CREDIT CRD', vendorLike: 'Chase Bank',  priority: 80,
    confirmed: true, variableAmount: true },

  // ---- Identified but unconfirmed --------------------------------------------
  { pattern: 'Zelle Recurring payment to LAKAYLEGACY LLC', vendorLike: 'Huntington — Loan Payments',
    store: 'Margate', priority: 50, confirmed: false,
    note: '$5,928.82/mo vs the $5,928.80 Huntington bill — but it is a transfer to Lakay Legacy, not a payment to Huntington. Confirm whether this should close the Huntington occurrence.' },
  // MTC = Monarch Town Center, Miramar's landlord (managed by Stiles) — the
  // vendor bill-inbox's VENDOR_MAP calls "Monarch Town Center (Stiles)". The
  // descriptor gives no hint of that, which is why $19,630 sat unidentified.
  // One draft settles base rent AND the water bill: the 2026-08-03 payment is
  // $5,465.55 = $5,221.63 rent + $243.92 water, exactly. Water varies month to
  // month ($225.92 in Jun and Jul), so the range is loose on the top end.
  { pattern: 'MTC-Payment', vendorLike: 'Rent — Base Rent', alsoSettles: ['Stiles — Utilities- Water'],
    store: 'Miramar', amountMin: 3000, amountMax: 7000, priority: 85, confirmed: true,
    note: 'Monarch Town Center: rent + water in one draft. May 2026 came in $1,952 light — check for a credit or partial.' },

  // Neal Realty drafts Margate base rent and CAM as ONE payment. Per the 08/2026
  // landlord statement: Rent $1,590.00 + Est CAM Charges $1,214.58 = $2,804.58.
  // The bill record still carries the old CAM figure ($1,167.70), so the combined
  // expectation in the app is $2,757.70 — understated by $46.88/mo.
  { pattern: 'NEALREALTYINVEST', vendorLike: 'Rent — Base Rent', alsoSettles: ['Rent — Property Expense'],
    store: 'Margate', amountMin: 2700, amountMax: 6000, priority: 60, confirmed: true,
    note: 'one draft settles Base Rent + Property Expense (CAM). Statement 08/2026: $1,590.00 + $1,214.58 = $2,804.58. July was missed and paid late, so expect a two-period catch-up.' },
  { pattern: 'ADP EEPAY', vendorLike: 'ADP — Payroll', amountMin: 1000, priority: 70, confirmed: false,
    note: 'wage funding, not the $99 ADP Payroll Processing fee. Amount floor keeps the two apart.' },

  // MARGATE DOES NOT USE ADP. Its payroll runs through Workstream — "Workstream
  // DES:PCR" (payroll cash requirement), biweekly, 7 draws averaging $5,294.80
  // against a $6,000 estimate. The bill row is still named "ADP — Payroll", which
  // was misnamed "ADP — Payroll"; renamed to "Workstream — Payroll" 2026-08-08.
  // Distinct from the WORKSTREAM.US card charges below, which are subscriptions.
  { pattern: 'Workstream DES:PCR', vendorLike: 'Workstream — Payroll', store: 'Margate',
    amountMin: 1000, priority: 80, confirmed: true,
    note: 'Margate payroll is Workstream, not ADP (confirmed by Sam 2026-08-08). Rename the bill vendor.' },
];
