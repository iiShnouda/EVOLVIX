import { useEffect, useRef } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { setCompanyTimeZone } from '@skb/shared';
import { queryClient } from './lib/queryClient';
import { useCompanySettings, usePreferences, usePrintPaper } from './lib/queries';
import { api, API_BASE } from './lib/api';
import { applyDocumentPrefs, usePrefs } from './stores/prefs';
import { useAuth } from './stores/auth';
import { useConnection } from './stores/connection';
import { useConnectionMonitor } from './lib/useConnectionMonitor';
import { Shell } from './components/shell/Shell';
import { OfflineGate } from './components/OfflineGate';
import { UpdateNotice } from './components/UpdateNotice';
import { LeavePrompt } from './components/LeavePrompt';
import { startAppUpdates } from './lib/appUpdate';
import { Spinner } from './components/ui';
import { Logo } from './components/Logo';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { InvoiceBuilderPage } from './pages/InvoiceBuilderPage';
import { ReturnBuilderPage } from './pages/ReturnBuilderPage';
import { SettingsPage } from './pages/SettingsPage';
import { PartiesPage } from './pages/PartiesPage';
import { InventoryPage } from './pages/InventoryPage';
import { ItemCardPage } from './pages/ItemCardPage';
import { StocktakePage } from './pages/StocktakePage';
import { BranchesPage } from './pages/BranchesPage';
import { TransfersPage } from './pages/TransfersPage';
import { TransferBuilderPage } from './pages/TransferBuilderPage';
import { CatalogSetupPage } from './pages/CatalogSetupPage';
import { PriceListsPage } from './pages/PriceListsPage';
import { ProductEditorPage } from './pages/ProductEditorPage';
import { AddItemsPage } from './pages/AddItemsPage';
import { useCan } from './lib/can';
import { ModelsPage } from './pages/ModelsPage';
import { ModelEditorPage } from './pages/ModelEditorPage';
import { StaffPage } from './pages/StaffPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { MoneyPage } from './pages/MoneyPage';
import { LedgerPage } from './pages/LedgerPage';
import { NotesPage } from './pages/NotesPage';
import { NoteFormPage } from './pages/NoteFormPage';
import { HandoversPage } from './pages/HandoversPage';
import { CustomerAccountPage } from './pages/CustomerAccountPage';
import { CustomerInvoicesPage } from './pages/CustomerInvoicesPage';
import { StatementPage } from './pages/StatementPage';
import { CashMovePage } from './pages/CashMovePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ActivityPage } from './pages/ActivityPage';
import { PresencePage } from './pages/PresencePage';
import { PayrollPage } from './pages/PayrollPage';
import { ThemesPage } from './pages/ThemesPage';

/** Apply locale/theme to <html> and keep them in sync with preferences + system changes. */
function useApplyPrefs(): void {
  const locale = usePrefs((s) => s.locale);
  const theme = usePrefs((s) => s.theme);
  const skin = usePrefs((s) => s.skin);
  useEffect(() => {
    applyDocumentPrefs(locale, theme, skin);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyDocumentPrefs(locale, theme, skin);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [locale, theme, skin]);
}

/** Names come from the server in the screen language: refetch everything when it changes. */
function useRefetchOnLocale(): void {
  const locale = usePrefs((s) => s.locale);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void queryClient.invalidateQueries();
  }, [locale]);
}

/** Silent session restore: try the refresh cookie once on load. */
function useBootstrapAuth(): void {
  const setAnonymous = useAuth((s) => s.setAnonymous);
  useEffect(() => {
    let active = true;
    void api.refreshSession().then((ok) => {
      if (active && !ok) setAnonymous();
    });
    return () => {
      active = false;
    };
  }, [setAnonymous]);
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas text-muted">
      <div className="flex flex-col items-center gap-3">
        <Logo size={56} />
        <Spinner size={22} />
      </div>
    </div>
  );
}

/** Guards the app area: requires auth, and blocks all data when offline. */
function ProtectedApp() {
  const status = useAuth((s) => s.status);
  const connection = useConnection((s) => s.state);
  const setConnState = useConnection((s) => s.setState);

  if (status === 'unknown') return <Splash />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;

  // Server-authoritative security: nothing is readable without a live connection.
  if (connection === 'offline') {
    return (
      <OfflineGate
        onRetry={async () => {
          setConnState('connecting');
          try {
            const res = await fetch(`${API_BASE}/health`);
            setConnState(res.ok ? 'online' : 'offline');
          } catch {
            setConnState('offline');
          }
        }}
      />
    );
  }

  return (
    <>
      <CompanyClock />
      <RememberPage />
      <PrintPaper />
      <LeavePrompt />
      <Shell />
    </>
  );
}

/**
 * Business days follow the company's time zone (Settings): "today" in date pickers and every date
 * shown. Set while rendering, before the pages below compute their "today".
 */
function CompanyClock() {
  setCompanyTimeZone(useCompanySettings().data?.timeZone);
  return null;
}

/** Where the person was is kept on the server (not the device), so signing in again reopens it. */
const LAST_PAGE = 'session:lastPage';

function RememberPage() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (pathname === '/' || pathname === '/login') return;
    const params = new URLSearchParams(search);
    params.delete('print');
    const query = params.toString();
    const page = query ? `${pathname}?${query}` : pathname;
    const timer = window.setTimeout(() => {
      queryClient.setQueryData<Record<string, string>>(['preferences'], (old) =>
        old ? { ...old, [LAST_PAGE]: page } : old,
      );
      void api.put('/preferences', { key: LAST_PAGE, value: page }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [pathname, search]);
  return null;
}

/** Every printout uses the person's paper (A4 or A5). */
function PrintPaper() {
  usePrintPaper();
  return null;
}

/** Opening the app (or signing in) lands on the page the person was on, else the dashboard. */
function Landing() {
  const prefs = usePreferences();
  if (prefs.isPending) return <Splash />;
  const page = prefs.data?.[LAST_PAGE];
  const safe = page?.startsWith('/') && !page.startsWith('//') && page !== '/';
  return <Navigate to={safe && page ? page : '/dashboard'} replace />;
}

function LoginRoute() {
  const status = useAuth((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <LoginPage />;
}

/** Changing a saved sales invoice opens the invoice screen on it (owner, 2026-10-01). */
function EditSalesInvoiceRoute() {
  const { id } = useParams();
  return <InvoiceBuilderPage key={`edit-${id}`} mode="sale" editId={id} />;
}

// A data router, so a screen with work on it can ask before it is left (useBlocker).
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedApp />}>
        <Route index element={<Landing />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sales" element={<DocumentsPage key="sales" scope="sales" />} />
        <Route path="/sales/new" element={<InvoiceBuilderPage key="sale" mode="sale" />} />
        <Route path="/sales/invoices/:id/edit" element={<EditSalesInvoiceRoute />} />
        <Route path="/sales/invoices/:id/return" element={<ReturnBuilderPage scope="sales" />} />
        <Route path="/sales/returns/new" element={<ReturnBuilderPage key="new" scope="sales" />} />
        <Route path="/sales/together" element={<CustomerInvoicesPage />} />
        <Route path="/sales/together/:partyId" element={<CustomerInvoicesPage />} />
        <Route path="/parties" element={<PartiesPage />} />
        <Route path="/parties/:id/account" element={<CustomerAccountPage />} />
        <Route path="/statement" element={<StatementPage />} />
        <Route path="/deliveries" element={<DeliveriesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/items/:id" element={<ItemCardPage />} />
        <Route path="/inventory/stocktake" element={<StocktakePage />} />
        <Route path="/inventory/transfers" element={<TransfersPage />} />
        <Route path="/inventory/transfers/new" element={<TransferBuilderPage />} />
        <Route path="/inventory/setup" element={<CatalogSetupPage />} />
        <Route path="/inventory/price-lists" element={<PriceListsPage />} />
        <Route path="/inventory/products/new" element={<NewItemsRoute />} />
        <Route path="/inventory/products/:id/edit" element={<ProductEditorPage />} />
        <Route path="/inventory/models" element={<ModelsPage />} />
        <Route path="/inventory/models/new" element={<ModelEditorPage key="new" />} />
        <Route path="/inventory/models/:id" element={<ModelEditorPage />} />
        <Route path="/purchases" element={<DocumentsPage key="purchases" scope="purchases" />} />
        <Route
          path="/purchases/new"
          element={<InvoiceBuilderPage key="purchase" mode="purchase" />}
        />
        <Route
          path="/purchases/invoices/:id/return"
          element={<ReturnBuilderPage scope="purchases" />}
        />
        <Route
          path="/purchases/returns/new"
          element={<ReturnBuilderPage key="new" scope="purchases" />}
        />
        <Route path="/receipts" element={<MoneyPage />} />
        <Route path="/receipts/move" element={<CashMovePage />} />
        <Route path="/handovers" element={<HandoversPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/receive" element={<NoteFormPage key="in" direction="RECEIVABLE" />} />
        <Route path="/notes/issue" element={<NoteFormPage key="out" direction="PAYABLE" />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/audit" element={<ActivityPage />} />
        <Route path="/presence" element={<PresencePage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/themes" element={<ThemesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </>,
  ),
);

export default function App() {
  useApplyPrefs();
  useRefetchOnLocale();
  useConnectionMonitor();
  useBootstrapAuth();
  useEffect(startAppUpdates, []);

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateNotice />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/**
 * Adding items is a purchase invoice (owner decision 2026-10-01) for whoever may buy and price;
 * an item with no purchase (or for someone who may only create items) uses the item editor.
 */
function NewItemsRoute() {
  const can = useCan();
  const [params] = useSearchParams();
  const purchase =
    params.get('plain') !== '1' &&
    can('purchases:create') &&
    can('prices:edit') &&
    can('products:create');
  return purchase ? <AddItemsPage /> : <ProductEditorPage key="new" />;
}
