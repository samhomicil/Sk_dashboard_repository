import { requireHubToken } from '@/lib/hub-guard'
import { getDashboardData } from '@/lib/bills/service'
import { getUnifiedTransactions } from '@/lib/bills/unifiedTransactions'
import { recentAutoClears } from '@/lib/bills/autoclear'
import { STORES, HUB_BILLS_AHEAD_DAYS, HUB_BILLS_UNMATCHED_MIN, HUB_BILLS_UNMATCHED_DAYS } from '@/lib/core/targets'
import { etToday } from '@/lib/core/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/hub/bills — what the CFO agent in Nexus reads about bills and payments.
 * Bearer HUB_TOKEN only (lib/hub-guard.ts).
 *
 * Recomputes nothing of its own: occurrences are the Bills page's reconcile
 * (getDashboardData), the auto-clear list is sk_bills.BillAutoClear as the nightly
 * job wrote it, and the unmatched debits are the same bank feed with the same alias
 * rules. This route only picks and trims.
 *
 *   past_due   missed or overdue occurrences, oldest first
 *   due_soon   unpaid occurrences due today through HUB_BILLS_AHEAD_DAYS ahead
 *   auto_cleared   bills the nightly clear marked paid in the last 7 days, still standing
 *   unmatched  bank debits of HUB_BILLS_UNMATCHED_MIN+ in the last HUB_BILLS_UNMATCHED_DAYS
 *              that settled no bill and aren't transfers — new vendors, or bills paid
 *              from the wrong store's account
 */

const cents = (n: number | null | undefined) => Math.round(Number(n || 0) * 100) / 100
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const denied = requireHubToken(req); if (denied) return denied
  const noStore = { 'Cache-Control': 'no-store' }
  const today = etToday()
  try {
    const [data, feed, cleared] = await Promise.all([
      getDashboardData(new Date()),
      getUnifiedTransactions(addDays(today, -HUB_BILLS_UNMATCHED_DAYS), today),
      recentAutoClears(7),
    ])
    const ahead = addDays(today, HUB_BILLS_AHEAD_DAYS)
    const item = (o: (typeof data.occurrences)[number]) =>
      ({ vendor: o.vendor, due: o.due, expected: cents(o.expected), status: o.status })
    const stores = Object.fromEntries(STORES.map(({ name: store }) => {
      const mine = data.occurrences.filter((o) => o.store === store)
      const past = mine.filter((o) => o.status === 'missed' || o.status === 'overdue').sort((a, b) => a.due.localeCompare(b.due))
      const soon = mine.filter((o) => o.status !== 'paid' && o.due >= today && o.due <= ahead).sort((a, b) => a.due.localeCompare(b.due))
      return [store, {
        past_due: { count: past.length, total: cents(past.reduce((a, o) => a + (o.expected ?? 0), 0)), items: past.map(item) },
        due_soon: { count: soon.length, total: cents(soon.reduce((a, o) => a + (o.expected ?? 0), 0)), items: soon.map(item) },
      }]
    }))
    const unmatched = feed.rows
      .filter((t) => t.source === 'openbudget' && t.amount < 0 && !t.matched && !t.isTransfer
        && Math.abs(t.amount) >= HUB_BILLS_UNMATCHED_MIN)
      .map((t) => ({ date: t.date, store: t.store, amount: cents(Math.abs(t.amount)), payee: t.payee, account: t.accountLabel }))
      .sort((a, b) => b.date.localeCompare(a.date))
    return Response.json({
      as_of: data.now,
      bank_feed_ok: feed.openBudgetOk,
      stores,
      auto_cleared: cleared,
      unmatched,
    }, { headers: noStore })
  } catch (e) {
    return Response.json({ error: 'bills unavailable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: noStore })
  }
}
