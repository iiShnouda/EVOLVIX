namespace SKB.Api.Domain;

/// <summary>Built-in roles; NONE starts with no permission at all (owner, 2026-10-23).</summary>
public enum Role { OWNER, ADMIN, ACCOUNTANT, SALES, INVENTORY, VIEWER, NONE }

/// <summary>
/// What a party is to us; one party can be several. A CARRIER is a shipping company (شركة شحن).
/// A factory is a supplier (owner decision 2026-09-30): there is no separate FACTORY type any more;
/// old "FACTORY" values were turned into SUPPLIER (migration <c>PartyDetails</c>) and the API still
/// accepts "FACTORY" as SUPPLIER from older clients.
/// </summary>
public enum PartyType { CUSTOMER, SUPPLIER, CARRIER }

public enum DocumentType
{
    QUOTATION,
    SALES_INVOICE,
    SALES_RETURN,
    PURCHASE_INVOICE,
    PURCHASE_RETURN,
    COLLECTION_RECEIPT,
    PAYMENT_VOUCHER,
    EXPENSE,
    /// <summary>
    /// A pending sales invoice (فاتورة معلّقة): made by a sales person, waiting for the accountant.
    /// Its goods are held; no stock, money, balance or ledger moves until it is approved, which
    /// makes a SALES_INVOICE from it (as a quotation becomes one). A type of its own, so no sales
    /// report can count it.
    /// </summary>
    SALES_ORDER,
}

public enum DocumentStatus
{
    DRAFT,
    PENDING,
    CONFIRMED,
    PAID,
    PARTIALLY_PAID,
    OVERDUE,
    CANCELLED,
    RETURNED,
    /// <summary>A pending invoice the accountant turned down (with a reason).</summary>
    REJECTED,
}

/// <summary>
/// Every physical stock change. Signed <c>Quantity</c>: positive into stock, negative out.
/// The item card (كارت الصنف) and stock valuation are built from these rows.
/// </summary>
public enum StockMovementType
{
    OPENING,        // initial/opening balance
    PURCHASE_IN,    // received from a purchase invoice
    SALE_OUT,       // issued by a sales invoice
    SALES_RETURN_IN,   // customer returned goods (back into stock)
    PURCHASE_RETURN_OUT, // returned to supplier (out of stock)
    ADJUSTMENT,     // stocktake / manual correction
    TRANSFER_OUT,   // left this store on a transfer permit
    TRANSFER_IN,    // arrived at this store on a transfer permit
    SALE_CANCELLED, // back into stock when a sales invoice is cancelled or changed
    SALES_RETURN_CANCELLED,    // a customer's return cancelled: the goods leave stock again
    PURCHASE_RETURN_CANCELLED, // a return to a supplier cancelled: the goods are back in stock
}

/// <summary>STORE holds stock people use; TRANSIT is the system place goods sit while being transferred.</summary>
public enum WarehouseKind { STORE, TRANSIT }

/// <summary>
/// Which documents a price level (مستوى سعر) prices: SALE levels fill sales invoices (e.g. the
/// customer price), PURCHASE levels fill purchase invoices (e.g. the supplier price).
/// </summary>
public enum PriceSide { SALE, PURCHASE }

/// <summary>The two dimensions of an item model's variants (مقاس × لون).</summary>
public enum VariantKind { SIZE, COLOR }

/// <summary>
/// An invoice-level charge (DOMAIN.md §2.5), applied in this order: discounts first (each on what
/// is left after the one before), then taxes and additions on the discounted amount.
/// </summary>
public enum ChargeKind
{
    DISCOUNT,       // خصم مسموح به (sales) / خصم مكتسب (purchases)
    EXTRA_DISCOUNT, // خصم إضافي
    TAX,            // VAT (ضريبة القيمة المضافة)
    OTHER_TAX,      // another tax, e.g. a table tax
    ADDITION,       // زيادات أخرى, e.g. a delivery fee — not revenue, not cost
}

/// <summary>How the goods of a sale reach the customer (DOMAIN.md §2.5).</summary>
public enum DeliveryMethod
{
    PICKUP,           // the customer takes them
    OWN_DELIVERY,     // our driver
    SHIPPING_COMPANY, // a carrier, with a waybill (بوليصة شحن) — prepaid or cash on delivery
}

/// <summary>Where a delivered sale stands. Pickup sales have none.</summary>
public enum DeliveryStatus { PENDING, OUT_FOR_DELIVERY, DELIVERED, RETURNED }

/// <summary>
/// A parcel handed to a carrier (بوليصة الشحن): CREATED → PICKED_UP → DELIVERED → SETTLED, or
/// RETURNED when the customer refuses it, or CANCELLED before the carrier takes it.
/// </summary>
public enum ShipmentStatus { CREATED, PICKED_UP, DELIVERED, SETTLED, RETURNED, CANCELLED }

/// <summary>The five kinds of ledger account (DOMAIN.md §2.8). Assets and expenses grow on the debit side.</summary>
public enum LedgerAccountType { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE }

/// <summary>Where money sits (DOMAIN.md §2.6).</summary>
public enum MoneyAccountKind
{
    CASH_BOX, // خزينة
    CUSTODY,  // عهدة: cash a staff member (e.g. a driver) holds for the company
    BANK,     // حساب بنكي; InstaPay lands here too
    WALLET,   // محفظة: Vodafone Cash, Orange Cash… one account per wallet number
    POST,     // البريد المصري
}

/// <summary>Where cash sent up between boxes is: on its way, arrived, or called off.</summary>
public enum HandoverStatus
{
    SENT,
    RECEIVED,
    CANCELLED,
}

/// <summary>How money was paid or received; each method lands in one kind of account.</summary>
public enum PaymentMethod
{
    CASH,          // cash box or custody
    BANK_TRANSFER, // bank
    INSTAPAY,      // bank
    MOBILE_WALLET, // wallet
    POST,          // Egypt Post account
}

/// <summary>A money voucher (سند): receipt, payment, expense, or a transfer between accounts.</summary>
/// <summary>
/// DISCOUNT: a small amount left on a customer's account taken off (خصم تسوية); DISCOUNT_RECEIVED:
/// the same from a supplier (owner, 2026-10-02). No money moves.
/// </summary>
public enum VoucherType { RECEIPT, PAYMENT, EXPENSE, TRANSFER, DISCOUNT, DISCOUNT_RECEIVED }

/// <summary>A posted voucher can be cancelled; its money movements are then reversed.</summary>
public enum VoucherStatus { POSTED, CANCELLED }

/// <summary>Why money moved in or out of an account.</summary>
public enum MoneyMovementKind
{
    OPENING,            // opening balance of a new account
    RECEIPT,            // سند قبض
    PAYMENT,            // سند صرف
    EXPENSE,            // مصروف
    TRANSFER_IN,
    TRANSFER_OUT,
    SALE_PAID,          // paid now on a sales invoice
    PURCHASE_PAID,      // paid now on a purchase invoice
    SALES_REFUND,       // cash handed back on a sales return
    PURCHASE_REFUND,    // cash received back on a purchase return
    CARRIER_SETTLEMENT, // a shipping company paying for its COD parcels
    CANCELLATION,       // reverses a cancelled voucher
    NOTE_COLLECTED,     // a cheque / promissory note we held was paid to us
    NOTE_PAID,          // a cheque / promissory note we issued was paid
    ADVANCE_PAID,       // an advance (سلفة) handed to an employee
    ADVANCE_CANCELLED,  // an advance handed back untouched
    SALARY_PAID,        // salaries paid out of a payroll run
}

/// <summary>Financial paper (DOMAIN.md §2.7): a cheque (شيك) or a promissory note (كمبيالة).</summary>
public enum NoteKind { CHEQUE, PROMISSORY_NOTE }

/// <summary>RECEIVABLE (أوراق قبض): we hold it and collect it. PAYABLE (أوراق دفع): we issued it and pay it.</summary>
public enum NoteDirection { RECEIVABLE, PAYABLE }

/// <summary>
/// Receivable: IN_HAND → UNDER_COLLECTION (deposited) → COLLECTED; IN_HAND / UNDER_COLLECTION →
/// BOUNCED; IN_HAND → ENDORSED (to a supplier) or CANCELLED (given back) or COLLECTED (cashed).
/// Payable: ISSUED → PAID, BOUNCED or CANCELLED.
/// </summary>
/// <summary>LOST: the paper was lost or stolen (owner, 2026-10-02); the party owes again, as on a bounce.</summary>
public enum NoteStatus { IN_HAND, UNDER_COLLECTION, COLLECTED, BOUNCED, ENDORSED, CANCELLED, ISSUED, PAID, LOST }

/// <summary>
/// Transfer permit (إذن تحويل) lifecycle. SENT: goods left the source and are in transit.
/// RECEIVED: the destination confirmed them. CANCELLED: sent back to the source before receipt.
/// </summary>
public enum TransferStatus { SENT, RECEIVED, CANCELLED }

// ---- Payroll & attendance (DOMAIN.md §2.9) ----

/// <summary>A day of an employee: at work, absent, on paid or unpaid leave, or a holiday.</summary>
public enum AttendanceStatus { PRESENT, ABSENT, LEAVE, UNPAID_LEAVE, HOLIDAY }

/// <summary>Typed on the attendance sheet, or read from the fingerprint device's export.</summary>
public enum AttendanceSource { MANUAL, DEVICE }

public enum AdjustmentKind { BONUS, DEDUCTION }

/// <summary>OPEN (still being recovered) → SETTLED; CANCELLED if handed back untouched.</summary>
public enum AdvanceStatus { OPEN, SETTLED, CANCELLED }

/// <summary>DRAFT (recalculable) → POSTED (in the ledger) → PAID; a draft can be CANCELLED.</summary>
public enum PayrollRunStatus { DRAFT, POSTED, PAID, CANCELLED }

