import { z } from 'zod';

/**
 * Zod schemas shared by the client (form validation) and server (request validation).
 * The server treats these as the authoritative contract.
 */

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
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'FACTORY']).optional(),
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
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const createSalesInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  lines: z.array(invoiceLineSchema).min(1, 'Add at least one line item'),
  taxPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().optional(),
  paidAmount: z.number().int().min(0).default(0),
  /** Request to sell below the configured floor (still never below cost). */
  overrideFloor: z.boolean().optional().default(false),
  /** Default warehouse for every line; none = the user's branch default. */
  warehouseId: z.string().uuid().optional(),
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

export const purchaseLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Purchase cost per unit (minor units) — feeds the weighted-average cost. */
  unitCost: z.number().int().min(0),
  /** Warehouse the goods arrive into; defaults to the invoice's warehouse. */
  warehouseId: z.string().uuid().optional(),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;

export const createPurchaseInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line item'),
  taxPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().optional(),
  paidAmount: z.number().int().min(0).default(0),
  /** Default warehouse for every line; none = the user's branch default. */
  warehouseId: z.string().uuid().optional(),
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
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

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

export const createWarehouseSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  /** Empty = automatic code from the branch code. */
  code: z.string().trim().max(20).optional(),
  isDefault: z.boolean().optional().default(false),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export const updateSettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().length(2).optional(),
  currency: z.string().trim().length(3).optional(),
  defaultMarkupPercent: z.number().int().min(0).max(1000).optional(),
  minMarkupPercent: z.number().int().min(0).max(1000).optional(),
  defaultTaxPercent: z.number().int().min(0).max(100).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
