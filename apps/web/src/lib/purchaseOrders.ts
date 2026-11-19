import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PurchaseOrder,
  PurchaseOrderList,
  PurchaseOrderSuggestion,
  SavePurchaseOrderInput,
} from '@skb/shared';
import { api } from './api';

/** The purchase orders list's filters (owner, 2026-11-18). */
export interface PurchaseOrderFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  partyId?: string;
  from?: string;
  to?: string;
  item?: string;
  open?: boolean;
}

function query(f: PurchaseOrderFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f))
    if (v !== undefined && v !== '' && v !== false) q.set(k, String(v));
  return q.toString();
}

export function usePurchaseOrders(f: PurchaseOrderFilters) {
  return useQuery({
    queryKey: ['purchase-orders', 'list', f],
    queryFn: () => api.get<PurchaseOrderList>(`/purchase-orders?${query(f)}`),
    placeholderData: keepPreviousData,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['purchase-orders', 'one', id],
    queryFn: () => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
    enabled: !!id,
  });
}

/** The supplier's items to buy again, with the quantity suggested ("what to buy"). */
export function usePurchaseOrderSuggestions(
  supplierId: string | undefined,
  days = 30,
  target = 30,
  enabled = true,
) {
  return useQuery({
    queryKey: ['purchase-orders', 'suggestions', supplierId, days, target],
    queryFn: () =>
      api.get<PurchaseOrderSuggestion[]>(
        `/purchase-orders/suggestions?supplierId=${supplierId}&days=${days}&target=${target}`,
      ),
    enabled: !!supplierId && enabled,
    staleTime: 60_000,
  });
}

export function useSavePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SavePurchaseOrderInput }) =>
      id
        ? api.put<PurchaseOrder>(`/purchase-orders/${id}`, input)
        : api.post<PurchaseOrder>('/purchase-orders', input),
    onSuccess: (order) => {
      qc.setQueryData(['purchase-orders', 'one', order.id], order);
      void qc.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
    },
  });
}

/** Mark sent, or cancel. */
export function usePurchaseOrderStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, step }: { id: string; step: 'send' | 'cancel' }) =>
      api.post<PurchaseOrder>(`/purchase-orders/${id}/${step}`),
    onSuccess: (order) => {
      qc.setQueryData(['purchase-orders', 'one', order.id], order);
      void qc.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
    },
  });
}
