import { query } from '@/lib/db'
import { auth } from '@/auth'
import { requireStore } from '@/lib/store-guard'
import { STORES } from '@/lib/core/targets'
import { etToday, etNowMinutes, isoAdd } from '@/lib/core/dates'
import { draftWeek, weekDates, type SchedShift, type SchedDay, type SchedPerson, type ElsewhereShift } from '@/lib/core/schedule'
import { loadScheduleInputs, weekStart, type WeekMode, type WeekActual } from '@/lib/scheduleData'
import { ageOn } from '@/lib/minorLabor'

// THE SCHEDULE BUILDER's data: one store, one business week (Tue–Mon). This route fetches
// and drafts; core/schedule.ts decides, and the page re-runs the same checks live as the
// manager edits. Store-locked like the crew roster: a store's own login sees and saves only
// its own store, pay rates included (managers do the hiring — Sam, 2026-09-29). Nothing
// here is sent to Teamworx.

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_SHIFTS = 300
const DRAFTS = 'smoothieking.schedule_drafts'

async function storeFor(requested: string | null) {
  const s = await requireStore(requested)
  if (s instanceof Response) return s
  const store = STORES.find(x => x.key === s)
  if (!store) return Response.json({ error: 'choose a store', reason: 'the schedule is built one store at a time' }, { status: 400 })
  return store
}

/** What GET returns — the page reads exactly this. */
export type SchedulePayload = {
  store: { key: string; name: string }
  today: string
  /** minutes past midnight ET — today's shifts that have started are no longer editable */
  now: number
  tuesday: string
  mode: WeekMode
  dates: string[]
  days: SchedDay[]
  ifOpen: Record<string, SchedDay>
  people: SchedPerson[]
  elsewhere: ElsewhereShift[]
  actual: WeekActual | null
  starts: { draft: SchedShift[]; posted: SchedShift[]; lastWeek: SchedShift[]; blank: SchedShift[] }
  saved: { id: number; name: string; source: string; by: string | null; at: string; shifts: Omit<SchedShift, 'id'>[] }[]
  asOf: { availability: string | null; timeOff: string | null }
  compare: { last4: { tuesday: string; net: number }[]; lastYear: number | null }
}

type SavedRow = { id: number; name: string; source: string; created_by: string | null; created_at: string; shifts: string }

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const store = await storeFor(p.get('store'))
  if (store instanceof Response) return store
  const today = etToday()
  const week = p.get('week')
  const tuesday = weekStart(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : isoAdd(today, 7))

  const [inputs, saved] = await Promise.all([
    loadScheduleInputs(store, tuesday, today),
    query<SavedRow[]>(`
      SELECT id, name, source, created_by, CONVERT(varchar(16), created_at, 120) AS created_at, shifts
        FROM ${DRAFTS} WHERE store = '${store.name}' AND week_start = '${tuesday}' ORDER BY created_at`),
  ])
  // A week that has started is worked from what's posted, never re-drafted.
  const draft = inputs.mode === 'ahead' ? draftWeek(inputs.store, inputs.days, inputs.people, inputs.fixed, inputs.elsewhere) : []
  const lastWeekMoved: SchedShift[] = inputs.posted.lastWeek.map(s => ({ ...s, date: isoAdd(s.date, 7) }))

  const payload: SchedulePayload = {
    store: { key: store.key, name: store.name },
    today, now: etNowMinutes(), tuesday, mode: inputs.mode, dates: weekDates(tuesday),
    days: inputs.days, ifOpen: inputs.ifOpen,
    elsewhere: inputs.elsewhere, actual: inputs.actual,
    // Birth dates are only needed for minor-labor checks: send them for minors, never adults.
    people: inputs.people.map(x => ({ ...x, dob: x.dob && ageOn(x.dob, inputs.days[6].date) < 18 ? x.dob : null })),
    starts: {
      draft,
      posted: inputs.posted.thisWeek,     // empty until Teamworx publishes this week
      lastWeek: lastWeekMoved,
      blank: [],
    },
    saved: saved.map(r => ({ id: r.id, name: r.name, source: r.source, by: r.created_by, at: r.created_at, shifts: JSON.parse(r.shifts) })),
    asOf: inputs.asOf,
    compare: inputs.compare,
  }
  return Response.json(payload)
}

type Body = { store?: string; week?: string; name?: string; source?: string; shifts?: unknown }

export async function POST(req: Request) {
  let body: Body
  try { body = await req.json() } catch { return Response.json({ error: 'bad request' }, { status: 400 }) }
  const store = await storeFor(body.store ?? null)
  if (store instanceof Response) return store
  // A read is clamped to the caller's own store; a save must never be quietly redirected.
  if (body.store !== store.key) {
    return Response.json({ error: 'forbidden', reason: `this login saves schedules for ${store.name} only` }, { status: 403 })
  }
  if (!body.week || !/^\d{4}-\d{2}-\d{2}$/.test(body.week)) return Response.json({ error: 'week is required' }, { status: 400 })
  const tuesday = weekStart(body.week)
  if (tuesday < weekStart(etToday())) return Response.json({ error: 'past weeks are read-only' }, { status: 400 })
  const dates = new Set(weekDates(tuesday))
  const source = ['draft', 'posted', 'lastWeek', 'blank'].includes(body.source ?? '') ? body.source! : 'draft'
  if (!Array.isArray(body.shifts) || body.shifts.length > MAX_SHIFTS) {
    return Response.json({ error: 'shifts must be a list', reason: `at most ${MAX_SHIFTS}` }, { status: 400 })
  }
  // Only the four fields a shift has, each checked — nothing from the client reaches SQL raw.
  const shifts: Omit<SchedShift, 'id'>[] = []
  for (const x of body.shifts as Record<string, unknown>[]) {
    const date = String(x?.date ?? ''), s = Number(x?.s), e = Number(x?.e)
    const key = x?.key == null ? null : String(x.key)
    if (!dates.has(date) || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || s >= e
      || s % 30 || e % 30 || (key !== null && (key.length > 200 || !/^[^|]+\|[^|]+$/.test(key)))) {
      return Response.json({ error: 'invalid shift', shift: x }, { status: 400 })
    }
    shifts.push({ date, s, e, key })
  }
  const name = String(body.name ?? '').trim().slice(0, 100) || 'Version'
  const email = (await auth())?.user?.email ?? null
  const q = (v: string | null) => (v == null ? 'NULL' : `N'${v.replace(/'/g, "''")}'`)
  const [row] = await query<{ id: number }[]>(`
    INSERT INTO ${DRAFTS} (store, week_start, name, source, shifts, created_by)
    OUTPUT INSERTED.id
    VALUES ('${store.name}', '${tuesday}', ${q(name)}, '${source}', ${q(JSON.stringify(shifts))}, ${q(email)})`)
  return Response.json({ id: row?.id ?? null })
}
