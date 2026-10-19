/**
 * ORDER ITEMS — what the Order screen orders, and how each vendor sells it.
 *
 * One entry per NetChef product (or product group). Each offer maps a vendor's item
 * numbers to NetChef's inventory unit, so a count in NetChef units and a vendor's case
 * meet in one number: `perPack` = NetChef inventory units in one vendor pack.
 *
 * WHY A CURATED LIST: NetChef P-codes do not join to PFG item numbers (no shared key),
 * and PFG re-issues items under new numbers when the price steps up (sweetened
 * strawberries went TR420 → TV458 → AEH14 → ALW42 → TP168 in 2026). Every number an item
 * has carried stays in `codes`, newest first, so history and the current catalogue both
 * resolve to the same row. The daily PFG snapshot also records PFG's own suggested
 * replacement for a retired number; add it here when one appears.
 *
 * CHECKED AGAINST NETCHEF 2026-10-19: every PFG number and `perPack` below matches the
 * product and conversion NetChef applied when it received that number on a PFG purchase
 * order (201 POs, Mar–Oct 2026, all three stores).
 *
 * WHO MAY SELL WHAT: an offer from a vendor other than PFG exists only when NetChef has a
 * local-buy bid for that product in our market (ORLANDO), checked 2026-10-18 — 16
 * products. Corporate's own approved-local list is still to come; when it does it narrows
 * or widens `local` here, nowhere else.
 */

export type OrderVendor = 'PFG' | 'Walmart' | 'Restaurant Depot'
export type OrderCategory = 'frozen' | 'fresh' | 'dairy' | 'chilled' | 'protein' | 'food' | 'pack' | 'dry' | 'juice' | 'retail'

export interface OrderOffer {
  vendor: OrderVendor
  /** PFG product numbers, or Walmart item ids — newest first */
  codes: string[]
  /** NetChef inventory units in one pack of this offer */
  perPack: number
  /** how the pack reads on screen when the vendor's own wording is unknown */
  pack: string
}

export interface OrderItem {
  /** NetChef product number, or a group key */
  id: string
  name: string
  category: OrderCategory
  /** NetChef inventory unit as people say it */
  unit: string
  /** NetChef products counted into this row, with the multiplier into `unit` */
  members: Record<string, number>
  offers: OrderOffer[]
  /** cap in packs — bananas over-ripen past about six days */
  maxPacks?: number
  /** Walmart fresh items are not on a count list: a fixed amount per run, per offer */
  perRun?: number[]
  /** PFG numbers once received into this product but no longer offered — they count as receipts, never as a choice */
  history?: { codes: string[]; perPack: number }[]
  /** built from NetChef's PO mapping (not curated): the stores that received it */
  auto?: { stores: string[] }
}

const one = (id: string, n = 1) => ({ [id]: n })

export const ORDER_ITEMS: OrderItem[] = [
  { id: 'P1120', name: 'Strawberries, sliced with sugar', category: 'frozen', unit: 'containers', members: one('P1120'),
    offers: [{ vendor: 'PFG', codes: ['TP168', 'ALW42', 'AEH14', 'TV458', 'TR420'], perPack: 6, pack: 'Case 6 × 6.5 lb' }] },
  { id: 'P1119', name: 'Strawberries, no sugar', category: 'frozen', unit: 'containers', members: one('P1119'),
    offers: [{ vendor: 'PFG', codes: ['PV376', 'TV456', 'ARN08'], perPack: 6, pack: 'Case 6 × 6 lb' }] },
  { id: 'P1078', name: 'Mango, frozen', category: 'frozen', unit: 'lb', members: one('P1078'),
    offers: [
      { vendor: 'PFG', codes: ['WE276'], perPack: 30, pack: 'Case 30 lb' },
      { vendor: 'PFG', codes: ['RJ260', 'RK600'], perPack: 20, pack: 'Case 20 lb' },
    ],
    history: [{ codes: ['ANH48'], perPack: 20 }] },
  { id: 'P1095', name: 'Pineapple, frozen', category: 'frozen', unit: 'lb', members: one('P1095'),
    offers: [{ vendor: 'PFG', codes: ['RD438'], perPack: 22, pack: 'Case 22 lb' }] },
  { id: 'P1012', name: 'Blueberries, frozen', category: 'frozen', unit: 'lb', members: one('P1012'),
    offers: [
      { vendor: 'PFG', codes: ['AVD90'], perPack: 30, pack: 'Case 30 lb' },
      { vendor: 'PFG', codes: ['PW216', 'RA052'], perPack: 20, pack: 'Case 20 lb' },
    ] },
  // NetChef counts acai in 22 lb containers; the 3 gal tub PFG sells now is 0.818 of one
  { id: 'P1003', name: 'Acai base', category: 'frozen', unit: '22 lb tubs', members: one('P1003'),
    offers: [{ vendor: 'PFG', codes: ['BBN62'], perPack: 0.818, pack: 'Tub 3 gal' }],
    history: [{ codes: ['RD456'], perPack: 1 }] },
  { id: 'P1010', name: 'Bananas', category: 'fresh', unit: 'cases', members: one('P1010'), maxPacks: 5,
    offers: [{ vendor: 'PFG', codes: ['RT068', 'RT060', 'RT044', '547995', '547994'], perPack: 1, pack: 'Case 40 lb' }] },
  { id: 'P1480', name: 'Strawberries, fresh', category: 'fresh', unit: 'lb', members: one('P1480'), perRun: [8, 4],
    offers: [
      { vendor: 'Walmart', codes: ['44391605', '45618183'], perPack: 1, pack: '1 lb' },
      { vendor: 'Walmart', codes: ['22660282'], perPack: 2, pack: '2 lb' },
    ] },
  { id: 'P1011', name: 'Blueberries, fresh', category: 'fresh', unit: 'lb', members: one('P1011'), perRun: [4, 7],
    offers: [
      { vendor: 'Walmart', codes: ['161115457'], perPack: 1.125, pack: '18 oz' },
      { vendor: 'Walmart', codes: ['5474918527'], perPack: 0.6125, pack: '9.8 oz' },
    ],
    history: [{ codes: ['V0480'], perPack: 4.5 }] },
  { id: 'P1131', name: 'Greek yogurt', category: 'dairy', unit: '3 lb tubs', members: one('P1131'),
    offers: [
      { vendor: 'Walmart', codes: ['26559565', '21291511'], perPack: 2 / 3, pack: 'Tub 32 oz' },
      { vendor: 'PFG', codes: ['AWP90', 'PV062', '1062758'], perPack: 4, pack: 'Case 4 × 3 lb' },
    ] },
  { id: 'P1058', name: 'Butter pecan', category: 'dairy', unit: 'tubs', members: one('P1058'),
    offers: [{ vendor: 'PFG', codes: ['PT688', '646353'], perPack: 1, pack: 'Tub 3 gal' }] },
  { id: 'P1132', name: 'Frozen yogurt', category: 'dairy', unit: 'tubs', members: one('P1132'),
    offers: [{ vendor: 'PFG', codes: ['PT684'], perPack: 1, pack: 'Tub 3 gal' }] },
  { id: 'P1057', name: 'Hulk blend', category: 'protein', unit: 'lb', members: one('P1057'),
    offers: [{ vendor: 'PFG', codes: ['AJV46', 'RA198'], perPack: 25, pack: 'Bag 25 lb' }] },
  { id: 'P1103', name: 'Protein Blend', category: 'protein', unit: 'lb', members: one('P1103'),
    offers: [{ vendor: 'PFG', codes: ['RF278', '203037'], perPack: 25, pack: 'Bag 25 lb' }] },
  // Gladiator: each flavour is a 2 lb retail tub (counted in tubs) plus a 25 lb bulk bag (counted in lb)
  { id: 'GLAD-V', name: 'Gladiator vanilla', category: 'protein', unit: 'lb', members: { P1135: 2, P1052: 1 },
    offers: [
      { vendor: 'PFG', codes: ['RA256'], perPack: 8, pack: 'Case 4 × 2 lb tubs' },
      { vendor: 'PFG', codes: ['AVM30', 'RA182'], perPack: 25, pack: 'Bag 25 lb' },
    ] },
  { id: 'GLAD-C', name: 'Gladiator chocolate', category: 'protein', unit: 'lb', members: { P1133: 2, P1050: 1 },
    offers: [
      { vendor: 'PFG', codes: ['RA278'], perPack: 8, pack: 'Case 4 × 2 lb tubs' },
      { vendor: 'PFG', codes: ['RA284'], perPack: 25, pack: 'Bag 25 lb' },
    ] },
  { id: 'GLAD-S', name: 'Gladiator strawberry', category: 'protein', unit: 'lb', members: { P1134: 2, P1051: 1 },
    offers: [
      { vendor: 'PFG', codes: ['RA266'], perPack: 8, pack: 'Case 4 × 2 lb tubs' },
      { vendor: 'PFG', codes: ['AVM36', 'RA270'], perPack: 25, pack: 'Bag 25 lb' },
    ] },
  { id: 'P1092', name: 'Peanut butter', category: 'dry', unit: 'lb', members: one('P1092'),
    offers: [{ vendor: 'PFG', codes: ['RG906', '200645'], perPack: 30, pack: 'Case 6 × 5 lb' }] },
  { id: 'P1054', name: 'Granola, Purely Elizabeth', category: 'dry', unit: 'lb', members: one('P1054'),
    offers: [{ vendor: 'PFG', codes: ['PW222'], perPack: 21, pack: 'Case 3 × 7 lb' }] },
  { id: 'P1056', name: 'Honey, clover', category: 'dry', unit: 'bottles', members: one('P1056'),
    offers: [{ vendor: 'PFG', codes: ['RG924'], perPack: 12, pack: 'Case 12 × 16 oz' }] },
  { id: 'P1123', name: 'Demerara sugar', category: 'dry', unit: 'lb', members: one('P1123'),
    offers: [{ vendor: 'PFG', codes: ['AMN90'], perPack: 50, pack: 'Bag 50 lb' }] },
  { id: 'P1117', name: 'Stevia', category: 'dry', unit: 'lb', members: one('P1117'),
    offers: [{ vendor: 'PFG', codes: ['AJV48'], perPack: 5, pack: 'Bag 5 lb' }],
    history: [{ codes: ['PW282'], perPack: 5 }] },
  { id: 'P1046', name: 'Everything seasoning', category: 'dry', unit: 'containers', members: one('P1046'),
    offers: [{ vendor: 'PFG', codes: ['NJ559'], perPack: 1, pack: '21 oz' }] },
  { id: 'P1025', name: 'Coconut flakes', category: 'dry', unit: 'lb', members: one('P1025'),
    offers: [{ vendor: 'PFG', codes: ['LE992'], perPack: 2.5, pack: 'Case 4 × 10 oz' }] },
  { id: 'P1063', name: 'Apple kiwi juice', category: 'juice', unit: 'bottles', members: one('P1063'),
    offers: [{ vendor: 'PFG', codes: ['RF324'], perPack: 12, pack: 'Case 12 × 32 oz' }] },
  { id: 'P1069', name: 'White grape lemon juice', category: 'juice', unit: 'bottles', members: one('P1069'),
    offers: [{ vendor: 'PFG', codes: ['RF320'], perPack: 12, pack: 'Case 12 × 32 oz' }] },
  { id: 'P1090', name: 'Papaya juice', category: 'juice', unit: 'bottles', members: one('P1090'),
    offers: [{ vendor: 'PFG', codes: ['RF322'], perPack: 12, pack: 'Case 12 × 32 oz' }] },
  { id: 'P6542', name: 'Chicken flatbread', category: 'food', unit: 'each', members: one('P6542'),
    offers: [{ vendor: 'PFG', codes: ['BAE34'], perPack: 24, pack: 'Case 24' }] },
  { id: 'P1009', name: 'Avocado spread', category: 'food', unit: 'cups', members: one('P1009'),
    offers: [
      { vendor: 'PFG', codes: ['AHT02'], perPack: 48, pack: 'Case 48 × 2 oz' },
      { vendor: 'Walmart', codes: ['10416257', '814142465'], perPack: 6, pack: 'Box of 6 × 2 oz' },
    ] },
  { id: 'P1040', name: 'Hard-boiled eggs', category: 'food', unit: 'eggs', members: one('P1040'),
    offers: [
      { vendor: 'PFG', codes: ['WF974'], perPack: 28, pack: 'Case 14 × 2' },
      { vendor: 'Walmart', codes: ['122116064'], perPack: 6, pack: 'Bag of 6' },
    ] },
  { id: 'P1415', name: 'Cups, 20 oz', category: 'pack', unit: 'cases', members: one('P1415'),
    offers: [{ vendor: 'PFG', codes: ['BDC02', 'RH374'], perPack: 1, pack: 'Case 500' }],
    history: [{ codes: ['RJ868', 'BAE48'], perPack: 1.2 }] },
  { id: 'P1416', name: 'Cups, 32 oz', category: 'pack', unit: 'cases', members: one('P1416'),
    offers: [{ vendor: 'PFG', codes: ['BDC08', 'RJ262'], perPack: 1, pack: 'Case 300' }],
    history: [{ codes: ['RJ244'], perPack: 1 }] },
  { id: 'P1417', name: 'Cups, 44 oz', category: 'pack', unit: 'cases', members: one('P1417'),
    offers: [{ vendor: 'PFG', codes: ['BDC10', 'RH376'], perPack: 1, pack: 'Case 250' }],
    history: [{ codes: ['AWR92'], perPack: 1 }] },
]

/** Every way PFG has delivered an item: today's offers plus retired numbers. */
export const pfgReceipts = (item: OrderItem) => [
  ...item.offers.filter(o => o.vendor === 'PFG').map(o => ({ codes: o.codes, perPack: o.perPack })),
  ...(item.history ?? []),
]

/* ── everything else PFG delivers: built from NetChef's own PO mapping ─────────────────── */

/** One row of smoothieking.netchef_vendor_items (PFG, COGS products). */
export interface VendorItemRow {
  vendor_product: string
  product_number: string
  conv: number
  vendor_package: string | null
  product_name: string | null
  subcategory: string | null
  microcategory: string | null
  inventory_unit: string | null
  last_received: string
  stores: string | null
}

/** Where a product is kept, from the storage spots it is counted in. */
export type Keep = 'freezer' | 'fridge' | 'shelf'

/**
 * Category of a product nobody curated: where it is kept decides shelf life (and so how many
 * days an order may hold, and whether a sister store can lend it); NetChef's own category
 * tells packaging and retail apart; the J-numbered juices and milks are shelf-stable bottles.
 */
export function autoCategory(r: VendorItemRow, keep: Keep): OrderCategory {
  const name = r.product_name ?? ''
  if (keep === 'freezer' || /frozen|sorbet/i.test(name)) return 'frozen'
  if (/packaging/i.test(r.microcategory ?? '')) return 'pack'
  if (r.subcategory === 'Retail Goods') return 'retail'
  if (r.microcategory === 'Fruits/Juices' && /^(J\d+|LTO) - /.test(name)) return 'juice'
  if (keep === 'fridge') return 'chilled'
  return 'dry'
}

/** NetChef's inventory unit as a plural people say: "Container (48 FLOZ)" → "containers". */
export function unitLabel(u: string | null): string {
  const base = (u ?? 'each').replace(/\s*\(.*$/, '').replace(/^\d+\s+/, '').trim().toLowerCase()
  if (base === 'each' || base === 'lb' || base === '') return base || 'each'
  const irregular: Record<string, string> = { box: 'boxes', pouch: 'pouches', loaf: 'loaves', 'foam case': 'cases' }
  return irregular[base] ?? base + 's'
}

/** PFG's pack string as it reads on a shelf: "6/48 OZ" → "Case 6 × 48 oz", "1/25 LB" → "25 lb". */
export function packLabel(p: string | null): string {
  if (!p) return 'Pack'
  const m = p.replace(/^(CS|EA)\//i, '').match(/^([\d.]+)\/\s*([\d.]+)\s*(.*)$/)
  if (!m) return p
  const [, n, size, rest] = m
  const unit = rest.replace(/cnt|ct/i, '').replace('#', 'lb').trim().toLowerCase()
  if (Number(n) > 1) return size === '1' && !unit ? `Case ${n}` : `Case ${n} × ${size}${unit ? ' ' + unit : ''}`
  return `${size}${unit ? ' ' + unit : ''}`
}

/**
 * An order item for every COGS product PFG delivered that the curated list does not cover,
 * one offer per pack size (newest number first). Curated items win: their members are skipped.
 */
export function autoItems(rows: VendorItemRow[], keepOf: (product: string) => Keep): OrderItem[] {
  const curated = new Set(ORDER_ITEMS.flatMap(i => Object.keys(i.members)))
  const byProduct = new Map<string, VendorItemRow[]>()
  for (const r of rows) {
    if (curated.has(r.product_number) || !(Number(r.conv) > 0)) continue
    const list = byProduct.get(r.product_number) ?? []
    list.push(r)
    byProduct.set(r.product_number, list)
  }
  const out: OrderItem[] = []
  for (const [pn, list] of byProduct) {
    list.sort((a, b) => b.last_received.localeCompare(a.last_received))
    const r0 = list[0]
    const offers: OrderOffer[] = []
    for (const r of list) {
      const conv = Math.round(Number(r.conv) * 10000) / 10000
      const o = offers.find(x => x.perPack === conv)
      if (o) o.codes.push(r.vendor_product)
      else offers.push({ vendor: 'PFG', codes: [r.vendor_product], perPack: conv, pack: packLabel(r.vendor_package) })
    }
    out.push({
      id: pn,
      name: (r0.product_name ?? pn).replace(/^(CORE|ARP) - /, ''),
      category: autoCategory(r0, keepOf(pn)),
      unit: unitLabel(r0.inventory_unit),
      members: one(pn),
      offers,
      auto: { stores: [...new Set(list.flatMap(r => (r.stores ?? '').split(',').filter(Boolean)))] },
    })
  }
  return out
}
