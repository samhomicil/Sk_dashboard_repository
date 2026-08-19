/**
 * /design — the living specimen of the design system.
 *
 * The handoff ships static `.card.html` specimens; those go stale the moment the
 * components move. This renders the REAL components, so what you see here is what
 * the modules get, and a regression shows up on one page instead of thirteen.
 *
 * Deliberately fake, self-evidently fake numbers. No data source, no rules, no
 * store names attached to figures that could be mistaken for real ones.
 */
import type { Metadata } from 'next'
import { Page, PageBar, TakeCard, FlagList, Tile, Tiles, BasisNote } from '@/components/design/shell'
import { UnknownValue, NotMeasured, NeedsInput, CertaintySplit, CertaintyLegend } from '@/components/design/states'
import { DataTable, type Col, type Row } from '@/components/design/DataTable'

export const metadata: Metadata = { title: 'Design system — Hispaniola Wellness' }

const money = (n: number) => `$${n.toLocaleString()}`

const COLS: Col[] = [
  { key: 'name', head: 'Row' },
  { key: 'sales', head: 'Sales', num: true },
  { key: 'labor', head: 'Labor', num: true, divider: true },
]

// Cells are formatted here, on the server, and handed over pre-rendered.
const ROWS: Row[] = [
  {
    key: 'parent',
    cells: ['Expandable parent', money(3000), money(660)],
    values: [null, 3000, 660],
    children: [
      { key: 'a', cells: ['Child A', money(1800), money(400)], values: [null, 1800, 400] },
      { key: 'b', cells: ['Child B', money(1200), money(260)], values: [null, 1200, 260] },
    ],
  },
  {
    key: 'unknown',
    cells: [
      'Unattributed',
      <UnknownValue key="u" reason="No POS attribution on this ticket — this is not a zero sale." />,
      money(120),
    ],
    values: [null, null, 120],
  },
  {
    key: 'salaried',
    cells: ['Salaried row', money(900), <NotMeasured key="n" reason="Salaried — an hourly cost does not apply." />],
    values: [null, 900, null],
  },
  { key: 'paused', cells: ['Paused — sorts last', money(0), money(0)], values: [null, 0, 0], muted: true },
  { key: 'total', cells: ['Total', money(3900), money(780)], values: [null, 3900, 780], total: true },
]

export default function DesignSystemPage() {
  return (
    <Page>
      <PageBar
        eyebrow="Reference"
        title="Design system"
        meta="Specimen page · figures are fake"
      >
        <span className="sk-meta">filters live here, per screen</span>
      </PageBar>

      <TakeCard tone="warn" label="Specimen" headline="This is a TakeCard — the verdict, not the metric.">
        Written as the decision someone is about to make, with the reason derived from the data
        rather than hardcoded. The evidence proves it below; it never opens the screen.
      </TakeCard>

      <FlagList
        flags={[
          { tone: 'bad', who: 'A bad flag', scope: 'scope', text: 'sorts first, and sets the card’s left rule.' },
          { tone: 'warn', who: 'A warn flag', text: 'sorts under it.' },
        ]}
      />

      <FlagList title="Empty is a real result" flags={[]} />

      <Tiles>
        <Tile label="Hero figure" value="52.0%" target="target 52.0%" hero />
        <Tile label="Over" value="24.1%" target="target 22.0%" tone="bad" />
        <Tile label="Under" value="21.2%" target="target 22.0%" tone="good" />
        <Tile label="Blocked upstream" value={<NeedsInput reason="A %-of-sales bill with no sales yet." />} />
      </Tiles>

      <div className="sk-card">
        <h3 className="sk-card-title">Evidence</h3>
        <p className="sk-take-why" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          Expand the parent: children sum to it, or the console says so in development.
        </p>
        <DataTable cols={COLS} rows={ROWS} caption="Specimen table" />
      </div>

      <div className="sk-card">
        <h3 className="sk-card-title">Certainty</h3>
        <p className="sk-take-why" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          How much of a figure is real yet. The legend is required wherever the bar appears.
        </p>
        <CertaintySplit actual={60} committed={25} forecast={15} width={220} />
        <div style={{ marginTop: 12 }}>
          <CertaintyLegend />
        </div>
      </div>

      <BasisNote>
        Every number on this page is invented. The system carries no thresholds of its own — a
        tone is passed in by the screen, which reads it from <code>src/lib/core/targets.ts</code>.
      </BasisNote>
    </Page>
  )
}
