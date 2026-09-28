# SKB — Progress & Handoff

A running record of what is built, the decisions behind it, and what's next — so any new
session (or teammate) can pick up without losing context. Pair this with **`ROADMAP.md`**
(the full feature catalog of the old ERP), **`DOMAIN.md`** (how SKB models it: entities, rules,
postings, build order) and **`CLAUDE.md`** (the non-negotiable rules).

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

**Inventory depth, first slice** (المخزون — Phase 2)
- **Inventory page** (`/inventory`): every item with stock, average cost, value and reorder status;
  KPIs for total stock value / item count / items at reorder level (`?low=1` filters to those).
  `GET /api/inventory/items?search&lowOnly` — totals always cover all active stock.
- **Item card** (كارت الصنف, `/inventory/items/:id`): opening balance before the period, every
  movement in it with running balance and cost, closing balance and value. Each movement links to
  its invoice/return (`/sales?doc=<id>`, `/purchases?tab=returns&doc=<id>`, …) when the viewer may
  see it. `GET /api/inventory/items/{id}/card?from&to` (default last 30 days).
- **Stock valuation** (تقييم المخزن, Inventory → Stock valuation tab): quantity × weighted-average
  cost at the end of any date, by category and by item. Today reads the live stock; a past date
  reads each item's last movement before that day (`BalanceAfter`, `AvgCostAfter`).
  `GET /api/inventory/valuation?asOf=YYYY-MM-DD`.
- **Stocktake / adjustment** (الجرد والتسويات, `/inventory/stocktake`, plus a one-item "Adjust
  stock" box on the item card): enter the counted quantity; only differences post, as
  `ADJUSTMENT` movements at the current average cost (average unchanged), all under one
  `ADJ-YYYY-NNNNNN` reference with the reason stored in the new `StockMovement.Note`.
  Items are row-locked while posting, so concurrent counts serialise. `POST /api/inventory/stocktake`
  (`inventory:edit` — OWNER/ADMIN/INVENTORY; audited as `stocktake`).
- Migration `InventoryStocktake` adds `Note` and **backfills a missing `OPENING` movement** for any
  item whose stock ≠ Σ movements (databases seeded before the ledger existed), dated just before the
  item's first movement with its cost recovered from that movement — so item cards and past
  valuations tie out on the live DB. No-op on a fresh DB; idempotent.
- Windows models mirror the new DTOs (display-only there).
- Verified locally: 61 API checks (totals, filters, card opening/in/out/closing, valuation today vs
  past, stocktake gain/loss/no-change/negative/duplicate/403, concurrency, backfill) + UI in EN/AR/phone.

**AI translation of names** (owner request 2026-09-29) — DOMAIN.md §2.1b
- **Model:** branches, warehouses, categories and products store `NameAr`/`NameEn` plus
  `NameSource` / `NameAuto` / `NamePending` (`ILocalizedName`). The rules are in `Loc.Apply`:
  - A person's text is never overwritten.
  - An AI translation follows its source until a person corrects it.
- **`TranslationWorker`** (background service): translates waiting names in batches through any
  OpenAI-compatible API (default CodeCraft `https://codecraftapi.com/v1`).
  - Offline or on failure, it backs off from 10s up to 5 min and keeps names waiting.
  - A save wakes it at once.
  - Model: `Translation__Model`, or the first cheap-looking one from `/v1/models`.
  - **Key:** set `Translation__ApiKey` on the server (Render dashboard). It is never sent to browsers.
- **Language:** the API answers in `Accept-Language` (the web app sends the screen language and
  refetches when it changes).
  - Every list, card, valuation, transfer and invoice name follows the screen language.
  - Inventory and product search match both languages.
- **Branches & warehouses page:**
  - Add a branch (it gets a "Main store" automatically) and edit a branch.
  - Create forms show one name field in the screen language.
  - Edit forms show both languages, with an "AI" mark and "Translating…" while waiting.
  - Settings shows whether translation is on, how many names wait, and the last problem.
- Endpoints: `POST`/`PUT /api/branches`, `GET /api/settings/translation`. Name fields
  `nameAr`/`nameEn` (a plain `name` still works, taken in the request language).
- **Migration `LocalizedNames`:** existing names become the English source with Arabic
  waiting. The seed has Arabic names.
- **Verified:** translation 24/24 against a stand-in AI server:
  - backfill
  - Arabic-only create
  - the edit rules
  - search in both languages
  - **offline: waits, falls back, catches up once the service is back**
  - localized invoices and item card

  The other suites still pass on both an upgraded and a fresh database. The browser flow was
  checked in Arabic, exactly as requested: only the Arabic field while creating, then both in
  edit with the AI English.

**Per-branch cost** (owner decision 2026-09-29)
- Each branch has its own weighted-average cost per item. The data lives in `StockCost`:
  - one pool per branch
  - plus the transit warehouse as its own pool
- **Postings:**
  - Purchases, sales, returns and stocktakes post at the cost of the warehouse's branch.
  - The profit floor on a sale uses that cost too.
  - Transfers carry the source branch's cost into the destination branch's average, and cancelling restores it exactly.
- `Product.CostPrice` is kept as the company average (total value ÷ quantity) for company-level screens.
- **Read side:** a new `StockValuation` service values stock now or at any past moment from
  per-warehouse balances and per-pool averages (Postgres `DISTINCT ON` replay). The following
  all use it and tie to each other:
  - the inventory list, per warehouse and in total
  - the item card
  - valuation
  - warehouse totals
- The invoice screen shows the cost of the chosen warehouse's branch. Example: Cola costs
  96.00 in Downtown and 104.23 in October.
- **Migration `BranchCost`:** every branch holding an item starts at today's company average;
  goods in transit get their permit cost.
- **Rate limiting fix:**
  - Signed-in requests are now limited per user (600/min), not per internet address. Before, a
    whole office sharing one address could throttle itself.
  - Anonymous requests (login) stay at 120/min per address.
  - Both limits are configurable (`RateLimit:UserPerMinute` / `IpPerMinute`).
- **Verified:**
  - An old-version database upgraded through every migration passed: warehouses 58/58,
    transfers 42/42, per-branch cost 35/35.
  - A fresh database passed: returns 46/46, the concurrent-return race, transfers 42/42,
    cost 35/35.
  - A browser check of branch costs on the invoice screen.

**Transfers** (إذن تحويل) — DOMAIN.md §7 step 2
- A transfer permit moves goods between warehouses, including across branches:
  1. Sending takes them from the source into a system **"In transit"** warehouse (`Kind = TRANSIT`).
  2. Receiving moves them into the destination.
  3. Cancelling, while they're still in transit, moves them back to the source.
  - The product total and average cost never change on a transfer; only the location does.
  - In-transit goods show in valuation as their own row, and can't be sold from the source.
- **Status:** `SENT → RECEIVED | CANCELLED`.
  - The permit row is locked, so a receive and a cancel at the same moment can't both succeed.
  - Company setting `TransfersRequireReceipt` (default on, as in the old app): when off, a transfer
    arrives the moment it is sent.
- **Who can act:**
  - Sending needs `inventory:edit` on a source warehouse the user may use; the destination can be
    any open store in any branch.
  - Receiving needs `inventory:edit` on the destination; cancelling needs it on the source.
  - Branch-scoped users see the permits that touch their branch.
- **Endpoints:**
  - `GET /api/transfers?status&warehouseId&productId&from&to`, `GET /api/transfers/{id}`
  - `POST /api/transfers`, `POST /api/transfers/{id}/receive`, `POST /api/transfers/{id}/cancel`
  - `GET /api/warehouses/destinations`
  - Audited as `stock_transfer` create / receive / cancel.
- **Item card:** both legs of a transfer appear, linked to the permit (`documentType = STOCK_TRANSFER`).
- **Web:**
  - `/inventory/transfers`: "In transit" and "All" tabs, a detail panel, confirm receipt, cancel.
  - `/inventory/transfers/new`: send goods, capped at what the source holds.
  - A "Transfers" button on Inventory, and the receipt switch in Settings → Stock.
- **Fix: document numbers.** Numbers are now taken under a Postgres advisory lock per prefix.
  Before this, two invoices of one type saved at the same moment could read the same last number,
  and one failed on the unique index.
- **Migration `StockTransfers`:** the transfer tables, `Warehouse.Kind`, the settings flag
  (default on), and the transit warehouse for existing databases.
- **Verified locally:**
  - An old-version database was upgraded through all three new migrations: 58/58 warehouse checks
    and 42/42 transfer checks passed.
  - Covered: permissions, validation, receive and cancel, the race between them, receipt switched
    off, no selling of goods in transit, parallel numbering, and the invariants.
  - Screens were checked in AR and at phone width.

**Warehouses** (المخازن) — DOMAIN.md §7 step 1
- **Warehouse** belongs to a branch; each branch has exactly one default warehouse.
  - Stock is now held per warehouse in `StockBalance`.
  - `Product.StockOnHand` is the total across warehouses.
  - The weighted average stays company-wide per item (DOMAIN.md §2.4).
  - Every movement records its warehouse and the running balance there
    (`StockMovement.WarehouseId` / `WarehouseBalanceAfter`).
  - Invariant, checked by the tests: `StockOnHand = Σ balances = Σ movements`, and per warehouse
    balance = Σ its movements.
- **Which warehouse a line uses:**
  - Each invoice line picks a warehouse: the line's own, else the invoice's, else the user's
    branch default.
  - Branch-scoped roles can only use their own branch's warehouses. OWNER/ADMIN/ACCOUNTANT can use any.
  - Returns go back through the original line's warehouse. A sales return into a warehouse that
    has since closed lands in the branch default instead.
- **Stock locking (fixes an oversell race):**
  - Sales, purchases, returns and stocktakes now lock the items first (`InventoryService.LockProductsAsync`, `FOR UPDATE` in id order).
  - The stock check then counts every line of the same item together, per warehouse.
  - Before this, two sales at the same moment, or two lines of one item, could sell more than
    was on hand.
- **Line order:** invoice lines now keep their entry order (`DocumentLine.LineNo`). They came
  back in random order before.
- **Inventory screens:**
  - The items list, item card and valuation each take an optional warehouse (`?warehouseId=`).
  - The item card shows stock per warehouse.
  - Valuation shows a "by warehouse" table.
  - Stocktake and the item-card adjust box count one warehouse.
- **Branches & warehouses page** (`/branches`): list, add, rename, make default, close, reopen.
  - A warehouse can't be closed while it holds stock, and the default can't be closed.
  - Endpoints: `GET /api/warehouses`, `GET /api/branches`, `POST`/`PUT /api/warehouses`.
  - Managing warehouses needs the new permission `branches:manage` (OWNER/ADMIN).
- **Migration `Warehouses`** on an existing database:
  - Creates "<branch> store" as each branch's default warehouse.
  - Puts all current stock, and all past movements and invoice lines, in the **oldest branch's** warehouse.
  - Migration `DocumentLineOrder` numbers existing lines.
  - The seed now splits stock between "Downtown store" and "October warehouse".
- **Verified locally:**
  - A database seeded by the previous version was upgraded and gave 58/58 warehouse checks,
    including 5 parallel sales where exactly 2 succeed and nothing is oversold.
  - A fresh database passed 46/46 returns checks and the concurrent-return test.
  - Screens were checked in EN/AR and at phone width.

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
- Windows WPF client is **paused** (CLAUDE.md rule 7). Its models stop at the warehouse
  DTOs and don't include transfers.
- The invoice screen reads per-warehouse stock from the inventory list (first 500 items). A
  catalogue larger than that needs a per-item stock lookup.
- "Today" in valuation and the item card is the UTC day, not the Cairo day.
- `Program.cs` has one deprecation warning (`ForwardedHeaders.KnownNetworks`) — harmless.

## 7. What's NEXT (pick up here)
Detailed slice order is in `DOMAIN.md` §7 (warehouses ✅ → transfers → units & prices → …).
From `ROADMAP.md`, in suggested order (Phase 1 complete; Phase 2 item card, valuation, stocktake
and warehouses shipped):
1. **Verify returns on the live DB** after deploy (sell → partial return → full return; buy →
   return to supplier) and check stock, avg cost, party balance and the profitability report.
2. **Verify inventory on the live DB** after deploy: item card for a seeded item starts with an
   opening balance and closes at its stock; valuation today = inventory total; post a small
   stocktake and see it on the item card.
3. **Verify warehouses and transfers on the live DB** after deploy:
   - `/branches` shows one store per branch holding all stock.
   - Send a few items to the other branch.
   - Confirm receipt as that branch's user.
   - Check the item card and the valuation.
4. **Units, price levels & size/color** (DOMAIN.md §7 step 3). Then step 4:
   - invoice charges and reps
   - delivery, shipments / waybills and cash on delivery
   - the payment methods the owner listed (DOMAIN.md §2.5–2.6)
5. **Phase 3 — Accounts / general ledger:** chart of accounts, journal entries, account statements.
6. **Phase 4 — Notes** (أوراق قبض/دفع) & due payments.
7. **Phase 5 — Financial statements:** trial balance, income statement, balance sheet (from the ledger).
8. **Phase 6 — Analytics:** movement, dead stock, net monthly sales, top clients (charts).
9. **Phase 7 — Admin & close:** users UI, backups, period close, PDF/Excel export, owner presence view.
10. **Phase 8 — Android** native client.

**Decisions (2026-09-28):**
- **Average cost is per branch** (owner, 2026-09-29), with the transit warehouse as its own cost pool (DOMAIN.md §2.4).
- One web/PWA client for every device; the WPF client is paused (CLAUDE.md rule 7).
- Delivery covers pickup, own delivery, prepaid shipping, and cash on delivery with a waybill.
  Payment methods: cash, bank transfer, InstaPay, Vodafone/Orange Cash, Egypt Post, cheques and
  promissory notes (DOMAIN.md §2.5–2.6).
- Multi-currency: EGP now, maybe later. Documents will store currency + rate from day one.

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
