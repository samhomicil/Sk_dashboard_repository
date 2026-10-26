# SK Wellness Dashboard

Operating dashboard for three Smoothie King franchise stores — **Pines (1392)**,
**Miramar (1892)**, **Margate (2384)**. One Next.js app, role-gated: managers get the
operating surfaces, owners additionally get the financial ones.

It reads from a shared Azure SQL database fed by external pipelines covering POS,
timekeeping, food vendors, inventory, guest feedback, SOPs, reviews, accounting and
banking (see [Data sources](#data-sources) for the full list). This app is the
**read/analysis layer** — the extractors that populate the database live in sibling
repos and are not deployed from here.

---

## Quick start

```bash
npm install
npm run go        # starts the Azure SQL proxy AND next dev together
```

`npm run go` is the one to use. Plain `npm run dev` starts the web app but **not** the
database proxy, and every data query will fail.

| Script | What it does |
|---|---|
| `npm run go` | Flask SQL proxy + `next dev` concurrently — **normal local dev** |
| `npm run dev` | Web app only (no DB — expect empty/erroring panels) |
| `npm run build` | `prisma generate && next build` |
| `npm run refresh` | Rebuilds the cached JSON in `data/` from Azure SQL |
| `npm run ship` | `refresh` then commit+push `data/` |
| `npm run lint` | ESLint |

### Database access — two paths

[`src/lib/db.ts`](src/lib/db.ts) `query()` picks its transport automatically:

- **`AZURE_SQL_SERVER` set** → direct `mssql` connection (this is what Vercel uses).
- **otherwise** → HTTP POST to `PROXY_URL`, a local Flask proxy
  (`python3 /Users/sam/azure-sql-proxy.py`, default `http://127.0.0.1:5001/query`).

The proxy exists because local machines aren't in the Azure SQL firewall allowlist.
It executes arbitrary SQL **and commits writes**, so it must never be exposed publicly
or proxied through a browser-reachable route.

---

## Architecture

```
Next.js 16.2.9 (App Router) · React 19.2.4 · next-auth v5 · Prisma · mssql · recharts
                       ↓
        ┌──────────────┴───────────────┐
   src/lib/db.ts                  src/lib/prisma.ts
   (smoothieking schema           (sk_bills schema —
    — operating data)              financial//bills data)
                       ↓
              Azure SQL (one server, two schemas)
```

### `src/lib/core/` — the shared rule layer

**Any metric that appears on more than one screen must be computed from here.** The
whole point is that two surfaces can never disagree about the same number.

| File | Owns |
|---|---|
| `targets.ts` | **Single source of truth for targets** — labor 22%, recipe-COGS 25%, store list, default pay rate, PFG delivery days |
| `sources.ts` | Canonical SQL per metric — which table/column *defines* food spend and net sales |
| `labor.ts` | Employee pay-rate resolution (most-recent rate, store-average fallback) |
| `laborBurden.ts` | Employer burden — FICA/FUTA/FL-SUI on first $7k per employee + WC; tip payout share |
| `forecast.ts` | 4-week same-weekday sales forecast |
| `dates.ts` | ET-safe date math |

> `src/lib/config.ts` holds Overview-only targets and **re-exports** `laborPct`/`cogsPct`
> from `core/targets.ts`. Do not restate a target there — that's exactly the bug that let
> the Overview grade labor at 25% while every other surface used 22%.

### Route groups

**Manager-facing** — `/` (Overview), `/ops-report` (Weekly Ops),
`/inventory` + `/inventory/{categories,stores,vendors,watchlist}`, `/menu-mix`,
`/guest-voice`, `/marketing` (Healthy Rewards offer calendar).

**Owner-only** — `/financials` (Budget), `/cashflow`, `/bills`, `/bills/vendors`,
`/pnl`, `/transactions`, `/settings`.

*(An `/employees` module and `/inventory/shrink` exist on a feature branch and are not
yet on `main`.)*

---

## Auth & roles

Google OAuth via next-auth v5. Two layers, both required:

1. **Sign-in allowlist** — [`src/auth.ts`](src/auth.ts): email must be in
   `ALLOWED_EMAILS` (comma-separated) or match `ALLOWED_EMAIL_DOMAIN`. Enforced in the
   `signIn` callback, so a non-allowlisted Google account can't get a session at all.
2. **Route gate** — [`src/proxy.ts`](src/proxy.ts) (Next 16 renamed `middleware` →
   `proxy`). Every route needs a session; the financial prefixes additionally need
   owner role. Pages redirect, APIs return 401/403 JSON.

`OWNER_EMAILS` decides owner vs manager; `session.user.role` is `'owner' | 'manager'`.

**Defense in depth is mandatory for money routes.** Every owner-gated API also calls
`requireOwner()` from [`src/lib/owner-guard.ts`](src/lib/owner-guard.ts) at the top of
the handler, and owner pages call `requireOwnerPage()`. The guard fails *closed* — if
auth throws, it returns 401 rather than serving data. Never rely on the middleware
alone, and never rely on hiding nav links.

**When adding a route that touches money:** add its prefix to `OWNER_APIS`/`OWNER_PAGES`
in `proxy.ts` **and** call the guard in the handler. Verify as a manager with `curl`
(expect 403) before shipping. `/api/cost-plan` sits in `OWNER_APIS` with no route behind
it **on purpose** — pre-gating so the planned route can't ship ungated.

`/api/refresh` is deliberately **not** owner-gated (see Caching) — the Refresh button is
a manager surface. It's rate-limited instead.

### Hub API (`/api/hub/*`)

A small read-only feed for Sam's agent hub (Nexus). Nexus's **server** calls it with
`Authorization: Bearer $HUB_TOKEN`, so its alerts carry the same numbers these screens show.
Every number comes from the same core rule the screen uses; nothing is recomputed.

- **Auth.** [`src/lib/hub-guard.ts`](src/lib/hub-guard.ts) `requireHubToken(req)` is the first
  line of every hub handler: sha256 of both sides, then `timingSafeEqual`; it fails closed
  when `HUB_TOKEN` is unset, under 32 characters, or equal to an agent token. The routes are
  left out of the proxy's session gate (matcher entry `api/hub/`, with the slash) the way the
  crons are, so that check is their only gate — and a session cookie is **not** a credential
  there. `npm run check` fails if a hub route skips the check, reads a session, or the
  matcher entry is widened.
- **Responses** are JSON with `Cache-Control: no-store`; 401 `{"error":"unauthorized"}` on any
  token problem, 400 on a bad `date`, 502 `{"error":"query failed"}` if the database errors.

| Endpoint | Returns | Source (same as) |
|---|---|---|
| `GET /api/hub/cash` | per store: bank `balance` (checking, cashTotal, asOf, ageHours, stale); the next `HUB_CASH_DAYS` (14) forecast `days` (date, balance, inflow, outflow, outflow `items` ≥ `HUB_OUTFLOW_ITEM_MIN` $300 with label + note); `firstBelowZero` and `lowest` {date, balance, items} over those days; `forecast` {asOf, updatedAt, balanceSource, flaggedStale}; `stale` + `staleReasons` (`balance` older than `OPENBUDGET_STALE_HOURS`, `forecast_flagged` by forecast.py, `forecast_old` past the freshness registry's 2 days) | `sk_bills.Forecast` rows as written (Cash Flow), `getLiveBalances()` over `sk_bills.QbBalance` |
| `GET /api/hub/checklists?date=YYYY-MM-DD` | the day (default yesterday ET), `target` (`SOP_COMPLETE_TARGET`), `dayComplete`; per store `lists_due`, `lists_done`, `lists_on_time`, `temp_due`, `temp_done`, `rate` (done ÷ due), `below_target`, `counted` (false before the store's `CHECKLIST_SINCE` or with nothing due — rates are then null) | `smoothieking.opsx_daily` (the nightly recap's rule; a view over the tables `/api/checklists` reads) |
| `GET /api/hub/sales` | per store and `total`: `today` so far, `yesterday`, `lastYear` (same weekday 364 days before yesterday) as {net, orders}, plus `yesterdayVsLastYear`; `today.asOf` = last successful Brink pull (ET), `runId`, `stale` by the Now screen's rule | `NET_SALES` + `ORDERS` over `smoothieking.sales` (Now / Scorecard); today keyed to the latest intraday run, never a stale cache |
| `GET /api/hub/guest` | open SMG guest cases per reporting store: `open` = unresolved + in progress, the open `days` with each one's `capturedAt`, `latestCapturedAt`. SMG reports Pines and Miramar together, so that row is `"Pines+Miramar"` with `combined: true` | `smoothieking.guest_cases` (Guest Voice "pending") |

```bash
curl -s -H "Authorization: Bearer $HUB_TOKEN" https://sk-dashboard-delta.vercel.app/api/hub/cash
```

### Google OAuth — the canonical URL matters

There is **one** OAuth client for both this app and sk-bills: Google Cloud project
**SK wellness** (number `1038153123380`), client still named **"SK Bills"** for historical
reasons. Console:
<https://console.cloud.google.com/apis/credentials?project=1038153123380>

Production is **<https://sk-dashboard-delta.vercel.app>** — there is no custom domain.
`AUTH_URL` is pinned to that origin so NextAuth always sends the same `redirect_uri`.

> ⚠️ **Every origin you sign in from must be registered** as an Authorized redirect URI
> (`<origin>/api/auth/callback/google`) on that client, or Google returns *"Access
> blocked: This app's request is invalid"* (`redirect_uri_mismatch`). Registered today:
> the production origin and `http://localhost:3000`. The
> `sk-dashboard-<hash>-sk-wellness.vercel.app` links in the Vercel dashboard are
> **per-build** origins — without `AUTH_URL` pinned they could never authenticate.

**Diagnosing a login failure without clicking through a browser:**

```bash
B=https://sk-dashboard-delta.vercel.app
curl -s $B/api/auth/providers                  # the callbackUrl the app advertises
CSRF=$(curl -s -c /tmp/j $B/api/auth/csrf | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
LOC=$(curl -s -b /tmp/j -c /tmp/j -o /dev/null -w '%{redirect_url}' -X POST $B/api/auth/signin/google \
      -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode "csrfToken=$CSRF")
curl -s -o /dev/null -D - "$LOC" | grep -i ^location
```

A redirect to `accounts.google.com/signin/oauth/error?authError=…` means rejected —
**base64-decode the `authError` value** and Google states the reason plus the offending
`redirect_uri` verbatim. A redirect to `/v3/signin/identifier` means accepted.

---

## Data sources

Everything lands in Azure SQL; this app only reads. Extractors live in sibling repos.

| Source | Feeds | Used for |
|---|---|---|
| **Brink POS** | `sales`, `tillhistory`, `employee_sales` | net sales, orders, channels, cash tender |
| **Brink timekeeping** | `labor`, `labor_schedule`, `labor_edits` | actual + scheduled labor cost/hours |
| **PFG** | `pfs_invoices` (`pfg_compat` is a view alias) | food purchases |
| **Walmart** | `walmart_spend` | local top-up buys |
| **NetChef / CrunchTime** | `netchef_usage_api`, `netchef_onhand`, `ee_check` | recipe (theoretical) COGS, on-hand, **E&E %** |
| **SMG360** | `guest_feedback`, `guest_daily`, `guest_comments` | guest satisfaction |
| **Jolt** | `jolt_list_instances`, `jolt_image_quality` | SOP completion |
| **SOCi** | `soci_reviews`, `soci_daily` | reviews / social |
| **QuickBooks** | `sk_bills.*` via OAuth | P&L and other accrual reporting only |
| **OpenBudget** | `sk_bills.QbBalance`, `/api/transactions` | **live bank balances** (anchor for the cash forecast) + raw transactions, enriched via the vendor-alias table |

### Gotchas that have caused real bugs

- **E&E % is CrunchTime's, from `ee_check` — never from `sales`.** Every EE% in the app is
  Σ `ee_qty` ÷ Σ `smoothie_qty`, the "E&E Qty %" managers read in Crunchtime Insights → E&E
  Report, loaded from NetChef's menu mix by `src/scripts/load_ee_netchef.py`. Brink's item
  export has no modifier prefix, so from `sales` an added enhancer and a "NO Turbinado" line
  look alike and free cup/milk lines read as add-ons; the per-order attach rate built on it
  ran 3–15 points off CrunchTime. Definition and caveats: `core/sources.ts` `EE_CHECKS`.

- **`netchef_usage_api`, not `netchef_usage`.** The old table holds ~1 week;
  `_api` holds ~30. Trailing-average COGS off the old table silently collapses to a
  single week.
- **Walmart: use `order_subtotal` per distinct `order_id`.** The item-level columns are
  ~44% blank and undercount.
- **Net sales is always** `SUM(CASE WHEN voided=0 AND is_modifier=0 THEN net_sales END)`.
  Use `NET_SALES` from `core/sources.ts`.
- **Bank balance ≠ QuickBooks balance.** QBO only exposes *book* balance and lags badly.
  OpenBudget's posted balance is the anchor (SimpleFIN was retired 2026-08-08 — OpenBudget
  covered more, e.g. Miramar's Capital One card, and was fresher). Use **posted**, not
  available — available includes in-transit card deposits that the T+2 model already
  projects (double-count).
- **Franchise fees bill on SK fiscal *periods* (5-4-4), not calendar months** — see
  `src/lib/bills/periods.ts`. Sales, however, *are* booked on calendar dates.
- **QuickBooks' "Merchant Fees" P&L line understates the real cost** — the monthly
  processor sweep books elsewhere. True processing ≈3.1% of card volume.

---

## Caching

`data/*.json` holds pre-built rollups (heatmap, menu mix, EE%, purchasing) computed
from Azure SQL, committed to the repo and read at runtime. `npm run refresh` rebuilds
them; `npm run ship` rebuilds and pushes. `SK_DATA_DIR` can point the builders at a
temp directory during a rebuild.

`POST /api/refresh` rebuilds the cache in-process on Vercel and writes
`smoothieking.dashboard_cache`. It is reachable by any signed-in user (the Refresh
button is on the manager Overview, by design) and is throttled by a **5-minute
cooldown** measured against the persisted `refreshedAt` — the in-memory `isRunning`
flag can't throttle serverless, where instances don't share memory.

> **Sales and COGS do NOT diverge between surfaces.** Overview, Weekly Ops and Budget
> all read `smoothieking.sales` live using the identical `NET_SALES` expression, and
> both Overview and Weekly Ops derive recipe COGS from `netchef_usage_api` with the
> same `qty_issue * price` formula — they differ only in the window each requests.
> Sigma is no longer a data source anywhere. Beware the legacy `sigma*` identifiers
> still aliasing `sql*` functions in `cache-builder.ts`: they are SQL, and the name
> `data/sigma-daily.json` is likewise historical.

---

## Environment

| Variable | Purpose |
|---|---|
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth |
| `AUTH_SECRET` | NextAuth JWT signing |
| `AUTH_URL` | pins the OAuth callback to the canonical origin (see Auth) |
| `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAIN` | who may sign in |
| `OWNER_EMAILS` | who gets the financial modules |
| `AZURE_SQL_SERVER` / `_DATABASE` / `_USER` / `_PASSWORD` | direct SQL (production) |
| `PROXY_URL` | local Flask proxy fallback |
| `DATABASE_URL` | Prisma → `sk_bills` schema |
| `QBO_CLIENT_ID` / `_SECRET` / `_ENV` / `_REDIRECT_URI` | QuickBooks OAuth |
| `OPENBUDGET_REDIRECT_URI` (optional; defaults to production) | OpenBudget OAuth callback |
| `OPENBUDGET_STALE_HOURS` | bank-balance freshness guard |
| `CRON_SECRET` | authenticates the `/api/sync` cron |
| `REFRESH_SECRET` | `x-refresh-key` for `/api/ingest-refresh` (Azure job `dash-refresh` sends it from its `refresh-key` secret). Required: with it unset the route refuses every call |
| `HUB_TOKEN` | bearer token for the read-only hub feed `/api/hub/*` (the Nexus agent hub; see [Hub API](#hub-api-apihub)). At least 32 characters and different from `AGENT_TOKEN_*`. Unset, short or reused = every hub call is refused (401). Set it in Vercel as **Sensitive**, Production only |
| `SK_DATA_DIR` | override for the `data/` cache location |

`SIGMA_CLIENT_ID` / `SIGMA_CLIENT_SECRET` are **no longer used** — the Sigma client was
deleted. They are not set in any Vercel environment; remove any local leftovers.

Secrets live in `.env.local` (gitignored) and Vercel project settings — never in the repo.

> **Reading env values back:** `vercel env add` creates variables as **Sensitive**, which
> are write-only — `vercel env pull` returns `VAR=""` for them. An empty value on pull
> does **not** mean the variable is unset. Confirm with `vercel env ls` instead.

---

## Deploying

Push to `main` → Vercel builds and deploys production. There is no separate release step.

**Scheduled:** `/api/sync` runs daily at 06:00 UTC (`vercel.json`) to refresh bank
balances. `/api/ingest-refresh` is POSTed by the external 6am cloud routine and is
authenticated by the `x-refresh-key` header, not a session.

> Both cron routes, and the hub feed `/api/hub/*` (bearer `HUB_TOKEN`), are **excluded from
> the session gate** in `proxy.ts` (they have no user session), so their secret *is* their only
> protection. All of them **fail closed** —
> a missing secret rejects the request rather than skipping the check. Keep
> `CRON_SECRET`, `REFRESH_SECRET` and `HUB_TOKEN` populated in Vercel. `/api/ingest-refresh` accepts only
> `REFRESH_SECRET` (constant-time compare); it no longer falls back to the database password.

### Working alongside other sessions

This repo often has parallel work in flight. Before editing, check
`git branch --show-current` — you may be on someone else's feature branch with
uncommitted changes. To ship safely without disturbing them:

```bash
git worktree add /tmp/my-fix origin/main
cd /tmp/my-fix && git switch -c my-fix
# edit, npx tsc --noEmit, commit
git push origin HEAD:main
git worktree remove /tmp/my-fix
```

---

## Conventions

- **Never hardcode a target or a metric's source.** Import from `core/targets.ts` /
  `core/sources.ts`. A number that disagrees with itself across two screens destroys
  trust in every other number on the page.
- **Verify a suspicious figure against source data before shipping it.** Booked
  accounting lines are not always the true cost.
- Labor **%** displayed to managers is *unloaded hourly wages ÷ net sales* so it
  reconciles with the POS. Fully-loaded labor (tips, salary, burden) is an owner-side
  concept and belongs in Budget/Cash Flow, not the manager surfaces.
- This is Next.js **16** — App Router, `middleware` is `proxy.ts`. Check
  `node_modules/next/dist/docs/` before assuming an older API.
