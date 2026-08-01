'use client'

// Detail behind the Ops Health "Guest Voice" tiles: every survey metric for the range,
// what guests wrote about, and the reviews they left.
//
// The page has to be honest about one asymmetry. Comments carry the unit that produced
// them, so Pines and Miramar separate cleanly. Scores come from a login covering both and
// cannot be filtered by unit, so those two share a figure. Each section labels its own scope.

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import type { GuestVoiceDetail, ThemeRow } from '@/app/api/guest-voice/route'

const STORES = ['all', 'margate', 'pines', 'miramar'] as const
const STORE_LABEL: Record<string, string> = {
  all: 'All', margate: 'Margate', pines: 'Pines', miramar: 'Miramar',
}
const RANGES = [
  { key: '7', label: 'Last 7d' },
  { key: '14', label: 'Last 14d' },
  { key: '30', label: 'Last 30d' },
  { key: '90', label: 'Last 90d' },
] as const

// SMG suppresses its own display under 10 responses; a score on fewer moves 20+ points
// on one guest, so it is shown but never coloured.
const MIN_N = 10

const pct = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(d)}%`
const shortDate = (s: string | null) => (s ? s.slice(5, 16).replace('-', '/') : '')

function Delta({ cur, prior }: { cur: number | null; prior: number | null }) {
  if (cur == null || prior == null) return <span className="text-slate-300">—</span>
  const d = (cur - prior) * 100
  if (Math.abs(d) < 0.5) return <span className="text-slate-400">flat</span>
  return (
    <span className={d > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
      {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(0)}pts
    </span>
  )
}

function SentimentBar({ t }: { t: ThemeRow }) {
  const total = t.mentions || 1
  const pos = (t.positive / total) * 100
  const neg = (t.negative / total) * 100
  return (
    <div className="flex h-2 w-full min-w-[70px] rounded-sm overflow-hidden bg-slate-100 gap-[2px]">
      {pos > 0 && <div style={{ width: `${pos}%` }} className="bg-emerald-600 rounded-l-sm" />}
      {neg > 0 && <div style={{ width: `${neg}%` }} className="bg-red-600 rounded-r-sm" />}
    </div>
  )
}

export default function GuestVoicePage() {
  const [data, setData] = useState<GuestVoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<string>('all')
  const [days, setDays] = useState<string>('30')
  const [theme, setTheme] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const end = new Date()
    const start = new Date(end.getTime() - (Number(days) - 1) * 86_400_000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    fetch(`/api/guest-voice?store=${store}&start=${iso(start)}&end=${iso(end)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [store, days])

  // Selecting a theme filters the comment list to comments carrying it.
  const comments = useMemo(() => {
    const all = data?.comments ?? []
    return theme ? all.filter(c => (c.themes ?? '').split(',').map(s => s.trim()).includes(theme)) : all
  }, [data, theme])

  const osat = data?.scores.find(s => s.metric === 'Overall Satisfaction')
  const subs = data?.scores.filter(s => s.metric !== 'Overall Satisfaction') ?? []

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 lg:px-10 w-full max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors">
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
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setDays(r.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${days === r.key ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {STORES.map(k => (
              <button key={k} onClick={() => setStore(k)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${store === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
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

          {/* scores */}
          <div className="card">
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Survey scores</span>
              <span className="text-[10px] text-slate-400">
                {data.scoreScope}
                {data.combinedScores && ' · one SMG login covers both, so these two cannot be separated'}
              </span>
            </div>

            {osat && (
              <div className="flex items-end gap-5 pb-3 mb-3 border-b border-slate-100 flex-wrap">
                <div>
                  <div className="text-xs text-slate-400">Overall Satisfaction</div>
                  <div className={`text-3xl font-bold ${osat.value != null && osat.value < 0.9 ? 'text-red-600' : 'text-slate-800'}`}>
                    {pct(osat.value)}
                  </div>
                </div>
                <div className="pb-1 text-sm"><Delta cur={osat.value} prior={osat.prior} /></div>
                <div className="pb-1 text-xs text-slate-400">
                  {osat.n} response{osat.n === 1 ? '' : 's'} · target 90%
                  {osat.n < MIN_N && <span className="ml-1 text-amber-600">· too few to read</span>}
                </div>
              </div>
            )}

            {subs.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No scored metrics in this range.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-200">
                      <th className="px-2 py-1.5 text-left font-semibold">Metric</th>
                      <th className="px-2 py-1.5 text-right font-semibold">This range</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Prior</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Change</th>
                      <th className="px-2 py-1.5 text-right font-semibold">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map(s => (
                      <tr key={s.metric} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{s.metric}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${s.n < MIN_N ? 'text-slate-400' : 'text-slate-800'}`}>{pct(s.value)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{pct(s.prior)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums"><Delta cur={s.value} prior={s.prior} /></td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">
                          {s.n}{s.n < MIN_N && <span className="text-amber-500 ml-0.5">*</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[10px] text-slate-400 mt-2">
              <span className="text-amber-500">*</span> under {MIN_N} responses — shown, not coloured
            </div>
          </div>

          {/* themes + comments */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="card lg:col-span-1">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Themes</span>
                <span className="text-[10px] text-slate-400">survey comments</span>
              </div>
              {data.themes.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">No tagged comments in this range.</div>
              ) : (
                <div className="space-y-1">
                  {theme && (
                    <button onClick={() => setTheme(null)}
                      className="text-[11px] text-teal-600 hover:underline mb-1">← all comments</button>
                  )}
                  {data.themes.map(t => {
                    const on = theme === t.theme
                    return (
                      <button key={t.theme} onClick={() => setTheme(on ? null : t.theme)}
                        className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${on ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-700 truncate">{t.theme}</span>
                          <span className="tabular-nums text-slate-400 shrink-0">
                            {t.mentions}
                            {t.negative > 0 && <span className="ml-1 text-red-600 font-semibold">{t.negative} neg</span>}
                          </span>
                        </div>
                        <div className="mt-1"><SentimentBar t={t} /></div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="card lg:col-span-2">
              <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  What guests wrote {theme && <span className="text-teal-600 normal-case font-medium">· {theme}</span>}
                </span>
                <span className="text-[10px] text-slate-400">
                  {comments.length} comment{comments.length === 1 ? '' : 's'} · negative first
                </span>
              </div>
              {comments.length === 0 ? (
                <div className="text-xs text-slate-400 py-3">No comments in this range.</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
                  {comments.map((c, i) => (
                    <div key={i} className={`py-2.5 ${c.sentiment < 0 ? 'border-l-2 border-red-500 pl-3 -ml-3' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[11px] text-slate-400 tabular-nums">{shortDate(c.when) || 'no date'}</span>
                        {c.osat != null && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.osat >= 5 ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-600'}`}>
                            OSAT {c.osat}
                          </span>
                        )}
                        {c.source !== 'Survey' && (
                          <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">{c.source}</span>
                        )}
                        {data.commentScope === 'all stores' && (
                          <span className="text-[10px] text-slate-400">{c.store}</span>
                        )}
                        {c.question && <span className="text-[11px] font-semibold text-slate-500">{c.question}</span>}
                      </div>
                      <div className="text-[13px] text-slate-700">{c.text}</div>
                      {c.themes && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.themes.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                            <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.sentiment < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* reviews */}
          <div className="card">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reviews</span>
              <span className="text-[10px] text-slate-400">
                {store === 'pines' || store === 'miramar'
                  ? 'SOCi covers Margate only'
                  : `${data.reviews.length} in range · Google + Yelp`}
              </span>
            </div>
            {data.reviews.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">
                {store === 'pines' || store === 'miramar'
                  ? 'Not connected for this store.'
                  : 'No reviews left in this range.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                {data.reviews.map((r, i) => (
                  <div key={i} className="py-2.5">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-amber-400 text-xs">
                        {'★'.repeat(r.rating ?? 0)}{'☆'.repeat(5 - (r.rating ?? 0))}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{shortDate(r.when)}</span>
                      <span className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 uppercase">
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

        </div>
      )}
    </div>
  )
}
