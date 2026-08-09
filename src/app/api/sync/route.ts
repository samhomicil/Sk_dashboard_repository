import { NextResponse } from 'next/server';
import { getOpenBudgetBalances, isConnected } from '@/lib/bills/openbudget';
import { getPrisma } from '@/lib/bills/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Syncs each store's live POSTED bank balances into sk_bills.QbBalance, so the
 * dashboard, weekly recap, and cash forecast all read correct cash from Azure
 * SQL. Runs daily via Vercel Cron (see vercel.json).
 *
 * OpenBudget only, as of 2026-08-08 — SimpleFIN retired. OpenBudget already
 * covered more (Miramar's Capital One card is invisible to SimpleFIN but
 * present in OpenBudget) and was fresher in a same-day comparison, so keeping
 * a second, independent bank-feed credential around as a "fallback" was
 * redundant complexity for no real coverage gain. If OpenBudget is down, this
 * now fails loudly (502) instead of silently serving a different source's
 * numbers — the honest failure mode for a route nothing else double-checks.
 *
 * Neither source ever saw Huntington (Margate's bank account, Miramar's LOC)
 * — that stays QBO-book-balance-only until Huntington is linked to a feed.
 *
 * QuickBooks stays connected for P&L/reports; this route only ever sources
 * the *balance*.
 *
 * updatedAt is set to each account's balance-date (when the bank data is
 * from), so freshness is honest — a broken feed shows an old timestamp
 * instead of silently looking current.
 */
export async function GET(req: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. This route is excluded
  // from the session gate in proxy.ts (a cron has no user session), so the secret is
  // its ONLY protection — fail CLOSED. A missing CRON_SECRET is a misconfiguration,
  // not permission to run unauthenticated: it previously read `if (secret && ...)`,
  // which silently left a public write endpoint whenever the var was absent.
  // Same posture as /api/ingest-refresh.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
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

  let balances: Awaited<ReturnType<typeof getOpenBudgetBalances>>;
  try {
    if (!(await isConnected())) throw new Error('OpenBudget not connected — visit /api/openbudget/auth');
    balances = await getOpenBudgetBalances();
  } catch (e) {
    return NextResponse.json(
      { error: 'openbudget balance fetch failed', detail: e instanceof Error ? e.message : String(e) },
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
  // fresh balances just landed — expire cached SQL reads so pages pick them up
  const { expireDbCache } = await import('@/lib/db');
  await expireDbCache();
  return NextResponse.json({ ok: true, source: 'openbudget', synced });
}
