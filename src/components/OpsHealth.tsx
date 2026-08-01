'use client'

import type { KpiData } from '@/lib/types'
import type { SociData } from '@/app/api/soci/route'
import type { GuestSummary } from '@/app/api/guest-satisfaction/route'
import { TARGETS } from '@/lib/config'

interface Props {
  kpis:    KpiData | null
  soci?:   SociData | null
  guest?:  GuestSummary | null
  loading: boolean
}

function pct(n: number) { return `${(n * 100).toFixed(1)}%` }
function dol(n: number) { return n >= 0 ? `+$${Math.abs(Math.round(n))}` : `-$${Math.abs(Math.round(n))}` }

function ReviewRow({ soci }: { soci: SociData }) {
  const p = soci.period
  const rating = p?.rating ?? soci.avgRating
  const count = p?.reviews ?? soci.newReviews
  const stars = rating ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating)) : ''

  // No reviews in range is normal at this volume — say so rather than render 0 stars.
  const none = count === 0
  const ratingDot = none ? 'dot-y' : (rating ?? 0) >= 4.5 ? 'dot-g' : (rating ?? 0) >= 4 ? 'dot-y' : 'dot-r'
  const negDot = !p ? 'dot-y' : p.negative === 0 ? 'dot-g' : p.negative <= 2 ? 'dot-y' : 'dot-r'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="flex items-start gap-2">
        <span className={`mt-1 ${ratingDot}`} />
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-bold ${none ? 'text-slate-400' : 'text-slate-700'}`}>
              {none ? '—' : rating!.toFixed(2)}
            </span>
            {!none && <span className="text-amber-400 text-sm">{stars}</span>}
          </div>
          <div className="text-xs text-slate-500">
            {none ? 'no reviews this period' : `avg of ${count} review${count === 1 ? '' : 's'} in range`}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Lifetime {soci.avgRating?.toFixed(2) ?? '—'} over {soci.reviews.total}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <span className={`mt-1 ${count ? 'dot-g' : 'dot-y'}`} />
        <div>
          <div className="text-lg font-bold text-slate-700">
            {count}<span className="text-xs font-normal text-slate-400"> review{count === 1 ? '' : 's'}</span>
          </div>
          <div className="text-xs text-slate-500">
            {p ? `${p.google} Google · ${p.yelp} Yelp (lifetime)` : `${soci.reviews.gmb} Google · ${soci.reviews.yelp} Yelp`}
          </div>
          <div className="text-xs mt-0.5">
            {p && p.newLast7 > 0
              ? <span className="text-emerald-600 font-semibold">{p.newLast7} new in last 7 days</span>
              : <span className="text-slate-400">none in the last 7 days</span>}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <span className={`mt-1 ${negDot}`} />
        <div>
          <div className={`text-lg font-bold ${p?.negative ? 'text-red-600' : 'text-slate-700'}`}>
            {p?.negative ?? '—'}<span className="text-xs font-normal text-slate-400"> negative</span>
          </div>
          <div className="text-xs text-slate-500">1–2★ reviews in range</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {p ? `${p.replied} of ${p.reviews} replied to` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

function GuestRow({ guest }: { guest: GuestSummary }) {
  const { osat, osatPrior, responses, goal, pace, worstMetric, cases } = guest

  // SMG suppresses its own display under 10 responses; below that we show the number but
  // don't colour it, because one guest moves it 20+ points.
  const thin = responses > 0 && responses < 10
  const osatOk = osat != null && osat >= TARGETS.osatPct
  const osatDot = osat == null || thin ? 'dot-y' : osatOk ? 'dot-g' : 'dot-r'
  const delta = osat != null && osatPrior != null ? osat - osatPrior : null

  const paceOk = (pace ?? 0) >= 1
  const paceDot = pace == null ? 'dot-y' : paceOk ? 'dot-g' : (pace >= 0.8 ? 'dot-y' : 'dot-r')

  // Incidents = guest-recovery cases opened in the window. Green only when there were
  // none; any case that blew the 24h callback goal is red regardless of count.
  const inc = cases?.opened ?? null
  const overSla = cases?.overSla ?? 0
  const incDot = inc == null ? 'dot-y' : inc === 0 ? 'dot-g'
    : (cases?.pending ?? 0) > 0 || overSla > 0 ? 'dot-r' : 'dot-y'
  const avgHrs = cases?.avgHours ?? null
  const pending = cases?.pending ?? 0

  const fmt = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)

  return (
    <div>
      <div className="text-xs text-slate-400 mb-2">
        Surveys <span className="text-slate-300">— {guest.scope} (SMG)</span>
        {guest.combined && (
          <span className="ml-1 text-slate-300">· one SMG login covers both, so they can&apos;t be split</span>
        )}
        {guest.coverageFrom && guest.range && guest.coverageFrom > guest.range.start && (
          <span className="ml-1 text-amber-600">· only has data from {guest.coverageFrom}</span>
        )}
        {guest.source === 'period' && (
          <span className="ml-1 text-slate-300">· nearest period, not the selected range</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-start gap-2">
          <span className={`mt-1 ${osatDot}`} />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-lg font-bold ${thin ? 'text-slate-400' : osatOk ? 'text-slate-700' : 'text-red-600'}`}>
                {fmt(osat)}
              </span>
              <span className="text-xs text-slate-400">OSAT</span>
              {delta != null && !thin && (
                <span className={`text-xs font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta >= 0 ? '▲' : '▼'}{Math.abs(delta * 100).toFixed(0)}pts
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              {responses} response{responses === 1 ? '' : 's'} · tgt {(TARGETS.osatPct * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {thin ? 'Too few to read — widen the range'
                : worstMetric ? `Weakest: ${worstMetric.metric} ${fmt(worstMetric.value)}`
                : 'All metrics tracking'}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <span className={`mt-1 ${paceDot}`} />
          <div>
            <div className="text-lg font-bold text-slate-700">
              {responses}<span className="text-xs font-normal text-slate-400"> / {goal.toFixed(0)} surveys</span>
            </div>
            <div className="text-xs text-slate-500">
              {pace != null ? `${(pace * 100).toFixed(0)}% of pace` : '—'} · goal {TARGETS.surveysPerStoreMonth}/store/mo
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {paceOk ? 'Collection on target' : 'Behind on survey collection'}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <span className={`mt-1 ${incDot}`} />
          <div>
            <div className={`text-lg font-bold ${inc ? 'text-red-600' : inc == null ? 'text-slate-400' : 'text-slate-700'}`}>
              {inc ?? '—'}<span className="text-xs font-normal text-slate-400"> incident{inc === 1 ? '' : 's'}</span>
            </div>
            <div className="text-xs text-slate-500">
              {inc
                ? `avg ${avgHrs ? avgHrs.toFixed(0) : '—'}h vs ${cases?.goalHours ?? 24}h callback goal`
                : inc === 0 ? 'no guest complaints raised' : 'case feed not loaded yet'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {inc == null ? ''
                : pending > 0 ? `${pending} still open — guest waiting`
                : overSla > 0 ? `${overSla} past the ${cases?.goalHours ?? 24}h goal`
                : inc ? 'All handled within goal' : 'Nothing outstanding'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OpsHealth({ kpis, soci, guest, loading }: Props) {
  if (loading) return <div className="card md:col-span-2"><div className="skeleton h-24 w-full" /></div>
  if (!kpis) return null

  const voidOk     = kpis.voidPct     <= TARGETS.voidPct
  const discOk     = kpis.discountPct <= TARGETS.discountPct
  const tillOk     = kpis.tillVariance >= -20 // within -$20 is fine
  const allOk      = voidOk && discOk && tillOk

  const metrics = [
    {
      label: 'Void %',
      target: `<${pct(TARGETS.voidPct)}`,
      value: pct(kpis.voidPct),
      l4w: pct(kpis.voidPctL4W),
      ok: voidOk,
      warn: kpis.voidPct <= TARGETS.voidPct * 1.5,
    },
    {
      label: 'Discount %',
      target: `<${pct(TARGETS.discountPct)}`,
      value: pct(kpis.discountPct),
      l4w: pct(kpis.discountPctL4W),
      ok: discOk,
      warn: kpis.discountPct <= TARGETS.discountPct * 1.2,
    },
    {
      label: 'Till Variance',
      target: '> -$20',
      value: dol(kpis.tillVariance),
      l4w: dol(kpis.tillVarianceL4W),
      ok: tillOk,
      warn: kpis.tillVariance >= -50,
    },
  ]

  return (
    <div className="card md:col-span-2 border border-slate-100">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        Ops Health
        <span className="ml-1 font-normal text-slate-300">— flagged only if outside threshold</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="flex sm:block items-center gap-4 py-2 sm:py-0 border-b sm:border-b-0 border-slate-50 last:border-0">
            <div className="w-28 sm:w-auto shrink-0">
              <div className="text-xs text-slate-500 mb-0.5">
                {m.label} <span className="text-slate-300">{m.target}</span>
              </div>
              <div className="text-xs text-slate-400">L4W: <span className="font-semibold text-slate-500">{m.l4w}</span></div>
            </div>
            <div className="flex items-center gap-2">
              <span className={m.ok ? 'dot-g' : m.warn ? 'dot-y' : 'dot-r'} />
              <span className={`text-lg font-bold ${m.ok ? 'text-slate-700' : m.warn ? 'text-amber-600' : 'text-red-600'}`}>
                {m.value}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${allOk ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        {allOk
          ? '✅ All ops metrics within target — no action needed'
          : `⚠️ ${metrics.filter(m => !m.ok).map(m => m.label).join(', ')} outside target — review needed`
        }
      </div>
      {(guest?.connected || soci?.connected) && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Guest Voice
          </div>
          <div className="space-y-3">
            {guest?.connected && <GuestRow guest={guest} />}
            {soci?.connected && (
              <div className={guest?.connected ? 'pt-3 border-t border-slate-50' : ''}>
                <div className="text-xs text-slate-400 mb-2">
                  Reviews <span className="text-slate-300">— Margate (SOCi)</span>
                </div>
                <ReviewRow soci={soci} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
