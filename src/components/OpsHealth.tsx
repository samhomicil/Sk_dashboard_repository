'use client'

import Link from 'next/link'

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

// Same shape as the Void/Discount/Till metrics above: a sub-header naming the metric and
// its target, then the dot and value. Detail lives in the tooltip.
function VTile({ header, target, dot, value, unit, note, tip, tone, emphasis }: {
  header: string
  target?: string
  dot: 'g' | 'y' | 'r'
  value: string
  unit?: string
  note?: string
  tip: string
  tone?: 'bad' | 'dim'
  emphasis?: boolean
}) {
  const cls = tone === 'bad' ? 'text-red-600' : tone === 'dim' ? 'text-slate-400' : 'text-slate-700'
  return (
    <div title={tip}>
      <div className="text-xs font-medium text-slate-700 mb-0.5 truncate">
        {header} {target && <span className="font-normal text-slate-400">{target}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`dot-${dot}`} />
        <span className={`text-lg font-bold ${cls}`}>
          {value}{unit && <span className="text-xs font-normal text-slate-400"> {unit}</span>}
        </span>
        {note && (
          <span className={`text-xs truncate ${emphasis ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
            {note}
          </span>
        )}
      </div>
    </div>
  )
}

function GuestVoiceRow(
  { guest, soci }: { guest?: GuestSummary | null; soci?: SociData | null },
) {
  const tiles: React.ReactNode[] = []
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)

  if (guest?.connected) {
    const { osat, osatPrior, responses, goal, pace, worstMetric, cases } = guest
    const thin = responses > 0 && responses < 10
    const osatOk = osat != null && osat >= TARGETS.osatPct
    const delta = osat != null && osatPrior != null ? osat - osatPrior : null

    tiles.push(
      <VTile key="osat"
        header="Overall Satisfaction" target={`tgt ${(TARGETS.osatPct * 100).toFixed(0)}%`}
        dot={osat == null || thin ? 'y' : osatOk ? 'g' : 'r'}
        value={pct(osat)} tone={thin ? 'dim' : osatOk ? undefined : 'bad'}
        note={thin ? 'too few' : delta != null ? `${delta >= 0 ? '▲' : '▼'}${Math.abs(delta * 100).toFixed(0)}pts` : undefined}
        tip={`${guest.scope} · ${responses} responses in range · target ${(TARGETS.osatPct * 100).toFixed(0)}%`
          + (worstMetric ? ` · weakest: ${worstMetric.metric} ${pct(worstMetric.value)}` : '')
          + (thin ? ' · below 10 responses, widen the range' : '')} />,
      <VTile key="surveys"
        header="Surveys" target={`goal ${TARGETS.surveysPerStoreMonth}/store/mo`}
        dot={pace == null ? 'y' : pace >= 1 ? 'g' : pace >= 0.8 ? 'y' : 'r'}
        value={String(responses)} unit={`/ ${goal.toFixed(0)}`}
        note={pace != null ? `${(pace * 100).toFixed(0)}%` : undefined}
        tip={`Surveys collected vs a ${TARGETS.surveysPerStoreMonth}/store/month goal, prorated to the selected range`} />,
    )
    if (cases) {
      const owed = cases.pending > 0 || cases.overSla > 0
      tiles.push(
        <VTile key="cases"
          header="Incidents" target={`goal ${cases.goalHours}h`}
          dot={cases.opened === 0 ? 'g' : owed ? 'r' : 'y'}
          value={String(cases.opened)} tone={cases.opened ? 'bad' : undefined}
          note={cases.pending ? `${cases.pending} open` : undefined}
          tip={(cases.opened
            ? `Guest-recovery cases opened in range · avg close ${cases.avgHours?.toFixed(0) ?? '—'}h against a ${cases.goalHours}h callback goal · ${cases.overSla} past goal · ${cases.pending} still open`
            : 'No guest complaints raised in this range')
            + (guest.casesCombined ? ' · covers Pines and Miramar together — cases cannot be split by store yet' : '')} />,
      )
    }
  }

  if (soci?.connected) {
    const p = soci.period
    const count = p?.reviews ?? soci.newReviews
    const rating = p?.rating ?? soci.avgRating
    const none = count === 0
    const newest = p && p.newLast7 > 0 ? `${p.newLast7} new in 7d` : 'none in 7d'
    tiles.push(
      <VTile key="rating"
        header="Reviews" target="Google + Yelp"
        dot={none ? 'y' : (rating ?? 0) >= 4.5 ? 'g' : (rating ?? 0) >= 4 ? 'y' : 'r'}
        value={none ? '—' : rating!.toFixed(2)} unit={none ? undefined : '★'}
        tone={none ? 'dim' : undefined}
        note={none ? newest : `${count} · ${newest}`}
        emphasis={Boolean(p && p.newLast7 > 0)}
        tip={`Rating computed from reviews inside the range · lifetime ${soci.avgRating?.toFixed(2) ?? '—'} over ${soci.reviews.total} reviews`
          + (p ? ` · ${p.google} Google in range, ${p.yelp} Yelp lifetime (Yelp can't be sliced by period) · ${p.negative} rated 1–2★` : '')} />,
    )
  }

  if (tiles.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-xs text-slate-400 mb-2">
        <Link href="/guest-voice" className="text-slate-500 hover:text-teal-600 font-medium">
          Guest Voice →
        </Link>
        <span className="text-slate-300 ml-1">— {guest?.scope ?? 'Margate'} · SMG survey + SOCi reviews</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{tiles}</div>
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
      <GuestVoiceRow guest={guest} soci={soci} />
    </div>
  )
}
