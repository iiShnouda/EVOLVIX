import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExchangeInput,
  DamagedRow,
  Exchange,
  Product,
  ReturnsReport,
  Warehouse,
} from '@skb/shared';
import { api } from './api';

/**
 * Return reasons, damaged goods and exchanges (owner, 2026-11-18): their reads and writes, kept
 * apart from the main query file. Nothing is kept on the device beyond the query cache.
 */

function invalidateStock(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['sales', 'purchases', 'dashboard', 'products', 'inventory', 'parties', 'report', 'reports', 'ledger', 'returnable', 'damaged', 'money'])
    void qc.invalidateQueries({ queryKey: [key] });
}

/** Save an exchange: the return and the new invoice together. */
export function useCreateExchange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExchangeInput) => api.post<Exchange>('/sales/exchanges', input),
    onSuccess: () => invalidateStock(qc),
  });
}

/** Every warehouse the person may see, the branches' damaged goods warehouses too. */
export function useWarehousesWithDamaged(activeOnly = true) {
  return useQuery({
    queryKey: ['inventory', 'warehouses', 'damaged', activeOnly],
    queryFn: () =>
      api.get<Warehouse[]>(`/warehouses?includeDamaged=true${activeOnly ? '&activeOnly=true' : ''}`),
  });
}

/** Damaged goods held now, with each item's supplier. */
export function useDamaged(branchId: string, supplierId: string) {
  const q = new URLSearchParams();
  if (branchId) q.set('branchId', branchId);
  if (supplierId) q.set('supplierId', supplierId);
  return useQuery({
    queryKey: ['damaged', branchId, supplierId],
    queryFn: () => api.get<DamagedRow[]>(`/inventory/damaged?${q}`),
    placeholderData: keepPreviousData,
  });
}

export interface DamagedMoveInput {
  warehouseId: string;
  toWarehouseId?: string;
  lines: { productId: string; quantity: number }[];
  notes?: string;
}

/** Repair (back to a store) or write off damaged goods. */
export function useDamagedMove(kind: 'repair' | 'write-off') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DamagedMoveInput) =>
      api.post<{ number: string; quantity: number; value?: number | null }>(
        `/inventory/damaged/${kind}`,
        input,
      ),
    onSuccess: () => invalidateStock(qc),
  });
}

/** The returns report of a period, by reason, item, customer or rep. */
export function useReturnsReport(from: string, to: string, by: ReturnsReport['by']) {
  return useQuery({
    queryKey: ['reports', 'returns', from, to, by],
    queryFn: () =>
      api.get<ReturnsReport>(`/reports/returns?${new URLSearchParams({ from, to, by })}`),
    placeholderData: keepPreviousData,
  });
}

/** Items for an exchange's new lines: in stock in the warehouse it is made from. Off until something is typed. */
export function useTakenSearch(search: string, warehouseId: string) {
  return useQuery({
    queryKey: ['products', 'taken', search, warehouseId],
    enabled: !!search,
    queryFn: () => {
      const q = new URLSearchParams({ search, inStockOnly: 'true', limit: '8' });
      if (warehouseId) q.set('warehouseId', warehouseId);
      return api.get<Product[]>(`/products?${q}`);
    },
    placeholderData: keepPreviousData,
  });
}
