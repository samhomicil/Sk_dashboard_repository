'use client'

// Detail behind the Ops Health "Guest Voice" tiles.
//
// Ordered by what needs acting on, not by what's easiest to compute: the unanswered
// negatives first, then how thin the window is, then the trend, then the themes with
// their comments folded inside.
//
// The page is explicit about one asymmetry it can't hide. Comments carry the unit that
// produced them, so Pines and Miramar separate. Scores come from a login covering both
// and can't be filtered by unit, so those two share a figure.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { swrGet, swrSet } from '@/lib/swrCache'
import type { GuestVoiceDetail, ThemeRow, CommentRow, CompareBlock } from '@/app/api/guest-voice/route'

const STORES = ['all', 'margate', 'pines', 'miramar'] as const
const STORE_LABEL: Record<string, string> = {
  all: 'All', margate: 'Margate', pines: 'Pines', miramar: 'Miramar',
}
const RANGES = [
  { key: '7', label: '7d' }, { key: '14', label: '14d' },
  { key: '30', label: '30d' }, { key: '90', label: '90d' },
] as const

const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
const md = (s: string | null) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '')
const clock = (s: string | null) => {
  if (!s || s.length < 16) return ''
  const [h, m] = s.slice(11, 16).split(':').map(Number)
  const ap = h >= 12 ? 'pm' : 'am'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${ap}`
}

// Each section is one SMG/SOCi report. Naming the source is not decoration — the four
// have different grains, populations and store coverage, and treating them as one feed is
// how you end up averaging 3 public reviews against 25 private surveys.
function Section({ n, title, source, note, children }: {
  n: number; title: string; source: string; note?: string; children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2.5 flex-wrap pt-1">
        <span className="w-5 h-5 rounded bg-slate-700 text-white text-[11px] font-bold
          flex items-center justify-center shrink-0">{n}</span>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        <span className="text-[11px] text-slate-400">{source}</span>
        {note && <span className="text-[11px] text-amber-600">{note}</span>}
      </div>
      {children}
    </section>
  )
}

// On All, every section compares by store instead of pooling. Column sets differ per
// section because the sources do — scores and cases resolve to two logins, comments to
// three units — so each table renders its own header rather than assuming one shape.
function Compare({ c }: { c: CompareBlock }) {
  const cell = (v: number | null, n: number) =>
    v == null ? <span className="text-slate-300">—</span>
      : <><span className={n < 10 ? 'text-slate-400' : 'font-bold text-slate-800'}>{pct(v)}</span>
          <span className="text-slate-400 ml-1">({n})</span></>

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Scores by store</span>
          <span className="text-[10px] text-slate-400">widest gap first · Pines and Miramar share one SMG login</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-200">
              <th className="px-2 py-1.5 text-left font-semibold">Metric</th>
              {c.scoreStores.map(s2 => <th key={s2} className="px-2 py-1.5 text-right font-semibold">{s2}</th>)}
              <th className="px-2 py-1.5 text-right font-semibold">Gap</th>
            </tr></thead>
            <tbody>
              {c.scores.map(m => (
                <tr key={m.metric} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{m.metric}</td>
                  {c.scoreStores.map(s2 => (
                    <td key={s2} className="px-2 py-1.5 text-right tabular-nums">
                      {cell(m.cells[s2]?.value ?? null, m.cells[s2]?.n ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {m.gap == null ? <span className="text-slate-300">—</span>
                      : m.gap >= 0.05 ? <span className="text-red-600 font-semibold">{(m.gap * 100).toFixed(0)}pts</span>
                        : <span className="text-slate-400">{(m.gap * 100).toFixed(0)}pts</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Incidents by store</span>
          <span className="text-[10px] text-slate-400">24h callback goal</span>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-slate-400 border-b border-slate-200">
            <th className="px-2 py-1.5 text-left font-semibold">Store</th>
            <th className="px-2 py-1.5 text-right font-semibold">Opened</th>
            <th className="px-2 py-1.5 text-right font-semibold">Still open</th>
            <th className="px-2 py-1.5 text-right font-semibold">Avg close</th>
            <th className="px-2 py-1.5 text-right font-semibold">Past goal</th>
            <th className="px-2 py-1.5 text-right font-semibold">Escalated</th>
          </tr></thead>
          <tbody>
            {Object.entries(c.cases).map(([s2, v]) => (
              <tr key={s2} className="border-b border-slate-100">
                <td className="px-2 py-1.5 font-medium text-slate-700">{s2}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{v.opened}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${v.pending ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{v.pending}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${(v.avgHours ?? 0) > v.goalHours ? 'text-red-600' : 'text-slate-700'}`}>
                  {v.avgHours != null ? `${v.avgHours.toFixed(0)}h` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{v.overSla}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{v.escalated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Themes by store</span>
          <span className="text-[10px] text-slate-400">
            mentions (negative) · comments split all three ways
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-200">
              <th className="px-2 py-1.5 text-left font-semibold">Theme</th>
              {c.commentStores.map(s2 => <th key={s2} className="px-2 py-1.5 text-right font-semibold">{s2}</th>)}
            </tr></thead>
            <tbody>
              {c.themes.map(t => (
                <tr key={t.theme} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{t.theme}</td>
                  {c.commentStores.map(s2 => {
                    const v = t.cells[s2]
                    return (
                      <td key={s2} className="px-2 py-1.5 text-right tabular-nums">
                        {!v ? <span className="text-slate-300">—</span>
                          : <><span className="text-slate-700">{v.mentions}</span>
                              {v.negative > 0 && <span className="text-red-600 font-semibold ml-1">({v.negative})</span>}</>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="px-2 py-1.5 font-bold text-slate-700">All comments</td>
                {c.commentStores.map(s2 => {
                  const v = c.commentCounts[s2]
                  return (
                    <td key={s2} className="px-2 py-1.5 text-right tabular-nums font-bold">
                      {v ? <>{v.comments}<span className="text-red-600 ml-1">({v.negative})</span></> : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Delta({ cur, prior }: { cur: number | null; prior: number | null }) {
  if (cur == null || prior == null) return <span className="text-slate-300">—</span>
  const d = (cur - prior) * 100
  if (Math.abs(d) < 0.5) return <span className="text-slate-400">flat</span>
  return <span className={d > 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
    {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(0)}pts
  </span>
}

function Verbatim({ c, tone }: { c: CommentRow; tone?: boolean }) {
  const neg = c.sentiment < 0
  return (
    <div className={`grid grid-cols-[84px_1fr] gap-3 py-2.5 border-t border-slate-100 first:border-t-0
      ${neg && tone ? 'border-l-2 border-l-red-500 pl-3 -ml-3' : ''}`}>
      <div className="text-[11px] text-slate-400 tabular-nums leading-snug">
        <b className="block text-slate-500 font-semibold">{md(c.when)}</b>
        {clock(c.when) || <span className="text-slate-300">no time</span>}
        {c.osat != null && (
          <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded
            ${c.osat >= 5 ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-600'}`}>OSAT {c.osat}</span>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          {c.question && <span className="text-[11px] font-semibold text-slate-500">{c.question}</span>}
          {c.source !== 'Survey' && (
            <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5">{c.source}</span>
          )}
          <span className="text-[10px] text-slate-400">{c.store}</span>
        </div>
        <div className="text-[13px] text-slate-700">{c.text}</div>
      </div>
    </div>
  )
}

function Theme({ t }: { t: ThemeRow }) {
  const total = t.mentions || 1
  const posPct = (t.positive / total) * 100
  const negPct = (t.negative / total) * 100
  return (
    <details className="border-t border-slate-100 group">
      <summary className="list-none cursor-pointer py-2.5 px-1 grid grid-cols-[1fr_64px_52px_96px_16px]
        gap-3 items-center hover:bg-slate-50 rounded-md focus-visible:outline-2 focus-visible:outline-teal-500">
        <span className="flex items-center gap-2 font-semibold text-slate-700 text-xs">
          {t.theme}
          {t.negative > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wide bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
              {t.negative} negative
            </span>
          )}
        </span>
        <span className="text-right text-xs tabular-nums text-slate-500">{t.mentions}</span>
        <span className="text-right text-xs tabular-nums font-bold text-slate-800">{pct(t.positive / total)}</span>
        <span className="flex h-2 rounded-sm overflow-hidden bg-slate-100 gap-[2px]">
          {posPct > 0 && <i style={{ width: `${posPct}%` }} className="block bg-emerald-600" />}
          {negPct > 0 && <i style={{ width: `${negPct}%` }} className="block bg-red-600" />}
        </span>
        <svg className="w-3.5 h-3.5 text-slate-400 justify-self-end transition-transform group-open:rotate-90"
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 3l5 5-5 5" /></svg>
      </summary>
      <div className="px-1 pb-4 space-y-3">
        {t.leaves.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {t.leaves.map(l => (
              <span key={l.leaf} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                <b className="text-slate-700 font-semibold">{l.leaf}</b> {l.mentions} · {pct(l.positive / (l.mentions || 1))} pos
              </span>
            ))}
          </div>
        )}
        <div>{t.comments.map((c, i) => <Verbatim key={i} c={c} tone />)}</div>
        <div className="text-[10px] text-slate-400">
          {t.mentions} comment{t.mentions === 1 ? '' : 's'} touch this theme · {t.negative} negative
          {t.comments.length < t.mentions && ` · showing ${t.comments.length}`}
        </div>
      </div>
    </details>
  )
}

export default function GuestVoicePage() {
  const [data, setData] = useState<GuestVoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<string>('margate')
  const [days, setDays] = useState<string>('30')

  // Render-phase adjustment on filter change: a store/window combo already viewed
  // this session renders instantly from swrCache; the effect below revalidates it.
  const key = `gv:${store}:${days}`
  const [prevKey, setPrevKey] = useState('')
  if (prevKey !== key) {
    setPrevKey(key)
    const cached = swrGet<GuestVoiceDetail>(key)
    setData(cached ?? data)
    setLoading(!cached)
  }

  useEffect(() => {
    const end = new Date()
    const start = new Date(end.getTime() - (Number(days) - 1) * 86_400_000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    let stale = false
    fetch(`/api/guest-voice?store=${store}&start=${iso(start)}&end=${iso(end)}`, { cache: 'no-store' })
      .then(r => r.json()).then(d => { swrSet(key, d); if (!stale) { setData(d); setLoading(false) } })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, days])

  const thin = data?.osat != null && data.osat.n > 0 && data.osat.n < (data.minN ?? 10)

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 lg:px-10 w-full max-w-[1280px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-teal-600">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            Dashboard
          </Link>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-xl font-bold text-slate-800">Guest Voice</h1>
            {data?.range && (
              <p className="text-xs text-slate-400 mt-0.5">
                {data.commentScope} · {data.range.start} → {data.range.end} · SMG survey + SOCi reviews
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setDays(r.key)}
                className={`px-3 py-1.5 text-xs font-medium ${days === r.key ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {STORES.map(k => (
              <button key={k} onClick={() => setStore(k)}
                className={`px-3 py-1.5 text-xs font-medium ${store === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {STORE_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map(i => (
          <div key={i} className="card"><div className="animate-pulse h-24 bg-slate-100 rounded-lg w-full" /></div>
        ))}</div>
      ) : !data ? (
        <div className="card text-sm text-slate-400">No guest data for this selection.</div>
      ) : (
        <div className="space-y-4">

          {/* attention first */}
          {data.newBad.length > 0 && (
            <section className="rounded-xl border border-red-200 bg-red-50/40 p-4">
              <h3 className="flex items-center gap-2 text-[13px] font-bold text-red-900 mb-0.5">
                <span className="text-[9px] font-extrabold uppercase tracking-wider bg-red-600 text-white px-1.5 py-0.5 rounded">New</span>
                {data.newBad.length} bad report{data.newBad.length === 1 ? '' : 's'} in the last {data.newDays} days
              </h3>
              <div className="text-[11px] text-red-700 mb-2">These are the ones still worth a response</div>
              {data.newBad.map((c, i) => <Verbatim key={i} c={c} tone />)}
            </section>
          )}

          {/* On All, compare rather than pool — a single blended figure hides a 22pt spread */}
          {data.compare && (
            <Section n={1} title="Store comparison" source="every metric, side by side">
              <Compare c={data.compare} />
            </Section>
          )}

          {/* 1 — cases: the only feed with a person waiting on the other end */}
          {!data.compare && data.cases && (
            <Section n={1} title="Incidents" source="SMG guest recovery cases"
              note={data.cases.pending > 0 ? `${data.cases.pending} still open` : undefined}>
              <div className="card">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-3 mb-3 border-b border-slate-100">
                  <div>
                    <div className="text-xs text-slate-500">Opened</div>
                    <div className="text-2xl font-bold text-slate-800">{data.cases.opened}</div>
                    <div className="text-[11px] text-slate-400">in this range</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Still open</div>
                    <div className={`text-2xl font-bold ${data.cases.pending ? 'text-red-600' : 'text-slate-800'}`}>
                      {data.cases.pending}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {data.cases.pending ? 'guest waiting' : 'nothing outstanding'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Avg close <span className="text-slate-300">goal {data.cases.goalHours}h</span></div>
                    <div className={`text-2xl font-bold ${(data.cases.avgHours ?? 0) > data.cases.goalHours ? 'text-red-600' : 'text-slate-800'}`}>
                      {data.cases.avgHours != null ? `${data.cases.avgHours.toFixed(0)}h` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-400">{data.cases.overSla} past goal</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Escalated</div>
                    <div className="text-2xl font-bold text-slate-800">{data.cases.escalated}</div>
                    <div className="text-[11px] text-slate-400">
                      {data.cases.opened ? `${Math.round(100 * data.cases.escalated / data.cases.opened)}% of cases` : '—'}
                    </div>
                  </div>
                </div>
                {data.caseDays.length === 0 ? (
                  <div className="text-xs text-slate-400">No cases raised in this range.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-slate-400 border-b border-slate-200">
                      <th className="px-2 py-1.5 text-left font-semibold">Date raised</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Cases</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Still open</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Avg close</th>
                    </tr></thead>
                    <tbody>
                      {data.caseDays.map(c => (
                        <tr key={c.date} className="border-b border-slate-100">
                          <td className="px-2 py-1.5 font-medium text-slate-700">{md(c.date)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{c.opened}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${c.pending ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{c.pending}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${(c.avgHours ?? 0) > (data.cases?.goalHours ?? 24) ? 'text-red-600' : 'text-slate-700'}`}>
                            {c.avgHours != null ? `${Number(c.avgHours).toFixed(0)}h` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="text-[10px] text-slate-400 mt-2">
                  Every case type carries a {data.cases.goalHours}-hour callback goal · the guest&apos;s name and
                  number sit in SMG, not here yet
                </div>
              </div>
            </Section>
          )}

          {thin && (
            <div className="text-[11px] rounded-lg px-3 py-2.5 bg-amber-50 text-amber-800 max-w-[84ch]">
              <b>This window is thin.</b> {data.osat!.n} response{data.osat!.n === 1 ? '' : 's'} — under
              SMG&apos;s {data.minN}-response threshold, one guest moves the score 20+ points. The range table
              below shows the same measure at wider windows.
            </div>
          )}

          {/* 2 — survey scores */}
          {!data.compare && <Section n={2} title="Survey scores" source="SMG Guest Experience Survey"
            note={data.combinedScores ? 'Pines and Miramar cannot be separated' : undefined}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="card">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Surveys vs goal</span>
                <span className="text-[10px] text-slate-400">22 per store per month, prorated</span>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  <th className="px-2 py-1.5 text-left font-semibold">Range</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Surveys</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Goal</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Pace</th>
                </tr></thead>
                <tbody>
                  {data.ranges.map(r => {
                    const pace = r.goal ? r.surveys / r.goal : null
                    const dim = r.surveys < data.minN
                    return (
                      <tr key={r.days} className={`border-b border-slate-100 ${dim ? 'text-slate-400' : ''}`}>
                        <td className="px-2 py-1.5 font-medium">{r.label}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${dim ? '' : 'text-slate-800'}`}>{r.surveys}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{r.goal.toFixed(1)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={pace != null && pace >= 1 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                            {pace != null ? `${(pace * 100).toFixed(0)}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="text-[10px] text-slate-400 mt-2">
                Greyed rows sit under {data.minN} responses
              </div>
            </div>

            <div className="card">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Overall Satisfaction by range</span>
                <span className="text-[10px] text-slate-400">same data, different windows</span>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  <th className="px-2 py-1.5 text-left font-semibold">Range</th>
                  <th className="px-2 py-1.5 text-right font-semibold">OSAT</th>
                  <th className="px-2 py-1.5 text-right font-semibold">n</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Read</th>
                </tr></thead>
                <tbody>
                  {data.ranges.map(r => {
                    const dim = r.surveys < data.minN
                    return (
                      <tr key={r.days} className={`border-b border-slate-100 ${dim ? 'text-slate-400' : ''}`}>
                        <td className="px-2 py-1.5 font-medium">{r.label}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${dim ? '' : 'text-slate-800'}`}>{pct(r.osat)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{r.surveys}</td>
                        <td className="px-2 py-1.5 text-right text-[11px]">
                          {dim ? <span className="text-slate-400">too few</span>
                            : (r.osat ?? 0) >= 0.9 ? <span className="text-emerald-600 font-semibold">at target</span>
                              : <span className="text-red-600 font-semibold">below 90%</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="text-[10px] text-slate-400 mt-2">
                Target 90% · a wider window is the store&apos;s real level
              </div>
            </div>
          </div>

          {/* weekly, daily folded underneath */}
          {data.weekly.length > 0 && (
            <div className="card">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Overall Satisfaction — weekly</span>
                <span className="text-[10px] text-slate-400">within the selected range</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {data.weekly.map(w => {
                  const dim = w.n < data.minN
                  const bad = (w.osat ?? 1) < 0.8
                  return (
                    <div key={w.start} className="grid grid-cols-[86px_1fr_92px] items-center gap-3 text-[11.5px]">
                      <span className="text-slate-500 tabular-nums">{md(w.start)}–{md(w.end)}</span>
                      <div className="relative h-4 bg-slate-100 rounded">
                        <div className={`absolute inset-y-0 left-0 rounded ${dim ? 'bg-slate-300' : bad ? 'bg-red-500' : 'bg-teal-400'}`}
                          style={{ width: `${((w.osat ?? 0) * 100).toFixed(0)}%` }} />
                      </div>
                      <span className={`text-right tabular-nums font-semibold ${dim ? 'text-slate-400' : 'text-slate-700'}`}>
                        {pct(w.osat)} <span className="font-normal text-slate-400">n={w.n}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="text-[10px] text-slate-400 mt-2">
                Grey bars sit under {data.minN} responses — shown for completeness, not to be read as movement
              </div>

              <details className="border-t border-slate-100 mt-3 group">
                <summary className="list-none cursor-pointer py-2 flex items-center gap-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 rounded-md">
                  <svg className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 3l5 5-5 5" /></svg>
                  Daily detail — {data.daily.length} day{data.daily.length === 1 ? '' : 's'} with responses
                </summary>
                <table className="w-full text-xs mb-2">
                  <thead><tr className="text-slate-400 border-b border-slate-200">
                    <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Responses</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Top box</th>
                    <th className="px-2 py-1.5 text-right font-semibold">OSAT</th>
                  </tr></thead>
                  <tbody>
                    {data.daily.map(d => (
                      <tr key={d.date} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-700">{md(d.date)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{d.n}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{d.topbox}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-bold text-slate-800">{pct(d.osat)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td className="px-2 py-1.5 font-bold text-slate-700">Total</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{data.daily.reduce((a, d) => a + Number(d.n), 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{data.daily.reduce((a, d) => a + Number(d.topbox), 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{pct(data.osat?.value ?? null)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="text-[10px] text-slate-400">
                  Top-box counts stored per day are what make any range exact — these days sum to the figure above.
                </div>
              </details>
            </div>
          )}

          {/* all metrics */}
          <div className="card">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">All survey metrics</span>
              <span className="text-[10px] text-slate-400">
                {data.scoreScope}{data.combinedScores && ' · one SMG login covers both, so these two cannot be separated'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  <th className="px-2 py-1.5 text-left font-semibold">Metric</th>
                  <th className="px-2 py-1.5 text-right font-semibold">This range</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Prior</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Change</th>
                  <th className="px-2 py-1.5 text-right font-semibold">n</th>
                </tr></thead>
                <tbody>
                  {data.scores.map(s => (
                    <tr key={s.metric} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{s.metric}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${s.n < data.minN ? 'text-slate-400' : 'text-slate-800'}`}>{pct(s.value)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{pct(s.prior)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums"><Delta cur={s.value} prior={s.prior} /></td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{s.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          </Section>}

          {/* 3 — commentary */}
          <Section n={3} title="Commentary" source="SMG Comments report · survey, Contact Us and SOCi">
          <div className="card">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">What guests talk about</span>
              <span className="text-[10px] text-slate-400">
                {data.counts.comments} comments, {data.counts.negative} negative · Contact Us and SOCi tracked separately
              </span>
            </div>
            <div className="flex gap-4 text-[11px] text-slate-500 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> positive</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" /> negative</span>
              <span className="text-slate-400">select a theme for its sub-topics and the comments behind it</span>
            </div>
            <div className="grid grid-cols-[1fr_64px_52px_96px_16px] gap-3 px-1 pb-1.5 border-b border-slate-200
              text-[11px] font-semibold text-slate-400">
              <span>Theme</span><span className="text-right">Mentions</span>
              <span className="text-right">Pos</span><span>Split</span><span />
            </div>
            {data.themes.length === 0
              ? <div className="text-xs text-slate-400 py-3">No tagged comments in this range.</div>
              : data.themes.map(t => <Theme key={t.theme} t={t} />)}
          </div>

          </Section>

          {/* 4 — reviews */}
          <Section n={4} title="Reviews" source="SOCi · Google and Yelp"
            note={store === 'pines' || store === 'miramar' ? 'Margate only' : undefined}>
          <div className="card">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reviews</span>
              <span className="text-[10px] text-slate-400">
                {store === 'pines' || store === 'miramar' ? 'SOCi covers Margate only' : `${data.reviews.length} in range · Google + Yelp`}
              </span>
            </div>
            {data.reviews.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">
                {store === 'pines' || store === 'miramar' ? 'Not connected for this store.' : 'No reviews left in this range.'}
              </div>
            ) : data.compare ? (
              // On All the review list is Margate-only, so it can't join the comparison —
              // fold it away rather than let one store's raw feed sit among cross-store tables.
              <details className="group">
                <summary className="list-none cursor-pointer py-1.5 flex items-center gap-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 rounded-md">
                  <svg className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 3l5 5-5 5" /></svg>
                  {data.reviews.length} review{data.reviews.length === 1 ? '' : 's'} — Margate only, not comparable across stores
                </summary>
                <div className="max-h-[420px] overflow-y-auto mt-1">
                  {data.reviews.map((r, i) => (
                    <div key={i} className="py-2.5 border-t border-slate-100 first:border-t-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className="text-amber-400 text-xs">{'★'.repeat(r.rating ?? 0)}{'☆'.repeat(5 - (r.rating ?? 0))}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums">{md(r.when)}</span>
                        <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 uppercase">
                          {r.site === 'gmb' ? 'Google' : r.site}
                        </span>
                        {r.reviewer && <span className="text-[11px] font-semibold text-slate-500">{r.reviewer}</span>}
                        {!r.replied && <span className="text-[10px] font-semibold text-red-600">no reply</span>}
                      </div>
                      {r.text && <div className="text-[13px] text-slate-700">{r.text}</div>}
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {data.reviews.map((r, i) => (
                  <div key={i} className="py-2.5 border-t border-slate-100 first:border-t-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-amber-400 text-xs">{'★'.repeat(r.rating ?? 0)}{'☆'.repeat(5 - (r.rating ?? 0))}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{md(r.when)}</span>
                      <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 uppercase">
                        {r.site === 'gmb' ? 'Google' : r.site}
                      </span>
                      {r.reviewer && <span className="text-[11px] font-semibold text-slate-500">{r.reviewer}</span>}
                      {!r.replied && <span className="text-[10px] font-semibold text-red-600">no reply</span>}
                    </div>
                    {r.text && <div className="text-[13px] text-slate-700">{r.text}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          </Section>

        </div>
      )}
    </div>
  )
}
