/**
 * Replay the send-home rule (core/intraday.ts) over a past month — the regression test for
 * the Now screen's calls. A decision every 30 minutes from 9:00, each person's ACTUAL clock
 * times standing in for the schedule (hindsight), and a call sends that person home at once.
 *
 *   npx tsx -r ./scripts/server-only-shim.cjs scripts/replay-send-home.ts [YYYY-MM]
 *
 * Reads through the local SQL proxy (PROXY_URL, default 127.0.0.1:5001). Baseline, September
 * 2026, as Sam approved the rule on 2026-10-01: Pines 27 calls on 19 days, Miramar 30 on 20,
 * Margate 9 on 9, ~$2,244/mo — identical to the Python backtest it was chosen from. A change
 * to the rule or its targets that moves these numbers is a change to what Sam signed off.
 */
import { salesBySlot, LATEST_RATES } from '../src/lib/core/sources'
import { buildStoreNow, type SlotRow, type ClockRow, type PlanRow } from '../src/lib/core/intraday'
import { buildRateFor } from '../src/lib/core/labor'
import { isoAdd, hmToMin } from '../src/lib/core/dates'

async function q<T>(sql: string): Promise<T[]> {
  const r = await fetch(process.env.PROXY_URL ?? 'http://127.0.0.1:5001/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.rows
}
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
;(async () => {
  const month = process.argv[2] ?? '2026-09'
  const first = `${month}-01`, next = isoAdd(`${month}-28`, 7).slice(0, 7) + '-01'
  const slots = await q<SlotRow>(salesBySlot(`s.closed_datetime >= '${isoAdd(first, -35)}' AND s.closed_datetime < '${next}'`))
  const shifts = await q<{ store: string; employee: string; role: string; d: string; s: string; e: string | null }>(
    `SELECT store, employee, role, CONVERT(char(10), d, 23) d, CONVERT(char(5), shift_start, 108) s, CONVERT(char(5), shift_end, 108) e
       FROM smoothieking.vw_labor_floor_shifts WHERE d >= '${first}' AND d < '${next}'`)
  const rateFor = buildRateFor(await q(LATEST_RATES))
  const bySD = new Map<string, SlotRow[]>()
  for (const r of slots) { const k = `${r.store}|${r.d}`; (bySD.get(k) ?? bySD.set(k, []).get(k)!).push({ ...r, slot: Number(r.slot) }) }
  const res: Record<string, { calls: number; hrs: number; usd: number; days: Set<string> }> = {}
  const keys = [...new Set(shifts.map(s => `${s.store}|${s.d}`))].sort()
  for (const k of keys) {
    const [store, d] = k.split('|')
    const S = shifts.filter(s => s.store === store && s.d === d && s.s && s.e)
      .map(s => ({ ...s, a: hmToMin(s.s), b: hmToMin(s.e!) <= hmToMin(s.s) ? hmToMin(s.e!) + 1440 : hmToMin(s.e!) }))
    const hist = [7, 14, 21, 28].flatMap(w => bySD.get(`${store}|${isoAdd(d, -w)}`) ?? [])
    const lastOut = Math.max(...S.map(s => s.b))
    for (let t = 9 * 60; t < lastOut - 60; t += 30) {
      const clock: ClockRow[] = S.filter(s => s.a <= t && !/salary/i.test(s.role)).map(s => ({ employee: s.employee, role: s.role, start: hm(s.a), end: s.b <= t ? hm(s.b) : null }))
      const plan: PlanRow[] = S.map(s => ({ employee: s.employee, role: s.role, start: hm(s.a), end: hm(s.b) }))
      const today = (bySD.get(k) ?? []).filter(r => r.slot < Math.floor(t / 30))
      const now = buildStoreNow({ store, today: d, asOf: t, todaySlots: today, histSlots: hist, clock, plan, rateFor })
      const c = now.calls[0]; if (!c) continue
      const r = res[store] ??= { calls: 0, hrs: 0, usd: 0, days: new Set() }
      r.calls++; r.hrs += c.hours; r.usd += c.dollars; r.days.add(d)
      const who = S.find(s => s.employee === c.employee && s.a <= t && t < s.b)!; who.b = t   // sent home now
    }
  }
  let tot = 0
  for (const s of ['Pines', 'Miramar', 'Margate']) { const r = res[s]; tot += r?.usd ?? 0
    console.log(`${s.padEnd(8)} ${String(r?.calls ?? 0).padStart(3)} calls on ${String(r?.days.size ?? 0).padStart(2)} days  ${(r?.hrs ?? 0).toFixed(1).padStart(5)} h  $${Math.round(r?.usd ?? 0)}/mo`) }
  console.log(`total $${Math.round(tot)} in ${month}`)
})()
