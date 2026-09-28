import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompanySettings,
  CreatePurchaseInvoiceInput,
  CreateSalesInvoiceInput,
  DashboardData,
  Paginated,
  Party,
  PresenceEntry,
  Product,
  SalesDocument,
  SalesDocumentSummary,
} from '@skb/shared';
import { api } from './api';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });
}

export function useSalesInvoices(params: { page: number; search?: string; status?: string }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: ['sales', params],
    queryFn: () => api.get<Paginated<SalesDocumentSummary>>(`/sales/invoices?${query}`),
  });
}

export function useSalesInvoice(id: string | null) {
  return useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => api.get<SalesDocument>(`/sales/invoices/${id}`),
    enabled: !!id,
  });
}

export function useParties(params: { page: number; type?: string; search?: string }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.type) query.set('type', params.type);
  if (params.search) query.set('search', params.search);
  return useQuery({
    queryKey: ['parties', params],
    queryFn: () => api.get<Paginated<Party>>(`/parties?${query}`),
  });
}

export function usePresence(enabled: boolean) {
  return useQuery({
    queryKey: ['presence'],
    queryFn: () => api.get<PresenceEntry[]>('/presence'),
    enabled,
    refetchInterval: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Invoicing (Phase 1)
// ---------------------------------------------------------------------------

export function usePurchaseInvoices(params: { page: number; search?: string }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.search) query.set('search', params.search);
  return useQuery({
    queryKey: ['purchases', params],
    queryFn: () => api.get<Paginated<SalesDocumentSummary>>(`/purchases/invoices?${query}`),
  });
}

/** Product search for the invoice line picker. `search` empty → recent/first products. */
export function useProductSearch(search: string, inStockOnly = false) {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (inStockOnly) query.set('inStockOnly', 'true');
  return useQuery({
    queryKey: ['products', search, inStockOnly],
    queryFn: () => api.get<Product[]>(`/products?${query}`),
  });
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<CompanySettings>('/settings'),
    staleTime: 5 * 60_000,
  });
}

export function useCreateSalesInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesInvoiceInput) =>
      api.post<SalesDocument>('/sales/invoices', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

export function useCreatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseInvoiceInput) =>
      api.post<SalesDocument>('/purchases/invoices', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}
