# SKB — Progress & Handoff

A running record of what is built, the decisions behind it, and what's next — so any new
session (or teammate) can pick up without losing context. Pair this with **`ROADMAP.md`**
(the full feature catalog of the old ERP), **`DOMAIN.md`** (how SKB models it: entities, rules,
postings, build order) and **`CLAUDE.md`** (the non-negotiable rules).

_Last updated: 2026-09-29._

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

**Admin & close** (الإدارة والإقفال) — ROADMAP Phase 7
- **Company profile** (بيانات المنشأة) in Settings: address, phone, email, tax number and
  commercial register.
  - `PUT /api/settings` takes them (a field left out is unchanged, `""` clears it; the email is
    checked and kept in lower case). Migration `CompanyProfile`.
  - They're printed at the top of invoices, returns, statements and reports.
- **Print / save as PDF** on invoices and returns, account and party statements, the trial
  balance, income statement, balance sheet, monthly sales and aging.
  - `lib/print.ts` copies one part of the screen into `#print-root`. Only that prints, always in
    the light theme, under the company letterhead with "printed by … on …".
  - The browser's print dialog also saves a PDF, named after the document or report.
- **Excel export** (a real `.xlsx`, not CSV) on the same reports and the activity log.
  - `lib/xlsx.ts` writes it with no library: right-to-left in Arabic, money with thousands
    separators, and a bold header and totals row.
  - Every cell is text or a number, never a formula.
  - Checked by opening the file in Microsoft Excel.
- **Android app 1.1.0** (versionCode 2): the WebView can't print or save a file made in the page,
  so the app's bridge now does both. `SKBApp.print` uses Android printing; `SKBApp.saveFile`
  opens a "save as" (no storage permission). Same signing key; the new APK is in
  `apps/web/public/downloads/`. Windows (WebView2) and iPhone use the browser's own print/save.
- **Aging of debts** (أعمار الديون, `GET /api/analytics/aging?side=customers|suppliers`, Analytics
  → "Aging of debts"):
  - Shows what each customer owes (or what we owe each supplier) on open invoices, by invoice
    age: up to 30 days, 31–60, 61–90, over 90.
  - A payment not linked to an invoice settles the oldest open invoices first, so the aged total
    never exceeds the balance.
  - Money owed without an open invoice (e.g. an opening balance) shows as "not on an invoice".
  - A customer in credit isn't listed.
  - Tapping a name opens their statement.
  - Branch-scoped staff see their branch's invoices as they stand.
- **Year-end close** (إقفال السنة, `POST /api/ledger/close-year`, `GET /api/ledger/closed-years`,
  `ledger:lock`; Accounts → Trial balance):
  - Posts one closing entry (`CLOSE-<year>`, dated 31 December). It brings every revenue and
    expense account to zero and moves the profit or loss into retained earnings.
  - It sweeps everything not yet closed up to that day, so years close in order: none before a
    closed one.
  - The period is then locked through 31 December and the lock can't move back into a closed year.
  - The closing entry can't be reversed, and the income statement leaves it out.
  - Two people closing at once: one closes, the other is told it's already closed.
- **Activity log** (سجل النشاط, `/audit`, `GET /api/audit`, `GET /api/audit/facets`; `audit:view`,
  the owner's): every audited change — who, what, which record, branch, IP and time.
  - Filters by person, record type, action and days; newest first, 50 a page.
  - Action and record names show in the screen language.
- **Verified:** `scripts/checks/admin.test.mjs` 100+ checks, covering:
  - the company profile (trim, lower-case email, clearing, permissions);
  - the activity log (filters, paging, only the owner);
  - aging: every bucket, using backdated invoices when `PGURL` is set; unlinked payments;
    customers in credit;
  - the year-end close: the entry, the statements before and after, the lock, the race, and the
    rules.

  All other suites still pass on a fresh database and on an upgraded older one, with the
  invariants. In the browser (EN/AR, phone width): the settings, an invoice printout, the
  reports' print and Excel, aging and the activity log.

**Financial statements and analytics** (التقارير الختامية والتحليلات) — DOMAIN.md §7 step 8
- **Income statement** (قائمة الدخل, `GET /api/ledger/income-statement?from&to`): revenue (sales
  less sales returns, other income, stocktake gains) − cost of goods sold = gross profit;
  − expenses (by category, shipping, purchase expenses, stocktake losses, rounding) = net profit.
- **Balance sheet** (الميزانية العمومية, `GET /api/ledger/balance-sheet?asOf`): assets, liabilities
  and equity by group; the profit to date (not yet closed into retained earnings) shows as its own
  equity line, so assets = liabilities + equity always. Both come straight from the ledger.
- **Analytics** (`/api/analytics`, `analytics:view`; branch-scoped people see their branch):
  - **Monthly sales**: sales, returns, net sales, net purchases and invoice count per month
    (3–24 months), with a chart.
  - **Top customers / suppliers** in a period by net business, with their share.
  - **Item movement**: the top-moving items (net units sold, units bought, net sales value) and
    **dead stock** (الأصناف الراكدة): items in stock that didn't sell in the period, their value
    at cost and when they last sold.
- **Web:** the Accounts page gains "Income statement" and "Balance sheet" tabs; Analytics
  (`/analytics`) becomes tabs: Profitability, Monthly sales, Top customers & suppliers, Item
  movement.
- **Verified:** `scripts/checks/statements.test.mjs` 54/54 — the statements hold together (gross,
  net, assets = liabilities + equity, profit to date = income since go-live), a new sale /
  purchase / expense moves them by exactly their amounts, the analytics numbers (net of a return),
  dead stock, and permissions. All other suites still pass. In the browser (AR): both statements
  and the analytics tabs.

**Cheques & promissory notes** (الأوراق المالية) — DOMAIN.md §7 step 7
- **Notes receivable** (أوراق قبض, `NR-`): a cheque or promissory note taken from a customer
  (number, bank, amount, due date, drawer, guarantor). Receiving it lowers what the customer owes
  and may settle their invoices (up to what is owed; not an invoice in a COD parcel on its way).
  - **Deposit** at a bank as a **portfolio** (حافظة, `PF-`): under collection.
  - **Collect**: the money lands in a money account (by default the deposit bank), or cash a note
    in hand straight into any account.
  - **Bounce** (مرتدة) or **cancel** (given back): the customer owes it again and the invoices it
    settled are open again. **Endorse** (تظهير) to a supplier: it pays what we owe them.
- **Notes payable** (أوراق دفع, `NP-`): our cheque / note to a supplier; issuing it lowers what we
  owe (and may settle purchase invoices). **Pay** from a money account (which must hold it),
  **bounce** or **withdraw** (we owe again).
- Every step is kept in the note's history (`NoteEvent`) and posts its journal entry: notes
  receivable (1107), notes under collection (1108), notes payable (2103). These accounts take no
  manual entries.
- **Due view:** open notes sorted by due date, overdue flagged; a summary of open, overdue and
  due-in-7-days amounts for each side.
- **Permissions:** `notes:view`, `notes:receive`, `notes:issue`, `notes:deposit`, `notes:collect`,
  `notes:pay`, `notes:bounce`, `notes:endorse`, `notes:cancel` (all for Accountant). Branch-scoped
  people see their branch's notes.
- **Web:** "Cheques & notes" (`/notes`, الأوراق المالية): receivable / payable lists with status
  filters, tick in-hand notes to deposit them, a note's sheet with its history and next steps,
  receive / issue forms with "settle oldest first", portfolios.
- **Fix (locks):** every money path now locks in one order — invoices, then the party, then money
  accounts — and a parcel's step locks its invoices too, so two actions at the same moment can't
  deadlock or overwrite an invoice's status.
- **Migration `NotesPortfolios`:** `Notes`, `NoteAllocations`, `NoteEvents`, `Portfolios`; the
  three notes accounts are added to the chart at startup.
- **Verified:** `scripts/checks/notes.test.mjs` 94/94 on a fresh and on an upgraded database
  (every step's balances, money and entry, a double-click race on collect, scoping); all other
  suites still pass; invariants now also check that each notes account equals its open notes.
  In the browser: receive with "settle oldest first", deposit by ticking, collect.

**The general ledger** (الحسابات العامة) — DOMAIN.md §7 step 6
- **Chart of accounts** (`LedgerAccount`, made by code at startup, names in Arabic like the other
  starter lists): assets (cash, banks & wallets, customers, shipping companies, stock, VAT on
  purchases, fixed assets), liabilities (suppliers, VAT on sales), equity (capital, opening
  balances, retained earnings), revenue (sales, sales returns, other income, stocktake gains) and
  expenses (cost of sales, operating expenses, shipping, purchase expenses, stocktake losses,
  rounding). Groups hold accounts; only non-group accounts take entries.
  - Each customer, supplier, carrier, money account and expense category gets its own
    sub-account (e.g. `1103-0007`) the first time it posts; it shows that record's current name.
- **Go-live:** the first time the ledger runs on a company that already has data, it posts one
  opening entry from what the books hold — each party's balance, each money account, and the
  stock at average cost — against "opening balances". History before go-live stays in the
  documents (the profitability report still covers it).
- **Automatic entries (DOMAIN.md §3),** in the same transaction as the document: sales and
  purchase invoices (with paid-now), sales and purchase returns (with refunds), receipts,
  payments, expenses, transfers, cancelled vouchers (the exact reverse), stocktake gains and
  losses, cash-on-delivery parcels (customer → carrier), carrier settlements (cash + shipping
  fees), and money-account opening balances. All sales taxes post to "VAT on sales", all purchase
  taxes to "VAT on purchases"; additions on a sale are other income, on a purchase a purchase
  expense.
- **Manual (compound) entries** (قيد مركب, `JV-`): any number of lines, debits = credits, dated
  up to today. Not on money accounts or stock (vouchers and stocktakes move those); a line on a
  customer's / supplier's account moves their balance with it. A manual entry can be reversed
  once; a document's entry reverses by cancelling the document.
- **Reports:** account statement (a group covers everything under it), customer / supplier
  statement (كشف حساب), trial balance (ميزان المراجعة: opening, period, closing), the journal.
- **Period lock** (إقفال الفترة): nothing manual can be dated, and no voucher created, on or
  before the lock date can be changed.
- **Permissions:** `ledger:view`, `ledger:post`, `ledger:manage` (Accountant has these three),
  `ledger:lock` (owner / admin). The ledger is company-wide.
- **Web:** "Accounts" (`/ledger`, الحسابات العامة): chart with balances and statements, add /
  rename / close accounts, journal with new entry and reverse, trial balance with the period
  lock; a Statement button on each party. Automatic entries are named by their source in the
  screen language.
- **Migration `Ledger`:** `LedgerAccounts`, `JournalEntries`, `JournalLines`,
  `CompanySettings.LockDate`.
- **Verified:**
  - `scripts/checks/ledger.test.mjs`: 96/96 on a fresh and on an upgraded database (every
    document's entry line by line, statements, manual entries, reversal, lock, permissions).
  - Money (162), delivery (160), catalog (210), charges (70) and staff (57) still pass, and then
    49 database invariants hold, among them: every entry balances, **each party's balance = its
    ledger accounts, each money account = its ledger account**, stock ledger = stock at average
    cost (within 1 piastre a unit), every document and voucher since go-live has its entry.
  - In the browser (AR, phone): chart of accounts, trial balance, journal.

**Cash boxes, banks, receipts, payments and expenses** (الخزينة والبنوك) — DOMAIN.md §7 step 5
- **Money accounts** (`MoneyAccount`): cash box, custody (a staff member's cash, e.g. a driver),
  bank account, mobile wallet, Egypt Post. Each belongs to a branch; one cash box per branch is the
  default. An account is added with what is in it (an **opening balance**); an account nothing
  has moved through yet (e.g. a migrated cash box) can be given its opening balance later.
  - Every amount in or out is a `MoneyMovement`, numbered per account (`Seq`) with the balance it
    left. **No account ever goes below zero** (`insufficient_funds`); rows are locked in id order.
  - The account statement for a period (`GET /api/money-accounts/{id}/movements?from&to`) is also
    the **daily cash report** (one day). Days are UTC for now.
- **Vouchers** (`Voucher`, numbered RCV- / PAY- / EXP- / CTR-):
  - **Receipt** from a party (سند قبض) and **payment** to one (سند صرف), paid in up to 10 ways at
    once (cash, bank transfer, InstaPay, mobile wallet, post; each method only into its kind of
    account), with the transfer number.
  - Each can **settle invoices** of that party (sales for receipts, purchases for payments), up
    to what is still owed after payments and returns; the rest stays on the party's account. An
    invoice in a cash-on-delivery parcel on its way can't take a receipt (the carrier collects it).
  - **Expense** by category (starter Arabic categories, with sub-categories), and **transfer**
    between accounts (deposit / withdraw at the bank, cash box to cash box).
  - **Cancel** any voucher: the money moves back (the account must still hold it), the party's
    balance and the invoices it settled are restored.
- **Money now moves with documents:** paid-now on a sales or purchase invoice, a return's refund
  and a carrier settlement's payment go through a money account (picked, else the branch's cash
  box). A purchase paid from a box that doesn't hold it is refused. New branches get a cash box.
- **Fix (race):** a party's balance is now locked before any change (invoices, returns, parcels,
  settlements, vouchers). Before, two invoices for one customer at the same moment could lose one
  amount from the balance.
- **Dashboard:** "Cash position" is now what the money accounts hold. Its "New invoice / New
  receipt" buttons now open those screens (they did nothing before).
- **Permissions:** `receipts:create`, `payments:create`, `expenses:create`, `cash:transfer`,
  `vouchers:cancel`, `money_accounts:manage`, `expense_categories:manage` (all for Accountant);
  seeing needs `receipts:view`. Branch-scoped people see and use only their branch's accounts,
  invoices and vouchers.
- **Web:** "Cash & Banks" (`/receipts`, الخزينة والبنوك): accounts by branch with balances,
  statements, add / edit / default / close; vouchers with detail and cancel; receipt / payment /
  expense forms with several payment lines and "settle oldest first"; transfers; expense
  categories. An account picker appears for paid-now, refunds and carrier settlements; parties have
  Receive / Pay buttons; the invoice preview shows where money was paid.
- **Migration `MoneyVouchers`:** the money tables, `SalesDocuments.PaidAccountId`,
  `CarrierSettlements.AccountId`; every existing branch gets an empty default cash box (the owner
  enters its opening balance); past paid amounts are not replayed. Starter expense categories.
- **Verified:**
  - `scripts/checks/money.test.mjs`: 162/162 on a fresh and on an upgraded database, including
    three payments racing for one cash box (one fits), two receipts racing for one invoice, and
    four sales to one customer at once (no amount lost).
  - Delivery (160), catalog (210), charges (70) and staff (57) still pass; 38 database invariants
    hold, including balance = Σ movements, movements chained by `Seq`, no negative balance,
    voucher money = its lines, and allocations within the voucher and the party.
  - In the browser (AR/EN, phone): a receipt with "settle oldest first", voucher detail,
    statement, paid-now account picker.

**Delivery, shipping companies and cash on delivery** (التوصيل وشركات الشحن) — DOMAIN.md §7 step 4b
- **Parties can be added and edited** (`POST`/`PUT /api/parties`): name (one field, unique among
  open accounts), types (customer, supplier, factory, **shipping company** = `CARRIER`), phone,
  email, tax number and **address**.
  - An account can be closed only at a zero balance (`has_balance`); a closed name can be reused.
  - `GET /api/parties?active=true` lists open accounts only (the invoice screens use it).
- **Delivery on the sale:** each sales invoice is picked up (`PICKUP`, the default), delivered by
  our driver (`OWN_DELIVERY`, optional driver = a staff member) or sent with a shipping company
  (`SHIPPING_COMPANY`, carrier required). The address defaults to the customer's.
  - Delivered sales start `PENDING`; our own go `OUT_FOR_DELIVERY` → `DELIVERED`, or `RETURNED`
    (`PUT /api/sales/invoices/{id}/delivery`).
- **Parcels (shipments / waybills, بوليصة):** one customer's invoices from one branch, handed to a
  carrier (`POST /api/shipments`, number `SHP-YYYY-NNNNNN`, the carrier's waybill number optional).
  - **Cash on delivery** defaults to what is still owed on the invoices (after payments and
    returns); 0 = prepaid. It is shared over the invoices, oldest first.
  - Steps: `CREATED` → `PICKED_UP` → `DELIVERED` → `SETTLED`, or `RETURNED` (refused) /
    `CANCELLED` (before pickup). An invoice is on one live parcel at most (rows are locked).
  - **Delivered with COD:** the customer's debt moves to the carrier, and each invoice counts its
    share as paid (`PAID` / `PARTIALLY_PAID`).
  - **Refused:** nothing is collected; with "put the goods back" the server posts full sales
    returns of what is left on each invoice (needs `sales:return`).
- **Carrier settlement** (`POST /api/carrier-settlements`, `CST-YYYY-NNNNNN`): the carrier pays for
  many delivered COD parcels at once, keeping its fees. Its balance drops by fees + paid; any
  difference stays on its account. Where the cash lands (a cash box) and the fees' expense
  account come with steps 5 and 6.
- **Permissions:** `parties:create`, `delivery:view`, `delivery:manage`, `delivery:settle`.
  Accountant has all four; Sales has `parties:create`, view and manage; Inventory has view and
  manage; Viewer has view. Branch-scoped roles see and move only their branch's.
- **Web:**
  - **Customers & Suppliers:** search, type filter, closed accounts, add / edit sheet (phone
    bottom sheet), close / reopen.
  - **Sales invoice:** a delivery card (pickup / our delivery / shipping company, address, driver
    or carrier). The preview shows it.
  - **Deliveries** (`/deliveries`, new nav item): our deliveries with their steps, parcels (new
    parcel from a carrier's waiting invoices, COD, pickup / delivered / refused / cancel) and
    settlements (fees, paid, difference).
  - Server error codes on these screens show in the screen language (`lib/errors.ts`, `error.*`).
- **Migration `DeliveryShipments`:** the sale's delivery fields (old sales become `PICKUP`),
  `Parties.Address`, `Shipments`, `ShipmentInvoices`, `CarrierSettlements`. The seed adds a
  shipping company ("Swift Courier") and a customer address.
- **Verified:**
  - `scripts/checks/delivery.test.mjs`: 160/160 on a fresh and on an upgraded database,
    including a double-click race on "delivered" and two people shipping one invoice at once.
  - The catalog (210), charges (70) and staff (57) suites still pass.
  - 28 database invariants hold, including COD = Σ invoice shares, one live parcel per invoice,
    settlement difference = COD − fees − paid, and carrier balance = COD delivered − settled.
  - In the browser (AR/EN, phone): added a party with an Arabic name, made a parcel, refused it
    (return posted), settled two parcels with fees and a shortfall.

**Invoice charges, bonus goods and sales reps** — DOMAIN.md §7 step 4a
- **Charges** (`DocumentCharge`): each invoice has a list of discounts, taxes and additions. Each
  one is a percent (2 decimals) or a fixed amount. They apply in this order:
  1. خصم (discount), then خصم إضافي (extra discount), each on what is left;
  2. VAT and other taxes, on the discounted amount;
  3. additions (e.g. delivery, freight), also on the discounted amount.
- **Profit:** the invoice discount is shared over the lines in proportion to their nets
  (`DocumentLine.DocDiscount`; the shares add up exactly). Profit = net after every discount −
  cost. Taxes and additions are never revenue or cost.
- **Purchases:** the supplier's discount comes off the goods' cost, so it lowers the weighted
  average. Freight entered as an addition is owed to the supplier but kept out of the cost.
- **Bonus goods (بونص):** a line with price (or cost) 0 and `IsBonus`.
  - On a sale its cost still counts against profit, and it skips the price floor.
  - On a purchase, free goods lower the average cost.
- **Sales rep (مندوب):** the invoice records who the sale is credited to (`RepId`; no commission).
  Returns keep the invoice's rep. Profitability has a **by rep** view. `GET /api/sales/reps`
  lists who can be picked.
- **Returns:** discounts and tax come back in proportion, and the last return takes exactly what
  is left. Additions such as delivery are **not** refunded.
- **Permissions:** `sales:discount`, `sales:bonus`, `sales:change_tax`, `sales:additions` and the
  same four for purchases.
  - Without `change_tax`, only the company's VAT rate is accepted.
  - Accountant has all eight. Inventory has the four purchase ones. Sales staff have none.
- **Old clients:** a request without `charges` still works; its `taxPercent` becomes the tax charge.
- **Web:**
  - The invoice screen has the discount and extra discount (percent or amount), VAT and other
    tax, additions with a label, a bonus tick per line, and the rep picker. The totals are worked
    out with the same maths as the server (`@skb/shared` `applyCharges`).
  - The invoice preview lists each charge, bonus lines and the rep.
- **Migration `ChargesBonusReps`:** `DocumentCharges`, `AdditionTotal`, `RepId`, `IsBonus`,
  `DocDiscount`. Old invoices keep their totals and have no charge rows.
- **Verified:**
  - `scripts/checks/charges.test.mjs`: 70/70 on a fresh and on an upgraded database.
  - The catalog (209) and staff (57) suites still pass.
  - 21 database invariants hold, including grand = subtotal − discounts + taxes + additions,
    discount shares = discount charges, and bonus lines are free.
  - In the browser: a sale with a 10% discount, a delivery fee, a bonus line and a rep was posted
    by the server exactly as the screen showed it.

**Staff & permissions** (الموظفون والصلاحيات) — owner decision 2026-09-29: every action has its
own permission, and roles bundle them
- **People** (`/staff`): add a person (name, email, role, branch, phone, password), edit them,
  set a new password (it signs them out elsewhere), deactivate or reactivate (ends their sessions).
- **Per person:** tick or untick single permissions against their role. The extra ones are
  `GrantedPermissions`, the removed ones `RevokedPermissions` on `Staff`; the screen marks them
  "added" / "removed".
- **Roles:** change what a whole role may do (`RolePermissionSet`), or put it back to the default.
  The OWNER role always has every permission and can't be edited.
- **Where permissions come from:** `PermissionService`. A person gets their role's permissions,
  plus the granted ones, minus the revoked ones. They go into the access token at sign-in and at
  every refresh, so a change reaches the person within 15 minutes. `/api/auth/me` now reads them
  from the token.
- **Safety rules (server-side):**
  - Nobody can give or take a permission they don't hold themselves.
  - Only an owner can make or edit an owner.
  - At least one active owner always remains.
  - Nobody can deactivate themselves, change their own role, or change their own role's or their own permissions.
- **New permissions:** `staff:manage` (people) and `roles:manage` (roles and per-person
  permissions), for Owner and Admin.
- **Endpoints:**
  - `GET /api/staff`, `POST /api/staff`, `PUT /api/staff/{id}`, `PUT /api/staff/{id}/permissions`
  - `GET /api/roles`, `PUT /api/roles/{role}`, `POST /api/roles/{role}/reset`, `GET /api/permissions`
  - All audited.
- **Web:** every permission has an Arabic and English label, grouped by screen.
- **Migration `StaffPermissions`:** empty grant and revoke lists for everyone; no role changes.
- **Verified:**
  - `scripts/checks/staff.test.mjs`: 57/57 on a fresh database and 57/57 on an upgraded one. It
    covers validation, grants and revokes reaching the token, role edit and reset, admins
    blocked from escalating or touching owners, self-lockout, password reset, and deactivation.
  - The catalog suite still passes 209/209 on both.
  - In the browser, in Arabic and at phone width: the permission list, and ticking a permission
    for Karim reaches his next sign-in.

**Units, price levels and size/color** (الوحدات، مستويات الأسعار، المقاس واللون) — DOMAIN.md §7 step 3
- **Units:** every item has a **base unit** (factor 1, the smallest unit sold; stock and every
  movement count in it) and larger units that hold a number of base units (carton = 24).
  - Each unit can have its **own barcode** (unique company-wide) and its own prices.
  - Units are a company list, named in Arabic and English (`Unit`, `ItemUnit`).
  - The base unit can't change once stock has moved. A larger unit's size can change: old
    invoice lines keep the size they were posted with.
- **Price levels:** the app starts with two, as the owner asked: **سعر العملاء** (customer
  price, default for sales) and **سعر الموردين** (supplier price, default for purchases). More
  can be added (e.g. wholesale) in Catalog setup.
  - A customer or supplier can have **their own level**; an invoice starts at it.
  - **Where a price comes from** (`PriceBook`, shown in grey in the editors):
    1. the item's own price for that unit and level;
    2. for a size/color, its model's price;
    3. the base unit's price × the unit's count;
    4. the same at the default level.
  - An item with no price at all sells at cost × (1 + default markup), and buys at the average cost.
  - `Product.SalePrice` is kept as the base unit's customer price, for list screens.
- **Size × color models:** a model (e.g. "Basic T-shirt") is made in sizes × colors.
  - Each size/color is a normal item with its own SKU (`TSH-BLACK-M`), barcode and stock. So
    stock, per-branch cost, transfers, stocktake and returns all work unchanged.
  - Its name is composed ("Basic T-shirt — Black / M") and follows the model
    and color names (as typed; AI translation was removed later).
  - It uses the model's units and prices until it gets prices of its own.
  - Adding sizes or colors later adds the missing items. A model keeps the dimensions it was made with.
- **Invoices in units:** each sales / purchase line picks one of the item's units.
  - Stock moves in base units.
  - A carton bought at 100.00 adds exactly 100.00 to the average cost (`ReceiveValue`).
  - Scanning a carton's barcode and pressing Enter adds a carton line.
  - The minimum-profit check now includes the line discount.
- **Returns in units:** a whole carton comes back as a carton; part of one comes back in pieces.
  Amount, discount and cost are shared in proportion, and the return that empties a line takes
  exactly what is left.
- **Permissions (owner decision 2026-09-29: every action has its own permission):**
  - Catalog: `products:create`, `products:edit`, `prices:edit`, `price_levels:manage`,
    `categories:manage`, `units:manage`, `variant_options:manage`.
  - Invoices: `sales:change_price`, `sales:choose_price_level`, `purchases:change_price`,
    `purchases:choose_price_level`.
  - Customers and suppliers: `parties:set_price_level`.
  - **Sales staff now sell at the level price only**: another price, a discount or another level
    is refused (403) unless the role has the permission.
  - Accountant: all of these except price levels. Inventory: items, units, sizes/colors and
    purchase prices, but not selling prices.
- **Reports:** profitability and stock valuation can group **by model**. The inventory list takes
  `?modelId=` and shows stock as "2 Carton + 5 Piece".
- **Web:**
  - Inventory has **New item**, **Models** and **Catalog setup** buttons.
  - `/inventory/products/new` and `/inventory/products/:id/edit` edit an item: names, units and
    barcodes, and a price grid.
  - `/inventory/models` and `/inventory/models/:id` list models and edit one, with its
    size × color grid.
  - `/inventory/setup` manages units, categories, sizes, colors and price levels.
  - Customers & Suppliers has each party's price level.
  - The invoice builder has a unit per line and a price-level picker; the price is read-only
    without permission.
  - The return builder takes quantities in the line's unit or in pieces.
- **Endpoints:**
  - `GET/POST/PUT /api/units`, `/api/categories`, `/api/price-levels`, `/api/variant-options`
  - `GET /api/products?search` (units, prices at each level, `matchedUnitId` for a scanned barcode)
  - `GET/POST/PUT /api/products/{id}` and `PUT /api/products/{id}/prices`
  - `GET/POST/PUT /api/models/{id}` and `PUT /api/models/{id}/prices`
  - `PUT /api/parties/{id}/price-levels`
  - Invoice lines take `unitId`; invoices take `priceLevelId`.
- **Migration `UnitsPricesVariants`** on an existing database:
  - Every unit name items used becomes a unit (known ones in both languages), plus piece,
    carton and dozen.
  - Each item's old unit becomes its base unit, and its barcode moves onto it.
  - The two price levels are added, and each item's sale price becomes its customer price.
  - Every past invoice line is marked as entered in the base unit.
  - The old `Product.Unit` and `Product.Barcode` columns are removed.
- **Verified locally:**
  - A database made by the previous version, with sales, purchases, returns, a transfer and a
    stocktake, was upgraded. Then `scripts/checks/catalog.test.mjs` passed 209/209, and 209/209
    again on a fresh database.
  - The checks cover permissions, validation, price inheritance, cartons and pieces, exact
    returns, variants, reports, and 5 parallel carton sales where exactly 2 succeed.
  - 15 database invariants hold on both (`scripts/checks/invariants.mjs`).
  - (Translation checks passed at the time; AI translation was removed later the same day.)
  - Requests from the old client (no unit fields) still work.
  - In the browser, in EN and AR and at phone width with no sideways scrolling:
    - create an item with a carton;
    - scan the carton into a purchase;
    - a sales user sells at the locked level price;
    - return 5 pieces of a carton;
    - set a customer's level and see the next invoice start at it;
    - the model's size × color grid.

**Real apps for Android and Windows; the website for iPhone** (owner request 2026-09-29)
- **Android** (`apps/android`, README there): a native Java app of about 20 KB.
  - It opens the company server full screen.
  - **Server address:** changeable from a long-press shortcut (cloud or office server; http warns).
  - Only server pages open inside; other links open in the browser.
  - An offline page offers Try again / Server address.
  - Downloads, uploads and the Back button work.
  - `allowBackup=false`.
  - Signed with a **local release key that is never committed** (`%USERPROFILE%\.skbndroid`,
    `apps/android/keystore.properties`). **Back both up.**
- **Windows** (`apps/windows/src/SKB.Desktop`, README there): WinForms + WebView2 on .NET
  Framework 4.8, both built into Windows, so it's about 300 KB zipped with nothing to install.
  - A native window with the SKB icon that opens the server.
  - "Server address…" is in the window menu.
  - The same offline page.
  - Installs itself per user (no admin): Start menu, desktop, and Settings › Apps uninstall.
    `--portable` skips it.
  - Tested on this PC:
    - loads the local server
    - shows the offline page for a dead address
    - runs from the unzipped download
- **Updates:** the apps show whatever the server serves, so **deploying the server updates every
  device**.
- **Downloads:** `apps/web/public/downloads/SKB-Android.apk` and `SKB-Windows.zip`, served by
  the API (`.apk` MIME type added). The "Get the app" links are on the login page and in
  Settings, hidden inside the apps. The service worker never swallows `/downloads/`.
- **iPhone:** "Add to Home Screen" with a proper PNG `apple-touch-icon`; the PWA manifest now has
  192/512/maskable PNG icons.
- **Health check:** `/api/health` now reports the deployed commit (`version`) so a deploy can be
  verified.
- **Not yet tested on a real phone or an emulator.** There is no emulator image on the build
  PC (about 1.5 GB to download).

**Names: one field, no translation** (owner decision 2026-09-29) — DOMAIN.md §2.1b
- The AI translation of names was **removed** at the owner's request. It had translated branch,
  warehouse, category and item names into the other language with an AI service.
- Every name is now one field (`INamed.Name`), typed in Arabic or English and shown exactly as
  typed on both screen languages. Only the app's own texts are bilingual.
- **Removed:** the translation worker, the `Translation__*` settings, `GET /api/settings/translation`
  and its Settings card. `Translation__ApiKey` on Render can be deleted.
- **Changed:** the second-language fields are gone from the forms and the API. Requests send
  `name`; answers no longer carry `names`.
- **Migration `SingleNames`:** keeps each record's name as typed and drops `NameAr`, `NameEn`,
  `NameSource`, `NameAuto` and `NamePending` from 8 tables. The starter units and price levels
  the system created switch to Arabic (قطعة، كرتونة، دستة، سعر العملاء، سعر الموردين). The seed
  uses the same Arabic starters.
- **Verified:**
  - catalog 210/210, staff 57/57 and charges 70/70 on a fresh database and on an upgraded one.
  - 20 invariants hold.
  - An upgraded database has no second-language columns left.
  - In the browser: one name field on branches, catalog setup and the item editor, and no
    translation card in Settings.

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
- Branch scope is still by role (Owner/Admin/Accountant see every branch). Scopes per person
  (allowed branches / warehouses / cash boxes, DOMAIN.md §2.1) come later.
- A permission change reaches a signed-in person at their next token refresh (up to 15 minutes).
- Transfers and stocktakes are entered in base units (the screens show cartons as a hint only).
- Price lists for chosen items and quantity breaks (DOMAIN.md §2.2) are not built yet.
- A model can't gain a new dimension (sizes on a color-only model); make a new model instead.
- The ledger starts at go-live: documents from before it are not replayed as entries.
- Stock at average cost can drift from the stock ledger by rounding (under a piastre a unit); a
  stock revaluation entry isn't built yet.
- A branch-scoped person given `ledger:view` sees the whole company's ledger.
- An endorsed note that later bounces at the supplier isn't handled yet (record it with a
  manual entry). Notes aren't in a currency other than the company's.
- Money days (statements, daily cash) are UTC days, not Cairo days.
- An account's opening balance can be set only before money first moves through it.
- Most older screens still show the server's English error message; the delivery and party
  screens use `lib/errors.ts` to show it in Arabic too.
- A closed year can't be reopened. Aging ages invoices by UTC day.
- Printing on iPhone depends on Safari's print sheet (not tested on a device here).

## 7. What's NEXT (pick up here)
Detailed slice order is in `DOMAIN.md` §7 (warehouses ✅ → transfers ✅ → units & prices ✅ → charges & delivery ✅ → money → …).
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
4. **Verify units, price levels and size/color on the live DB** after deploy:
   - Catalog setup lists the old units and the two price levels.
   - Add a carton to an item, buy and sell in cartons, and return part of one.
   - A sales user can't change a price.
5. **DOMAIN.md §7 step 4:**
   - ~~invoice charges, bonus lines and sales reps~~ done (4a; no commission)
   - ~~names: one field, no translation~~ done
   - ~~delivery, shipments / waybills and cash on delivery~~ done (4b)
   - **Verify on the live DB** after deploy: add a shipping company, sell with it, make a parcel,
     deliver it with COD, settle it with a fee.
   - ~~cash boxes, banks, receipts, payments, expenses~~ done (step 5)
   - **Verify on the live DB** after deploy: each branch has an empty cash box — enter the real
     opening balance (Edit → opening balance, allowed until money first moves through it), add the
     bank accounts and wallets, take a receipt against an invoice, pay a supplier, record an expense.
   - ~~the ledger (account tree, automatic postings, statements, opening balances)~~ done (step 6)
   - **Verify on the live DB** after deploy: the opening entry at go-live, a customer's statement,
     the trial balance balancing.
   - ~~cheques & promissory notes, portfolios~~ done (step 7)
   - ~~financial statements and analytics~~ done (step 8)
   - ~~Phase 7: year-end close, print/PDF, Excel export, aging, activity log~~ done (admin & close)
   - **Verify on the live DB** after deploy: fill in the company profile, print an invoice and a
     statement (and save one as PDF), export the trial balance to Excel, look at aging.
     **Update the Android app** on phones (1.1.0) so printing and Excel work there.
   - Close last year only when the owner is ready: it can't be undone.
   - Left: DOMAIN.md §7 step 9, payroll & attendance (§2.9) — only if the company uses it; ask
     the owner first. Then backups (needs Docker to test the image change).
6. **Phase 3 — Accounts / general ledger:** chart of accounts, journal entries, account statements.
7. **Phase 4 — Notes** (أوراق قبض/دفع) & due payments.
8. **Phase 5 — Financial statements:** trial balance, income statement, balance sheet (from the ledger).
9. **Phase 6 — Analytics:** movement, dead stock, net monthly sales, top clients (charts).
10. **Phase 7 — Admin & close:** ~~users UI~~ (done: Staff & permissions), ~~period close, PDF/Excel export, activity log~~ (done), backups, owner presence view.
11. ~~**Phase 8 — Android**~~ done: a real Android app ships (see above).

**Decisions (2026-09-29, owner):**
- Names are one field, kept as typed in Arabic or English; nothing is translated (AI translation removed).
- Every action has its own permission; roles bundle them (a permissions screen will let the owner assign them).
- Price levels start as the supplier price and the customer price; more can be added.
- Changing a level's price on an invoice, or picking another level, needs a permission.
- Sales reps earn **no commission**.

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
