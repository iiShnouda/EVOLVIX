import { useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { api, API_BASE } from './lib/api';
import { applyDocumentPrefs, usePrefs } from './stores/prefs';
import { useAuth } from './stores/auth';
import { useConnection } from './stores/connection';
import { useConnectionMonitor } from './lib/useConnectionMonitor';
import { Shell } from './components/shell/Shell';
import { OfflineGate } from './components/OfflineGate';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { InvoiceBuilderPage } from './pages/InvoiceBuilderPage';
import { ReturnBuilderPage } from './pages/ReturnBuilderPage';
import { ProfitabilityPage } from './pages/ProfitabilityPage';
import { SettingsPage } from './pages/SettingsPage';
import { PartiesPage } from './pages/PartiesPage';
import { InventoryPage } from './pages/InventoryPage';
import { ItemCardPage } from './pages/ItemCardPage';
import { StocktakePage } from './pages/StocktakePage';
import { BranchesPage } from './pages/BranchesPage';
import { TransfersPage } from './pages/TransfersPage';
import { TransferBuilderPage } from './pages/TransferBuilderPage';
import { CatalogSetupPage } from './pages/CatalogSetupPage';
import { ProductEditorPage } from './pages/ProductEditorPage';
import { ModelsPage } from './pages/ModelsPage';
import { ModelEditorPage } from './pages/ModelEditorPage';
import { StaffPage } from './pages/StaffPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { MoneyPage } from './pages/MoneyPage';

/** Apply locale/theme to <html> and keep them in sync with preferences + system changes. */
function useApplyPrefs(): void {
  const locale = usePrefs((s) => s.locale);
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    applyDocumentPrefs(locale, theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyDocumentPrefs(locale, theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [locale, theme]);
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
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-brand-fg font-bold">
          SKB
        </span>
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

  return <Shell />;
}

function LoginRoute() {
  const status = useAuth((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  return <LoginPage />;
}

export default function App() {
  useApplyPrefs();
  useRefetchOnLocale();
  useConnectionMonitor();
  useBootstrapAuth();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<ProtectedApp />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/sales" element={<DocumentsPage key="sales" scope="sales" />} />
            <Route path="/sales/new" element={<InvoiceBuilderPage mode="sale" />} />
            <Route
              path="/sales/invoices/:id/return"
              element={<ReturnBuilderPage scope="sales" />}
            />
            <Route path="/parties" element={<PartiesPage />} />
            <Route path="/deliveries" element={<DeliveriesPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/items/:id" element={<ItemCardPage />} />
            <Route path="/inventory/stocktake" element={<StocktakePage />} />
            <Route path="/inventory/transfers" element={<TransfersPage />} />
            <Route path="/inventory/transfers/new" element={<TransferBuilderPage />} />
            <Route path="/inventory/setup" element={<CatalogSetupPage />} />
            <Route path="/inventory/products/new" element={<ProductEditorPage key="new" />} />
            <Route path="/inventory/products/:id/edit" element={<ProductEditorPage />} />
            <Route path="/inventory/models" element={<ModelsPage />} />
            <Route path="/inventory/models/new" element={<ModelEditorPage key="new" />} />
            <Route path="/inventory/models/:id" element={<ModelEditorPage />} />
            <Route
              path="/purchases"
              element={<DocumentsPage key="purchases" scope="purchases" />}
            />
            <Route path="/purchases/new" element={<InvoiceBuilderPage mode="purchase" />} />
            <Route
              path="/purchases/invoices/:id/return"
              element={<ReturnBuilderPage scope="purchases" />}
            />
            <Route path="/receipts" element={<MoneyPage />} />
            <Route path="/analytics" element={<ProfitabilityPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/branches" element={<BranchesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
