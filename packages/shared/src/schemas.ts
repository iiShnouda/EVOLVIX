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
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

export const purchaseLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  /** Purchase cost per unit (minor units) — feeds the weighted-average cost. */
  unitCost: z.number().int().min(0),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;

export const createPurchaseInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line item'),
  taxPercent: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().optional(),
  paidAmount: z.number().int().min(0).default(0),
});
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;
