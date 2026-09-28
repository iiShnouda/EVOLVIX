import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompanySettings,
  CreatePurchaseInvoiceInput,
  CreateReturnInput,
  CreateSalesInvoiceInput,
  UpdateSettingsInput,
  BranchWithWarehouses,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  Warehouse,
  DashboardData,
  InventoryList,
  ItemCard,
  StocktakeInput,
  StocktakeResult,
  Valuation,
  Paginated,
  Party,
  PresenceEntry,
  Product,
  ProfitReport,
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

// ---------------------------------------------------------------------------
// Documents: sales / purchase invoices and their returns share one shape.
// ---------------------------------------------------------------------------

/** Which side of the business a document belongs to (also its API prefix). */
export type DocScope = 'sales' | 'purchases';
/** Invoices or the returns issued against them. */
export type DocKind = 'invoices' | 'returns';

export function useDocumentList(
  scope: DocScope,
  kind: DocKind,
  params: { page: number; search?: string; status?: string },
) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: [scope, kind, params],
    queryFn: () => api.get<Paginated<SalesDocumentSummary>>(`/${scope}/${kind}?${query}`),
  });
}

/** One invoice or return. Invoice lines carry `returnedQuantity`. */
export function useDocument(scope: DocScope, id: string | null) {
  return useQuery({
    queryKey: [scope, 'detail', id],
    queryFn: () => api.get<SalesDocument>(`/${scope}/invoices/${id}`),
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

export function useProfitReport(params: { from: string; to: string; by: string }) {
  const query = new URLSearchParams({ from: params.from, to: params.to, by: params.by });
  return useQuery({
    queryKey: ['report', 'profit', params],
    queryFn: () => api.get<ProfitReport>(`/reports/profitability?${query}`),
  });
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<CompanySettings>('/settings'),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.put<CompanySettings>('/settings', input),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

/** Everything a posted document can change: its lists, stock, balances and reports. */
function invalidateAfterPosting(qc: ReturnType<typeof useQueryClient>, scope: DocScope) {
  void qc.invalidateQueries({ queryKey: [scope] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
  void qc.invalidateQueries({ queryKey: ['parties'] });
  void qc.invalidateQueries({ queryKey: ['report'] });
}

export function useCreateSalesInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesInvoiceInput) =>
      api.post<SalesDocument>('/sales/invoices', input),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

export function useCreatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseInvoiceInput) =>
      api.post<SalesDocument>('/purchases/invoices', input),
    onSuccess: () => invalidateAfterPosting(qc, 'purchases'),
  });
}

// ---------------------------------------------------------------------------
// Inventory depth (Phase 2)
// ---------------------------------------------------------------------------

/** Stock list — across all warehouses, or in one when `warehouseId` is set. */
export function useInventory(params: { search?: string; lowOnly?: boolean; warehouseId?: string }) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.lowOnly) query.set('lowOnly', 'true');
  if (params.warehouseId) query.set('warehouseId', params.warehouseId);
  return useQuery({
    queryKey: ['inventory', 'items', params],
    queryFn: () => api.get<InventoryList>(`/inventory/items?${query}`),
  });
}

/** Item card (كارت الصنف) for one item over [from, to] (ISO dates), optionally one warehouse. */
export function useItemCard(id: string, from: string, to: string, warehouseId?: string) {
  const query = new URLSearchParams({ from, to });
  if (warehouseId) query.set('warehouseId', warehouseId);
  return useQuery({
    queryKey: ['inventory', 'card', id, from, to, warehouseId ?? ''],
    queryFn: () => api.get<ItemCard>(`/inventory/items/${id}/card?${query}`),
    enabled: !!id,
  });
}

/** Stock valuation (تقييم المخزن) at the end of `asOf` (ISO date), optionally one warehouse. */
export function useValuation(asOf: string, warehouseId?: string) {
  const query = new URLSearchParams({ asOf });
  if (warehouseId) query.set('warehouseId', warehouseId);
  return useQuery({
    queryKey: ['inventory', 'valuation', asOf, warehouseId ?? ''],
    queryFn: () => api.get<Valuation>(`/inventory/valuation?${query}`),
  });
}

// ---------------------------------------------------------------------------
// Branches & warehouses
// ---------------------------------------------------------------------------

/** Warehouses the user may use (the server scopes them to the user's branch where needed). */
export function useWarehouses(activeOnly = false) {
  return useQuery({
    queryKey: ['inventory', 'warehouses', activeOnly],
    queryFn: () => api.get<Warehouse[]>(`/warehouses${activeOnly ? '?activeOnly=true' : ''}`),
  });
}

export function useBranches() {
  return useQuery({
    queryKey: ['inventory', 'branches'],
    queryFn: () => api.get<BranchWithWarehouses[]>('/branches'),
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWarehouseInput) => api.post<Warehouse>('/warehouses', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWarehouseInput }) =>
      api.put<Warehouse>(`/warehouses/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useStocktake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StocktakeInput) => api.post<StocktakeResult>('/inventory/stocktake', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Post a sales return / purchase return against one invoice. */
export function useCreateReturn(scope: DocScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, input }: { invoiceId: string; input: CreateReturnInput }) =>
      api.post<SalesDocument>(`/${scope}/invoices/${invoiceId}/returns`, input),
    onSuccess: () => invalidateAfterPosting(qc, scope),
  });
}
