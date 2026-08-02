# Employee Labor Module — Design v0.1

Design only. Nothing built. Data facts below were verified live against Azure SQL on
2026-08-02 via the Flask proxy; every number is reproducible.

---

## 0. Read this first — three findings that shape the whole module

> **F1 CORRECTED 2026-08-02 (third revision — read §1.1 before acting on this section).**
> The ten employees are **not** unprovisioned. Brink's own `EmployeeSalesSummary` report
> attributes every one of them, with full order counts and sales. The fault is in our
> item-sales export, not the POS. No operational fix is needed. The text below is kept
> because the store-level decay figures remain accurate; the *cause* stated in it is wrong.

**F1. Every employee hired since 2026-05-05 is invisible on the POS.** This is the
headline, and it is much more specific than "attribution is decaying."

Ten current employees have **zero `sales` rows in all of 2026** despite 1,906 combined
worked hours. Their first shifts cluster tightly: Allen, Ion, Vasques-Escobar (all May 5),
Simmons (May 14), Dor + Mercado (May 23), Ayalew (May 26), Schirmer (May 28), Woods +
Jarrett (late June). Every one of them **runs a cash drawer** — 94 drawer sessions in
`tillhistory` between them — so they are demonstrably operating registers. Their rings are
landing under someone else's login or none at all.

That exactly explains the store-level decay, which starts the same week:

| Store | Mar | Apr | May | Jun | Jul |
|---|---|---|---|---|---|
| Margate | 0.0% | 1.1% | 4.0% | 20.6% | **19.5%** |
| Pines | 0.0% | 1.3% | 15.2% | 27.5% | **31.8%** |
| Miramar | 0.0% | 8.9% | 25.6% | 52.8% | **61.2%** |

*(in-store rows with no employee attached; order-grain July: Margate 18.4%, Pines 29.8%,
Miramar 61.1%. Distinct cashiers on Miramar's POS fell 20 → 8 since February.)*

**The likely cause is a new-hire provisioning gap** — added to Brink timekeeping and given
a drawer, never created as a POS user. That is a checkable, fixable onboarding step, not a
culture problem. Six of the ten are Miramar, which is why Miramar looks worst.

Consequences: no productivity metric can be trusted for these ten, and — more seriously —
their sales, voids, and discounts are being attributed to whoever's login they borrow,
which contaminates loss-prevention for *both* people.

**F2. The name-format problem is already solved in your codebase.** I was wrong to call it
a blocker in my first pass; see §2. Residual mismatch is ~3 people, from nicknames and
spelling drift.

**F3. Everything else you asked for is already sitting in the database.** Scheduled vs
worked, punctuality, till variance, voids/discounts, SOP completion, guest feedback,
pay rate — all present and joinable today. The module is mostly assembly, not acquisition.

---

## 1. Data inventory (verified 2026-08-02)

| Table | Grain | Coverage | Rows / people | Employee-grained? |
|---|---|---|---|---|
| `labor` | one worked shift | 2026-01-01 → 08-01 | 3,487 / 81 | ✅ the spine |
| `labor_schedule` | one scheduled shift | 2026-07-14 → 08-10 | 416 / 36 | ✅ |
| `labor_edits` | one timecard edit | 2026-06-07 → 07-31 | 1,426 / 36 | ✅ + `edited_by` |
| `tillhistory` | one drawer session | 2026-01-01 → 08-02 | 2,178 / 103* | ✅ |
| `sales` | one line item | 2023-01-01 → 2026-08-01 | 1,657,019 / 217* | ⚠️ see F1 |
| `jolt_task_completions` | one SOP task | 7-day rolling | 819 / 15 | ✅ `completed_by` |
| `jolt_list_instances` | one checklist run | full history | — | ✅ `submitted_by` |
| `guest_comments` | one survey verbatim | 2026-07-19 → 08-02 | **18** / — | ⚠️ via crew-on-shift |
| `guest_cases` | daily aggregate | Feb → Aug | — | ❌ store grain only |

\* person counts inflated by the name-format duplication in F2.

**Retention warning:** `jolt_task_completions` keeps only 7 days by design; only
`jolt_list_instances` is full history. Any per-person SOP metric must either snapshot
weekly or accept a 7-day window.

**`guest_comments` is 18 rows.** The 95% crew-join match rate recorded in memory refers to
a 284-comment pull that is not in this table. Design the complaint→shift join now, but
expect it to be anecdotal for months at Margate's ~25 surveys/month.

---

## 1.1 F1 resolved — it is a pipeline bug, not a POS problem

Ran Brink's `EmployeeSalesSummary` live for the week of 7/20, all three stores. **All ten
"invisible" employees are there**, with real volume:

| Store | Employee | Brink orders | Brink gross | In `sales` table |
|---|---|---|---|---|
| Miramar | Catlyn Simmons | 156 | $1,817.43 | ❌ |
| Pines | Isabella Vasques-Escobar | 135 | $1,657.22 | ❌ |
| Pines | Nicholas Ion | 114 | $1,390.27 | ❌ |
| Miramar | Anthony Woods | 111 | $1,408.19 | ❌ |
| Miramar | Jason Allen | 90 | $1,074.67 | ❌ |
| Miramar | Sebastian Mercado | 77 | $935.13 | ❌ |
| Margate | Blen Ayalew | 63 | $701.06 | ❌ |
| Miramar | Sterline Dor | 44 | $514.11 | ❌ |
| Miramar | Saniyah Jarrett | 14 | $221.93 | ❌ |
| Margate | Tia Schirmer | 7 | $94.07 | ❌ |

Employee counts for that week: Brink 9 / 13 / 11 (Pines/Miramar/Margate) vs `sales` 7 / 7 / 9.

**They are ringing under their own logins. Brink knows exactly who they are.** The
`itemsales` export path (`brink/itemsales.py`, Export/Sales all-locations) is dropping the
employee stamp for these people — most likely a newer POS-user field the OC export doesn't
carry. So:

- There is **no onboarding gap to fix** and nothing to chase with managers. My earlier
  "provisioning" diagnosis was wrong.
- Per-employee productivity is **fully recoverable today** by adding
  `EmployeeSalesSummary` to the extractor — including Miramar.
- Productivity moves from last in the build order to available immediately.

`EmployeeSalesSummary` columns (verified): `Employee Name, Ideal Orders, Orders, Guests,
Gross Sales, ASG, AST, ATT, TPP` — ASG = gross ÷ guests, AST = gross ÷ orders, and ATT/TPP
are **per-employee service times**. That is a better productivity feed than anything
derivable from the `sales` table, and it is immune to the attribution bug by construction.

*(CSV caveat: long rows wrap, so the trailing column lands on the next line — parse by
accumulating until the expected field count, same class of problem as the banded timecard.)*

---

## 1.5 What already exists — reuse, don't rebuild

The weekly dashboard already has an Employee Labor table and a working identity layer.
Anything below should be extended, not reimplemented.

| Piece | Location | What it does |
|---|---|---|
| Employee Labor table | `src/components/EmployeeTable.tsx` | Employee · Store · Role · Rate · Hours · Pay · Sales/Hr · EE% |
| Row builder | `src/lib/cache-builder.ts:332` `fetchEmployees()` | aggregates shifts → per-person rows |
| Shift source | `src/lib/salesCache.ts:159` `sqlEmployeeShifts()` | reads `smoothieking.labor`, splits "Last, First" |
| **Name resolution** | `src/lib/cache-builder.ts:95` `fetchEmployeeEE()` | **handles both name formats, keys `last\|first` lowercased** |
| Store maps | `cache-builder.ts:325`, `salesCache.ts:157` | `LOC_CODE_SHORT`, `LOC_CODE_TO_STORE_KEY`, `STORE_TO_LOC` |
| Labor cost rules | `src/lib/core/labor.ts` | most-recent rate, store-avg fallback, scheduled cost |
| Targets / exclusions | `src/lib/core/targets.ts` | `LABOR_EXCLUDE_ROLES`, `DEFAULT_RATE`, `STORES` |

Guards already implemented and worth keeping: EE% suppressed below 5 attributed orders,
sales/hr suppressed below 4 hours, owner/franchisee roles filtered out, `NON_EMP`/`Support`
excluded, and `hoursByLoc` assigns a primary store by most hours (so cross-store workers
are handled).

### One defect worth fixing in the existing table

`fetchEmployees()` line 409 does `salesPerHour: empSalesPerHour ?? storeSalesPerHour`.
When a person has no attributed sales, the cell silently falls back to the **store**
average and renders identically to a real per-person number. For the week of 7/20:
**21 of 31 employees show a true per-person figure; 10 show the store average** — and
those 10 are exactly the F1 group. The column reads as person-level performance while a
third of it is store-level. The table's caption ("Source: Sigma Labor · Sales/hr is
store-level") is also stale — the source is now `smoothieking.labor`.

Fix: return a `salesSource: 'employee' | 'store'` flag and render the fallback greyed with
a tooltip, or as "—". Same idea as the coverage gauge in §5.1.

---

## 2. Employee identity — smaller problem than I first said

Three naming conventions are live: `labor`/`labor_schedule` use **"Last, First"**;
`sales`/`tillhistory`/`jolt` use **"First Last"**; and `tillhistory` flipped to
"Last, First" for April–May 2026 only (375 rows) before flipping back.

**But `fetchEmployeeEE()` already normalizes all of this** to a `last|first` lowercased
key. I re-tested that exact algorithm across every table (June 1+):

| Join | Match rate | Unmatched |
|---|---|---|
| labor ↔ `tillhistory` | **35/35 (100%)** | — (the Apr–May format flip collapses correctly) |
| labor ↔ `sales` | **26/27 (96%)** | only the `Support (DO NOT DELETE)` placeholder |
| labor ↔ `labor_schedule` | 33/36 (92%) | `Madaffari, Dan` vs `Daniel`; `Vasquez-` vs `Vasques-Escobar`; one termed |
| labor ↔ `jolt` | 13/15 (87%) | `Tome, Isabelle` vs `Isabella`; `St. Fleur, Naveah` vs `Nevaeh` |

My earlier "35 of 80" was an artifact of comparing full name strings; the real key does far
better. **Correction to my first pass: Natalia Piedrahita's till history is not split** —
the key merges both spellings correctly.

So the residual is ~3 people, caused by nicknames and genuine spelling drift, not by a
systemic format problem.

### Design: promote the key to `employee_dim` + `employee_alias`

Not to fix a broken join, but to (a) persist a stable `employee_id` instead of recomputing
a string key on every request, (b) carry the ~3 alias overrides so drift stops silently
dropping people, and (c) hold rate, status, hire date, and pay type — which live nowhere
today.

```
employee_dim
  employee_id      int identity PK
  display_name     nvarchar      -- canonical "First Last"
  home_store       nvarchar      -- Pines | Miramar | Margate
  role             nvarchar      -- from labor.employee_role, latest
  pay_type         varchar       -- hourly | salary
  hourly_rate      decimal       -- Sam-maintained, see §3
  rate_effective   date
  hire_date        date          -- nullable, hand-entered
  status           varchar       -- active | inactive (derived: no shift in 21d)
  is_excluded      bit           -- NON_EMP, Support, EOD Till, owners

employee_alias
  alias            nvarchar PK   -- the exact string as it appears in a source table
  employee_id      int FK
  source_table     varchar       -- provenance, for debugging
```

Resolution pipeline: **the existing `last|first` key stays as step 1** (extract it from
`fetchEmployeeEE()` into `core/` so every surface shares one copy) → `employee_alias`
override → **unresolved bucket**.

No fuzzy matching. At a residual of ~3 people it isn't worth the risk: auto-merging
`Vasquez-` into `Vasques-Escobar` on edit distance is the same mechanism that would merge
two real siblings, and the cost of that error is attributing one person's till shortage to
another. The unresolved bucket is a required UI surface — an admin screen listing unmatched
names with a "these are the same person" action, confirmed once by Sam and then permanent.

**Exclusions:** `NON_EMP` and `Support` roles (already handled by `LABOR_EXCLUDE_ROLES` in
`src/lib/core/targets.ts`), plus the `EOD Till` pseudo-employee in `tillhistory`, plus
owners (Aybar, Homicil) from crew-facing leaderboards.

---

## 2.5 NetChef HR — ingest DOB and hire date only

**Sam's directive 2026-08-02:** pay rates come from `smoothieking.labor.rate`, not NetChef.
From the HR master, take **only date of birth and hire date** — for birthdays and work
anniversaries. **No home addresses.**

So the ingest narrows to five fields:

| Field | Used for |
|---|---|
| `dateOfBirth` | birthday recognition; minor-labor compliance (§2.5b) |
| `dateHired` | **fallback only** — see the Brink-first rule below |
| `primaryLocationCode` | store mapping |
| `status` | Active / Leave — real status, not inferred from shift gaps |
| `firstName` / `lastName` | join key only |

**⚠️ Hire date comes from BRINK first (Sam's directive: Brink is canon for labor; NetChef
only fills genuine gaps).** Verified 2026-08-02 — the two disagree, and Brink is right:

| Source | Coverage | Accuracy |
|---|---|---|
| Brink `EmployeeDirectory` `Hired:` | 50/123 Miramar records (**41%**) | accurate, goes back to 2022 |
| NetChef `dateHired` | 57/57 (**100%**) | **often the NetChef record-creation date, not the hire date** |

Where both carry a date: **7 agree, 5 differ** — and the misses are large. Isabella Tome:
Brink 2023-08-07 vs NetChef 2025-12-16 (**862 days**). Piedrahita: 2024-12-05 vs 2025-12-30
(390 days). The tell is that NetChef's `dateHired` equals its `dateCreate` on every record I
sampled, and the disagreements all cluster at NetChef go-live (Dec 2025 – Feb 2026).

*My earlier "validated: 0–6 days before first shift" check was weak* — `labor` only starts
2026-01-01, so it could not see any pre-2026 tenure, which is exactly where NetChef is wrong.

**Rule:** hire date = Brink `EmployeeDirectory` where present; NetChef only as fallback, and
any NetChef-sourced date where `dateHired == dateCreate` renders as **approximate**.

**DOB is the one true gap NetChef fills** — Brink's directory has no date-of-birth field at
all (its `Terminated:` and `Health Card Exp:` columns are 0% populated too).

**No termination dates exist in either source**, so 30/60/90-day turnover analysis (§5.8
item 5) is **not currently supportable** — status can only be inferred from shift gaps.

**Explicitly not ingested:** `address1`, `city`, `postalCode`, `emailAddress`,
`emergencyContactPhone`, `payrollIdNumber`, `employeeNumber`, `salaryAmount`, `payRate`,
federal/state withholding. They stay in NetChef.

Store DOB as the date (needed for both birthday and minor rules) but **never render a full
DOB in the UI** — show "Birthday: Oct 20" and an age band. Owner-only surface.

Everything else below documents what the endpoint offers; the ingest is the five fields above.

### The source

**Verified live 2026-08-02.** `GET /employee/v1/getEmployeesByPage` (`ctapi.py` already
holds working auth). **57 records, all three stores, 40 fields.** `dateHired` **57/57**,
`dateOfBirth` **57/57**, `status` 57/57. Name join to `labor` (Jun+): **36/39 = 92%**, same
three alias-drift misses as §2. Hire dates validate: 0–6 days before first observed shift
for 2026 hires.

Brink's `EmployeeDirectory` also carries `Hired:` and `Terminated:` — but **no date of
birth**, and it exports as an 864-line label-per-row block per store. NetChef's API is the
better path for both fields; Brink's directory is only useful for termination dates.

## 2.5a Recognition — birthdays and work anniversaries

With those two dates the module gets a genuinely useful non-analytical surface:

- **Upcoming birthdays and anniversaries** — a rolling 30-day card on the module home and
  in the Weekly Ops tab, per store, so managers see them before they pass.
- **Milestone flags** — 90 days, 6 months, 1 year, then annually. 1-year retention in QSR
  is worth marking; it also pairs naturally with the review cycle in §5.7.
- **Optional daily-recap line** — the recap email (`daily-recap/recap.py`) already renders
  per-store cards; "🎂 Birthdays this week: …" is a one-line addition. Per
  `feedback_recap_test_sends`, test sends go to Sam only.
- **Tenure distribution** per store, which is the honest version of the crew-composition
  metric from §5.5b (Miramar 40.1% of hours from sub-60-day employees).

Keep it a *display*, not a metric. Nothing here should feed a score.

## 2.5b Minor-labor compliance — the strongest reason to hold DOB

**13 of the active crew are under 18** (ages 16.8–17.9). Florida restricts 16–17-year-olds:
no more than 30 hours in a school week, not before 6:30am or after 11pm on a school night,
no more than 8 hours on a school day. Joining `dateOfBirth` to `labor_schedule` lets the
module flag violations **on the posted schedule, before they are worked**.

Nothing in the current stack watches this, and the exposure is regulatory rather than
operational. `EmployeeBreaks` (§2.6, verified working) supplies the break side.

## 2.5c Full endpoint reference (not all ingested)

**Verified live 2026-08-02.** CrunchTime's REST API exposes a full employee master at
`GET /employee/v1/getEmployeesByPage` (`ctapi.py` already holds working auth; the endpoint
was not previously known). **57 records, all three stores, 40 fields each.**

| Field | Completeness | Note |
|---|---|---|
| `dateHired` | **57/57** | validated: 0–6 days before first observed shift for 2026 hires |
| `dateOfBirth` | **57/57** | plus a precomputed `age` |
| `payType` | 57/57 | H=53, E=3, S=1 — answers `employee_dim.pay_type` directly |
| `employeePositions[].payRate` | 55/60 position rows | with `positionName`, `primaryPositionFlag` |
| `status` | 57/57 | Active / Leave — real status, not inferred from shift gaps |
| `eligibleForRehire` | 57/57 | turnover quality |
| `primaryLocationCode` | 57/57 | 1392/1892/2384, maps straight to store |

Also present: address, city/state/zip, email, emergency contact, `employeeNumber`,
`payrollIdNumber`, federal/state exemptions, `breakWaiver`, `partTime`, `manager`.

**Name join to `labor` (Jun+): 36/39 = 92%** using the same `last|first` key —
unmatched are `helton|shea`, `homicil|samuel`, `vasques-escobar|isabella`, i.e. the same
alias drift as §2. So `employee_dim` should be **seeded from NetChef**, not hand-built:
it supplies hire date, DOB, pay type, rate, status and store in one call.

⚠️ **This record set is materially more sensitive than anything else in the dashboard** —
DOB, home address, and payroll identifiers for 57 people, 13 of them minors. Per §2.5 the
ingest is narrowed to five fields; everything else stays in NetChef. Owner-only, never on a
crew-facing surface.

---

## 2.6 Brink's report catalog — 22 HR reports, 4 in use

Enumerated live from `/Reports/Reports/`: **93 reports, 22 employee/labor-related.** The
extractor wires only 4 (`EmployeeTimecard`, `TillHistory`, `WeeklyLaborSchedule`,
`EditedShifts`). Unused ones that map onto this design:

| Report | Relevance |
|---|---|
| **`EmployeeSalesSummary`** / `DayPartEmployees` | **may attribute the F1 employees the sales CSV drops — worth testing first** |
| **`EmployeeCashAccuracy`** | Brink's own cash-accuracy metric — likely better than deriving from `over_short` (§5.4) |
| **`ManagerOverrideDetail`** | classic loss-prevention vector, not currently captured at all |
| `EmployeeDirectory` | probably carries hire date/contact — but NetChef already answers this cleanly via API |
| `EmployeeBreaks` | break compliance (§5.2) |
| `EmployeeProductivity`, `ItemSalesByEmployee`, `ItemGroupComparisonByEmployee` | per-person output and product mix |
| `EmployeeSummaryByJobWithSalary`, `LaborCostByJob`, `JobSummaryByEmployee` | labor cost by job |
| `RefundDetail`, `VoidDetails`, `DiscountDetail`, `ReopenedOrder` | exception detail, likely employee-grained |

`EmployeeSalesSummary` is the one to test first: if Brink's own report names the ten
employees missing from the item-sales export, F1 becomes a reporting-path problem with a
workaround, not a blocking POS-provisioning fix. Columns unverified — I enumerated the
catalog, I did not run the reports.

---

## 3. Pay rate — resolved, opposite to what I assumed

I proposed seeding rates from the Tableau table on the memory note that `labor.rate` is
"incorrect". **Testing that against NetChef reverses it.**

Comparing NetChef `payRate` vs `labor.rate` for the 37 matched active employees:
**35 agree exactly, 2 differ** (Rosario $13.50 vs $13.00, Simmons $13.50 vs $14.00).

Where the Tableau table disagrees, **NetChef and `labor.rate` agree with each other against
Tableau** — Edwards ($14.00 vs Tableau $13.50), Rinaldi ($13.75 vs $13.00), Vilcin ($13.75
vs $13.00), Woods Khayden ($14.25 vs $13.00), Taylor ($13.50 vs $11.25). Those all look like
raises Tableau never picked up.

**Conclusion: the Tableau `#employee_rates` snapshot is the stale source, not `labor.rate`.**
`src/lib/core/labor.ts` has been right all along, so the daily recap / ops-week / budget
numbers do not move.

### DECIDED (Sam, 2026-08-02): `labor.rate` is the rate source

**Use `smoothieking.labor.rate`. Do not pull rates from NetChef.** The NetChef comparison
above is retained only as the *validation* that `labor.rate` is correct — 35/37 independent
agreement is strong evidence, and it is why this decision is safe.

Consequences, all simplifying:

- **No `hourly_rate` column on `employee_dim`.** One less thing to sync, one less way for
  two rate sources to drift apart.
- **`core/labor.ts` is unchanged** — it already does most-recent-rate → store-avg →
  `DEFAULT_RATE` 13.50. Nothing downstream moves.
- **The Tableau `#employee_rates` table is retired.** It is stale and now contradicted by
  two independent systems.
- The wage-maintenance UI in the dashboard backlog is **no longer needed** — rates maintained
  in Brink flow through automatically. (An override column can be added later if a specific
  case demands it; nothing today does.)
- The 125 of 1,091 June+ shifts with rate = 0 are salaried and owner rows, not errors.

*(Memory `project_employee_rates` is wrong on its central claim — `labor.rate` is not
"incorrect" — and should be corrected.)*

---

## 4. Module structure

Six views under `/employees`, plus a per-person profile. Following the existing
`/inventory` tab pattern (`src/app/inventory/layout.tsx`), owner-gated via `owner-guard.ts`.

```
/employees                    Roster        — the list, status, rate, tenure
/employees/[id]               Profile       — one person, all signals, one page
/employees/productivity       Productivity  — output per hour
/employees/attendance         Time          — scheduled vs worked, punctuality, OT
/employees/exceptions         Exceptions    — loss-prevention indicators
/employees/standards          Standards     — SOPs, photo quality, guest feedback
```

**The Profile page is the point of the module.** The other five are how you find who to
open. A manager conversation needs one screen showing hours, productivity, punctuality,
exceptions, and standards for one person over a chosen window — not five tabs cross-
referenced by hand.

---

## 5. Metric catalog

### 5.1 Productivity (`/employees/productivity`)

Extends the existing Employee Labor table (§1.5) rather than replacing it — same
`fetchEmployees()` aggregation, same guards, plus coverage and the `salesSource` flag.

| Metric | Formula | Source | Status |
|---|---|---|---|
| Sales per labor hour | attributed net sales ÷ `total_hrs` | sales + labor | ⚠️ F1 |
| Orders per labor hour | distinct `order_id` ÷ `total_hrs` | sales + labor | ⚠️ F1 |
| ATV | net sales ÷ distinct orders | sales | ⚠️ F1 |
| EE% (attach rate) | canonical def — **reuse, do not re-derive** | sales | ⚠️ F1 |
| Labor cost per order | (hours × rate) ÷ orders attributed | labor + dim | ✅ |
| Coverage % | attributed orders ÷ all in-store orders **on that person's shifts** | sales + labor | ✅ |

**Attribution rule:** attribute at `order_id` grain via `MAX(employee)` over the order's
lines, not per line. Modifier and Kitchen Message lines routinely carry no employee even
when the smoothie line does; line-grain attribution understates everyone. Order-grain
recovers real volume (Margate line-null 19.5% → order-null 18.4%).

**Coverage % is the honesty gauge and must sit next to every productivity number.** An
employee with 30% coverage has 70% of their work invisible; showing their sales/hour
without that context invites a wrong conclusion about a real person's job performance.
Below a threshold (suggest 60%), grey the productivity cells out entirely rather than
render a number that looks authoritative.

**EE% must come from the canonical definition** used by the dashboard KPI (`cache-builder`
`fetchEE` / `core/sources.ts`), not recomputed here. My exploratory per-employee query
(To Go only, July) returned a 30.1%–41.6% spread against a stated 80% target — that gap is
a denominator difference, and shipping a second EE definition would violate
`feedback_insight_consistency`. Same rule for net sales, which still has a known
Sigma-vs-SQL divergence (`project_metric_unification`).

**Fair-comparison rule:** never rank across stores or dayparts without normalizing. A
Miramar opener and a Margate closer do not face the same order flow. Compare each person
to the *same store × same daypart* median, and show rank as a percentile within that peer
group. Raw cross-store leaderboards will systematically flatter whoever works the busiest
station and punish whoever gets sent to the slow one.

### 5.2 Time & Attendance (`/employees/attendance`)

`labor_schedule` and `labor` share the "Last, First" format, so they join **directly** —
verified 96 of 107 shifts matched for the week of 7/20 (Margate 30/31, Miramar 37/42,
Pines 29/34).

| Metric | Formula | Verified sample (wk 7/20) |
|---|---|---|
| Scheduled vs worked hrs | Σ`sched_hours` vs Σ`total_hrs` | Margate 174.0 → 193.1 (**+11.0%**), Pines 187.5 → 179.8, Miramar 238.0 → 232.7 |
| Clock-in variance | `DATEDIFF(min, sched.start_time, labor.shift_start)` | avg Margate +0.8, Pines +7.0, Miramar +7.9 min |
| Clock-out variance | same on end times | avg Margate −37.3, Pines −34.2, Miramar +28.3 min |
| Late arrivals | count where in-variance > 5 min | per person |
| Early departures / overstays | out-variance beyond ±15 min | per person |
| Unscheduled shifts | in `labor`, absent from `labor_schedule` | Pines 8, Miramar 4, Margate 2 |
| No-shows | in `labor_schedule`, absent from `labor` | complement of the 96/107 |
| Overtime | `ot_hrs` > 0 | Manager-Salary 130.2 OT hrs in June+ — worth a look |
| Break compliance | `unpaid_breaks` vs hours worked | FL has no mandated break for 18+; treat as policy, not law |

**Margate's +11% schedule overrun is the kind of thing this view exists to surface** — that
is roughly 19 unplanned hours in one week at one store.

**Exclude salaried staff from punctuality.** Madaffari shows scheduled 2.0h vs actual
15.9h with a −465 min clock-out delta — he is salaried and his Brink punches are
administrative, not a shift. Scoring him on punctuality is meaningless. Gate on
`employee_dim.pay_type = 'hourly'`.

### 5.3 Timecard integrity (`labor_edits`)

This is the time-theft control and it is genuinely strong, because it audits the
*managers*, not the crew.

| Metric | Verified (Jun 7 – Jul 31) |
|---|---|
| Edits by editor | Madaffari 220 BreakEndTime / 215 BreakStart / 213 BreakType; GM 2384 184/176/177; Aybar 48/47/47 |
| Shift deletions | Madaffari 11, GM 2384 8 |
| Reason distribution | "Forgot to Clock Out" ≈ 99% |
| Self-edits | editor resolves to the same `employee_id` as the shift owner |
| Edit latency | `edit_time − business_date` — edits landing days later |

**Self-edit is the flag that matters.** A manager editing their own punch is a different
risk class from a manager fixing a crew member's. Also worth a rule: a shift deleted
*after* the pay period closed. Note `labor_edits` can log edits to phantom overnight
shifts that never reach the final timecard — the timecard is authoritative, the edit log
is the signal (`project_brink_extractor`).

### 5.4 Exceptions / loss prevention (`/employees/exceptions`)

**Framing rule — carry this over from the shrink dashboard, and hold it harder here.**
`project_shrink_dashboard` established that leading with a gross, alarmist number sends
you chasing a catastrophe that isn't there. That rule applied to inventory. Here it
applies to *people*, where a false positive costs someone their job.

The rules:

1. **These are exposure-normalized indicators, never conclusions.** Label the view
   "Exceptions", not "Theft". The output of this page is *who to look at*, and the next
   step is always footage or a conversation — never an accusation off a number.
2. **Persistence over magnitude.** One bad drawer is noise. The same person short across
   6+ of their last 10 drawers is a pattern. Rank on consistency, not on a single worst day.
3. **Over is as suspicious as short.** A drawer that is consistently *over* can mean
   under-ringing (cash taken in, sale never entered). Kelis Selmour: 23 tills, **net
   +$1,463, avg +$63.61/till** at Miramar — the largest absolute variance in the dataset,
   and it's on the over side. Never show `ABS()` alone; show signed and directional.
4. **Normalize by exposure.** Tariq Leon has 128 tills; Dereck Felix-Nunez has 16. Raw
   dollar totals rank the busy, not the risky. Rank on per-till average and on hit rate.
5. **Voids and discounts are a manager-permission artifact as much as a behavior.** Before
   flagging, confirm who is even *able* to void — a Team Captain's void count is not
   comparable to a Team Member's.

| Indicator | Formula | Verified spread |
|---|---|---|
| Till over/short per drawer | `over_short` ÷ tills | Selmour +$63.61 (n=23), Felix-Nunez −$64.22 (n=16), Linton −$14.35 (n=79) |
| Short-drawer hit rate | tills with `over_short` < −$5 ÷ tills | per person |
| Variance volatility | stddev of `over_short` | catches erratic vs consistently-off |
| Void rate | void lines ÷ orders | Saintil 48/406, Chambers 44/297, Lara 43/472 vs **Leon 2/498** |
| Discount rate | `discount_total` ÷ net sales | Leon 11.1%, St. Fleur 10.9% vs Bachman 3.3% |
| Employee-discount use | `has_employee_discount` | **0 rows in July — column appears unused, verify before building on it** |
| Paid-outs | `paid_outs` per person | Margate $40, Miramar $102.81, Pines $126.58 (Jul) |
| Cash-shift concentration | share of a person's shifts on cash-heavy drawers | context, not a flag |

Note the striking inverse: Leon has 2 voids and the highest discount rate; Saintil has 48
voids and a low discount rate. Different behaviors, possibly both benign (different
stores, different permissions), possibly not. That contrast is exactly what the view
should make visible rather than collapse into one score.

**On the composite risk index:** I'd build it, but weight it as *"number of independent
indicators outside the peer band"* (0–6) rather than a weighted dollar score. A count is
honest about what it knows. A dollar-weighted "risk score" implies a precision that
till-counting noise does not support, and it invites treating a rounding error as evidence.

**Also verify before building:** `tillhistory` shows `declared_cash` ($17.2k Margate July)
far exceeding `cash_received` ($4.2k). Until that relationship is understood, `over_short`
is the only field on this table I'd trust — do not derive new cash metrics from the
components.

### 5.5 Standards & guest feedback (`/employees/standards`)

| Metric | Source | Verified |
|---|---|---|
| SOP tasks completed | `jolt_task_completions.completed_by` | 819 tasks / 15 people (7d) |
| On-time rate | `on_time` | 779/819 = **95.1%** |
| Photo-evidence rate | `has_photo` | 520/819 = **63.5%** |
| Photo quality (done-to-standard) | `jolt_image_quality` | store-level ~53%; per-person is **new** |
| Checklists submitted | `jolt_list_instances.submitted_by` | full history |

**Per-person photo quality is the sharpest thing in this section** — `jolt_image_quality`
already scores whether a task was *done to standard*, and `jolt_task_completions` already
carries who did it. Joining them gives execution quality by person, which nothing else in
your stack measures. Caveat: the Jolt rubric marks stocking tasks neutral and never counts
`cant_determine` against anyone — keep that intact at person grain, and require a minimum
photo count (suggest 10) before showing a rate.

### 5.5b SMG guest data — what can and cannot come in

Four tables exist. Grain is the whole story:

| Table | Grain | Rows | Time of day? | Employee-joinable? |
|---|---|---|---|---|
| `guest_daily` | store × day × metric | 1,278 (May 1 – Aug 2) | ❌ date only | day grain only |
| `guest_comments` | one verbatim | 18 (**12 usable**) | ✅ `visit_datetime` | **shift grain** |
| `guest_cases` | store × day | 58 | ❌ | ❌ |
| `guest_feedback` | store × fiscal period | 396 | ❌ | ❌ |

Nine metrics in `guest_daily`, several directly about crew behavior — Friendliness,
Greeted, Appreciate, Speed, Accuracy, Cleanliness — stored as `n_count`/`topbox_count`
so any window is exact via SUM/SUM.

**Total volume: 241 surveys across all three stores in three months** (~0.85 per store per
day). That number governs everything below.

#### ❌ Per-employee guest scoring is not statistically viable

Attributing each survey to the crew on shift, weighted by hours, the **best-exposed
employee in three months accumulates 13.8 weighted surveys** (Tariq Leon, Margate). Most
land at 6–10. At an ~87% topbox rate:

| Weighted surveys | 95% CI on that person's topbox |
|---|---|
| 13.8 (best) | **±17.7 pts** |
| 10 | ±20.8 pts |
| 7 | ±24.9 pts |
| 5 | ±29.5 pts |

Observed store OSAT spans 78.9%–100%. **The confidence interval on the single
best-measured employee is wider than the entire spread of store performance.** No ranking,
scoring, or red/amber flag on this data is defensible. Do not build one, and do not build
one "provisionally" — a number on screen will get used.

#### ❌ Two crew-composition hypotheses I tested and rejected

**New-hire hours share → guest scores.** Pooled, this looks compelling: shifts with <40%
of hours from employees in their first 60 days score **84.3%** topbox vs **74.2%** for
40%+ (n=540 vs 159, z=2.90, p=0.0038). **It does not survive controlling for store:**

| Store | <40% new hrs | 40%+ new hrs |
|---|---|---|
| Pines | 86.1% (n=173, 43d) | 85.7% (n=14, 4d) |
| Margate | 88.4% (n=215, 35d) | 83.3% (n=6, 2d) |
| Miramar | 76.3% (n=152, 26d) | 72.7% (n=139, 31d) — **p=0.48, n.s.** |

Miramar supplies 31 of the 37 high-new-hire days and is simply the lower-scoring store.
The pooled result is a store effect wearing a tenure costume. Classic confound; it should
not ship.

**Staffing intensity → guest scores.** Orders per labor hour, by quartile: 85.9% / 76.6% /
85.6% / 77.1%. Non-monotonic, no dose-response. Noise.

#### 📌 The extractor README already specified this join

`/Users/sam/smg-extractor/README.md` §"Crew-on-shift join (for a future labor module)"
pre-dates this design and already carries the exact SQL, the **271/284 (95%)** match rate,
avg crew on duty **2.8**, and the rules — *presence not fault*, weight by hours worked,
check daypart clustering before treating a rate as a finding. It ends: *"Deliberately not
on the Guest Voice page — it belongs in an employee/labor module."* This section is
downstream of that, not a new idea. Two of its "Known gaps" are now **stale**: the
Pines/Miramar store split was solved by `finish_split.sh` (combined rows deleted; all three
stores are distinct in `guest_daily`), so the store-controlled analysis above is valid.

#### ⚠️ `guest_comments` is under-loaded, not API-limited

I built the "18 comments" argument on the table. The table is not the ceiling.
`out/comments_probe.json` holds **125 Margate comment rows spanning Feb 6 – Jul 23, 117 of
them timestamped** — for one store — against 18 rows in the DB for all three.

Row-level responses are reachable through `POST /api/commentreport/v2/aggregate`
(`probe_rawrows.py`), and each row carries `responseId`, `eventDate` (visit time),
`unitId`, `nSentiment`, `comments`, and an **`attributes` map of measureId → answer value**
(e.g. OSAT `5.0`). That is per-response, timestamped, *scored* data — exactly what a
crew-on-shift join wants. Backfilling it is a loader change, not new API work.

**This does not rescue per-employee scoring.** Loading more rows makes each existing survey
individually attributable; it does not create more surveys. The ~241-per-quarter population
and therefore the confidence intervals above are unchanged. What it does rescue is the
review workflow and daypart analysis.

#### 🆕 Three staff-behavior measures exist and are not being loaded

From `out/measure_attribute_map.json` (47 measures; 9 currently loaded):

| Measure | Attribute | Type | Why it matters here |
|---|---|---|---|
| **Offer Extra or Enhancer** | `R000030` | INT | **Guest-reported upsell** — the counterpart to POS EE%. Directly a crew behavior. |
| **Menu Recommendation** | `R000029` | INT | Suggestive selling |
| **Recognize Team Member** | `R000033` | INT | Service recognition |
| Likelihood to Return / Recommend | `R000020`/`R000021` | INT | Loyalty outcome |
| Why Not Satisfied / Why Highly Satisfied | `S000022`/`S000024` | STRING | Verbatim reason — coachable detail |

**"Recognize Team Member" does not name anyone** — `dataType: INT`, so it is a yes/no or
scale answer, not a free-text employee name. Worth stating plainly because the label invites
the opposite assumption; there is no per-employee identifier hiding in the survey schema.

**`Offer Extra or Enhancer` is the most valuable unloaded field for this module.** It gives a
guest-verified read on upselling that can be compared against the POS EE% attach rate — and
unlike EE%, it is unaffected by the F1 cashier-stamp problem. Store and daypart grain, not
per-person.

#### ✅ What can actually come in

1. **Negative-comment shift review — a workflow, not a metric.** Verified 11 of 12 usable
   comments matched to crew, 2–3 people each. Profile section + manager review queue.
   Once the comment backfill lands this goes from anecdote to a real queue.
2. **Daypart × crew analysis.** `probe_rawrows.py` already recomputes OSAT by weekday-band ×
   daypart from raw rows. Daypart has far better n than any individual, and the README
   flags Margate's 2PM–6PM weakness as precisely the confound to control for before
   reading a person's negative rate as performance.
3. **Guest-reported upsell vs POS EE%** — once `R000030` is loaded.
4. **Crew composition as a fact in its own right:** hours from employees in their first 60
   days, May–Aug — **Miramar 40.1%**, Pines 14.7%, Margate 11.8%. Overlaps the F1 group.
5. **Store guest metrics as context:** Miramar Appreciate 61.7% / Friendliness 73.6% /
   Cleanliness 71.3% vs Margate 83.8 / 84.5 / 83.8. Manager material, never individual scoring.

#### When per-employee scoring becomes possible

Needs ~30–50 surveys per person. Not reachable by better loading — only by a jump in survey
volume, or by `OrderId` becoming available so a survey joins to a **specific order and
cashier** rather than a whole shift. The README is explicit that `OrderId` is collected by
the survey but **not exposed to this login**: 193 measures exist, only 101 resolve, and none
map to an order identifier. That is a permissions ask to SMG, not an engineering task. It
also depends on the F1 fix, since the order needs a cashier stamp to join to.

### 5.6 Cost

Per-person fully-loaded cost, feeding off the already-specified burden model
(`project_labor_burden`): base wages (`total_hrs` × `employee_dim.hourly_rate`) +
0.85 × CC tips from `tillhistory.tips` + FICA 7.65% + wage-cap-aware FUTA 0.6% / FL SUI
2.7% + WC 2.2%.

**Do not present per-person burden as precise.** The burden model has a confirmed open
blocker: Brink home-store ≠ ADP paying entity (7/17 register hours were materially below
Brink for any 2-week window). Per-store totals reconcile; per-person entity attribution
does not yet. Show wages at person grain, burden at store grain, until that's resolved.

---

### 5.7 Quarterly evaluations (`/employees/[id]/review`)

**Sam's directive:** a three-month evaluation cadence built on the Brink employee reports.

#### The clock — anniversary-based, not calendar

`dateHired` is 57/57 complete, so reviews can be driven off each person's own hire date:

| Milestone | Trigger | Purpose |
|---|---|---|
| **90-day** | hire + 90d | probationary close-out; the highest-turnover window |
| **Quarterly** | every 90d after | the standing cadence |
| **Annual** | hire anniversary | pairs with the recognition card (§2.5a) |

Anniversary-based staggers reviews naturally instead of dumping 57 of them on a manager in
the same week. The module shows a **review queue** — who is due in the next 30 days, who is
overdue, when each was last completed.

#### The scorecard — five sections, all from verified sources

Every metric below comes from a feed I confirmed live on 2026-08-02. Nothing speculative.

| Section | Metrics | Source | Status |
|---|---|---|---|
| **Productivity** | Orders, Guests, Gross Sales, ASG, AST, ATT/TPP service times | `EmployeeSalesSummary` | ✅ verified, covers everyone |
| **Reliability** | scheduled vs worked hrs, late arrivals, early departures, no-shows, unscheduled shifts | `labor` + `labor_schedule` | ✅ 90% join |
| **Cash handling** | over/short per drawer, short-drawer hit rate, variance volatility | `tillhistory` | ✅ 100% join |
| **Standards** | SOP tasks, on-time %, photo-evidence %, done-to-standard % | `jolt_task_completions` + `jolt_image_quality` | ✅ (7-day retention — snapshot weekly) |
| **Exceptions** | void rate, discount rate, manager overrides, break compliance | `sales` + `ManagerOverrideDetail` + `EmployeeBreaks` | ✅ verified |

#### Scoring rules

1. **Peer-relative, within store × role.** Percentile against the same-store, same-role
   cohort for the quarter — never a cross-store raw rank. A Miramar opener and a Margate
   closer do not face the same order flow (§5.1).
2. **Trend beats level.** Show this quarter vs last quarter per metric. Improvement from a
   low base is the thing a review should reward; a static leaderboard punishes whoever was
   assigned the harder shifts.
3. **Minimum exposure gates.** No metric renders below its floor: 20 orders for
   productivity, 5 drawers for cash, 10 photos for standards. Below the gate, show "—",
   not a number.
4. **The scorecard is an input to a conversation, not an output.** It has a free-text
   manager section and an acknowledgement field. Nothing auto-generates a rating, and there
   is no composite "employee score" — see §6.
5. **Guest feedback is excluded from individual scoring** (§5.5b): the best-covered
   employee has a ±17.7-point confidence interval. It can appear as context on the profile,
   never as a review metric.

#### What this needs from the extractor

Three new Brink reports, all verified working:

| Report | Form | Effort |
|---|---|---|
| `EmployeeSalesSummary` | standard `LocationModel_Selected` | drops straight into `download_report` |
| `EmployeeBreaks` | standard | same |
| `ManagerOverrideDetail` | standard + optional user filters | same |
| `EmployeeCashAccuracy`, `EmployeeProductivity` | **`LocationsModel_Type`** (plural, multi-location) | needs a second form handler — same pattern as `itemsales` |

Suggested tables: `employee_sales_daily`, `employee_breaks`, `manager_overrides`, plus
`employee_reviews` (review_id, employee_id, period_start/end, due_date, completed_date,
manager, notes, acknowledgement).

---

### 5.9 Shift association — "what happened on shifts they worked"

**Sam's directive:** see not only what an employee does personally, but what occurred on
shifts they were part of — complaints, cash variance, anything — in case they had activity
associated with them without being the person on the register.

This is the right instinct, and it is the only way to see anything at all for the people who
rarely touch a drawer. It also has a specific failure mode, so the design below separates
**what to build** (a lookup that works today) from **what not to build yet** (a ranking that
the data does not support).

#### The primitive: one overlap join, every event type

`labor` has `shift_start`/`shift_end` on **100%** of rows. Any timestamped event joins to
the crew present:

```sql
JOIN smoothieking.labor l
  ON l.store = e.store
 AND l.shift_date = e.event_date
 AND l.shift_start < e.event_end      -- for point events, event_end = event_time
 AND l.shift_end   > e.event_start
 AND l.employee_role NOT IN ('NON_EMP','Support')
```

Feeds it serves, all verified present:

| Event | Time source | Window? |
|---|---|---|
| Till variance | `tillhistory.assigned_time` → `checkout_time` | true interval |
| Voids / discounts | `sales.closed_datetime` | point |
| Guest comments | `guest_comments.visit_datetime` | point (12 usable today) |
| Manager overrides | `ManagerOverrideDetail.Approval Time` | point (not yet ingested) |
| SOP tasks | `jolt_task_completions.completed_datetime` | point |

⚠️ **`tillhistory` is missing `assigned_time`/`checkout_time` on 133 of 560 June+ rows
(24%).** Those fall back to day-level association, which is much weaker — a day can span
three crews. Show which basis was used; don't silently mix interval and day matches.

**Dilution measured: 3.70 crew overlap the average till session** (range 0–11). So every
event implicates ~4 people. That is the whole design problem in one number.

#### Direct vs Associated — two columns, never summed

Each metric appears twice on the profile:

| | Definition |
|---|---|
| **Direct** | the event is attributed to them (their drawer, their ring, their SOP task) |
| **Associated** | the event happened on a shift they worked, attributed to someone else |

The case Sam described is real and already visible: **Nevaeh St. Fleur ran 3 drawers herself
but overlapped 59 till sessions** carrying −$10.99 average variance. Direct view: invisible.
Associated view: substantial exposure. That is exactly the person the current design would
miss.

#### ⚠️ Do not rank on associated variance yet — I tested it

Raw associated totals rank **exposure, not behavior**: Leon overlaps 89 till sessions,
Selmour 44, simply because Leon works more. Any leaderboard on the raw number is a
who-works-most list.

So I normalized and tested properly. Per employee, mean `over_short` of their associated
till sessions vs a **store-controlled permutation null** (10,000 random same-size draws from
that employee's own store, Jun 1 – Aug 1):

| Employee | Store | n | Assoc mean | Store mean | p (2-sided) |
|---|---|---|---|---|---|
| Chambers, Isiah | Margate | 40 | −$9.51 | −$2.18 | 0.066 |
| Saintil, Joshua | Pines | 43 | +$0.40 | +$4.54 | 0.069 |
| Simmons, Catlyn | Miramar | 29 | −$20.79 | +$1.49 | 0.115 |
| Fletcher, D'Kobe | Miramar | 28 | +$44.29 | +$1.49 | 0.132 |
| St. Fleur, Nevaeh | Miramar | 59 | −$10.99 | +$1.49 | 0.314 |

**0 of 28 employees clear p < 0.05. Chance alone would produce ~1.4.** Two months of till
data contains no detectable per-person association signal — including for the poster-child
case above.

*Method note, because it matters:* my first pass used a naive z-test (Simmons z = −1.55) and
then a permutation that pooled all three stores, which returned p = 0.000. **That was
confounded by store** — Miramar and Margate have different baseline variance, so the test
was mostly detecting which store someone works at. Controlling for store collapses it to
p = 0.115. Non-independence is also unresolved: each till is counted for ~3.7 employees, so
even these p-values are optimistic. Any future version of this metric must carry the
store-controlled null, and should show a CI rather than a bare number.

#### So what gets built

1. **Ship the association lens as a lookup, not a score.** On the profile: "During shifts
   you worked — 59 drawer sessions, net −$648; 4 guest comments; 2 manager overrides."
   Click through to the events. It answers Sam's question directly and needs no
   significance test, because it makes no claim.
2. **Always show exposure alongside** — associated events per 100 hours worked, never a raw
   count, so the hardest worker doesn't top the list by definition.
3. **No flags, no ranking, no risk contribution from associated events** until a metric
   clears the store-controlled null. Revisit once there is a year of till data rather than
   two months.
4. **Convergence is the honest screen.** One person appearing off-baseline on several
   *independent* associated signals — till, voids, overrides, complaints — is worth a look
   even when no single signal clears. Present it as "3 of 5 indicators outside the store
   band," a count, with every underlying p visible. Never a blended score (§5.4 rule 5).
5. **Language discipline.** Label it "On shifts worked," not "responsible for." With ~4
   people per event, association is presence. The README for the SMG extractor says the
   same thing about complaints, and the rule generalizes to every feed.

---

## 5.8 What else would make this robust

Ranked by value per unit of work, all grounded in verified sources.

1. **`ManagerOverrideDetail` — the missing loss-prevention feed.** Verified columns:
   `Approval Time, Login User, Button Name, Button Action, Approval User, Approval Method`.
   The Miramar sample shows **`Open Cash Drawer` / `OpenCashDrawer`, Login User `Nevaeh`,
   approved by `Dan` via PIN**. No-sale drawer opens with named approver and requester is
   the single strongest cash-theft signal in any POS, and you are not capturing it at all.
   It also audits *managers* — who approves overrides, how often, for whom.
2. **`EmployeeBreaks`** — verified: `Employee Name, Payroll ID, Date, Start, End, Paid,
   Paid Hours, Unpaid Hours`. Feeds break compliance and, joined to DOB, minor-break rules.
3. **Fix the `itemsales` employee stamp** (§1.1) so the `sales` table regains attribution.
   `EmployeeSalesSummary` is the immediate workaround; fixing the export restores
   order-level detail (items, dayparts, EE%) per employee, which the summary can't give.
4. **Cross-store workers.** `hoursByLoc` already handles primary-store assignment; the
   review cohort logic must respect it or a floater gets compared to the wrong peer group.
5. **Turnover analytics** — with `dateHired` plus Brink's `EmployeeDirectory` `Terminated:`
   field, you get 30/60/90-day turnover by store and by hiring manager. Miramar's 40.1%
   sub-60-day hours share suggests this is worth measuring.
6. **Snapshot Jolt weekly.** `jolt_task_completions` keeps 7 days; without a weekly
   snapshot no quarterly review can look back across its own period.
7. **Tie into the daily recap and Weekly Ops** rather than building a new email
   (`feedback_insight_consistency`): birthdays/anniversaries, reviews due, and minor-hour
   violations on the posted schedule are all one-line additions to surfaces that exist.

---

## 6. What this module deliberately will not do

- **No automated disciplinary output.** No "termination risk" scores, no auto-generated
  warnings. Every flag routes to a human review step.
- **No cross-store raw rankings** without daypart/volume normalization (§5.1).
- **No productivity number below 60% attribution coverage** — greyed, with the reason.
- **No guest-complaint attribution to individuals** at current volume.
- **No new definitions** of net sales, labor %, EE%, or COGS — all reused from
  `src/lib/core/`.

---

## 7. Build order (when you're ready)

Revised after the F1 correction — productivity is no longer blocked, and no operational
fix is a prerequisite.

1. **Add `EmployeeSalesSummary` to the brink-extractor** → `employee_sales_daily`. Unblocks
   per-employee productivity for all three stores immediately (§1.1). Standard report form,
   so it reuses `download_report` as-is.
2. **`employee_dim` + `employee_alias`**, seeded from the `last|first` key plus the NetChef
   five-field HR sync (DOB, hire date, store, status, name). **No rate column** — rates stay
   on `labor.rate` (§3). Include the unresolved-name admin screen.
3. **`salesSource` flag on the existing Employee Labor table** (§1.5) — an hour's work; stops
   the current table implying person-level numbers it doesn't have. Retire it once step 1
   lands and every employee has real attribution.
4. **Roster + Profile**, with the recognition card (birthdays / anniversaries / milestones).
5. **Attendance** — scheduled vs worked, punctuality, no-shows. Joins cleanly today.
6. **`ManagerOverrideDetail` + `EmployeeBreaks`** into the extractor → Exceptions view,
   plus minor-hour compliance flags on the posted schedule.
6b. **Shift-association lens** (§5.9) — the overlap join as a shared helper, surfaced on the
   Profile as an exposure-normalized lookup. No flags or ranking from it.
7. **Quarterly reviews** (§5.7) — needs steps 1, 2 and 6 in place for a full scorecard.
8. **Standards** — Jolt per-person, with the weekly snapshot job. Guest section stubbed
   with an insufficient-data state.

## 8. Open questions for Sam

**Resolved this session:**
1. ~~Pay rate truth~~ → `labor.rate`, decided (§3). Tableau table retired, no `hourly_rate`
   on the dim, no wage-maintenance UI needed.
2. ~~F1 cause~~ → pipeline bug in the `itemsales` export, not POS provisioning (§1.1).
   Nothing to chase with managers.
3. ~~Tenure / hire dates~~ → NetChef `dateHired`, 57/57 complete (§2.5).
4. ~~Brink employee reports~~ → catalog enumerated, `EmployeeSalesSummary`,
   `EmployeeBreaks`, `ManagerOverrideDetail`, `EmployeeDirectory` all verified working.

**Still open:**
5. **Who can void / discount / approve overrides**, by role and store? Needed before those
   metrics mean anything — a Team Captain's void count isn't comparable to a Team Member's.
   The `ManagerOverrideDetail` sample shows Dan approving by PIN; is that the only approver?
6. **Visibility** — owner-only, or do GMs see their own store's crew? Changes the auth
   design and how bluntly the Exceptions view should be worded.
7. **Review ownership** — who conducts the quarterly reviews (you, Dan, store GMs)? That
   decides whether the review queue is one list or per-manager.
8. **Do you want the 90-day probationary review** as a distinct template from the standing
   quarterly one, or the same scorecard throughout?
9. **`declared_cash` vs `cash_received`** on `tillhistory` — what's the intended
   relationship? Until that's clear, `over_short` is the only field on it I'd build on.
10. **Is `has_employee_discount` in use?** Zero July rows.
11. **Jolt weekly snapshot** — confirm you want this; without it no quarterly review can
    look back across its own period (7-day retention).


---

## 9. Consistency audit vs the rest of the app

Run 2026-08-02 against `feedback_insight_consistency` ("all insight surfaces share
methodology + framing; verify parity before shipping"). Canon is `src/lib/core/sources.ts`,
`src/lib/core/targets.ts`, `src/lib/config.ts`, and `daily-recap/recap.py`.

**One conflict is introduced by this design and must be fixed before build. Four already
exist in the app. Two are defects in the current Employee table.**

### 🟡 C1 — Per-employee sales dollars are NOT blocked (corrected)

I first called this a blocker. **Wrong — it was a population artifact in my own comparison.**
I compared Brink's in-store-only figure against *all-channel* net, which includes online and
delivery orders that have no cashier at all. Compared like with like:

| Store | Brink gross (employee report) | Our in-store gross | Delta |
|---|---|---|---|
| Margate | $6,803.84 | $6,867 | **−0.9%** |
| Miramar | $11,327.17 | $11,454 | **−1.1%** |
| Pines | $9,106.51 | $9,310 | **−2.2%** |

Brink's per-employee sales tie to our own in-store gross **within 1–2%**, and the residual
is the 3–4.6% of in-store orders with no cashier attached. There is no measurement conflict
— there was a denominator mistake in my analysis.

**The rule, not a block:** per-employee sales are an **in-store, cashier-attributed subset**.
They roll up to *in-store gross*, never to the Overview KPI's all-channel net. That is a
different question with a different denominator, which is a labelling requirement, not a
contradiction.

Requirements:
1. Always display the matching denominator — "X% of in-store gross" — so the column foots
   against a number shown on the same screen.
2. Never sum per-employee sales against a store total from the Overview KPI.
3. Label the basis explicitly: **"In-store gross (Brink cashier basis)."**
4. Do **not** allocate net sales by each employee's gross share — discount rates vary
   sharply by person (Leon 11.1% vs Bachman 3.3%, §5.4), so a gross-share allocation would
   misstate individual net. Show gross, or wait for the export fix.
5. Fixing the `itemsales` employee stamp remains the better end state — it yields order-level
   net per employee from the canonical source — but it is an **improvement, not a
   prerequisite**.

### 🔴 C2 — My void% and discount% definitions differ from the Ops Health card

`cache-builder.ts:238-242` defines void% = **void ORDERS ÷ orders**, discount% =
**discount ÷ GROSS sales**. My §5.4 draft used void *lines* and discount ÷ *net*:

| Store | Canon void% | My draft | Canon disc% | My draft |
|---|---|---|---|---|
| Margate | 2.54% | **5.38%** | 8.36% | 9.72% |
| Miramar | 2.84% | **7.30%** | 8.00% | 9.27% |
| Pines | 2.14% | **5.03%** | 5.21% | 5.78% |

Void would have read **more than double** the Ops Health card against a 2% target — a
manufactured crisis. Discount would push Margate and Miramar from just-under to over the
8% target. **§5.4 adopts the canonical definitions.**

### 🔴 C3 — I used the wrong EE% target

I wrote "against a stated 80% target". `config.ts` says **`eePct: 0.60`**. Memory
`project_dashboard` also says 80% and is stale. **Canon is 60%.** My measured per-employee
30–42% is still below target, but not catastrophically as implied.

### 🟠 C4 — Two different labor targets already exist in the app

- `config.ts` `TARGETS.laborPct = 0.25` → Overview KPI card
- `core/targets.ts` `LABOR_TARGET = 0.22` (amber +3pts) → ops-week (`route.ts:283,312`),
  daily recap, budget view

Same metric, two targets, two surfaces. **Not caused by this design**, but the employee
module must pick one and it should be `LABOR_TARGET` (0.22), the documented "single source
of truth". Worth reconciling `config.ts` separately.

### 🟠 C5 — The daily recap does not exclude `NON_EMP`/`Support`

`recap.py:94` sums `smoothieking.labor` with no `employee_role` filter; the dashboard
excludes both roles (`LABOR_EXCLUDE_ROLES`). July impact:

| Store | Hours unfiltered vs filtered | Pay |
|---|---|---|
| Margate | 1,124.3 vs 1,106.6 (**+1.60%**) | identical |
| Miramar | 1,217.0 vs 1,217.0 (0.00%) | identical |
| Pines | 1,063.7 vs 1,063.7 (0.00%) | identical |

Pay is unaffected (these are $0 rows), so labor **cost** and labor% agree everywhere. Only
Margate **hours** differ. Small, but it is a real cross-surface disagreement and this module
will surface hours per store. **Fix `recap.py` to use the same exclusion.**

### 🟠 C6 — Known open divergence: Sigma vs SQL net sales

`project_metric_unification` records this as the one unresolved source conflict, and the
KPI path still reads void/discount from the Sigma-derived `sigmaSales` while other surfaces
use `NET_SALES` from `smoothieking.sales`. The employee module must not add a third path —
it inherits whatever the KPI card uses and changes nothing.

### 🟡 C7 — Two defects in the existing Employee table (pre-existing)

`fetchEmployees()`: `voidPct: storeVoidPct` renders a **store-level** void% in a
per-employee column, and `discountPct: 0` is hardcoded. Same class as the
`salesPerHour ?? storeSalesPerHour` fallback in §1.5 — a store number in a person's row.
All three should be fixed together.

### 🟡 C8 — Period definitions must be labelled

Three period systems are live: the **SK fiscal calendar** (12 periods, 5-4-4 —
`project_financial_calendar`, used for franchise fees and SMG), **calendar** weeks/months
(dashboard tabs), and this design's **anniversary-based 90-day** review windows. These are
not conflicting numbers, but a review that says "this quarter" must state which. Reviews
use hire-date anniversaries; every metric inside a review states its own window explicitly.

### ✅ Confirmed consistent

- **Pay rates** — `labor.rate` via `core/labor.ts`, unchanged (§3). No new source.
- **Exclusions** — `LABOR_EXCLUDE_ROLES` used throughout this design.
- **Store mapping** — reuses `STORES` / `LOC_CODE_SHORT` / `STORE_TO_LOC`.
- **Name resolution** — reuses the existing `last|first` key (§2), not a new one.
- **Scheduled cost** — `core/labor.ts` `scheduledCostByDay`, not recomputed.
- **Framing** — net-before-gross, confidence gating and "not evidence on its own" carried
  from `project_shrink_dashboard`; "presence not fault" carried from the SMG README.
- **Guest metrics** — excluded from individual scoring (§5.5b), so no second OSAT path.

### Rule for this module

**No metric in the employee module may be computed from a source or formula not already in
`core/`.** Anything genuinely new (service times, break compliance, override counts,
association exposure) has no counterpart elsewhere in the app and therefore cannot conflict
— but it goes into `core/` so the next surface inherits it.


---

## 10. Recommendation — what I would actually build

**Revised 2026-08-02 after the C1 correction: nothing is blocked.** Per-employee sales
dollars are available now on a clearly-labelled in-store gross basis (§9 C1). The only
thing that remains genuinely unsupportable is per-employee *guest scoring*, which fails on
sample size rather than plumbing — and, as Sam noted, on the absence of `OrderId`.

### Source-of-truth rules (Sam's directives, locked)

| Domain | Source | Note |
|---|---|---|
| Hours, rates, roles, schedule, timecards, edits | **Brink** | canon for all labor |
| Per-employee sales, service times, breaks, overrides | **Brink** | `EmployeeSalesSummary`, `EmployeeBreaks`, `ManagerOverrideDetail` |
| Hire date | **Brink** first (41%), NetChef fallback flagged approximate | §2.5 |
| Date of birth | **NetChef** | the one real gap — Brink has no DOB field |
| Sales / COGS / labor % rollups | **`core/sources.ts`** | unchanged |

### v0 — Fixes (hours, not weeks)

| Fix | Why |
|---|---|
| `salesPerHour ?? storeSalesPerHour`, `voidPct: storeVoidPct`, `discountPct: 0` (§9 C7) | three store-level numbers rendering in per-employee columns today |
| `recap.py` role exclusion (§9 C5) | last cross-surface labor disagreement |
| `itemsales` employee stamp (§1.1) | no longer blocking, but it upgrades per-employee sales from in-store gross to canonical order-level net |

### v1 — The module

1. `employee_dim` + `employee_alias` — Brink-first hire date, NetChef DOB, alias merge screen
2. Profile + roster
3. **Productivity** — `EmployeeSalesSummary`: orders, guests, in-store gross, ASG, AST, and
   the `ATT`/`TPP` service times, all on the labelled Brink basis
4. **Attendance** — scheduled vs worked, punctuality, no-shows, unscheduled shifts, OT
5. **Minor-hour compliance** — flags on the posted schedule, before hours are worked
6. **Timecard integrity** — `labor_edits`: who edits, self-edits, post-period deletions
7. **Recognition** — birthdays, anniversaries, milestones

### v2 — Exceptions & Loss Prevention

`ManagerOverrideDetail` ingest (no-sale drawer opens with named requester *and* approver —
currently uncaptured), till variance on a persistence basis, void/discount on the
**canonical** definitions (§9 C2), and the association lens as an exposure-normalized
lookup with no ranking.

### v3 — Quarterly Reviews

Rides on v1 + v2. Anniversary-based, five sections, peer-relative within store × role.

### Cut, and stay cut

- **Per-employee guest scoring** — ±17.7 pts on the best-covered person. Unlocks only if SMG
  exposes `OrderId` (a permissions request, not engineering) *and* the itemsales stamp is
  fixed so the order carries a cashier.
- **Association ranking or flags** — 0 of 28 clear a store-controlled null. The lookup ships;
  the ranking does not.
- **Turnover analysis** — no termination date in Brink (`Terminated:` 0% populated) or
  NetChef. Not supportable today; would need a new source.
- Any blended "risk score" or composite employee rating.

### Why this order

v1 is now the full module rather than a consolation prize: productivity, attendance,
compliance and recognition all ship together, every metric from Brink, every rollup from
`core/`. v2 adds the one genuinely new loss-prevention feed. v3 needs both.

The compliance piece still argues for moving first — **13 active crew under 18**, Florida
school-week hour caps, and nothing in the stack watching it.
