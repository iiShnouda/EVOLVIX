import { z } from 'zod';

/**
 * Zod schemas shared by the client (form validation) and server (request validation).
 * The server treats these as the authoritative contract.
 */

/** An invoice-level charge: a percent (up to 2 decimals) or a fixed amount in minor units. */
export const chargeSchema = z.object({
  kind: z.enum(['DISCOUNT', 'EXTRA_DISCOUNT', 'TAX', 'OTHER_TAX', 'ADDITION']),
  percent: z.number().min(0).max(100).optional(),
  amount: z.number().int().min(0).optional(),
  label: z.string().trim().max(60).optional(),
});
export type ChargeInputSchema = z.infer<typeof chargeSchema>;

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email or staff ID is required').max(200),
  password: z.string().min(1, 'Password is required').max(200),
  rememberDevice: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const salesListQuerySchema = paginationSchema.extend({
  status: z.string().optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
export type SalesListQuery = z.infer<typeof salesListQuerySchema>;

export const partiesListQuerySchema = paginationSchema.extend({
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'CARRIER']).optional(),
  search: z.string().max(200).optional(),
});
export type PartiesListQuery = z.infer<typeof partiesListQuerySchema>;

/** Presence heartbeat payload sent over the websocket. */
export const presenceUpdateSchema = z.object({
  currentView: z.string().max(64).optional(),
});
export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

// ---------------------------------------------------------------------------
// Invoicing (Phase 1). Money fields are integer minor units.
// ---------------------------------------------------------------------------

export const invoiceLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Selling price per unit (minor units). */
  unitPrice: z.number().int().min(0),
  /** Optional flat line discount (minor units). */
  discount: z.number().int().min(0).default(0),
  /** Warehouse the goods leave from; defaults to the invoice's warehouse. */
  warehouseId: z.string().uuid().optional(),
  /** One of the item's units (carton…); quantity and price are then per that unit. None = base unit. */
  unitId: z.string().uuid().optional(),
  /** Free goods: sent with price 0. */
  isBonus: z.boolean().optional(),
  /** This line's price basis (owner, 2026-10-01); none = the invoice's. */
  priceBasis: z.enum(['LIST', 'LAST', 'COST']).optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const createSalesInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  /** The branch it is made in (one the person may work in); none = their working branch. */
  branchId: z.string().uuid().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'Add at least one line item'),
  taxPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().optional(),
  /** The day it happened, if not today (needs documents:backdate; owner, 2026-10-02). */
  documentDate: z.string().optional(),
  paidAmount: z.number().int().min(0).default(0),
  /** Request to sell below the configured floor (still never below cost). */
  overrideFloor: z.boolean().optional().default(false),
  /** Default warehouse for every line; none = the user's branch default. */
  warehouseId: z.string().uuid().optional(),
  /** Price level; none = the customer's own, else the default sales level. */
  priceLevelId: z.string().uuid().optional(),
  /** The whole list of discounts, taxes and additions (the tax too). None = taxPercent only. */
  charges: z
    .array(z.lazy(() => chargeSchema))
    .max(20)
    .optional(),
  /** The sales rep credited with the sale. */
  repId: z.string().uuid().optional(),
  /** PICKUP (default), OWN_DELIVERY or SHIPPING_COMPANY. */
  deliveryMethod: z.enum(['PICKUP', 'OWN_DELIVERY', 'SHIPPING_COMPANY']).optional(),
  /** Where to deliver; none = the customer's address. */
  deliveryAddress: z.string().max(300).optional(),
  /** Own delivery: the driver (a staff member). */
  driverId: z.string().uuid().optional(),
  /** Shipping company: the carrier (a party of type CARRIER). */
  carrierId: z.string().uuid().optional(),
  /** Where the paid-now amount goes; none = the branch's cash box. */
  paidAccountId: z.string().uuid().optional(),
  /** The sales department (قسم); someone limited to one department may leave it out. */
  departmentId: z.string().uuid().optional(),
  /** LIST (default), LAST (the customer's last price) or COST; the last two need sales:price_basis. */
  priceBasis: z.enum(['LIST', 'LAST', 'COST']).optional(),
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

/** Turning a quotation into an invoice: what's decided now (lines and prices come from it). */
export const convertQuotationSchema = z.object({
  /** Where the goods leave from; none = each line's warehouse. */
  warehouseId: z.string().uuid().optional(),
  paidAmount: z.number().int().min(0).default(0),
  paidAccountId: z.string().uuid().optional(),
  deliveryMethod: z.enum(['PICKUP', 'OWN_DELIVERY', 'SHIPPING_COMPANY']).optional(),
  deliveryAddress: z.string().max(300).optional(),
  driverId: z.string().uuid().optional(),
  carrierId: z.string().uuid().optional(),
  overrideFloor: z.boolean().optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(500).optional(),
});
export type ConvertQuotationInput = z.infer<typeof convertQuotationSchema>;

export const purchaseLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Purchase cost per unit (minor units) — feeds the weighted-average cost. */
  unitCost: z.number().int().min(0),
  /** Warehouse the goods arrive into; defaults to the invoice's warehouse. */
  warehouseId: z.string().uuid().optional(),
  /** One of the item's units; quantity and cost are then per that unit. None = base unit. */
  unitId: z.string().uuid().optional(),
  /** Free goods from the supplier: sent with cost 0. */
  isBonus: z.boolean().optional(),
  /** The supplier's discount on the whole line (minor units). */
  discount: z.number().int().min(0).optional(),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;

export const createPurchaseInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line item'),
  taxPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().optional(),
  /** The day it happened, if not today (needs documents:backdate; owner, 2026-10-02). */
  documentDate: z.string().optional(),
  paidAmount: z.number().int().min(0).default(0),
  /** Default warehouse for every line; none = the user's branch default. */
  warehouseId: z.string().uuid().optional(),
  /** Price level; none = the supplier's own, else the default purchase level. */
  priceLevelId: z.string().uuid().optional(),
  charges: z
    .array(z.lazy(() => chargeSchema))
    .max(20)
    .optional(),
  /** Where the paid-now amount comes from; none = the branch's cash box. */
  paidAccountId: z.string().uuid().optional(),
  /** Shipping we paid (minor units): a shipping expense out of `shippingAccountId` (else the cash box). */
  shippingCost: z.number().int().min(0).optional(),
  shippingAccountId: z.string().uuid().optional(),
});
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;

// ---------------------------------------------------------------------------
// Returns (مرتجع مبيعات / مرتجع مشتريات). Always against one original invoice; price and
// cost come from the original line on the server, so the client only sends quantities.
// ---------------------------------------------------------------------------

export const returnLineSchema = z.object({
  /** The invoice line being returned. */
  lineId: z.string().uuid(),
  quantity: z.number().int().min(0),
});
export type ReturnLineInput = z.infer<typeof returnLineSchema>;

export const createReturnSchema = z.object({
  lines: z.array(returnLineSchema).min(1, 'Choose at least one item to return'),
  /** Cash settled now (minor units); the rest goes on the party's account. */
  refundAmount: z.number().int().min(0).default(0),
  notes: z.string().max(1000).optional(),
  /** The money account the refund goes through; none = the branch's cash box. */
  refundAccountId: z.string().uuid().optional(),
  /** Shipping we paid (minor units): a shipping expense out of `shippingAccountId` (else the cash box). */
  shippingCost: z.number().int().min(0).optional(),
  shippingAccountId: z.string().uuid().optional(),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

/** A return typed line by line, without an invoice (owner decision 2026-10-01). */
export const freeReturnLineSchema = z.object({
  productId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  quantity: z.number().int().min(1),
  /** Price of one unit (minor units): the party's last invoice price unless the person may change it. */
  unitPrice: z.number().int().min(0),
  discount: z.number().int().min(0).default(0),
});
export type FreeReturnLineInput = z.infer<typeof freeReturnLineSchema>;

export const createFreeReturnSchema = z.object({
  partyId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  lines: z.array(freeReturnLineSchema).min(1, 'Add at least one item to return'),
  notes: z.string().max(1000).optional(),
});
export type CreateFreeReturnInput = z.infer<typeof createFreeReturnSchema>;

// ---------------------------------------------------------------------------
// Stocktake (الجرد): counted quantity per item; only differences are posted.
// ---------------------------------------------------------------------------

export const stocktakeLineSchema = z.object({
  productId: z.string().uuid(),
  countedQuantity: z.number().int().min(0),
});
export type StocktakeLineInput = z.infer<typeof stocktakeLineSchema>;

export const stocktakeSchema = z.object({
  lines: z.array(stocktakeLineSchema).min(1, 'Enter at least one counted quantity').max(1000),
  reason: z.string().max(500).optional(),
  /** The warehouse being counted; none = the user's branch default. */
  warehouseId: z.string().uuid().optional(),
});
export type StocktakeInput = z.infer<typeof stocktakeSchema>;

export const createTransferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  lines: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1, 'Add at least one item')
    .max(500),
  notes: z.string().max(1000).optional(),
});
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

/** A name, as typed (Arabic or English); it is never translated. */
const nameFields = {
  name: z.string().trim().max(200).optional(),
};

/** A code prefix (branch EL, warehouse H or 5, department MEN): letters and digits, up to 10. */
const prefixField = z
  .string()
  .trim()
  .max(10)
  .regex(/^[\p{L}\p{N}]*$/u)
  .optional();

export const createWarehouseSchema = z.object({
  branchId: z.string().uuid(),
  ...nameFields,
  /** Empty = automatic code from the branch code. */
  code: z.string().trim().max(20).optional(),
  isDefault: z.boolean().optional().default(false),
  prefix: prefixField,
  departmentIds: z.array(z.string().uuid()).optional(),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z.object({
  ...nameFields,
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  prefix: prefixField,
  /** The departments it has; [] = every department. */
  departmentIds: z.array(z.string().uuid()).optional(),
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export const createBranchSchema = z.object({
  ...nameFields,
  code: z.string().trim().max(20).optional(),
  location: z.string().trim().max(200).optional(),
  prefix: prefixField,
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z.object({
  ...nameFields,
  location: z.string().trim().max(200).optional(),
  prefix: prefixField,
});
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const updateSettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().length(2).optional(),
  currency: z.string().trim().length(3).optional(),
  defaultMarkupPercent: z.number().int().min(0).max(1000).optional(),
  minMarkupPercent: z.number().int().min(0).max(1000).optional(),
  defaultTaxPercent: z.number().int().min(0).max(100).optional(),
  /** Staff discount limit (% of a line's worth); 100 = none. */
  maxDiscountPercent: z.number().int().min(0).max(100).optional(),
  /** Days a pending invoice holds its goods; 0 = until approved or cancelled. */
  pendingHoldDays: z.number().int().min(0).max(365).optional(),
  transfersRequireReceipt: z.boolean().optional(),
  // "" clears a company-profile field; left out = unchanged.
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.union([z.literal(''), z.string().trim().email().max(200)]).optional(),
  taxNumber: z.string().trim().max(60).optional(),
  commercialRegister: z.string().trim().max(60).optional(),
  /** One of TIME_ZONES (IANA id). */
  timeZone: z.string().trim().min(1).max(64).optional(),
  requireDepartment: z.boolean().optional(),
  returnAfterHours: z.number().int().min(0).max(720).optional(),
  hideNewPlaces: z.boolean().optional(),
  /** Minutes without use before everyone is signed out; 0 = never. */
  idleMinutes: z.number().int().min(0).max(1440).optional(),
  /** The season it is now; "" = worked out from the date. */
  currentSeasonId: z.string().max(64).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ---------------------------------------------------------------------------
// Catalog: units, categories, price levels, sizes & colors, items, models
// ---------------------------------------------------------------------------

export const createNamedSchema = z.object({
  ...nameFields,
  prefix: prefixField,
  /** A unit's usual count of pieces (a dozen = 12). */
  pieces: z.number().int().min(1).max(100000).optional(),
});
export type CreateNamedInput = z.infer<typeof createNamedSchema>;

export const updateNamedSchema = z.object({
  ...nameFields,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  prefix: prefixField,
  pieces: z.number().int().min(1).max(100000).optional(),
  /** A color's swatch, "#rrggbb". */
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type UpdateNamedInput = z.infer<typeof updateNamedSchema>;

export const createPriceLevelSchema = z.object({
  side: z.enum(['SALE', 'PURCHASE']),
  ...nameFields,
});
export type CreatePriceLevelInput = z.infer<typeof createPriceLevelSchema>;

export const updatePriceLevelSchema = updateNamedSchema.extend({
  isDefault: z.boolean().optional(),
});
export type UpdatePriceLevelInput = z.infer<typeof updatePriceLevelSchema>;

export const createVariantOptionSchema = z.object({
  kind: z.enum(['SIZE', 'COLOR']),
  ...nameFields,
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type CreateVariantOptionInput = z.infer<typeof createVariantOptionSchema>;

/** One unit of an item: the unit, how many base units it holds (1 = base unit), its barcode. */
export const itemUnitSchema = z.object({
  unitId: z.string().uuid(),
  factor: z.number().int().min(1).max(100000),
  barcode: z.string().trim().max(64).optional(),
});
export type ItemUnitInput = z.infer<typeof itemUnitSchema>;

/** A price for one unit at one level (minor units); null clears the item's own price. */
export const priceSchema = z.object({
  unitId: z.string().uuid(),
  priceLevelId: z.string().uuid(),
  price: z.number().int().min(0).nullable(),
});
export type PriceInput = z.infer<typeof priceSchema>;

export const createProductSchema = z.object({
  ...nameFields,
  /** The department (owner decision 2026-10-01); a group (categoryId) is still accepted. */
  departmentId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  sizeId: z.string().uuid().optional(),
  colorId: z.string().uuid().optional(),
  sku: z.string().trim().max(40).optional(),
  reorderLevel: z.number().int().min(0).default(0),
  units: z.array(itemUnitSchema).min(1).max(10),
  prices: z.array(priceSchema).optional(),
  /** Main supplier (a party id), or "" for none. */
  supplierId: z.union([z.literal(''), z.string().uuid()]).optional(),
  supplierCode: z.string().trim().max(64).optional(),
  /** The warehouse it is bought into: its code takes that branch's and warehouse's prefixes. */
  warehouseId: z.string().uuid().optional(),
  /** A group of the department's tree (owner, 2026-10-06): its prefixes join the item's code. */
  groupId: z.string().uuid().optional(),
  /** Give the base unit an in-store barcode when none is typed (default on). */
  autoBarcode: z.boolean().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  ...nameFields,
  departmentId: z.string().uuid().optional(),
  /** With departmentId: a group of that department ("" or missing = straight in the department). */
  groupId: z.string().uuid().optional(),
  /** "" clears it. */
  seasonId: z.union([z.literal(''), z.string().uuid()]).optional(),
  categoryId: z.string().uuid().optional(),
  sku: z.string().trim().max(40).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  units: z.array(itemUnitSchema).min(1).max(10).optional(),
  /** Main supplier (a party id), or "" for none. */
  supplierId: z.union([z.literal(''), z.string().uuid()]).optional(),
  supplierCode: z.string().trim().max(64).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const updatePricesSchema = z.object({ prices: z.array(priceSchema).min(1) });
export type UpdatePricesInput = z.infer<typeof updatePricesSchema>;

export const createModelSchema = z.object({
  ...nameFields,
  categoryId: z.string().uuid(),
  code: z.string().trim().max(20).optional(),
  reorderLevel: z.number().int().min(0).default(0),
  sizeIds: z.array(z.string().uuid()),
  colorIds: z.array(z.string().uuid()),
  units: z.array(itemUnitSchema).min(1).max(10),
  prices: z.array(priceSchema).optional(),
  /** Main supplier (a party id), or "" for none. */
  supplierId: z.union([z.literal(''), z.string().uuid()]).optional(),
  supplierCode: z.string().trim().max(64).optional(),
});
export type CreateModelInput = z.infer<typeof createModelSchema>;

export const updateModelSchema = z.object({
  ...nameFields,
  categoryId: z.string().uuid().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  addSizeIds: z.array(z.string().uuid()).optional(),
  addColorIds: z.array(z.string().uuid()).optional(),
  units: z.array(itemUnitSchema).min(1).max(10).optional(),
  /** Main supplier (a party id), or "" for none. */
  supplierId: z.union([z.literal(''), z.string().uuid()]).optional(),
  supplierCode: z.string().trim().max(64).optional(),
});
export type UpdateModelInput = z.infer<typeof updateModelSchema>;

/** A party's own price levels: null leaves a side unchanged, "" goes back to the default. */
export const setPartyPriceLevelsSchema = z.object({
  salesPriceLevelId: z.string().optional(),
  purchasePriceLevelId: z.string().optional(),
  /** "" = no list. */
  salesPriceListId: z.string().optional(),
  purchasePriceListId: z.string().optional(),
});
export type SetPartyPriceLevelsInput = z.infer<typeof setPartyPriceLevelsSchema>;

// ---------------------------------------------------------------------------
// Staff & permissions
// ---------------------------------------------------------------------------

export const createStaffSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'INVENTORY', 'VIEWER']),
  branchId: z.string().uuid(),
  phone: z.string().trim().max(40).optional(),
  /** A role the company made ("" = none); the person then works like its base role. */
  customRoleId: z.string().optional(),
  /** More numbers, each with what it is (owner, 2026-10-02). */
  otherPhones: z.array(z.string().trim().max(40)).max(5).optional(),
  otherPhoneLabels: z.array(z.string().trim().max(60)).max(5).optional(),
  /** Keep the password, encrypted, for the owner's reminder (needs staff:password_note). */
  rememberPassword: z.boolean().optional(),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = createStaffSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const staffPermissionsSchema = z.object({
  granted: z.array(z.string()),
  revoked: z.array(z.string()),
});
export type StaffPermissionsInput = z.infer<typeof staffPermissionsSchema>;

// ---- Parties and delivery (DOMAIN step 4b) ----

export const partyTypeSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'CARRIER']);

export const partySchema = z.object({
  name: z.string().trim().min(1).max(200),
  types: z.array(partyTypeSchema).min(1),
  phone: z.string().max(40).optional(),
  email: z.union([z.literal(''), z.string().email().max(200)]).optional(),
  taxNumber: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  otherPhones: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  contactName: z.string().max(200).optional(),
  shippingAddress: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  /** "" clears it. */
  defaultCarrierId: z.string().optional(),
  isCashCustomer: z.boolean().optional(),
  /** Whose each extra phone is, by position ("" = no name). */
  otherPhoneLabels: z.array(z.string().trim().max(60)).max(5).optional(),
  /** What the main phone is; "" clears it. */
  phoneLabel: z.string().trim().max(60).optional(),
  /** Checked against the company's country (owner, 2026-10-02). */
  nationalId: z.string().trim().max(30).optional(),
  extraAddress: z.string().max(300).optional(),
  extraAddressLabel: z.string().max(60).optional(),
  /** A shipping company without a file of its own, by name ("" clears it). */
  tempCarrierName: z.string().max(200).optional(),
});
export type CreatePartyInput = z.infer<typeof partySchema>;
/** On an edit, a field left out is unchanged; closing needs a zero balance. */
export type UpdatePartyInput = Partial<CreatePartyInput> & { isActive?: boolean };

export interface SetDeliveryStatusInput {
  status: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED';
  driverId?: string;
  /** When RETURNED: also post a full sales return (needs sales:return). */
  createReturn?: boolean;
}

export interface CreateShipmentInput {
  carrierId: string;
  invoiceIds: string[];
  waybillNo?: string;
  /** Cash on delivery, minor units; none = everything still owed, 0 = prepaid. */
  codAmount?: number;
  notes?: string;
}

export interface CreateSettlementInput {
  carrierId: string;
  shipmentIds: string[];
  fees: number;
  received: number;
  notes?: string;
  /** Where the carrier's payment went; none = the branch's cash box. */
  accountId?: string;
}

// ---- Money (DOMAIN step 5) ----

export interface CreateMoneyAccountInput {
  name: string;
  kind: 'CASH_BOX' | 'CUSTODY' | 'BANK' | 'WALLET' | 'POST';
  branchId: string;
  custodianId?: string;
  number?: string;
  bankName?: string;
  /** Minor units already in it. */
  openingBalance?: number;
  isDefault?: boolean;
  /** The company's main cash box (money_accounts:main). */
  isMain?: boolean;
  /** A cash box of this warehouse (same branch). */
  warehouseId?: string;
}

export interface UpdateMoneyAccountInput {
  name?: string;
  number?: string;
  bankName?: string;
  custodianId?: string;
  isDefault?: boolean;
  isActive?: boolean;
  /** Only for an account nothing has moved through yet. */
  openingBalance?: number;
  /** Make it the company's main cash box (money_accounts:main). */
  isMain?: boolean;
  /** Its warehouse; "" = none. */
  warehouseId?: string;
}

export interface VoucherLineInput {
  method: 'CASH' | 'BANK_TRANSFER' | 'INSTAPAY' | 'MOBILE_WALLET' | 'POST';
  accountId: string;
  /** Minor units. */
  amount: number;
  reference?: string;
}

/** A receipt, payment or expense. */
export interface CreateVoucherInput {
  partyId?: string;
  categoryId?: string;
  lines: VoucherLineInput[];
  allocations?: { documentId: string; amount: number }[];
  notes?: string;
  /** The day it happened, if not today (needs documents:backdate). */
  documentDate?: string;
}

export interface CreateCashTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  notes?: string;
  documentDate?: string;
}

export interface ExpenseCategoryInput {
  name?: string;
  /** '' = make it a main category. */
  parentId?: string;
  isActive?: boolean;
}

// ---- Ledger (DOMAIN step 6) ----

export interface CreateLedgerAccountInput {
  name: string;
  parentId: string;
  isGroup?: boolean;
}

export interface UpdateLedgerAccountInput {
  name?: string;
  isActive?: boolean;
}

export interface CreateJournalEntryInput {
  /** yyyy-mm-dd; none = today. */
  date?: string;
  description: string;
  lines: { accountId: string; debit?: number; credit?: number; memo?: string }[];
}

// ---- Cheques & promissory notes (DOMAIN step 7) ----

export interface CreateNoteInput {
  partyId: string;
  kind: 'CHEQUE' | 'PROMISSORY_NOTE';
  serialNumber: string;
  /** Minor units. */
  amount: number;
  /** yyyy-mm-dd. */
  dueDate: string;
  bankName?: string;
  drawer?: string;
  guarantor?: string;
  remark?: string;
  allocations?: { documentId: string; amount: number }[];
  /** yyyy-mm-dd; today if not given. */
  receivedOn?: string;
  broughtBy?: string;
}

export interface NoteStepInput {
  accountId?: string;
  partyId?: string;
  remark?: string;
}
