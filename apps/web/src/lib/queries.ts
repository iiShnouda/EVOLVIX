import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Category,
  CompanySettings,
  CreatePurchaseInvoiceInput,
  CreateReturnInput,
  CreateSalesInvoiceInput,
  UpdateSettingsInput,
  BranchWithWarehouses,
  CreateBranchInput,
  CreateTransferInput,
  UpdateBranchInput,
  CreateWarehouseInput,
  StockTransfer,
  TransferStatus,
  WarehouseOption,
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
  UnitOfMeasure,
  PriceLevel,
  VariantOption,
  VariantKind,
  ProductDetail,
  ModelDetail,
  ModelSummary,
  CreateNamedInput,
  UpdateNamedInput,
  CreatePriceLevelInput,
  UpdatePriceLevelInput,
  CreateVariantOptionInput,
  CreateProductInput,
  UpdateProductInput,
  UpdatePricesInput,
  CreateModelInput,
  UpdateModelInput,
  SetPartyPriceLevelsInput,
  StaffMember,
  RoleInfo,
  PermissionInfo,
  CreateStaffInput,
  UpdateStaffInput,
  StaffPermissionsInput,
  RepOption,
  CreatePartyInput,
  UpdatePartyInput,
  DeliveryRow,
  DeliveryAction,
  Shipment,
  ShipmentAction,
  CarrierSettlement,
  SetDeliveryStatusInput,
  CreateShipmentInput,
  CreateSettlementInput,
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

export function useParties(params: {
  page: number;
  type?: string;
  search?: string;
  /** true = open accounts only, false = closed only, none = all. */
  active?: boolean;
  pageSize?: number;
  enabled?: boolean;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.type) query.set('type', params.type);
  if (params.search) query.set('search', params.search);
  if (params.active !== undefined) query.set('active', String(params.active));
  const { enabled = true, ...key } = params;
  return useQuery({
    queryKey: ['parties', key],
    queryFn: () => api.get<Paginated<Party>>(`/parties?${query}`),
    enabled,
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
export function useInventory(params: {
  search?: string;
  lowOnly?: boolean;
  warehouseId?: string;
  modelId?: string;
}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.lowOnly) query.set('lowOnly', 'true');
  if (params.warehouseId) query.set('warehouseId', params.warehouseId);
  if (params.modelId) query.set('modelId', params.modelId);
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

// ---------------------------------------------------------------------------
// Transfer permits (إذن تحويل)
// ---------------------------------------------------------------------------

export function useTransfers(params: { page: number; status?: TransferStatus }) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '30' });
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: ['inventory', 'transfers', params],
    queryFn: () => api.get<Paginated<StockTransfer>>(`/transfers?${query}`),
  });
}

export function useTransfer(id: string | null) {
  return useQuery({
    queryKey: ['inventory', 'transfer', id],
    queryFn: () => api.get<StockTransfer>(`/transfers/${id}`),
    enabled: !!id,
  });
}

/** Every open store in every branch — where goods may be sent. */
export function useTransferDestinations() {
  return useQuery({
    queryKey: ['inventory', 'destinations'],
    queryFn: () => api.get<WarehouseOption[]>('/warehouses/destinations'),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransferInput) => api.post<StockTransfer>('/transfers', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Confirm receipt (`receive`) or call it back (`cancel`). */
export function useFinishTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'receive' | 'cancel' }) =>
      api.post<StockTransfer>(`/transfers/${id}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBranchInput) => api.post<BranchWithWarehouses>('/branches', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBranchInput }) =>
      api.put<BranchWithWarehouses>(`/branches/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
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

// ---------------------------------------------------------------------------
// Catalog: units, categories, price levels, sizes & colors, items, models
// ---------------------------------------------------------------------------

/** Anything a catalog change can show up in: lists, items, stock screens, invoice search. */
function invalidateCatalog(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['catalog'] });
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
}

export function useUnits() {
  return useQuery({
    queryKey: ['catalog', 'units'],
    queryFn: () => api.get<UnitOfMeasure[]>('/units'),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  });
}

export function usePriceLevels() {
  return useQuery({
    queryKey: ['catalog', 'price-levels'],
    queryFn: () => api.get<PriceLevel[]>('/price-levels'),
  });
}

export function useVariantOptions() {
  return useQuery({
    queryKey: ['catalog', 'variant-options'],
    queryFn: () => api.get<VariantOption[]>('/variant-options'),
  });
}

/** The lists edited on the catalog setup page, keyed by their API path. */
export type CatalogList = 'units' | 'categories' | 'price-levels' | 'variant-options';

export function useCreateCatalogEntry(list: CatalogList) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | CreateNamedInput
        | CreatePriceLevelInput
        | (CreateVariantOptionInput & { kind: VariantKind }),
    ) => api.post<unknown>(`/${list}`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useUpdateCatalogEntry(list: CatalogList) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNamedInput | UpdatePriceLevelInput }) =>
      api.put<unknown>(`/${list}/${id}`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useProductDetail(id: string | null) {
  return useQuery({
    queryKey: ['catalog', 'product', id],
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => api.post<ProductDetail>('/products', input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      api.put<ProductDetail>(`/products/${id}`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useSetProductPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePricesInput }) =>
      api.put<ProductDetail>(`/products/${id}/prices`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useModels(search: string) {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  return useQuery({
    queryKey: ['catalog', 'models', search],
    queryFn: () => api.get<ModelSummary[]>(`/models?${query}`),
  });
}

export function useModel(id: string | null) {
  return useQuery({
    queryKey: ['catalog', 'model', id],
    queryFn: () => api.get<ModelDetail>(`/models/${id}`),
    enabled: !!id,
  });
}

export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModelInput) => api.post<ModelDetail>('/models', input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useUpdateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateModelInput }) =>
      api.put<ModelDetail>(`/models/${id}`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useSetModelPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePricesInput }) =>
      api.put<ModelDetail>(`/models/${id}/prices`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

/** A customer's / supplier's own price level ("" = back to the default). */
export function useSetPartyPriceLevels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetPartyPriceLevelsInput }) =>
      api.put<Party>(`/parties/${id}/price-levels`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

// ---------------------------------------------------------------------------
// Staff & permissions
// ---------------------------------------------------------------------------

export function useStaff() {
  return useQuery({ queryKey: ['staff', 'list'], queryFn: () => api.get<StaffMember[]>('/staff') });
}

export function useRoles() {
  return useQuery({ queryKey: ['staff', 'roles'], queryFn: () => api.get<RoleInfo[]>('/roles') });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['staff', 'permissions'],
    queryFn: () => api.get<PermissionInfo[]>('/permissions'),
    staleTime: 60 * 60_000,
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => api.post<StaffMember>('/staff', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStaffInput }) =>
      api.put<StaffMember>(`/staff/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useSetStaffPermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: StaffPermissionsInput }) =>
      api.put<StaffMember>(`/staff/${id}/permissions`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ role, permissions }: { role: string; permissions: string[] }) =>
      api.put<RoleInfo>(`/roles/${role}`, { permissions }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useResetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: string) => api.post<RoleInfo>(`/roles/${role}/reset`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

/** Who a sale can be credited to (active staff). */
export function useReps(enabled = true) {
  return useQuery({
    queryKey: ['sales', 'reps'],
    queryFn: () => api.get<RepOption[]>('/sales/reps'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Parties: add and edit (DOMAIN step 4b)
// ---------------------------------------------------------------------------

export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePartyInput) => api.post<Party>('/parties', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

export function useUpdateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePartyInput }) =>
      api.put<Party>(`/parties/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

// ---------------------------------------------------------------------------
// Delivery (DOMAIN.md §2.5): deliveries, parcels, carrier settlements
// ---------------------------------------------------------------------------

/** A delivery step can post returns and move money between accounts: refresh what it touches. */
function invalidateAfterDelivery(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['delivery'] });
  invalidateAfterPosting(qc, 'sales');
}

export function useDeliveries(params: { status?: string; method?: string }) {
  const query = new URLSearchParams({ pageSize: '100' });
  if (params.status) query.set('status', params.status);
  if (params.method) query.set('method', params.method);
  return useQuery({
    queryKey: ['delivery', 'list', params],
    queryFn: () => api.get<Paginated<DeliveryRow>>(`/deliveries?${query}`),
  });
}

export function useSetDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetDeliveryStatusInput }) =>
      api.put<DeliveryAction>(`/sales/invoices/${id}/delivery`, input),
    onSuccess: () => invalidateAfterDelivery(qc),
  });
}

export function useShipments(params: { status?: string; carrierId?: string }) {
  const query = new URLSearchParams({ pageSize: '100' });
  if (params.status) query.set('status', params.status);
  if (params.carrierId) query.set('carrierId', params.carrierId);
  return useQuery({
    queryKey: ['delivery', 'shipments', params],
    queryFn: () => api.get<Paginated<Shipment>>(`/shipments?${query}`),
  });
}

/** Sales sent with this carrier and not in a parcel yet. */
export function useEligibleInvoices(carrierId: string) {
  return useQuery({
    queryKey: ['delivery', 'eligible', carrierId],
    queryFn: () =>
      api.get<DeliveryRow[]>(`/shipments/eligible?carrierId=${encodeURIComponent(carrierId)}`),
    enabled: !!carrierId,
  });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShipmentInput) => api.post<Shipment>('/shipments', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['delivery'] }),
  });
}

export type ShipmentStep = 'picked-up' | 'delivered' | 'returned' | 'cancel';

export function useShipmentStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      step,
      createReturns,
    }: {
      id: string;
      step: ShipmentStep;
      createReturns?: boolean;
    }): Promise<ShipmentAction> =>
      step === 'returned'
        ? api.post<ShipmentAction>(`/shipments/${id}/returned`, { createReturns: !!createReturns })
        : api
            .post<Shipment>(`/shipments/${id}/${step}`, {})
            .then((shipment) => ({ shipment, returns: [], problems: [] })),
    onSuccess: () => invalidateAfterDelivery(qc),
  });
}

export function useSettlements(enabled = true) {
  return useQuery({
    queryKey: ['delivery', 'settlements'],
    queryFn: () => api.get<CarrierSettlement[]>('/carrier-settlements'),
    enabled,
  });
}

export function useCreateSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementInput) =>
      api.post<CarrierSettlement>('/carrier-settlements', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}
