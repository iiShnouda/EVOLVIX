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
- **Deploys automatically** when `main` is pushed (Render blueprint = `render.yaml`, `branch: main`).
  The Render service's own Settings → Branch must also say `main` (it previously tracked
  `claude/nifty-dirac-lv9vbj`, which is now merged and retired).
- **Working branch:** `main` (repo `iiShnouda/SKB`).
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

**Sales & purchase returns** (مرتجع مبيعات / مرتجع مشتريات) — finishes Phase 1
- A return is always issued **against one invoice** (`SourceDocumentId` on the document,
  `SourceLineId` on each line). Quantity is capped per line at sold/bought − already returned;
  the invoice row is locked (`SELECT … FOR UPDATE`) while a return posts, so two people can't
  over-return the same invoice. Fully returned invoice → status `RETURNED`.
- **Sales return:** goods back into stock at the line's original `UnitCost` (restores the weighted
  average correctly), revenue/profit reversed, customer balance credited by the total minus any
  cash refunded now (`RefundAmount`, stored in `PaidAmount`).
- **Purchase return:** goods out at the price we paid, and that receipt is backed out of the
  weighted average (`InventoryService.ReturnToSupplier`, exact inverse of `Receive`). Refused if
  the goods are no longer in stock. Payable reduced by the total minus cash received back.
- Discount and tax return **proportionally**; the return that completes a line/invoice takes
  exactly what's left, so rounding never strands or over-returns a piastre.
- Endpoints: `GET /api/{sales|purchases}/returns`, `GET …/returns/{id}`,
  `POST /api/{sales|purchases}/invoices/{id}/returns` `{ lines: [{ lineId, quantity }], refundAmount, notes }`.
- New permissions **`sales:return`** (OWNER/ADMIN/ACCOUNTANT — deliberately *not* SALES, since a
  return moves money out) and **`purchases:return`** (OWNER/ADMIN/ACCOUNTANT/INVENTORY).
- Profitability report + dashboard revenue/purchases/trend are now **net of returns**
  (`ProfitReport.returns` shows the amount subtracted).
- Web: Sales and Purchases share one `DocumentsPage` with **Invoices | Returns** tabs and a
  preview (purchases now have a preview too); "Return items" on an invoice preview opens
  `ReturnBuilderPage` (`/{scope}/invoices/:id/return`) with live value / cost / profit reversed.
- Fix: `GET /api/sales/invoices/{id}` no longer returns purchase documents to `sales:view` users.
- Migration `SalesPurchaseReturns`. Windows models mirror the new fields (no returns UI there yet).

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
- Returns can't be cancelled/voided yet (no cancel flow for any document). Queries already
  ignore `CANCELLED` returns, so adding "cancel" later only needs the reversing stock/balance post.
- Returns are always against an invoice; a "return without invoice" (unknown sale) isn't supported
  by design — it would let goods re-enter stock at a guessed cost.
- Windows client mirrors the DTO contract but has **no invoice-builder or returns UI yet** (display only).
- `Program.cs` has one deprecation warning (`ForwardedHeaders.KnownNetworks`) — harmless.

## 7. What's NEXT (pick up here)
From `ROADMAP.md`, in suggested order (Phase 1 is complete — returns shipped):
1. **Verify returns on the live DB** after deploy (sell → partial return → full return; buy →
   return to supplier) and check stock, avg cost, party balance and the profitability report.
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
- Work on `main`; pushing `main` deploys to Render.
