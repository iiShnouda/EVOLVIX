import { useQuery } from '@tanstack/react-query';
import type {
  DashboardData,
  Paginated,
  Party,
  PresenceEntry,
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
