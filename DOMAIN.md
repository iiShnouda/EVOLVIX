# SKB — Domain Design (the old ERP's logic, reorganized)

`ROADMAP.md` lists **what** the old app does (from screenshots). This file defines **how SKB
models it**: the entities, the rules and the accounting postings. It takes the old logic and
makes it cleaner, safer and easier to read. Every new feature should fit this model; if it
doesn't, update this file first.

**Sources:**
- The old database schema: 105 tables, exported to CSV.
- The old app's settings file: 118 screens and 75 company-wide switches (`settingx.exe.config`).
- The screen columns stored in that settings file.

The old program's code is obfuscated with encrypted strings, so it was not used. Meanings
marked *(inferred)* come from data and column names, not from code.

---

## 1. What was hard in the old design, and the SKB rule that replaces it

| # | Old design | Example in the old DB | SKB rule |
|---|---|---|---|
| 1 | Franco-Arabic code names | `mabeaat`, `khasmMasmoh`, `ba2e`, `safyAfterEmo` | English names in code; Arabic/English labels live only in i18n. |
| 2 | The same ~35 columns copied into 6 document tables | `mabeaat`, `sheraa`, `morMabeaat`, `morSheraa`, `MOrder`, `SOrder` | **One** `Document` + `DocumentLine` shape with a `Type`. |
| 3 | One table for everything that has a balance, told apart by 14 flags | `hesabatOther` holds customers, warehouses, cash boxes, banks, employees; `showInStockCombo`, `showInKhaznaCombo`… | A **separate typed table** per kind (Party, Warehouse, CashBox, BankAccount, Staff). Each one **links** to its ledger account. |
| 4 | Magic numbers | `-100` = none, direction `216`/`220`, doc type `301`/`308`, `typeMadeen` `217`–`219` | Named enums and nullable foreign keys. |
| 5 | A fixed column pair for every discount and tax | `khasmMasmoh` + `khasmMasmohPercent`, `khazmEdafy…`, `dareba…`, `darebaOther…` | A **list of charges** per document. Each charge stores its rule (% or amount) and its result. |
| 6 | Money as `decimal(19,4)`, and some tables store numbers as text | `MOrder.egmaly` is text | Integer **minor units** everywhere (CLAUDE.md rule 4). |
| 7 | Stored balances that can drift from the real transactions | `RAwel.hesab` | Balances are **computed** from the ledger. A cached balance must match that computation, and a test checks it. |
| 8 | Twin quantity columns for a second unit | `quantity` + `quantity2` | One quantity in the **base unit**; each line stores the unit and its conversion factor. |
| 9 | Settings named after UI checkboxes | `chkBoxReb7Add1`, `chkNoKsoor` | Named, typed **policies** with a description (§5). |
| 10 | User passwords stored in a table column | `ac.pw` | Hashed passwords + server sessions (already built). |
| 11 | Branch and location repeated on every row | `farFrom`/`farTo` + `directionFrom`/`directionTo` + `allIDFrom`/`allIDTo` | A warehouse belongs to one branch, so a warehouse ID alone is enough. |
| 12 | Logic hidden in obfuscated UI code | — | Logic lives in server services with tests; the UI only displays. |

---

## 2. The model, module by module

### 2.1 Organization & access — الفروع والمخازن والصلاحيات
- **Branch** (فرع): has a name, phone and address.
- **Warehouse** (مخزن): belongs to one branch, and a branch can have several.
  - Every warehouse is a normal store. The owner confirmed reps do **not** sell from a van (see §2.5, Delivery).
  - Old example: المخزن الرئيسى, مخزن 2 and الهرم sit under different branches.
- **CashBox** (خزينة) and **BankAccount** (بنك): each belongs to a branch and links to a ledger account.
- **Staff**: has a role, as today.
  - Staff also get **scopes**: the branches, warehouses and cash boxes they may use.
  - This replaces the old per-user flags `chkBoxFar*`, `chkBoxMakhzan*` and `chkBoxKhazna*`.
- **Sensitive permissions** are separate from roles, so the owner can grant them one by one (see §6):
  - see cost prices
  - change the price on an invoice
  - sell below the floor margin
  - post opening balances

### 2.2 Catalog — الأصناف
- **Item** (صنف): SKU, name, category, brand (ماركة) and `Kind`. The kind is one of:
  - `STOCK`: normal goods.
  - `SERVICE`: never has stock. Old setting `chkNoStockISKhedma`.
  - `RAW` / `FINISHED`: only needed if production is used (§2.9).
- **Units** (وحدات): every item has one **base unit** with factor 1, which is the smallest unit sold.
  - Larger units have a factor, for example carton = 24 or ton = 1000 kg.
  - Each unit may have **its own barcode** and **its own prices**. Old table: `itemWehda`.
  - Stock and the ledger always count in **base units**. Quantities are whole numbers (old `chkNoKsoor` = no fractions).
- **Price levels** (مستويات الأسعار): named price columns. The old app used three:
  - التوريد: supply / last purchase price.
  - البيع: wholesale.
  - المستهلك: consumer / retail.

  In SKB these are rows in `PriceLevel`, so more can be added without a schema change.
  - A party can have a default price level.
  - A **price list** (قائمة أسعار) can override the price for chosen items.
  - **Quantity breaks** give a discount above a quantity. Old table: `priceLevels`.
- **Reorder band:** a minimum (حد الطلب) and an optional maximum.
  - The reorder report suggests *max − on hand* as the quantity to order.
  - Old columns: `talab`, `talabMax`; old report `hadElTalb`.
- **Tracking flags**, each off unless the company turns it on:
  - `TrackExpiry`: stock is kept per batch with an expiry date.
  - `TrackSerials`: each unit has a serial number.
  - `HasVariants`: size and color. **The company needs this**, as confirmed by the owner.
    - A *model* (e.g. "Shirt X") has variants, one per size × color.
    - Each variant has its own SKU, barcode and stock, and prices default to the model's.
    - Reports can group by model or show each variant.

### 2.3 Parties — العملاء والموردين
- **Party**: one table, whose roles are `CUSTOMER` and/or `SUPPLIER` (as today). A party also has:
  - credit limit (حد الائتمان)
  - default price level
  - default sales rep
  - tax number
- Each party links to one **ledger sub-account**, created automatically under Customers or Suppliers.
  - Its balance *is* that account's balance.
  - A party statement (كشف حساب) is the account statement.
- **Sales rep** (مندوب): a Staff member with a commission % (old `emo`).
- **Shipping company** (شركة شحن): a party with the `CARRIER` role, used for deliveries (§2.5).

### 2.4 Stock — المخزون
- **StockBalance**: one row per item per warehouse, plus the batch when expiry is tracked.
  - It holds the quantity on hand and is updated inside the same transaction as the movement.
  - `Product.StockOnHand` becomes the sum across warehouses.
- **StockMovement** (the ledger, already built) gains `WarehouseId` and later `BatchId`.
  - The item card can then be filtered by warehouse.
- **Average cost** is **company-wide per item**:
  - A transfer moves goods but does not change their cost (old `chkBoxIsNotTawelInAvg` = on).
  - Receipts recompute the average; issues leave at the average (§3.3 of ROADMAP).
  - The old app computed the average **per branch**, by replaying every movement at report
    time (`avgMor`, §8). SKB stores the average on each movement instead. Whether it should be
    per branch is an open question for the owner.
- **No negative stock**: an issue that would take a warehouse below zero is refused.
  - Old setting `chkBoxIsMabeaatNotOverStock` = on. In SKB this is a policy that is on by default.
- Stock documents:
  - **Transfer** (إذن تحويل): from one warehouse to another, and it can cross branches.
    - Lifecycle `DRAFT → SENT → RECEIVED`, or `SENT → CANCELLED`.
    - While SENT, the goods are **in transit**: out of the source warehouse, not yet in the target.
    - The receiver confirms receipt (old `chkBoxIsConfermTahwel` = on). If the policy is off, SENT and RECEIVED happen together.
  - *Van load / unload* (old `eznTahwel*Mandob*`) is **not used** by the company, so it is not built.
  - **Stocktake / adjustment** (الجرد والتسويات): built. It becomes per warehouse.
  - **Opening stock** (رصيد أول المدة): one document per warehouse at go-live.

### 2.5 Trading documents — فواتير البيع والشراء
One shape for every document type:

| Type | Arabic | Stock | Money |
|---|---|---|---|
| `QUOTATION` | عرض سعر | — | — |
| `SALES_ORDER` / `PURCHASE_ORDER` | طلبية | reserved / expected *(later)* | — |
| `SALES_INVOICE` | فاتورة مبيعات | out | customer owes |
| `SALES_RETURN` | مرتجع مبيعات | in | customer credited |
| `PURCHASE_INVOICE` | فاتورة مشتريات | in | we owe supplier |
| `PURCHASE_RETURN` | مرتجع مشتريات | out | supplier debited |

- **Header** fields:
  - party, branch, sales rep, price level, date and due date
  - for purchases: the supplier's own invoice number and date
  - notes, and the source document (for returns, and later for order → invoice)
- **Line** fields:
  - item and **warehouse** (the old app picks the warehouse per line)
  - unit + factor + quantity in units; quantity in base units is derived
  - unit price, line discount (% or amount) and line tax
  - `IsBonus` for free goods (البونص): price 0, but the cost still counts against profit
  - cost and profit snapshot (built)
- **Charges**: the invoice-level discounts, taxes and additions, as a list. They are applied
  in this order:
  1. `DISCOUNT` (خصم مسموح به on sales, خصم مكتسب on purchases)
  2. `EXTRA_DISCOUNT` (خصم إضافي)
  3. `TAX` (VAT, ضريبة المبيعات)
  4. `OTHER_TAX` (e.g. withholding)
  5. `ADDITION` (زيادات أخرى, e.g. delivery)

  Each charge stores its basis (% or fixed amount) and the computed amount. **Profit** is net
  revenue after all discounts, minus cost. Taxes never count as profit (ROADMAP §3.4).
- **Payment on the invoice**: an amount paid now into a cash box or bank. The rest goes on
  the party's account. `Paid` and `Remaining` are shown, as in the old app (المدفوع / الباقي).
- **Commission** (عمولة): rep commission % × net sales. It is posted as an expense owed to the
  rep and is reversed by returns.
- **Delivery** (التوصيل). The owner confirmed goods reach the customer in one of two ways:
  our own delivery, or a **shipping company**. A sales invoice records:
  - `DeliveryMethod`: `PICKUP` / `OWN_DELIVERY` / `SHIPPING_COMPANY`
  - the carrier and its waybill number (رقم البوليصة)
  - an optional shipping fee, charged to the customer as an `ADDITION` charge
  - a delivery status: `PENDING → OUT_FOR_DELIVERY → DELIVERED`, or `RETURNED`
  - If the shipping company **collects the cash from the customer** (تحصيل عند الاستلام):
    - The carrier owes that money until it pays us.
    - A receipt from the carrier then settles those invoices.
    - This is open to confirm with the owner.
- **Numbering:** one prefix per type (INV, PUR, SRT, PRT, ADJ, TRF…), yearly sequence. This is built.

### 2.6 Money — الخزينة والبنوك
- **Receipt** (سند قبض) from a customer and **Payment** (سند صرف) to a supplier.
  - Each can be cash, bank or cheque (§2.7).
  - Each can be **allocated** to one or more invoices. Old table `khaznaInvoice`; the old
    receipt screen shows invoice / net / remaining / paid.
  - Unallocated money stays on the party's account.
- **Cash transfer:** cash box ↔ cash box, or cash box ↔ bank (سحب / إيداع).
- **Expense** (مصروف): a category and sub-category (old `masrof` / `masrofSub`), paid from a cash box or bank.
- **Daily cash report** (حركة اليوم): every money movement of a day per cash box. This is a query, not stored.

### 2.7 Cheques & notes — الأوراق المالية والحوافظ
- **Note** (ورقة): direction `RECEIVABLE` (أ.ق) or `PAYABLE` (أ.د). Its fields are:
  - number, bank, amount, due date (تاريخ الاستحقاق)
  - drawer (المسحوب عليه) and guarantor (الضامن)
  - party, and endorsed-to party (المظهر له)
  - status
- **Portfolio** (حافظة): a batch of notes received together (e.g. from a rep) or lodged together at a bank.
- **Receivable lifecycle** (each step posts its journal entry and adds a history row; old `hfzaHistory`):
  - `IN_HAND → UNDER_COLLECTION (deposited at bank) → COLLECTED`
  - `IN_HAND / UNDER_COLLECTION → BOUNCED (مرتدة)`. The party owes again.
  - `IN_HAND → ENDORSED (مظهرة)` to a supplier, which pays our debt.
  - `IN_HAND → CANCELLED (ملغية)`
- **Payable lifecycle:** `ISSUED → PAID`, or `→ BOUNCED` / `CANCELLED`.

### 2.8 Ledger — الحسابات العامة
- **Account tree** (دليل الحسابات): Assets / Liabilities / Equity / Revenue / Expense, then groups, then accounts.
  - **System accounts** are created by setup and can't be deleted: Inventory, Customers, Suppliers,
    Sales, Sales returns, COGS, VAT output/input, Notes receivable/payable, Commission, Stock gain/loss.
  - Customers, suppliers, cash boxes, banks and reps each get a **sub-account** under their group, automatically.
- **Journal entry** (قيد): a date, a description, a source document (if any), and lines of
  `(account, debit, credit, party?, branch)`.
  - An entry is **refused unless debits = credits**.
  - A **compound entry** (قيد مركب) is a manual entry with any number of lines. Old tables `kedAction` / `kedActionSub`.
- **Opening balances** (أرصدة أول المدة): a single opening entry at go-live. Old table `RAwel`.
- **Period lock** (إقفال الحركات): nothing can be posted, edited or cancelled on or before the lock date.

### 2.9 Later modules — only if the company uses them
Owner's answers (2026-09-28):
- **Payroll & attendance: yes.**
- Production and maintenance: not used.
- Currency: EGP only for now, **maybe others later**.

| Module | Old tables | SKB shape |
|---|---|---|
| Production (أمر شغل) — *not used* | `amrShoghl`, `twsifAmrShoghlMain/Sub` | Bill of materials (components + waste %), then a production order that consumes RAW and produces FINISHED at the summed cost. |
| Maintenance jobs (صيانة) — *not used* | `fixJob` | A job card per customer item, with parts (stock out) and labour (service line), invoiced on close. |
| **Payroll & attendance — used** | `P_*`, `FP` (fingerprint devices) | A separate module: shifts, attendance import, rules (late / absence / overtime), salary run posting one journal entry. |
| Item exchange (استبدال) | `estbdal*` | A sales return + sales invoice pair created together. |
| Customer follow-up | `motabetAmyl` | Notes and reminders on a party. |
| Multi-currency — *maybe later* | `crc`, `crcVal` | Every document stores a currency + rate from day one: EGP and rate 1 today, so turning currencies on later needs no data migration. The ledger always posts in the base currency, and exchange differences (old `getDiffCrc`) post to an FX gain/loss account. |

---

## 3. Posting rules — what each document does

"Inventory" is valued at average cost. VAT is always its own account. Dr = debit, Cr = credit.

| Document | Stock | Journal entry |
|---|---|---|
| Sales invoice | out, at avg cost | Dr Customer (or Cash for the paid part) · Cr Sales (net of discounts) · Cr VAT output · Dr COGS · Cr Inventory |
| Sales return | in, at the original line cost | Dr Sales returns · Dr VAT output · Cr Customer/Cash · Dr Inventory · Cr COGS |
| Purchase invoice | in, recomputes avg | Dr Inventory (net of discounts) · Dr VAT input · Cr Supplier (or Cash) |
| Purchase return | out, backs the receipt out of avg | Dr Supplier/Cash · Cr Inventory · Cr VAT input |
| Receipt / Payment | — | Dr Cash/Bank · Cr Customer — or — Dr Supplier · Cr Cash/Bank |
| Expense | — | Dr Expense category · Cr Cash/Bank |
| Cash transfer | — | Dr target cash/bank · Cr source |
| Transfer (warehouse) | out of source → in transit → into target | none: same company Inventory account |
| Stocktake gain / loss | in / out, at avg | Dr Inventory · Cr Stock gain — or — Dr Stock loss · Cr Inventory |
| Cheque received | — | Dr Notes receivable · Cr Customer |
| …deposited / collected | — | Dr Notes under collection · Cr Notes receivable, then Dr Bank · Cr Notes under collection |
| …bounced | — | Dr Customer · Cr Notes receivable (or under collection) |
| …endorsed | — | Dr Supplier · Cr Notes receivable |
| Rep commission | — | Dr Commission expense · Cr Rep (commission payable) |
| Opening balances | opening stock per warehouse | one entry; the difference goes to Opening equity |

Documents post these **automatically** when they are confirmed, in the same transaction as
their stock movements. Cancelling a document posts the exact reverse; nothing is deleted.

---

## 4. Old table → SKB concept

| Old table(s) | What it is | SKB |
|---|---|---|
| `far` | branches | `Branch` |
| `hesabatOther` (flags) | chart + every party / warehouse / cash box / bank / employee | `Account` tree **plus** typed `Party`, `Warehouse`, `CashBox`, `BankAccount`, `Staff`, each linked to an account |
| `F_Account_Chart` | chart of accounts template | seeded `Account` tree |
| `item`, `itemType`, `allPro*`, `itemAllPro` | items, categories, custom properties (barcode, SN, …) | `Item`, `Category`, `Brand`; fixed fields instead of generic property rows |
| `itemWehda`, `wehdat` | units + factor + barcode | `ItemUnit`, `Unit` |
| `price`, `itemPrice`, `priceList*`, `priceLevels` | price levels, lists, quantity breaks | `PriceLevel`, `ItemPrice`, `PriceList`, `QuantityBreak` |
| `stock`, `stockSerials` | on-hand per item/warehouse/expiry, serials | `StockBalance` (+ `Batch`, `Serial` when enabled) |
| `mabeaat`, `sheraa`, `morMabeaat`, `morSheraa`, `MOrder`, `SOrder` (+`Items`) | sales / purchases / returns / orders | `Document` + `DocumentLine` + `DocumentCharge` |
| `tahwel`, `tahwelItems` | transfers | `Transfer` + lines |
| `eznTahwel*Mandob*` | van load/unload | *not used* |
| `taswya`, `taswyaItem` | stock adjustments | stocktake (built) |
| `khaznaEsn`, `khaznaAction`, `khaznaInvoice`, `khaznaType` | cash receipts/payments, allocations | `Receipt` / `Payment` + `Allocation` |
| `masrof`, `masrofSub` | expense categories | `ExpenseCategory` (2 levels) |
| `hwafez`, `hwafezItems`, `hfzaHistory` | cheque portfolios, cheques, history | `Portfolio`, `Note`, `NoteEvent` |
| `kedAction`, `kedActionSub` | journal entries | `JournalEntry`, `JournalLine` |
| `RAwel` | opening balances | opening `JournalEntry` + opening stock |
| `crc`, `crcVal` | currencies and rates | later (PROGRESS §6) |
| `ac`, `usersAction`, `wardea` | users, sessions, shifts | `Staff`, `Session` (built); shifts later |
| `allActions`, `bgs` | activity log, messages/errors | `AuditEntry` (built), server logs |
| `info` | company header for printing | `CompanySettings` (built; add logo + print footers) |
| `P_*`, `FP` | payroll, attendance devices | later module (§2.9) |

---

## 5. Company switches → SKB policies

Old values are from the company's settings file. "Default" is what SKB starts with.

| Old switch | Meaning | SKB policy | Default |
|---|---|---|---|
| `chkBoxIsMabeaatNotOverStock` = on | can't sell more than on hand | `stock.allowNegative` | **false** |
| `chkBoxIsConfermTahwel` = on | receiver confirms a transfer | `transfers.requireReceipt` | **true** |
| `chkBoxIsNotTawelInAvg` = on | transfers don't change avg cost | *(rule, not a setting)* | — |
| `chkNoKsoor` = on | no fractional quantities | *(rule: base-unit integers)* | — |
| `chkWehdat` = on | multiple units per item | `items.units` | true |
| `chkBarCode` = on | barcodes | *(always on)* | — |
| `chkExpirDate` = off | expiry tracking | `items.trackExpiry` | false |
| `chkBoxIsSerial` | serial numbers | `items.trackSerials` | false |
| `chkBoxSizeColor` = off | size/color variants | `items.variants` | **true** (owner needs it) |
| `chkCrc` = off | multi-currency | `money.multiCurrency` | false (schema ready, §2.9) |
| `chkTaklefa` = off | extra costs added to a purchase | `purchases.landedCosts` | false |
| `chkLastPrice` = off | suggest the last price for this party | `pricing.suggestLastPrice` | true |
| `chkBoxIsTalbya` = off | purchase / sales orders | `documents.orders` | false |
| `chkBoxIsCashier` = off | point-of-sale screen | `sales.posMode` | false |
| `chkBoxIsWardea` = off | cashier shifts | `cash.shifts` | false |
| `chkItemAlert` = on | reorder alerts | *(always on: dashboard + report)* | — |
| `chkBoxReb7Add*/Sub*`, `chkBoxTaklefa*`, `chkBoxMabeaat*` | which charges count toward profit/cost/sales | *(one fixed rule, §2.5: profit = net after discounts − cost; tax excluded)* | — |
| invoice screen: `chkStop*`, `comboBoxPrice1`, default cash box | which fields the cursor skips, default price level, default cash box | per-user **screen preferences** (allowed on the client) + party/branch defaults | — |

---

## 6. Old user flags → SKB permissions

| Old flag (screen `ac`) | SKB |
|---|---|
| `chkCanView/Add/Edit/Del/Print` | `<module>:view/create/edit/cancel/print` per module |
| `chkBoxFar*`, `chkBoxMakhzan*`, `chkBoxKhazna*`, `chkBoxMandob*`, `chkBoxAmin*` | **scopes**: allowed branches / warehouses / cash boxes / reps |
| `chkBoxShowPriceT/B/MInReport` | `prices:view-cost` (supply price and average cost are hidden without it) |
| `chkBoxIsPriceUpdate`, `chkBoxIsPriceComboEnable` | `sales:change-price`, `sales:choose-price-level` |
| `chkCanAddItems` | `items:create` |
| `chkBoxShowRaseed` | `parties:view-balance` |
| `chkBoxCanTarseed` | `setup:opening-balances` |
| `chkIsSV`, `chkIsIntAdmin` | roles `OWNER` / `ADMIN` |
| `chkIsSrvrTm` | *(always server time)* |

---

## 7. Build order

Each step is a working slice: API, web, tests and docs together.

1. **Warehouses:**
   - `Warehouse` under `Branch`, and `StockBalance` per warehouse.
   - Movements carry the warehouse, and invoice lines pick a warehouse.
   - Migration: all current stock goes to one "Main warehouse" per branch.
2. **Transfers:** `DRAFT → SENT → RECEIVED`, in-transit stock, and the transfer reports.
3. **Units, price levels & size/color:** base unit + larger units with barcodes, wholesale / consumer prices, and item models with size × color variants.
4. **Invoice charges, reps & delivery:** the discount/tax list, bonus lines, sales rep + commission, paid-now into a cash box, and delivery (own / shipping company).
5. **Cash boxes, banks, receipts, payments, expenses**, with allocation to invoices.
6. **Ledger:** account tree, automatic posting (§3), compound entries, account statement, opening balances.
7. **Cheques & portfolios.**
8. **Financial statements**, then analytics (ROADMAP Phases 5–6).
9. Payroll & attendance (§2.9).

---

## 8. What the old database's own code shows

The old database held about 40 of its own SQL functions. They were read as text from
`company.MDF`, without attaching or changing it. Most are small helpers (null → 0, joining
columns into text). The ones that carry business logic:

| Function | What it does | SKB |
|---|---|---|
| `avgMor(branch, item, date)` | Replays one item's movements in date order. A receipt recomputes `avg = total value / total qty`; an issue leaves at the current avg. | Same method (ROADMAP §3.3), but stored on each movement (`AvgCostAfter`) instead of replayed with a cursor on every report. |
| `getStockOrderM` / `getStockOrderS` / `getReqOrder` | Remaining on an order = Σ ordered − Σ delivered (`quantityT` on invoices), **per item per party**, not per order. | Each invoice line links to the order line it fulfils, so every order shows its own ordered / delivered / remaining. |
| `getMadInvoice(invoice)` | Paid amount of an invoice = Σ receipt allocations to it (`khaznaInvoice`). | Same idea: `Paid` = Σ allocations (§2.6). |
| `getWehdaCount`, `getItemMinWehdaPrice` | Converts a balance or price between an item's units, using the unit factors. | `ItemUnit.Factor`; stock is always stored in the base unit (§2.2). |
| `getMaxExpID` | Gives each (item, expiry date) its own batch number. | `Batch` per item + expiry, when `items.trackExpiry` is on. |
| `getDiffCrc` | Currency difference: an amount at the document's rate, revalued at the latest rate. | Later, with multi-currency. |
| `getHesabLevel`, `hesabSort`, `getHesabMain` | Walk the account tree by its code path (`0-1-2-17`). | A parent ID on each account; the code is only a label. |

Document type codes used inside these functions:
- `301` = sales invoice
- `303` = purchase invoice
- `328` = purchase order (طلبية شراء)
- `329` = sales order (طلبية بيع)
- `308` = cheque deposited to a cash box (seen in the cash log)

**Old bug not to copy:** `getDetailsInvoice` prints the first tax's label next to the second
tax's amount.

