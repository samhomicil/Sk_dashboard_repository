// SimpleFIN Bridge client — live POSTED bank balances (the real bank balance,
// not QuickBooks' book balance). Cash = Bank of America checking + savings;
// Chase accounts are credit-card debt (deduped — they appear once per cardholder).
//
// Requires SIMPLEFIN_ACCESS_URL (the claimed access URL, contains credentials).
// Note: beta-bridge.simplefin.org returns 403 for the default fetch UA, so we
// send a browser User-Agent.

const STORES = ['Margate', 'Miramar', 'Pines'] as const;
type Store = (typeof STORES)[number];

const STALE_HOURS = Number(process.env.SIMPLEFIN_STALE_HOURS ?? 40);

export interface StoreBalance {
  store: Store;
  checking: number;
  savings: number;
  creditCard: number;   // total Chase debt magnitude (deduped)
  cashTotal: number;    // checking + savings, POSTED
  balanceDate: number;  // oldest unix ts across the store's cash accounts (0 = none)
  ageHours: number;
  stale: boolean;
}

interface SFAccount {
  org?: { name?: string; domain?: string };
  name?: string;
  balance?: string;
  'balance-date'?: number;
}

export async function getSimpleFinBalances(): Promise<StoreBalance[]> {
  const access = process.env.SIMPLEFIN_ACCESS_URL;
  if (!access) throw new Error('SIMPLEFIN_ACCESS_URL not set');
  const u = new URL(access);
  const auth = Buffer.from(
    `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
  ).toString('base64');
  const url = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}/accounts`;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Authorization: `Basic ${auth}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`SimpleFIN HTTP ${r.status}`);
  const data = (await r.json()) as { accounts?: SFAccount[] };
  const now = Date.now() / 1000;

  return STORES.map((store) => {
    let checking = 0;
    let savings = 0;
    let oldest = 0;
    const ccByValue = new Map<string, number>(); // dedupe duplicated Chase cards
    for (const a of data.accounts ?? []) {
      const org = a.org?.name ?? '';
      if (!org.includes(store)) continue;
      const bal = parseFloat(a.balance ?? '0') || 0;
      const bd = Number(a['balance-date'] ?? 0);
      if (org.includes('Bank of America')) {
        if (/sav/i.test(a.name ?? '')) savings += bal;
        else checking += bal;
        if (bd) oldest = oldest ? Math.min(oldest, bd) : bd;
      } else if (org.includes('Chase')) {
        ccByValue.set(Math.abs(bal).toFixed(2), Math.abs(bal)); // one per distinct balance
      }
    }
    const creditCard = [...ccByValue.values()].reduce((s, v) => s + v, 0);
    const ageHours = oldest ? (now - oldest) / 3600 : Infinity;
    return {
      store,
      checking,
      savings,
      creditCard,
      cashTotal: checking + savings,
      balanceDate: oldest,
      ageHours,
      stale: ageHours > STALE_HOURS,
    };
  });
}
