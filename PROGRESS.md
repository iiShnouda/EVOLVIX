# SKB — Progress & Handoff

A running record of what is built, the decisions behind it, and what's next — so any new
session (or teammate) can pick up without losing context. Pair this with **`ROADMAP.md`**
(the full feature catalog of the old ERP) and **`CLAUDE.md`** (the non-negotiable rules).

_Last updated: 2026-09-28._

---

## 1. What this is
Bilingual (AR/EN) wholesale accounting app for one company: a **website + installable apps**
(iPhone/Android via PWA, Windows native), all talking to one **C# / PostgreSQL** server.
Security-first, server-authoritative (no business data readable offline).

## 2. Where it runs
- **Live:** https://skb-d211.onrender.com (Render, single Docker service; DB on free Neon Postgres).
- **Deploys automatically** when the working branch is pushed (Render blueprint = `render.yaml`).
- **Working branch:** `claude/nifty-dirac-lv9vbj` — develop and push here only.
- **On-prem option:** `docker compose --profile full up -d --build` (see `COMPANY-SERVER.md`).
- **Demo login:** `owner@skb.local` + the `Seed__OwnerPassword` env (dev default `ChangeMe!Owner123`).

## 3. Layout
- `apps/api` — **C# ASP.NET Core 10 + EF Core + Npgsql (PostgreSQL)**. The source of truth.
- `apps/web` — **React 19 + Vite 6 + Tailwind v4** PWA (web + iPhone/Android surface).
- `apps/windows` — **C# WPF** native desktop client (`SKB.Core` + `SKB.App`).
- `packages/shared` (`@skb/shared`) — TS types, AR/EN dictionary, zod schemas, roles/permissions,
  nav model, money/locale helpers, country/currency reference data.

## 4. What's DONE
**Foundation**
- Auth: JWT access tokens, PBKDF2 hashing, AES-256-GCM encrypted revocable refresh sessions,
  per-permission authorization (deny by default), branch scoping, rate limiting, **audit log**,
  SignalR presence. Nothing readable offline (offline gate).
- Screens: Login, Dashboard (KPIs + trend + low stock + recent docs), Customers & Suppliers.

**Phase 1 — Invoicing + profitability** (see commits `feat(phase1)`, entities `StockMovement`,
`CompanySettings`, profit/cost on documents)
- **Sales invoice builder** (`/sales/new`): pick customer, search products, per-line qty & price,
  **live markup %, profit, and margin**, totals with profit, save.
- **Purchase invoices** (`/purchases/new`): receive stock, which recomputes each product's
  **moving weighted-average cost** — this is what keeps future profit correct.
- **Profit floor** (the owner's "1 and 2 combined" rule): **never below cost** (hard, un-overridable)
  PLUS a **configurable minimum markup %** (blocked, but a user with `sales:override_floor` can
  override — never below cost regardless). Oversell is blocked.
- Party balances update (receivable on sale, payable on purchase). Every mutation audited.

**Profitability report** (`/analytics`, commit `feat(reports)`)
- `GET /api/reports/profitability?from&to&by=customer|product|day` → totals (net sales, cost,
  profit, margin) + breakdown rows. This is the old app's **تقارير الربحية**.

**Settings** (`/settings`, commit `feat(settings)`)
- Owner/admin edit **VAT %, base currency, country, default markup, minimum-markup floor**.
  Picking a country suggests its currency + typical VAT (overridable). `PUT /api/settings`
  (SettingsManage, audited); the invoice builder reads these defaults.

**Terminology fix** (commit `fix(i18n)`)
- Party balances use standard accounting terms: **مدين / Receivable** and **دائن / Payable**
  (were plain "لنا عليهم / لهم علينا"). Fixed in web + Windows.

## 5. Key business-logic decisions (verified, see ROADMAP §3)
- **Money = integer minor units** (piastres), never floats. `MINOR_UNITS = 100` (2 decimals).
- **Inventory costing = moving weighted average.** Receipt recomputes avg cost; sale issues at
  avg cost (that becomes COGS). Profit = price − avg cost. Method is a company setting (FIFO later).
- **Discount = margin reduction** (the "300 + 8%" model): the sale price is cost × (1 + markup);
  a discount lowers the markup, so the seller always sees the real profit left.
- **Double-entry** is the target for the ledger phase; documents will post their own balanced
  entries (not yet built — Phase 3).
- **Tax is pass-through**, not profit. Default VAT is a setting (starts 0%; owner sets their own).

## 6. Known limitations / cleanup TODO
- **Multi-currency is base-currency only.** You can choose the base currency from a list, but
  invoices are not yet issued in multiple currencies with FX conversion. Also, 3-decimal
  currencies (KWD/BHD/OMR/JOD) are listed but **money storage assumes 2 decimals** — supporting
  them needs per-currency minor units (`money.ts`) + storing currency decimals. Do this before
  enabling those currencies for real amounts.
- Historical **seeded** documents got cost/profit backfilled at seed cost; fine for the demo.
- No **returns** yet (sales/purchase returns) — the enum values exist, the flows don't.
- Windows client mirrors the DTO contract but has **no invoice-builder UI yet** (display only).
- `Program.cs` has one deprecation warning (`ForwardedHeaders.KnownNetworks`) — harmless.

## 7. What's NEXT (pick up here)
From `ROADMAP.md`, in suggested order:
1. **Finish Phase 1:** sales/purchase **returns** (restock + reverse profit + party balance).
2. **Phase 2 — Inventory depth:** item card (كارت الصنف) from `StockMovement` (already recorded),
   stock valuation, multi-store transfers (إذن تحويل), stocktake/adjustment, reorder alerts.
3. **Phase 3 — Accounts / general ledger:** chart of accounts, journal entries, account statements.
4. **Phase 4 — Notes** (أوراق قبض/دفع) & due payments.
5. **Phase 5 — Financial statements:** trial balance, income statement, balance sheet (from the ledger).
6. **Phase 6 — Analytics:** movement, dead stock, net monthly sales, top clients (charts).
7. **Phase 7 — Admin & close:** users UI, backups, period close, PDF/Excel export, owner presence view.
8. **Phase 8 — Android** native client.

**Open question for the owner:** full per-invoice multi-currency + FX — needed soon, or base
currency is enough for now?

## 8. Dev commands
- **API:** `cd apps/api/src/SKB.Api && dotnet run` (migrates + seeds on startup).
  Migration: `dotnet ef migrations add <Name>`. Reset local DB: `dotnet ef database drop -f`.
  (In this cloud env, .NET lives at `/usr/lib/dotnet`; a local Postgres runs on :5432.)
- **Web:** from repo root — `pnpm dev` (Vite :5173, proxies `/api` → :5080), `pnpm build`,
  `pnpm typecheck`. After changing `packages/shared`, run `pnpm --filter @skb/shared build`
  so the web typecheck sees the new types.
- **Windows:** open `apps/windows/SKB.sln` in Visual Studio (Windows only).

## 9. Rules that must hold (from CLAUDE.md)
- No business data cached on the client; server is the only source of truth; every mutation audited.
- Money as integer minor units. Bilingual by construction (no hard-coded user strings).
- Update the JSON contract in all three (api / web-shared / windows) together when a shape changes.
- **Secrets never in the repo** — only in the host's env vars (Render / `.env` on-prem).
- Push only to `claude/nifty-dirac-lv9vbj`.
