namespace SKB.Api.Domain;

public enum Role { OWNER, ADMIN, ACCOUNTANT, SALES, INVENTORY, VIEWER }

public enum PartyType { CUSTOMER, SUPPLIER, FACTORY }

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
