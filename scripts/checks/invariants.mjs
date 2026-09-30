import pg from 'pg';
const db = process.argv[2];
const c = new pg.Client({
  connectionString: process.env.PGURL ?? `postgres://postgres@localhost:5433/${db}`,
});
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
let bad = 0;
const expectNone = async (name, sql) => {
  const rows = await q(sql);
  if (rows.length) {
    bad++;
    console.log('FAIL', name, JSON.stringify(rows.slice(0, 5)));
  } else console.log('ok  ', name);
};
await expectNone(
  'stock = Σ balances',
  `select p."Sku", p."StockOnHand", coalesce(sum(b."Quantity"),0) s from "Products" p left join "StockBalances" b on b."ProductId"=p."Id" group by p."Id" having p."StockOnHand" <> coalesce(sum(b."Quantity"),0)`,
);
await expectNone(
  'stock = Σ movements',
  `select p."Sku" from "Products" p left join "StockMovements" m on m."ProductId"=p."Id" group by p."Id" having p."StockOnHand" <> coalesce(sum(m."Quantity"),0)`,
);
await expectNone(
  'balance = Σ its movements',
  `select b."ProductId" from "StockBalances" b where b."Quantity" <> (select coalesce(sum(m."Quantity"),0) from "StockMovements" m where m."ProductId"=b."ProductId" and m."WarehouseId"=b."WarehouseId")`,
);
await expectNone('no negative balance', `select * from "StockBalances" where "Quantity" < 0`);
await expectNone(
  'exactly one base unit per item',
  `select p."Sku", count(u.*) filter (where u."Factor"=1) n from "Products" p left join "ItemUnits" u on u."ProductId"=p."Id" group by p."Id" having count(u.*) filter (where u."Factor"=1) <> 1`,
);
await expectNone(
  'line qty = unit qty × factor',
  `select "Id" from "DocumentLines" where "Quantity" <> "UnitQuantity" * "UnitFactor" and "SourceLineId" is null`,
);
await expectNone(
  'return lines consistent',
  `select "Id" from "DocumentLines" where "SourceLineId" is not null and "Quantity" <> "UnitQuantity" * "UnitFactor"`,
);
await expectNone(
  'line gross = qty × price (same-unit lines)',
  `select "Id" from "DocumentLines" where "LineTotal" + "Discount" <> "UnitQuantity"::bigint * "UnitPrice" and ("SourceLineId" is null or "UnitFactor" > 1)`,
);
await expectNone(
  'doc subtotal = Σ line gross',
  `select d."Number" from "SalesDocuments" d join "DocumentLines" l on l."DocumentId"=d."Id" group by d."Id" having d."Subtotal" <> sum(l."LineTotal"+l."Discount")`,
);
await expectNone(
  'doc cost = Σ line cost',
  `select d."Number" from "SalesDocuments" d join "DocumentLines" l on l."DocumentId"=d."Id" group by d."Id" having d."CostTotal" <> sum(l."LineCost")`,
);
await expectNone(
  'returns never exceed line',
  `select s."Id" from "DocumentLines" s join "DocumentLines" r on r."SourceLineId"=s."Id" join "SalesDocuments" rd on rd."Id"=r."DocumentId" and rd."Status"<>'CANCELLED' group by s."Id" having sum(r."Quantity") > s."Quantity" or sum(r."LineTotal"+r."Discount") > s."LineTotal"+s."Discount" or sum(r."LineCost") > s."LineCost"`,
);
await expectNone(
  'one default active level per side',
  `select "Side", count(*) from "PriceLevels" where "IsDefault" and "IsActive" group by "Side" having count(*) <> 1`,
);
await expectNone(
  'variant unique per model/size/color',
  `select "ModelId","SizeId","ColorId" from "Products" where "ModelId" is not null group by 1,2,3 having count(*)>1`,
);
await expectNone(
  'variants carry model units',
  `select p."Sku" from "Products" p join "ModelUnits" mu on mu."ModelId"=p."ModelId" left join "ItemUnits" iu on iu."ProductId"=p."Id" and iu."UnitId"=mu."UnitId" and iu."Factor"=mu."Factor" where iu."Id" is null`,
);
await expectNone(
  'grand = subtotal − discounts + taxes + additions',
  `select "Number" from "SalesDocuments" where "GrandTotal" <> "Subtotal" - "DiscountTotal" + "TaxTotal" + "AdditionTotal"`,
);
await expectNone(
  'discount total = Σ line + invoice discount shares',
  `select d."Number" from "SalesDocuments" d join "DocumentLines" l on l."DocumentId"=d."Id" group by d."Id" having d."DiscountTotal" <> sum(l."Discount" + l."DocDiscount")`,
);
await expectNone(
  'discount shares = discount charges',
  `select d."Number" from "SalesDocuments" d where exists (select 1 from "DocumentCharges" c where c."DocumentId"=d."Id") and (select coalesce(sum(l."DocDiscount"),0) from "DocumentLines" l where l."DocumentId"=d."Id") <> (select coalesce(sum(c."Amount"),0) from "DocumentCharges" c where c."DocumentId"=d."Id" and c."Kind" in ('DISCOUNT','EXTRA_DISCOUNT'))`,
);
await expectNone(
  'tax / additions = their charges',
  `select d."Number" from "SalesDocuments" d where exists (select 1 from "DocumentCharges" c where c."DocumentId"=d."Id") and (d."TaxTotal" <> (select coalesce(sum(c."Amount"),0) from "DocumentCharges" c where c."DocumentId"=d."Id" and c."Kind" in ('TAX','OTHER_TAX')) or d."AdditionTotal" <> (select coalesce(sum(c."Amount"),0) from "DocumentCharges" c where c."DocumentId"=d."Id" and c."Kind"='ADDITION'))`,
);
await expectNone(
  'sales profit = net − cost',
  `select "Number" from "SalesDocuments" where "Type" in ('SALES_INVOICE','SALES_RETURN') and "ProfitTotal" <> "Subtotal" - "DiscountTotal" - "CostTotal"`,
);
await expectNone(
  'bonus lines are free',
  `select "Id" from "DocumentLines" where "IsBonus" and ("UnitPrice" <> 0 or "LineTotal" <> 0 or "DocDiscount" <> 0)`,
);
await expectNone(
  'pickup sales have no delivery status',
  `select "Number" from "SalesDocuments" where ("DeliveryMethod" = 'PICKUP') <> ("DeliveryStatus" is null)`,
);
await expectNone(
  'shipment COD = Σ invoice shares',
  `select s."Number" from "Shipments" s left join "ShipmentInvoices" i on i."ShipmentId"=s."Id" group by s."Id" having s."CodAmount" <> coalesce(sum(i."CodShare"),0) or count(i.*) = 0`,
);
await expectNone(
  'an invoice is on one live shipment at most',
  `select i."DocumentId" from "ShipmentInvoices" i join "Shipments" s on s."Id"=i."ShipmentId" where s."Status" not in ('RETURNED','CANCELLED') group by 1 having count(*) > 1`,
);
await expectNone(
  'shipped invoices match the parcel',
  `select s."Number" from "Shipments" s join "ShipmentInvoices" i on i."ShipmentId"=s."Id" join "SalesDocuments" d on d."Id"=i."DocumentId" where d."PartyId"<>s."PartyId" or d."BranchId"<>s."BranchId" or d."CarrierId" is distinct from s."CarrierId" or d."DeliveryMethod"<>'SHIPPING_COMPANY'`,
);
await expectNone(
  'settled parcels point at their settlement',
  `select "Number" from "Shipments" where ("Status"='SETTLED') <> ("SettlementId" is not null)`,
);
await expectNone(
  'settlement COD = Σ its parcels',
  `select x."Number" from "CarrierSettlements" x join "Shipments" s on s."SettlementId"=x."Id" group by x."Id" having x."CodTotal" <> sum(s."CodAmount") or bool_or(s."CarrierId"<>x."CarrierId")`,
);
await expectNone(
  'settlement difference = COD − fees − received',
  `select "Number" from "CarrierSettlements" where "Difference" <> "CodTotal" - "Fees" - "Received" or "Fees" < 0 or "Received" < 0`,
);
// A carrier's account moves through parcels, settlements and vouchers (receipts from / payments to it).
await expectNone(
  'carrier balance = COD delivered − settled ∓ vouchers',
  `select p."Name" from "Parties" p where p."Types" = array['CARRIER'] and p."Balance" <> coalesce((select sum(s."CodAmount") from "Shipments" s where s."CarrierId"=p."Id" and s."Status" in ('DELIVERED','SETTLED')),0) - coalesce((select sum(x."Fees"+x."Received") from "CarrierSettlements" x where x."CarrierId"=p."Id"),0) - coalesce((select sum(case v."Type" when 'RECEIPT' then v."Amount" else -v."Amount" end) from "Vouchers" v where v."PartyId"=p."Id" and v."Status"='POSTED' and v."Type" in ('RECEIPT','PAYMENT')),0)`,
);
// Money (step 5): balances are the sum of their movements, never negative, numbered without gaps.
await expectNone(
  'account balance = Σ movements',
  `select a."Name" from "MoneyAccounts" a where a."Balance" <> coalesce((select sum(m."Amount") from "MoneyMovements" m where m."AccountId"=a."Id"),0)`,
);
await expectNone(
  'account balance = last balance-after',
  `select a."Name" from "MoneyAccounts" a where a."Balance" <> coalesce((select m."BalanceAfter" from "MoneyMovements" m where m."AccountId"=a."Id" order by m."Seq" desc limit 1),0) or a."LastSeq" <> (select count(*) from "MoneyMovements" m where m."AccountId"=a."Id")`,
);
await expectNone(
  'no account ever below zero',
  `select "Id" from "MoneyMovements" where "BalanceAfter" < 0 union all select "Id" from "MoneyAccounts" where "Balance" < 0`,
);
await expectNone(
  'movements chain by seq',
  `select m."Id" from (select m.*, lag("BalanceAfter") over (partition by "AccountId" order by "Seq") prev, row_number() over (partition by "AccountId" order by "Seq") rn from "MoneyMovements" m) m where m."Seq" <> m.rn or m."BalanceAfter" <> coalesce(m.prev,0) + m."Amount"`,
);
await expectNone(
  'at most one default cash box per branch',
  `select "BranchId" from "MoneyAccounts" where "IsDefault" group by 1 having count(*) > 1 union all select "Id" from "MoneyAccounts" where "IsDefault" and ("Kind" <> 'CASH_BOX' or not "IsActive")`,
);
await expectNone(
  'voucher amount = Σ its lines',
  `select v."Number" from "Vouchers" v where v."Type" <> 'TRANSFER' and v."Amount" <> coalesce((select sum(l."Amount") from "VoucherLines" l where l."VoucherId"=v."Id"),0)`,
);
await expectNone(
  'voucher money moved as posted',
  `select v."Number" from "Vouchers" v where coalesce((select sum(m."Amount") from "MoneyMovements" m where m."VoucherId"=v."Id"),0) <> case when v."Status"='CANCELLED' or v."Type"='TRANSFER' then 0 when v."Type"='RECEIPT' then v."Amount" else -v."Amount" end`,
);
await expectNone(
  "allocations within the voucher, to its party's invoices",
  `select v."Number" from "Vouchers" v join "VoucherAllocations" a on a."VoucherId"=v."Id" join "SalesDocuments" d on d."Id"=a."DocumentId" group by v."Id" having sum(a."Amount") > v."Amount" or bool_or(d."PartyId" <> v."PartyId") or bool_or(d."Type" <> case v."Type" when 'RECEIPT' then 'SALES_INVOICE' else 'PURCHASE_INVOICE' end)`,
);
await expectNone(
  'an invoice is never paid beyond its total',
  `select "Number" from "SalesDocuments" where "PaidAmount" > "GrandTotal" or "PaidAmount" < 0`,
);
await expectNone(
  'paid-now went through its account',
  `select d."Number" from "SalesDocuments" d where d."PaidAccountId" is not null and not exists (select 1 from "MoneyMovements" m where m."DocumentId"=d."Id" and m."AccountId"=d."PaidAccountId")`,
);
// Ledger (step 6): balanced entries, and every sub-ledger ties to its ledger accounts.
const golive = `coalesce((select min("CreatedAt") from "JournalEntries" where "SourceType"='OPENING'), '-infinity'::timestamptz)`;
await expectNone(
  'chart of accounts set up',
  `select 1 where (select count(*) from "LedgerAccounts" where "SystemKey" is not null) < 35`,
);
await expectNone(
  'every entry balances',
  `select e."Number" from "JournalEntries" e join "JournalLines" l on l."EntryId"=e."Id" group by e."Id" having sum(l."Debit") <> sum(l."Credit") union all select e."Number" from "JournalEntries" e where not exists (select 1 from "JournalLines" l where l."EntryId"=e."Id")`,
);
await expectNone(
  'each line is one side, above zero',
  `select "Id" from "JournalLines" where "Debit" < 0 or "Credit" < 0 or ("Debit" > 0) = ("Credit" > 0)`,
);
await expectNone(
  'no entries on group accounts',
  `select l."Id" from "JournalLines" l join "LedgerAccounts" a on a."Id"=l."AccountId" where a."IsGroup"`,
);
await expectNone(
  'party balance = its ledger accounts',
  `select p."Name", p."Balance", coalesce(sum(l."Debit"-l."Credit"),0) ledger from "Parties" p left join "LedgerAccounts" a on a."PartyId"=p."Id" left join "JournalLines" l on l."AccountId"=a."Id" group by p."Id" having p."Balance" <> coalesce(sum(l."Debit"-l."Credit"),0)`,
);
await expectNone(
  'money account = its ledger account',
  `select m."Name", m."Balance", coalesce(sum(l."Debit"-l."Credit"),0) ledger from "MoneyAccounts" m left join "LedgerAccounts" a on a."MoneyAccountId"=m."Id" left join "JournalLines" l on l."AccountId"=a."Id" group by m."Id" having m."Balance" <> coalesce(sum(l."Debit"-l."Credit"),0)`,
);
await expectNone(
  'stock ledger ≈ stock at average cost (≤ 1 piastre a unit)',
  `with v as (select coalesce(sum(b."Quantity"::bigint * c."AvgCost"),0) val, coalesce(sum(abs(b."Quantity")),0) units from "StockBalances" b join "Warehouses" w on w."Id"=b."WarehouseId" join "StockCosts" c on c."ProductId"=b."ProductId" and c."PoolId" = case when w."Kind"='TRANSIT' then w."Id" else w."BranchId" end), g as (select coalesce(sum(l."Debit"-l."Credit"),0) led from "JournalLines" l join "LedgerAccounts" a on a."Id"=l."AccountId" where a."SystemKey"='INVENTORY') select v.val, g.led, v.units from v, g where abs(v.val - g.led) > v.units`,
);
await expectNone(
  'every document since go-live has its entry',
  `select d."Number" from "SalesDocuments" d where d."CreatedAt" > ${golive} and d."Type" in ('SALES_INVOICE','SALES_RETURN','PURCHASE_INVOICE','PURCHASE_RETURN') and (d."GrandTotal" <> 0 or d."CostTotal" <> 0) and not exists (select 1 from "JournalEntries" e where e."SourceId"=d."Id" and e."SourceType"=d."Type"::text)`,
);
await expectNone(
  'every voucher has its entry (and its reversal once cancelled)',
  `select v."Number" from "Vouchers" v where v."CreatedAt" > ${golive} and (not exists (select 1 from "JournalEntries" e where e."SourceId"=v."Id" and e."SourceType"='VOUCHER') or (v."Status"='CANCELLED') <> exists (select 1 from "JournalEntries" e where e."SourceId"=v."Id" and e."SourceType"='VOUCHER_CANCEL'))`,
);
await expectNone(
  'manual entries never touch money or stock',
  `select e."Number" from "JournalEntries" e join "JournalLines" l on l."EntryId"=e."Id" join "LedgerAccounts" a on a."Id"=l."AccountId" where e."SourceType" in ('MANUAL','MANUAL_REVERSAL') and (a."MoneyAccountId" is not null or a."SystemKey"='INVENTORY')`,
);
await expectNone(
  'the whole ledger balances',
  `select 1 from "JournalLines" having sum("Debit") <> sum("Credit")`,
);
// Notes (step 7): the notes accounts hold exactly the open notes, and steps follow the lifecycle.
const notesLedger = (key) =>
  `(select coalesce(sum(l."Debit"-l."Credit"),0) from "JournalLines" l join "LedgerAccounts" a on a."Id"=l."AccountId" where a."SystemKey"='${key}')`;
const openNotes = (dir, status) =>
  `(select coalesce(sum("Amount"),0) from "Notes" where "Direction"='${dir}' and "Status"='${status}')`;
await expectNone(
  'notes receivable = notes in hand',
  `select 1 where ${notesLedger('NOTES_RECEIVABLE')} <> ${openNotes('RECEIVABLE', 'IN_HAND')}`,
);
await expectNone(
  'notes under collection = deposited notes',
  `select 1 where ${notesLedger('NOTES_UNDER_COLLECTION')} <> ${openNotes('RECEIVABLE', 'UNDER_COLLECTION')}`,
);
await expectNone(
  'notes payable = issued notes',
  `select 1 where -${notesLedger('NOTES_PAYABLE')} <> ${openNotes('PAYABLE', 'ISSUED')}`,
);
await expectNone(
  'note statuses fit their direction',
  `select "Ref" from "Notes" where ("Direction"='RECEIVABLE' and "Status" in ('ISSUED','PAID')) or ("Direction"='PAYABLE' and "Status" not in ('ISSUED','PAID','BOUNCED','CANCELLED')) or "Amount" <= 0`,
);
await expectNone(
  "each note's steps chain from its first to its status",
  `select n."Ref" from "Notes" n where (select e."ToStatus" from "NoteEvents" e where e."NoteId"=n."Id" order by e."CreatedAt" desc limit 1) is distinct from n."Status"::text or (select count(*) from "NoteEvents" e where e."NoteId"=n."Id" and e."FromStatus" is null) <> 1`,
);
await expectNone(
  "note allocations within the note, to its party's invoices",
  `select n."Ref" from "Notes" n join "NoteAllocations" a on a."NoteId"=n."Id" join "SalesDocuments" d on d."Id"=a."DocumentId" group by n."Id" having sum(a."Amount") > n."Amount" or bool_or(d."PartyId" <> n."PartyId") or bool_or(d."Type" <> case n."Direction" when 'RECEIVABLE' then 'SALES_INVOICE' else 'PURCHASE_INVOICE' end)`,
);
await expectNone(
  'deposited notes sit in a portfolio at a bank',
  `select n."Ref" from "Notes" n left join "MoneyAccounts" m on m."Id"=n."AccountId" where n."Status"='UNDER_COLLECTION' and (n."PortfolioId" is null or m."Kind" <> 'BANK')`,
);
// Payroll (step 9): advances and salaries payable tie to the ledger; runs add up.
await expectNone(
  "an employee's advance balance = what's left on their open advances",
  `select e."Code" from "Employees" e where e."AdvanceBalance" <> coalesce((select sum(a."Remaining") from "EmployeeAdvances" a where a."EmployeeId"=e."Id" and a."Status"='OPEN'),0) or e."AdvanceBalance" < 0`,
);
await expectNone(
  'employee advances in the ledger = advances owed',
  `select 1 where ${notesLedger('EMPLOYEE_ADVANCES')} <> (select coalesce(sum("AdvanceBalance"),0) from "Employees")`,
);
await expectNone(
  'salaries payable in the ledger = what posted payrolls still owe',
  `select 1 where -${notesLedger('SALARIES_PAYABLE')} <> (select coalesce(sum(l."Net"-l."PaidAmount"),0) from "PayrollLines" l join "PayrollRuns" r on r."Id"=l."RunId" where r."Status" in ('POSTED','PAID'))`,
);
await expectNone(
  'a payroll run adds up its payslips',
  `select r."Number" from "PayrollRuns" r left join "PayrollLines" l on l."RunId"=r."Id" group by r."Id" having r."Earned" <> coalesce(sum(l."Earned"),0) or r."Recovered" <> coalesce(sum(l."AdvanceRecovery"),0) or r."Net" <> coalesce(sum(l."Net"),0) or r."Paid" <> coalesce(sum(l."PaidAmount"),0)`,
);
await expectNone(
  'a payslip: earned − recovered = net, paid within it',
  `select "Id" from "PayrollLines" where "Earned" - "AdvanceRecovery" <> "Net" or "Net" < 0 or "PaidAmount" < 0 or "PaidAmount" > "Net" or "Earned" <> greatest(0, "Basic" + "OvertimePay" + "Bonuses" - "AbsenceDeduction" - "LateDeduction" - "Deductions")`,
);
await expectNone(
  'every posted payroll has its entry',
  `select r."Number" from "PayrollRuns" r where r."Status" in ('POSTED','PAID') and r."Earned" > 0 and not exists (select 1 from "JournalEntries" e where e."SourceId"=r."Id" and e."SourceType"='PAYROLL')`,
);
await c.end();
process.exit(bad ? 1 : 0);
