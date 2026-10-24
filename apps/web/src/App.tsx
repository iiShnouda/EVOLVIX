import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
  useLocation,
  useParams,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConfirmHost } from './components/ConfirmHost';
import { setCompanyTimeZone } from '@skb/shared';
import { queryClient } from './lib/queryClient';
import { useCompanySettings, usePreferences, usePrintPaper } from './lib/queries';
import { useHomePath } from './lib/home';
import { api, API_BASE } from './lib/api';
import { applyDocumentPrefs, usePrefs } from './stores/prefs';
import { useAuth } from './stores/auth';
import { useConnection } from './stores/connection';
import { useConnectionMonitor } from './lib/useConnectionMonitor';
import { useIdleLogout } from './lib/useIdleLogout';
import { Shell } from './components/shell/Shell';
import { OfflineGate } from './components/OfflineGate';
import { UpdateNotice } from './components/UpdateNotice';
import { LeavePrompt } from './components/LeavePrompt';
import { PrintEditorHost } from './components/PrintEditor';
import { setTabRoutes } from './components/shell/Tabs';
import { isTabSwitch } from './lib/tabs';
import { setScroll } from './lib/scrollRoot';
import { BootDone } from './lib/bootSplash';
import { startAppUpdates } from './lib/appUpdate';
import { CrashScreen } from './components/CrashScreen';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { InvoiceBuilderPage } from './pages/InvoiceBuilderPage';
import { ReturnBuilderPage } from './pages/ReturnBuilderPage';
import { SettingsPage } from './pages/SettingsPage';
import { PartiesPage } from './pages/PartiesPage';
import { InventoryPage } from './pages/InventoryPage';
import { ItemCardPage } from './pages/ItemCardPage';
import { BranchesPage } from './pages/BranchesPage';
import { TransferPage } from './pages/TransfersPage';
import { TransferBuilderPage } from './pages/TransferBuilderPage';
import { CatalogSetupPage } from './pages/CatalogSetupPage';
import { ChatPage } from './pages/ChatPage';
import { AssistantPage } from './pages/AssistantPage';
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
import { SystemPage } from './pages/SystemPage';
import { UpdatesPage } from './pages/UpdatesPage';
import { ImportPage } from './pages/ImportPage';
import { LicensePage } from './pages/LicensePage';
import { PayrollPage } from './pages/PayrollPage';
import { ThemesPage } from './pages/ThemesPage';
import { mayOpenPath } from './lib/routeAccess';

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

type BootState = 'checking' | 'ready' | 'unreachable';

/**
 * Start-up (owner, 2026-10-14): the splash runs while we reach the server; if it can't be reached
 * within a few seconds we stop waiting and show "connection failed" with a retry, instead of
 * spinning forever. When it answers, we restore the session silently from the refresh cookie.
 */
function useBoot(): { boot: BootState; retry: () => void } {
  const setAnonymous = useAuth((s) => s.setAnonymous);
  const [boot, setBoot] = useState<BootState>('checking');

  const run = useCallback(async () => {
    setBoot('checking');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    // Both at once, so a running server costs one round trip, not two.
    const reachable = fetch(`${API_BASE}/health`, { signal: controller.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => window.clearTimeout(timer));
    const restored = api.refreshSession();
    if (!(await reachable)) {
      setBoot('unreachable');
      return;
    }
    if (!(await restored)) setAnonymous();
    setBoot('ready');
  }, [setAnonymous]);

  useEffect(() => {
    void run();
  }, [run]);
  return { boot, retry: run };
}

/** Guards the app area: requires auth, and blocks all data when offline. */
function ProtectedApp() {
  const status = useAuth((s) => s.status);
  const connection = useConnection((s) => s.state);
  const setConnState = useConnection((s) => s.setState);

  // Still starting: the index.html splash stays on screen (lib/bootSplash).
  if (status === 'unknown') return null;
  if (status === 'anonymous') return <Navigate to="/login" replace />;

  // Server-authoritative security: nothing is readable without a live connection. The open pages
  // stay alive behind the gate, hidden and unusable, so what was being typed is still there when
  // the server is back (owner, 2026-10-19: the server dropped and everything typed was gone).
  // Nothing is kept on the device: it lives only in this window's memory, as before.
  const offline = connection === 'offline';
  return (
    <>
      <BootDone />
      {offline && (
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
      )}
      <div hidden={offline} inert={offline} aria-hidden={offline}>
        <CompanyClock />
        <RememberPage />
        <ScrollReset />
        <PrintPaper />
        <LeavePrompt />
        <PrintEditorHost />
        <Shell />
      </div>
    </>
  );
}

/**
 * A new page opens at the top (owner, 2026-10-13: entering a page while scrolled down landed in the
 * middle of the new one). Switching tabs keeps each tab's own remembered scroll, so those are left
 * alone; a filter or redirect that keeps the same page (same path) doesn't jump either.
 */
function ScrollReset() {
  const { pathname, state } = useLocation();
  useEffect(() => {
    if (isTabSwitch(state)) return;
    // The page scrolls inside the main area now, not the window; reset whichever it is.
    setScroll(0);
  }, [pathname, state]);
  return null;
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
  const home = useHomePath();
  const permissions = useAuth((s) => s.user?.permissions ?? NO_PERMISSIONS);
  if (prefs.isPending) return null;
  const page = prefs.data?.[LAST_PAGE];
  // …unless it is no longer theirs to open.
  const safe =
    page?.startsWith('/') &&
    !page.startsWith('//') &&
    page !== '/' &&
    mayOpenPath(page.split('?')[0]!, permissions);
  return <Navigate to={safe && page ? page : home} replace />;
}

const NO_PERMISSIONS: string[] = [];

/** An unknown address: the person's first page. */
function HomeRedirect() {
  return <Navigate to={useHomePath()} replace />;
}

function LoginRoute() {
  const status = useAuth((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return (
    <>
      <BootDone />
      <LoginPage />
    </>
  );
}

/**
 * A saved sales invoice opens on the invoice screen with every line, read-only until "Edit invoice"
 * (owner, 2026-10-19).
 */
function ViewSalesInvoiceRoute() {
  const { id } = useParams();
  return <InvoiceBuilderPage key={`view-${id}`} editId={id} readOnly />;
}

/**
 * The store's screens that open as tabs of the inventory page (owner, 2026-10-21); their old
 * addresses still lead there, with what they carried (e.g. `?doc=` for labels).
 */
function InventoryTabRoute({ tab }: { tab: string }) {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  q.set('tab', tab);
  return <Navigate to={`/inventory?${q.toString()}`} replace />;
}

/** One transfer on its own page; changing it reopens the transfer screen on it (owner, 2026-10-19). */
function TransferRoute() {
  const { id } = useParams();
  return <TransferPage key={id} />;
}
function EditTransferRoute() {
  const { id } = useParams();
  return <TransferBuilderPage key={`edit-${id}`} editId={id} />;
}

/** Changing a saved sales invoice opens the invoice screen on it (owner, 2026-10-01). */
function EditSalesInvoiceRoute() {
  const { id } = useParams();
  return <InvoiceBuilderPage key={`edit-${id}`} editId={id} />;
}

// A data router, so a screen with work on it can ask before it is left (useBlocker).
const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<LoginRoute />} errorElement={<CrashScreen />} />
    <Route element={<ProtectedApp />} errorElement={<CrashScreen />}>
      <Route index element={<Landing />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/sales" element={<DocumentsPage key="sales" scope="sales" />} />
      <Route path="/sales/new" element={<InvoiceBuilderPage key="sale" />} />
      <Route path="/sales/invoices/:id" element={<ViewSalesInvoiceRoute />} />
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
      <Route path="/inventory/stocktake" element={<InventoryTabRoute tab="stocktake" />} />
      <Route path="/inventory/transfers" element={<InventoryTabRoute tab="transfers" />} />
      <Route path="/inventory/transfers/new" element={<TransferBuilderPage />} />
      <Route path="/inventory/transfers/:id" element={<TransferRoute />} />
      <Route path="/inventory/transfers/:id/edit" element={<EditTransferRoute />} />
      <Route path="/inventory/setup" element={<CatalogSetupPage />} />
      <Route path="/inventory/labels" element={<InventoryTabRoute tab="labels" />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/assistant" element={<AssistantPage />} />
      <Route path="/inventory/price-lists" element={<InventoryTabRoute tab="pricelists" />} />
      <Route path="/inventory/products/new" element={<NewItemsRoute />} />
      <Route path="/inventory/products/:id/edit" element={<ProductEditorPage />} />
      <Route path="/inventory/models" element={<ModelsPage />} />
      <Route path="/inventory/models/new" element={<ModelEditorPage key="new" />} />
      <Route path="/inventory/models/:id" element={<ModelEditorPage />} />
      <Route path="/purchases" element={<DocumentsPage key="purchases" scope="purchases" />} />
      <Route path="/purchases/new" element={<AddItemsPage key="purchase" />} />
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
      <Route path="/system" element={<SystemPage />} />
      <Route path="/updates" element={<UpdatesPage />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/license" element={<LicensePage />} />
      <Route path="/payroll" element={<PayrollPage />} />
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/branches" element={<BranchesPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/themes" element={<ThemesPage />} />
    </Route>
    <Route path="*" element={<HomeRedirect />} />
  </>,
);
// Each open tab shows one of the signed-in pages (shell/Tabs.tsx), with an unknown address
// going to the dashboard there too.
setTabRoutes([
  ...(routes.find((r) => !r.path && r.children)?.children ?? []),
  { path: '*', element: <HomeRedirect /> },
]);
const router = createBrowserRouter(routes);

export default function App() {
  useApplyPrefs();
  useRefetchOnLocale();
  useConnectionMonitor();
  useIdleLogout();
  useEffect(startAppUpdates, []);
  const { boot, retry } = useBoot();

  return (
    <QueryClientProvider client={queryClient}>
      <UpdateNotice />
      {boot === 'unreachable' ? (
        <>
          <BootDone />
          <OfflineGate onRetry={retry} />
        </>
      ) : (
        <RouterProvider router={router} />
      )}
      <ConfirmHost />
    </QueryClientProvider>
  );
}

/**
 * Adding items is a purchase invoice (owner decision 2026-10-01) for whoever may buy and price;
 * an item with no purchase (or for someone who may only create items) uses the item editor.
 */
function NewItemsRoute() {
  const can = useCan();
  // No "new item without a purchase" any more (owner, 2026-10-17): items come in on a purchase.
  const purchase = can('purchases:create') && can('prices:edit') && can('products:create');
  return purchase ? <AddItemsPage /> : <ProductEditorPage key="new" />;
}
