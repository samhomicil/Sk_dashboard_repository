import { NextResponse } from 'next/server';
import { getSimpleFinBalances } from '@/lib/bills/simplefin';
import { getPrisma } from '@/lib/bills/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Syncs each store's live POSTED bank balances from SimpleFIN (the real bank
 * balance — NOT QuickBooks' book balance, which lags reality) into
 * sk_bills.QbBalance, so the dashboard, weekly recap, and cash forecast all read
 * correct cash from Azure SQL. Runs daily via Vercel Cron (see vercel.json).
 *
 * Requires SIMPLEFIN_ACCESS_URL. QuickBooks stays connected for P&L/reports;
 * we only swapped the *balance* source here.
 *
 * updatedAt is set to each account's balance-date (when the bank data is from),
 * so freshness is honest — a broken feed shows an old timestamp instead of
 * silently looking current.
 */
export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when set; enforce if present.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getPrisma();
  if (!db) return NextResponse.json({ error: 'db not configured' }, { status: 503 });

  // ensure the target table exists in the app's own database (idempotent)
  await db.$executeRawUnsafe(
    `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='sk_bills' AND TABLE_NAME='QbBalance')
     CREATE TABLE sk_bills.QbBalance (store NVARCHAR(20) NOT NULL PRIMARY KEY, checking FLOAT NOT NULL DEFAULT 0,
       savings FLOAT NOT NULL DEFAULT 0, petty FLOAT NOT NULL DEFAULT 0, creditCard FLOAT NOT NULL DEFAULT 0,
       cashTotal FLOAT NOT NULL DEFAULT 0, updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`,
  );

  let balances;
  try {
    balances = await getSimpleFinBalances();
  } catch (e) {
    return NextResponse.json(
      { error: 'simplefin fetch failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const synced: unknown[] = [];
  for (const b of balances) {
    if (!b.balanceDate) {
      synced.push({ store: b.store, skipped: 'no balance data' });
      continue;
    }
    await db.$executeRawUnsafe(`DELETE FROM sk_bills.QbBalance WHERE store = '${b.store}'`);
    await db.$executeRawUnsafe(
      `INSERT INTO sk_bills.QbBalance (store, checking, savings, petty, creditCard, cashTotal, updatedAt)
       VALUES ('${b.store}', ${b.checking}, ${b.savings}, 0, ${b.creditCard}, ${b.cashTotal},
               DATEADD(second, ${Math.round(b.balanceDate)}, '1970-01-01'))`,
    );
    synced.push({
      store: b.store,
      cashTotal: Number(b.cashTotal.toFixed(2)),
      creditCard: Number(b.creditCard.toFixed(2)),
      ageHours: Math.round(b.ageHours),
      stale: b.stale,
    });
  }
  return NextResponse.json({ ok: true, source: 'simplefin', synced });
}
