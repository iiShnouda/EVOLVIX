namespace SKB.Api.Domain;

public enum Role { OWNER, ADMIN, ACCOUNTANT, SALES, INVENTORY, VIEWER }

/// <summary>What a party is to us; one party can be several. A CARRIER is a shipping company (شركة شحن).</summary>
public enum PartyType { CUSTOMER, SUPPLIER, FACTORY, CARRIER }

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
public enum VoucherType { RECEIPT, PAYMENT, EXPENSE, TRANSFER }

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
}

/// <summary>
/// Transfer permit (إذن تحويل) lifecycle. SENT: goods left the source and are in transit.
/// RECEIVED: the destination confirmed them. CANCELLED: sent back to the source before receipt.
/// </summary>
public enum TransferStatus { SENT, RECEIVED, CANCELLED }
