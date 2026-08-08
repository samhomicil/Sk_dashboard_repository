<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SK Wellness Dashboard

**Read [README.md](README.md) first** — architecture, data sources, auth model, and the
data gotchas that have caused real bugs. The rules below are the ones most often broken.

## Non-negotiables

1. **Never hardcode a target or a metric's data source.** Targets come from
   `src/lib/core/targets.ts`, metric SQL from `src/lib/core/sources.ts`. Restating a
   number locally is how the Overview ended up grading labor at 25% while Weekly Ops
   used 22% — the same store read "on target" on one tab and "over" on another.

2. **Money routes need both gates.** Add the prefix to `OWNER_APIS`/`OWNER_PAGES` in
   `src/proxy.ts` *and* call `requireOwner()` (APIs) / `requireOwnerPage()` (pages)
   inside the handler. Middleware alone is not sufficient, and hiding a nav link is not
   a security boundary. Verify as a manager with `curl` — expect 403.

3. **Never expose raw SQL through a route.** The DB proxy executes arbitrary SQL and
   commits writes. An `/api/query` passthrough previously let any signed-in manager read
   every bill and payroll figure; it was removed. Use a purpose-built route.

4. **Verify a suspicious number against source data before shipping it.** Booked
   accounting lines aren't always the true cost — QuickBooks' "Merchant Fees" line
   reflects ~0.6% of sales while the processor statement shows the real ~3.1% of card
   volume, because the monthly sweep books to a different account.

5. **Check which branch you're on before editing.** This repo frequently has parallel
   sessions with uncommitted work. Ship from a `git worktree` off `origin/main` (see
   README) rather than committing into someone else's branch.

6. **Trace a data source before describing it.** Legacy `sigma*` identifiers in
   `cache-builder.ts` alias `sql*` functions, and `data/sigma-daily.json` is a
   historical filename — reading those names and inferring "this comes from Sigma"
   produces a confidently wrong answer. Sigma is not a data source anywhere; sales and
   recipe COGS are Azure SQL on every surface. Follow the query, not the variable name.

## Login / OAuth

Production is **<https://sk-dashboard-delta.vercel.app>** (no custom domain) and
`AUTH_URL` is pinned to it. Any origin used for sign-in must have
`<origin>/api/auth/callback/google` registered on the Google client (project
**SK wellness**, `1038153123380`, client still named *"SK Bills"*), or Google returns
"Access blocked: This app's request is invalid". Per-build
`sk-dashboard-<hash>-sk-wellness.vercel.app` URLs are *not* registered. The README has a
curl recipe for diagnosing this without a browser.

## Manager vs owner framing

Labor **%** shown to managers is *unloaded hourly wages ÷ net sales*, so it reconciles
with the POS. Tips, salaried manager pay, employer burden and taxes are owner-side
concepts — they belong in Budget and Cash Flow, never on the manager surfaces.
