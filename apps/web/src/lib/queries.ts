import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Category,
  Department,
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
  StaffAccessInput,
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
  MoneyAccount,
  AccountStatement,
  Voucher,
  OpenInvoice,
  ExpenseCategory,
  CreateMoneyAccountInput,
  UpdateMoneyAccountInput,
  CreateVoucherInput,
  CreateCashTransferInput,
  ExpenseCategoryInput,
  LedgerAccount,
  LedgerStatement,
  TrialBalance,
  JournalEntry,
  CreateLedgerAccountInput,
  UpdateLedgerAccountInput,
  CreateJournalEntryInput,
  Note,
  NotesSummary,
  Portfolio,
  CreateNoteInput,
  NoteStepInput,
  IncomeStatement,
  BalanceSheet,
  MonthlySales,
  TopParty,
  ItemMovement,
  Aging,
  ClosedYear,
  AuditEntry,
  AuditFacets,
  BackupStatus,
  BackupFile,
  Performance,
  ConvertQuotationInput,
  Employee,
  WorkShift,
  PayrollRules,
  AttendanceSheet,
  AttendanceImportResult,
  PayrollAdjustment,
  EmployeeAdvance,
  PayrollRun,
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
/** Invoices, the returns issued against them, or (sales) price quotations. */
export type DocKind = 'invoices' | 'returns' | 'quotations';

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
/** Items by name / SKU / barcode / supplier code / price; `supplierId` keeps one supplier's items. */
export function useProductSearch(
  search: string,
  inStockOnly = false,
  supplierId = '',
  departmentId = '',
) {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (inStockOnly) query.set('inStockOnly', 'true');
  if (supplierId) query.set('supplierId', supplierId);
  // A department's items and items of no department.
  if (departmentId) query.set('departmentId', departmentId);
  return useQuery({
    queryKey: ['products', search, inStockOnly, supplierId, departmentId],
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
  void qc.invalidateQueries({ queryKey: ['ledger'] });
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      // A fresh session lists the new branch among those the person can work in.
      void api.refreshSession();
    },
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

/** Sales departments (أقسام), open ones first. */
export function useDepartments() {
  return useQuery({
    queryKey: ['catalog', 'departments'],
    queryFn: () => api.get<Department[]>('/departments'),
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
export type CatalogList = 'units' | 'categories' | 'departments' | 'price-levels' | 'variant-options';

/** A category's department: an id, or '' for none (every department). */
type DepartmentChoice = { departmentId?: string };

export function useCreateCatalogEntry(list: CatalogList) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | (CreateNamedInput & DepartmentChoice)
        | CreatePriceLevelInput
        | (CreateVariantOptionInput & { kind: VariantKind }),
    ) => api.post<unknown>(`/${list}`, input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useUpdateCatalogEntry(list: CatalogList) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateNamedInput | UpdatePriceLevelInput | DepartmentChoice;
    }) =>
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

export function useSetStaffAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: StaffAccessInput }) =>
      api.put<StaffMember>(`/staff/${id}/access`, input),
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

// ---------------------------------------------------------------------------
// Money (DOMAIN.md §2.6): accounts, vouchers, expense categories
// ---------------------------------------------------------------------------

/** Money moved: balances, invoices, parties and the dashboard all change. */
function invalidateAfterMoney(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['money'] });
  invalidateAfterPosting(qc, 'sales');
  void qc.invalidateQueries({ queryKey: ['purchases'] });
  void qc.invalidateQueries({ queryKey: ['delivery'] });
}

export function useMoneyAccounts(enabled = true) {
  return useQuery({
    queryKey: ['money', 'accounts'],
    queryFn: () => api.get<MoneyAccount[]>('/money-accounts'),
    enabled,
  });
}

export function useAccountStatement(id: string, from: string, to: string) {
  return useQuery({
    queryKey: ['money', 'statement', id, from, to],
    queryFn: () =>
      api.get<AccountStatement>(
        `/money-accounts/${id}/movements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!id,
  });
}

export function useCreateMoneyAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMoneyAccountInput) =>
      api.post<MoneyAccount>('/money-accounts', input),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

export function useUpdateMoneyAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMoneyAccountInput }) =>
      api.put<MoneyAccount>(`/money-accounts/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['money'] }),
  });
}

export function useVouchers(params: { type?: string; status?: string; partyId?: string }) {
  const query = new URLSearchParams({ pageSize: '100' });
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
  if (params.partyId) query.set('partyId', params.partyId);
  return useQuery({
    queryKey: ['money', 'vouchers', params],
    queryFn: () => api.get<Paginated<Voucher>>(`/vouchers?${query}`),
  });
}

export function useOpenInvoices(partyId: string, side: 'sales' | 'purchases', enabled = true) {
  return useQuery({
    queryKey: ['money', 'open', partyId, side],
    queryFn: () => api.get<OpenInvoice[]>(`/parties/${partyId}/open-invoices?side=${side}`),
    enabled: enabled && !!partyId,
  });
}

export type VoucherKind = 'receipts' | 'payments' | 'expenses';

export function useCreateVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, input }: { kind: VoucherKind; input: CreateVoucherInput }) =>
      api.post<Voucher>(`/${kind}`, input),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

export function useCreateCashTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCashTransferInput) => api.post<Voucher>('/cash-transfers', input),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

export function useCancelVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Voucher>(`/vouchers/${id}/cancel`, {}),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

export function useExpenseCategories(enabled = true) {
  return useQuery({
    queryKey: ['money', 'categories'],
    queryFn: () => api.get<ExpenseCategory[]>('/expense-categories'),
    enabled,
  });
}

export function useSaveExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ExpenseCategoryInput }) =>
      id
        ? api.put<ExpenseCategory>(`/expense-categories/${id}`, input)
        : api.post<ExpenseCategory>('/expense-categories', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['money', 'categories'] }),
  });
}

// ---------------------------------------------------------------------------
// Ledger (DOMAIN.md §2.8): chart of accounts, statements, trial balance, journal
// ---------------------------------------------------------------------------

export function useLedgerAccounts(enabled = true) {
  return useQuery({
    queryKey: ['ledger', 'accounts'],
    queryFn: () => api.get<LedgerAccount[]>('/ledger/accounts'),
    enabled,
  });
}

/** `kind` = 'accounts' (an account or group) or 'parties' (a customer's / supplier's statement). */
export function useLedgerStatement(
  kind: 'accounts' | 'parties',
  id: string,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: ['ledger', 'statement', kind, id, from, to],
    queryFn: () =>
      api.get<LedgerStatement>(
        `/ledger/${kind}/${id}/statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!id,
  });
}

export function useTrialBalance(from: string, to: string) {
  return useQuery({
    queryKey: ['ledger', 'trial', from, to],
    queryFn: () =>
      api.get<TrialBalance>(
        `/ledger/trial-balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });
}

export function useJournal(params: { from: string; to: string; source?: string }) {
  const query = new URLSearchParams({ from: params.from, to: params.to, pageSize: '100' });
  if (params.source) query.set('source', params.source);
  return useQuery({
    queryKey: ['ledger', 'journal', params],
    queryFn: () => api.get<Paginated<JournalEntry>>(`/ledger/entries?${query}`),
  });
}

export function useLockDate() {
  return useQuery({
    queryKey: ['ledger', 'lock'],
    queryFn: () => api.get<{ lockDate: string | null }>('/ledger/lock'),
  });
}

export function useSetLockDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lockDate: string | null) =>
      api.put<{ lockDate: string | null }>('/ledger/lock', { lockDate }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ledger'] }),
  });
}

export function useSaveLedgerAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CreateLedgerAccountInput | UpdateLedgerAccountInput;
    }) =>
      id
        ? api.put<LedgerAccount>(`/ledger/accounts/${id}`, input)
        : api.post<LedgerAccount>('/ledger/accounts', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ledger'] }),
  });
}

export function usePostJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJournalEntryInput) =>
      api.post<JournalEntry>('/ledger/entries', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

export function useReverseJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<JournalEntry>(`/ledger/entries/${id}/reverse`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Cheques & promissory notes (DOMAIN.md §2.7)
// ---------------------------------------------------------------------------

export function useNotes(params: { direction: 'RECEIVABLE' | 'PAYABLE'; status?: string }) {
  const query = new URLSearchParams({ direction: params.direction, pageSize: '100' });
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: ['notes', 'list', params],
    queryFn: () => api.get<Paginated<Note>>(`/notes?${query}`),
  });
}

export function useNotesSummary() {
  return useQuery({
    queryKey: ['notes', 'summary'],
    queryFn: () => api.get<NotesSummary>('/notes/summary'),
  });
}

export function usePortfolios(enabled = true) {
  return useQuery({
    queryKey: ['notes', 'portfolios'],
    queryFn: () => api.get<Portfolio[]>('/portfolios'),
    enabled,
  });
}

/** A note step moves balances, invoices, money and the ledger. */
function invalidateAfterNote(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['notes'] });
  void qc.invalidateQueries({ queryKey: ['money'] });
  invalidateAfterPosting(qc, 'sales');
  void qc.invalidateQueries({ queryKey: ['purchases'] });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      direction,
      input,
    }: {
      direction: 'RECEIVABLE' | 'PAYABLE';
      input: CreateNoteInput;
    }) => api.post<Note>(direction === 'RECEIVABLE' ? '/notes/receive' : '/notes/issue', input),
    onSuccess: () => invalidateAfterNote(qc),
  });
}

export type NoteStep = 'collect' | 'pay' | 'bounce' | 'endorse' | 'cancel';

export function useNoteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, step, input }: { id: string; step: NoteStep; input: NoteStepInput }) =>
      api.post<Note>(`/notes/${id}/${step}`, input),
    onSuccess: () => invalidateAfterNote(qc),
  });
}

export function useDepositNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { noteIds: string[]; accountId: string }) =>
      api.post<Portfolio>('/notes/deposit', input),
    onSuccess: () => invalidateAfterNote(qc),
  });
}

// ---------------------------------------------------------------------------
// Financial statements & analytics (DOMAIN step 8)
// ---------------------------------------------------------------------------

export function useIncomeStatement(from: string, to: string) {
  return useQuery({
    queryKey: ['ledger', 'income', from, to],
    queryFn: () =>
      api.get<IncomeStatement>(
        `/ledger/income-statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });
}

export function useBalanceSheet(asOf: string) {
  return useQuery({
    queryKey: ['ledger', 'balance', asOf],
    queryFn: () => api.get<BalanceSheet>(`/ledger/balance-sheet?asOf=${encodeURIComponent(asOf)}`),
  });
}

export function useMonthlySales(months: number) {
  return useQuery({
    queryKey: ['report', 'monthly', months],
    queryFn: () => api.get<MonthlySales[]>(`/analytics/monthly?months=${months}`),
  });
}

export function useTopParties(from: string, to: string, side: 'customers' | 'suppliers') {
  return useQuery({
    queryKey: ['report', 'top', from, to, side],
    queryFn: () =>
      api.get<TopParty[]>(
        `/analytics/top-parties?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&side=${side}&limit=15`,
      ),
  });
}

export function useItemMovement(from: string, to: string) {
  return useQuery({
    queryKey: ['report', 'items', from, to],
    queryFn: () =>
      api.get<ItemMovement>(
        `/analytics/item-movement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=20`,
      ),
  });
}

export function useAging(side: 'customers' | 'suppliers') {
  return useQuery({
    queryKey: ['report', 'aging', side],
    queryFn: () => api.get<Aging>(`/analytics/aging?side=${side}`),
  });
}

export function useClosedYears() {
  return useQuery({
    queryKey: ['ledger', 'closed-years'],
    queryFn: () => api.get<ClosedYear[]>('/ledger/closed-years'),
  });
}

export function useCloseYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: number) => api.post<ClosedYear>('/ledger/close-year', { year }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

export interface AuditFilter {
  actorId?: string;
  resource?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
}

export function useAuditLog(f: AuditFilter) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
  return useQuery({
    queryKey: ['audit', f],
    queryFn: () => api.get<Paginated<AuditEntry>>(`/audit?${q.toString()}`),
    placeholderData: (prev) => prev,
  });
}

export function useAuditFacets() {
  return useQuery({
    queryKey: ['audit', 'facets'],
    queryFn: () => api.get<AuditFacets>('/audit/facets'),
  });
}

export function useBackupStatus() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupStatus>('/backups') });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupFile>('/backups/run'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesInvoiceInput) =>
      api.post<SalesDocument>('/sales/quotations', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sales'] }),
  });
}

export function useConvertQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConvertQuotationInput }) =>
      api.post<SalesDocument>(`/sales/quotations/${id}/convert`, input),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

export function useCancelQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SalesDocument>(`/sales/quotations/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sales'] }),
  });
}

export function usePerformance(from: string, to: string, by: 'rep' | 'branch' | 'department') {
  return useQuery({
    queryKey: ['report', 'performance', from, to, by],
    queryFn: () =>
      api.get<Performance>(
        `/analytics/performance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&by=${by}`,
      ),
  });
}

// ---------------------------------------------------------------------------
// Payroll & attendance
// ---------------------------------------------------------------------------

function invalidatePayroll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['payroll'] });
}

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: () => api.get<Employee[]>('/payroll/employees'),
    enabled,
  });
}

export function useSaveEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Record<string, unknown> }) =>
      id
        ? api.put<Employee>(`/payroll/employees/${id}`, input)
        : api.post<Employee>('/payroll/employees', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ['payroll', 'shifts'],
    queryFn: () => api.get<WorkShift[]>('/payroll/shifts'),
  });
}

export function useSaveShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Record<string, unknown> }) =>
      id
        ? api.put<WorkShift>(`/payroll/shifts/${id}`, input)
        : api.post<WorkShift>('/payroll/shifts', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function usePayrollRules() {
  return useQuery({
    queryKey: ['payroll', 'rules'],
    queryFn: () => api.get<PayrollRules>('/payroll/settings'),
  });
}

export function useSavePayrollRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PayrollRules) => api.put<PayrollRules>('/payroll/settings', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useAttendance(date: string, branchId: string) {
  const q = new URLSearchParams({ date });
  if (branchId) q.set('branchId', branchId);
  return useQuery({
    queryKey: ['payroll', 'attendance', date, branchId],
    queryFn: () => api.get<AttendanceSheet>(`/payroll/attendance?${q.toString()}`),
  });
}

export function useSaveAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      date: string;
      rows: {
        employeeId: string;
        status: string | null;
        checkIn?: string;
        checkOut?: string;
        notes?: string;
      }[];
    }) => api.put<AttendanceSheet>('/payroll/attendance', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useImportAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api.post<AttendanceImportResult>('/payroll/attendance/import', { text }),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useAdjustments(year: number, month: number) {
  return useQuery({
    queryKey: ['payroll', 'adjustments', year, month],
    queryFn: () => api.get<PayrollAdjustment[]>(`/payroll/adjustments?year=${year}&month=${month}`),
  });
}

export function useAddAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      employeeId: string;
      year: number;
      month: number;
      kind: string;
      amount: number;
      reason?: string;
    }) => api.post<PayrollAdjustment>('/payroll/adjustments', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useCancelAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/payroll/adjustments/${id}/cancel`),
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useAdvances() {
  return useQuery({
    queryKey: ['payroll', 'advances'],
    queryFn: () => api.get<EmployeeAdvance[]>('/payroll/advances'),
  });
}

export function useGiveAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      employeeId: string;
      amount: number;
      installment?: number;
      accountId?: string;
      notes?: string;
    }) => api.post<EmployeeAdvance>('/payroll/advances', input),
    onSuccess: () => {
      invalidatePayroll(qc);
      void qc.invalidateQueries({ queryKey: ['money'] });
    },
  });
}

export function useCancelAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<EmployeeAdvance>(`/payroll/advances/${id}/cancel`),
    onSuccess: () => {
      invalidatePayroll(qc);
      void qc.invalidateQueries({ queryKey: ['money'] });
    },
  });
}

export function usePayrollRuns() {
  return useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => api.get<PayrollRun[]>('/payroll/runs'),
  });
}

export function usePayrollRun(id: string | null) {
  return useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: () => api.get<PayrollRun>(`/payroll/runs/${id}`),
    enabled: !!id,
  });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; month: number; branchId?: string }) =>
      api.post<PayrollRun>('/payroll/runs', input),
    onSuccess: () => invalidatePayroll(qc),
  });
}

/** recalculate · post · cancel · pay on a payroll run. */
export function usePayrollAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'recalculate' | 'post' | 'cancel' | 'pay';
      body?: unknown;
    }) => api.post<PayrollRun>(`/payroll/runs/${id}/${action}`, body ?? {}),
    onSuccess: () => {
      invalidatePayroll(qc);
      void qc.invalidateQueries({ queryKey: ['money'] });
      void qc.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}
