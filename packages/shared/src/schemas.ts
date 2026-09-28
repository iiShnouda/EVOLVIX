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
