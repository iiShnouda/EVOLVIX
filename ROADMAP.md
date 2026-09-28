# SKB — Feature Roadmap (rebuilding the old ERP, modernized)

This is the plan of record for turning SKB from today's vertical slice into a full
wholesale‑accounting system that replaces the old **spiderCompany / sp.der SM ERP
("الإخلاص 2022")** — but *modernized*, not copied. Every feature below was seen in
the old app's screenshots; for each one this file records the **correct accounting /
business logic** (verified against standard references, see §3) so we don't rebuild
something that is logically wrong.

> Living document. More screenshots are still coming; new modules get appended to §2
> as they arrive. Nothing here is built until it appears in §1.

---

## 0. How to read this

- Arabic labels are kept next to each feature so they match what you saw in the old app.
- **"Logic"** lines are the accounting rule the feature must obey. These are the parts
  that are easy to get wrong, so they are stated explicitly.
- Money is always **integer minor units** (piastres). Never floats. (CLAUDE.md rule #4.)
- Every feature obeys the non‑negotiables: server is the only source of truth, nothing
  business‑related cached on the client, every mutation audited, bilingual AR/EN + RTL.

---

## 1. Where we are today (already built and live)

Live at the company's cloud host; on‑prem path documented in `COMPANY-SERVER.md`.

- **Auth & security** — JWT access tokens, PBKDF2 password hashing, AES‑256‑GCM
  encrypted revocable refresh sessions, per‑permission authorization (deny by default),
  branch scoping, rate limiting, audit log, SignalR presence.
- **Entities** — Branch, Staff, Session, AuditEntry, Party, Category, Product,
  SalesDocument, DocumentLine.
- **Screens** — Login, Dashboard, Sales (invoice list + detail), Parties.
- **Clients** — Web/PWA (iPhone/Android/website), Windows WPF native, shared C# API.

Everything below in §2 is **not yet built** — it is the target.

---

## 2. The old ERP, module by module (catalog from screenshots)

### 2.1 Sales & Invoicing — المبيعات والفواتير
- Create sales invoice — فاتورة مبيعات: pick client, add lines (product, qty, price,
  discount), totals, save + print.
- Sales return — مرتجع مبيعات.
- Purchase invoice + purchase return — فاتورة مشتريات / مرتجع مشتريات.
- Price quote / order — عرض سعر / أمر توريد.
- **Profitability reports — تقارير الربحية**: profit per invoice / per item / per client
  / per period.
- **Logic (discount = margin reduction, the "300 + 8%" rule you chose):** we sell at
  *cost + markup*. A "2% sale" reduces the **markup**, not a flat cut off the retail
  price. Example: cost 300, normal markup 10% → normal price 330 (profit 30). A 2% sale
  ⇒ markup becomes 8% ⇒ price = 300 × 1.08 = **324**, profit = **24**. The system stores
  cost, markup %, discount‑as‑margin‑points, and shows remaining profit live so the
  seller never sells below a floor margin. (See §3.4.)
- **Logic (COGS):** each sale line records the *cost* of the goods leaving stock using
  the moving weighted‑average cost (§3.3) at the moment of sale, so profit = price − that
  cost, and it stays correct even when purchase prices change.

### 2.2 Inventory / Stores — المخزن / المخازن
- Multi‑store — تعدد المخازن, with per‑branch scoping.
- Items & categories — الأصناف / المجموعات, barcode — باركود, units, opening balances.
- Stock transfer between stores — إذن تحويل (transfer permit).
- Stock adjustment / stocktake — الجرد والتسويات.
- **Reports:**
  - Stock valuation — **تقييم المخزن**; and valuation for a period — **تقييم المخزن خلال فترة**.
  - Item card / ledger — **كارت الصنف** (every in/out movement of one item, running balance).
  - Total movement of an item — **إجمالي حركة صنف**.
  - Daily movement by item — **كشف حركة يوم على مستوى الصنف**.
  - Items that reached reorder level — **الأصناف التي وصلت لحد الطلب**.
  - Transfer reports — detailed one transfer (**تفصيلي إذن تحويل معينة**), transfers in a
    period (**التحويلات خلال فترة**), one item's transfers in a period (**تحويلات صنف معين خلال فترة**).
- **Logic (valuation):** default **moving weighted‑average cost** — the right method for
  wholesale where units are interchangeable and purchase prices change (§3.3). Each
  receipt recomputes the item's average cost; each issue leaves stock at that average.
  Method is a company setting so we can offer FIFO later without a rewrite.
- **Logic (reorder):** each item has a reorder level (حد الطلب); the report lists items
  whose on‑hand ≤ reorder level, per store.

### 2.3 Accounts / General Ledger — إدارة الحسابات
- **Chart of accounts — دليل الحسابات**: tree of accounts (assets, liabilities, equity,
  revenue, expense), with sub‑accounts for each client, supplier, cash box, bank, etc.
- **Cash withdraw / deposit — سحب / إيداع نقدي**: money in/out of a cash box or bank.
- **Compound journal entry — قيد مركب**: one entry with several debit and credit lines.
- **Due payments — دفعات مستحقة**: scheduled amounts owed/receivable and their aging.
- **Notes / financial paper — الأوراق المالية:**
  - Notes receivable — **أوراق قبض** (cheques/promissory notes we hold and will collect).
  - Notes payable — **أوراق دفع** (cheques/notes we issued and must pay).
  - Handling notes — **التعامل مع الأوراق المالية**: collect, endorse, deposit, return/bounce.
  - Note portfolios — **حوافظ الأوراق**: group notes into portfolios (e.g. at a bank).
- **Reports:**
  - Account statement — **كشف حساب** (all debits/credits of one account + running balance).
  - Account balances for a period — **أرصدة الحسابات خلال فترة**.
  - Notes‑portfolio reports by period / by client, detailed portfolio, notes by period/client
    — **تقارير الأوراق المالية / الحوافظ**.
- **Logic:** strict **double‑entry** — every entry's debits equal its credits, nothing
  posts otherwise (§3.1). Every source document (invoice, payment, transfer) generates its
  journal entry automatically; manual entries go through قيد مركب. Notes receivable are an
  **asset**, notes payable a **liability**, with their own lifecycle states (§3.5).

### 2.4 Parties — العملاء والموردين
- Clients — العملاء, suppliers — الموردين (partly built already), with each party linked to
  a sub‑account in the chart of accounts so their balance is always the ledger balance.
- Party statement = the account statement (§2.3) filtered to that party.

### 2.5 Cross‑cutting (seen throughout the old app)
- Bilingual AR/EN, RTL — already a core rule.
- Print/export every document and report (PDF), and export tables to Excel/CSV.
- Per‑user permissions on every screen (already enforced server‑side).
- Fiscal periods & period close — إقفال الفترة (lock a period so posted history can't change).

---

## 3. Correct business & accounting logic (researched)

### 3.1 Double‑entry is the foundation
Every financial event is a **journal entry** with lines whose **debits = credits**. The
system refuses to post an unbalanced entry. Account statements and balances are *derived*
from these lines, never stored as editable numbers. This is what makes the books provable.

### 3.2 Money is exact
Stored as integer **minor units** (piastres). All arithmetic is integer; formatting to
"1,234.50 EGP" happens only at display. (CLAUDE.md rule #4.)

### 3.3 Inventory valuation — moving weighted average (default)
For wholesale/distribution where units are interchangeable and purchase costs move, the
**weighted‑average cost** method is the standard, low‑friction choice: on each purchase,
`new_avg = (old_qty·old_avg + recv_qty·recv_cost) / (old_qty + recv_qty)`; each sale takes
goods out at the current average and that amount becomes COGS. It smooths cost swings and
doesn't require tracking individual lots. (FIFO stays a future option behind a setting.)

### 3.4 Pricing — markup vs margin, and the "300 + 8%" discount
- **Markup** = profit as a % of **cost**; **margin** = profit as a % of **selling price**.
  They are not the same number, so we store both intent and result and label them clearly.
- Your chosen discount model reduces the **markup** (the "300 + 8%" method): the discount
  is expressed in *margin points off the normal markup*, so the receipt price = cost ×
  (1 + reduced‑markup). This keeps the discount tied to real profit, shows the salesperson
  exactly what profit remains, and lets us block sales below a configured floor margin.

### 3.5 Notes receivable / payable — أوراق قبض / دفع
- A note (cheque/promissory note) is a written promise to pay a set amount on a date.
- **Notes receivable = asset** (customers' cheques we will collect); **notes payable =
  liability** (cheques we issued). Lifecycle: *held → deposited/endorsed → collected/paid*
  or *returned/bounced*, each transition posting the correct journal entry. Portfolios
  (حوافظ) group notes (e.g. lodged at a bank) for reporting.

### 3.6 Audit & period close
Every mutation is written through the audit layer (who, what, when, before/after). Closing
a fiscal period locks its entries so history is immutable — required for trustworthy books.

---

## 4. Modernization principles (not a literal copy)

1. **One data model, every device** — the same C# API serves web/PWA, Windows, and (later)
   Android; no per‑device logic forks.
2. **Documents post to the ledger automatically** — the old app often needed manual entries;
   here an invoice/payment/transfer creates its balanced journal entry itself.
3. **Live profitability** — profit and remaining margin shown as the invoice is typed, not
   only in an after‑the‑fact report.
4. **Search‑first, keyboard‑fast** — barcode + fuzzy item/party search everywhere.
5. **Server‑authoritative security** — nothing readable offline; owner presence/audit view.
6. **Reports are queries, not stored numbers** — always recomputed from the ledger and stock
   movements, so they can't drift.

---

## 5. Proposed build sequence (phased)

Each phase = new EF entities + migration → controllers/DTOs behind permission policies with
audit → shared types + i18n → web pages (+ Windows views) → register in the nav model.

- **Phase 1 — Invoicing + profitability (recommended start).** Purchase & sales invoices
  that move stock at weighted‑average cost, the "300 + 8%" margin discount, and profit
  per invoice/item/client. Highest daily value; exercises money, stock, and margin logic.
- **Phase 2 — Inventory depth.** Multi‑store, transfers (إذن تحويل), stocktake/adjustment,
  item card, valuation, reorder‑level and movement reports.
- **Phase 3 — Accounts / general ledger.** Chart of accounts, compound entries, cash
  in/out, account statement & balances, party balances tied to the ledger.
- **Phase 4 — Notes & due payments.** أوراق قبض/دفع, portfolios (حوافظ), aging of due
  payments, note reports.
- **Phase 5 — Close & polish.** Fiscal period close, PDF/Excel export on every doc/report,
  owner presence/activity dashboard.
- **Phase 6 — Android native client.**

## 6. Open questions for the owner (to confirm before each phase)

- Confirm **weighted‑average** as the default stock costing (vs FIFO).
- Confirm the **floor margin** below which a sale is blocked (e.g. never below cost, or
  never below 3% markup).
- Whether purchases also use the margin model or just record actual supplier cost.
- Multi‑currency now or later (EGP only to start).

---

## 3.x Sources (business‑logic research)

- Notes receivable / payable: [Corporate Finance Institute](https://corporatefinanceinstitute.com/resources/accounting/notes-receivable/),
  [Lumen Learning — Notes Payable](https://content.one.lumenlearning.com/financialaccounting/chapter/entries-related-to-notes-payable/).
- Inventory valuation (weighted average vs FIFO for wholesale): [Fulfil](https://www.fulfil.io/blog/inventory-valuation-methods-fifo-moving-weighted-average/),
  [Finale Inventory](https://www.finaleinventory.com/blog/accounting-and-inventory-software/inventory-costing-methods/).
- Margin vs markup / cost‑plus pricing: [Xero glossary](https://www.xero.com/us/glossary/margin-vs-markup/),
  [Cost‑plus pricing (Wikipedia)](https://en.wikipedia.org/wiki/Cost-plus_pricing).
