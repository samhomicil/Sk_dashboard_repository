import 'server-only';

// Sigma Computing net-sales pull — ported from sk-dashboard's sigma-fetch.py so
// sk-bills reads the same source (Sales Mix v2, "TOT TOTAL NET SALES") on demand.
const SIGMA_BASE = 'https://api.sigmacomputing.com/v2';
const CONNECTION_ID = '73b76456-d1b5-492a-989e-0479cb1591a0';
const SALES_INODE = '16djMxYA6BegwtQBHlmqTS'; // Sales Mix v2

// Sigma "LOCATION NAME" → store key
const LOC_TO_STORE: Record<string, string> = {
  '2384 - Margate, FL': 'margate',
  '1892 - Miramar, FL': 'miramar',
  '1392 - Pembroke Pines, FL': 'pines',
};
const LOCATIONS = Object.keys(LOC_TO_STORE);

export interface WeekPoint { weekStart: string; weekLabel: string; sales: number; isCurrent?: boolean; }
export interface SalesTrend { refreshedAt: string; trend: Record<string, { weekly: WeekPoint[] }>; }

export const isSigmaConfigured = () => !!(process.env.SIGMA_CLIENT_ID && process.env.SIGMA_CLIENT_SECRET);

async function getToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SIGMA_CLIENT_ID!,
    client_secret: process.env.SIGMA_CLIENT_SECRET!,
  });
  const r = await fetch(`${SIGMA_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`sigma auth ${r.status}`);
  return (await r.json()).access_token as string;
}

async function query(token: string, sql: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${SIGMA_BASE}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, connection_id: CONNECTION_ID }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`sigma query ${r.status}`);
  const resp = await r.json();
  const cols = (resp.columns as { name: string; columnIndex: number }[])
    .slice().sort((a, b) => a.columnIndex - b.columnIndex).map((c) => c.name);
  return (resp.rows as unknown[][]).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - back);
  return x;
}
const weekLabelOf = (weekStart: string) => {
  const [y, m, dd] = weekStart.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// In-process cache (per serverless instance); Refresh passes force=true.
let _cache: { at: number; data: SalesTrend } | null = null;
const TTL = 5 * 60 * 1000;

export async function getWeeklyNetSales(force = false): Promise<SalesTrend> {
  if (!force && _cache && Date.now() - _cache.at < TTL) return _cache.data;
  if (!isSigmaConfigured()) return { refreshedAt: new Date().toISOString(), trend: {} };

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 98); // ~14 weeks
  const locList = LOCATIONS.map((l) => `'${l}'`).join(', ');
  const sql = `
    SELECT CAST("SALES DATE" AS DATE) AS sale_date,
           "LOCATION NAME"            AS location,
           SUM("TOT TOTAL NET SALES") AS net_sales
    FROM "connection"."${SALES_INODE}"
    WHERE "SALES DATE" >= '${iso(start)}' AND "SALES DATE" <= '${iso(today)}'
      AND "LOCATION NAME" IN (${locList})
    GROUP BY CAST("SALES DATE" AS DATE), "LOCATION NAME"
    ORDER BY sale_date`;

  const token = await getToken();
  const rows = await query(token, sql);

  // Aggregate daily → weekly (Mon-start) per store.
  const acc: Record<string, Map<string, number>> = { margate: new Map(), miramar: new Map(), pines: new Map() };
  for (const r of rows) {
    const store = LOC_TO_STORE[String(r.location)];
    if (!store) continue;
    const dateStr = String(r.sale_date).slice(0, 10);
    const [y, m, d] = dateStr.split('-').map(Number);
    const wk = iso(mondayOf(new Date(y, m - 1, d)));
    acc[store].set(wk, (acc[store].get(wk) ?? 0) + Number(r.net_sales ?? 0));
  }

  const curWeek = iso(mondayOf(today));
  const trend: Record<string, { weekly: WeekPoint[] }> = {};
  for (const store of Object.keys(acc)) {
    const weekly = [...acc[store].entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, sales]) => ({ weekStart, weekLabel: weekLabelOf(weekStart), sales: Math.round(sales), isCurrent: weekStart === curWeek }));
    trend[store] = { weekly };
  }

  const data: SalesTrend = { refreshedAt: new Date().toISOString(), trend };
  _cache = { at: Date.now(), data };
  return data;
}
