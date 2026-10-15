import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { periodQuery, type Period } from './period';
import { toMinor } from '@skb/shared';
import type {
  IssuedLicense,
  LicenseStatus,
  Season,
  Branding,
  InvoiceRevision,
  PaperSize,
  Numbering,
  Category,
  PriceList,
  PriceListDetail,
  PriceListItemInput,
  Pricing,
  PricingInput,
  QuantityBreak,
  SavePriceListInput,
  SetQuantityBreaksInput,
  Department,
  Group,
  ChatStatus,
  ChatPerson,
  ChatConversation,
  ChatMessage,
  AssistantConversation,
  SystemMonitor,
  ImportResult,
  SystemUpdates,
  AssistantStatus,
  AssistantTurn,
  ProfitLoss,
  CompanySettings,
  CustomerInvoices,
  CreatePurchaseInvoiceInput,
  CreateReturnInput,
  CreateFreeReturnInput,
  CreateSalesInvoiceInput,
  ApproveOrderInput,
  CustomerAccount,
  NotificationList,
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
  DashboardMore,
  InventoryList,
  ItemCard,
  ItemLife,
  StocktakeInput,
  StocktakeResult,
  Valuation,
  Paginated,
  Party,
  PresenceEntry,
  Product,
  ProfitReport,
  SalesDocument,
  DocumentList,
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
  CashHandover,
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
import { useEffect } from 'react';
import { api } from './api';
import { setPrintPaper } from './print';

/**
 * The dashboard for a period (owner, 2026-10-02: day, week, month, year or any dates): revenue,
 * purchases, the trend and the latest documents of that period; balances as they are now.
 */
export function useDashboard(period?: Period) {
  return useQuery({
    queryKey: ['dashboard', period?.from ?? '', period?.to ?? ''],
    queryFn: () => api.get<DashboardData>(`/dashboard${period ? `?${periodQuery(period)}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

/** The dashboard's other widgets for a period (the period's sales, rankings, cheques due by its end). */
export function useDashboardMore(period?: Period) {
  return useQuery({
    queryKey: ['dashboard', 'more', period?.from ?? '', period?.to ?? ''],
    queryFn: () =>
      api.get<DashboardMore>(`/dashboard/more${period ? `?${periodQuery(period)}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Documents: sales / purchase invoices and their returns share one shape.
// ---------------------------------------------------------------------------

/** Which side of the business a document belongs to (also its API prefix). */
export type DocScope = 'sales' | 'purchases';
/** Invoices, the returns issued against them, or (sales) price quotations. */
export type DocKind = 'invoices' | 'returns' | 'quotations' | 'orders';

export function useDocumentList(
  scope: DocScope,
  kind: DocKind,
  params: {
    page: number;
    search?: string;
    /** The separate searches: document number, party name, party code. */
    number?: string;
    party?: string;
    partyCode?: string;
    status?: string;
    /** Sales: one department ('none' = of no department), and company days from / to. */
    departmentId?: string;
    from?: string;
    to?: string;
    /** 'credit' = still owed (آجل), 'paid' = nothing owed. */
    payment?: 'credit' | 'paid';
    /** An invoice's payment state (CREDIT, COLLECTING, PARTIAL, PAID, CANCELLED). */
    state?: string;
    branchId?: string;
    warehouseId?: string;
    pageSize?: number;
    /** Off: not asked for (e.g. no permission to see that list). */
    enabled?: boolean;
  },
) {
  const { enabled = true, ...key } = params;
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.payment) query.set('payment', params.payment);
  if (params.search) query.set('search', params.search);
  if (params.number) query.set('number', params.number);
  if (params.party) query.set('party', params.party);
  if (params.partyCode) query.set('partyCode', params.partyCode);
  if (params.status) query.set('status', params.status);
  if (params.departmentId) query.set('departmentId', params.departmentId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.state) query.set('state', params.state);
  if (params.branchId) query.set('branchId', params.branchId);
  if (params.warehouseId) query.set('warehouseId', params.warehouseId);
  return useQuery({
    queryKey: [scope, kind, key],
    queryFn: () => api.get<DocumentList>(`/${scope}/${kind}?${query}`),
    enabled,
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
  /** How the account stands: OVER_LIMIT, NEAR_LIMIT, OWES, CREDIT, SETTLED or CLOSED. */
  status?: string;
  pageSize?: number;
  enabled?: boolean;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
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
  categoryId = '',
) {
  const query = new URLSearchParams();
  if (categoryId) query.set('categoryId', categoryId);
  if (search) query.set('search', search);
  if (inStockOnly) query.set('inStockOnly', 'true');
  if (supplierId) query.set('supplierId', supplierId);
  // A department's items and items of no department.
  if (departmentId) query.set('departmentId', departmentId);
  return useQuery({
    queryKey: ['products', search, inStockOnly, supplierId, departmentId, categoryId],
    queryFn: () => api.get<Product[]>(`/products?${query}`),
  });
}

/** What the detailed item search (البحث المفصل) filters by; empty = any. */
/** A number condition in the item search: =, more than or less than what is typed. */
export interface RangeFilter {
  op: 'eq' | 'gt' | 'lt';
  value: string;
}

export interface ItemFinderFilters {
  /** A branch's warehouses (the stock counted is theirs). */
  branchId: string;
  /** Only the department's own items, not those of no department. */
  onlyDepartment: boolean;
  departmentId: string;
  /** A group of the department's tree and everything under it (owner, 2026-10-06). */
  groupId?: string;
  seasonId: string;
  warehouseId: string;
  /** A supplier, 'none' (items with no supplier) or '' (any). */
  supplierId: string;
  code: string;
  name: string;
  stock: '' | 'in' | 'out' | 'low';
  /** Sale price, cost (people who may see it), reorder level and balance (owner, 2026-10-01). */
  sale: RangeFilter;
  cost: RangeFilter;
  reorder: RangeFilter;
  balance: RangeFilter;
}

/** A condition as from/to bounds; money in minor units (one piastre past the value for > and <). */
function bounds(f: RangeFilter, money: boolean): [string | null, string | null] {
  if (!f.value.trim() || Number.isNaN(Number(f.value))) return [null, null];
  const v = money ? toMinor(Number(f.value)) : Math.floor(Number(f.value));
  if (f.op === 'eq') return [String(v), String(v)];
  if (f.op === 'gt') return [String(v + 1), null];
  return [null, String(v - 1)];
}

/** The item search, a page at a time; asked again as the filters change (the last results stay meanwhile). */
export function useItemFinder(filters: ItemFinderFilters, page = 1, size = 50) {
  // One more than a page, to know whether there is a next one.
  const query = new URLSearchParams({ limit: String(size + 1), offset: String((page - 1) * size) });
  const set = (k: string, v: string | null) => v != null && v.trim() && query.set(k, v.trim());
  set('departmentId', filters.departmentId);
  if (filters.onlyDepartment && filters.departmentId) query.set('onlyDepartment', 'true');
  if (filters.departmentId) set('groupId', filters.groupId ?? '');
  if (!filters.warehouseId) set('branchId', filters.branchId);
  set('seasonId', filters.seasonId);
  set('warehouseId', filters.warehouseId);
  set('supplierId', filters.supplierId);
  set('code', filters.code);
  set('name', filters.name);
  set('stock', filters.stock);
  const pairs: [RangeFilter, boolean, string, string][] = [
    [filters.sale, true, 'minPrice', 'maxPrice'],
    [filters.cost, true, 'costMin', 'costMax'],
    [filters.reorder, false, 'reorderMin', 'reorderMax'],
    [filters.balance, false, 'stockMin', 'stockMax'],
  ];
  for (const [f, money, lo, hi] of pairs) {
    const [a, b] = bounds(f, money);
    set(lo, a);
    set(hi, b);
  }
  return useQuery({
    queryKey: ['products', 'finder', query.toString()],
    queryFn: async () => {
      const rows = await api.get<Product[]>(`/products?${query}`);
      return { items: rows.slice(0, size), hasMore: rows.length > size };
    },
    placeholderData: keepPreviousData,
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

/** How each kind of document is numbered (الرقم المسلسل) and its next number. */
export function useNumbering() {
  return useQuery({
    queryKey: ['settings', 'numbering'],
    queryFn: () => api.get<Numbering[]>('/settings/numbering'),
  });
}

export function useSaveNumbering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; prefix: string; startAt: number; digits: number }) =>
      api.put<Numbering[]>('/settings/numbering', input),
    onSuccess: (data) => qc.setQueryData(['settings', 'numbering'], data),
  });
}

/** The company's name and logo version; works before sign-in too (the login page shows them). */
export function useBranding() {
  return useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/branding'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Upload (a base64 / data: URL picture) or remove the company logo. */
export function useCompanyLogo() {
  const qc = useQueryClient();
  const done = (data: Branding) => {
    qc.setQueryData(['branding'], data);
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };
  return {
    upload: useMutation({
      mutationFn: (data: string) => api.put<Branding>('/branding/logo', { data }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: () => api.del<Branding>('/branding/logo'),
      onSuccess: done,
    }),
  };
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.put<CompanySettings>('/settings', input),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['branding'] });
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

/** Save a pending invoice for the accountant: goods held, nothing posted. */
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesInvoiceInput) => api.post<SalesDocument>('/sales/orders', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

/** The accountant approves a pending invoice: it becomes a posted sales invoice. */
export function useApproveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApproveOrderInput }) =>
      api.post<SalesDocument>(`/sales/orders/${id}/approve`, input),
    onSuccess: () => {
      invalidateAfterPosting(qc, 'sales');
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

/** The accountant turns a pending invoice down, saying why. */
/** The accountant accepts a posted invoice waiting over the purchase limit. */
export function useApproveLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SalesDocument>(`/sales/invoices/${id}/approve-limit`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sales'] }),
  });
}

/** …or turns it down: it is cancelled with the reason. */
export function useRejectLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<SalesDocument>(`/sales/invoices/${id}/reject-limit`, { reason }),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

/** A customer's invoices of a period together (today unless given), for the accountant. */
export function useCustomerInvoices(partyId: string | null, from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  return useQuery({
    queryKey: ['sales', 'together', partyId, from, to],
    queryFn: () => api.get<CustomerInvoices>(`/sales/customers/${partyId}/invoices?${q}`),
    enabled: !!partyId,
  });
}

/** The accountant's discount on one invoice (posted or pending): a percent or an amount. */
export function useSetInvoiceDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      doc,
      percent,
      amount,
      kind,
    }: {
      doc: Pick<SalesDocument, 'id' | 'type'>;
      percent?: number;
      amount?: number;
      kind?: 'DISCOUNT' | 'EXTRA_DISCOUNT';
    }) =>
      api.post<SalesDocument>(
        `/sales/${doc.type === 'SALES_ORDER' ? 'orders' : 'invoices'}/${doc.id}/discount`,
        { percent, amount, kind },
      ),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

/** One discount shared over several invoices of a customer. */
export function useDiscountAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { invoiceIds: string[]; percent?: number; amount?: number }) =>
      api.post<SalesDocument[]>('/sales/invoices/discount-all', input),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

/** Freeze or reopen invoices for editing/deleting (the accountant); also used on combined print. */
export function useLockInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; locked: boolean }) =>
      api.post<{ locked: boolean; count: number }>('/sales/invoices/lock', input),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

export function useRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<SalesDocument>(`/sales/orders/${id}/reject`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** My notifications (the bell); checked every 30 seconds while the app is open. */
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationList>('/notifications'),
    refetchInterval: 30_000,
  });
}

export function useReadNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api.post<void>(id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SalesDocument>(`/sales/orders/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

/** A customer's account for the accountant: per department, every invoice, pending ones. */
export function useCustomerAccount(partyId: string | null, departmentId = '', enabled = true) {
  const query = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : '';
  return useQuery({
    queryKey: ['account', partyId, departmentId],
    queryFn: () => api.get<CustomerAccount>(`/sales/customers/${partyId}/account${query}`),
    enabled: !!partyId && enabled,
  });
}

/** One customer / supplier / carrier. */
export function useParty(id: string | null) {
  return useQuery({
    queryKey: ['parties', 'one', id],
    queryFn: () => api.get<Party>(`/parties/${id}`),
    enabled: !!id,
  });
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
  branchId?: string;
  departmentId?: string;
  groupId?: string;
}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId) query.set('branchId', params.branchId);
  if (params.departmentId) query.set('departmentId', params.departmentId);
  if (params.departmentId && params.groupId) query.set('groupId', params.groupId);
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

/** An item's whole story: purchases, sales, returns and prices (each part as permitted). */
export function useItemLife(id: string | null) {
  return useQuery({
    queryKey: ['inventory', 'life', id],
    queryFn: () => api.get<ItemLife>(`/inventory/items/${id}/life`),
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

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/warehouses/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/branches/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
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

/** A return typed without an invoice. */
export function useCreateFreeReturn(scope: DocScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFreeReturnInput) =>
      api.post<SalesDocument>(`/${scope}/returns`, input),
    onSuccess: () => invalidateAfterPosting(qc, scope),
  });
}

/** What the party last paid for each item, per unit (minor units); keyed `productId:unitId`. */
export function useLastPrices(scope: DocScope, partyId: string, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  return useQuery({
    queryKey: ['lastPrices', scope, partyId, ids],
    enabled: !!partyId && ids.length > 0,
    queryFn: async () => {
      const q = new URLSearchParams({ partyId });
      ids.forEach((id) => q.append('productIds', id));
      const rows = await api.get<{ productId: string; unitId: string | null; price: number }[]>(
        `/${scope}/returns/last-prices?${q}`,
      );
      return new Map(rows.map((r) => [`${r.productId}:${r.unitId ?? ''}`, r.price]));
    },
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

/** Every group of every department's tree (owner, 2026-10-06). */
export function useGroups() {
  return useQuery({
    queryKey: ['catalog', 'groups'],
    queryFn: () => api.get<Group[]>('/groups'),
    staleTime: 60_000,
  });
}

export interface GroupInput {
  name?: string;
  departmentId?: string;
  parentId?: string | null;
  prefix?: string;
  keywords?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export function useSaveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: GroupInput }) =>
      id ? api.put<Group>(`/groups/${id}`, input) : api.post<Group>('/groups', input),
    onSuccess: () => invalidateCatalog(qc),
  });
}

/** The code a new item of this department and group would get (shown live while typing). */
export function useNextCode(
  departmentId: string,
  groupId: string,
  warehouseId: string,
  enabled: boolean,
) {
  const params = new URLSearchParams();
  if (departmentId) params.set('departmentId', departmentId);
  if (groupId) params.set('groupId', groupId);
  if (warehouseId) params.set('warehouseId', warehouseId);
  return useQuery({
    queryKey: ['catalog', 'next-code', departmentId, groupId, warehouseId],
    queryFn: () => api.get<{ code: string }>(`/products/next-code?${params}`),
    enabled,
    staleTime: 10_000,
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

/** Seasons (owner decision 2026-10-01), the current one marked. */
export function useSeasons(enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'seasons'],
    queryFn: () => api.get<Season[]>('/seasons'),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Season>('/seasons', { name }),
    onSuccess: () => invalidateCatalog(qc),
  });
}

/** The lists edited on the catalog setup page, keyed by their API path. */
export type CatalogList =
  'units' | 'categories' | 'departments' | 'price-levels' | 'variant-options';

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

/** Delete a department that has nothing recorded under it (departments:delete). */
export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/departments/${id}`),
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
      input: UpdateNamedInput | UpdatePriceLevelInput | DepartmentChoice | Record<string, unknown>;
    }) => api.put<unknown>(`/${list}/${id}`, input),
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
/** Set or clear (null) a customer's credit limit. */
export function useSetCreditLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, creditLimit }: { id: string; creditLimit: number | null }) =>
      api.put<Party>(`/parties/${id}/credit-limit`, { creditLimit }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['parties'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

/** Change a pending invoice (its maker or an approver). */
export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateSalesInvoiceInput }) =>
      api.put<SalesDocument>(`/sales/orders/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

export function useSetPartyPriceLevels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetPartyPriceLevelsInput }) =>
      api.put<Party>(`/parties/${id}/price-levels`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

// ---------------------------------------------------------------------------
// Price lists and quantity discounts (DOMAIN.md §2.2)
// ---------------------------------------------------------------------------

export function usePriceLists(side?: 'SALE' | 'PURCHASE') {
  return useQuery({
    queryKey: ['priceLists', side ?? 'all'],
    queryFn: () => api.get<PriceList[]>(`/price-lists${side ? `?side=${side}` : ''}`),
  });
}

export function usePriceList(id: string | null) {
  return useQuery({
    queryKey: ['priceLists', 'one', id],
    queryFn: () => api.get<PriceListDetail>(`/price-lists/${id}`),
    enabled: !!id,
  });
}

export function useSavePriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SavePriceListInput }) =>
      id
        ? api.put<PriceListDetail>(`/price-lists/${id}`, input)
        : api.post<PriceListDetail>('/price-lists', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['priceLists'] }),
  });
}

export function useSetPriceListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: PriceListItemInput[] }) =>
      api.put<PriceListDetail>(`/price-lists/${id}/items`, { items }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['priceLists'] }),
  });
}

export function useDeletePriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/price-lists/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['priceLists'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

export function useQuantityBreaks(productId?: string) {
  return useQuery({
    queryKey: ['quantityBreaks', productId ?? 'all'],
    queryFn: () =>
      api.get<QuantityBreak[]>(`/quantity-breaks${productId ? `?productId=${productId}` : ''}`),
  });
}

export function useSetQuantityBreaks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetQuantityBreaksInput) =>
      api.put<QuantityBreak[]>('/quantity-breaks', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quantityBreaks'] }),
  });
}

/**
 * What an invoice's lines would cost for a party (price list, level, quantity discounts), as the
 * server will accept them. Off until there are lines.
 */
export function usePricing(side: 'sale' | 'purchase', input: PricingInput) {
  return useQuery({
    queryKey: ['pricing', side, input],
    queryFn: () => api.post<Pricing>(`/pricing/${side}`, input),
    enabled: input.lines.length > 0,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
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

/** Remove a person nothing was done under yet (else the server says to deactivate them). */
export function useDeleteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/staff/${id}`),
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

/** Make a role of the company's own. */
export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; baseRole: string; permissions: string[] }) =>
      api.post<RoleInfo>('/roles', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useUpdateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; permissions?: string[] } }) =>
      api.put<RoleInfo>(`/roles/custom/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useDeleteCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/roles/custom/${id}`),
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

export function useVouchers(params: {
  type?: string;
  status?: string;
  partyId?: string;
  branchId?: string;
}) {
  const query = new URLSearchParams({ pageSize: '100' });
  if (params.branchId) query.set('branchId', params.branchId);
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

/** Remove an expense item nothing used yet (else the server says to close it). */
export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/expense-categories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['money', 'categories'] }),
  });
}

/** Remove a money account no money has gone through yet (else the server says to close it). */
/** Take a small amount left on a customer's or supplier's account off (خصم تسوية). */
export function useSettleDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { partyId: string; amount: number; notes?: string }) =>
      api.post<Voucher>('/settle-discount', body),
    onSuccess: () => {
      invalidateAfterMoney(qc);
      void qc.invalidateQueries({ queryKey: ['parties'] });
    },
  });
}

export function useDeleteMoneyAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/money-accounts/${id}`),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

// ---------------------------------------------------------------------------
// Cash handovers (owner, 2026-10-02): a box's cash sent up, confirmed where it arrives
// ---------------------------------------------------------------------------

export function useCashHandovers(side: '' | 'in' | 'out', status: string) {
  return useQuery({
    queryKey: ['money', 'handovers', side, status],
    queryFn: () => {
      const q = new URLSearchParams();
      if (side) q.set('side', side);
      if (status) q.set('status', status);
      return api.get<CashHandover[]>(`/cash-handovers?${q}`);
    },
  });
}

/** The boxes the person may send cash up from (with where each goes). */
export function useHandoverBoxes(enabled = true) {
  return useQuery({
    queryKey: ['money', 'handover-boxes'],
    queryFn: () => api.get<MoneyAccount[]>('/cash-handovers/boxes'),
    enabled,
  });
}

export function useSendCash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fromAccountId: string; amount: number; notes?: string }) =>
      api.post<CashHandover>('/cash-handovers', body),
    onSuccess: () => invalidateAfterMoney(qc),
  });
}

export function useHandoverStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      step,
      reason,
    }: {
      id: string;
      step: 'receive' | 'cancel';
      reason?: string;
    }) =>
      api.post<CashHandover>(
        `/cash-handovers/${id}/${step}`,
        step === 'cancel' ? { reason } : undefined,
      ),
    onSuccess: () => invalidateAfterMoney(qc),
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
  /** Party statements: one branch's, department's or warehouse's lines ('' = all), and items. */
  options: { branchId?: string; departmentId?: string; warehouseId?: string; items?: boolean } = {},
) {
  const query = new URLSearchParams({ from, to });
  if (options.branchId) query.set('branchId', options.branchId);
  if (options.departmentId) query.set('departmentId', options.departmentId);
  if (options.warehouseId) query.set('warehouseId', options.warehouseId);
  if (options.items) query.set('items', 'true');
  return useQuery({
    queryKey: [
      'ledger',
      'statement',
      kind,
      id,
      from,
      to,
      options.branchId ?? '',
      options.departmentId ?? '',
      options.warehouseId ?? '',
      !!options.items,
    ],
    queryFn: () => api.get<LedgerStatement>(`/ledger/${kind}/${id}/statement?${query}`),
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

export function useNotes(params: {
  direction?: 'RECEIVABLE' | 'PAYABLE';
  status?: string;
  /** A paper's number, our reference, bank, drawer or the party's name or code. */
  search?: string;
}) {
  const query = new URLSearchParams({ pageSize: '100' });
  if (params.direction) query.set('direction', params.direction);
  if (params.status) query.set('status', params.status);
  if (params.search?.trim()) query.set('search', params.search.trim());
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

/** Several cheques at once (a series): all saved, or none. */
export function useCreateNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      direction,
      notes,
    }: {
      direction: 'RECEIVABLE' | 'PAYABLE';
      notes: CreateNoteInput[];
    }) =>
      api.post<Note[]>(direction === 'RECEIVABLE' ? '/notes/receive-many' : '/notes/issue-many', {
        notes,
      }),
    onSuccess: () => invalidateAfterNote(qc),
  });
}

export type NoteStep = 'collect' | 'pay' | 'bounce' | 'endorse' | 'cancel' | 'lost';

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

/** Net sales and purchases a month (the last `count` months) or a year (the last `count` years). */
export function useMonthlySales(count: number, by: 'month' | 'year' = 'month') {
  return useQuery({
    queryKey: ['report', 'monthly', by, count],
    queryFn: () =>
      api.get<MonthlySales[]>(
        by === 'year'
          ? `/analytics/monthly?by=year&years=${count}`
          : `/analytics/monthly?months=${count}`,
      ),
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

/** Cancel (delete) a posted sales invoice: everything it moved goes back. */
export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<SalesDocument>(`/sales/invoices/${id}/cancel`, { reason: reason ?? null }),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
  });
}

/** Change a posted sales invoice: it is posted again under its own number. */
export function useUpdateSalesInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateSalesInvoiceInput }) =>
      api.put<SalesDocument>(`/sales/invoices/${id}`, input),
    onSuccess: () => invalidateAfterPosting(qc, 'sales'),
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

/** Remove an employee with no attendance or pay yet (else the server says to deactivate them). */
export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/payroll/employees/${id}`),
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
      documentDate?: string;
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
      date,
    }: {
      id: string;
      action: 'recalculate' | 'post' | 'cancel' | 'pay';
      body?: unknown;
      /** The day its entry carries, if not today (post only; pay sends it in the body). */
      date?: string;
    }) =>
      api.post<PayrollRun>(
        `/payroll/runs/${id}/${action}${date ? `?date=${date}` : ''}`,
        body ?? {},
      ),
    onSuccess: () => {
      invalidatePayroll(qc);
      void qc.invalidateQueries({ queryKey: ['money'] });
      void qc.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** The person's own screen preferences (key → JSON), kept on the server; asked for once. */
export function usePreferences() {
  return useQuery({
    queryKey: ['preferences'],
    queryFn: () => api.get<Record<string, string>>('/preferences'),
    staleTime: Infinity,
  });
}

/** Cancelled and changed sales invoices in a period (sales:changes_report). */
export function useInvoiceChanges(from: string, to: string, kind: '' | 'EDIT' | 'CANCEL') {
  const q = new URLSearchParams({ from, to });
  if (kind) q.set('kind', kind);
  return useQuery({
    queryKey: ['reports', 'invoice-changes', from, to, kind],
    queryFn: () => api.get<InvoiceRevision[]>(`/reports/invoice-changes?${q}`),
    placeholderData: keepPreviousData,
  });
}

/** The paper the person prints on, kept with their preferences; the print helper follows it. */
export function usePrintPaper(): [PaperSize, (size: PaperSize) => void] {
  const [saved, save] = useHiddenColumns('print.paper');
  const size: PaperSize = saved[0] === 'A5' ? 'A5' : 'A4';
  useEffect(() => setPrintPaper(size), [size]);
  return [size, (next) => save(next === 'A5' ? ['A5'] : [])];
}

/** How many rows a list shows on a page, kept per person and list (owner, 2026-10-01). */
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export function usePageSize(id: string, fallback = 50): [number, (size: number) => void] {
  const [saved, save] = useHiddenColumns(`pageSize:${id}`);
  const n = Number(saved[0]);
  const size = (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
  return [size, (next) => save(next === fallback ? [] : [String(next)])];
}

/** The columns a table hides (by header text), and a setter that saves the choice for next time. */
export function useHiddenColumns(id: string): [string[], (hidden: string[]) => void] {
  const qc = useQueryClient();
  const prefs = usePreferences();
  const key = `columns:${id}`;
  let hidden: string[] = [];
  try {
    const saved = prefs.data?.[key];
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed)) hidden = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* a bad value shows every column */
  }
  const set = (next: string[]) => {
    const value = next.length ? JSON.stringify(next) : '';
    qc.setQueryData<Record<string, string>>(['preferences'], (old) => ({
      ...(old ?? {}),
      [key]: value,
    }));
    void api.put('/preferences', { key, value }).catch(() => undefined);
  };
  return [hidden, set];
}

// ---------------------------------------------------------------- staff chat

export function useChatStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['chat', 'status'],
    queryFn: () => api.get<ChatStatus>('/chat/status'),
    enabled,
  });
}

export function useChatPeople(enabled = true) {
  return useQuery({
    queryKey: ['chat', 'people'],
    queryFn: () => api.get<ChatPerson[]>('/chat/people'),
    enabled,
  });
}

export function useConversations(all: boolean) {
  return useQuery({
    queryKey: ['chat', 'conversations', all],
    queryFn: () => api.get<ChatConversation[]>(`/chat/conversations${all ? '?all=true' : ''}`),
  });
}

export function useChatMessages(id: string | null) {
  return useQuery({
    queryKey: ['chat', 'messages', id],
    queryFn: () => api.get<ChatMessage[]>(`/chat/conversations/${id}/messages`),
    enabled: !!id,
  });
}

export function useChatActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat'] });
  return {
    direct: (staffId: string) => api.post<{ id: string }>('/chat/direct', { staffId }),
    group: (title: string, memberIds: string[], id?: string) =>
      (id
        ? api.put<{ id: string }>(`/chat/groups/${id}`, { title, memberIds })
        : api.post<{ id: string }>('/chat/groups', { title, memberIds })
      ).then((r) => (void refresh(), r)),
    send: (id: string, text: string) =>
      api
        .post<ChatMessage>(`/chat/conversations/${id}/messages`, { text })
        .then((r) => (void refresh(), r)),
    mute: (staffId: string, on: boolean) =>
      (on ? api.post(`/chat/mutes/${staffId}`, {}) : api.del(`/chat/mutes/${staffId}`)).then(
        () => void refresh(),
      ),
    refresh,
  };
}

// ---------------------------------------------------------------- offline assistant

export function useAssistantStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api.get<AssistantStatus>('/assistant/status'),
    enabled,
    staleTime: 30_000,
  });
}

export function useAssistantConversations() {
  return useQuery({
    queryKey: ['assistant', 'conversations'],
    queryFn: () => api.get<AssistantConversation[]>('/assistant/conversations'),
  });
}

export function useAssistantTurns(id: string | null) {
  return useQuery({
    queryKey: ['assistant', 'turns', id],
    queryFn: () => api.get<AssistantTurn[]>(`/assistant/conversations/${id}`),
    enabled: !!id,
  });
}

/** What was said in a recording, read by the server's speech service in the app's language. */
export async function transcribe(audio: Blob, language: 'ar' | 'en'): Promise<string> {
  return (
    await api.upload<{ text: string }>(
      `/assistant/transcribe?language=${language}`,
      audio,
      false,
      'POST',
    )
  ).text;
}

/** Send a photo to be read by the assistant (purchase invoice or cheques). */
export async function scanPhoto<T>(kind: 'purchase' | 'cheques', file: File): Promise<T> {
  return api.upload<T>(`/assistant/scan/${kind}`, file, false, 'POST');
}

// ---------------------------------------------------------------- profit and loss

export function useProfitLoss(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'profit-loss', from, to],
    queryFn: () => api.get<ProfitLoss>(`/analytics/profit-loss?from=${from}&to=${to}`),
    enabled,
  });
}

// ---------------------------------------------------------------- server monitor

/** The server's load, read again every few seconds while the page is open (kept in memory only). */
export function useSystemUpdates(enabled = true) {
  return useQuery({
    queryKey: ['system', 'updates'],
    queryFn: () => api.get<SystemUpdates>('/system/updates'),
    enabled,
    // Often while the server is busy with it, else now and then (the menu shows when one is out).
    refetchInterval: (q) =>
      q.state.data && q.state.data.state !== 'idle' && q.state.data.state !== 'failed'
        ? 3_000
        : 5 * 60_000,
    // While the app restarts for an update, the page keeps what it last read.
    retry: false,
  });
}

export function useSystemMonitor() {
  return useQuery({
    queryKey: ['system', 'monitor'],
    queryFn: () => api.get<SystemMonitor>('/system/monitor'),
    refetchInterval: 5_000,
  });
}

/** Import items, customers and suppliers from an uploaded Excel file (owner only). */
export function useImportData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: Blob) => api.upload<ImportResult>('/import', file, false, 'POST'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['parties'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });
}

// ---------------------------------------------------------------- licence

/** This server's licence (owner only). Read now and then so the owner's banner stays current. */
export function useLicense(enabled = true) {
  return useQuery({
    queryKey: ['license'],
    queryFn: () => api.get<LicenseStatus>('/license'),
    enabled,
    staleTime: 60_000,
    refetchInterval: 30 * 60_000,
  });
}

export function useInstallLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.put<LicenseStatus>('/license', { code }),
    onSuccess: (data) => qc.setQueryData(['license'], data),
  });
}

/** The vendor's signing key (PEM text), loaded once on the vendor's own server; null removes it. */
export function useVendorKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pem: string | null) =>
      pem === null
        ? api.del<void>('/license/vendor-key')
        : api.put<void>('/license/vendor-key', { pem }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['license'] }),
  });
}

export function useIssuedLicenses(enabled: boolean) {
  return useQuery({
    queryKey: ['license', 'issued'],
    queryFn: () => api.get<IssuedLicense[]>('/license/issued'),
    enabled,
  });
}

export function useIssueLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      customer: string;
      installId: string;
      maxUsers: number;
      expiresAt: string | null;
    }) => api.post<IssuedLicense>('/license/issue', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['license', 'issued'] }),
  });
}
